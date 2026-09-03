import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const baseIndex = process.argv.indexOf('--base');
const receiptIndex = process.argv.indexOf('--receipt');
const base = baseIndex === -1 ? 'http://127.0.0.1:8787' : process.argv[baseIndex + 1];
const receiptPath = receiptIndex === -1 ? null : process.argv[receiptIndex + 1];
if (!base) throw new Error('Usage: node tests/e2e-smoke.mjs [--base <url>] [--receipt <path>]');
if (receiptIndex !== -1 && !receiptPath) throw new Error('--receipt requires a path');

async function jsonResponse(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  return { response, body };
}

function assertInspectionResponse(value, capability) {
  assert.equal(value.ok, true, capability);
  assert.equal(value.capability, capability);
  assert.ok(Object.values(value.truth_boundary).every(flag => flag === false), capability);
}

const index = await fetch(`${base}/`);
const html = await index.text();
assert.equal(index.status, 200);
assert.match(html, /United States Health Systems Observatory/);
const csp = index.headers.get('content-security-policy') ?? '';
assert.match(csp, /default-src 'self'/);
assert.equal(index.headers.get('x-content-type-options'), 'nosniff');

const assetPaths = [...new Set(html.match(/\/assets\/[^"']+\.(?:js|css)/gu) ?? [])].sort();
assert.ok(assetPaths.length >= 2);
const assetHashes = {};
for (const assetPath of assetPaths) {
  const response = await fetch(`${base}${assetPath}`);
  const content = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200, assetPath);
  assetHashes[assetPath] = crypto.createHash('sha256').update(content).digest('hex');
}

const { response: healthResponse, body: health } = await jsonResponse(`${base}/api/health`);
assert.equal(healthResponse.status, 200);
assert.equal(health.status, 'ok');
assert.equal(health.compiler.llm_used, false);
assert.equal(health.compiler.external_requests, 0);

const { response: contractResponse, body: contract } = await jsonResponse(`${base}/api/contract`);
assert.equal(contractResponse.status, 200);
assert.equal(contract.read_only, true);
assert.equal(contract.enabled_tool_count, 8);
assert.equal(contract.tools.length, 8);
assert.deepEqual(contract.disabled_tools.map(tool => tool.capability), ['plan_research']);
assert.equal(contract.source_network_allowed_at_invocation, false);
assert.equal(contract.payload_retrieval_allowed, false);

const { response: discoverResponse, body: discovery } = await jsonResponse(`${base}/api/discover`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ question: 'hospital', limit: 15 })
});
assert.equal(discoverResponse.status, 200);
assert.equal(discovery.contract_version, 'observatory-discovery-result.v1.0.0');
assert.equal(discovery.returned_count, discovery.results.length);
assert.equal(discovery.result_count, discovery.returned_count);
assert.equal(typeof discovery.total_matches, 'number');
assert.ok(discovery.total_matches >= discovery.returned_count);
assert.equal(discovery.has_more, discovery.total_matches > discovery.returned_count);
assert.equal(discovery.corpus.record_count, 3434);
assert.equal(discovery.corpus.publication.all_public_records_live_verified, true);
assert.ok(discovery.results.length > 0);
assert.ok(discovery.results.every(result => result.record.freshness_verification.verification_status === 'current_verified'));

const { response: zeroResponse, body: zero } = await jsonResponse(`${base}/api/discover`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ question: 'Pennsylvania flibbertigibbet qzxwvu' })
});
assert.equal(zeroResponse.status, 200);
assert.equal(zero.result_count, 0);
assert.ok(zero.warnings.some(value => /not evidence that no source exists/i.test(value)));

const { body: catalog } = await jsonResponse(`${base}/api/catalog?limit=2`);
assert.equal(catalog.corpus.record_count, 3434);
assert.equal(catalog.returned_count, 2);
assert.equal(catalog.total_matches, 3434);
const [first, second] = catalog.results.map(item => item.record_id);
assert.ok(first && second);
const generation = catalog.corpus.publication.generation;
const filters = {
  geography_ids: [], subject_ids: [], grain: [], access_classes: [], authority_levels: [],
  machine_readiness: [], time_period: null, negative_constraints: [], dimensions: []
};

