import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  applyMutation,
  canonicalDigest,
  canonicalJson,
  criticalClaimDigest,
  criticalClaimProjection,
  normalizedRequestDigest,
  PACKAGE_ROOT,
  planDigest,
  readJson,
  sha256File
} from '../tools/common.mjs';
import { signClarificationToken, tamperToken, verifyClarificationToken } from '../tools/clarification-token.mjs';
import { schemaPropertyInventoryDigest } from '../tools/claim-manifest.mjs';
import { loadSchemas, schemaErrors, validatorFor } from '../tools/schema.mjs';
import { PLAN_STATUS_PRECEDENCE, validateResearchPlan } from '../tools/semantics.mjs';

const claimManifest = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'claim-manifest.json'));
const fixtures = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-plans.json'));
const adversarial = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'adversarial-cases.json'));
const tokenCases = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'clarification-token-cases.json'));
const roundtrips = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'clarification-roundtrips.json'));

function collectObjectSchemas(node, pointer = '$', collected = []) {
  if (Array.isArray(node)) {
    node.forEach((value, index) => collectObjectSchemas(value, `${pointer}/${index}`, collected));
    return collected;
  }
  if (!node || typeof node !== 'object') return collected;
  if (node.type === 'object') collected.push({ node, pointer });
  for (const [key, value] of Object.entries(node)) collectObjectSchemas(value, `${pointer}/${key}`, collected);
  return collected;
}

function runTokenScenario(testCase) {
  const keys = structuredClone(tokenCases.keys);
  const claims = structuredClone(tokenCases.base_claims);
  let signingKey = keys.find(key => key.key_version === claims.key_version);
  const context = structuredClone(tokenCases.verification_context);
  if (testCase.scenario === 'verify_only_rotation') {
    claims.key_version = 'clarification-key-v1';
    signingKey = { ...keys.find(key => key.key_version === claims.key_version), state: 'active' };
  }
  let token = signClarificationToken(claims, signingKey);
  if (testCase.scenario === 'tampered') token = tamperToken(token);
  if (testCase.scenario === 'expired') context.now = '2026-08-30T12:00:01Z';
  if (testCase.scenario === 'stale_generation') context.expected_generation = 'obs:index-generation:fixture-v2';
  if (testCase.scenario === 'changed_request_hash') context.request_hash = `sha256:${'d'.repeat(64)}`;
  if (testCase.scenario === 'changed_question_set') context.question_set_hash = `sha256:${'e'.repeat(64)}`;
  return verifyClarificationToken(token, { keys, ...context });
}

test('all package schemas compile as strict JSON Schema 2020-12', async () => {
  const { ajv, schemas } = await loadSchemas();
  assert.ok(schemas.length >= 15);
  for (const { name, schema } of schemas) {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name);
    assert.ok(ajv.getSchema(schema.$id), `${name} did not compile`);
    for (const objectSchema of collectObjectSchemas(schema)) {
      assert.equal(objectSchema.node.additionalProperties, false, `${name}:${objectSchema.pointer} is not closed`);
    }
  }
});

test('canonical plan schema requires every section in plan 14.1 plus reason codes', async () => {
  const { schemas } = await loadSchemas();
  const planSchema = schemas.find(row => row.name === 'research-plan.schema.json').schema;
  const required = new Set(planSchema.required);
  for (const field of [
    'contract_version', 'plan_id', 'plan_status', 'generated_from', 'interpreted_need', 'clarifications',
    'response', 'asset_contributions', 'bundle_assessment', 'operations', 'acquisition_plan',
    'downstream_handoff', 'important_limitations', 'unresolved_gaps', 'conditions_not_recommend',
    'evidence_references', 'truth_boundary', 'plan_status_reason_codes'
  ]) assert.ok(required.has(field), field);
  assert.deepEqual(PLAN_STATUS_PRECEDENCE, ['unsupported', 'clarification_required', 'incomplete', 'ready_with_constraints', 'ready']);
});

test('valid fixtures cover all statuses and pass schema plus semantic validation', async () => {
  const bundleValidator = await validatorFor('valid-plan-fixtures.schema.json');
  assert.equal(bundleValidator(fixtures), true, JSON.stringify(schemaErrors(bundleValidator)));
  assert.deepEqual(new Set(fixtures.plans.map(plan => plan.plan_status)), new Set(PLAN_STATUS_PRECEDENCE));
  const planValidator = await validatorFor('research-plan.schema.json');
  for (const plan of fixtures.plans) {
    assert.equal(planValidator(plan), true, `${plan.plan_status}: ${JSON.stringify(schemaErrors(planValidator))}`);
    assert.deepEqual(validateResearchPlan(plan, { claimManifest }), [], plan.plan_status);
  }
});

