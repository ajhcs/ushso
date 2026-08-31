import path from 'node:path';
import {
  BARRIERS,
  COMPONENT_KINDS,
  PACKAGE_ROOT,
  buildMaterial,
  clone,
  compareUnicodeCodePoints,
  componentMaterial,
  digest,
  membershipMaterial,
  projectionDocumentMaterial,
  projectionSetMaterial,
  publicationMaterial,
  legacyMaterial,
  readJson,
  sha256Bytes,
  writeJson
} from './common.mjs';

const ZERO = '0'.repeat(64);
const ONE = '1'.repeat(64);

function digestRef(value) {
  return clone(value);
}

function canonicalManifest(buildNumber, canonicalAsOf, sealedAt) {
  const revision = `r${buildNumber}`;
  const members = [
    ['asset', 'ushso:asset:alpha', ['asset_search', 'coverage', 'seo'], 'public'],
    ['asset', 'ushso:asset:quarantined', ['asset_search'], 'quarantined'],
    ['distribution', 'ushso:distribution:alpha-release', ['release_distribution_search'], 'public'],
    ['field', 'ushso:field:alpha-ccn', ['schema_field_search'], 'public'],
    ['relationship', 'ushso:relationship:alpha-join', ['join_edge_search'], 'public'],
    ['source', 'ushso:source:alpha', ['source_search'], 'public']
  ].map(([objectType, canonicalId, obligations, visibility]) => ({
    object_type: objectType,
    canonical_id: canonicalId,
    revision_id: `${canonicalId}:revision:${revision}`,
    revision_sha256: sha256Bytes(`${canonicalId}\n${revision}\ncanonical-revision`),
    visibility_state: visibility,
    projection_obligations: [...obligations].sort()
  })).sort((left, right) => compareUnicodeCodePoints(`${left.canonical_id}\u0000${left.revision_id}`, `${right.canonical_id}\u0000${right.revision_id}`));
  const manifest = {
    manifest_version: 'canonical-revision-membership.v1',
    manifest_id: `w1:exact-revisions:${revision}`,
    selection_model: 'exact_immutable_revision_membership',
    canonical_as_of: canonicalAsOf,
    sealed_at: sealedAt,
    member_order: 'canonical_id_then_revision_id_unicode_ascending',
    revision_count: members.length,
    projection_obligation_count: members.reduce((total, member) => total + member.projection_obligations.length, 0),
    members,
    membership_digest: null,
    immutable: true
  };
  manifest.membership_digest = digest('canonical_revision_membership', membershipMaterial(manifest));
  return manifest;
}

function truthRefs(revision) {
  const token = revision.revision_id.split(':').at(-1);
  return {
    evidence: [`evidence:${token}:${revision.canonical_id.split(':').at(-1)}`],
    assertions: [],
    access_observations: [],
    documentation: [],
    relationships: []
  };
}

function projectionContent(kind, member, buildNumber) {
  const content = {
    canonical_id: member.canonical_id,
    label: `Fixture ${kind} ${member.canonical_id}`,
    semantic_revision: `r${buildNumber}`,
    absence_claim_permitted: false
  };
  if (kind === 'coverage') content.coverage_snapshot_id = `coverage:snapshot:r${buildNumber}`;
  if (kind === 'seo') content.stable_url = `/datasets/${member.canonical_id.split(':').at(-1)}`;
  return content;
}

