import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createWorker } from '../../../worker/index.mjs';
import { createMachineCursorSigner } from '../../../worker/machine-cursor.mjs';
import { restoreNMinusOnePublication } from './fixture-restore.mjs';
import { cursorInvalidAfterRotation, quotaBehavior, replayJob, rotateCredential, RETENTION_CLASSES } from './retention.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const firstRecord = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/retrieval/versions/v1.1.0/corpus/records.jsonl'), 'utf8').split(/\r?\n/)[0]);
const result = {
  contract_version: 'observatory-discovery-result.v1.0.0',
  retrieval_id: 'retrieval-0123456789abcdef',
  evidence_mode: 'published_offline_evidence',
  corpus: { corpus_id: 'fixture', corpus_version: '1.0.0', record_count: 1, join_route_count: 0 },
  query: { question: 'hospital data', normalized_question: 'hospital data', interpretation: {}, filters: {} },
  result_count: 0,
  results: [],
  join_routes: [],
  warnings: [],
};
const engine = {
  interpret(input = {}) {
    return {
      original_question: input.question ?? 'Browse published health systems data',
      normalized_question: (input.question ?? 'Browse published health systems data').toLowerCase(),
      interpretation: { geographies: [], subjects: [], units_of_analysis: [], time_window: null, access_intent: { include_restricted: true, public_only: false, accepts_restricted: true, match_basis: 'default' } },
      compiler: { mode: 'deterministic_controlled_vocabulary', llm_used: false, external_requests: 0 },
    };
  },
  retrieve(input) {
    if (typeof input?.question !== 'string') throw new TypeError('question is required');
    return { ...result, query: { ...result.query, question: input.question } };
  },
};
const catalog = {
  records: [firstRecord], searchDocuments: [{}], joinRoutes: [], engine,
  corpus: {
    corpus_id: 'fixture', corpus_version: '1.2.0', record_count: 1, search_document_count: 1,
    join_route_count: 0, source_slices: { [firstRecord.identity.source.source_id]: 1 },
    manifest_sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    publication: { generation: 'generation.worker-test', observed_at: '2026-09-03T12:00:00Z' },
  },
};
const worker = createWorker({ loadEngine: async () => engine, loadCatalog: async () => catalog });
const env = { ASSETS: { fetch: async () => new Response('{}', { status: 200 }) } };

test('fixture N-1 restore is timed through existing publication ports and is not a managed failover', () => {
  const restored = restoreNMinusOnePublication();
  assert.equal(restored.kind, 'fixture_in_memory_publication_rollback');
  assert.equal(restored.managed_restore_or_failover, false);
  assert.equal(restored.configuration_file_alone, false);
  assert.equal(restored.n_minus_one_restored, true);
  assert.equal(restored.attempts_preserved, true);
  assert.equal(restored.review_histories_preserved, true);
  assert.equal(restored.pending_scientific_claims_published, false);
  assert.equal(typeof restored.elapsed_ms, 'number');
  assert.ok(restored.elapsed_ms >= 0);
  assert.equal(restored.auth_05, 'pending_external_authorization');
});

test('retention, replay, and rotation stay fixture-scoped and do not erase historical evidence or leak secrets', async () => {
  assert.equal(RETENTION_CLASSES.metadata.sample_store, false);
  assert.equal(RETENTION_CLASSES.sample.not_created_by_this_pr, true);
  const quota = quotaBehavior({ used_bytes: 12, quota_bytes: 10 });
  assert.equal(quota.exceeded, true);
  assert.equal(quota.historical_approved_evidence_erased, false);
  const replay = replayJob({ attempts: 2, replay_of: 'run_original' });
  assert.equal(replay.attempts, 3);
  assert.equal(replay.history_reset, false);
  assert.equal(replay.pending_scientific_claims_published, false);
  const rotation = rotateCredential({ previous_secret: 'old-secret-value-32-bytes-minimum!!', next_secret: 'new-secret-value-32-bytes-minimum!!', logs: ['rotated signing key'] });
  assert.equal(rotation.rotated, true);
  assert.equal(rotation.secrets_in_logs, false);
  const signerA = createMachineCursorSigner({ signingKey: 'old-secret-value-32-bytes-minimum!!' });
  const signerB = createMachineCursorSigner({ signingKey: 'new-secret-value-32-bytes-minimum!!' });
  const items = Array.from({ length: 4 }, (_, i) => ({ id: i }));
  const first = await signerA.page({
    capability: 'search_assets',
    input: { limit: 2 },
    generation: 'generation.worker-test',
    manifest: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    items,
    section: 'results',
  });
  assert.ok(first.envelope.next_cursor);
  await assert.rejects(
    () => cursorInvalidAfterRotation({
      signerA,
      signerB,
      cursorFromA: first.envelope.next_cursor,
      capability: 'search_assets',
      input: { limit: 2 },
      generation: 'generation.worker-test',
      manifest: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      items,
      section: 'results',
    }),
    /MACHINE_CURSOR_RESTART_REQUIRED/,
  );
});

test('Worker health names static-corpus dependencies and HTML CSP does not allow Insights', async () => {
  const health = await worker.fetch(new Request('https://ushso.org/api/health'), env);
  const body = await health.json();
  assert.equal(health.status, 200);
  assert.equal(body.compiler.llm_used, false);
  assert.equal(body.dependencies.static_corpus_assets, true);
  assert.equal(body.dependencies.postgresql, false);
  assert.equal(body.dependencies.hyperdrive, false);
  assert.equal(body.dependencies.source_fetch, false);
  assert.equal(body.insights.enabled, false);
  const html = await worker.fetch(new Request('https://ushso.org/unknown-page'), env);
  const csp = html.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /cloudflareinsights/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  const headersFile = fs.readFileSync(path.join(ROOT, 'apps/web/public/_headers'), 'utf8');
  assert.match(headersFile, /script-src 'self'/);
  assert.doesNotMatch(headersFile, /static\.cloudflareinsights\.com/);
});

test('scientific review remains unpublished after recovery-oriented Worker responses', async () => {
  const response = await worker.fetch(new Request('https://ushso.org/api/research/v1/scientific-review?record_id=x&generation=generation.worker-test'), env);
  const body = await response.json();
  assert.notEqual(body?.result?.publication_authorized, true);
});
