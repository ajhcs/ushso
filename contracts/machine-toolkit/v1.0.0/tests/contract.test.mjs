import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { packageDigest, packageFileRows } from '../tools/build-manifest.mjs';
import { auditPublicSchemaBounds } from '../tools/bounds-audit.mjs';
import { buildFixtureBundle } from '../tools/fixture-data.mjs';
import { ROOT, canonicalJson, contentDigest, readJson, serializedBytes, sha256Bytes, snapshotDigest } from '../tools/common.mjs';
import { loadSchemas } from '../tools/schema.mjs';
import { expectedGateState, runAdversarialCases, validateConformanceBundle, validateToolkitManifest } from '../tools/semantic-validator.mjs';
import { validatePackage } from '../tools/validate-package.mjs';

const schemaId = name => `https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas/${name}`;
const state = {};

test.before(async () => {
  state.schemas = await loadSchemas();
  state.manifest = await readJson(path.join(ROOT, 'contracts', 'toolkit-manifest.json'));
  state.bundle = await readJson(path.join(ROOT, 'fixtures', 'conformance.json'));
  state.adversarial = await readJson(path.join(ROOT, 'fixtures', 'adversarial-cases.json'));
  state.packageManifest = await readJson(path.join(ROOT, 'contracts', 'package-manifest.json'));
});

