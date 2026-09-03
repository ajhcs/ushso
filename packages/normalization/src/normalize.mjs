import {
  contentFingerprint, coverageIntervals, evidenceReference, finalizeRevision, importId,
  namespace, nativeIdentifier, normalizeDateTime, normalizeLocator, opaqueId, stableSortRows
} from './canonical.mjs';
import {
  COLLECTIONS, IMPORT_CONTRACT_VERSION, IMPORT_PLAN_VERSION, NORMALIZER_NAME,
  NORMALIZER_VERSION, RECORDED_AT, SOURCE_CONTENT_FINGERPRINT, SOURCE_CORPUS_VERSION
} from './constants.mjs';
import { buildReviewCandidates } from './review-candidates.mjs';
import { assertImportMappings } from './mapping-reconciliation.mjs';

const EVIDENCE_STATE = Object.freeze({
  verified_first_party: 'observed',
  verified_local_evidence: 'documented',
  source_asserted: 'documented',
  inferred: 'candidate',
  unresolved: 'unknown',
  unknown: 'unknown'
});

function observedAt(record) {
  return normalizeDateTime(record.freshness_verification?.metadata_observed_at)
    ?? normalizeDateTime(record.provenance?.[0]?.observed_at)
    ?? RECORDED_AT;
}

function coreEvidenceState(value) {
  return EVIDENCE_STATE[value] ?? 'unknown';
}

function sourceKey(record) {
  const value = record.identity?.source?.source_id;
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`LEGACY_SOURCE_ID_REQUIRED:${record.record_id}`);
  return value;
}

function normalizedSourcePortal(record) {
  const value = record.identity?.match_fields?.source_portal;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value.trim().replace(/^https?:\/\//iu, '').replace(/\/$/u, '').toLowerCase();
}

function sourceObservationKey(record) {
  // A legacy operator ID and a portal locator are not authoritative Source
  // identity.  Allocate one stable Source observation per immutable legacy
  // record ID; potential same-Source observations remain review candidates.
  return `legacy-record:${record.record_id}:source-observation`;
}

function firstEvidenceId(record) {
  const value = record.evidence?.[0]?.evidence_id;
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`LEGACY_EVIDENCE_REQUIRED:${record.record_id}`);
  return value;
}

function assetKind(record) {
  return ({
    dataset: 'dataset', catalog_record: 'dataset', file: 'dataset', survey: 'dataset',
    registry: 'registry', geography_reference: 'crosswalk', classification: 'crosswalk', other: 'other'
  })[record.identity?.asset?.asset_type] ?? 'other';
}

function releaseKind(record) {
  const state = record.identity?.asset?.version_state;
  if (state === 'rolling') return 'rolling_current';
  if (record.time_coverage?.state === 'point_in_time') return 'snapshot';
  return 'snapshot';
}

function cadence(record) {
  const value = record.freshness_verification?.update_frequency;
  return ['continuous', 'daily', 'weekly', 'monthly', 'quarterly', 'annual', 'irregular', 'one_time'].includes(value) ? value : 'unknown';
}

function routeKind(record) {
  return ({ portal: 'landing_page', api: 'api', download: 'download', license_workflow: 'license_request', request_workflow: 'application' })[record.retrieval?.preferred_interface] ?? 'other';
}

function accessClass(status) {
  return ({
    public_catalog: 'public', public_direct: 'public', registration_required: 'registration',
    application_required: 'application', licensed_paid: 'licensed', unknown: 'unknown'
  })[status] ?? 'unknown';
}

function accessRequirementKind(value) {
  const normalized = String(value).toLowerCase();
  if (normalized.includes('register')) return 'registration';
  if (normalized.includes('application')) return 'application';
  if (normalized.includes('dua') || normalized.includes('agreement')) return 'dua';
  if (normalized.includes('license')) return 'license';
  if (normalized.includes('pay') || normalized.includes('fee')) return 'payment';
  if (normalized.includes('authoriz')) return 'authorization';
  return 'other';
}

function routeRequirements(record, evidenceIds) {
  const values = (record.access?.requirements ?? []).filter(value => value !== 'none');
  const access = accessClass(record.access?.status);
  if (values.length === 0 && ['registration', 'application', 'dua', 'licensed', 'paid'].includes(access)) values.push(access);
  return values.map(value => ({
    kind: accessRequirementKind(value),
    description: String(value).slice(0, 1000),
    satisfaction_state: 'unknown',
    human_gate: true,
    evidence_ids: evidenceIds
  }));
}

