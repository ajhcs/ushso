import { contentFingerprint, fingerprintTruthRevision } from '../../../contracts/core/v2.0.0/tools/common.mjs';
import {
  APPEND_ONLY_PERSISTENCE_PROFILE_VERSION,
  COLLECTIONS,
  INCREMENTAL_ENVELOPE_VERSION,
  INCREMENTAL_IMPORT_CONTRACT_VERSION,
  INCREMENTAL_IMPORT_PLAN_VERSION
} from './constants.mjs';

const CORE_BUNDLE_VERSION = 'observatory-core-fixture-bundle.v2.0.0';
const INCREMENTAL_BUNDLE_VERSION = 'ushso-normalization-incremental-revision-bundle.v1.0.0';

function rowsOf(bundle) {
  return COLLECTIONS.flatMap(collection => (bundle?.[collection] ?? []).map(row => ({ collection, row })));
}

function canonicalCounts(bundle) {
  return Object.fromEntries(COLLECTIONS.map(collection => [collection, bundle?.[collection]?.length ?? 0]));
}

function error(code, path, message) {
  return { code, path, message };
}

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBlankStoredHistory(row) {
  return row?.history?.append_only === true
    && Array.isArray(row.history.supersedes_revision_ids)
    && row.history.supersedes_revision_ids.length === 0
    && row.history.superseded_by_revision_id === null
    && row.history.rationale === null
    && row.lifecycle_state !== 'superseded'
    && row?.clocks?.superseded_at === null;
}

function edgeKey(edge) {
  return `${edge.prior_revision_id}\u0000${edge.successor_revision_id}`;
}

export const APPEND_ONLY_PERSISTENCE_PROFILE = Object.freeze({
  profile_version: APPEND_ONLY_PERSISTENCE_PROFILE_VERSION,
  snapshot_contract: 'observatory-core.v2.0.0',
  stored_revision_semantics: 'immutable-current-form',
  supersession_semantics: 'external-append-only-edge',
  prior_resolution: 'database-exact-revision-and-content-digest',
  materialization_contract: 'core-v2-self-contained-bidirectional-snapshot'
});

