// Independent reviewer boundaries. Prepared, not executed against the producer.
// Requires a clean, explicitly named successor with a current accepted dependency binding.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';

const requested = process.env.USHSO_PR009_REVIEW_REPO;
assert(requested && path.isAbsolute(requested), 'USHSO_PR009_REVIEW_REPO must explicitly name an absolute successor repository');
const ROOT = await realpath(requested);
const expectedHead = process.env.USHSO_PR009_REVIEW_HEAD;
assert(/^[a-f0-9]{40}$/.test(expectedHead ?? ''), 'USHSO_PR009_REVIEW_HEAD must explicitly name the final immutable successor commit');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const json = async relative => JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const canonicalMap = value => JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
assert.equal(git('rev-parse', '--show-toplevel'), ROOT, 'Target must be the repository root');
assert.equal(git('rev-parse', 'HEAD'), expectedHead, 'Immutable review head mismatch');
assert.equal(git('status', '--porcelain=v1'), '', 'Review target must be clean');
const [binding, handoff, ledger] = await Promise.all([
  json('verification/research-program/pr-009/task-binding.json'),
  json('docs/research-program/handoffs/PR-009.json'),
  json('docs/research-program/execution-ledger.json'),
]);
const task = ledger.tasks.find(item => item.pr_id === 'PR-009');
const dependencies = ['PR-003', 'PR-004', 'PR-007', 'PR-008'];
assert(task, 'A live PR-009 controller row is required');
assert.deepEqual(Object.keys(binding.binding.dependency_merge_shas).sort(), dependencies);
assert.equal(canonicalMap(binding.binding.dependency_merge_shas), canonicalMap(handoff.dependency_merge_shas), 'Handoff dependency binding is stale');
assert.equal(canonicalMap(binding.binding.dependency_merge_shas), canonicalMap(task.dependency_merge_shas), 'Live controller dependency binding is stale');
assert.equal(binding.binding.base_sha, handoff.base_sha, 'Handoff base is stale');
assert.equal(binding.binding.base_sha, task.base_sha, 'Live controller base is stale');
assert.notEqual(binding.binding.base_sha, 'e3af8dda1720efd5d29fd1a65683d0f18a412e94', 'Historical unaccepted candidate is ineligible');
for (const id of dependencies) {
  const dependency = ledger.tasks.find(item => item.pr_id === id);
  const merge = binding.binding.dependency_merge_shas[id];
  assert(/^[a-f0-9]{40}$/.test(merge), id + ' needs an actual merge SHA');
  assert.notEqual(merge, '911aff5588ea59b12b81b58f1d5e07ce09a987d3', 'A PR-008 producer SHA is not an accepted merge');
  assert(dependency && ['merged', 'integrated', 'qualified'].includes(dependency.status), id + ' has not reached an accepted integration state');
  assert.equal(dependency.merge_sha, merge, id + ' merge identity differs from the live ledger');
  git('merge-base', '--is-ancestor', merge, binding.binding.base_sha);
}
git('merge-base', '--is-ancestor', binding.binding.base_sha, expectedHead);
const subjectPaths = [
  'scripts/research-program/operating-bounds.mjs',
  'scripts/research-program/policy.json',
  'scripts/research-program/receipts/v1.0.0/evidence-receipt.schema.json',
  'tests/research-program/operating-bounds.test.mjs',
  'verification/research-program/pr-009/task-binding.json',
  'docs/research-program/handoffs/PR-009.json',
  'docs/research-program/execution-ledger.json',
  'packages/connectors/src/descriptors.mjs',
  'packages/connectors/src/route-manifest.mjs',
  'packages/connectors/src/canonical.mjs',
  'contracts/ingestion/v1.0.0/fixtures/valid-fixtures.json',
  'contracts/ingestion/v1.0.0/schemas/metadata-fetch.schema.json',
  'contracts/ingestion/v1.0.0/schemas/capture-reference.schema.json',
  'contracts/ingestion/v1.0.0/tools/schema.mjs',
  'contracts/ingestion/v1.0.0/tools/semantics.mjs',
  'package-lock.json',
];
async function snapshot() {
  return {
    head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), status: git('status', '--porcelain=v1'),
    hashes: Object.fromEntries(await Promise.all(subjectPaths.map(async file => [file, sha(await readFile(path.join(ROOT, file)))]))),
  };
}
const before = await snapshot();
console.log(JSON.stringify({ event: 'independent_review_subject', root: ROOT, ...before, scope: 'PR009 boundary probes; no component acceptance or cost qualification' }));
after(async () => {
  const current = await snapshot();
  assert.deepEqual(current, before, 'Repository bytes changed during reviewer probes');
  console.log(JSON.stringify({ event: 'independent_review_subject_after', unchanged: true, ...current }));
});
// This file only calls pure validators/composers. A global fetch call is unexpected.
globalThis.fetch = () => { throw new Error('Reviewer harness forbids live source requests'); };
const fromTarget = relative => import(pathToFileURL(path.join(ROOT, relative)).href);
const [connectors, responseLimits, ingestion, dlq, strictIngestion, releasedSchemas, canonical, module] = await Promise.all([
  fromTarget('packages/connectors/src/index.mjs'),
  fromTarget('packages/connectors/src/route-manifest.mjs'),
  fromTarget('packages/ingestion/src/index.mjs'),
  fromTarget('packages/ingestion/src/dlq-sink-policy.mjs'),
  fromTarget('contracts/ingestion/v1.0.0/tools/index.mjs'),
  fromTarget('contracts/ingestion/v1.0.0/tools/schema.mjs'),
  fromTarget('packages/connectors/src/canonical.mjs'),
  fromTarget('scripts/research-program/operating-bounds.mjs'),
]);
const { validateOperatingBoundsPolicy, validateEvidenceReceipt, composeEvidenceReceipt } = module;
const policy = await json('scripts/research-program/policy.json');
const policyContext = {
  descriptors: connectors.APPROVED_SOURCE_DESCRIPTOR_TEMPLATES,
  defaultResponseLimits: responseLimits.DEFAULT_RESPONSE_LIMITS,
  stagePolicies: ingestion.STAGE_POLICIES,
  retryBudget: ingestion.retryBudget,
  dlqPolicy: dlq.DLQ_SINK_TRANSPORT_POLICY,
  validateDescriptor: connectors.validateDescriptor,
  routeManifestInventory: connectors.routeManifestInventory,
};
// Reuse the released strict schema registry with its real date/host/URI formats.
// No permissive schema stub or "version means valid" branch is used.
const { ajv } = await releasedSchemas.loadSchemas();
const schema = await json('scripts/research-program/receipts/v1.0.0/evidence-receipt.schema.json');
const compiledReceipt = ajv.compile(schema);
const receiptContext = {
  validateReceiptSchema(receipt) {
    const valid = compiledReceipt(receipt);
    return { valid, detail: valid ? 'ok' : JSON.stringify(compiledReceipt.errors) };
  },
  validateIngestionRecord: strictIngestion.validateIngestionRecord,
};
const bundle = await json('contracts/ingestion/v1.0.0/fixtures/valid-fixtures.json');
const fixtures = Object.fromEntries(bundle.records.map(record => [record.fixture_id, record.value]));
const descriptor = connectors.validateDescriptor(connectors.DATA_CMS_DATA_JSON_DESCRIPTOR);
const route = connectors.routeManifestInventory(descriptor).find(item => item.purpose === 'catalog_metadata' && !item.path_template.includes('{'));
assert(route, 'Fixture precondition: a declared CMS catalog route without route parameters is required');
const endpoint = descriptor.endpoints.find(item => item.endpoint_id === route.endpoint_id);
const finalLocator = new URL(route.path_template, endpoint.base_url);
const namedHash = {
  algorithm: 'sha256', hash_basis: 'ushso-canonical-json.v1', hash_version: 'ushso-canonical-json.v1',
  sha256: canonical.sha256(canonical.canonicalJson(descriptor)),
};
function accepted(value, label) {
  assert.equal(value?.valid, true, 'Fixture precondition: ' + label + ': ' + JSON.stringify(value?.issues));
}
function rejected(value, label) {
  assert.equal(value?.valid, false, label + ' must be rejected: ' + JSON.stringify(value));
}
async function recordsFor(outcome = 'captured') {
  const capture = clone(fixtures.valid_capture_reference);
  capture.source_id = descriptor.source_id;
  capture.connector_version = descriptor.connector_version;
  capture.source_locator = {
    endpoint_id: route.endpoint_id, template_id: route.template_id,
    final_host: finalLocator.hostname, final_path_class: route.target_class, redacted_locator: finalLocator.href,
  };
  const fetch = clone(outcome === 'not_modified' ? fixtures.valid_fetch_not_modified : fixtures.valid_fetch_captured);
  Object.assign(fetch, { endpoint_id: route.endpoint_id, template_id: route.template_id, purpose: route.purpose, target_class: route.target_class });
  accepted(await strictIngestion.validateIngestionRecord('metadata-fetch.schema.json', fetch), 'released fetch fixture');
  accepted(await strictIngestion.validateIngestionRecord('capture-reference.schema.json', capture), 'released capture fixture');
  return { fetch, capture };
}
async function inputFor(outcome = 'captured') {
  const { fetch, capture } = await recordsFor(outcome);
  return {
    receipt_id: 'receipt_pr009_independent_' + outcome,
    request_type: 'catalog_metadata', source_id: descriptor.source_id,
    descriptor_id: descriptor.descriptor_id, endpoint_id: route.endpoint_id, template_id: route.template_id,
    configuration_revision: descriptor.configuration_revision, descriptor_hash: clone(namedHash),
    purpose: route.purpose, expected_content_classes: [...route.expected_content_classes],
    safe_final_host: finalLocator.hostname, safe_final_path: finalLocator.pathname,
    redirect_count: fetch.redirect_count, observed_status: fetch.response_status, observed_media_type: outcome === 'not_modified' ? null : capture.media_type,
    observed_bytes: fetch.response_bytes, truncated: false, metadata_fetch: fetch, capture_reference: capture,
    parser_state: 'not_run', connector_name: descriptor.connector_name, connector_version: descriptor.connector_version,
    attempt_outcome: outcome, schema_validated: outcome === 'captured',
    next_action: outcome === 'not_modified' ? 'reuse_capture' : 'none', observed_at: fetch.observed_at,
  };
}
async function capturedReceipt() {
  const result = await composeEvidenceReceipt(await inputFor(), receiptContext);
  accepted(result, 'coherent captured receipt');
  assert.deepEqual(result.receipt.descriptor_hash, namedHash, 'Named canonical descriptor digest must be carried unchanged');
  return result.receipt;
}
async function negativePolicy(t, label, mutate) {
  await t.test(label, async () => {
    const candidate = clone(policy); mutate(candidate);
    rejected(await validateOperatingBoundsPolicy(candidate, policyContext), label);
  });
}
async function negativeReceipt(t, baseline, label, mutate) {
  await t.test(label, async () => {
    const candidate = clone(baseline); mutate(candidate);
    accepted(receiptContext.validateReceiptSchema(candidate), 'negative remains a schema-valid receipt envelope');
    rejected(await validateEvidenceReceipt(candidate, receiptContext), label);
  });
}

