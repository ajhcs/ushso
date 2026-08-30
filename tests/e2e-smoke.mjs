import assert from 'node:assert/strict';

const baseIndex = process.argv.indexOf('--base');
const base = baseIndex === -1 ? 'http://127.0.0.1:8787' : process.argv[baseIndex + 1];
if (!base) throw new Error('Usage: node tests/e2e-smoke.mjs [--base <url>]');

const index = await fetch(`${base}/`);
const html = await index.text();
assert.equal(index.status, 200);
assert.match(html, /United States Health Systems Observatory/);
const csp = index.headers.get('content-security-policy') ?? '';
assert.match(csp, /default-src 'self'/);
assert.equal(index.headers.get('x-content-type-options'), 'nosniff');

const healthResponse = await fetch(`${base}/api/health`);
const health = await healthResponse.json();
assert.equal(healthResponse.status, 200);
assert.equal(health.status, 'ok');
assert.equal(health.compiler.llm_used, false);
assert.equal(health.compiler.external_requests, 0);

const contractResponse = await fetch(`${base}/api/contract`);
const contract = await contractResponse.json();
assert.equal(contractResponse.status, 200);
assert.equal(contract.tool.annotations.readOnlyHint, true);

const discoverResponse = await fetch(`${base}/api/discover`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ question: 'I need hospital financial and utilization data for Pennsylvania', limit: 15 })
});
const discovery = await discoverResponse.json();
const ids = discovery.results.map(item => item.record.identity?.match_fields?.source_id ?? item.record_id);
assert.equal(discoverResponse.status, 200);
assert.equal(discovery.contract_version, 'observatory-discovery-result.v1.0.0');
assert.equal(discovery.corpus.record_count, 157);
assert.ok(ids.includes('cms_hcris_cost_reports'));
assert.ok(ids.includes('pa_phc4_financial_ownership'));
assert.ok(discovery.join_routes.length > 0);

const zeroResponse = await fetch(`${base}/api/discover`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ question: 'Pennsylvania flibbertigibbet qzxwvu' })
});
const zero = await zeroResponse.json();
assert.equal(zeroResponse.status, 200);
assert.equal(zero.result_count, 0);
assert.ok(zero.warnings.some(value => /not evidence that no source exists/i.test(value)));

const invalid = await fetch(`${base}/api/discover`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
});
const wrongType = await fetch(`${base}/api/discover`, { method: 'POST', body: '{}' });
const oversized = await fetch(`${base}/api/discover`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'x'.repeat(21_000) })
});
const deepLink = await fetch(`${base}/search?q=hospital`);
const catalog = await (await fetch(`${base}/api/catalog`)).json();
const stableId = catalog.results.find(item => item.record_id.startsWith('us-federal:')).record_id;
const stableRecord = await fetch(`${base}/api/datasets/${encodeURIComponent(stableId)}`);
const healthHead = await fetch(`${base}/api/health`, { method: 'HEAD' });
const preflight = await fetch(`${base}/api/discover`, { method: 'OPTIONS' });
const machineGuide = await fetch(`${base}/llms.txt`);
const unknownPage = await fetch(`${base}/definitely-not-a-page`);
assert.equal(invalid.status, 400);
assert.equal(wrongType.status, 415);
assert.equal(oversized.status, 413);
assert.equal(deepLink.status, 200);
assert.equal(catalog.corpus.record_count, 157);
assert.equal(stableRecord.status, 200);
assert.equal(healthHead.status, 200);
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
assert.match(machineGuide.headers.get('content-type') ?? '', /^text\/plain/);
assert.equal(unknownPage.status, 404);

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  base,
  security_headers: { content_security_policy: true, nosniff: true },
  health: health.status,
  contract: contract.contract_version,
  records: discovery.corpus.record_count,
  results: discovery.result_count,
  join_routes: discovery.join_routes.length,
  zero_results: zero.result_count,
  guards: { invalid: invalid.status, media_type: wrongType.status, oversized: oversized.status },
  spa_deep_link: deepLink.status,
  stable_record: stableRecord.status,
  machine_routes: { llms: machineGuide.status, unknown: unknownPage.status },
  cors_preflight: preflight.status
}, null, 2)}\n`);