function distributionKind(record) {
  return ({ portal: 'web_interface', api: 'api', download: 'download', license_workflow: 'web_interface', request_workflow: 'web_interface' })[record.retrieval?.preferred_interface] ?? 'other';
}

function infrastructureState(value) {
  return ({ available: 'reachable', not_tested_offline: 'not_tested', unavailable: 'unreachable', unknown: 'unknown' })[value] ?? 'unknown';
}

function evidenceClass(provenance) {
  const kind = provenance?.kind;
  if (kind === 'catalog_metadata') return 'catalog_record';
  if (['first_party_page', 'documentation', 'methodology'].includes(kind)) return 'documentation';
  if (kind === 'schema') return 'schema_observation';
  return 'publisher_metadata';
}

function sourceKind(record) {
  const key = [sourceKey(record), normalizedSourcePortal(record), record.title].filter(Boolean).join(' ').toLowerCase();
  if (key.includes('dataverse') || key.includes('datacite')) return 'repository';
  if (key.includes('registry') || key.includes('pecos')) return 'registry';
  return 'catalog';
}

function idSetForRecord(record, evidenceIdByLegacyId) {
  return [...new Set((record.evidence ?? []).map(item => evidenceIdByLegacyId.get(item.evidence_id)).filter(Boolean))].sort();
}

function refsForRecord(record, evidenceIdByLegacyId, claimPaths) {
  const observed = observedAt(record);
  return (record.evidence ?? []).map(item => evidenceReference(
    evidenceIdByLegacyId.get(item.evidence_id), claimPaths, observed, coreEvidenceState(item.state)
  ));
}

function entityIds(record) {
  const key = record.record_id;
  return Object.freeze({
    organization_id: opaqueId('organization', `legacy-source-operator:${sourceKey(record)}`),
    source_id: opaqueId('source', sourceObservationKey(record)),
    asset_id: opaqueId('asset', `legacy-record:${key}`),
    release_id: opaqueId('release', `legacy-record:${key}:release`),
    distribution_id: opaqueId('distribution', `legacy-record:${key}:primary-distribution`),
    documentation_id: opaqueId('documentation', `legacy-record:${key}:landing-page`),
    access_route_id: opaqueId('access-route', `legacy-record:${key}:primary-access-route`),
    observation_id: opaqueId('access-observation', `legacy-record:${key}:import-observation`),
    assertion_id: opaqueId('assertion', `legacy-record:${key}:access-status`)
  });
}

function coreEvidenceId(legacyEvidenceId) {
  return opaqueId('evidence', `legacy-evidence:${legacyEvidenceId}`);
}

function buildEvidence(records, idsByRecord, import_id) {
  const seen = new Map();
  for (const record of records) {
    const provenance = new Map((record.provenance ?? []).map(item => [item.provenance_id, item]));
    for (const legacy of record.evidence ?? []) {
      if (seen.has(legacy.evidence_id)) continue;
      const primary = provenance.get(legacy.provenance_ids?.[0]) ?? record.provenance?.[0] ?? null;
      const evidenceId = coreEvidenceId(legacy.evidence_id);
      const locator = normalizeLocator(primary?.locator) ?? normalizeLocator(record.authoritative_url);
      const digest = /^[a-f0-9]{64}$/u.test(primary?.content_sha256 ?? '')
        ? `sha256:${primary.content_sha256}` : contentFingerprint({ legacy_evidence: legacy, legacy_provenance: primary });
      const row = finalizeRevision({
        entityType: 'Evidence', entityId: evidenceId,
        legacyAliases: [legacy.evidence_id], nativeIdentifiers: [],
        observedAt: primary?.observed_at ?? observedAt(record), coverage: [], evidenceRefs: [], assertionRefs: [],
        import_id, parents: (legacy.provenance_ids ?? []).map(id => opaqueId('capture-reference', `legacy-provenance:${id}`)),
        specific: {
          evidence_id: evidenceId,
          source_id: idsByRecord.get(record.record_id).source_id,
          evidence_class: evidenceClass(primary),
          locator,
          captured_content_digest: digest,
          media_type: 'application/json',
          availability_state: primary?.capture_state === 'locator_only' ? 'unknown' : 'available',
          description: String(legacy.claim ?? `Imported legacy evidence ${legacy.evidence_id}`).slice(0, 2000),
          payload_included: false
        }
      });
      seen.set(legacy.evidence_id, row);
    }
  }
  return seen;
}

function commonNative(record, ids, evidenceIds, entityScope, value, suffix) {
  return [nativeIdentifier({
    sourceId: ids.source_id,
    namespace: `legacy.${suffix}`,
    value,
    entityScope,
    evidenceIds,
    authority: 'legacy_alias'
  })];
}

