import { fingerprintTruthRevision } from './common.mjs';

export const COLLECTION_SCHEMAS = Object.freeze({
  organizations: 'organization.schema.json',
  sources: 'source.schema.json',
  assets: 'asset.schema.json',
  releases: 'release.schema.json',
  distributions: 'distribution.schema.json',
  documentation: 'documentation.schema.json',
  schema_snapshots: 'schema-snapshot.schema.json',
  schema_fields: 'schema-field.schema.json',
  access_routes: 'access-route.schema.json',
  access_observations: 'access-observation.schema.json',
  evidence: 'evidence.schema.json',
  assertions: 'assertion.schema.json',
  relationships: 'relationship.schema.json'
});

const TYPE_ID_FIELDS = Object.freeze({
  Organization: 'organization_id',
  Source: 'source_id',
  Asset: 'asset_id',
  Release: 'release_id',
  Distribution: 'distribution_id',
  Documentation: 'documentation_id',
  SchemaSnapshot: 'schema_snapshot_id',
  SchemaField: 'schema_field_id',
  AccessRoute: 'access_route_id',
  AccessObservation: 'observation_id',
  Evidence: 'evidence_id',
  Assertion: 'assertion_id',
  Relationship: 'relationship_id'
});

const FORBIDDEN_KEYS = new Set([
  'payload',
  'source_payload',
  'source_data',
  'source_data_payload',
  'body',
  'raw_body',
  'response_body',
  'dataset_rows',
  'data_rows',
  'patient_rows',
  'patient_data',
  'record_values',
  'sample_values',
  'analytical_results',
  'analysis_results',
  'computed_results',
  'market_share',
  'financial_benchmark',
  'financial_benchmarks',
  'rankings'
]);

const FORBIDDEN_ASSERTION_PREDICATES = new Set([
  'analysis.result',
  'analysis.executed',
  'market_share',
  'financial_benchmark',
  'ranking'
]);

function add(errors, code, path, message) {
  errors.push({ code, path, message });
}

function rowsOf(bundle) {
  return Object.entries(COLLECTION_SCHEMAS).flatMap(([collection]) =>
    (Array.isArray(bundle[collection]) ? bundle[collection] : []).map((row, index) => ({ collection, index, row }))
  );
}

function pointerTokens(pointer) {
  return pointer.slice(1).split('/').map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function hasPointer(value, pointer) {
  let cursor = value;
  for (const token of pointerTokens(pointer)) {
    if (cursor === null || typeof cursor !== 'object' || !Object.hasOwn(cursor, token)) return false;
    cursor = cursor[token];
  }
  return true;
}

function scanBoundary(value, at, errors) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_KEYS.has(normalized)) add(errors, 'SOURCE_DATA_OR_ANALYSIS_PAYLOAD', `${at}/${key}`, `prohibited source-data or analysis payload field: ${key}`);
    if (normalized.endsWith('_state') && ['not_found', 'absent', 'missing_as_none'].includes(child)) {
      add(errors, 'UNKNOWN_COLLAPSE', `${at}/${key}`, `${child} collapses an unresolved state into absence`);
    }
    scanBoundary(child, `${at}/${key}`, errors);
  }
}

function milliseconds(value) {
  return value === null || value === undefined ? null : Date.parse(value);
}

function checkOrdered(errors, code, path, left, right, message) {
  if (left !== null && right !== null && milliseconds(left) > milliseconds(right)) add(errors, code, path, message);
}