test('every adversarial planner overclaim is rejected with its frozen reason codes', async () => {
  const fixtureValidator = await validatorFor('adversarial-cases.schema.json');
  assert.equal(fixtureValidator(adversarial), true, JSON.stringify(schemaErrors(fixtureValidator)));
  const planValidator = await validatorFor('research-plan.schema.json');
  for (const testCase of adversarial.cases) {
    const base = fixtures.plans.find(plan => plan.plan_status === testCase.base_plan_status && plan.clarifications.state !== 'answered');
    const candidate = applyMutation(base, testCase.mutation);
    const codes = new Set();
    if (!planValidator(candidate)) schemaErrors(planValidator).forEach(error => codes.add(error.code));
    validateResearchPlan(candidate, { claimManifest }).forEach(error => codes.add(error.code));
    for (const expected of testCase.expected_codes) assert.ok(codes.has(expected), `${testCase.case_id}: missing ${expected}; got ${[...codes].join(',')}`);
  }
});

test('plan and critical-claim digests are deterministic and transport-independent', () => {
  const plan = fixtures.plans.find(candidate => candidate.plan_status === 'ready' && candidate.clarifications.state === 'not_required');
  assert.equal(plan.plan_id, planDigest(plan));
  assert.deepEqual(plan.response.critical_claim_projection, criticalClaimProjection(plan));
  assert.equal(plan.response.critical_claim_digest, criticalClaimDigest(plan));
  assert.equal(planDigest(structuredClone(plan)), plan.plan_id);
  const firstEnvelope = { request_id: 'request:first', response_generated_at: '2026-08-30T01:00:00Z', clarification_token: null, plan };
  const secondEnvelope = { request_id: 'request:second', response_generated_at: '2026-08-30T02:00:00Z', clarification_token: 'different.transport.token', plan };
  assert.equal(planDigest(firstEnvelope.plan), planDigest(secondEnvelope.plan));
});

test('critical projection carries exact IDs, coverage, access, operations, support, and truth', () => {
  const pa = fixtures.plans.find(plan => plan.asset_contributions.some(contribution => contribution.asset_id === 'obs:asset:phc4-utilization'));
  const projection = pa.response.critical_claim_projection;
  assert.equal(projection.exact_selections.length, 3);
  assert.ok(projection.exact_selections.every(selection => selection.asset_id && selection.release_id && selection.distribution_id && selection.access_route_id && selection.source_id));
  assert.equal(projection.coverage.common_supported.period.end, '2024-12-31');
  assert.equal(projection.operations.find(operation => operation.operation_kind === 'join').evidence_state, 'candidate');
  assert.equal(projection.downstream_support[0].classification, 'conditional');
  assert.deepEqual(projection.truth_boundary, pa.truth_boundary);
});

test('request and normalized-request contracts are bounded, closed, and digest-pinned', async () => {
  const request = {
    contract_version: 'observatory-research-plan-request.v1.0.0',
    question: 'Which exact public hospital finance source should I use in Pennsylvania?',
    constraints: {
      geographies: ['geo:us-pa'],
      time_period: null,
      grain: 'facility',
      access_classes: ['public'],
      machine_access_required: true,
      intended_analyses: ['finance-input-assessment']
    },
    clarification_answers: [],
    expected_generation: null,
    normalized_request_hash: null,
    clarification_token: null,
    prior_plan_id: null
  };
  const requestValidator = await validatorFor('research-plan-request.schema.json');
  assert.equal(requestValidator(request), true, JSON.stringify(schemaErrors(requestValidator)));
  assert.equal(requestValidator({ ...request, unexpected: true }), false);

  const normalized = {
    contract_version: 'observatory-normalized-research-request.v1.0.0',
    normalized_request_hash: `sha256:${'0'.repeat(64)}`,
    question_hash: `sha256:${'f'.repeat(64)}`,
    boundary_state: 'in_scope',
    geographies: ['geo:us-pa'],
    time_period: null,
    grain: 'facility',
    access_classes: ['public'],
    machine_access_required: true,
    intended_analyses: ['finance-input-assessment'],
    required_roles: ['role:finance'],
    clarification_question_ids: [],
    normalizer_fingerprint: `sha256:${'a'.repeat(64)}`
  };
  normalized.normalized_request_hash = normalizedRequestDigest(normalized);
  const normalizedValidator = await validatorFor('normalized-request.schema.json');
  assert.equal(normalizedValidator(normalized), true, JSON.stringify(schemaErrors(normalizedValidator)));
  assert.equal(normalized.normalized_request_hash, normalizedRequestDigest(normalized));
});

