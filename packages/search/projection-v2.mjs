import { canonicalizeJson } from '../../contracts/tooling/v1.0.0/src/canonical-json.mjs';
import { canonicalSha256 } from '../../contracts/tooling/v1.0.0/src/digests.mjs';
import {
  componentMaterial,
  digest,
  membershipMaterial,
  projectionDocumentMaterial,
  projectionSetMaterial,
} from '../../contracts/publication/v1.0.0/tools/common.mjs';

export const SEARCH_PROJECTION_VERSION = 'ushso-search-projection.v2.0.0';
export const SEARCH_PROJECTOR_VERSION = '1.0.0-untuned';
export const SEARCH_PROJECTION_TYPES = Object.freeze([
  'asset_search',
  'release_distribution_search',
  'schema_field_search',
  'join_edge_search',
  'source_search',
]);
export const PUBLICATION_COMPONENT_TYPES = Object.freeze([
  ...SEARCH_PROJECTION_TYPES,
  'seo',
  'coverage',
]);

const MAX_CONTENT_BYTES = 128 * 1024;
const MAX_ARRAY_ITEMS = 512;
const ID = /^[a-z][a-z0-9_.:-]{2,191}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u;
const TRUTH_REF_KINDS = Object.freeze([
  'evidence',
  'assertions',
  'access_observations',
  'documentation',
  'relationships',
]);

const CONTENT_FIELDS = Object.freeze({
  asset_search: Object.freeze({
    required: ['asset_id', 'title', 'publisher', 'source', 'authority_tier', 'native_ids'],
    allowed: [
      'asset_id', 'title', 'titles', 'aliases', 'abbreviations', 'description', 'publisher', 'source',
      'authority_tier', 'native_ids', 'subjects', 'constructs', 'use_cases', 'researcher_roles',
      'geographies', 'unit_grain', 'population', 'temporal_envelope', 'access_summary',
      'freshness_summary', 'family_state', 'identity_resolution_state', 'schema_concepts',
      'identifier_namespaces', 'use_card_summary',
    ],
  }),
  release_distribution_search: Object.freeze({
    required: ['asset_id', 'release_id', 'distribution_id', 'time_coverage', 'format', 'access_route_ids'],
    allowed: [
      'asset_id', 'release_id', 'distribution_id', 'time_coverage', 'release_date', 'format', 'interface',
      'access_route_ids', 'current_access_observation_id', 'documentation_ids', 'schema_snapshot_id',
      'freshness_policy', 'title', 'description', 'geographies', 'unit_grain', 'identifier_namespaces',
    ],
  }),
  schema_field_search: Object.freeze({
    required: ['field_id', 'native_name', 'data_type', 'schema_snapshot_id', 'release_id', 'distribution_id'],
    allowed: [
      'field_id', 'native_name', 'label', 'description', 'aliases', 'data_type', 'unit', 'code_system',
      'entity_grain', 'semantic_roles', 'identifier_namespace', 'schema_snapshot_id', 'release_id',
      'distribution_id', 'asset_id',
    ],
  }),
  join_edge_search: Object.freeze({
    required: [
      'join_edge_id', 'left_field_ref', 'right_field_ref', 'left_namespace', 'right_namespace',
      'cardinality', 'operation_kind', 'evidence_state', 'compatibility', 'evidence_refs',
    ],
    allowed: [
      'join_edge_id', 'left_field_ref', 'right_field_ref', 'left_namespace', 'right_namespace',
      'normalization', 'cardinality', 'applicability', 'operation_kind', 'evidence_state', 'compatibility',
      'requirements', 'blockers', 'temporal_rules', 'confidence', 'evidence_refs', 'caveats',
    ],
  }),
  source_search: Object.freeze({
    required: ['source_id', 'title', 'organization_id', 'authority_tier', 'connector_state', 'coverage_scope'],
    allowed: [
      'source_id', 'title', 'description', 'organization_id', 'authority_tier', 'native_ids',
      'connector_state', 'coverage_scope', 'source_specific_coverage', 'subjects', 'geographies',
    ],
  }),
});