function buildComponents(manifest, buildNumber, projectedAt, retainedUntil) {
  const revision = `r${buildNumber}`;
  const documents = [];
  const acknowledgements = [];
  for (const member of manifest.members) {
    for (const kind of member.projection_obligations) {
      const generationId = `gen:${revision}:${kind}`;
      const shortId = member.canonical_id.split(':').slice(2).join('-');
      const acknowledgement = {
        acknowledgement_version: 'projection-acknowledgement.v1',
        acknowledgement_id: `ack:${revision}:${kind}:${shortId}`,
        generation_id: generationId,
        component_kind: kind,
        canonical_manifest_id: manifest.manifest_id,
        canonical_id: member.canonical_id,
        revision_id: member.revision_id,
        visibility_state: member.visibility_state,
        result: member.visibility_state === 'public' ? 'projected' : 'excluded',
        document_refs: [],
        exclusion: member.visibility_state === 'public' ? null : {
          reason_code: member.visibility_state === 'quarantined' ? 'quarantined' : member.visibility_state === 'tombstoned' ? 'tombstoned' : member.visibility_state === 'internal' ? 'internal_only' : 'visibility_excluded',
          evidence_refs: [`evidence:${revision}:visibility:${shortId}`],
          absence_claim_permitted: false
        },
        acknowledged_at: projectedAt,
        immutable: true
      };
      if (member.visibility_state === 'public') {
        const document = {
          projection_version: 'projection-document.v1',
          document_id: `doc:${revision}:${kind}:${shortId}`,
          document_type: kind,
          projection_schema_version: '1.0.0',
          generation_id: generationId,
          projected_at: projectedAt,
          canonical_revisions: [{ canonical_id: member.canonical_id, revision_id: member.revision_id, revision_sha256: member.revision_sha256 }],
          projection_input_refs: [member.revision_id],
          visibility_state: 'public',
          truth_refs: truthRefs(member),
          content: projectionContent(kind, member, buildNumber),
          document_checksum: null,
          source_of_truth: false,
          immutable: true
        };
        document.document_checksum = digest('projection_document', projectionDocumentMaterial(document));
        documents.push(document);
        acknowledgement.document_refs.push({ document_id: document.document_id, document_checksum: digestRef(document.document_checksum) });
      }
      acknowledgements.push(acknowledgement);
    }
  }
  const components = COMPONENT_KINDS.map(kind => {
    const generationId = `gen:${revision}:${kind}`;
    const componentDocuments = documents.filter(item => item.generation_id === generationId);
    const componentAcks = acknowledgements.filter(item => item.generation_id === generationId);
    const component = {
      manifest_version: 'component-generation-manifest.v1',
      generation_id: generationId,
      component_kind: kind,
      sealed_state: 'validated',
      canonical_manifest_ref: { manifest_id: manifest.manifest_id, digest: digestRef(manifest.membership_digest) },
      projector: { version: '1.0.0', fingerprint: sha256Bytes('ushso-projector-v1.0.0') },
      projection_schema_version: '1.0.0',
      build_strategy: 'complete_as_of_exact_revision_manifest',
      document_count: componentDocuments.length,
      acknowledgement_count: componentAcks.length,
      projected_count: componentAcks.filter(item => item.result === 'projected').length,
      excluded_count: componentAcks.filter(item => item.result === 'excluded').length,
      document_refs: componentDocuments.map(item => ({ document_id: item.document_id, document_checksum: digestRef(item.document_checksum) })),
      acknowledgement_ids: componentAcks.map(item => item.acknowledgement_id),
      projection_set_checksum: null,
      component_checksum: null,
      sealed_at: projectedAt,
      retention: {
        retained_until: retainedUntil,
        pin_behavior_before_expiry: 'serve_pinned',
        pin_behavior_after_expiry: 'restart_required',
        physical_expiry_requires_audit: true
      },
      immutable: true
    };
    component.projection_set_checksum = digest('projection_set', projectionSetMaterial(component));
    component.component_checksum = digest('component_generation', componentMaterial(component, componentAcks));
    return component;
  });
  return { documents, acknowledgements, components };
}

function componentRefs(components) {
  return components.map(component => ({
    component_kind: component.component_kind,
    generation_id: component.generation_id,
    manifest_digest: digestRef(component.component_checksum)
  }));
}

