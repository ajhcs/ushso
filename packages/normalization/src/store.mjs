import { contentFingerprint } from './canonical.mjs';
import { COLLECTIONS } from './constants.mjs';

function cloneMap(map) {
  return new Map([...map].map(([key, value]) => [key, structuredClone(value)]));
}

function emptyState() {
  return {
    batches: new Map(),
    batchEvents: [],
    entities: new Map(),
    revisions: new Map(),
    aliases: new Map(),
    projections: new Map()
  };
}

function stateClone(state) {
  return {
    batches: cloneMap(state.batches),
    batchEvents: structuredClone(state.batchEvents),
    entities: cloneMap(state.entities),
    revisions: cloneMap(state.revisions),
    aliases: cloneMap(state.aliases),
    projections: cloneMap(state.projections)
  };
}

function rowEntries(bundle) {
  return COLLECTIONS.flatMap(collection => (bundle[collection] ?? []).map(row => ({ collection, row })));
}

function assertImportDocument(document) {
  if (!document || typeof document !== 'object') throw new TypeError('IMPORT_DOCUMENT_REQUIRED');
  if (typeof document.import_id !== 'string' || typeof document.document_fingerprint !== 'string') throw new TypeError('IMPORT_DOCUMENT_IDENTITY_REQUIRED');
  const expected = contentFingerprint({ ...document, document_fingerprint: null });
  if (expected !== document.document_fingerprint) throw new Error('IMPORT_DOCUMENT_FINGERPRINT_MISMATCH');
  if (document.plan.import_id !== document.import_id) throw new Error('IMPORT_PLAN_ID_MISMATCH');
  if (document.plan.record_mappings.length !== document.legacy_projection.records.length) throw new Error('IMPORT_RECORD_RECONCILIATION_MISMATCH');
  if (document.plan.join_route_mappings.length !== document.legacy_projection.join_routes.length) throw new Error('IMPORT_ROUTE_RECONCILIATION_MISMATCH');
  if (document.plan.record_mappings.some(row => row.disposition !== 'accepted' && !row.rejection_code)) throw new Error('IMPORT_REJECTION_CODE_REQUIRED');
  if (document.plan.join_route_mappings.some(row => row.disposition !== 'accepted' && !row.rejection_code)) throw new Error('IMPORT_REJECTION_CODE_REQUIRED');
}

export class InMemoryCanonicalImportStore {
  #state = emptyState();

  snapshot() {
    return stateClone(this.#state);
  }

  apply(document) {
    assertImportDocument(document);
    const prior = this.#state.batches.get(document.import_id);
    if (prior) {
      if (prior.document_fingerprint !== document.document_fingerprint) throw new Error('IMPORT_ID_CONTENT_CONFLICT');
      if (prior.state === 'rejected') throw new Error('REJECTED_IMPORT_CANNOT_BE_REAPPLIED');
      return Object.freeze({ status: 'already_applied', import_id: document.import_id, new_logical_rows: 0, state: prior.state });
    }

    const next = stateClone(this.#state);
    const batch = {
      import_id: document.import_id,
      document_fingerprint: document.document_fingerprint,
      source_content_fingerprint: document.source_content_fingerprint,
      state: 'prepared',
      projection_eligible: false,
      created_at: document.plan.created_at,
      applied_at: null,
      rejected_at: null,
      rejection_reason: null
    };
    next.batches.set(document.import_id, batch);
    next.batchEvents.push({ import_id: document.import_id, from_state: null, to_state: 'prepared', recorded_at: document.plan.created_at, reason: 'deterministic import staged' });

    let newLogicalRows = 0;
    for (const { collection, row } of rowEntries(document.bundle)) {
      const existingEntity = next.entities.get(row.entity_id);
      if (existingEntity && existingEntity.entity_type !== row.entity_type) throw new Error(`ENTITY_TYPE_CONFLICT:${row.entity_id}`);
      if (!existingEntity) {
        next.entities.set(row.entity_id, { entity_id: row.entity_id, entity_type: row.entity_type, first_import_id: document.import_id });
        newLogicalRows += 1;
      }
      const existingRevision = next.revisions.get(row.revision_id);
      if (existingRevision && contentFingerprint(existingRevision.row) !== contentFingerprint(row)) throw new Error(`REVISION_CONTENT_CONFLICT:${row.revision_id}`);
      if (!existingRevision) next.revisions.set(row.revision_id, { collection, import_id: document.import_id, row: structuredClone(row) });
      for (const alias of row.legacy_aliases ?? []) {
        const incumbent = next.aliases.get(alias);
        if (incumbent && incumbent.entity_id !== row.entity_id) throw new Error(`LEGACY_ALIAS_CONFLICT:${alias}`);
        if (!incumbent) next.aliases.set(alias, { alias, entity_id: row.entity_id, first_import_id: document.import_id, permanent: true });
      }
    }
    next.projections.set(document.import_id, structuredClone(document.legacy_projection));
    batch.state = 'applied';
    batch.projection_eligible = true;
    batch.applied_at = document.plan.created_at;
    next.batchEvents.push({ import_id: document.import_id, from_state: 'prepared', to_state: 'applied', recorded_at: document.plan.created_at, reason: 'atomic import committed' });
    this.#state = next;
    return Object.freeze({
      status: 'applied', import_id: document.import_id, new_logical_rows: newLogicalRows,
      new_revisions: rowEntries(document.bundle).length,
      record_count: document.legacy_projection.records.length,
      join_route_count: document.legacy_projection.join_routes.length
    });
  }

  rejectBatch(importId, { reason, auditEventId, recordedAt }) {
    if (typeof reason !== 'string' || reason.trim().length < 3) throw new TypeError('REJECTION_REASON_REQUIRED');
    if (typeof auditEventId !== 'string' || auditEventId.length < 3) throw new TypeError('AUDIT_EVENT_ID_REQUIRED');
    const next = stateClone(this.#state);
    const batch = next.batches.get(importId);
    if (!batch) throw new Error('IMPORT_BATCH_NOT_FOUND');
    if (batch.state === 'rejected') return Object.freeze({ status: 'already_rejected', import_id: importId, deleted_rows: 0 });
    if (!['prepared', 'applied'].includes(batch.state)) throw new Error(`IMPORT_BATCH_REJECTION_INVALID_STATE:${batch.state}`);
    const from = batch.state;
    batch.state = 'rejected';
    batch.projection_eligible = false;
    batch.rejected_at = recordedAt;
    batch.rejection_reason = reason;
    next.batchEvents.push({ import_id: importId, from_state: from, to_state: 'rejected', recorded_at: recordedAt, reason, audit_event_id: auditEventId });
    this.#state = next;
    return Object.freeze({
      status: 'rejected', import_id: importId, deleted_rows: 0,
      preserved_entities: next.entities.size, preserved_revisions: next.revisions.size,
      preserved_aliases: next.aliases.size, preserved_projection_for_audit: next.projections.has(importId)
    });
  }

  projection(importId) {
    const batch = this.#state.batches.get(importId);
    if (!batch || batch.state !== 'applied' || !batch.projection_eligible) return null;
    return structuredClone(this.#state.projections.get(importId));
  }
}