test('all local Draft 2020-12 schemas compile in strict Ajv mode', () => {
  assert.ok(state.schemas.localRows.length >= 28);
  for (const row of state.schemas.localRows) {
    assert.equal(row.schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(typeof state.schemas.ajv.getSchema(row.schema.$id), 'function', row.name);
  }
});

test('every public schema collection, string, and object is bounded', () => {
  assert.deepEqual(auditPublicSchemaBounds(state.schemas.localRows), { ok: true, findings: [] });
});

test('shared coverage-cell and plan-status vocabularies preserve exact canonical parity', () => {
  const common = state.schemas.localRows.find(row => row.name === 'common.schema.json').schema;
  assert.deepEqual(common.$defs.coverage_cell_state.enum, ['integrated', 'candidate', 'navigation_only', 'evidence_gap', 'inaccessible', 'unknown', 'not_assessed']);
  assert.deepEqual(common.$defs.plan_status.enum, ['unsupported', 'clarification_required', 'incomplete', 'ready_with_constraints', 'ready']);
});

test('normative contract artifacts validate against closed schemas', async () => {
  const cases = [
    ['toolkit-manifest.schema.json', 'contracts/toolkit-manifest.json'],
    ['digest-taxonomy.schema.json', 'contracts/digest-taxonomy.json'],
    ['dependency-pin.schema.json', 'contracts/dependency-pin.json'],
    ['fixture-bundle.schema.json', 'fixtures/conformance.json'],
    ['adversarial-cases.schema.json', 'fixtures/adversarial-cases.json'],
    ['package-manifest.schema.json', 'contracts/package-manifest.json']
  ];
  for (const [schema, file] of cases) {
    const validate = state.schemas.ajv.getSchema(schemaId(schema));
    const document = await readJson(path.join(ROOT, file));
    assert.equal(validate(document), true, `${file}: ${JSON.stringify(validate.errors)}`);
  }
});

test('manifest exposes exactly nine gated read-only capabilities and exact parity routes', () => {
  assert.equal(state.manifest.tools.length, 9);
  assert.deepEqual(validateToolkitManifest(state.manifest), []);
  assert.equal(state.manifest.registration_policy.enabled_tool_count, 0);
  assert.ok(state.manifest.tools.every(tool => tool.annotations.readOnlyHint && tool.annotations.untrustedContentHint));
});

test('legacy discover_sources remains disabled and fails limits above twenty', () => {
  assert.equal(state.manifest.legacy_compatibility.default_registered, false);
  assert.equal(state.manifest.legacy_compatibility.registration_state, 'disabled_pending_legacy_audit');
  const overLimit = state.bundle.legacy_compatibility_cases.find(row => row.expected_outcome === 'invalid_input_never_clip');
  assert.equal(overLimit.legacy_input.limit, 21);
  assert.equal(overLimit.translated_input, null);
});

test('fixture generation is deterministic and covers every capability', () => {
  assert.equal(canonicalJson(buildFixtureBundle(state.manifest)), canonicalJson(state.bundle));
  assert.deepEqual(new Set(state.bundle.conformance_cases.map(row => row.capability)), new Set(state.manifest.tools.map(tool => tool.capability)));
  assert.ok(state.bundle.conformance_cases.length >= 13);
});

test('all input and response fixtures pass schema, semantic, and transport parity validation', () => {
  assert.deepEqual(validateConformanceBundle(state.bundle, state.manifest, state.schemas.ajv), []);
});

test('JSON API and WebMCP share semantic snapshots despite transport fields', () => {
  for (const row of state.bundle.conformance_cases.filter(row => row.json_api.response.ok)) {
    const left = row.json_api.response;
    const right = row.webmcp.response;
    assert.equal(snapshotDigest(left), snapshotDigest(right), row.case_id);
    const expected = row.capability === 'plan_research' ? left.candidate_snapshot_id : left.result_snapshot_id;
    assert.equal(snapshotDigest(left), expected, row.case_id);
  }
});

test('every response preserves generation pins, zero-action truth, and output limits', () => {
  const tools = new Map(state.manifest.tools.map(tool => [tool.capability, tool]));
  for (const row of state.bundle.conformance_cases) {
    for (const response of [row.json_api.response, row.webmcp.response]) {
      assert.equal(response.index_generation, row.input.expected_generation);
      assert.deepEqual(Object.values(response.truth_boundary), [false, false, false, false, false, false]);
      assert.ok(serializedBytes(response) <= tools.get(row.capability).output_max_bytes);
    }
    assert.ok(serializedBytes(row.input) <= tools.get(row.capability).input_max_bytes);
  }
});

test('coverage fixtures preserve unknown and prohibit unsupported absence claims', () => {
  const response = state.bundle.conformance_cases.find(row => row.case_id === 'coverage.unknown.success').json_api.response;
  assert.equal(response.result.cells[0].completeness_state, 'unknown');
  assert.equal(response.result.cells[0].denominator.status, 'unknown');
  assert.equal(response.result.cells[0].absence_claim_permitted, false);
  assert.equal(response.result.absence_claim_permitted, false);
});

test('access, retrieval, joins, and comparisons preserve the product boundary', () => {
  const byId = new Map(state.bundle.conformance_cases.map(row => [row.case_id, row.json_api.response]));
  assert.equal(byId.get('access.success').result.requester_eligibility, 'not_assessed');
  assert.equal(byId.get('access.success').result.access_workflow_submitted, false);
  assert.equal(byId.get('retrieval.success').result.retrieval_executed, false);
  assert.equal(byId.get('retrieval.success').result.payloads_acquired, false);
  assert.equal(byId.get('joins.success').result.routes[0].evidence_state, 'documented');
  assert.equal(byId.get('compare.success').result.ranking_performed, false);
  assert.equal(byId.get('compare.success').result.source_values_compared, false);
});

test('planner gate state is a pure function of all required receipts', () => {
  for (const gateCase of state.bundle.gate_cases) assert.equal(expectedGateState(gateCase), gateCase.expected_registration_state, gateCase.case_id);
  const plan = state.manifest.tools.find(tool => tool.capability === 'plan_research');
  assert.equal(plan.registration_state, 'disabled_pending_gates');
});

test('all adversarial mutations fail closed with their exact expected findings', () => {
  const receipts = runAdversarialCases(state.adversarial, state.bundle, state.manifest, state.schemas.ajv);
  assert.equal(receipts.length, state.adversarial.cases.length);
  assert.deepEqual(receipts.filter(row => !row.rejected), []);
});

test('canonical content digests are deterministic and distinct from exact file-byte hashes', () => {
  const compact = '{"a":1,"b":2}';
  const pretty = '{\n  "b": 2,\n  "a": 1\n}\n';
  assert.notEqual(sha256Bytes(Buffer.from(compact)), sha256Bytes(Buffer.from(pretty)));
  assert.equal(contentDigest(JSON.parse(compact)), contentDigest(JSON.parse(pretty)));
  assert.equal(canonicalJson(JSON.parse(pretty)), '{"a":1,"b":2}');
  assert.throws(() => canonicalJson({ invalid: Number.NaN }), /JCS_NON_FINITE_NUMBER/);
  assert.throws(() => canonicalJson({ invalid: '\ud800' }), /JCS_LONE_SURROGATE/);
});

test('package manifest pins every included file and its aggregate content digest', async () => {
  const rows = await packageFileRows();
  assert.deepEqual(rows, state.packageManifest.files);
  assert.equal(packageDigest(rows), state.packageManifest.package_content_digest);
  assert.ok(rows.every(row => /^[a-f0-9]{64}$/u.test(row.file_sha256)));
});

test('full package validation gate passes', async () => {
  const result = await validatePackage();
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.counts.validation_errors, 0);
  assert.ok(result.counts.adversarial_cases >= 20);
});