test('clarification tokens are privacy-safe and reject tamper, expiry, and stale pins', async () => {
  const fixtureValidator = await validatorFor('clarification-token-cases.schema.json');
  assert.equal(fixtureValidator(tokenCases), true, JSON.stringify(schemaErrors(fixtureValidator)));
  const privacySurface = canonicalJson({ base_claims: tokenCases.base_claims, cases: tokenCases.cases });
  assert.doesNotMatch(privacySurface, /"(?:question|user|user_id|userId)"/);
  for (const testCase of tokenCases.cases) assert.equal(runTokenScenario(testCase).code, testCase.expected_code, testCase.case_id);
});

test('clarification round trips pin generation and deterministically reach ready or incomplete', async () => {
  const validator = await validatorFor('clarification-roundtrips.schema.json');
  assert.equal(validator(roundtrips), true, JSON.stringify(schemaErrors(validator)));
  const byId = new Map(fixtures.plans.map(plan => [plan.plan_id, plan]));
  assert.deepEqual(new Set(roundtrips.transitions.map(transition => transition.result_status)), new Set(['ready', 'incomplete']));
  for (const transition of roundtrips.transitions) {
    const initial = byId.get(transition.initial_plan_id);
    const result = byId.get(transition.result_plan_id);
    assert.equal(initial.plan_status, 'clarification_required');
    assert.equal(result.clarifications.prior_plan_id, initial.plan_id);
    assert.equal(result.generated_from.index_generation, transition.expected_generation);
    assert.equal(result.plan_status, transition.result_status);
  }
});

test('Pennsylvania vertical slice remains exact, constrained, and non-executed', () => {
  const pa = fixtures.plans.find(plan => plan.asset_contributions.some(contribution => contribution.asset_id === 'obs:asset:phc4-utilization'));
  assert.equal(pa.plan_status, 'ready_with_constraints');
  assert.equal(pa.asset_contributions.length, 3);
  assert.ok(pa.asset_contributions.every(contribution => contribution.selection_level === 'exact_distribution'));
  assert.equal(pa.bundle_assessment.common_coverage_method, 'intersection');
  assert.equal(pa.bundle_assessment.common_supported_coverage.period.end, '2024-12-31');
  assert.equal(pa.operations.find(operation => operation.operation_kind === 'join').evidence_state, 'candidate');
  assert.ok(pa.operations.some(operation => operation.operation_kind === 'aggregate' && operation.executed === false));
  assert.ok(pa.unresolved_gaps.some(gap => gap.code === 'CROSSWALK_REQUIRED'));
  assert.ok(Object.values(pa.truth_boundary).every(value => value === false));
});

test('claim and digest manifests freeze auditable roots and exact hash coverage', async () => {
  const claimValidator = await validatorFor('claim-manifest.schema.json');
  assert.equal(claimValidator(claimManifest), true, JSON.stringify(schemaErrors(claimValidator)));
  assert.equal(claimManifest.schema_property_inventory_digest, await schemaPropertyInventoryDigest(claimManifest));
  const criticalPointers = new Set(claimManifest.critical_claims.map(claim => claim.json_pointer));
  for (const pointer of ['/plan_status', '/asset_contributions', '/bundle_assessment/common_supported_coverage', '/operations', '/downstream_handoff', '/truth_boundary']) assert.ok(criticalPointers.has(pointer));

  const digestTaxonomy = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'digest-taxonomy.json'));
  const digestValidator = await validatorFor('digest-taxonomy.schema.json');
  assert.equal(digestValidator(digestTaxonomy), true, JSON.stringify(schemaErrors(digestValidator)));
  const planRule = digestTaxonomy.digests.find(rule => rule.digest_kind === 'canonical_plan');
  assert.deepEqual(planRule.excluded_json_pointers, ['/plan_id']);
  assert.deepEqual(planRule.transport_fields_outside_payload, ['/request_id', '/response_generated_at', '/clarification_token']);
});

test('package manifest uses raw-byte hashes and canonical self-digest', async () => {
  const manifest = await readJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'));
  const validator = await validatorFor('package-manifest.schema.json');
  assert.equal(validator(manifest), true, JSON.stringify(schemaErrors(validator)));
  const body = structuredClone(manifest);
  delete body.manifest_digest;
  assert.equal(manifest.manifest_digest, canonicalDigest(body));
  for (const artifact of manifest.artifacts) assert.equal(await sha256File(path.join(PACKAGE_ROOT, artifact.path)), artifact.sha256, artifact.path);
});

test('validation receipt pins the exact successful package manifest', async () => {
  const manifest = await readJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'));
  const receipt = await readJson(path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json'));
  const validator = await validatorFor('validation-receipt.schema.json');
  assert.equal(validator(receipt), true, JSON.stringify(schemaErrors(validator)));
  assert.equal(receipt.manifest_digest, manifest.manifest_digest);
  assert.equal(receipt.fixture_counts.statuses, 5);
  assert.ok(receipt.fixture_counts.valid_plans >= 7);
  assert.ok(receipt.fixture_counts.adversarial_cases >= 25);
});