export function incrementalEnvelopeErrors(document, {
  priorRevisions = new Map(),
  selectedHeads = new Map(),
  existingEdges = []
} = {}) {
  const errors = [];
  if (document?.envelope_version !== INCREMENTAL_ENVELOPE_VERSION) {
    errors.push(error('PERSISTENCE_ENVELOPE_VERSION', '/envelope_version', 'unsupported incremental envelope version'));
  }
  if (document?.contract_version !== INCREMENTAL_IMPORT_CONTRACT_VERSION) {
    errors.push(error('PERSISTENCE_CONTRACT_VERSION', '/contract_version', 'unsupported incremental import contract'));
  }
  if (contentFingerprint({ ...document, document_fingerprint: null }) !== document?.document_fingerprint) {
    errors.push(error('PERSISTENCE_DOCUMENT_DIGEST_MISMATCH', '/document_fingerprint', 'document fingerprint does not bind the exact envelope'));
  }
  if (contentFingerprint(document?.bundle) !== document?.plan?.bundle_fingerprint) {
    errors.push(error('PERSISTENCE_BUNDLE_DIGEST_MISMATCH', '/plan/bundle_fingerprint', 'bundle fingerprint does not bind the exact incremental rows'));
  }
  if (contentFingerprint(document?.legacy_projection) !== document?.plan?.projection_fingerprint) {
    errors.push(error('PERSISTENCE_CONTEXT_DIGEST_MISMATCH', '/plan/projection_fingerprint', 'projection context fingerprint mismatch'));
  }
  if (document?.plan?.import_id !== document?.import_id
      || document?.plan?.source?.content_fingerprint_sha256 !== document?.source_content_fingerprint) {
    errors.push(error('PERSISTENCE_IDENTITY_MISMATCH', '/plan', 'plan identity does not match its envelope'));
  }
  if (contentFingerprint(document?.legacy_projection?.corpus) !== document?.projection_row_fingerprints?.corpus) {
    errors.push(error('PERSISTENCE_CONTEXT_ROW_DIGEST_MISMATCH', '/projection_row_fingerprints/corpus', 'context row digest mismatch'));
  }

  const entries = rowsOf(document?.bundle);
  const newByRevision = new Map();
  const newByEntity = new Map();
  for (const { collection, row } of entries) {
    const path = `/bundle/${collection}/${row?.revision_id ?? '?'}`;
    if (newByRevision.has(row?.revision_id)) errors.push(error('PERSISTENCE_DUPLICATE_REVISION', `${path}/revision_id`, 'revision ID occurs more than once'));
    newByRevision.set(row?.revision_id, row);
    const entityRows = newByEntity.get(row?.entity_id) ?? [];
    entityRows.push(row);
    newByEntity.set(row?.entity_id, entityRows);
    if (fingerprintTruthRevision(row) !== row?.canonical_content_fingerprint) {
      errors.push(error('PERSISTENCE_REVISION_DIGEST_MISMATCH', `${path}/canonical_content_fingerprint`, 'stored revision fingerprint mismatch'));
    }
    if (!isBlankStoredHistory(row)) {
      errors.push(error('PERSISTENCE_SNAPSHOT_HISTORY_EMBEDDED', `${path}/history`, 'incremental rows must remain immutable current-form facts; history belongs in external edges'));
    }
    if (row?.lineage?.import_id !== document?.import_id) {
      errors.push(error('PERSISTENCE_LINEAGE_IMPORT_MISMATCH', `${path}/lineage/import_id`, 'row lineage must name this import'));
    }
  }
  for (const [entityId, entityRows] of newByEntity) {
    if (entityRows.length !== 1) errors.push(error('PERSISTENCE_MULTIPLE_ENTITY_REVISIONS', `/bundle/${entityId}`, 'one incremental envelope may add at most one revision per entity'));
  }
  const expectedCounts = canonicalCounts(document?.bundle);
  if (contentFingerprint(expectedCounts) !== contentFingerprint(document?.plan?.canonical_counts)) {
    errors.push(error('PERSISTENCE_CANONICAL_COUNT_MISMATCH', '/plan/canonical_counts', 'canonical counts do not match incremental rows'));
  }

  const allEdges = [...existingEdges];
  const seenNewEdges = new Set();
  const successorByPrior = new Map(existingEdges.map(edge => [edge.prior_revision_id, edge.successor_revision_id]));
  const priorBySuccessor = new Map(existingEdges.map(edge => [edge.successor_revision_id, edge.prior_revision_id]));
  const newEdgeBySuccessor = new Map();
  for (const [index, edge] of (document?.supersession_edges ?? []).entries()) {
    const path = `/supersession_edges/${index}`;
    if (seenNewEdges.has(edgeKey(edge))) errors.push(error('PERSISTENCE_EDGE_DUPLICATE', path, 'duplicate supersession edge'));
    seenNewEdges.add(edgeKey(edge));
    const prior = priorRevisions.get(edge.prior_revision_id);
    const successor = newByRevision.get(edge.successor_revision_id);
    if (!prior) {
      errors.push(error('PERSISTENCE_PRIOR_MISSING', `${path}/prior_revision_id`, 'prior revision must be resolved from immutable persistence'));
    } else {
      if (prior.canonical_content_fingerprint !== edge.prior_canonical_content_fingerprint) {
        errors.push(error('PERSISTENCE_PRIOR_DIGEST_MISMATCH', `${path}/prior_canonical_content_fingerprint`, 'prior digest does not match the stored row'));
      }
      if (prior.entity_id !== edge.entity_id) errors.push(error('PERSISTENCE_EDGE_ENTITY_MISMATCH', `${path}/entity_id`, 'prior revision belongs to another entity'));
    }
    if (!successor) {
      errors.push(error('PERSISTENCE_SUCCESSOR_MISSING', `${path}/successor_revision_id`, 'successor must be a row in this envelope'));
    } else {
      if (successor.entity_id !== edge.entity_id || (prior && successor.entity_type !== prior.entity_type)) {
        errors.push(error('PERSISTENCE_EDGE_ENTITY_MISMATCH', path, 'edge endpoints must revise the same entity and type'));
      }
      const priorRecorded = timestamp(prior?.clocks?.recorded_at);
      const successorRecorded = timestamp(successor.clocks?.recorded_at);
      const supersededAt = timestamp(edge.superseded_at);
      if (priorRecorded === null || successorRecorded === null || supersededAt === null
          || successorRecorded <= priorRecorded || supersededAt < successorRecorded) {
        errors.push(error('PERSISTENCE_EDGE_CLOCK_NOT_MONOTONIC', `${path}/superseded_at`, 'prior < successor <= superseded_at is required'));
      }
    }
    if (edge.prior_revision_id === edge.successor_revision_id) errors.push(error('PERSISTENCE_EDGE_CYCLE', path, 'self-cycle is forbidden'));
    const incumbentSuccessor = successorByPrior.get(edge.prior_revision_id);
    if (incumbentSuccessor && incumbentSuccessor !== edge.successor_revision_id) {
      errors.push(error('PERSISTENCE_EDGE_FORK', path, 'a prior revision may have only one successor'));
    }
    const incumbentPrior = priorBySuccessor.get(edge.successor_revision_id);
    if (incumbentPrior && incumbentPrior !== edge.prior_revision_id) {
      errors.push(error('PERSISTENCE_MULTIPLE_PREDECESSORS', path, 'a successor may have only one predecessor'));
    }
    if (newEdgeBySuccessor.has(edge.successor_revision_id)) {
      errors.push(error('PERSISTENCE_MULTIPLE_PREDECESSORS', path, 'successor occurs in multiple new edges'));
    }
    newEdgeBySuccessor.set(edge.successor_revision_id, edge);
    successorByPrior.set(edge.prior_revision_id, edge.successor_revision_id);
    priorBySuccessor.set(edge.successor_revision_id, edge.prior_revision_id);
    allEdges.push(edge);
  }

  for (const [entityId, [row]] of newByEntity) {
    const selected = selectedHeads.get(entityId);
    const edge = newEdgeBySuccessor.get(row.revision_id);
    if (selected && (!edge || edge.prior_revision_id !== selected)) {
      errors.push(error('PERSISTENCE_PRIOR_NOT_SELECTED_HEAD', `/bundle/${entityId}`, 'an existing entity must advance its exact selected head'));
    }
    if (!selected && edge) {
      errors.push(error('PERSISTENCE_EDGE_WITHOUT_EXISTING_HEAD', `/bundle/${entityId}`, 'an initial entity revision cannot supersede a database head'));
    }
  }

  for (const edge of allEdges) {
    const seen = new Set([edge.prior_revision_id]);
    let cursor = edge.successor_revision_id;
    while (cursor) {
      if (seen.has(cursor)) {
        errors.push(error('PERSISTENCE_EDGE_CYCLE', '/supersession_edges', 'supersession edge graph contains a cycle'));
        break;
      }
      seen.add(cursor);
      cursor = successorByPrior.get(cursor);
    }
  }
  return errors;
}

