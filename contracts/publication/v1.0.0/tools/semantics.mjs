import {
  BARRIERS,
  COMPONENT_KINDS,
  DOMAIN_PREFIX,
  buildMaterial,
  canonicalDigestValue,
  compareUnicodeCodePoints,
  componentMaterial,
  legacyMaterial,
  membershipMaterial,
  projectionDocumentMaterial,
  projectionSetMaterial,
  publicationMaterial
} from './common.mjs';

function issue(errors, code, detail) {
  errors.push({ code, detail });
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareUnicodeCodePoints);
}

function compareMember(left, right) {
  const leftKey = `${left.canonical_id}\u0000${left.revision_id}`;
  const rightKey = `${right.canonical_id}\u0000${right.revision_id}`;
  return compareUnicodeCodePoints(leftKey, rightKey);
}

const FORBIDDEN_PROJECTION_CONTENT_KEYS = new Set([
  'analysis_result',
  'computed_values',
  'data_rows',
  'financial_benchmark',
  'market_share',
  'payload_bytes',
  'ranking_output',
  'row_values',
  'source_payload'
]);

function forbiddenContentPath(value, path = '/content') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = forbiddenContentPath(value[index], `${path}/${index}`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PROJECTION_CONTENT_KEYS.has(key)) return `${path}/${key}`;
    const found = forbiddenContentPath(child, `${path}/${key}`);
    if (found) return found;
  }
  return null;
}

function verifyDigest(errors, code, digest, domain, material, detail) {
  const expected = canonicalDigestValue(domain, material);
  if (digest?.domain !== domain || digest?.value !== expected) issue(errors, code, `${detail}:${expected}:${digest?.value ?? 'missing'}`);
}

function refMatches(ref, id, digest) {
  return ref?.manifest_id === id && ref?.digest?.value === digest?.value && ref?.digest?.domain === digest?.domain;
}

function publicationRefMatches(ref, publication) {
  return ref?.publication_id === publication?.publication_id && ref?.manifest_digest?.value === publication?.publication_digest?.value;
}

function isoAtOrAfter(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left >= right;
}

function validateTaxonomy(bundle, errors) {
  const taxonomy = bundle.digest_taxonomy;
  const expectedNames = Object.keys(DOMAIN_PREFIX).sort();
  const names = taxonomy.domains.map(item => item.name).sort();
  if (!same(names, expectedNames)) issue(errors, 'DIGEST_TAXONOMY_DOMAIN_SET_MISMATCH', names.join(','));
  for (const domain of taxonomy.domains) {
    if (DOMAIN_PREFIX[domain.name] !== domain.prefix) issue(errors, 'DIGEST_TAXONOMY_PREFIX_MISMATCH', domain.name);
  }
}

function validateCanonicalManifests(bundle, errors) {
  const seenManifestIds = new Set();
  for (const manifest of bundle.canonical_manifests) {
    if (seenManifestIds.has(manifest.manifest_id)) issue(errors, 'DUPLICATE_CANONICAL_MANIFEST_ID', manifest.manifest_id);
    seenManifestIds.add(manifest.manifest_id);
    if (manifest.revision_count !== manifest.members.length) issue(errors, 'CANONICAL_REVISION_COUNT_MISMATCH', manifest.manifest_id);
    const obligationCount = manifest.members.reduce((total, member) => total + member.projection_obligations.length, 0);
    if (manifest.projection_obligation_count !== obligationCount) issue(errors, 'PROJECTION_OBLIGATION_COUNT_MISMATCH', manifest.manifest_id);
    if (!same(manifest.members, [...manifest.members].sort(compareMember))) issue(errors, 'CANONICAL_MEMBERSHIP_NOT_SORTED', manifest.manifest_id);
    const canonicalIds = manifest.members.map(member => member.canonical_id);
    if (new Set(canonicalIds).size !== canonicalIds.length) issue(errors, 'MULTIPLE_REVISIONS_FOR_CANONICAL_OBJECT', manifest.manifest_id);
    const revisionIds = manifest.members.map(member => member.revision_id);
    if (new Set(revisionIds).size !== revisionIds.length) issue(errors, 'DUPLICATE_CANONICAL_REVISION_ID', manifest.manifest_id);
    for (const member of manifest.members) {
      if (!same(member.projection_obligations, sortedUnique(member.projection_obligations))) issue(errors, 'PROJECTION_OBLIGATIONS_NOT_SORTED_UNIQUE', `${manifest.manifest_id}:${member.canonical_id}`);
    }
    if (!isoAtOrAfter(manifest.sealed_at, manifest.canonical_as_of)) issue(errors, 'W1_SEALED_BEFORE_AS_OF', manifest.manifest_id);
    verifyDigest(errors, 'CANONICAL_MEMBERSHIP_DIGEST_MISMATCH', manifest.membership_digest, 'canonical_revision_membership', membershipMaterial(manifest), manifest.manifest_id);
  }
}