function buildSourceObjects(records, idsByRecord, evidenceIdByLegacyId, import_id) {
  const organizations = new Map();
  const sources = new Map();
  for (const record of records) {
    const operatorKey = sourceKey(record);
    const observationKey = sourceObservationKey(record);
    const ids = idsByRecord.get(record.record_id);
    const evidenceId = evidenceIdByLegacyId.get(firstEvidenceId(record));
    const refs = [evidenceReference(evidenceId, ['/name'], observedAt(record), 'documented')];
    const orgRefs = [evidenceReference(evidenceId, ['/display_name'], observedAt(record), 'documented')];
    const native = commonNative(record, ids, [evidenceId], 'source', observationKey, 'source-observation-id');
    if (!organizations.has(operatorKey)) {
      const orgNative = commonNative(record, ids, [evidenceId], 'organization', operatorKey, 'source-operator-id');
      organizations.set(operatorKey, finalizeRevision({
        entityType: 'Organization', entityId: ids.organization_id, legacyAliases: [`legacy-source-operator:${operatorKey}`],
        nativeIdentifiers: orgNative, observedAt: observedAt(record), evidenceRefs: orgRefs, import_id,
        specific: {
          organization_id: ids.organization_id,
          display_name: record.identity.source.name,
          organization_roles: ['repository_operator'],
          jurisdiction_codes: record.geography?.jurisdictions?.filter(code => /^[A-Z0-9-]{2,20}$/u.test(code)) ?? [],
          identity_resolution_state: 'source_scoped'
        }
      }));
    }
    const portalLabel = normalizedSourcePortal(record);
    sources.set(record.record_id, finalizeRevision({
      entityType: 'Source', entityId: ids.source_id,
      legacyAliases: [`${record.record_id}#source`], nativeIdentifiers: native,
      observedAt: observedAt(record), evidenceRefs: refs, import_id,
      specific: {
        source_id: ids.source_id,
        name: `${record.identity.source.name}${portalLabel ? ` — ${portalLabel}` : ` — ${record.record_id}`}`.slice(0, 500),
        operator_organization_id: ids.organization_id,
        source_kind: sourceKind(record),
        authority_level: 'candidate',
        canonical_locator: normalizeLocator(record.identity?.match_fields?.source_portal) ?? normalizeLocator(record.authoritative_url),
        harvestable: false
      }
    }));
  }
  return { organizations, sources };
}