export function assertIncrementalEnvelope(document, state = {}) {
  const errors = incrementalEnvelopeErrors(document, state);
  if (errors.length > 0) {
    const failure = new Error(`${errors[0].code}:${errors[0].path}`);
    failure.code = errors[0].code;
    failure.errors = errors;
    throw failure;
  }
  return true;
}

export function buildIncrementalImportDocument({
  importId,
  sourceContentFingerprint,
  sourceCorpusVersion,
  sourceManifestFileSha256,
  bundle,
  supersessionEdges,
  normalizer,
  createdAt
}) {
  const emptyProjection = {
    records: [],
    search_documents: [],
    join_routes: [],
    corpus: { projection_kind: 'incremental-persistence-context', published: false },
    semantics: { legacy_projection_published: false, source_payloads_acquired: false, analyses_executed: false }
  };
  const plan = {
    plan_version: INCREMENTAL_IMPORT_PLAN_VERSION,
    import_id: importId,
    source: {
      corpus_version: sourceCorpusVersion,
      manifest_file_sha256: sourceManifestFileSha256,
      content_fingerprint_sha256: sourceContentFingerprint,
      records_file_sha256: sourceManifestFileSha256,
      search_documents_file_sha256: sourceManifestFileSha256,
      join_routes_file_sha256: sourceManifestFileSha256
    },
    normalizer: { ...normalizer, deterministic: true },
    policy: {
      id_basis: 'source-scoped immutable identifier',
      title_or_url_merge_permitted: false,
      uncertain_identity_disposition: 'separate_open_review_candidate',
      destructive_rollback_permitted: false,
      source_payloads_acquired: false,
      analyses_executed: false
    },
    expected_counts: { legacy_records: 0, legacy_join_routes: 0, legacy_search_documents: 0 },
    canonical_counts: canonicalCounts(bundle),
    record_mappings: [],
    join_route_mappings: [],
    identity_review_candidates: [],
    source_identity_review_candidates: [],
    rejected_items: [],
    bundle_fingerprint: contentFingerprint(bundle),
    projection_fingerprint: contentFingerprint(emptyProjection),
    created_at: createdAt
  };
  const document = {
    envelope_version: INCREMENTAL_ENVELOPE_VERSION,
    contract_version: INCREMENTAL_IMPORT_CONTRACT_VERSION,
    import_id: importId,
    source_content_fingerprint: sourceContentFingerprint,
    document_fingerprint: null,
    persistence_profile: structuredClone(APPEND_ONLY_PERSISTENCE_PROFILE),
    plan,
    bundle,
    supersession_edges: structuredClone(supersessionEdges),
    legacy_projection: emptyProjection,
    projection_row_fingerprints: {
      corpus: contentFingerprint(emptyProjection.corpus),
      records: {}, search_documents: {}, join_routes: {}
    }
  };
  document.document_fingerprint = contentFingerprint({ ...document, document_fingerprint: null });
  return document;
}