function validateDocuments(bundle, errors) {
  const ids = new Set();
  for (const document of bundle.projection_documents) {
    if (ids.has(document.document_id)) issue(errors, 'DUPLICATE_PROJECTION_DOCUMENT_ID', document.document_id);
    ids.add(document.document_id);
    const forbidden = forbiddenContentPath(document.content);
    if (forbidden) issue(errors, 'PROJECTION_CONTENT_PRODUCT_BOUNDARY_VIOLATION', `${document.document_id}:${forbidden}`);
    const truthRefCount = Object.values(document.truth_refs).reduce((total, refs) => total + refs.length, 0);
    if (truthRefCount === 0) issue(errors, 'PROJECTION_TRUTH_REFERENCES_EMPTY', document.document_id);
    verifyDigest(errors, 'PROJECTION_DOCUMENT_CHECKSUM_MISMATCH', document.document_checksum, 'projection_document', projectionDocumentMaterial(document), document.document_id);
  }
}

function validateComponents(bundle, errors) {
  const canonicalManifests = new Map(bundle.canonical_manifests.map(item => [item.manifest_id, item]));
  const documents = new Map(bundle.projection_documents.map(item => [item.document_id, item]));
  const acknowledgements = new Map(bundle.acknowledgements.map(item => [item.acknowledgement_id, item]));
  if (acknowledgements.size !== bundle.acknowledgements.length) issue(errors, 'DUPLICATE_ACKNOWLEDGEMENT_ID', 'bundle');
  const generations = new Set();
  for (const component of bundle.component_manifests) {
    if (generations.has(component.generation_id)) issue(errors, 'DUPLICATE_GENERATION_ID', component.generation_id);
    generations.add(component.generation_id);
    if (component.document_count !== component.document_refs.length) issue(errors, 'COMPONENT_DOCUMENT_COUNT_MISMATCH', component.generation_id);
    if (component.acknowledgement_count !== component.acknowledgement_ids.length) issue(errors, 'COMPONENT_ACK_COUNT_MISMATCH', component.generation_id);
    if (component.projected_count + component.excluded_count !== component.acknowledgement_count) issue(errors, 'COMPONENT_OUTCOME_COUNT_MISMATCH', component.generation_id);
    const componentAcks = component.acknowledgement_ids.map(id => acknowledgements.get(id)).filter(Boolean);
    if (componentAcks.length !== component.acknowledgement_ids.length) issue(errors, 'UNRESOLVED_ACKNOWLEDGEMENT_REFERENCE', component.generation_id);
    const projected = componentAcks.filter(item => item.result === 'projected').length;
    const excluded = componentAcks.filter(item => item.result === 'excluded').length;
    if (projected !== component.projected_count || excluded !== component.excluded_count) issue(errors, 'COMPONENT_ACK_OUTCOME_MISMATCH', component.generation_id);
    for (const acknowledgement of componentAcks) {
      if (acknowledgement.generation_id !== component.generation_id || acknowledgement.component_kind !== component.component_kind) issue(errors, 'ACKNOWLEDGEMENT_COMPONENT_MISMATCH', acknowledgement.acknowledgement_id);
    }
    const componentDocuments = [];
    const canonical = canonicalManifests.get(component.canonical_manifest_ref.manifest_id);
    for (const ref of component.document_refs) {
      const document = documents.get(ref.document_id);
      if (!document) { issue(errors, 'UNRESOLVED_PROJECTION_DOCUMENT_REFERENCE', `${component.generation_id}:${ref.document_id}`); continue; }
      componentDocuments.push(document);
      if (document.generation_id !== component.generation_id || document.document_type !== component.component_kind) issue(errors, 'PROJECTION_DOCUMENT_COMPONENT_MISMATCH', ref.document_id);
      if (ref.document_checksum.value !== document.document_checksum.value) issue(errors, 'PROJECTION_DOCUMENT_REFERENCE_CHECKSUM_MISMATCH', ref.document_id);
      const documentRevisionKeys = new Set();
      for (const revision of document.canonical_revisions) {
        const key = `${revision.canonical_id}\u0000${revision.revision_id}`;
        if (documentRevisionKeys.has(key)) issue(errors, 'PROJECTION_DOCUMENT_DUPLICATE_CANONICAL_REVISION', ref.document_id);
        documentRevisionKeys.add(key);
        const member = canonical?.members.find(item => item.canonical_id === revision.canonical_id && item.revision_id === revision.revision_id && item.revision_sha256 === revision.revision_sha256);
        if (!member) issue(errors, 'PROJECTION_DOCUMENT_W1_REVISION_UNRESOLVED', `${ref.document_id}:${key}`);
        else if (member.visibility_state !== 'public') issue(errors, 'PROJECTION_DOCUMENT_NONPUBLIC_REVISION', `${ref.document_id}:${key}`);
      }
    }
    const referencedIds = sortedUnique(componentAcks.flatMap(item => item.document_refs.map(ref => ref.document_id)));
    const componentIds = sortedUnique(component.document_refs.map(ref => ref.document_id));
    if (!same(referencedIds, componentIds)) issue(errors, 'COMPONENT_DOCUMENT_ACK_SET_MISMATCH', component.generation_id);
    verifyDigest(errors, 'PROJECTION_SET_CHECKSUM_MISMATCH', component.projection_set_checksum, 'projection_set', projectionSetMaterial(component), component.generation_id);
    verifyDigest(errors, 'COMPONENT_CHECKSUM_MISMATCH', component.component_checksum, 'component_generation', componentMaterial(component, componentAcks), component.generation_id);
    if (!isoAtOrAfter(component.retention.retained_until, component.sealed_at)) issue(errors, 'COMPONENT_RETENTION_BEFORE_SEAL', component.generation_id);
  }
}