function validateTemporal(row, path, errors) {
  const clocks = row.clocks;
  if (!clocks) return;
  checkOrdered(errors, 'TEMPORAL_ORDER', `${path}/clocks`, clocks.first_seen_at, clocks.observed_at, 'first_seen_at must not be after observed_at');
  checkOrdered(errors, 'TEMPORAL_ORDER', `${path}/clocks`, clocks.observed_at, clocks.recorded_at, 'observed_at must not be after recorded_at');
  checkOrdered(errors, 'TEMPORAL_ORDER', `${path}/clocks`, clocks.publisher_released_at, clocks.observed_at, 'publisher_released_at must not be after observed_at');
  checkOrdered(errors, 'TEMPORAL_ORDER', `${path}/clocks`, clocks.publisher_modified_at, clocks.observed_at, 'publisher_modified_at must not be after observed_at');
  checkOrdered(errors, 'TEMPORAL_ORDER', `${path}/clocks`, clocks.recorded_at, clocks.superseded_at, 'superseded_at must not be before recorded_at');

  for (const [index, interval] of (row.coverage_intervals ?? []).entries()) {
    const intervalPath = `${path}/coverage_intervals/${index}`;
    if (['unknown', 'not_applicable'].includes(interval.status) && (interval.start !== null || interval.end !== null)) {
      add(errors, 'TEMPORAL_UNKNOWN_OVERCLAIM', intervalPath, `${interval.status} coverage cannot carry exact bounds`);
    }
    if (['known', 'estimated'].includes(interval.status) && (interval.start === null || interval.end === null)) {
      add(errors, 'TEMPORAL_BOUNDS_MISSING', intervalPath, `${interval.status} coverage requires both bounds`);
    }
    checkOrdered(errors, 'TEMPORAL_ORDER', intervalPath, interval.start, interval.end, 'coverage start must not be after end');
    if (interval.period_basis === 'fiscal' && interval.fiscal_year_end_month === null) add(errors, 'FISCAL_SEMANTICS_MISSING', intervalPath, 'fiscal coverage requires fiscal_year_end_month');
    if (interval.period_basis !== 'fiscal' && interval.fiscal_year_end_month !== null) add(errors, 'FISCAL_SEMANTICS_CONTRADICTION', intervalPath, 'fiscal_year_end_month is only valid for fiscal coverage');
  }

  for (const [index, native] of (row.native_identifiers ?? []).entries()) {
    checkOrdered(errors, 'TEMPORAL_ORDER', `${path}/native_identifiers/${index}`, native.effective_from, native.effective_to, 'identifier effective_from must not be after effective_to');
  }
  if (row.entity_type === 'Assertion') checkOrdered(errors, 'TEMPORAL_ORDER', path, row.effective_from, row.effective_to, 'assertion effective_from must not be after effective_to');
}

function validateHistory(entries, errors) {
  const revisionById = new Map();
  const activeByEntity = new Map();
  for (const { row, collection, index } of entries) {
    const path = `/${collection}/${index}`;
    if (revisionById.has(row.revision_id)) add(errors, 'DUPLICATE_REVISION_ID', `${path}/revision_id`, `duplicate revision_id ${row.revision_id}`);
    revisionById.set(row.revision_id, { row, path });
    if (row.lifecycle_state !== 'superseded') {
      const activeKey = `${row.entity_type}\u0000${row.entity_id}`;
      if (activeByEntity.has(activeKey)) add(errors, 'MULTIPLE_CURRENT_REVISIONS', path, `multiple non-superseded revisions for ${row.entity_id}`);
      activeByEntity.set(activeKey, row.revision_id);
    }
  }

  for (const { row, collection, index } of entries) {
    const path = `/${collection}/${index}`;
    const history = row.history;
    if (!history || !row.clocks) continue;
    const nextId = history.superseded_by_revision_id;
    const oldIds = history.supersedes_revision_ids ?? [];
    if (row.lifecycle_state === 'superseded') {
      if (!nextId || row.clocks.superseded_at === null) add(errors, 'SUPERSESSION_INCOMPLETE', path, 'superseded revision requires successor and superseded_at');
    } else if (nextId !== null || row.clocks.superseded_at !== null) {
      add(errors, 'SUPERSESSION_STATE_CONTRADICTION', path, 'only a superseded revision may point forward or carry superseded_at');
    }
    if ((nextId !== null || oldIds.length > 0) && !history.rationale) add(errors, 'SUPERSESSION_RATIONALE_MISSING', `${path}/history`, 'supersession links require a rationale');
    if (nextId) {
      const next = revisionById.get(nextId);
      if (!next) add(errors, 'SUPERSESSION_REFERENCE_MISSING', `${path}/history/superseded_by_revision_id`, `unknown successor ${nextId}`);
      else {
        if (next.row.entity_id !== row.entity_id || next.row.entity_type !== row.entity_type) add(errors, 'SUPERSESSION_IDENTITY_MISMATCH', path, 'successor must revise the same entity');
        if (!(next.row.history?.supersedes_revision_ids ?? []).includes(row.revision_id)) add(errors, 'SUPERSESSION_NOT_BIDIRECTIONAL', path, 'successor does not point back to prior revision');
      }
    }
    for (const oldId of oldIds) {
      const old = revisionById.get(oldId);
      if (!old) add(errors, 'SUPERSESSION_REFERENCE_MISSING', `${path}/history/supersedes_revision_ids`, `unknown prior revision ${oldId}`);
      else if (old.row.history?.superseded_by_revision_id !== row.revision_id) add(errors, 'SUPERSESSION_NOT_BIDIRECTIONAL', path, `prior revision ${oldId} does not point to successor`);
    }

    const seen = new Set([row.revision_id]);
    let cursor = row;
    while (cursor.history?.superseded_by_revision_id) {
      const cursorId = cursor.history.superseded_by_revision_id;
      if (seen.has(cursorId)) { add(errors, 'SUPERSESSION_CYCLE', path, 'supersession graph contains a cycle'); break; }
      seen.add(cursorId);
      cursor = revisionById.get(cursorId)?.row;
      if (!cursor) break;
    }
  }
}