export function materializeCoreV2Snapshot({ revisionEntries, supersessionEdges, selectedHeads }) {
  const entryByRevision = new Map(revisionEntries.map(entry => [entry.row.revision_id, entry]));
  const priorBySuccessor = new Map(supersessionEdges.map(edge => [edge.successor_revision_id, edge]));
  const successorByPrior = new Map(supersessionEdges.map(edge => [edge.prior_revision_id, edge]));
  const reachable = new Set();
  for (const headRevisionId of selectedHeads.values()) {
    let cursor = headRevisionId;
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (!entryByRevision.has(cursor)) throw new Error(`MATERIALIZATION_REVISION_MISSING:${cursor}`);
      reachable.add(cursor);
      cursor = priorBySuccessor.get(cursor)?.prior_revision_id ?? null;
    }
    if (cursor) throw new Error(`MATERIALIZATION_EDGE_CYCLE:${cursor}`);
  }
  const bundle = Object.fromEntries([['bundle_version', CORE_BUNDLE_VERSION], ...COLLECTIONS.map(collection => [collection, []])]);
  for (const revisionId of [...reachable].sort()) {
    const { collection, row: stored } = entryByRevision.get(revisionId);
    const incoming = priorBySuccessor.get(revisionId) ?? null;
    const outgoing = successorByPrior.get(revisionId) ?? null;
    const row = structuredClone(stored);
    row.lifecycle_state = outgoing ? 'superseded' : stored.lifecycle_state;
    row.clocks.superseded_at = outgoing?.superseded_at ?? null;
    row.history = {
      append_only: true,
      supersedes_revision_ids: incoming ? [incoming.prior_revision_id] : [],
      superseded_by_revision_id: outgoing?.successor_revision_id ?? null,
      rationale: outgoing?.rationale ?? incoming?.rationale ?? null
    };
    row.canonical_content_fingerprint = fingerprintTruthRevision(row);
    bundle[collection].push(row);
  }
  for (const collection of COLLECTIONS) bundle[collection].sort((left, right) => left.revision_id.localeCompare(right.revision_id));
  return bundle;
}

export class AppendOnlyPersistenceStore {
  #entries = new Map();
  #edges = [];
  #heads = new Map();
  #batches = new Map();

  constructor(initialBundle) {
    for (const entry of rowsOf(initialBundle)) {
      this.#entries.set(entry.row.revision_id, { collection: entry.collection, row: structuredClone(entry.row) });
      if (entry.row.lifecycle_state !== 'superseded') this.#heads.set(entry.row.entity_id, entry.row.revision_id);
    }
  }

  apply(document) {
    const priorBatch = this.#batches.get(document.import_id);
    if (priorBatch) {
      if (priorBatch !== document.document_fingerprint) throw new Error('PERSISTENCE_IMPORT_ID_CONTENT_CONFLICT');
      return Object.freeze({ status: 'already_applied', import_id: document.import_id, new_revisions: 0, new_edges: 0 });
    }
    const priorRevisions = new Map([...this.#entries].map(([id, entry]) => [id, entry.row]));
    assertIncrementalEnvelope(document, { priorRevisions, selectedHeads: this.#heads, existingEdges: this.#edges });
    const newEntries = rowsOf(document.bundle);
    for (const entry of newEntries) {
      if (this.#entries.has(entry.row.revision_id)) throw new Error(`PERSISTENCE_REVISION_ALREADY_EXISTS:${entry.row.revision_id}`);
    }
    for (const entry of newEntries) this.#entries.set(entry.row.revision_id, { collection: entry.collection, row: structuredClone(entry.row) });
    for (const edge of document.supersession_edges) this.#edges.push(structuredClone(edge));
    for (const entry of newEntries) this.#heads.set(entry.row.entity_id, entry.row.revision_id);
    this.#batches.set(document.import_id, document.document_fingerprint);
    return Object.freeze({
      status: 'applied', import_id: document.import_id,
      new_revisions: newEntries.length, new_edges: document.supersession_edges.length
    });
  }

  materialize() {
    return materializeCoreV2Snapshot({
      revisionEntries: [...this.#entries.values()],
      supersessionEdges: this.#edges,
      selectedHeads: this.#heads
    });
  }

  snapshot() {
    return {
      revisions: new Map([...this.#entries].map(([id, entry]) => [id, structuredClone(entry.row)])),
      edges: structuredClone(this.#edges),
      heads: new Map(this.#heads)
    };
  }
}

export { CORE_BUNDLE_VERSION, INCREMENTAL_BUNDLE_VERSION };