function validateBuilds(bundle, errors) {
  const canonicalManifests = new Map(bundle.canonical_manifests.map(item => [item.manifest_id, item]));
  const components = new Map(bundle.component_manifests.map(item => [item.generation_id, item]));
  const documents = new Map(bundle.projection_documents.map(item => [item.document_id, item]));
  const receiptIds = new Set();
  for (const receipt of bundle.build_receipts) {
    if (receiptIds.has(receipt.receipt_id)) issue(errors, 'DUPLICATE_BUILD_RECEIPT_ID', receipt.receipt_id);
    receiptIds.add(receipt.receipt_id);
    const canonical = canonicalManifests.get(receipt.canonical_manifest_ref.manifest_id);
    if (!canonical || !refMatches(receipt.canonical_manifest_ref, canonical.manifest_id, canonical.membership_digest)) {
      issue(errors, 'UNRESOLVED_CANONICAL_MANIFEST_REFERENCE', receipt.receipt_id);
      continue;
    }
    const componentKinds = receipt.component_generation_refs.map(ref => ref.component_kind).sort();
    if (!same(componentKinds, [...COMPONENT_KINDS].sort())) issue(errors, 'COMPONENT_SET_INCOMPLETE', receipt.receipt_id);
    const receiptComponents = [];
    for (const ref of receipt.component_generation_refs) {
      const component = components.get(ref.generation_id);
      if (!component || component.component_kind !== ref.component_kind || component.component_checksum.value !== ref.manifest_digest.value) {
        issue(errors, 'UNRESOLVED_COMPONENT_GENERATION_REFERENCE', `${receipt.receipt_id}:${ref.generation_id}`);
        continue;
      }
      receiptComponents.push(component);
      if (!refMatches(component.canonical_manifest_ref, canonical.manifest_id, canonical.membership_digest)) issue(errors, 'COMPONENT_W1_MISMATCH', component.generation_id);
    }
    const barrierNames = receipt.barriers.map(item => item.barrier).sort();
    if (!same(barrierNames, [...BARRIERS].sort())) issue(errors, 'BUILD_BARRIER_SET_INCOMPLETE', receipt.receipt_id);
    if (receipt.candidate_outcome === 'validated' && receipt.barriers.some(item => item.status !== 'passed')) issue(errors, 'VALIDATED_BUILD_HAS_FAILED_BARRIER', receipt.receipt_id);
    const componentByKind = new Map(receiptComponents.map(item => [item.component_kind, item]));
    let projected = 0;
    let excluded = 0;
    let documentsCount = 0;
    const expectedAckIds = new Set();
    for (const member of canonical.members) {
      for (const kind of member.projection_obligations) {
        const component = componentByKind.get(kind);
        if (!component) continue;
        const candidates = bundle.acknowledgements.filter(item => item.generation_id === component.generation_id && item.canonical_id === member.canonical_id && item.revision_id === member.revision_id && item.component_kind === kind);
        if (candidates.length !== 1) { issue(errors, 'PROJECTION_OBLIGATION_ACK_COUNT_INVALID', `${receipt.receipt_id}:${member.canonical_id}:${kind}:${candidates.length}`); continue; }
        const acknowledgement = candidates[0];
        expectedAckIds.add(acknowledgement.acknowledgement_id);
        if (acknowledgement.canonical_manifest_id !== canonical.manifest_id || acknowledgement.visibility_state !== member.visibility_state) issue(errors, 'ACKNOWLEDGEMENT_CANONICAL_MISMATCH', acknowledgement.acknowledgement_id);
        if (member.visibility_state === 'public') {
          if (acknowledgement.result !== 'projected') issue(errors, 'PUBLIC_REVISION_NOT_PROJECTED', acknowledgement.acknowledgement_id);
          projected += 1;
        } else {
          if (acknowledgement.result !== 'excluded') issue(errors, 'NONPUBLIC_REVISION_PROJECTED', acknowledgement.acknowledgement_id);
          excluded += 1;
        }
        for (const ref of acknowledgement.document_refs) {
          const document = documents.get(ref.document_id);
          if (!document) continue;
          const canonicalRef = document.canonical_revisions.find(item => item.canonical_id === member.canonical_id && item.revision_id === member.revision_id && item.revision_sha256 === member.revision_sha256);
          if (!canonicalRef) issue(errors, 'PROJECTION_DOCUMENT_CANONICAL_REVISION_MISMATCH', ref.document_id);
        }
      }
    }
    const receiptAckIds = new Set(receiptComponents.flatMap(component => component.acknowledgement_ids));
    if (!same([...expectedAckIds].sort(), [...receiptAckIds].sort())) issue(errors, 'BUILD_ACKNOWLEDGEMENT_SET_MISMATCH', receipt.receipt_id);
    documentsCount = receiptComponents.reduce((total, component) => total + component.document_count, 0);
    const expectedCounts = {
      canonical_revisions: canonical.revision_count,
      projection_obligations: canonical.projection_obligation_count,
      acknowledgements: projected + excluded,
      projected,
      excluded,
      documents: documentsCount
    };
    if (!same(receipt.counts, expectedCounts)) issue(errors, 'BUILD_COUNTS_MISMATCH', receipt.receipt_id);
    const buildDigest = canonicalDigestValue('full_snapshot_build', buildMaterial(receipt, receiptComponents));
    if (receipt.deterministic_build_checksum.value !== buildDigest) issue(errors, 'BUILD_CHECKSUM_MISMATCH', receipt.receipt_id);
    if (receipt.repeatability.first_checksum !== buildDigest || receipt.repeatability.second_checksum !== buildDigest) issue(errors, 'BUILD_REPEATABILITY_MISMATCH', receipt.receipt_id);
  }
}