function currentById(entries) {
  const map = new Map();
  for (const { row } of entries) {
    const current = map.get(row.entity_id);
    if (!current || current.lifecycle_state === 'superseded') map.set(row.entity_id, row);
  }
  return map;
}

function expectType(map, id, types, path, errors) {
  const target = map.get(id);
  if (!target) add(errors, 'REFERENCE_MISSING', path, `unknown reference ${id}`);
  else if (!types.includes(target.entity_type)) add(errors, 'REFERENCE_TYPE_MISMATCH', path, `${id} is ${target.entity_type}; expected ${types.join('|')}`);
}

function evidenceClasses(row, evidenceById) {
  return new Set((row.evidence_refs ?? []).map(ref => evidenceById.get(ref.evidence_id)?.evidence_class).filter(Boolean));
}

function validateAccess(bundle, entityById, evidenceById, errors) {
  for (const [index, route] of (bundle.access_routes ?? []).entries()) {
    const path = `/access_routes/${index}`;
    const gatedClasses = new Set(['application', 'dua', 'licensed', 'paid']);
    if (gatedClasses.has(route.access_class) && route.human_authorization_gate !== true) add(errors, 'ACCESS_HUMAN_GATE_MISSING', path, `${route.access_class} access requires a human authorization gate`);
    if (route.human_authorization_gate && !(route.requirements ?? []).some(requirement => requirement.human_gate)) add(errors, 'ACCESS_HUMAN_GATE_MISSING', path, 'human_authorization_gate requires a matching human-gated requirement');
    if (route.access_class === 'public' && route.requirements?.some(requirement => requirement.kind === 'authorization' && requirement.satisfaction_state === 'unsatisfied')) add(errors, 'ACCESS_CLASS_CONTRADICTION', path, 'public access cannot carry an unsatisfied authorization requirement');
  }
  for (const [index, observation] of (bundle.access_observations ?? []).entries()) {
    const path = `/access_observations/${index}`;
    const route = entityById.get(observation.access_route_id);
    const classes = evidenceClasses(observation, evidenceById);
    if (observation.payload_access_state === 'accessible') {
      if (!['head', 'get_metadata_only', 'maintainer_attestation', 'external_report'].includes(observation.check_method)) add(errors, 'ACCESS_OVERCLAIM', path, 'accessible payload state requires an admissible verification method');
      if (observation.freshness_state !== 'current') add(errors, 'ACCESS_OVERCLAIM', path, 'accessible payload state requires current evidence');
      if (![...classes].some(value => ['access_check', 'controlled_test', 'external_execution_record'].includes(value))) add(errors, 'ACCESS_OVERCLAIM', path, 'accessible payload state lacks access-check or external execution evidence');
      if (route && route.access_class !== 'public' && observation.authorization_state === 'not_required') add(errors, 'ACCESS_AUTHORIZATION_OVERCLAIM', path, 'restricted route cannot be observed as authorization-not-required');
    }
    if (observation.catalog_visibility_state === 'visible' && observation.payload_access_state === 'accessible' && observation.check_method === 'metadata_review') add(errors, 'VISIBILITY_IS_NOT_ACCESS', path, 'catalog visibility and metadata review do not prove payload access');
    if (observation.authorization_state === 'externally_reported_authorized' && !classes.has('external_execution_record')) add(errors, 'ACCESS_AUTHORIZATION_OVERCLAIM', path, 'external authorization claim requires an external execution record');
  }
}

