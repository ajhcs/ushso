import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fingerprintTruthRevision } from '../../../contracts/core/v2.0.0/tools/common.mjs';
import { loadSchemas } from '../../../contracts/core/v2.0.0/tools/schema.mjs';
import { semanticErrors } from '../../../contracts/core/v2.0.0/tools/semantics.mjs';
import { contentFingerprint } from '../src/canonical.mjs';
import {
  AppendOnlyPersistenceStore,
  assertIncrementalEnvelope,
  buildIncrementalImportDocument,
  INCREMENTAL_BUNDLE_VERSION,
  incrementalEnvelopeErrors
} from '../src/incremental-persistence.mjs';
import { loadLegacyCorpus } from '../src/legacy-loader.mjs';
import { normalizeLegacyCorpus } from '../src/normalize.mjs';

const legacy = await loadLegacyCorpus();
const initial = normalizeLegacyCorpus(legacy);
const prior = initial.bundle.assets[0];
const secondAsset = initial.bundle.assets[1];
const importId = 'urn:ushso:import:incremental-n-plus-1-proof';
const recordedAt = '2026-08-30T20:00:00.000Z';

function incrementalBundle(successor) {
  return {
    bundle_version: INCREMENTAL_BUNDLE_VERSION,
    organizations: [], sources: [], assets: [successor], releases: [], distributions: [],
    documentation: [], schema_snapshots: [], schema_fields: [], access_routes: [],
    access_observations: [], evidence: [], assertions: [], relationships: []
  };
}

function successorOf(row, { id = 'urn:ushso:revision:incremental-n-plus-1', entityId = row.entity_id, at = recordedAt, nextImportId = importId } = {}) {
  const successor = structuredClone(row);
  successor.revision_id = id;
  successor.entity_id = entityId;
  successor.asset_id = entityId;
  successor.title = `${row.title} — corrected metadata`;
  successor.lifecycle_state = 'active';
  successor.clocks.observed_at = at;
  successor.clocks.recorded_at = at;
  successor.clocks.superseded_at = null;
  successor.history = { append_only: true, supersedes_revision_ids: [], superseded_by_revision_id: null, rationale: null };
  successor.lineage.import_id = nextImportId;
  successor.canonical_content_fingerprint = fingerprintTruthRevision(successor);
  return successor;
}

function documentFor(successor = successorOf(prior), {
  nextImportId = importId,
  edgePrior = prior,
  edgeEntityId = successor.entity_id,
  supersededAt = recordedAt
} = {}) {
  if (successor.lineage.import_id !== nextImportId) {
    successor = structuredClone(successor);
    successor.lineage.import_id = nextImportId;
    successor.canonical_content_fingerprint = fingerprintTruthRevision(successor);
  }
  return buildIncrementalImportDocument({
    importId: nextImportId,
    sourceContentFingerprint: 'd'.repeat(64),
    sourceCorpusVersion: '1.1.1',
    sourceManifestFileSha256: 'e'.repeat(64),
    bundle: incrementalBundle(successor),
    supersessionEdges: [{
      prior_revision_id: edgePrior.revision_id,
      prior_canonical_content_fingerprint: edgePrior.canonical_content_fingerprint,
      successor_revision_id: successor.revision_id,
      entity_id: edgeEntityId,
      rationale: 'Publisher metadata correction; no identity merge.',
      superseded_at: supersededAt
    }],
    normalizer: { name: 'legacy-corpus-normalizer', version: '1.0.0' },
    createdAt: recordedAt
  });
}

function state(overrides = {}) {
  return {
    priorRevisions: new Map([[prior.revision_id, prior]]),
    selectedHeads: new Map([[prior.entity_id, prior.revision_id]]),
    existingEdges: [],
    ...overrides
  };
}

function reseal(document) {
  document.document_fingerprint = contentFingerprint({ ...document, document_fingerprint: null });
  return document;
}

test('incremental envelope is strict Draft 2020-12 and binds immutable edge facts', async () => {
  const document = documentFor();
  const { ajv } = await loadSchemas();
  const schema = JSON.parse(await readFile(new URL('../schemas/incremental-envelope.schema.json', import.meta.url), 'utf8'));
  ajv.addSchema(schema, schema.$id);
  const validate = ajv.getSchema(schema.$id);
  assert.equal(validate(document), true, JSON.stringify(validate.errors));
  assert.equal(assertIncrementalEnvelope(document, state()), true);
  const unexpected = structuredClone(document);
  unexpected.persistence_profile.rewrite_prior_rows = true;
  assert.equal(validate(unexpected), false);
  assert.ok(validate.errors.some(error => error.keyword === 'additionalProperties'));
});