function validatePublications(bundle, errors) {
  const canonicalManifests = new Map(bundle.canonical_manifests.map(item => [item.manifest_id, item]));
  const components = new Map(bundle.component_manifests.map(item => [item.generation_id, item]));
  const receipts = new Map(bundle.build_receipts.map(item => [item.receipt_id, item]));
  const publications = new Map(bundle.publication_manifests.map(item => [item.publication_id, item]));
  const legacy = bundle.legacy_static_manifest;
  verifyDigest(errors, 'LEGACY_STATIC_MANIFEST_DIGEST_MISMATCH', legacy.manifest_digest, 'legacy_static_compatibility', legacyMaterial(legacy), legacy.manifest_id);
  for (const field of ['seo', 'coverage', 'planner']) {
    const capability = legacy.capabilities[field];
    if (capability.availability !== 'unknown' || capability.absence_claim_permitted !== false) issue(errors, 'LEGACY_UNKNOWN_CAPABILITY_FABRICATED', field);
  }
  for (const publication of bundle.publication_manifests) {
    const canonical = canonicalManifests.get(publication.canonical_manifest_ref.manifest_id);
    if (!canonical || !refMatches(publication.canonical_manifest_ref, canonical.manifest_id, canonical.membership_digest)) issue(errors, 'PUBLICATION_W1_UNRESOLVED', publication.publication_id);
    else if (publication.canonical_as_of !== canonical.canonical_as_of) issue(errors, 'PUBLICATION_AS_OF_MISMATCH', publication.publication_id);
    const kinds = publication.component_generation_refs.map(ref => ref.component_kind).sort();
    if (!same(kinds, [...COMPONENT_KINDS].sort())) issue(errors, 'PUBLICATION_COMPONENT_SET_INCOMPLETE', publication.publication_id);
    const publicationComponents = [];
    for (const ref of publication.component_generation_refs) {
      const component = components.get(ref.generation_id);
      if (!component || component.component_kind !== ref.component_kind || component.component_checksum.value !== ref.manifest_digest.value) {
        issue(errors, 'PUBLICATION_COMPONENT_PIN_UNRESOLVED', `${publication.publication_id}:${ref.generation_id}`);
        continue;
      }
      publicationComponents.push(component);
      if (canonical && !refMatches(component.canonical_manifest_ref, canonical.manifest_id, canonical.membership_digest)) issue(errors, 'PUBLICATION_COMPONENT_W1_MISMATCH', component.generation_id);
      if (!isoAtOrAfter(component.retention.retained_until, publication.retention.rollback_eligible_until)) issue(errors, 'ROLLBACK_COMPONENT_RETENTION_TOO_SHORT', `${publication.publication_id}:${component.generation_id}`);
    }
    const receipt = receipts.get(publication.build_receipt_ref);
    if (!receipt || receipt.deterministic_build_checksum.value !== publication.build_receipt_digest.value) issue(errors, 'PUBLICATION_BUILD_RECEIPT_UNRESOLVED', publication.publication_id);
    else {
      if (receipt.candidate_outcome !== 'validated' || receipt.barriers.some(item => item.status !== 'passed')) issue(errors, 'PARTIAL_OR_FAILED_BUILD_PROMOTION', publication.publication_id);
      const receiptRefs = receipt.component_generation_refs.map(ref => `${ref.component_kind}:${ref.generation_id}:${ref.manifest_digest.value}`).sort();
      const publicationRefs = publication.component_generation_refs.map(ref => `${ref.component_kind}:${ref.generation_id}:${ref.manifest_digest.value}`).sort();
      if (!same(receiptRefs, publicationRefs)) issue(errors, 'PUBLICATION_BUILD_COMPONENT_MISMATCH', publication.publication_id);
      const rollbackPrevious = publication.rollback.previous_publication_ref;
      if (rollbackPrevious === null ? receipt.previous_publication_ref !== null : !publicationRefMatches(receipt.previous_publication_ref, publications.get(rollbackPrevious.publication_id))) {
        issue(errors, 'PUBLICATION_BUILD_PREVIOUS_MISMATCH', publication.publication_id);
      }
    }
    const coverageComponent = publicationComponents.find(item => item.component_kind === 'coverage');
    const coverageDocuments = coverageComponent ? coverageComponent.document_refs.map(ref => bundle.projection_documents.find(item => item.document_id === ref.document_id)).filter(Boolean) : [];
    if (!coverageDocuments.some(document => document.content.coverage_snapshot_id === publication.coverage_snapshot_id)) issue(errors, 'COVERAGE_SNAPSHOT_PIN_UNRESOLVED', publication.publication_id);
    const excluded = [...publication.visibility_policy.excluded_states].sort();
    if (!same(excluded, ['excluded', 'internal', 'quarantined', 'tombstoned'])) issue(errors, 'VISIBILITY_EXCLUSION_SET_INCOMPLETE', publication.publication_id);
    if (publication.rollback.static_compatibility_ref.manifest_id !== legacy.manifest_id || publication.rollback.static_compatibility_ref.manifest_digest.value !== legacy.manifest_digest.value) issue(errors, 'STATIC_ROLLBACK_PIN_UNRESOLVED', publication.publication_id);
    const previousRef = publication.rollback.previous_publication_ref;
    if (previousRef !== null) {
      const previous = publications.get(previousRef.publication_id);
      if (!previous || !publicationRefMatches(previousRef, previous)) issue(errors, 'N_MINUS_ONE_PUBLICATION_PIN_UNRESOLVED', publication.publication_id);
      if (!publication.rollback.n_minus_one_worker) issue(errors, 'N_MINUS_ONE_WORKER_PIN_MISSING', publication.publication_id);
      if (previous) {
        for (const ref of previous.component_generation_refs) {
          const previousComponent = components.get(ref.generation_id);
          if (!previousComponent || !isoAtOrAfter(previousComponent.retention.retained_until, publication.retention.rollback_eligible_until)) {
            issue(errors, 'N_MINUS_ONE_RETENTION_TOO_SHORT', `${publication.publication_id}:${ref.generation_id}`);
          }
        }
      }
    }
    if (!isoAtOrAfter(publication.retention.rollback_eligible_until, publication.sealed_at)) issue(errors, 'PUBLICATION_RETENTION_BEFORE_SEAL', publication.publication_id);
    verifyDigest(errors, 'PUBLICATION_MANIFEST_DIGEST_MISMATCH', publication.publication_digest, 'publication_manifest', publicationMaterial(publication), publication.publication_id);
  }
}