function validateIdentityFamilyJoin(bundle, entityById, evidenceById, errors) {
  for (const [index, relationship] of (bundle.relationships ?? []).entries()) {
    const path = `/relationships/${index}`;
    const identity = relationship.identity_semantics;
    const family = relationship.family_semantics;
    const join = relationship.join_semantics;
    const classes = evidenceClasses(relationship, evidenceById);

    if (relationship.relationship_domain === 'identity') {
      if (relationship.relationship_kind === 'same_identity_candidate' && (!identity || !['candidate', 'deferred'].includes(identity.state))) add(errors, 'IDENTITY_CANDIDATE_STATE', path, 'identity candidate must remain candidate or deferred');
      if (relationship.relationship_kind === 'same_identity' && identity?.state !== 'accepted') add(errors, 'IDENTITY_UNRESOLVED_EQUALITY', path, 'same_identity requires an accepted identity decision');
      if (identity?.state === 'candidate' && relationship.relationship_kind === 'same_identity') add(errors, 'IDENTITY_UNRESOLVED_EQUALITY', path, 'candidate identity cannot be represented as equality');
      if (identity?.state === 'accepted' && !['exact_authoritative_identifier', 'human_review'].includes(identity.resolution_basis)) add(errors, 'IDENTITY_EVIDENCE_INADMISSIBLE', path, 'accepted identity requires authoritative exact-ID or human-review evidence');
      if (identity?.auto_resolved && (identity.resolution_basis !== 'exact_authoritative_identifier' || !identity.authoritative_namespace || identity.effective_overlap !== true || identity.conflicting_identifier)) add(errors, 'IDENTITY_AUTO_RESOLUTION_UNSAFE', path, 'automatic identity resolution violates exact-identifier policy');
      if (identity?.resolution_basis === 'exact_authoritative_identifier' && !classes.has('authoritative_identifier')) add(errors, 'IDENTITY_EVIDENCE_INADMISSIBLE', path, 'authoritative identity resolution lacks authoritative identifier evidence');
    }

    if (relationship.relationship_domain === 'family') {
      if (!['family_member', 'mirror_of', 'successor_of', 'version_of', 'collection_member'].includes(relationship.relationship_kind)) add(errors, 'FAMILY_IDENTITY_CONFUSION', path, 'family domain uses an identity or unrelated relationship kind');
      if (family?.identity_equality !== false) add(errors, 'FAMILY_IDENTITY_CONFUSION', path, 'family membership must never imply identity equality');
      if (identity !== null) add(errors, 'FAMILY_IDENTITY_CONFUSION', path, 'family relationship may not carry identity resolution semantics');
    }

    if (relationship.relationship_domain === 'join') {
      if (relationship.relationship_kind !== 'join_route' || !join) add(errors, 'JOIN_DOMAIN_CONTRADICTION', path, 'join domain requires join_route semantics');
      if (!join) continue;
      expectType(entityById, join.source_field_id, ['SchemaField'], `${path}/join_semantics/source_field_id`, errors);
      expectType(entityById, join.target_field_id, ['SchemaField'], `${path}/join_semantics/target_field_id`, errors);
      if (relationship.subject_id !== join.source_field_id || relationship.object_id !== join.target_field_id) add(errors, 'JOIN_FIELD_REFERENCE_MISMATCH', path, 'relationship endpoints must equal exact join field IDs');
      if (['unknown', 'candidate', 'ambiguous'].includes(join.evidence_state) && join.compatibility === 'compatible') add(errors, 'JOIN_EVIDENCE_UPGRADE', path, `${join.evidence_state} join evidence cannot claim compatible`);
      if (['unknown', 'candidate', 'ambiguous'].includes(join.evidence_state) && relationship.epistemic_confidence === 'confirmed') add(errors, 'JOIN_EVIDENCE_UPGRADE', path, 'unresolved join evidence cannot carry confirmed confidence');
      if (join.evidence_state === 'documented' && !classes.has('documentation')) add(errors, 'JOIN_EVIDENCE_UPGRADE', path, 'documented join requires documentation evidence');
      if (join.evidence_state === 'observed' && ![...classes].some(value => ['schema_observation', 'controlled_test', 'external_execution_record'].includes(value))) add(errors, 'JOIN_EVIDENCE_UPGRADE', path, 'observed join requires schema observation or stronger evidence');
      if (['executed', 'proven'].includes(join.evidence_state) && ![...classes].some(value => ['controlled_test', 'external_execution_record'].includes(value))) add(errors, 'JOIN_EVIDENCE_UPGRADE', path, `${join.evidence_state} join requires controlled-test or external-execution evidence`);
      if (join.compatibility === 'compatible') {
        if (join.requirements.some(requirement => !['satisfied', 'not_applicable'].includes(requirement.satisfaction_state))) add(errors, 'JOIN_COMPATIBILITY_OVERCLAIM', path, 'compatible join has unresolved requirements');
        if (join.blockers.some(blocker => blocker.resolution_state !== 'resolved')) add(errors, 'JOIN_COMPATIBILITY_OVERCLAIM', path, 'compatible join has unresolved blockers');
      }
      if (join.operation_kind === 'aggregate' && relationship.relationship_domain === 'identity') add(errors, 'AGGREGATION_IS_NOT_IDENTITY', path, 'aggregation cannot resolve identity');
    }
  }
}