const machineCalls = [
  ['search_assets', `${base}/api/machine/v1/search-assets`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contract_version: 'observatory.machine.search-assets.input.v1.0.0', mode: 'browse', filters, sort: 'title_asc', grouping: 'none', limit: 2, cursor: null, expected_generation: generation })
  }],
  ['get_asset', `${base}/api/machine/v1/assets/${encodeURIComponent(first)}?generation=${encodeURIComponent(generation)}`],
  ['get_access_plan', `${base}/api/machine/v1/assets/${encodeURIComponent(first)}/access-plan?release_id=release.smoke&distribution_id=distribution.smoke&access_route_id=access.smoke&generation=${encodeURIComponent(generation)}`],
  ['get_retrieval_recipe', `${base}/api/machine/v1/assets/${encodeURIComponent(first)}/retrieval-recipe?release_id=release.smoke&distribution_id=distribution.smoke&access_route_id=access.smoke&generation=${encodeURIComponent(generation)}`],
  ['get_variables', `${base}/api/machine/v1/assets/${encodeURIComponent(first)}/variables?release_id=release.smoke&distribution_id=distribution.smoke&schema_id=schema.smoke&generation=${encodeURIComponent(generation)}`],
  ['get_join_routes', `${base}/api/machine/v1/join-routes?from_id=${encodeURIComponent(first)}&to_id=${encodeURIComponent(second)}&generation=${encodeURIComponent(generation)}`],
  ['compare_assets', `${base}/api/machine/v1/compare-assets`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contract_version: 'observatory.machine.compare-assets.input.v1.0.0', asset_ids: [first, second], dimensions: ['access', 'freshness'], expected_generation: generation })
  }],
  ['get_coverage_status', `${base}/api/machine/v1/coverage-status?geography_id=geo.us&authority_level=authoritative&generation=${encodeURIComponent(generation)}`]
];
const machineResults = [];
for (const [capability, url, init] of machineCalls) {
  const { response, body } = await jsonResponse(url, init);
  assert.equal(response.status, 200, capability);
  assertInspectionResponse(body, capability);
  machineResults.push({ capability, status: response.status, result_state: body.result_state });
}

const invalid = await fetch(`${base}/api/discover`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
});
const wrongType = await fetch(`${base}/api/discover`, { method: 'POST', body: '{}' });
const oversized = await fetch(`${base}/api/discover`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'x'.repeat(21_000) })
});
const malformedMachine = await fetch(`${base}/api/machine/v1/search-assets`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{'
});
const oversizedMachine = await fetch(`${base}/api/machine/v1/search-assets`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(21_000) })
});
const planner = await fetch(`${base}/api/machine/v1/plan-research`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
});
const deepLink = await fetch(`${base}/search?q=hospital`);
const stableRecord = await fetch(`${base}/api/datasets/${encodeURIComponent(first)}`);
const healthHead = await fetch(`${base}/api/health`, { method: 'HEAD' });
const preflight = await fetch(`${base}/api/discover`, { method: 'OPTIONS' });
const machineGuide = await fetch(`${base}/llms.txt`);
const unknownPage = await fetch(`${base}/definitely-not-a-page`);
assert.equal(invalid.status, 400);
assert.equal(wrongType.status, 415);
assert.equal(oversized.status, 413);
assert.equal(malformedMachine.status, 400);
assert.equal(oversizedMachine.status, 413);
assert.equal(planner.status, 404);
assert.equal(deepLink.status, 200);
assert.equal(stableRecord.status, 200);
assert.equal(healthHead.status, 200);
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
assert.match(machineGuide.headers.get('content-type') ?? '', /^text\/plain/);
assert.equal(unknownPage.status, 404);

const receipt = {
  schema_version: 'observatory-staging-http-receipt.v1.0.0',
  status: 'PASS',
  observed_at: new Date().toISOString(),
  base,
  generation,
  record_count: catalog.corpus.record_count,
  returned_count: catalog.returned_count,
  total_matches: catalog.total_matches,
  source_slices: catalog.corpus.source_slices,
  security_headers: { content_security_policy: true, nosniff: true },
  static_asset_sha256: assetHashes,
  health: health.status,
  contract: contract.contract_version,
  enabled_tool_count: contract.enabled_tool_count,
  machine_results: machineResults,
  planner_status: planner.status,
  zero_results: zero.result_count,
  guards: {
    invalid: invalid.status,
    media_type: wrongType.status,
    oversized: oversized.status,
    malformed_machine: malformedMachine.status,
    oversized_machine: oversizedMachine.status
  },
  spa_deep_link: deepLink.status,
  stable_record: stableRecord.status,
  machine_guide: machineGuide.status,
  unknown_route: unknownPage.status,
  cors_preflight: preflight.status
};
if (receiptPath) await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