const SET_ARRAY_FIELDS = new Set([
  'abbreviations', 'access_route_ids', 'aliases', 'blockers', 'caveats', 'constructs', 'documentation_ids',
  'evidence_refs', 'geographies', 'identifier_namespaces', 'native_ids', 'requirements', 'researcher_roles',
  'schema_concepts', 'semantic_roles', 'subjects', 'titles', 'use_cases',
]);

const FORBIDDEN_CONTENT_KEYS = new Set([
  'analysis_result',
  'computed_values',
  'data_rows',
  'financial_benchmark',
  'market_share',
  'payload_bytes',
  'ranking_output',
  'row_values',
  'source_payload',
]);

export class ProjectionInvariantError extends Error {
  constructor(code, detail) {
    super(`${code}${detail ? `:${detail}` : ''}`);
    this.name = 'ProjectionInvariantError';
    this.code = code;
    this.detail = detail ?? null;
  }
}

function fail(code, detail) {
  throw new ProjectionInvariantError(code, detail);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail('PROJECTION_ID_INVALID', label);
  return value;
}

function assertTimestamp(value, label) {
  if (typeof value !== 'string' || !UTC.test(value) || Number.isNaN(Date.parse(value))) {
    fail('PROJECTION_TIMESTAMP_INVALID', label);
  }
  return value;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('PROJECTION_OBJECT_REQUIRED', label);
  }
  return value;
}

function normalizeSet(values, label) {
  if (!Array.isArray(values) || values.length > MAX_ARRAY_ITEMS) fail('PROJECTION_ARRAY_INVALID', label);
  const normalized = values.map(value => normalizeJson(value, label));
  normalized.sort((left, right) => compareText(canonicalizeJson(left), canonicalizeJson(right)));
  for (let index = 1; index < normalized.length; index += 1) {
    if (canonicalizeJson(normalized[index]) === canonicalizeJson(normalized[index - 1])) {
      fail('PROJECTION_ARRAY_DUPLICATE', label);
    }
  }
  return normalized;
}

function normalizeJson(value, label = 'value', key = null) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('PROJECTION_NON_FINITE_NUMBER', label);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) fail('PROJECTION_ARRAY_LIMIT', label);
    if (key && SET_ARRAY_FIELDS.has(key)) return normalizeSet(value, label);
    return value.map((item, index) => normalizeJson(item, `${label}/${index}`));
  }
  assertPlainObject(value, label);
  const output = {};
  for (const childKey of Object.keys(value).sort(compareText)) {
    if (FORBIDDEN_CONTENT_KEYS.has(childKey)) fail('PROJECTION_PRODUCT_BOUNDARY_VIOLATION', `${label}/${childKey}`);
    output[childKey] = normalizeJson(value[childKey], `${label}/${childKey}`, childKey);
  }
  return output;
}

function normalizeContent(documentType, content) {
  const contract = CONTENT_FIELDS[documentType];
  if (!contract) fail('PROJECTION_TYPE_UNSUPPORTED', documentType);
  assertPlainObject(content, 'content');
  const allowed = new Set(contract.allowed);
  for (const key of Object.keys(content)) if (!allowed.has(key)) fail('PROJECTION_CONTENT_FIELD_UNKNOWN', `${documentType}:${key}`);
  for (const key of contract.required) if (content[key] === undefined || content[key] === null) fail('PROJECTION_CONTENT_FIELD_REQUIRED', `${documentType}:${key}`);
  const normalized = normalizeJson(content, 'content');
  if (Buffer.byteLength(canonicalizeJson(normalized), 'utf8') > MAX_CONTENT_BYTES) fail('PROJECTION_CONTENT_BYTES_EXCEEDED', documentType);
  return normalized;
}

function sortedUniqueIds(values, label, { min = 0 } = {}) {
  if (!Array.isArray(values) || values.length < min || values.length > MAX_ARRAY_ITEMS) fail('PROJECTION_REFERENCE_ARRAY_INVALID', label);
  const output = values.map((value, index) => assertId(value, `${label}/${index}`)).sort(compareText);
  if (new Set(output).size !== output.length) fail('PROJECTION_REFERENCE_DUPLICATE', label);
  return output;
}