test('N+1 import retains N, advances the head, is replay-idempotent, and materializes core v2 history', async () => {
  const store = new AppendOnlyPersistenceStore(initial.bundle);
  const document = documentFor();
  assert.deepEqual(store.apply(document), {
    status: 'applied', import_id: importId, new_revisions: 1, new_edges: 1
  });
  assert.deepEqual(store.apply(document), {
    status: 'already_applied', import_id: importId, new_revisions: 0, new_edges: 0
  });
  const stored = store.snapshot();
  assert.equal(stored.revisions.get(prior.revision_id).history.superseded_by_revision_id, null);
  assert.equal(stored.revisions.get(prior.revision_id).lifecycle_state, prior.lifecycle_state);
  assert.equal(stored.revisions.size, initial.bundle.assets.length + initial.bundle.organizations.length
    + initial.bundle.sources.length + initial.bundle.releases.length + initial.bundle.distributions.length
    + initial.bundle.documentation.length + initial.bundle.schema_snapshots.length + initial.bundle.schema_fields.length
    + initial.bundle.access_routes.length + initial.bundle.access_observations.length + initial.bundle.evidence.length
    + initial.bundle.assertions.length + initial.bundle.relationships.length + 1);
  assert.equal(stored.heads.get(prior.entity_id), document.bundle.assets[0].revision_id);

  const materialized = store.materialize();
  const priorProjection = materialized.assets.find(row => row.revision_id === prior.revision_id);
  const successorProjection = materialized.assets.find(row => row.revision_id === document.bundle.assets[0].revision_id);
  assert.equal(priorProjection.lifecycle_state, 'superseded');
  assert.equal(priorProjection.history.superseded_by_revision_id, successorProjection.revision_id);
  assert.deepEqual(successorProjection.history.supersedes_revision_ids, [priorProjection.revision_id]);
  assert.equal(successorProjection.lifecycle_state, 'active');
  assert.deepEqual(semanticErrors(materialized), []);
  const { ajv } = await loadSchemas();
  const validate = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/fixture-bundle.schema.json');
  assert.equal(validate(materialized), true, JSON.stringify(validate.errors));
});

test('missing prior and prior digest mismatch fail closed', () => {
  const missing = documentFor();
  missing.supersession_edges[0].prior_revision_id = 'urn:ushso:revision:not-persisted';
  reseal(missing);
  assert.throws(() => assertIncrementalEnvelope(missing, state()), /PERSISTENCE_PRIOR_MISSING/u);

  const mismatch = documentFor();
  mismatch.supersession_edges[0].prior_canonical_content_fingerprint = `sha256:${'f'.repeat(64)}`;
  reseal(mismatch);
  assert.throws(() => assertIncrementalEnvelope(mismatch, state()), /PERSISTENCE_PRIOR_DIGEST_MISMATCH/u);
});

test('cross-entity edges and non-monotonic clocks fail closed', () => {
  const crossEntity = documentFor(successorOf(prior), { edgeEntityId: secondAsset.entity_id });
  assert.ok(incrementalEnvelopeErrors(crossEntity, state()).some(row => row.code === 'PERSISTENCE_EDGE_ENTITY_MISMATCH'));

  const nonMonotonic = documentFor(successorOf(prior), { supersededAt: '2026-08-30T19:59:59.000Z' });
  assert.ok(incrementalEnvelopeErrors(nonMonotonic, state()).some(row => row.code === 'PERSISTENCE_EDGE_CLOCK_NOT_MONOTONIC'));
});

test('forks, cycles, and embedded snapshot history are rejected', () => {
  const document = documentFor();
  const fork = {
    ...document.supersession_edges[0],
    successor_revision_id: 'urn:ushso:revision:already-selected-other-successor'
  };
  assert.ok(incrementalEnvelopeErrors(document, state({ existingEdges: [fork] })).some(row => row.code === 'PERSISTENCE_EDGE_FORK'));

  const reverse = {
    prior_revision_id: document.bundle.assets[0].revision_id,
    prior_canonical_content_fingerprint: document.bundle.assets[0].canonical_content_fingerprint,
    successor_revision_id: prior.revision_id,
    entity_id: prior.entity_id,
    rationale: 'adversarial reverse edge',
    superseded_at: '2026-08-30T21:00:00.000Z'
  };
  assert.ok(incrementalEnvelopeErrors(document, state({ existingEdges: [reverse] })).some(row => row.code === 'PERSISTENCE_EDGE_CYCLE'));

  const embedded = documentFor();
  embedded.bundle.assets[0].history.supersedes_revision_ids = [prior.revision_id];
  embedded.bundle.assets[0].history.rationale = 'attempted snapshot mutation contract';
  embedded.bundle.assets[0].canonical_content_fingerprint = fingerprintTruthRevision(embedded.bundle.assets[0]);
  embedded.plan.bundle_fingerprint = contentFingerprint(embedded.bundle);
  reseal(embedded);
  assert.throws(() => assertIncrementalEnvelope(embedded, state()), /PERSISTENCE_SNAPSHOT_HISTORY_EMBEDDED/u);
});

test('same import ID with different content is never treated as replay', () => {
  const store = new AppendOnlyPersistenceStore(initial.bundle);
  const document = documentFor();
  store.apply(document);
  const forgedReplay = structuredClone(document);
  forgedReplay.supersession_edges[0].rationale = 'different content under the same import identity';
  reseal(forgedReplay);
  assert.throws(() => store.apply(forgedReplay), /PERSISTENCE_IMPORT_ID_CONTENT_CONFLICT/u);
});
