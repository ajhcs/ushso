import fs from 'node:fs/promises';
import path from 'node:path';

import { applyMutation, canonicalDigest, canonicalJson, PACKAGE_ROOT, planDigest, readJson, sha256File, walkFiles, writeAtomic } from './common.mjs';
import { signClarificationToken, tamperToken, verifyClarificationToken } from './clarification-token.mjs';
import { schemaPropertyInventoryDigest } from './claim-manifest.mjs';
import { schemaErrors, validatorFor, loadSchemas } from './schema.mjs';
import { validateResearchPlan } from './semantics.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function validateWith(schemaName, value, label) {
  const validate = await validatorFor(schemaName);
  assert(validate(value), `${label}: ${JSON.stringify(schemaErrors(validate))}`);
}

async function validateManifest(manifest) {
  await validateWith('package-manifest.schema.json', manifest, 'package manifest');
  const body = structuredClone(manifest);
  delete body.manifest_digest;
  assert(manifest.manifest_digest === canonicalDigest(body), 'manifest canonical digest mismatch');
  for (const artifact of manifest.artifacts) {
    const absolute = path.join(PACKAGE_ROOT, artifact.path);
    const stat = await fs.stat(absolute);
    assert(stat.size === artifact.bytes, `manifest byte count mismatch: ${artifact.path}`);
    assert(await sha256File(absolute) === artifact.sha256, `manifest raw SHA-256 mismatch: ${artifact.path}`);
  }
  const excluded = new Set(['manifests/package-manifest.json', 'validation/validation-receipt.json']);
  const actualPaths = (await walkFiles(PACKAGE_ROOT)).filter(file => !excluded.has(file)).sort();
  const manifestedPaths = manifest.artifacts.map(artifact => artifact.path).sort();
  assert(canonicalJson(actualPaths) === canonicalJson(manifestedPaths), 'manifest artifact inventory is incomplete or has stale paths');
}

function tokenOutcome(scenario, fixture) {
  const keys = structuredClone(fixture.keys);
  let claims = structuredClone(fixture.base_claims);
  let signingKey = keys.find(key => key.key_version === claims.key_version);
  let context = structuredClone(fixture.verification_context);
  if (scenario === 'verify_only_rotation') {
    claims.key_version = 'clarification-key-v1';
    const verifyOnly = keys.find(key => key.key_version === claims.key_version);
    signingKey = { ...verifyOnly, state: 'active' };
  }
  let token = signClarificationToken(claims, signingKey);
  if (scenario === 'tampered') token = tamperToken(token);
  if (scenario === 'expired') context.now = '2026-08-30T12:00:01Z';
  if (scenario === 'stale_generation') context.expected_generation = 'obs:index-generation:fixture-v2';
  if (scenario === 'changed_request_hash') context.request_hash = `sha256:${'d'.repeat(64)}`;
  if (scenario === 'changed_question_set') context.question_set_hash = `sha256:${'e'.repeat(64)}`;
  return verifyClarificationToken(token, { keys, ...context });
}