function buildSourceReviewCandidates(records, idsByRecord) {
  const groups = new Map();
  for (const record of records) {
    const portal = normalizedSourcePortal(record);
    if (portal === null) continue;
    const key = `${sourceKey(record)}\u0000${portal}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const candidates = [];
  for (const group of groups.values()) {
    group.sort((left, right) => left.record_id.localeCompare(right.record_id));
    // A deterministic spanning path makes every observation in the potential
    // same-Source cluster reviewable without asserting transitive identity or
    // creating an O(n²) candidate explosion.
    for (let index = 1; index < group.length; index += 1) {
      const pair = [group[index - 1], group[index]];
      const orderedLegacyRecordIds = pair.map(row => row.record_id).sort();
      const orderedSourceIds = orderedLegacyRecordIds.map(id => idsByRecord.get(id).source_id);
      const features = {
        same_operator_legacy_id: true,
        same_observed_portal: true
      };
      candidates.push({
        candidate_id: opaqueId('identity-candidate', `${orderedSourceIds.join('\u0000')}\u0000legacy-source-observation-v1`),
        ordered_source_ids: orderedSourceIds,
        ordered_legacy_record_ids: orderedLegacyRecordIds,
        candidate_type: 'same_source_identity',
        state: 'open',
        algorithm: { name: 'legacy-source-observation-candidate-generator', version: '1.0.0', feature_version: '1.0.0' },
        features,
        feature_fingerprint: contentFingerprint(features),
        match_score_micros: 600000,
        epistemic_confidence: 'low',
        automatic_merge_performed: false,
        required_resolution_basis: 'human_review'
      });
    }
  }
  return candidates.sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
}

function buildRecordObjects(record, ids, evidenceIdByLegacyId, import_id, reviewPending) {
  const evidenceIds = idSetForRecord(record, evidenceIdByLegacyId);
  const refs = refsForRecord(record, evidenceIdByLegacyId, ['/title']);
  const nativeAsset = commonNative(record, ids, evidenceIds, 'asset', record.identity.asset.asset_id, 'asset-id');
  const assertionRef = ids.assertion_id;
  const asset = finalizeRevision({
    entityType: 'Asset', entityId: ids.asset_id,
    legacyAliases: [record.record_id, record.identity.asset.asset_id], nativeIdentifiers: nativeAsset,
    observedAt: observedAt(record), coverage: coverageIntervals(record), evidenceRefs: refs,
    assertionRefs: [assertionRef], import_id,
    specific: {
      asset_id: ids.asset_id, source_id: ids.source_id, responsible_organization_id: ids.organization_id,
      title: record.title, asset_kind: assetKind(record), summary: record.description || `Legacy asset ${record.record_id}`,
      identity_resolution_state: reviewPending ? 'review_pending' : 'source_scoped',
      family_resolution_state: record.identity.family.resolution_state === 'source_asserted' ? 'candidate' : 'unknown'
    }
  });
  const release = finalizeRevision({
    entityType: 'Release', entityId: ids.release_id, legacyAliases: [`${record.record_id}#release`],
    nativeIdentifiers: commonNative(record, ids, evidenceIds, 'release', `${record.record_id}#release`, 'release-id'),
    observedAt: observedAt(record), coverage: coverageIntervals(record), evidenceRefs: refsForRecord(record, evidenceIdByLegacyId, ['/release_label']), import_id,
    parents: [ids.asset_id],
    specific: {
      release_id: ids.release_id, asset_id: ids.asset_id,
      release_label: record.identity.asset.version_label ?? `${record.title} — legacy ${SOURCE_CORPUS_VERSION} snapshot`,
      release_kind: releaseKind(record), publisher_version: record.identity.asset.version_label, cadence: cadence(record), immutable: true
    }
  });
  const requirements = routeRequirements(record, evidenceIds);
  const route = finalizeRevision({
    entityType: 'AccessRoute', entityId: ids.access_route_id, legacyAliases: [`${record.record_id}#access`],
    nativeIdentifiers: commonNative(record, ids, evidenceIds, 'access_route', `${record.record_id}#access`, 'access-route-id'),
    observedAt: observedAt(record), evidenceRefs: refsForRecord(record, evidenceIdByLegacyId, ['/access_class']), import_id,
    parents: [ids.distribution_id],
    specific: {
      access_route_id: ids.access_route_id, distribution_id: ids.distribution_id,
      route_kind: routeKind(record), access_class: accessClass(record.access.status),
      locator: normalizeLocator(record.authoritative_url),
      human_authorization_gate: ['registration', 'application', 'dua', 'licensed', 'paid'].includes(accessClass(record.access.status)),
      requirements,
      stop_conditions: ['Stop before authentication, application, agreement, payment, or dataset-payload acquisition unless separately authorized.'],
      execution_state: 'not_executed', access_workflow_submitted: false, payloads_acquired: false
    }
  });
  const mechanisms = new Set(record.access.mechanisms ?? []);
  const distribution = finalizeRevision({
    entityType: 'Distribution', entityId: ids.distribution_id, legacyAliases: [`${record.record_id}#distribution`],
    nativeIdentifiers: commonNative(record, ids, evidenceIds, 'distribution', `${record.record_id}#distribution`, 'distribution-id'),
    observedAt: observedAt(record), evidenceRefs: refsForRecord(record, evidenceIdByLegacyId, ['/title']), import_id,
    parents: [ids.release_id],
    specific: {
      distribution_id: ids.distribution_id, release_id: ids.release_id,
      title: `${record.title} — primary access representation`, distribution_kind: distributionKind(record),
      format: 'legacy-metadata-route', media_type: null, access_route_ids: [ids.access_route_id],
      machine_readiness: {
        label: 'unknown', human_readable: mechanisms.has('data_portal') || mechanisms.has('web_download') ? 'yes' : 'unknown',
        direct_download: 'unknown', documented_api: 'unknown', indexed_schema: 'unknown', verified_recipe: 'unknown', join_guidance: 'unknown',
        evidence_ids: evidenceIds, observed_at: observedAt(record)
      }
    }
  });
  const documentation = finalizeRevision({
    entityType: 'Documentation', entityId: ids.documentation_id, legacyAliases: [`${record.record_id}#landing-page`],
    nativeIdentifiers: commonNative(record, ids, evidenceIds, 'documentation', `${record.record_id}#landing-page`, 'documentation-id'),
    observedAt: observedAt(record), evidenceRefs: refsForRecord(record, evidenceIdByLegacyId, ['/locator']), import_id,
    parents: [ids.asset_id],
    specific: {
      documentation_id: ids.documentation_id, subject_id: ids.asset_id, documentation_type: 'landing_page',
      title: `${record.title} — authoritative landing page`, locator: normalizeLocator(record.authoritative_url)
    }
  });
  const status = record.access.status;
  const observation = finalizeRevision({
    entityType: 'AccessObservation', entityId: ids.observation_id, legacyAliases: [`${record.record_id}#access-observation`],
    nativeIdentifiers: [], observedAt: observedAt(record), evidenceRefs: refsForRecord(record, evidenceIdByLegacyId, ['/catalog_visibility_state']), import_id,
    parents: [ids.access_route_id],
    specific: {
      observation_id: ids.observation_id, access_route_id: ids.access_route_id,
      catalog_visibility_state: status === 'unknown' ? 'unknown' : 'visible',
      payload_access_state: status === 'public_catalog' ? 'metadata_only' : (['licensed_paid', 'application_required', 'registration_required'].includes(status) ? 'restricted' : 'not_tested'),
      authorization_state: status.startsWith('public_') ? 'not_required' : (status === 'unknown' ? 'unknown' : 'required'),
      infrastructure_state: infrastructureState(record.access.infrastructure_state),
      requirement_state: (record.access.requirements ?? []).includes('none') ? 'none' : ((record.access.requirements ?? []).length ? 'documented' : 'unknown'),
      freshness_state: 'unknown', stale_at: null,
      check_method: record.freshness_verification?.verification_method === 'offline_fixture' ? 'offline_fixture' : 'metadata_review',
      access_workflow_submitted: false, payloads_acquired: false, raw_payload_stored: false
    }
  });
  const assertion = finalizeRevision({
    entityType: 'Assertion', entityId: ids.assertion_id, legacyAliases: [`${record.record_id}#claim:access-status`],
    nativeIdentifiers: [], observedAt: observedAt(record), evidenceRefs: refsForRecord(record, evidenceIdByLegacyId, ['/claim_value']), import_id,
    parents: [ids.asset_id],
    specific: {
      assertion_id: ids.assertion_id, subject_id: ids.asset_id, predicate: 'legacy.access_status',
      claim_value: { kind: 'string', value: status }, claim_class: 'access',
      epistemic_state: coreEvidenceState(record.access.evidence_state), effective_from: null, effective_to: null
    }
  });
  return { asset, release, distribution, documentation, route, observation, assertion };
}