test('R009-I1: known source, descriptor, revision and route cannot be mixed', async t => {
  accepted(await validateOperatingBoundsPolicy(policy, policyContext), 'current paused policy');
  assert(policy.sources.length >= 2, 'Fixture precondition: at least two approved sources');
  await negativePolicy(t, 'registered descriptor from a different source', value => { value.sources[0].descriptor_id = value.sources[1].descriptor_id; });
  await negativePolicy(t, 'unbound configuration revision', value => { value.sources[0].configuration_revision += 1; });
  await negativePolicy(t, 'foreign registered endpoint/template pair', value => { value.sources[0].routes[0] = clone(value.sources[1].routes[0]); });
  await negativePolicy(t, 'omitted approved route', value => { value.sources[0].routes.pop(); });
});

test('R009-I2: each per-source request limit is specified and meaningful', async t => {
  const tighter = clone(policy);
  tighter.sources[0].bounds.timeout_seconds = 1;
  tighter.sources[0].bounds.maximum_redirects = 0;
  tighter.sources[0].origin_policy.maximum_concurrency = 1;
  accepted(await validateOperatingBoundsPolicy(tighter, policyContext), 'valid stricter source controls');
  await negativePolicy(t, 'missing source timeout', value => { delete value.sources[0].bounds.timeout_seconds; });
  await negativePolicy(t, 'zero source timeout', value => { value.sources[0].bounds.timeout_seconds = 0; });
  await negativePolicy(t, 'negative redirect allowance', value => { value.sources[0].bounds.maximum_redirects = -1; });
  await negativePolicy(t, 'missing concurrency allowance', value => { delete value.sources[0].origin_policy.maximum_concurrency; });
  await negativePolicy(t, 'fractional concurrency allowance', value => { value.sources[0].origin_policy.maximum_concurrency = 0.5; });
  await negativePolicy(t, 'negative request rate', value => { value.sources[0].origin_policy.requests_per_second = -1; });
});

