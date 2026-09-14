import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMachineCursorSigner } from '../../worker/machine-cursor.mjs';
import { createStaticMachineToolkitRuntime } from '../../worker/static-machine-toolkit-service.mjs';
import { createMachineToolkit } from '../../packages/machine-toolkit/src/index.mjs';
import {
  RECOVERY_EXAMPLES,
  interpretClientEnvelope,
  isCompletedResearchTask,
  shouldRetryEnvelope,
} from '../../packages/machine-toolkit/src/client-recovery.mjs';
import { LAST_GOOD_GENERATION } from '../../packages/coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';
import { createBrowserMachineToolkitClient } from '../../plugins/ushso-research/scripts/client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workerSource = await fs.readFile(path.join(root, 'worker/index.mjs'), 'utf8');

async function loadCatalog() {
  const versionRoot = path.join(root, 'packages/retrieval/versions/v1.2.0');
  const corpus = JSON.parse(await fs.readFile(path.join(versionRoot, 'corpus/corpus.json'), 'utf8'));
  const records = [];
  for (const file of corpus.record_files) {
    const rows = (await fs.readFile(path.join(versionRoot, 'corpus', file), 'utf8')).trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
    records.push(...rows.slice(0, 3));
  }
  return { corpus, records };
}

function toolkit(catalog, signer = createMachineCursorSigner({ clock: () => Date.parse('2026-09-03T12:00:00Z') })) {
  const runtime = createStaticMachineToolkitRuntime(catalog, { now: new Date('2026-09-03T12:00:00Z'), cursorSigner: signer });
  return createMachineToolkit({ service: runtime.operations, responseContext: runtime.context, clock: () => new Date('2026-09-03T12:00:00Z') });
}

function browseInput(catalog, extra = {}) {
  const filters = {
    geography_ids: [], subject_ids: [], grain: [], access_classes: [], authority_levels: [],
    machine_readiness: [], time_period: null, negative_constraints: [], dimensions: [],
  };
  return {
    contract_version: 'observatory.machine.search-assets.input.v1.0.0',
    mode: 'browse',
    sort: 'title_asc',
    filters,
    grouping: 'none',
    limit: 2,
    cursor: null,
    expected_generation: catalog.corpus.publication.generation,
    ...extra,
  };
}

test('a cursor for one tool/query cannot page a different collection; expired cursors never silently begin a new generation', async () => {
  const catalog = await loadCatalog();
  const tk = toolkit(catalog);
  const browse = browseInput(catalog);
  const first = await tk.invokeJsonApi('search_assets', browse);
  assert.equal(first.ok, true);
  assert.equal(first.truncated, true);
  assert.equal(isCompletedResearchTask(first), false);
  const cursor = first.next_cursor;
  const coverage = {
    contract_version: 'observatory.machine.get-coverage-status.input.v1.0.0',
    geography_ids: ['geo.us'],
    subject_ids: [],
    source_classes: [],
    time_period: null,
    authority_levels: [],
    limit: 1,
    cursor,
    expected_generation: catalog.corpus.publication.generation,
  };
  const crossed = await tk.invokeJsonApi('get_coverage_status', coverage);
  assert.equal(crossed.ok, false);
  assert.equal(crossed.error.code, 'cursor_expired');
  assert.equal(crossed.error.retryable, false);
  assert.equal(crossed.restart_required, true);
  assert.match(crossed.error.corrective_guidance, /cannot page a different collection/i);
  assert.doesNotMatch(crossed.error.corrective_guidance, /Retry later/i);

  const stale = await tk.invokeJsonApi('search_assets', { ...browse, cursor, expected_generation: 'generation.stale' });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'generation_unavailable');
  assert.equal(stale.error.retryable, false);
  assert.equal(stale.restart_required, true);
  assert.match(stale.error.corrective_guidance, /pin to the newly returned generation/i);
  assert.match(stale.error.safe_message, /does not match this snapshot/i);
  assert.equal(stale.result, null);

  const expired = await tk.invokeJsonApi('search_assets', { ...browse, cursor: cursor + 'a' });
  assert.equal(expired.error.code, 'cursor_expired');
  assert.equal(expired.restart_required, true);
  assert.equal(shouldRetryEnvelope(expired), false);
  assert.match(expired.error.corrective_guidance, /must not silently begin a new generation/i);
});