function buildReceipt(manifest, components, buildNumber, startedAt, sealedAt, previousPublication) {
  const revision = `r${buildNumber}`;
  const refs = componentRefs(components);
  const counts = {
    canonical_revisions: manifest.revision_count,
    projection_obligations: manifest.projection_obligation_count,
    acknowledgements: components.reduce((total, item) => total + item.acknowledgement_count, 0),
    projected: components.reduce((total, item) => total + item.projected_count, 0),
    excluded: components.reduce((total, item) => total + item.excluded_count, 0),
    documents: components.reduce((total, item) => total + item.document_count, 0)
  };
  const receipt = {
    receipt_version: 'full-snapshot-build-receipt.v1',
    receipt_id: `receipt:full-snapshot:${revision}`,
    build_strategy: 'complete_as_of_exact_revision_manifest',
    candidate_outcome: 'validated',
    canonical_manifest_ref: { manifest_id: manifest.manifest_id, digest: digestRef(manifest.membership_digest) },
    previous_publication_ref: previousPublication ? { publication_id: previousPublication.publication_id, manifest_digest: digestRef(previousPublication.publication_digest) } : null,
    component_generation_refs: refs,
    barriers: BARRIERS.map(barrier => ({ barrier, status: 'passed', evidence_refs: [`verification:${revision}:${barrier}`] })),
    counts,
    degraded_optional_stages: [],
    repeatability: {
      first_build_id: `build:${revision}:a`,
      second_build_id: `build:${revision}:b`,
      first_checksum: ZERO,
      second_checksum: ZERO,
      identical: true
    },
    deterministic_build_checksum: null,
    started_at: startedAt,
    sealed_at: sealedAt,
    immutable: true
  };
  receipt.deterministic_build_checksum = digest('full_snapshot_build', buildMaterial(receipt, components));
  receipt.repeatability.first_checksum = receipt.deterministic_build_checksum.value;
  receipt.repeatability.second_checksum = receipt.deterministic_build_checksum.value;
  return receipt;
}

function legacyManifest() {
  const manifest = {
    manifest_version: 'legacy-static-compatibility-manifest.v1',
    manifest_id: 'legacy:static:v1.1.0',
    mode: 'emergency_static_rollback_only',
    contract_version: '1.0.0',
    worker_version: '1.1.0',
    worker_artifact_sha256: sha256Bytes('worker/retrieval-v1.1.0.mjs'),
    static_corpus: {
      corpus_version: '1.1.0',
      record_count: 157,
      join_route_count: 14,
      manifest_path: 'packages/retrieval/versions/v1.1.0/corpus/corpus.json',
      manifest_sha256: '23f704ce3e421a6eb26c2b3677d616a1ae6b4f45226233257b9a1ff676caba2b',
      content_fingerprint: 'adcfb56babc981a4c7dfc787af86d56f5fb2a31e84de02f9db8c93f0548b5d03',
      as_of: '2026-08-30T00:00:00Z'
    },
    capabilities: {
      search: { availability: 'available', scope: 'pinned_static_corpus_only', absence_claim_permitted: false },
      seo: { availability: 'unknown', reason_code: 'legacy_static_component_unavailable', absence_claim_permitted: false },
      coverage: { availability: 'unknown', reason_code: 'legacy_static_component_unavailable', absence_claim_permitted: false },
      planner: { availability: 'unknown', reason_code: 'legacy_static_component_unavailable', absence_claim_permitted: false }
    },
    truth_boundary: {
      source_of_truth: false,
      analytics_execution: false,
      source_data_retrieval: false,
      identity_merge: false,
      coverage_completeness_claim: false
    },
    verified_at: '2026-08-30T00:00:00Z',
    manifest_digest: null,
    immutable: true
  };
  manifest.manifest_digest = digest('legacy_static_compatibility', legacyMaterial(manifest));
  return manifest;
}

