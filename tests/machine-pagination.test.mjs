import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { createMachineCursorSigner } from '../worker/machine-cursor.mjs';
import { createStaticMachineToolkitRuntime } from '../worker/static-machine-toolkit-service.mjs';
import { createMachineToolkit } from '../packages/machine-toolkit/src/index.mjs';
import { createWorker } from '../worker/index.mjs';

const base = new URL('../packages/retrieval/versions/v1.2.0/corpus/', import.meta.url);
const corpus = JSON.parse(await fs.readFile(new URL('corpus.json', base)));
const records = [];
for (const name of corpus.record_files) {
  const rows = (await fs.readFile(new URL(name, base), 'utf8')).trim().split(/\n/).map(JSON.parse);
  records.push(...rows.slice(0, 3));
}
const catalog = { corpus, records };
const filters = { geography_ids: [], subject_ids: [], grain: [], access_classes: [], authority_levels: [], machine_readiness: [], time_period: null, negative_constraints: [], dimensions: [] };
const browse = { contract_version: 'observatory.machine.search-assets.input.v1.0.0', mode: 'browse', sort: 'title_asc', filters, grouping: 'none', limit: 2, cursor: null, expected_generation: corpus.publication.generation };
const coverage = { contract_version: 'observatory.machine.get-coverage-status.input.v1.0.0', geography_ids: ['geo.us'], subject_ids: [], source_classes: [], time_period: null, authority_levels: [], limit: 1, cursor: null, expected_generation: corpus.publication.generation };
function toolkit(signer = createMachineCursorSigner()) {
  const runtime = createStaticMachineToolkitRuntime(catalog, { cursorSigner: signer });
  return createMachineToolkit({ service: runtime.operations, responseContext: runtime.context });
}
async function traverse(tk, capability, input, section) {
  const ids = []; let cursor = null, expiry, binding;
  for (let page = 0; page < 20; page++) {
    const response = await tk.invokeJsonApi(capability, { ...input, cursor });
    assert.equal(response.ok, true, JSON.stringify(response.error));
    ids.push(...response.result[section].map(x => x.asset_id ?? x.cell_id));
    if (section === 'summaries') { binding ??= response.result.cursor_binding_digest; assert.equal(response.result.cursor_binding_digest, binding); }
    if (!response.truncated) {
      assert.equal(response.next_cursor, null); assert.equal(response.continuation_expires_at, null);
      assert.deepEqual(response.omitted_sections, []); assert.ok(['complete', 'empty'].includes(response.result_state));
      return ids;
    }
    assert.equal(response.result_state, 'partial'); assert.deepEqual(response.omitted_sections, [section]);
    expiry ??= response.continuation_expires_at; assert.equal(response.continuation_expires_at, expiry);
    cursor = response.next_cursor; assert.ok(cursor);
  }
  assert.fail('traversal did not terminate');
}
test('ranked and grouped search traverses exact complete order with truthful pagination', async () => {
  for (const grouping of ['none', 'family', 'source']) {
    for (const sort of ['title_asc', 'publisher_title', 'updated_desc']) {
      const tk = toolkit(); const input = { ...browse, grouping, sort };
      const whole = await tk.invokeJsonApi('search_assets', { ...input, limit: 20 });
      const ids = await traverse(tk, 'search_assets', input, 'summaries');
      assert.deepEqual(ids, whole.result.summaries.map(x => x.asset_id)); assert.equal(new Set(ids).size, ids.length);
    }
  }
  const { sort, ...search } = browse;
  const input = { ...search, mode: 'search', research_need: records[0].title };
  const tk = toolkit(); const whole = await tk.invokeJsonApi('search_assets', { ...input, limit: 20 });
  assert.deepEqual(await traverse(tk, 'search_assets', input, 'summaries'), whole.result.summaries.map(x => x.asset_id));
});
test('coverage traverses sorted source cells and final/empty pages remain complete/empty', async () => {
  assert.deepEqual(await traverse(toolkit(), 'get_coverage_status', coverage, 'cells'), Object.keys(corpus.source_slices).sort().map(x => `coverage.${x}`));
  const empty = await toolkit().invokeJsonApi('get_coverage_status', { ...coverage, source_classes: ['catalog.nonexistent'] });
  assert.equal(empty.result_state, 'empty'); assert.equal(empty.truncated, false);
});
test('cursor rejects tampering, query and capability mismatch, expiry, rotation and stale generation', async () => {
  let now = Date.now(); const signer = createMachineCursorSigner({ clock: () => now }); const tk = toolkit(signer);
  const first = await tk.invokeJsonApi('search_assets', browse); const cursor = first.next_cursor;
  const parts = cursor.split('.'); const payload = JSON.parse(Buffer.from(parts[0], 'base64url'));
  for (const change of [{ offset: 4 }, { expires: payload.expires + 60000 }, { offset: -2 }]) {
    const altered = Buffer.from(JSON.stringify({ ...payload, ...change })).toString('base64url') + '.' + parts[1];
    const r = await tk.invokeJsonApi('search_assets', { ...browse, cursor: altered });
    assert.equal(r.error.code, 'cursor_expired'); assert.equal(r.restart_required, true);
  }
  for (const change of [{ limit: 3 }, { sort: 'updated_desc' }, { grouping: 'family' }, { filters: { ...filters, access_classes: ['public'] } }]) {
    const r = await tk.invokeJsonApi('search_assets', { ...browse, ...change, cursor }); assert.equal(r.error.code, 'cursor_expired');
  }
  assert.equal((await tk.invokeJsonApi('get_coverage_status', { ...coverage, cursor })).error.code, 'cursor_expired');
  assert.equal((await toolkit().invokeJsonApi('search_assets', { ...browse, cursor })).error.code, 'cursor_expired');
  assert.equal((await tk.invokeJsonApi('search_assets', { ...browse, cursor, expected_generation: 'generation.stale' })).error.code, 'generation_unavailable');
  now = payload.expires;
  assert.equal((await tk.invokeJsonApi('search_assets', { ...browse, cursor })).error.code, 'cursor_expired');
});
test('Worker signer survives separate requests; dedicated key enables independent Worker traversal', async () => {
  const worker = createWorker({ loadCatalog: async () => catalog });
  async function call(w, input, env = {}) {
    const r = await w.fetch(new Request('https://example.test/api/machine/v1/search-assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }), env);
    assert.equal(r.status, 200); return r.json();
  }
  const first = await call(worker, browse); assert.equal(first.truncated, true);
  assert.ok(first.warnings.some(x => x.code === 'cursor_instance_limited'));
  const second = await call(worker, { ...browse, cursor: first.next_cursor }); assert.equal(second.ok, true);
  const env = { USHSO_CURSOR_SIGNING_KEY: 'unit-test-only-not-a-production-secret-123456789' };
  const signed = await call(worker, browse, env);
  assert.ok(!signed.warnings.some(x => x.code === 'cursor_instance_limited'));
  const another = createWorker({ loadCatalog: async () => catalog });
  assert.equal((await call(another, { ...browse, cursor: signed.next_cursor }, env)).ok, true);
});
test('Worker and WebMCP discovery cursors accept the resolved generation pin but reject conflicts', async () => {
  const worker = createWorker({ loadCatalog: async () => catalog });
  for (const [capability, input, section, route] of [
    ['search_assets', browse, 'summaries', 'search-assets'],
    ['get_coverage_status', coverage, 'cells', 'coverage-status']
  ]) {
    const tk = toolkit();
    const calls = [
      async input => {
        const url = new URL(`https://example.test/api/machine/v1/${route}`);
        let init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) };
        if (capability === 'get_coverage_status') {
          init = {};
          url.searchParams.set('limit', String(input.limit));
          for (const value of input.geography_ids) url.searchParams.append('geography_id', value);
          if (input.cursor) url.searchParams.set('cursor', input.cursor);
          if (input.expected_generation) url.searchParams.set('generation', input.expected_generation);
        }
        return (await worker.fetch(new Request(url, init), {})).json();
      },
      input => tk.invokeWebMcp(capability, input)
    ];
    for (const call of calls) {
      const first = await call({ ...input, expected_generation: null });
      assert.equal(first.ok, true); assert.equal(first.truncated, true);
      const second = await call({ ...input, expected_generation: first.index_generation, cursor: first.next_cursor });
      assert.equal(second.ok, true, JSON.stringify(second.error));
      assert.notDeepEqual(second.result[section], first.result[section]);
      const wrong = await call({ ...input, expected_generation: 'generation.wrong', cursor: first.next_cursor });
      assert.equal(wrong.ok, false); assert.equal(wrong.error.code, 'generation_unavailable');
      const invalid = await call({ ...input, cursor: first.next_cursor + 'a' });
      assert.equal(invalid.error.code, 'cursor_expired');
      assert.match(invalid.error.corrective_guidance, /Restart.*without a cursor/);
    }
  }
  const signer = createMachineCursorSigner();
  const options = { capability: 'search_assets', generation: corpus.publication.generation, manifest: 'm', items: [1, 2, 3, 4], section: 'summaries' };
  const { expected_generation, ...unpinned } = browse;
  const first = await signer.page({ ...options, input: unpinned });
  assert.deepEqual((await signer.page({ ...options, input: { ...browse, cursor: first.envelope.next_cursor } })).selected, [3, 4]);
  await assert.rejects(signer.page({ ...options, input: { ...browse, expected_generation: 'generation.wrong' } }), /RESTART_REQUIRED/);
});
test('authenticated offsets and timestamps are validated and original expiry never slides', async () => {
  for(const limit of [undefined,0,-1,1.5,NaN,1000000000])await assert.rejects(createMachineCursorSigner().page({capability:'search_assets',input:{limit},items:[1,2],section:'summaries'}),/RESTART_REQUIRED/);
  let now = Date.now(); const signingKey = 'unit-test-key-for-signed-invalid-offsets-123456';
  const signer = createMachineCursorSigner({ signingKey, clock: () => now });
  const options = { capability: 'search_assets', input: browse, generation: corpus.publication.generation, manifest: 'm', items: [1, 2, 3, 4, 5, 6], section: 'summaries' };
  const first = await signer.page(options); const payload = JSON.parse(Buffer.from(first.envelope.next_cursor.split('.')[0], 'base64url'));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  for (const update of [{ offset: 0 }, { offset: -2 }, { offset: 1.5 }, { offset: 3 }, { offset: 6 }, { issued: now + 1 }, { expires: payload.issued + 1800001 }]) {
    const bytes = Buffer.from(JSON.stringify({ ...payload, ...update }));
    const token = bytes.toString('base64url') + '.' + Buffer.from(await crypto.subtle.sign('HMAC', key, bytes)).toString('base64url');
    await assert.rejects(signer.page({ ...options, input: { ...browse, cursor: token } }), /RESTART_REQUIRED/);
  }
  now += 60000;
  const second = await signer.page({ ...options, input: { ...browse, cursor: first.envelope.next_cursor } });
  assert.equal(second.envelope.continuation_expires_at, first.envelope.continuation_expires_at);
  const last = await signer.page({ ...options, input: { ...browse, cursor: second.envelope.next_cursor } });
  assert.deepEqual(last.selected, [5, 6]); assert.equal(last.envelope.truncated, false);
  await assert.rejects(signer.page({ ...options, input: { ...browse, cursor: 'invalidtoken00000' } }), /RESTART_REQUIRED/);
  await assert.rejects(signer.page({ ...options, input: { ...browse, cursor: 'a'.repeat(2049) } }), /RESTART_REQUIRED/);
  await assert.rejects(createMachineCursorSigner({ signingKey: 'too-short' }).page(options), /KEY_INVALID/);
});

test('release grouping is explicitly unknown rather than traversing ungrouped assets', async () => {
  for (const sort of ['title_asc', 'publisher_title', 'updated_desc']) {
    const response = await toolkit().invokeJsonApi('search_assets', { ...browse, sort, grouping: 'release' });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'coverage_unknown');
    assert.equal(response.result_state, 'unknown');
    assert.equal(response.result, null);
    assert.equal(response.next_cursor, null);
  }
});