export function semanticErrors(bundle, { verifyFingerprints = true } = {}) {
  const errors = [];
  const entries = rowsOf(bundle);
  const entityById = currentById(entries);
  const evidenceById = new Map((bundle.evidence ?? []).map(row => [row.evidence_id, row]));
  const assertionIds = new Set((bundle.assertions ?? []).map(row => row.assertion_id));

  for (const { collection, index, row } of entries) {
    const path = `/${collection}/${index}`;
    scanBoundary(row, path, errors);
    const idField = TYPE_ID_FIELDS[row.entity_type];
    if (idField && row[idField] !== row.entity_id) add(errors, 'ENTITY_ID_ALIAS_MISMATCH', `${path}/${idField}`, `${idField} must equal entity_id`);
    if (verifyFingerprints && row.canonical_content_fingerprint && row.canonical_content_fingerprint !== fingerprintTruthRevision(row)) add(errors, 'CONTENT_FINGERPRINT_MISMATCH', `${path}/canonical_content_fingerprint`, 'canonical content fingerprint does not match the revision body');
    validateTemporal(row, path, errors);

    if (row.entity_type !== 'Evidence' && !(row.evidence_refs?.length > 0)) add(errors, 'MISSING_EVIDENCE', `${path}/evidence_refs`, 'truth-bearing revision requires evidence');
    for (const [refIndex, ref] of (row.evidence_refs ?? []).entries()) {
      const refPath = `${path}/evidence_refs/${refIndex}`;
      if (!evidenceById.has(ref.evidence_id)) add(errors, 'MISSING_EVIDENCE', `${refPath}/evidence_id`, `unknown evidence ${ref.evidence_id}`);
      for (const claimPath of ref.claim_paths ?? []) if (!hasPointer(row, claimPath)) add(errors, 'EVIDENCE_CLAIM_PATH_MISSING', `${refPath}/claim_paths`, `claim path does not resolve: ${claimPath}`);
      if (ref.review_status === 'reviewed' && ref.reviewed_at === null) add(errors, 'EVIDENCE_REVIEW_TIME_MISSING', refPath, 'reviewed evidence reference requires reviewed_at');
      if (ref.review_status !== 'reviewed' && ref.reviewed_at !== null) add(errors, 'EVIDENCE_REVIEW_STATE_CONTRADICTION', refPath, 'reviewed_at is only valid for reviewed evidence');
    }
    for (const [nativeIndex, native] of (row.native_identifiers ?? []).entries()) {
      expectType(entityById, native.source_id, ['Source'], `${path}/native_identifiers/${nativeIndex}/source_id`, errors);
      for (const evidenceId of native.evidence_ids ?? []) if (!evidenceById.has(evidenceId)) add(errors, 'MISSING_EVIDENCE', `${path}/native_identifiers/${nativeIndex}/evidence_ids`, `unknown identifier evidence ${evidenceId}`);
    }
    for (const assertionId of (row.assertion_refs ?? [])) if (!assertionIds.has(assertionId)) add(errors, 'ASSERTION_REFERENCE_MISSING', `${path}/assertion_refs`, `unknown assertion ${assertionId}`);
    if (row.entity_type === 'Assertion' && FORBIDDEN_ASSERTION_PREDICATES.has(row.predicate)) add(errors, 'SOURCE_DATA_OR_ANALYSIS_PAYLOAD', `${path}/predicate`, 'assertion predicate crosses the metadata-only product boundary');
  }

  validateHistory(entries, errors);

  for (const [index, source] of (bundle.sources ?? []).entries()) expectType(entityById, source.operator_organization_id, ['Organization'], `/sources/${index}/operator_organization_id`, errors);
  for (const [index, asset] of (bundle.assets ?? []).entries()) {
    expectType(entityById, asset.source_id, ['Source'], `/assets/${index}/source_id`, errors);
    expectType(entityById, asset.responsible_organization_id, ['Organization'], `/assets/${index}/responsible_organization_id`, errors);
  }
  for (const [index, release] of (bundle.releases ?? []).entries()) expectType(entityById, release.asset_id, ['Asset'], `/releases/${index}/asset_id`, errors);
  for (const [index, distribution] of (bundle.distributions ?? []).entries()) {
    expectType(entityById, distribution.release_id, ['Release'], `/distributions/${index}/release_id`, errors);
    for (const routeId of distribution.access_route_ids ?? []) expectType(entityById, routeId, ['AccessRoute'], `/distributions/${index}/access_route_ids`, errors);
    for (const evidenceId of distribution.machine_readiness?.evidence_ids ?? []) if (!evidenceById.has(evidenceId)) add(errors, 'MISSING_EVIDENCE', `/distributions/${index}/machine_readiness/evidence_ids`, `unknown machine-readiness evidence ${evidenceId}`);
  }
  for (const [index, documentation] of (bundle.documentation ?? []).entries()) expectType(entityById, documentation.subject_id, ['Source', 'Asset', 'Release', 'Distribution', 'SchemaSnapshot', 'AccessRoute'], `/documentation/${index}/subject_id`, errors);
  for (const [index, snapshot] of (bundle.schema_snapshots ?? []).entries()) {
    expectType(entityById, snapshot.release_id, ['Release'], `/schema_snapshots/${index}/release_id`, errors);
    expectType(entityById, snapshot.distribution_id, ['Distribution'], `/schema_snapshots/${index}/distribution_id`, errors);
    for (const fieldId of snapshot.field_ids ?? []) expectType(entityById, fieldId, ['SchemaField'], `/schema_snapshots/${index}/field_ids`, errors);
  }
  for (const [index, field] of (bundle.schema_fields ?? []).entries()) expectType(entityById, field.schema_snapshot_id, ['SchemaSnapshot'], `/schema_fields/${index}/schema_snapshot_id`, errors);
  for (const [index, route] of (bundle.access_routes ?? []).entries()) {
    expectType(entityById, route.distribution_id, ['Distribution'], `/access_routes/${index}/distribution_id`, errors);
    for (const requirement of route.requirements ?? []) for (const evidenceId of requirement.evidence_ids ?? []) if (!evidenceById.has(evidenceId)) add(errors, 'MISSING_EVIDENCE', `/access_routes/${index}/requirements`, `unknown access requirement evidence ${evidenceId}`);
  }
  for (const [index, observation] of (bundle.access_observations ?? []).entries()) expectType(entityById, observation.access_route_id, ['AccessRoute'], `/access_observations/${index}/access_route_id`, errors);
  for (const [index, evidence] of (bundle.evidence ?? []).entries()) expectType(entityById, evidence.source_id, ['Source'], `/evidence/${index}/source_id`, errors);
  for (const [index, assertion] of (bundle.assertions ?? []).entries()) expectType(entityById, assertion.subject_id, ['Organization', 'Source', 'Asset', 'Release', 'Distribution', 'Documentation', 'SchemaSnapshot', 'SchemaField', 'AccessRoute'], `/assertions/${index}/subject_id`, errors);
  for (const [index, relationship] of (bundle.relationships ?? []).entries()) {
    expectType(entityById, relationship.subject_id, ['Organization', 'Source', 'Asset', 'Release', 'Distribution', 'Documentation', 'SchemaSnapshot', 'SchemaField', 'AccessRoute'], `/relationships/${index}/subject_id`, errors);
    expectType(entityById, relationship.object_id, ['Organization', 'Source', 'Asset', 'Release', 'Distribution', 'Documentation', 'SchemaSnapshot', 'SchemaField', 'AccessRoute'], `/relationships/${index}/object_id`, errors);
  }

  validateAccess(bundle, entityById, evidenceById, errors);
  validateIdentityFamilyJoin(bundle, entityById, evidenceById, errors);

  const unique = new Map();
  for (const error of errors) unique.set(`${error.code}\u0000${error.path}\u0000${error.message}`, error);
  return [...unique.values()].sort((left, right) => `${left.path}\u0000${left.code}`.localeCompare(`${right.path}\u0000${right.code}`));
}