test('R009-I3: evidence-bearing retention overrides permit shorter/longer days, not undefined durations', async t => {
  const override = {
    owner: 'reviewer_fixture_platform_owner',
    rationale: 'Synthetic source-policy boundary evidence; this fixture grants no real retention authority.',
    review_at: '2026-12-01T00:00:00.000Z',
    audit_event_id: 'event_pr009_retention_fixture',
    legal_rights_recovery_evidence: 'evidence_pr009_retention_fixture',
  };
  for (const days of [14, 120]) await t.test('explicit supported ' + days + '-day override', async () => {
    const candidate = clone(policy);
    candidate.sources[0].retention = { class: 'raw_metadata_documentation', active_days: days, override: clone(override) };
    accepted(await validateOperatingBoundsPolicy(candidate, policyContext), 'evidenced shorter/longer retention');
    assert.equal(candidate.global_bounds.retention.security_and_audit_receipt_days, 365);
    assert.equal(candidate.global_bounds.retention.hashes_and_lineage_outlive_raw, true);
  });
  for (const days of [0, -1, 1.5, null]) await negativePolicy(t, 'invalid evidenced duration ' + JSON.stringify(days), value => {
    value.sources[0].retention = { class: 'raw_metadata_documentation', active_days: days, override: clone(override) };
  });
  await negativePolicy(t, 'missing evidenced duration', value => { value.sources[0].retention = { class: 'raw_metadata_documentation', override: clone(override) }; });
  await negativePolicy(t, 'shortened security/audit protection', value => { value.global_bounds.retention.security_and_audit_receipt_days = 364; });
  await negativePolicy(t, 'removed dependency lineage protection', value => { value.global_bounds.retention.hashes_and_lineage_outlive_raw = false; });
});