export async function validatePackage() {
  const { ajv, schemas } = await loadSchemas();
  assert(schemas.length >= 15, 'schema inventory unexpectedly small');
  for (const { schema, name } of schemas) {
    assert(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', `${name} does not use JSON Schema 2020-12`);
    assert(ajv.getSchema(schema.$id), `${name} did not compile`);
  }

  const claimManifest = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'claim-manifest.json'));
  const digestTaxonomy = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'digest-taxonomy.json'));
  const fixtures = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-plans.json'));
  const adversarial = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'adversarial-cases.json'));
  const tokenCases = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'clarification-token-cases.json'));
  const roundtrips = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'clarification-roundtrips.json'));
  const manifest = await readJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'));

  await validateWith('claim-manifest.schema.json', claimManifest, 'claim manifest');
  assert(claimManifest.schema_property_inventory_digest === await schemaPropertyInventoryDigest(claimManifest), 'claim manifest schema-property inventory is stale');
  await validateWith('digest-taxonomy.schema.json', digestTaxonomy, 'digest taxonomy');
  await validateWith('valid-plan-fixtures.schema.json', fixtures, 'valid plans');
  await validateWith('adversarial-cases.schema.json', adversarial, 'adversarial cases');
  await validateWith('clarification-token-cases.schema.json', tokenCases, 'clarification token cases');
  await validateWith('clarification-roundtrips.schema.json', roundtrips, 'clarification roundtrips');
  await validateManifest(manifest);

  const planValidator = await validatorFor('research-plan.schema.json');
  for (const plan of fixtures.plans) {
    assert(planValidator(plan), `${plan.plan_status} fixture schema invalid: ${JSON.stringify(schemaErrors(planValidator))}`);
    const semanticErrors = validateResearchPlan(plan, { claimManifest });
    assert(semanticErrors.length === 0, `${plan.plan_status} fixture semantic errors: ${JSON.stringify(semanticErrors)}`);
    assert(plan.plan_id === planDigest(plan), `${plan.plan_status} fixture plan digest mismatch`);
  }
  const statuses = new Set(fixtures.plans.map(plan => plan.plan_status));
  assert(statuses.size === 5, 'all five plan statuses must be fixture-covered');

  for (const testCase of adversarial.cases) {
    const base = fixtures.plans.find(plan => plan.plan_status === testCase.base_plan_status && plan.clarifications.state !== 'answered');
    assert(base, `base plan missing for ${testCase.case_id}`);
    const candidate = applyMutation(base, testCase.mutation);
    const codes = new Set();
    if (!planValidator(candidate)) for (const error of schemaErrors(planValidator)) codes.add(error.code);
    for (const error of validateResearchPlan(candidate, { claimManifest })) codes.add(error.code);
    for (const expected of testCase.expected_codes) assert(codes.has(expected), `${testCase.case_id} missing ${expected}; got ${[...codes].join(',')}`);
  }

  const tokenClaimsValidator = ajv.getSchema('https://ushso.org/contracts/research-plan/v1.0.0/schemas/clarification.schema.json#/$defs/tokenClaims');
  assert(tokenClaimsValidator(tokenCases.base_claims), `clarification claims invalid: ${JSON.stringify(schemaErrors(tokenClaimsValidator))}`);
  const tokenFixtureText = canonicalJson({ base_claims: tokenCases.base_claims, cases: tokenCases.cases });
  assert(!/"(?:question|user|user_id|userId)"/.test(tokenFixtureText), 'clarification token fixture contains raw question/user field');
  for (const testCase of tokenCases.cases) {
    const result = tokenOutcome(testCase.scenario, tokenCases);
    assert(result.code === testCase.expected_code, `${testCase.case_id}: expected ${testCase.expected_code}, got ${result.code}`);
  }

  const byPlanId = new Map(fixtures.plans.map(plan => [plan.plan_id, plan]));
  for (const transition of roundtrips.transitions) {
    const initial = byPlanId.get(transition.initial_plan_id);
    const result = byPlanId.get(transition.result_plan_id);
    assert(initial?.plan_status === 'clarification_required', `${transition.transition_id} initial plan invalid`);
    assert(result?.plan_status === transition.result_status, `${transition.transition_id} result status invalid`);
    assert(result.clarifications.prior_plan_id === initial.plan_id, `${transition.transition_id} prior plan not pinned`);
    assert(result.generated_from.index_generation === transition.expected_generation, `${transition.transition_id} generation not pinned`);
    assert(transition.answer_question_ids.every(id => result.clarifications.answers.some(answer => answer.question_id === id)), `${transition.transition_id} answer missing`);
  }

  const pa = fixtures.plans.find(plan => plan.asset_contributions.some(contribution => contribution.asset_id === 'obs:asset:phc4-utilization'));
  assert(pa?.plan_status === 'ready_with_constraints', 'PA vertical slice must be constrained');
  assert(pa.bundle_assessment.common_supported_coverage.period.end === '2024-12-31', 'PA common coverage must stop at 2024');
  assert(pa.operations.some(operation => operation.operation_kind === 'join' && operation.evidence_state === 'candidate'), 'PA candidate CCN join missing');
  assert(pa.operations.some(operation => operation.operation_kind === 'aggregate' && operation.executed === false), 'PA non-executed aggregation missing');
  assert(pa.unresolved_gaps.some(gap => gap.code === 'CROSSWALK_REQUIRED'), 'PA crosswalk gap missing');

  const repeat = fixtures.plans.find(plan => plan.plan_status === 'ready' && plan.clarifications.state === 'not_required');
  assert(planDigest(repeat) === planDigest(structuredClone(repeat)), 'repeat canonical plan digest changed');
  const envelopeA = { request_id: 'request:a', response_generated_at: '2026-08-30T00:00:00Z', clarification_token: null, plan: repeat };
  const envelopeB = { request_id: 'request:b', response_generated_at: '2026-08-30T00:01:00Z', clarification_token: 'opaque.transport.token', plan: repeat };
  assert(planDigest(envelopeA.plan) === planDigest(envelopeB.plan), 'transport fields changed canonical plan digest');

  return {
    schemas: schemas.length,
    validPlans: fixtures.plans.length,
    statuses: statuses.size,
    adversarialCases: adversarial.cases.length,
    clarificationCases: tokenCases.cases.length,
    clarificationTransitions: roundtrips.transitions.length,
    manifestDigest: manifest.manifest_digest
  };
}