function parentAndKey(root, pointer) {
  const tokens = pointerTokens(pointer);
  const key = tokens.pop();
  let parent = root;
  for (const token of tokens) {
    if (parent === null || typeof parent !== 'object' || !Object.hasOwn(parent, token)) throw new Error(`MUTATION_PATH_MISSING:${pointer}`);
    parent = parent[token];
  }
  return { parent, key };
}

export function applyAdversarialCase(bundle, adversarialCase) {
  const copy = structuredClone(bundle);
  const rows = copy[adversarialCase.target_collection];
  const target = rows?.find(row => row.revision_id === adversarialCase.target_revision_id);
  if (!target) throw new Error(`ADVERSARIAL_TARGET_MISSING:${adversarialCase.case_id}`);
  for (const mutation of adversarialCase.mutations) {
    const { parent, key } = parentAndKey(target, mutation.path);
    if (mutation.op === 'remove') {
      if (!Object.hasOwn(parent, key)) throw new Error(`MUTATION_PATH_MISSING:${mutation.path}`);
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
    } else if (mutation.op === 'set') {
      parent[key] = structuredClone(mutation.value);
    } else if (mutation.op === 'append') {
      if (!Array.isArray(parent[key])) throw new Error(`MUTATION_TARGET_NOT_ARRAY:${mutation.path}`);
      parent[key].push(structuredClone(mutation.value));
    }
  }
  return copy;
}
