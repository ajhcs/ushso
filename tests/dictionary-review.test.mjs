import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { packageDictionaryReview } from '../scripts/research/package-dictionary-review.mjs';
import { createWorker } from '../worker/index.mjs';
import { extractRecord } from '../scripts/research/source-extractors.mjs';
const hash = x => createHash('sha256').update(x).digest('hex');
async function fixture(t, variables = Array.from({ length: 103 }, (_, i) => ({ name: `variable_${i}`, description: `Publisher description ${i}`, unit: null }))) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dictionary-review-test-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const record = { record_id: 'asset.test', title: 'Fixture', identity: { source: { source_id: 'cdc-socrata' }, match_fields: { source_id: 'test-abcd' } } }, generation = 'generation.test';
  const captureDirectory = path.join(temp, 'captures'); await fs.mkdir(captureDirectory);
  const url = 'https://data.cdc.gov/api/views/test-abcd.json', text = JSON.stringify({ id: 'test-abcd', columns: variables.map(v => ({ fieldName: v.name, description: v.description })) });
  const metadata = { url, status: 'captured', sha256: hash(text), captured_at: '2026-09-01T00:00:00Z', text, data: JSON.parse(text) };
  await fs.writeFile(path.join(captureDirectory, hash(url) + '.json'), JSON.stringify(metadata)); await fs.writeFile(path.join(captureDirectory, metadata.sha256 + '.body'), text);
  const extracted = extractRecord(record, { metadata }, generation), { value, ...claim } = extracted.claims[0];
  const diff = { path: '/variable_documentation', before: null, after: value, evidence: claim.evidence, scope: claim.scope };
  const source = { ...extracted, claims: [{ ...claim, value_in_diff_path: '/variable_documentation' }], diff: [diff], captures: { metadata: { url } } };
  const sourceDiff = JSON.stringify(source), sourceFile = path.join(temp, 'source.json'); await fs.writeFile(sourceFile, sourceDiff);
  const id = 'evidence:dictionary:' + hash(JSON.stringify(claim.evidence)).slice(0, 24), pid = 'provenance:dictionary:' + metadata.sha256.slice(0, 24);
  const limitations = [claim.scope, 'Pending owner scientific review. Captured publisher dictionary, not executed payload schema, release continuity, join compatibility, free access or fitness certification.', 'Measurement units and allowed values are unresolved unless literally documented; none inferred from names.'];
  const dictionary = { status: 'partial', summary: 'Publisher dictionary entries captured; scientific review pending.', variable_count: value.length,
    variables: value.map(v => ({ ...v, publisher_concept: null, publisher_value_labels: null, publisher_value_labels_evidence: null, evidence_ids: [id], evidence_state: 'verified_first_party' })),
    evidence_ids: [id], limitations, evidence_state: 'verified_first_party', codebook: { title: 'Captured publisher variable documentation', url } };
  const proposal = { record_id: record.record_id, baseline_record_sha256: hash(JSON.stringify(record)), review_status: 'pending_owner_review', publication_authorized: false,
    source_evidence: claim.evidence, source_diff_file: sourceFile, source_diff_sha256: hash(sourceDiff),
    changes: [{ path: '/variable_documentation', after: dictionary },
      { path: '/provenance/-', after: { provenance_id: pid, kind: 'catalog_metadata', locator: url, observed_at: metadata.captured_at, capture_state: 'captured_hashed', content_sha256: metadata.sha256 } },
      { path: '/evidence/-', after: { evidence_id: id, claim: 'The captured publisher documentation contains these named variable entries at /columns.', state: 'verified_first_party', provenance_ids: [pid], limitations } }] };
  const body = JSON.stringify(proposal), file = path.join(temp, 'proposal.json'); await fs.writeFile(file, body);
  const item = { record_id: record.record_id, file, sha256: hash(body), variables: variables.length };
  const manifest = { generation, publication_authorized: false, review_status: 'pending_owner_review', index: [item] };
  const manifestFile = path.join(temp, 'manifest.json'); await fs.writeFile(manifestFile, JSON.stringify(manifest));
  const output = path.join(temp, 'package');
  const summary = await packageDictionaryReview({ manifestFile, records: new Map([[record.record_id, record]]), generation, output, captureDirectory });
  const reads = [];
  const env = { USHSO_DICTIONARY_REVIEW: 'enabled', USHSO_DICTIONARY_REVIEW_MANIFEST_SHA256: hash(await fs.readFile(path.join(output, 'manifest.json'))), USHSO_CURSOR_SIGNING_KEY: 'unit-test-only-dictionary-pagination-key-1234', ASSETS: { async fetch(request) {
    const pathname = new URL(request.url).pathname; reads.push(pathname);
    try { return new Response(await fs.readFile(path.join(output, pathname.replace('/research-dictionaries-v1/', '')))); } catch { return new Response(null, { status: 404 }); }
  } } };
  const loadCatalog = async () => ({ records: [record], corpus: { publication: { generation } } });
  const worker = createWorker({ loadCatalog });
  const call = async (params = {}, selectedWorker = worker, selectedEnv = env) => selectedWorker.fetch(new Request('https://example.test/api/research/v1/dictionary-review?' + new URLSearchParams({ record_id: record.record_id, ...params })), selectedEnv);
  return { temp, record, generation, manifest, manifestFile, item, output, summary, reads, env, loadCatalog, worker, call, captureDirectory };
}
test('review dictionary pages are bounded, complete in packaged order, and remain scientifically partial', async t => {
  const f = await fixture(t); let cursor, names = [], rounds = 0;
  do {
    const response = await f.call(cursor ? { cursor, generation: f.generation } : {}); assert.equal(response.status, 200);
    const { result } = await response.json(); assert.equal(result.publication_authorized, false); assert.equal(result.schema_applicability, 'unresolved');
    assert.equal(result.scientific_approval, null); assert.equal(result.result_state, 'partial'); assert.ok(result.variables.length <= 50);
    names.push(...result.variables.map(v => v.name)); cursor = result.next_cursor; assert.ok(++rounds <= 3);
  } while (cursor);
  assert.equal(names.length, 103); assert.equal(new Set(names).size, 103); assert.equal(rounds, 3);
  assert.equal(f.reads.length, 9); // Pinned package manifest, descriptor, page; never the whole dictionary.
});
test('independent Worker shared keys continue; altered cursors, generation and dictionary bytes fail closed', async t => {
  const f = await fixture(t); const first = await (await f.call()).json();
  assert.equal((await f.call({ cursor: first.result.next_cursor }, createWorker({ loadCatalog: f.loadCatalog }))).status, 200);
  assert.equal((await f.call({ cursor: first.result.next_cursor + 'a' })).status, 410);
  assert.equal((await f.call({ generation: 'wrong' })).status, 410);
  const descriptor = JSON.parse(await fs.readFile(path.join(f.output, f.summary.records[0].file)));
  await fs.appendFile(path.join(f.output, 'pages', descriptor.pages[0].sha256 + '.json'), ' ');
  assert.equal((await f.call()).status, 503);
});
test('disabled route, invalid filters and baseline substitution do not expose proposals', async t => {
  const f = await fixture(t);
  assert.equal((await f.call({}, f.worker, { ...f.env, USHSO_DICTIONARY_REVIEW: undefined })).status, 404);
  assert.equal((await f.call({ limit: '1000000' })).status, 400);
  assert.equal((await f.call({}, createWorker({ loadCatalog: async () => ({ records: [{ ...f.record, title: 'Changed' }], corpus: { publication: { generation: f.generation } } }) }))).status, 503);
});
test('oversized fields remain losslessly available through bounded supplements beside valid peers', async t => {
  const f = await fixture(t, [{ name: 'valid', description: 'Literal', unit: null }, { name: 'huge', description: 'x'.repeat(70000) }]);
  assert.equal(f.summary.variables, 2); assert.equal(f.summary.records[0].isolated_fields, 0);
  const body = await (await f.call()).json(); assert.equal(body.result.isolated_field_count, 0);
  assert.equal(body.result.full_field_count, 2); assert.equal(body.result.supplemental_field_count, 1);
  assert.equal(body.result.variables[0].description, 'Literal');
  const stub = body.result.variables[1]; assert.equal(stub.name, 'huge'); assert.equal(stub.field_completeness, 'partial'); assert.equal(stub.full_field_available, true);
  assert.equal(Object.hasOwn(stub, 'description'), false);
  let cursor = null; const chunks = [];
  do {
    const response = await f.call({ field: stub.supplement.field_sha256, ...(cursor ? { cursor } : {}) });
    assert.equal(response.status, 200); const { result } = await response.json();
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 128 * 1024);
    chunks.push(Buffer.from(result.fragment.data, 'base64')); cursor = result.next_cursor;
  } while (cursor);
  const bytes = Buffer.concat(chunks); assert.equal(bytes.length, stub.supplement.total_bytes); assert.equal(hash(bytes), stub.supplement.field_sha256);
  assert.equal(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).description, 'x'.repeat(70000));
  assert.equal((await f.call({ field: 'f'.repeat(64) })).status, 404);
  assert.equal((await f.call({ field: 'invalid' })).status, 400);
});
test('packager isolates malformed proposal beside valid peer and refuses stale output reuse', async t => {
  const f = await fixture(t);
  f.manifest.index.push(null, { ...f.item, record_id: 'missing.record', sha256: 'b'.repeat(64) });
  await fs.writeFile(f.manifestFile, JSON.stringify(f.manifest));
  const args = { manifestFile: f.manifestFile, records: new Map([[f.record.record_id, f.record]]), generation: f.generation, output: path.join(f.temp, 'rerun'), captureDirectory: f.captureDirectory };
  const result = await packageDictionaryReview(args); assert.equal(result.records.length, 1); assert.equal(result.isolated.length, 2);
  await assert.rejects(packageDictionaryReview(args), /EEXIST/);
});
test('self-consistent altered descriptions cannot replace publisher evidence and every field reference resolves', async t => {
  const f = await fixture(t), p = JSON.parse(await fs.readFile(f.item.file));
  const first = await (await f.call()).json();
  for (const v of first.result.variables) for (const id of v.evidence_ids) assert.ok(first.result.evidence.some(e => e.evidence_id === id));
  for (const e of first.result.evidence) for (const id of e.provenance_ids) assert.ok(first.result.provenance.some(p => p.provenance_id === id));
  p.changes[0].after.variables[0].description = 'Unsupported claim';
  const bytes = JSON.stringify(p); await fs.writeFile(f.item.file, bytes); f.manifest.index[0].sha256 = hash(bytes); await fs.writeFile(f.manifestFile, JSON.stringify(f.manifest));
  const result = await packageDictionaryReview({ manifestFile: f.manifestFile, records: new Map([[f.record.record_id, f.record]]), generation: f.generation, output: path.join(f.temp, 'tampered'), captureDirectory: f.captureDirectory });
  assert.equal(result.records.length, 0); assert.equal(result.isolated[0].code, 'UNSUPPORTED_DICTIONARY_PROPOSAL');
  assert.equal((await f.call({}, f.worker, { ...f.env, USHSO_DICTIONARY_REVIEW_MANIFEST_SHA256: 'a'.repeat(64) })).status, 503);
});