function routeEvidenceIds(route, evidenceIdByLegacyId) {
  return [...new Set((route.evidence_refs ?? []).flatMap(ref => ref.evidence_ids ?? []).map(id => evidenceIdByLegacyId.get(id)).filter(Boolean))].sort();
}

function joinRequirement(description, evidenceIds, kind = 'other') {
  return { kind, description: String(description).slice(0, 1000), satisfaction_state: 'unknown', human_gate: false, evidence_ids: evidenceIds };
}

function buildJoinObjects(routes, recordById, idsByRecord, evidenceIdByLegacyId, import_id) {
  const schemaSnapshots = [];
  const schemaFields = [];
  const relationships = [];
  const routeMappings = [];
  for (const route of routes) {
    const fromRecord = recordById.get(route.from_record_id);
    const toRecord = recordById.get(route.to_record_id);
    const evidenceIds = routeEvidenceIds(route, evidenceIdByLegacyId);
    if (!fromRecord || !toRecord || evidenceIds.length === 0) throw new TypeError(`JOIN_ROUTE_UNMAPPABLE:${route.route_id}`);
    const refs = evidenceIds.map(id => evidenceReference(id, ['/join_semantics'], observedAt(fromRecord), 'candidate'));
    const relationshipIds = [];
    for (const [pairIndex, pair] of route.key_pairs.entries()) {
      const endpoints = [];
      for (const side of ['from', 'to']) {
        const record = side === 'from' ? fromRecord : toRecord;
        const recordIds = idsByRecord.get(record.record_id);
        const fields = pair[`${side}_fields`];
        const nativeNamespace = pair[`${side}_namespace`];
        const snapshotId = opaqueId('schema-snapshot', `legacy-route:${route.route_id}:${pairIndex}:${side}`);
        const fieldId = opaqueId('schema-field', `legacy-route:${route.route_id}:${pairIndex}:${side}:${fields.join('\u0000')}`);
        const snapshot = finalizeRevision({
          entityType: 'SchemaSnapshot', entityId: snapshotId,
          legacyAliases: [`${route.route_id}#${pairIndex}:${side}:schema`],
          nativeIdentifiers: commonNative(record, recordIds, evidenceIds, 'schema', `${route.route_id}#${pairIndex}:${side}:schema`, 'join-candidate-schema'),
          observedAt: observedAt(record), evidenceRefs: evidenceIds.map(id => evidenceReference(id, ['/schema_digest'], observedAt(record), 'candidate')),
          import_id, parents: [recordIds.release_id, recordIds.distribution_id], lifecycleState: 'pending_review',
          specific: {
            schema_snapshot_id: snapshotId, release_id: recordIds.release_id, distribution_id: recordIds.distribution_id,
            schema_digest: contentFingerprint({ route_id: route.route_id, side, fields, namespace: nativeNamespace, evidence_state: 'candidate' }),
            field_ids: [fieldId], immutable: true
          }
        });
        const field = finalizeRevision({
          entityType: 'SchemaField', entityId: fieldId,
          legacyAliases: [`${route.route_id}#${pairIndex}:${side}:field`],
          nativeIdentifiers: commonNative(record, recordIds, evidenceIds, 'field', `${route.route_id}#${pairIndex}:${side}:${fields.join('+')}`, 'join-candidate-field'),
          observedAt: observedAt(record), evidenceRefs: evidenceIds.map(id => evidenceReference(id, ['/source_name'], observedAt(record), 'candidate')),
          import_id, parents: [snapshotId], lifecycleState: 'pending_review',
          specific: {
            schema_field_id: fieldId, schema_snapshot_id: snapshotId,
            source_name: fields.length === 1 ? fields[0] : `composite(${fields.join(',')})`, ordinal: 0,
            source_data_type: 'legacy_candidate_key',
            description: `Unverified ${fields.length === 1 ? 'field' : 'composite key'} proposed by legacy join route ${route.route_id}; not a schema observation.`,
            identifier_namespace: namespace(nativeNamespace, 'legacy.join-key'), field_role: 'identifier'
          }
        });
        schemaSnapshots.push(snapshot);
        schemaFields.push(field);
        endpoints.push(fieldId);
      }
      const relationshipId = opaqueId('relationship', `legacy-join-route:${route.route_id}:${pairIndex}`);
      relationshipIds.push(relationshipId);
      const requirements = [
        ...(route.preconditions ?? []).map(value => joinRequirement(value, evidenceIds)),
        ...(pair.normalization_steps ?? []).map(value => joinRequirement(value, evidenceIds, 'normalization'))
      ];
      const blockers = route.blocked_reason ? [{ code: 'LEGACY_ROUTE_BLOCKED', description: route.blocked_reason.slice(0, 1000), resolution_state: 'open', evidence_ids: evidenceIds }] : [];
      relationships.push(finalizeRevision({
        entityType: 'Relationship', entityId: relationshipId, legacyAliases: [route.route_id], nativeIdentifiers: [],
        observedAt: observedAt(fromRecord), evidenceRefs: refs, import_id, parents: endpoints, lifecycleState: 'pending_review',
        specific: {
          relationship_id: relationshipId, subject_id: endpoints[0], object_id: endpoints[1],
          relationship_domain: 'join', relationship_kind: 'join_route',
          match_score_micros: null,
          epistemic_confidence: ({ high: 'high', medium: 'moderate', low: 'low' })[route.confidence] ?? 'unknown',
          identity_semantics: null, family_semantics: null,
          join_semantics: {
            operation_kind: route.match_strategy?.includes('crosswalk') ? 'crosswalk' : 'join',
            source_field_id: endpoints[0], target_field_id: endpoints[1],
            source_grain: route.entity ?? 'unknown', target_grain: route.entity ?? 'unknown',
            identifier_namespace: namespace(pair.from_namespace === pair.to_namespace ? pair.from_namespace : `${pair.from_namespace}-to-${pair.to_namespace}`, 'legacy.join-key'),
            direction: route.direction === 'bidirectional' ? 'bidirectional' : 'unidirectional',
            cardinality: ['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many'].includes(route.cardinality) ? route.cardinality : 'unknown',
            lossiness: 'unknown', evidence_state: 'candidate',
            compatibility: route.compatibility_state === 'incompatible' ? 'incompatible' : 'conditional',
            requirements, blockers
          }
        }
      }));
    }
    routeMappings.push({
      legacy_route_id: route.route_id,
      legacy_route_fingerprint: contentFingerprint(route),
      disposition: 'accepted', rejection_code: null,
      relationship_ids: relationshipIds,
      compatibility_preserved_as: route.compatibility_state === 'incompatible' ? 'incompatible' : 'conditional',
      evidence_state_preserved_as: 'candidate'
    });
  }
  return { schemaSnapshots, schemaFields, relationships, routeMappings };
}