function publication(manifest, components, receipt, buildNumber, sealedAt, rollbackUntil, legacy, previous) {
  const revision = `r${buildNumber}`;
  const value = {
    manifest_version: 'publication-manifest.v1',
    publication_id: `publication:${revision}`,
    contract_version: '1.0.0',
    candidate_state: 'validated',
    canonical_manifest_ref: { manifest_id: manifest.manifest_id, digest: digestRef(manifest.membership_digest) },
    canonical_as_of: manifest.canonical_as_of,
    component_generation_refs: componentRefs(components),
    coverage_snapshot_id: `coverage:snapshot:${revision}`,
    build_receipt_ref: receipt.receipt_id,
    build_receipt_digest: digestRef(receipt.deterministic_build_checksum),
    visibility_policy: {
      policy_version: '1.0.0',
      public_states: ['public'],
      excluded_states: ['excluded', 'quarantined', 'tombstoned', 'internal'],
      absence_claim_permitted_for_exclusions: false
    },
    promotion: {
      eligible: true,
      atomic_pointer_switch_required: true,
      partial_promotion_allowed: false,
      required_barrier_status: 'all_passed'
    },
    rollback: {
      previous_publication_ref: previous ? { publication_id: previous.publication_id, manifest_digest: digestRef(previous.publication_digest) } : null,
      n_minus_one_worker: previous ? { worker_version: '1.0.0', artifact_sha256: sha256Bytes('ushso-public-worker-v1.0.0'), supported_publication_contract: '1.0.0' } : null,
      static_compatibility_ref: { manifest_id: legacy.manifest_id, manifest_digest: digestRef(legacy.manifest_digest) }
    },
    retention: {
      rollback_eligible_until: rollbackUntil,
      minimum_retained_publications: 2,
      pinned_cursor_behavior_after_expiry: 'restart_required'
    },
    publication_digest: null,
    sealed_at: sealedAt,
    immutable: true
  };
  value.publication_digest = digest('publication_manifest', publicationMaterial(value));
  return value;
}

function generationEvents(components, buildNumber, baseDate, retired) {
  const revision = `r${buildNumber}`;
  const states = retired
    ? [['building', 'build_started', 'unavailable'], ['validated', 'validation_passed', 'unavailable'], ['published', 'atomic_promotion', 'serve_pinned'], ['retired', 'superseded', 'serve_pinned']]
    : [['building', 'build_started', 'unavailable'], ['validated', 'validation_passed', 'unavailable'], ['published', 'atomic_promotion', 'serve_pinned']];
  return components.flatMap((component, componentIndex) => {
    let from = null;
    return states.map(([to, reason, pin], stateIndex) => {
      const event = {
        event_version: 'generation-state-event.v1',
        event_id: `generation-event:${revision}:${component.component_kind}:${to}`,
        generation_id: component.generation_id,
        component_kind: component.component_kind,
        from_state: from,
        to_state: to,
        occurred_at: `${baseDate}T00:${String(componentIndex * 4 + stateIndex).padStart(2, '0')}:00Z`,
        reason_code: reason,
        transaction_id: to === 'published'
          ? `transaction:publication:${buildNumber}`
          : to === 'retired'
            ? `transaction:publication:${buildNumber + 1}`
            : `transaction:${revision}:${to}`,
        pin_behavior: pin,
        append_only: true
      };
      from = to;
      return event;
    });
  });
}

function publicationRef(value) {
  return { publication_id: value.publication_id, manifest_digest: digestRef(value.publication_digest) };
}