const result = await validatePackage();
if (process.argv.includes('--write-receipt')) {
  const receipt = {
    contract_version: 'observatory-research-plan-validation-receipt.v1.0.0',
    receipt_id: 'obs:receipt:research-plan-contract:v1.0.0',
    verification_date: '2026-08-30',
    package_version: '1.0.0',
    manifest_digest: result.manifestDigest,
    commands: [
      'npm test --prefix contracts/research-plan/v1.0.0',
      'npm run validate --prefix contracts/research-plan/v1.0.0'
    ],
    results: {
      schemas_compiled: 'pass',
      valid_fixtures: 'pass',
      adversarial_fixtures: 'pass',
      clarification_scenarios: 'pass',
      manifest_integrity: 'pass',
      determinism: 'pass'
    },
    fixture_counts: {
      valid_plans: result.validPlans,
      statuses: result.statuses,
      adversarial_cases: result.adversarialCases,
      clarification_cases: result.clarificationCases
    },
    validated_requirements: [
      'PLAN_STATUS_PRECEDENCE',
      'EXACT_EXECUTABLE_IDS',
      'EVIDENCE_ADMISSIBILITY',
      'COMMON_COVERAGE_INTERSECTION',
      'FISCAL_CALENDAR_SEPARATION',
      'CANDIDATE_JOIN_NO_UPGRADE',
      'IDENTITY_TIME_SCOPE',
      'CROSSWALK_AGGREGATION_SEPARATION',
      'HUMAN_AUTHORIZATION_GATES',
      'ACYCLIC_OPERATION_DAG',
      'ACYCLIC_ACQUISITION_DAG',
      'NO_ANALYSIS_OR_PAYLOADS',
      'HUMAN_JSON_CRITICAL_PARITY',
      'STATELESS_CLARIFICATION_PRIVACY',
      'CANONICAL_PLAN_DETERMINISM'
    ]
  };
  const receiptValidator = await validatorFor('validation-receipt.schema.json');
  assert(receiptValidator(receipt), `receipt invalid: ${JSON.stringify(schemaErrors(receiptValidator))}`);
  await writeAtomic(path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`wrote validation receipt for ${result.validPlans} plans and ${result.adversarialCases} adversarial cases\n`);
} else {
  process.stdout.write(`validated ${result.schemas} schemas, ${result.validPlans} plans, ${result.adversarialCases} adversarial cases, and ${result.clarificationCases} token cases\n`);
}