test('R009-I4: malformed strict ingestion records fail despite intact version labels', async t => {
  for (const [label, key, schemaName, mutate] of [
    ['extra fetch property', 'metadata_fetch', 'metadata-fetch.schema.json', value => { value.unreleased_extension = true; }],
    ['missing capture content address', 'capture_reference', 'capture-reference.schema.json', value => { delete value.r2_key; }],
    ['invalid fetch timestamp', 'metadata_fetch', 'metadata-fetch.schema.json', value => { value.observed_at = 'not-a-timestamp'; }],
  ]) await t.test(label, async () => {
    const input = await inputFor(); mutate(input[key]);
    assert.equal(input[key].contract_version, 'ingestion.v1.0.0');
    rejected(await strictIngestion.validateIngestionRecord(schemaName, input[key]), 'independent released schema control');
    rejected(await composeEvidenceReceipt(input, receiptContext), label);
  });
});

test('R009-I5: schema-valid capture/fetch/receipt identities must describe the same observation', async t => {
  const baseline = await capturedReceipt();
  await negativeReceipt(t, baseline, 'receipt source differs from capture source', value => { value.source_id = 'source_pr009_other'; });
  await negativeReceipt(t, baseline, 'receipt endpoint differs from fetch endpoint', value => { value.endpoint_id = 'endpoint_pr009_other'; });
  await negativeReceipt(t, baseline, 'receipt capture ID differs from cited capture', value => { value.capture.capture_ref_id = 'capture_pr009_other'; });
  await t.test('individually valid fetch and capture belong to different runs', async () => {
    const input = await inputFor(); input.capture_reference.run_id = 'run_pr009_other';
    accepted(await strictIngestion.validateIngestionRecord('capture-reference.schema.json', input.capture_reference), 'individually valid other-run capture');
    accepted(await strictIngestion.validateIngestionRecord('metadata-fetch.schema.json', input.metadata_fetch), 'individually valid original fetch');
    rejected(await composeEvidenceReceipt(input, receiptContext), 'mixed observation runs');
  });
  await t.test('individually valid fetch points to a different capture ID', async () => {
    const input = await inputFor(); input.metadata_fetch.capture_ref_id = 'capture_pr009_other';
    accepted(await strictIngestion.validateIngestionRecord('metadata-fetch.schema.json', input.metadata_fetch), 'individually valid different capture pointer');
    rejected(await composeEvidenceReceipt(input, receiptContext), 'fetch/capture reference disagreement');
  });
  await negativeReceipt(t, baseline, 'canonical basis cannot disguise a different hash version', value => { value.descriptor_hash.hash_version = 'ushso-canonical-json.v2'; });
});