test('an unknown schema is not an empty list of variables or a transport success claiming the task completed', async () => {
  const catalog = await loadCatalog();
  const tk = toolkit(catalog);
  const recordId = catalog.records[0].record_id;
  const generation = catalog.corpus.publication.generation;
  const unbound = await tk.invokeJsonApi('get_variables', {
    contract_version: 'observatory.machine.get-variables.input.v1.0.0',
    record_id: recordId,
    release_id: 'release.test',
    distribution_id: 'distribution.test',
    schema_id: 'schema.test',
    semantic_query: null,
    filters: [],
    limit: 25,
    cursor: null,
    expected_generation: generation,
  });
  assert.equal(unbound.ok, false);
  assert.equal(unbound.result_state, 'unknown');
  assert.equal(unbound.error.code, 'schema_context_required');
  assert.equal(unbound.result, null);
  assert.equal(unbound.error.retryable, false);
  assert.equal(isCompletedResearchTask(unbound), false);
  const recovered = interpretClientEnvelope(unbound, { httpStatus: 200 });
  assert.equal(recovered.kind, 'domain_error');
  assert.equal(recovered.completed_research_task, false);
  assert.equal(recovered.transport_success_is_not_task_completion, true);
  assert.equal(recovered.retryable, false);
  assert.equal(RECOVERY_EXAMPLES.unknown_schema_is_not_empty_variables.empty_fields_forbidden, true);

  const fetchImpl = async () => new Response(JSON.stringify(unbound), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const client = createBrowserMachineToolkitClient(fetchImpl);
  const viaClient = await client.invokeWebMcp('get_variables', {
    record_id: recordId,
    release_id: 'release.test',
    distribution_id: 'distribution.test',
    schema_id: 'schema.test',
    expected_generation: generation,
  });
  assert.equal(viaClient.ok, false);
  assert.equal(viaClient.result, null);
  assert.equal(viaClient.result_state, 'unknown');
  assert.notEqual(viaClient.result_state, 'empty');
  assert.equal(Array.isArray(viaClient.result?.fields), false);
  assert.equal(isCompletedResearchTask(viaClient), false);
});

test('cancellation stops the current request; clients neither retry nonretryable states nor lose next-cursor/omitted-section explanation', async () => {
  const catalog = await loadCatalog();
  const tk = toolkit(catalog);
  const browse = browseInput(catalog);
  const first = await tk.invokeJsonApi('search_assets', browse);
  assert.equal(first.ok, true);
  assert.equal(first.truncated, true);
  assert.ok(typeof first.next_cursor === 'string');
  assert.deepEqual(first.omitted_sections, ['summaries']);
  const interpreted = interpretClientEnvelope(first, { httpStatus: 200 });
  assert.equal(interpreted.preserve_next_cursor, true);
  assert.equal(interpreted.preserve_omitted_sections, true);
  assert.equal(interpreted.completed_research_task, false);
  assert.equal(shouldRetryEnvelope(first), false);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    tk.invokeJsonApi('search_assets', browse, { signal: controller.signal }),
    (error) => error?.name === 'AbortError' || error?.message === 'The operation was aborted.',
  );

  let started = 0;
  const abortClient = createBrowserMachineToolkitClient(async (_path, init) => {
    started += 1;
    if (init?.signal?.aborted) {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      throw err;
    }
    return new Response(JSON.stringify(first), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const clientAbort = new AbortController();
  clientAbort.abort();
  await assert.rejects(abortClient.invokeWebMcp('search_assets', browse, { signal: clientAbort.signal }), (error) => {
    return error?.name === 'AbortError' || /aborted/i.test(error?.message ?? '');
  });
  assert.equal(started, 0);

  const nonretryable = await tk.invokeJsonApi('search_assets', { ...browse, cursor: first.next_cursor + 'a' });
  assert.equal(shouldRetryEnvelope(nonretryable), false);
  assert.equal(nonretryable.error.retryable, false);

  let calls = 0;
  const counting = createBrowserMachineToolkitClient(async () => {
    calls += 1;
    return new Response(JSON.stringify(nonretryable), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const once = await counting.invokeWebMcp('search_assets', { ...browse, cursor: first.next_cursor });
  assert.equal(once.error.code, 'cursor_expired');
  assert.equal(shouldRetryEnvelope(once), false);
  assert.equal(calls, 1);

  const oversize = createBrowserMachineToolkitClient(async () => new Response('not-json', { status: 200, headers: { 'content-type': 'text/html' } }));
  await assert.rejects(oversize.invokeWebMcp('search_assets', browse), /USHSO_INVALID_RESPONSE_ENVELOPE|JSON|envelope/i);

  assert.equal(catalog.corpus.publication.generation, LAST_GOOD_GENERATION);
  assert.equal(workerSource.includes('packages/enrichment'), false);
  assert.equal(RECOVERY_EXAMPLES.partial_page_keeps_cursor.preserve_next_cursor, true);
  assert.equal(isCompletedResearchTask({ ok: true, result_state: 'complete' }), false);
});