function buildIdentityRelationships(candidates, recordsById, evidenceIdByLegacyId, import_id) {
  return candidates.map(candidate => {
    const evidenceRefs = candidate.ordered_legacy_record_ids.flatMap(id => {
      const record = recordsById.get(id);
      return refsForRecord(record, evidenceIdByLegacyId, ['/identity_semantics']);
    });
    return finalizeRevision({
      entityType: 'Relationship', entityId: opaqueId('relationship', `identity-candidate:${candidate.candidate_id}`),
      legacyAliases: [candidate.candidate_id], nativeIdentifiers: [], observedAt: RECORDED_AT,
      evidenceRefs, import_id, parents: candidate.ordered_asset_ids, lifecycleState: 'pending_review',
      specific: {
        relationship_id: opaqueId('relationship', `identity-candidate:${candidate.candidate_id}`),
        subject_id: candidate.ordered_asset_ids[0], object_id: candidate.ordered_asset_ids[1],
        relationship_domain: 'identity', relationship_kind: 'same_identity_candidate',
        match_score_micros: candidate.match_score_micros,
        epistemic_confidence: candidate.epistemic_confidence,
        identity_semantics: {
          state: 'candidate', resolution_basis: 'algorithmic_candidate', auto_resolved: false,
          authoritative_namespace: null, effective_overlap: null, conflicting_identifier: false
        },
        family_semantics: null, join_semantics: null
      }
    });
  });
}