test('R009-I6: accepted capture byte/hash projections remain bound to the cited record', async t => {
  const baseline = await capturedReceipt();
  await negativeReceipt(t, baseline, 'capture projection compressed byte drift', value => { value.capture.compressed_bytes += 1; });
  await negativeReceipt(t, baseline, 'capture projection expanded byte drift', value => { value.capture.decompressed_bytes += 1; });
  await negativeReceipt(t, baseline, 'capture projection hash drift', value => { value.capture.raw_sha256 = '0'.repeat(64); });
  await negativeReceipt(t, baseline, 'receipt status contradicts captured fetch', value => { value.observed_status = 404; });
  await negativeReceipt(t, baseline, 'truncated bytes cannot be an accepted complete capture', value => { value.truncated = true; value.schema_validated = false; });
});

test('R009-I7: 304 reuse cannot invent new response bytes or different cached hashes', async t => {
  const result = await composeEvidenceReceipt(await inputFor('not_modified'), receiptContext);
  accepted(result, 'coherent 304 reuse');
  await negativeReceipt(t, result.receipt, '304 receipt invents response bytes', value => { value.observed_bytes = 1; });
  await negativeReceipt(t, result.receipt, '304 receipt claims a different HTTP status', value => { value.observed_status = 200; });
  await negativeReceipt(t, result.receipt, '304 receipt changes retained capture hash', value => { value.capture.raw_sha256 = '0'.repeat(64); });
});

// Deliberately absent: duplicate Census replay, default happy paths, unnamed/exact-byte
// basis cases, implementation-source regex tests, and cost/architecture qualification.
