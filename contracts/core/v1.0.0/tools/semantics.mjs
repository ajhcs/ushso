import { recordId } from './common.mjs';

const FORBIDDEN_KEYS = new Set(['payload', 'body', 'response_body', 'raw_body', 'dataset_rows', 'data_payload']);
const ROLE_SET = new Set(['repository', 'catalog', 'source', 'dataset', 'distribution', 'service', 'documentation', 'version', 'capture', 'organization']);

function scanForbidden(value, at, errors) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) errors.push(`${at}: prohibited payload key ${key}`);
    scanForbidden(child, `${at}/${key}`, errors);
  }
}

function validateSupersession(rows, idField, errors) {
  const byId = new Map(rows.map(row => [row[idField], row]));
  for (const row of rows) {
    const id = row[idField];
    const supersession = row.supersession;
    if (row.status === 'superseded' && !supersession.superseded_by_id) errors.push(`${id}: superseded status requires superseded_by_id`);
    if (row.status !== 'superseded' && supersession.superseded_by_id) errors.push(`${id}: only superseded rows may have superseded_by_id`);
    if ((supersession.superseded_by_id || supersession.supersedes_ids.length) && !supersession.rationale) errors.push(`${id}: supersession references require rationale`);
    if (supersession.superseded_by_id) {
      const next = byId.get(supersession.superseded_by_id);
      if (!next) errors.push(`${id}: unknown superseded_by_id ${supersession.superseded_by_id}`);
      else if (!next.supersession.supersedes_ids.includes(id)) errors.push(`${id}: supersession is not bidirectional`);
    }
    for (const oldId of supersession.supersedes_ids) {
      const old = byId.get(oldId);
      if (!old) errors.push(`${id}: unknown supersedes id ${oldId}`);
      else if (old.supersession.superseded_by_id !== id) errors.push(`${id}: supersedes link is not bidirectional for ${oldId}`);
    }
    const seen = new Set([id]);
    let cursor = row;
    while (cursor.supersession.superseded_by_id) {
      const nextId = cursor.supersession.superseded_by_id;
      if (seen.has(nextId)) { errors.push(`${id}: supersession cycle`); break; }
      seen.add(nextId);
      cursor = byId.get(nextId);
      if (!cursor) break;
    }
  }
}

export function semanticErrors(collections, projection = null) {
  const errors = [];
  const { objects, assertions, access, evidence, relationships } = collections;
  const all = [...objects, ...assertions, ...access, ...evidence, ...relationships];
  for (const row of all) scanForbidden(row, recordId(row), errors);
  const allIds = new Set();
  for (const row of all) { const id = recordId(row); if (allIds.has(id)) errors.push(`duplicate core ID ${id}`); allIds.add(id); }
  const objectById = new Map(objects.map(row => [row.object_id, row]));
  const evidenceById = new Map(evidence.map(row => [row.evidence_id, row]));
  const roles = new Set(objects.map(row => row.role));
  for (const role of ROLE_SET) if (!roles.has(role)) errors.push(`fixture role missing: ${role}`);
  for (const object of objects) {
    for (const native of object.native_identifiers) {
      if (native.preservation !== 'exact') errors.push(`${object.object_id}: native identifier is not exact-preserved`);
      if (!objectById.has(native.source_object_id)) errors.push(`${object.object_id}: unknown native identifier source ${native.source_object_id}`);
      for (const id of native.evidence_ids) if (!evidenceById.has(id)) errors.push(`${object.object_id}: unknown native identifier evidence ${id}`);
    }
    for (const id of object.evidence_ids) if (!evidenceById.has(id)) errors.push(`${object.object_id}: unknown evidence ${id}`);
  }
  for (const row of [...assertions, ...access, ...relationships]) {
    if (!objectById.has(row.subject_id)) errors.push(`${recordId(row)}: unknown subject ${row.subject_id}`);
    if (row.origin.origin_object_id && !objectById.has(row.origin.origin_object_id)) errors.push(`${recordId(row)}: unknown origin object ${row.origin.origin_object_id}`);
    for (const id of row.evidence_ids) if (!evidenceById.has(id)) errors.push(`${recordId(row)}: unknown evidence ${id}`);
  }
  for (const row of relationships) {
    if (!objectById.has(row.object_id)) errors.push(`${row.relationship_id}: unknown relationship object ${row.object_id}`);
    if (row.predicate === 'identity_candidate_for' && (row.status !== 'unresolved' || !['low', 'unknown'].includes(row.confidence.band))) errors.push(`${row.relationship_id}: identity candidate must remain unresolved and low/unknown confidence`);
  }
  for (const row of evidence) {
    if (row.capture_object_id && objectById.get(row.capture_object_id)?.role !== 'capture') errors.push(`${row.evidence_id}: capture_object_id must reference a capture role`);
  }
  validateSupersession(assertions, 'assertion_id', errors);
  validateSupersession(access, 'observation_id', errors);
  validateSupersession(relationships, 'relationship_id', errors);
  if (projection) {
    for (const id of projection.core_subject_ids) if (!objectById.has(id)) errors.push(`projection: unknown core subject ${id}`);
    const sets = [new Set(assertions.map(r => r.assertion_id)), new Set(access.map(r => r.observation_id)), evidenceById, new Set(relationships.map(r => r.relationship_id))];
    for (const [field, set] of [['assertion_ids', sets[0]], ['access_observation_ids', sets[1]], ['evidence_ids', sets[2]], ['relationship_ids', sets[3]]]) for (const id of projection[field]) if (!set.has(id)) errors.push(`projection: unknown ${field} value ${id}`);
    if (projection.source_of_truth !== false || projection.view_role !== 'denormalized_discovery_search_view') errors.push('projection must explicitly be a non-truth denormalized search view');
  }
  return [...new Set(errors)];
}