function buildSourceIdentityRelationships(candidates, recordsById, evidenceIdByLegacyId, import_id) {
  return candidates.map(candidate => {
    const evidenceRefs = candidate.ordered_legacy_record_ids.flatMap(id => {
      const record = recordsById.get(id);
      return refsForRecord(record, evidenceIdByLegacyId, ['/identity_semantics']);
    });
    const relationshipId = opaqueId('relationship', `source-identity-candidate:${candidate.candidate_id}`);
    return finalizeRevision({
      entityType: 'Relationship', entityId: relationshipId,
      legacyAliases: [`source-review:${candidate.candidate_id}`], nativeIdentifiers: [],
      observedAt: RECORDED_AT, evidenceRefs, import_id,
      parents: candidate.ordered_source_ids, lifecycleState: 'pending_review',
      specific: {
        relationship_id: relationshipId,
        subject_id: candidate.ordered_source_ids[0], object_id: candidate.ordered_source_ids[1],
        relationship_domain: 'identity', relationship_kind: 'same_identity_candidate',
        match_score_micros: candidate.match_score_micros,
        epistemic_confidence: candidate.epistemic_confidence,
        identity_semantics: {
          state: 'candidate', resolution_basis: 'algorithmic_candidate', auto_resolved: false,
          authoritative_namespace: null, effective_overlap: null, conflicting_identifier: false
        },
        family_semantics: null, join_semantics: null
      }
    });
  });
}