function adversarialCases(bundle) {
  const currentManifest = bundle.canonical_manifests[1];
  const priorDigest = bundle.canonical_manifests[0].membership_digest.value;
  const publicAckIndex = bundle.acknowledgements.findIndex(item => item.canonical_manifest_id === currentManifest.manifest_id && item.canonical_id === 'ushso:asset:alpha' && item.component_kind === 'asset_search');
  const quarantinedAckIndex = bundle.acknowledgements.findIndex(item => item.canonical_manifest_id === currentManifest.manifest_id && item.canonical_id === 'ushso:asset:quarantined');
  const publicAck = bundle.acknowledgements[publicAckIndex];
  const publicDocumentRef = publicAck.document_refs[0];
  const currentAssetComponentIndex = bundle.component_manifests.findIndex(item => item.generation_id === 'gen:r2:asset_search');
  const priorAssetComponentIndex = bundle.component_manifests.findIndex(item => item.generation_id === 'gen:r1:asset_search');
  const currentCoverageDocumentIndex = bundle.projection_documents.findIndex(item => item.generation_id === 'gen:r2:coverage');
  const priorRetiredEventIndex = bundle.generation_history.findIndex(item => item.generation_id === 'gen:r1:asset_search' && item.to_state === 'retired');
  const currentBuildIndex = 1;
  const currentPublicationIndex = 1;
  return {
    fixture_version: 'publication-adversarial-cases.v1',
    base_fixture: 'fixtures/valid-publication.json',
    cases: [
      { case_id: 'adversarial:w1-unsorted', description: 'The exact revision manifest cannot change member order.', mutations: [{ op: 'swap', path: '/canonical_manifests/1/members', left: 0, right: 1 }], expected_code: 'CANONICAL_MEMBERSHIP_NOT_SORTED' },
      { case_id: 'adversarial:w1-duplicate-object', description: 'A W1 manifest cannot pin two revisions of one canonical object.', mutations: [{ op: 'set', path: '/canonical_manifests/1/members/1/canonical_id', value: currentManifest.members[0].canonical_id }], expected_code: 'MULTIPLE_REVISIONS_FOR_CANONICAL_OBJECT' },
      { case_id: 'adversarial:w1-digest', description: 'A changed membership digest fails exact revision verification.', mutations: [{ op: 'set', path: '/canonical_manifests/1/membership_digest/value', value: ZERO }], expected_code: 'CANONICAL_MEMBERSHIP_DIGEST_MISMATCH' },
      { case_id: 'adversarial:component-missing', description: 'A candidate cannot omit any required publication component.', mutations: [{ op: 'delete', path: '/build_receipts/1/component_generation_refs/6' }], expected_code: 'SCHEMA_INVALID' },
      { case_id: 'adversarial:ack-missing', description: 'Every exact projection obligation requires one acknowledgement.', mutations: [{ op: 'delete', path: `/acknowledgements/${publicAckIndex}` }], expected_code: 'UNRESOLVED_ACKNOWLEDGEMENT_REFERENCE' },
      { case_id: 'adversarial:public-excluded', description: 'A public eligible revision cannot be silently excluded.', mutations: [
        { op: 'set', path: `/acknowledgements/${publicAckIndex}/result`, value: 'excluded' },
        { op: 'set', path: `/acknowledgements/${publicAckIndex}/document_refs`, value: [] },
        { op: 'set', path: `/acknowledgements/${publicAckIndex}/exclusion`, value: { reason_code: 'visibility_excluded', evidence_refs: ['evidence:r2:bad-exclusion'], absence_claim_permitted: false } }
      ], expected_code: 'PUBLIC_REVISION_NOT_PROJECTED' },
      { case_id: 'adversarial:quarantine-projected', description: 'A quarantined revision cannot produce a public document.', mutations: [
        { op: 'set', path: `/acknowledgements/${quarantinedAckIndex}/result`, value: 'projected' },
        { op: 'set', path: `/acknowledgements/${quarantinedAckIndex}/document_refs`, value: [publicDocumentRef] },
        { op: 'set', path: `/acknowledgements/${quarantinedAckIndex}/exclusion`, value: null }
      ], expected_code: 'NONPUBLIC_REVISION_PROJECTED' },
      { case_id: 'adversarial:document-checksum', description: 'Projection document content is protected by a deterministic checksum.', mutations: [{ op: 'set', path: '/projection_documents/7/document_checksum/value', value: ZERO }], expected_code: 'PROJECTION_DOCUMENT_CHECKSUM_MISMATCH' },
      { case_id: 'adversarial:component-checksum', description: 'A sealed component checksum cannot be substituted.', mutations: [{ op: 'set', path: `/component_manifests/${currentAssetComponentIndex}/component_checksum/value`, value: ZERO }], expected_code: 'COMPONENT_CHECKSUM_MISMATCH' },
      { case_id: 'adversarial:component-w1', description: 'All component generations must pin the same exact W1.', mutations: [{ op: 'set', path: `/component_manifests/${currentAssetComponentIndex}/canonical_manifest_ref/digest/value`, value: priorDigest }], expected_code: 'COMPONENT_W1_MISMATCH' },
      { case_id: 'adversarial:barrier-failed', description: 'A failed required barrier blocks validated publication.', mutations: [{ op: 'set', path: '/build_receipts/1/barriers/0/status', value: 'failed' }], expected_code: 'VALIDATED_BUILD_HAS_FAILED_BARRIER' },
      { case_id: 'adversarial:rejected-promoted', description: 'A rejected full snapshot cannot be promoted partially.', mutations: [{ op: 'set', path: '/build_receipts/1/candidate_outcome', value: 'rejected' }], expected_code: 'PARTIAL_OR_FAILED_BUILD_PROMOTION' },
      { case_id: 'adversarial:pointer-active', description: 'The active pointer must resolve the exact active manifest digest.', mutations: [{ op: 'set', path: '/pointer/active_publication_ref/manifest_digest/value', value: ZERO }], expected_code: 'ACTIVE_POINTER_PUBLICATION_UNRESOLVED' },
      { case_id: 'adversarial:pointer-nonatomic', description: 'Publication pointer promotion is always one atomic commit.', mutations: [{ op: 'set', path: '/pointer/atomic_commit', value: false }], expected_code: 'SCHEMA_INVALID' },
      { case_id: 'adversarial:n-minus-one-retention', description: 'Prior generations remain retained for the active rollback window.', mutations: [{ op: 'set', path: `/component_manifests/${priorAssetComponentIndex}/retention/retained_until`, value: '2026-10-15T00:00:00Z' }], expected_code: 'N_MINUS_ONE_RETENTION_TOO_SHORT' },
      { case_id: 'adversarial:expired-pin-served', description: 'A pin at or beyond expiry returns restart_required.', mutations: [{ op: 'set', path: '/pin_resolution_cases/2/expected_result', value: 'serve_pinned' }], expected_code: 'PIN_RESOLUTION_RESULT_INVALID' },
      { case_id: 'adversarial:legacy-coverage-fabricated', description: 'The static fallback cannot fabricate a coverage component.', mutations: [{ op: 'set', path: '/legacy_static_manifest/capabilities/coverage/availability', value: 'available' }], expected_code: 'SCHEMA_INVALID' },
      { case_id: 'adversarial:legacy-absence', description: 'Unknown static capabilities never permit an absence claim.', mutations: [{ op: 'set', path: '/legacy_static_manifest/capabilities/seo/absence_claim_permitted', value: true }], expected_code: 'SCHEMA_INVALID' },
      { case_id: 'adversarial:static-pin', description: 'Every publication must resolve the exact static fallback manifest.', mutations: [{ op: 'set', path: '/publication_manifests/1/rollback/static_compatibility_ref/manifest_digest/value', value: ZERO }], expected_code: 'STATIC_ROLLBACK_PIN_UNRESOLVED' },
      { case_id: 'adversarial:publication-digest', description: 'The coherent publication pin set is immutable and checksummed.', mutations: [{ op: 'set', path: '/publication_manifests/1/publication_digest/value', value: ZERO }], expected_code: 'PUBLICATION_MANIFEST_DIGEST_MISMATCH' },
      { case_id: 'adversarial:incremental-strategy', description: 'This contract freezes the complete as-of-W1 full snapshot strategy.', mutations: [{ op: 'set', path: '/build_receipts/1/build_strategy', value: 'incremental_replay' }], expected_code: 'SCHEMA_INVALID' },
      { case_id: 'adversarial:generation-transition', description: 'Generation lifecycle transitions fail closed.', mutations: [{ op: 'set', path: '/generation_history/28/to_state', value: 'validated' }], expected_code: 'INVALID_GENERATION_TRANSITION' },
      { case_id: 'adversarial:history-transaction', description: 'Pointer and append-only history share one transaction identity.', mutations: [{ op: 'set', path: '/pointer/transaction_id', value: 'transaction:wrong' }], expected_code: 'POINTER_HISTORY_ATOMIC_MISMATCH' },
      { case_id: 'adversarial:duplicate-component-kind', description: 'A publication cannot replace coverage with a duplicate search component.', mutations: [{ op: 'set', path: '/publication_manifests/1/component_generation_refs/6/component_kind', value: 'asset_search' }], expected_code: 'PUBLICATION_COMPONENT_SET_INCOMPLETE' },
      { case_id: 'adversarial:unresolved-document', description: 'Every component document reference must resolve.', mutations: [{ op: 'set', path: `/projection_documents/${currentCoverageDocumentIndex}/document_id`, value: 'doc:r2:coverage:changed' }], expected_code: 'UNRESOLVED_PROJECTION_DOCUMENT_REFERENCE' },
      { case_id: 'adversarial:repeatability', description: 'Two same-input full builds must have identical checksums.', mutations: [{ op: 'set', path: `/build_receipts/${currentBuildIndex}/repeatability/second_checksum`, value: ONE }], expected_code: 'BUILD_REPEATABILITY_MISMATCH' },
      { case_id: 'adversarial:partial-promotion-flag', description: 'No contract may authorize partial publication.', mutations: [{ op: 'set', path: `/publication_manifests/${currentPublicationIndex}/promotion/partial_promotion_allowed`, value: true }], expected_code: 'SCHEMA_INVALID' },
      { case_id: 'adversarial:retired-pin-behavior', description: 'A retained retired generation remains serveable until expiry.', mutations: [{ op: 'set', path: `/generation_history/${priorRetiredEventIndex}/pin_behavior`, value: 'restart_required' }], expected_code: 'GENERATION_EVENT_PIN_BEHAVIOR_INVALID' },
      { case_id: 'adversarial:analytic-content', description: 'Search projections cannot contain computed analytical output.', mutations: [{ op: 'set', path: '/projection_documents/7/content/computed_values', value: { market: 42 } }], expected_code: 'PROJECTION_CONTENT_PRODUCT_BOUNDARY_VIOLATION' }
    ]
  };
}