function normalizeTruthRefs(truthRefs) {
  assertPlainObject(truthRefs, 'truth_refs');
  const keys = Object.keys(truthRefs).sort(compareText);
  if (canonicalizeJson(keys) !== canonicalizeJson([...TRUTH_REF_KINDS].sort(compareText))) fail('PROJECTION_TRUTH_REF_KINDS_INVALID');
  const result = {};
  for (const kind of TRUTH_REF_KINDS) result[kind] = sortedUniqueIds(truthRefs[kind], `truth_refs/${kind}`);
  if (Object.values(result).every(values => values.length === 0)) fail('PROJECTION_TRUTH_REFS_EMPTY');
  return result;
}

function normalizeCanonicalRevisions(revisions) {
  if (!Array.isArray(revisions) || revisions.length < 1 || revisions.length > MAX_ARRAY_ITEMS) {
    fail('PROJECTION_CANONICAL_REVISIONS_INVALID');
  }
  const output = revisions.map((revision, index) => {
    assertPlainObject(revision, `canonical_revisions/${index}`);
    const keys = Object.keys(revision).sort(compareText);
    if (canonicalizeJson(keys) !== canonicalizeJson(['canonical_id', 'revision_id', 'revision_sha256'])) {
      fail('PROJECTION_CANONICAL_REVISION_FIELDS_INVALID', index);
    }
    assertId(revision.canonical_id, `canonical_revisions/${index}/canonical_id`);
    assertId(revision.revision_id, `canonical_revisions/${index}/revision_id`);
    if (typeof revision.revision_sha256 !== 'string' || !SHA256.test(revision.revision_sha256)) {
      fail('PROJECTION_REVISION_DIGEST_INVALID', revision.revision_id);
    }
    return { ...revision };
  }).sort((left, right) => compareText(`${left.canonical_id}\0${left.revision_id}`, `${right.canonical_id}\0${right.revision_id}`));
  if (new Set(output.map(item => `${item.canonical_id}\0${item.revision_id}`)).size !== output.length) {
    fail('PROJECTION_CANONICAL_REVISION_DUPLICATE');
  }
  return output;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function projectionCanonicalJson(document) {
  return canonicalizeJson(projectionDocumentMaterial(document));
}

export function buildProjectionDocument({
  generationId,
  documentId,
  documentType,
  projectedAt,
  canonicalRevisions,
  projectionInputRefs,
  truthRefs,
  content,
  projectionSchemaVersion = '1.0.0',
}) {
  assertId(generationId, 'generation_id');
  assertId(documentId, 'document_id');
  if (!SEARCH_PROJECTION_TYPES.includes(documentType)) fail('PROJECTION_TYPE_UNSUPPORTED', documentType);
  assertTimestamp(projectedAt, 'projected_at');
  const document = {
    projection_version: 'projection-document.v1',
    document_id: documentId,
    document_type: documentType,
    projection_schema_version: projectionSchemaVersion,
    generation_id: generationId,
    projected_at: projectedAt,
    canonical_revisions: normalizeCanonicalRevisions(canonicalRevisions),
    projection_input_refs: sortedUniqueIds(projectionInputRefs, 'projection_input_refs', { min: 1 }),
    visibility_state: 'public',
    truth_refs: normalizeTruthRefs(truthRefs),
    content: normalizeContent(documentType, content),
    source_of_truth: false,
    immutable: true,
  };
  document.document_checksum = digest('projection_document', projectionDocumentMaterial(document));
  return deepFreeze(document);
}

function exclusionFor(member, record) {
  const reasonByVisibility = {
    excluded: 'visibility_excluded',
    quarantined: 'quarantined',
    tombstoned: 'tombstoned',
    internal: 'internal_only',
  };
  const reasonCode = reasonByVisibility[member.visibility_state];
  if (!reasonCode) fail('PROJECTION_VISIBILITY_INVALID', member.visibility_state);
  const evidenceRefs = record?.exclusion_evidence_refs ?? [];
  return {
    reason_code: reasonCode,
    evidence_refs: sortedUniqueIds(evidenceRefs, 'exclusion_evidence_refs', { min: 1 }),
    absence_claim_permitted: false,
  };
}

function acknowledgementId(generationId, member, componentKind) {
  const value = canonicalSha256({
    identifier_kind: 'projection_acknowledgement',
    generation_id: generationId,
    canonical_id: member.canonical_id,
    revision_id: member.revision_id,
    component_kind: componentKind,
  }).value;
  return `ack:${componentKind}:${value.slice(0, 32)}`;
}

function normalizeMember(member) {
  assertPlainObject(member, 'member');
  assertId(member.canonical_id, 'member/canonical_id');
  assertId(member.revision_id, 'member/revision_id');
  if (!SHA256.test(member.revision_sha256 ?? '')) fail('PROJECTION_REVISION_DIGEST_INVALID', member.revision_id);
  if (!Array.isArray(member.projection_obligations) || member.projection_obligations.length < 1
      || member.projection_obligations.some(kind => !PUBLICATION_COMPONENT_TYPES.includes(kind))
      || new Set(member.projection_obligations).size !== member.projection_obligations.length) {
    fail('PROJECTION_OBLIGATIONS_INVALID', member.canonical_id);
  }
  if (!['public', 'excluded', 'quarantined', 'tombstoned', 'internal'].includes(member.visibility_state)) {
    fail('PROJECTION_VISIBILITY_INVALID', member.visibility_state);
  }
  return member;
}

function validateCanonicalManifest(canonicalManifest) {
  assertPlainObject(canonicalManifest, 'canonical_manifest');
  assertId(canonicalManifest.manifest_id, 'canonical_manifest/manifest_id');
  if (canonicalManifest.selection_model !== 'exact_immutable_revision_membership' || canonicalManifest.immutable !== true
      || !Array.isArray(canonicalManifest.members) || canonicalManifest.members.length < 1) {
    fail('CANONICAL_MANIFEST_POLICY_INVALID');
  }
  const normalizedMembers = canonicalManifest.members.map(normalizeMember);
  const memberKeys = normalizedMembers.map(member => `${member.canonical_id}\0${member.revision_id}`);
  if (new Set(memberKeys).size !== memberKeys.length) fail('CANONICAL_MANIFEST_MEMBER_DUPLICATE');
  if (new Set(normalizedMembers.map(member => member.canonical_id)).size !== normalizedMembers.length
      || new Set(normalizedMembers.map(member => member.revision_id)).size !== normalizedMembers.length) {
    fail('CANONICAL_MANIFEST_REVISION_MEMBERSHIP_NOT_EXACT');
  }
  const obligationCount = normalizedMembers.reduce((sum, member) => sum + member.projection_obligations.length, 0);
  if (canonicalManifest.revision_count !== normalizedMembers.length
      || canonicalManifest.projection_obligation_count !== obligationCount) {
    fail('CANONICAL_MANIFEST_COUNT_MISMATCH');
  }
  const expectedDigest = digest('canonical_revision_membership', membershipMaterial(canonicalManifest));
  if (canonicalManifest.membership_digest?.digest_type !== expectedDigest.digest_type
      || canonicalManifest.membership_digest?.algorithm !== expectedDigest.algorithm
      || canonicalManifest.membership_digest?.value !== expectedDigest.value) {
    fail('CANONICAL_MANIFEST_DIGEST_MISMATCH');
  }
  return { members: normalizedMembers, digest: expectedDigest };
}

export function buildProjectionGeneration({ generationId, componentKind, canonicalManifest, records, projectedAt }) {
  assertId(generationId, 'generation_id');
  if (!SEARCH_PROJECTION_TYPES.includes(componentKind)) fail('PROJECTION_TYPE_UNSUPPORTED', componentKind);
  const validatedManifest = validateCanonicalManifest(canonicalManifest);
  assertTimestamp(projectedAt, 'projected_at');
  if (!Array.isArray(records)) fail('PROJECTION_RECORDS_INVALID');
  const allMembers = new Map(validatedManifest.members.map(member => [`${member.canonical_id}\0${member.revision_id}`, member]));
  for (const record of records) {
    assertPlainObject(record, 'record');
    assertId(record.canonical_id, 'record/canonical_id');
    assertId(record.revision_id, 'record/revision_id');
    const member = allMembers.get(`${record.canonical_id}\0${record.revision_id}`);
    if (!member) fail('PROJECTION_RECORD_OUTSIDE_W1', `${record.canonical_id}:${record.revision_id}`);
    if (member.visibility_state === 'public'
        && (!SEARCH_PROJECTION_TYPES.includes(record.document_type) || !member.projection_obligations.includes(record.document_type))) {
      fail('PROJECTION_RECORD_OBLIGATION_MISMATCH', record.canonical_id);
    }
    if (member.visibility_state !== 'public' && record.document_type !== undefined) {
      fail('NONPUBLIC_PROJECTION_RECORD_DOCUMENT_FORBIDDEN', record.canonical_id);
    }
  }
  const recordMap = new Map(records.map(record => [`${record.canonical_id}\0${record.revision_id}`, record]));
  if (recordMap.size !== records.length) fail('PROJECTION_RECORD_DUPLICATE');
  const documents = [];
  const acknowledgements = [];
  const members = [...validatedManifest.members]
    .filter(member => member.projection_obligations.includes(componentKind))
    .sort((left, right) => compareText(`${left.canonical_id}\0${left.revision_id}`, `${right.canonical_id}\0${right.revision_id}`));

  for (const member of members) {
    const record = recordMap.get(`${member.canonical_id}\0${member.revision_id}`);
    const acknowledgement = {
      acknowledgement_version: 'projection-acknowledgement.v1',
      acknowledgement_id: acknowledgementId(generationId, member, componentKind),
      generation_id: generationId,
      component_kind: componentKind,
      canonical_manifest_id: canonicalManifest.manifest_id,
      canonical_id: member.canonical_id,
      revision_id: member.revision_id,
      visibility_state: member.visibility_state,
      result: member.visibility_state === 'public' ? 'projected' : 'excluded',
      document_refs: [],
      exclusion: null,
      acknowledged_at: projectedAt,
      immutable: true,
    };
    if (member.visibility_state === 'public') {
      if (!record) continue;
      if (record.document_type !== componentKind) fail('PROJECTION_RECORD_TYPE_MISMATCH', member.canonical_id);
      const document = buildProjectionDocument({
        generationId,
        documentId: record.document_id,
        documentType: componentKind,
        projectedAt,
        canonicalRevisions: [{
          canonical_id: member.canonical_id,
          revision_id: member.revision_id,
          revision_sha256: member.revision_sha256,
        }, ...(record.additional_canonical_revisions ?? [])],
        projectionInputRefs: record.projection_input_refs,
        truthRefs: record.truth_refs,
        content: record.content,
      });
      documents.push(document);
      acknowledgement.document_refs = [{ document_id: document.document_id, document_checksum: document.document_checksum }];
    } else {
      acknowledgement.exclusion = exclusionFor(member, record);
    }
    acknowledgements.push(deepFreeze(acknowledgement));
  }
  documents.sort((left, right) => compareText(left.document_id, right.document_id));
  acknowledgements.sort((left, right) => compareText(`${left.canonical_id}\0${left.revision_id}`, `${right.canonical_id}\0${right.revision_id}`));
  return deepFreeze({
    generation_id: generationId,
    component_kind: componentKind,
    canonical_manifest_id: canonicalManifest.manifest_id,
    state: 'building',
    documents,
    acknowledgements,
  });
}

function inventoryHas(referenceInventory, kind, id) {
  const values = referenceInventory?.[kind];
  return values instanceof Set ? values.has(id) : Array.isArray(values) && values.includes(id);
}

export function reconcileProjectionGeneration({ build, canonicalManifest, referenceInventory }) {
  const findings = [];
  const expected = [...canonicalManifest.members]
    .filter(member => member.projection_obligations.includes(build.component_kind))
    .sort((left, right) => compareText(`${left.canonical_id}\0${left.revision_id}`, `${right.canonical_id}\0${right.revision_id}`));
  const members = new Map(expected.map(member => [`${member.canonical_id}\0${member.revision_id}`, member]));
  const documents = new Map();
  for (const document of build.documents) {
    if (documents.has(document.document_id)) findings.push({ code: 'DUPLICATE_DOCUMENT', detail: document.document_id });
    documents.set(document.document_id, document);
    if (document.generation_id !== build.generation_id || document.document_type !== build.component_kind) {
      findings.push({ code: 'DOCUMENT_GENERATION_MISMATCH', detail: document.document_id });
    }
    const expectedChecksum = digest('projection_document', projectionDocumentMaterial(document));
    if (expectedChecksum.value !== document.document_checksum?.value) findings.push({ code: 'DOCUMENT_CHECKSUM_MISMATCH', detail: document.document_id });
    if (document.visibility_state !== 'public') findings.push({ code: 'NONPUBLIC_DOCUMENT_PRESENT', detail: document.document_id });
    for (const revision of document.canonical_revisions) {
      const member = members.get(`${revision.canonical_id}\0${revision.revision_id}`)
        ?? canonicalManifest.members.find(candidate => candidate.canonical_id === revision.canonical_id && candidate.revision_id === revision.revision_id);
      if (!member || member.revision_sha256 !== revision.revision_sha256) findings.push({ code: 'DOCUMENT_REVISION_UNRESOLVED', detail: document.document_id });
      else if (member.visibility_state !== 'public') findings.push({ code: 'DOCUMENT_REVISION_NOT_PUBLIC', detail: document.document_id });
    }
    for (const [kind, ids] of Object.entries(document.truth_refs)) {
      for (const id of ids) if (!inventoryHas(referenceInventory, kind, id)) findings.push({ code: 'TRUTH_REFERENCE_UNRESOLVED', detail: `${kind}:${id}` });
    }
  }

  const acknowledgementKeys = new Map();
  const referencedDocuments = new Set();
  for (const acknowledgement of build.acknowledgements) {
    const key = `${acknowledgement.canonical_id}\0${acknowledgement.revision_id}`;
    acknowledgementKeys.set(key, (acknowledgementKeys.get(key) ?? 0) + 1);
    const member = members.get(key);
    if (!member) findings.push({ code: 'UNEXPECTED_ACKNOWLEDGEMENT', detail: key });
    else if (acknowledgement.visibility_state !== member.visibility_state) findings.push({ code: 'ACKNOWLEDGEMENT_VISIBILITY_MISMATCH', detail: key });
    if (member?.visibility_state === 'public' && acknowledgement.result !== 'projected') findings.push({ code: 'PUBLIC_OBLIGATION_NOT_PROJECTED', detail: key });
    if (member?.visibility_state !== 'public' && acknowledgement.result !== 'excluded') findings.push({ code: 'NONPUBLIC_OBLIGATION_NOT_EXCLUDED', detail: key });
    if (acknowledgement.result === 'excluded' && acknowledgement.exclusion?.absence_claim_permitted !== false) {
      findings.push({ code: 'EXCLUSION_ABSENCE_OVERCLAIM', detail: key });
    }
    for (const reference of acknowledgement.document_refs) {
      referencedDocuments.add(reference.document_id);
      const document = documents.get(reference.document_id);
      if (!document) findings.push({ code: 'ACKNOWLEDGED_DOCUMENT_UNRESOLVED', detail: reference.document_id });
      else if (document.document_checksum.value !== reference.document_checksum?.value) findings.push({ code: 'ACKNOWLEDGED_CHECKSUM_MISMATCH', detail: reference.document_id });
    }
  }
  for (const member of expected) {
    const key = `${member.canonical_id}\0${member.revision_id}`;
    if (acknowledgementKeys.get(key) !== 1) findings.push({ code: 'PROJECTION_OBLIGATION_ACK_COUNT_INVALID', detail: `${key}:${acknowledgementKeys.get(key) ?? 0}` });
  }
  for (const documentId of documents.keys()) if (!referencedDocuments.has(documentId)) findings.push({ code: 'DOCUMENT_NOT_ACKNOWLEDGED', detail: documentId });

  findings.sort((left, right) => compareText(`${left.code}\0${left.detail}`, `${right.code}\0${right.detail}`));
  const projected = build.acknowledgements.filter(item => item.result === 'projected').length;
  const excluded = build.acknowledgements.filter(item => item.result === 'excluded').length;
  return deepFreeze({
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    generation_id: build.generation_id,
    expected_obligations: expected.length,
    acknowledgement_count: build.acknowledgements.length,
    document_count: build.documents.length,
    projected,
    excluded,
    findings,
  });
}

export function sealProjectionGeneration({
  build,
  canonicalManifestRef,
  referenceInventory,
  canonicalManifest,
  projectorFingerprint,
  sealedAt,
  retainedUntil,
}) {
  if (!SHA256.test(projectorFingerprint ?? '')) fail('PROJECTOR_FINGERPRINT_INVALID');
  assertTimestamp(sealedAt, 'sealed_at');
  assertTimestamp(retainedUntil, 'retained_until');
  if (Date.parse(retainedUntil) < Date.parse(sealedAt)) fail('GENERATION_RETENTION_BEFORE_SEAL');
  const validatedManifest = validateCanonicalManifest(canonicalManifest);
  if (canonicalManifestRef?.manifest_id !== canonicalManifest.manifest_id
      || canonicalManifestRef?.digest?.digest_type !== validatedManifest.digest.digest_type
      || canonicalManifestRef?.digest?.algorithm !== validatedManifest.digest.algorithm
      || canonicalManifestRef?.digest?.value !== validatedManifest.digest.value) {
    fail('CANONICAL_MANIFEST_REFERENCE_MISMATCH');
  }
  const reconciliation = reconcileProjectionGeneration({ build, canonicalManifest, referenceInventory });
  if (reconciliation.status !== 'PASS') fail('GENERATION_RECONCILIATION_FAILED', canonicalizeJson(reconciliation.findings));
  const documentRefs = build.documents.map(document => ({
    document_id: document.document_id,
    document_checksum: document.document_checksum,
  })).sort((left, right) => compareText(left.document_id, right.document_id));
  const component = {
    manifest_version: 'component-generation-manifest.v1',
    generation_id: build.generation_id,
    component_kind: build.component_kind,
    sealed_state: 'validated',
    canonical_manifest_ref: canonicalManifestRef,
    projector: { version: SEARCH_PROJECTOR_VERSION, fingerprint: projectorFingerprint },
    projection_schema_version: '1.0.0',
    build_strategy: 'complete_as_of_exact_revision_manifest',
    document_count: build.documents.length,
    acknowledgement_count: build.acknowledgements.length,
    projected_count: reconciliation.projected,
    excluded_count: reconciliation.excluded,
    document_refs: documentRefs,
    acknowledgement_ids: build.acknowledgements.map(item => item.acknowledgement_id).sort(compareText),
    projection_set_checksum: null,
    component_checksum: null,
    sealed_at: sealedAt,
    retention: {
      retained_until: retainedUntil,
      pin_behavior_before_expiry: 'serve_pinned',
      pin_behavior_after_expiry: 'restart_required',
      physical_expiry_requires_audit: true,
    },
    immutable: true,
  };
  component.projection_set_checksum = digest('projection_set', projectionSetMaterial(component));
  component.component_checksum = digest('component_generation', componentMaterial(component, build.acknowledgements));
  return deepFreeze({ component, reconciliation, documents: build.documents, acknowledgements: build.acknowledgements });
}

export function mergeIncrementalProjectionChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) fail('INCREMENTAL_CHUNKS_REQUIRED');
  const first = chunks[0];
  const documents = new Map();
  const acknowledgements = new Map();
  for (const chunk of chunks) {
    if (chunk.generation_id !== first.generation_id || chunk.component_kind !== first.component_kind || chunk.canonical_manifest_id !== first.canonical_manifest_id) {
      fail('INCREMENTAL_CHUNK_SCOPE_MISMATCH');
    }
    for (const document of chunk.documents) {
      const prior = documents.get(document.document_id);
      if (prior && canonicalizeJson(prior) !== canonicalizeJson(document)) fail('INCREMENTAL_DOCUMENT_CONFLICT', document.document_id);
      documents.set(document.document_id, document);
    }
    for (const acknowledgement of chunk.acknowledgements) {
      const key = `${acknowledgement.canonical_id}\0${acknowledgement.revision_id}`;
      const prior = acknowledgements.get(key);
      if (prior && canonicalizeJson(prior) !== canonicalizeJson(acknowledgement)) fail('INCREMENTAL_ACKNOWLEDGEMENT_CONFLICT', key);
      acknowledgements.set(key, acknowledgement);
    }
  }
  return deepFreeze({
    generation_id: first.generation_id,
    component_kind: first.component_kind,
    canonical_manifest_id: first.canonical_manifest_id,
    state: 'building',
    documents: [...documents.values()].sort((left, right) => compareText(left.document_id, right.document_id)),
    acknowledgements: [...acknowledgements.values()].sort((left, right) => compareText(`${left.canonical_id}\0${left.revision_id}`, `${right.canonical_id}\0${right.revision_id}`)),
  });
}