export function normalizeLegacyCorpus(legacy) {
  const import_id = importId(SOURCE_CONTENT_FINGERPRINT);
  const records = [...legacy.records].sort((a, b) => a.record_id.localeCompare(b.record_id));
  const routes = [...legacy.joinRoutes].sort((a, b) => a.route_id.localeCompare(b.route_id));
  const recordsById = new Map(records.map(record => [record.record_id, record]));
  const idsByRecord = new Map(records.map(record => [record.record_id, entityIds(record)]));
  const assetIdByLegacyId = new Map([...idsByRecord].map(([id, ids]) => [id, ids.asset_id]));
  const candidates = buildReviewCandidates(records, assetIdByLegacyId);
  const sourceCandidates = buildSourceReviewCandidates(records, idsByRecord);
  const reviewPendingIds = new Set(candidates.flatMap(row => row.ordered_asset_ids));
  const evidenceByLegacyId = buildEvidence(records, idsByRecord, import_id);
  const evidenceIdByLegacyId = new Map([...evidenceByLegacyId].map(([id, row]) => [id, row.evidence_id]));
  const sourceObjects = buildSourceObjects(records, idsByRecord, evidenceIdByLegacyId, import_id);
  const bundle = Object.fromEntries(COLLECTIONS.map(collection => [collection, []]));
  bundle.bundle_version = 'observatory-core-fixture-bundle.v2.0.0';
  bundle.organizations.push(...sourceObjects.organizations.values());
  bundle.sources.push(...sourceObjects.sources.values());
  bundle.evidence.push(...evidenceByLegacyId.values());

  const recordMappings = [];
  for (const record of records) {
    const ids = idsByRecord.get(record.record_id);
    const rows = buildRecordObjects(record, ids, evidenceIdByLegacyId, import_id, reviewPendingIds.has(ids.asset_id));
    bundle.assets.push(rows.asset);
    bundle.releases.push(rows.release);
    bundle.distributions.push(rows.distribution);
    bundle.documentation.push(rows.documentation);
    bundle.access_routes.push(rows.route);
    bundle.access_observations.push(rows.observation);
    bundle.assertions.push(rows.assertion);
    recordMappings.push({
      legacy_record_id: record.record_id,
      legacy_record_fingerprint: contentFingerprint(record),
      disposition: 'accepted', rejection_code: null,
      canonical_ids: ids,
      evidence_ids: idSetForRecord(record, evidenceIdByLegacyId),
      legacy_alias_preserved: true,
      identity_action: reviewPendingIds.has(ids.asset_id) ? 'created_separate_with_open_candidate' : 'created_separate',
      source_identity_scope: 'source_scoped'
    });
  }
  const joins = buildJoinObjects(routes, recordsById, idsByRecord, evidenceIdByLegacyId, import_id);
  bundle.schema_snapshots.push(...joins.schemaSnapshots);
  bundle.schema_fields.push(...joins.schemaFields);
  bundle.relationships.push(...joins.relationships);
  bundle.relationships.push(...buildIdentityRelationships(candidates, recordsById, evidenceIdByLegacyId, import_id));
  bundle.relationships.push(...buildSourceIdentityRelationships(sourceCandidates, recordsById, evidenceIdByLegacyId, import_id));
  for (const collection of COLLECTIONS) bundle[collection] = stableSortRows(bundle[collection]);

  const canonicalCounts = Object.fromEntries(COLLECTIONS.map(collection => [collection, bundle[collection].length]));
  const projection = {
    records: structuredClone(legacy.records),
    search_documents: structuredClone(legacy.searchDocuments),
    join_routes: structuredClone(legacy.joinRoutes),
    corpus: structuredClone(legacy.corpus),
    semantics: {
      stable_public_ids: true,
      exact_access_states: true,
      exact_evidence: true,
      exact_join_routes: true,
      projection_warnings_preserved: true,
      zero_results_status: 200,
      zero_results_absence_claim_permitted: false,
      zero_results_warning: 'Zero results are not evidence that no source exists.'
    }
  };
  const plan = {
    plan_version: IMPORT_PLAN_VERSION,
    import_id,
    source: {
      corpus_version: SOURCE_CORPUS_VERSION,
      manifest_file_sha256: legacy.hashes.manifest,
      content_fingerprint_sha256: SOURCE_CONTENT_FINGERPRINT,
      records_file_sha256: legacy.hashes.records,
      search_documents_file_sha256: legacy.hashes.searchDocuments,
      join_routes_file_sha256: legacy.hashes.joinRoutes
    },
    normalizer: { name: NORMALIZER_NAME, version: NORMALIZER_VERSION, deterministic: true },
    policy: {
      id_basis: 'source-scoped immutable legacy identifier',
      title_or_url_merge_permitted: false,
      uncertain_identity_disposition: 'separate_open_review_candidate',
      destructive_rollback_permitted: false,
      source_payloads_acquired: false,
      analyses_executed: false
    },
    expected_counts: { legacy_records: records.length, legacy_join_routes: routes.length, legacy_search_documents: legacy.searchDocuments.length },
    canonical_counts: canonicalCounts,
    record_mappings: recordMappings,
    join_route_mappings: joins.routeMappings,
    identity_review_candidates: candidates,
    source_identity_review_candidates: sourceCandidates,
    rejected_items: [],
    bundle_fingerprint: contentFingerprint(bundle),
    projection_fingerprint: contentFingerprint(projection),
    created_at: RECORDED_AT
  };
  const importDocument = {
    contract_version: IMPORT_CONTRACT_VERSION,
    import_id,
    source_content_fingerprint: SOURCE_CONTENT_FINGERPRINT,
    document_fingerprint: null,
    plan,
    bundle,
    legacy_projection: projection,
    projection_row_fingerprints: {
      corpus: contentFingerprint(legacy.corpus),
      records: Object.fromEntries(legacy.records.map(row => [row.record_id, contentFingerprint(row)])),
      search_documents: Object.fromEntries(legacy.searchDocuments.map(row => [row.search_document_id, contentFingerprint(row)])),
      join_routes: Object.fromEntries(legacy.joinRoutes.map(row => [row.route_id, contentFingerprint(row)]))
    }
  };
  assertImportMappings({ plan, bundle });
  importDocument.document_fingerprint = contentFingerprint({ ...importDocument, document_fingerprint: null });
  return Object.freeze({ import_id, bundle, plan, projection, importDocument });
}