const ALLOWED_TRANSITIONS = new Set([
  'null>building',
  'building>validated',
  'building>rejected',
  'validated>published',
  'validated>rejected',
  'published>retired',
  'retired>published',
  'retired>physically_expired'
]);

function validateLifecycle(bundle, errors) {
  const components = new Map(bundle.component_manifests.map(item => [item.generation_id, item]));
  const eventIds = new Set();
  for (const component of bundle.component_manifests) {
    const events = bundle.generation_history.filter(item => item.generation_id === component.generation_id).sort((a, b) => a.occurred_at < b.occurred_at ? -1 : 1);
    if (!events.length) { issue(errors, 'GENERATION_HISTORY_MISSING', component.generation_id); continue; }
    let state = null;
    for (const event of events) {
      if (eventIds.has(event.event_id)) issue(errors, 'DUPLICATE_GENERATION_EVENT_ID', event.event_id);
      eventIds.add(event.event_id);
      const key = `${event.from_state ?? 'null'}>${event.to_state}`;
      if (!ALLOWED_TRANSITIONS.has(key) || event.from_state !== state) issue(errors, 'INVALID_GENERATION_TRANSITION', `${event.event_id}:${key}:${state}`);
      if (event.component_kind !== component.component_kind) issue(errors, 'GENERATION_EVENT_COMPONENT_MISMATCH', event.event_id);
      const expectedPin = ['published', 'retired'].includes(event.to_state) ? 'serve_pinned' : event.to_state === 'physically_expired' ? 'restart_required' : 'unavailable';
      if (event.pin_behavior !== expectedPin) issue(errors, 'GENERATION_EVENT_PIN_BEHAVIOR_INVALID', event.event_id);
      if (event.to_state === 'published' && event.from_state === 'retired' && event.reason_code !== 'rollback_restored') issue(errors, 'ROLLBACK_RESTORE_REASON_INVALID', event.event_id);
      state = event.to_state;
    }
  }
  for (const testCase of bundle.pin_resolution_cases) {
    const component = components.get(testCase.generation_id);
    if (!component) { issue(errors, 'PIN_RESOLUTION_GENERATION_UNKNOWN', testCase.case_id); continue; }
    const expected = testCase.observed_at < component.retention.retained_until ? 'serve_pinned' : 'restart_required';
    if (testCase.expected_result !== expected) issue(errors, 'PIN_RESOLUTION_RESULT_INVALID', `${testCase.case_id}:${expected}`);
  }
}