export async function buildFixtures() {
  const taxonomy = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'digest-taxonomy.json'));
  const legacy = legacyManifest();
  const w1Prior = canonicalManifest(1, '2026-08-01T00:00:00Z', '2026-08-01T00:01:00Z');
  const priorBuild = buildComponents(w1Prior, 1, '2026-08-01T00:05:00Z', '2027-01-01T00:00:00Z');
  const priorReceipt = buildReceipt(w1Prior, priorBuild.components, 1, '2026-08-01T00:02:00Z', '2026-08-01T00:08:00Z', null);
  const priorPublication = publication(w1Prior, priorBuild.components, priorReceipt, 1, '2026-08-01T00:10:00Z', '2026-09-30T00:00:00Z', legacy, null);
  const w1Current = canonicalManifest(2, '2026-08-30T00:00:00Z', '2026-08-30T00:01:00Z');
  const currentBuild = buildComponents(w1Current, 2, '2026-08-30T00:05:00Z', '2027-02-01T00:00:00Z');
  const currentReceipt = buildReceipt(w1Current, currentBuild.components, 2, '2026-08-30T00:02:00Z', '2026-08-30T00:08:00Z', priorPublication);
  const currentPublication = publication(w1Current, currentBuild.components, currentReceipt, 2, '2026-08-30T00:10:00Z', '2026-11-30T00:00:00Z', legacy, priorPublication);
  const history = {
    history_version: 'publication-history.v1',
    events: [
      { event_id: 'publication-history:1', sequence: 1, action: 'promote', from_publication_ref: null, to_publication_ref: publicationRef(priorPublication), occurred_at: '2026-08-01T00:11:00Z', transaction_id: 'transaction:publication:1', atomic_commit: true, actor_kind: 'projector', reason_code: 'all_gates_passed' },
      { event_id: 'publication-history:2', sequence: 2, action: 'promote', from_publication_ref: publicationRef(priorPublication), to_publication_ref: publicationRef(currentPublication), occurred_at: '2026-08-30T00:11:00Z', transaction_id: 'transaction:publication:2', atomic_commit: true, actor_kind: 'projector', reason_code: 'all_gates_passed' }
    ],
    append_only: true
  };
  const pointer = {
    pointer_version: 'publication-pointer.v1',
    pointer_id: 'ushso:publication:active',
    sequence: 2,
    active_publication_ref: publicationRef(currentPublication),
    previous_publication_ref: publicationRef(priorPublication),
    switched_at: history.events[1].occurred_at,
    history_event_id: history.events[1].event_id,
    transaction_id: history.events[1].transaction_id,
    atomic_commit: true,
    cache_policy: { pointer_lookup: 'cache_disabled', immutable_generation_reads: 'cache_allowed', cache_key_includes_all_publication_ids: true }
  };
  const bundle = {
    fixture_version: 'publication-fixture.v1',
    fixture_clock: '2026-08-30T12:00:00Z',
    digest_taxonomy: taxonomy,
    canonical_manifests: [w1Prior, w1Current],
    projection_documents: [...priorBuild.documents, ...currentBuild.documents],
    acknowledgements: [...priorBuild.acknowledgements, ...currentBuild.acknowledgements],
    component_manifests: [...priorBuild.components, ...currentBuild.components],
    generation_history: [...generationEvents(priorBuild.components, 1, '2026-08-01', true), ...generationEvents(currentBuild.components, 2, '2026-08-30', false)],
    pin_resolution_cases: [
      { case_id: 'pin:retired-before-expiry', generation_id: 'gen:r1:asset_search', observed_at: '2026-12-31T23:59:59Z', expected_result: 'serve_pinned' },
      { case_id: 'pin:retired-at-expiry', generation_id: 'gen:r1:asset_search', observed_at: '2027-01-01T00:00:00Z', expected_result: 'restart_required' },
      { case_id: 'pin:retired-after-expiry', generation_id: 'gen:r1:asset_search', observed_at: '2027-01-02T00:00:00Z', expected_result: 'restart_required' }
    ],
    build_receipts: [priorReceipt, currentReceipt],
    publication_manifests: [priorPublication, currentPublication],
    pointer,
    publication_history: history,
    legacy_static_manifest: legacy
  };
  const adversarial = adversarialCases(bundle);
  await writeJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-publication.json'), bundle);
  await writeJson(path.join(PACKAGE_ROOT, 'fixtures', 'adversarial-cases.json'), adversarial);
  return { bundle, adversarial };
}

if (process.argv[1]?.endsWith('build-fixtures.mjs')) {
  buildFixtures()
    .then(({ bundle, adversarial }) => process.stdout.write(`${JSON.stringify({ canonical_manifests: bundle.canonical_manifests.length, component_manifests: bundle.component_manifests.length, projection_documents: bundle.projection_documents.length, acknowledgements: bundle.acknowledgements.length, adversarial_cases: adversarial.cases.length }, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