function validatePointerAndHistory(bundle, errors) {
  const publications = new Map(bundle.publication_manifests.map(item => [item.publication_id, item]));
  const pointer = bundle.pointer;
  const active = publications.get(pointer.active_publication_ref.publication_id);
  const previous = pointer.previous_publication_ref ? publications.get(pointer.previous_publication_ref.publication_id) : null;
  if (!active || !publicationRefMatches(pointer.active_publication_ref, active)) issue(errors, 'ACTIVE_POINTER_PUBLICATION_UNRESOLVED', pointer.pointer_id);
  if (pointer.previous_publication_ref && (!previous || !publicationRefMatches(pointer.previous_publication_ref, previous))) issue(errors, 'PREVIOUS_POINTER_PUBLICATION_UNRESOLVED', pointer.pointer_id);
  if (active?.rollback.previous_publication_ref && !publicationRefMatches(active.rollback.previous_publication_ref, previous)) issue(errors, 'ACTIVE_ROLLBACK_PREVIOUS_MISMATCH', active.publication_id);
  const events = bundle.publication_history.events;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.sequence !== index + 1) issue(errors, 'PUBLICATION_HISTORY_SEQUENCE_GAP', event.event_id);
    if (index > 0 && !publicationRefMatches(event.from_publication_ref, publications.get(events[index - 1].to_publication_ref.publication_id))) issue(errors, 'PUBLICATION_HISTORY_CHAIN_BROKEN', event.event_id);
  }
  const latest = events.at(-1);
  if (!latest || latest.event_id !== pointer.history_event_id || latest.sequence !== pointer.sequence || latest.transaction_id !== pointer.transaction_id || latest.occurred_at !== pointer.switched_at || !publicationRefMatches(latest.to_publication_ref, active)) issue(errors, 'POINTER_HISTORY_ATOMIC_MISMATCH', pointer.pointer_id);
  if (pointer.previous_publication_ref && !publicationRefMatches(latest.from_publication_ref, previous)) issue(errors, 'POINTER_HISTORY_PREVIOUS_MISMATCH', pointer.pointer_id);
  if (active) {
    for (const ref of active.component_generation_refs) {
      const eventsForGeneration = bundle.generation_history.filter(item => item.generation_id === ref.generation_id).sort((a, b) => a.occurred_at < b.occurred_at ? -1 : 1);
      const final = eventsForGeneration.at(-1);
      const published = eventsForGeneration.findLast(item => item.to_state === 'published');
      if (final?.to_state !== 'published') issue(errors, 'ACTIVE_COMPONENT_NOT_PUBLISHED', ref.generation_id);
      if (published?.transaction_id !== pointer.transaction_id) issue(errors, 'ACTIVE_COMPONENT_PROMOTION_TRANSACTION_MISMATCH', ref.generation_id);
    }
  }
  if (previous) {
    for (const ref of previous.component_generation_refs) {
      const eventsForGeneration = bundle.generation_history.filter(item => item.generation_id === ref.generation_id).sort((a, b) => a.occurred_at < b.occurred_at ? -1 : 1);
      const final = eventsForGeneration.at(-1);
      if (!['published', 'retired'].includes(final?.to_state)) issue(errors, 'PREVIOUS_COMPONENT_NOT_ROLLBACK_ELIGIBLE', ref.generation_id);
      if (final?.to_state === 'retired' && final.transaction_id !== pointer.transaction_id) issue(errors, 'PREVIOUS_COMPONENT_RETIRE_TRANSACTION_MISMATCH', ref.generation_id);
    }
  }
}

export function validatePublicationBundle(bundle) {
  const errors = [];
  validateTaxonomy(bundle, errors);
  validateCanonicalManifests(bundle, errors);
  validateDocuments(bundle, errors);
  validateComponents(bundle, errors);
  validateBuilds(bundle, errors);
  validatePublications(bundle, errors);
  validateLifecycle(bundle, errors);
  validatePointerAndHistory(bundle, errors);
  return errors;
}
