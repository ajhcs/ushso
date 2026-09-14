import assert from 'node:assert/strict';
import test from 'node:test';
import { createStaticMachineToolkitRuntime } from '../../worker/static-machine-toolkit-service.mjs';
import { createMachineToolkit } from '../../packages/machine-toolkit/src/index.mjs';
import {
  CENSUS_ABSCB_2023_ID,
  HCUP_FIXTURE_ID,
  HCRIS_HOSPITAL_COST_REPORT_ID,
  QUALIFIED_ROUTES,
  matchQualifiedRoute,
} from '../../packages/registry/qualified-access-routes.mjs';

const generation = 'live-2026-09-03-85b50522b420';
const cms = QUALIFIED_ROUTES.find((route) => route.kind === 'public_cms');
const census = QUALIFIED_ROUTES.find((route) => route.kind === 'keyed_census');
const hcup = QUALIFIED_ROUTES.find((route) => route.kind === 'restricted_hcup');

function record({ record_id, title, source_id, source_name, evidence_id, url }) {
  return {
    record_id,
    title,
    identity: { source: { source_id, name: source_name } },
    evidence: [{ evidence_id }],
    authoritative_url: url,
    freshness_verification: { metadata_observed_at: '2026-09-03T22:22:33.908Z', verification_status: 'current_verified' },
  };
}

const records = [
  record({
    record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
    title: 'Hospital Provider Cost Report',
    source_id: 'cms-data-catalog',
    source_name: 'CMS Data Catalog',
    evidence_id: 'evidence:cms-data-catalog:bf696c5e94f4146abe7ad61b',
    url: 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report',
  }),
  record({
    record_id: CENSUS_ABSCB_2023_ID,
    title: '2023 Annual Business Survey: Characteristics of Businesses',
    source_id: 'census-api',
    source_name: 'U.S. Census Bureau API Catalog',
    evidence_id: 'evidence:census-api:7fc87283de48cd3575920c57',
    url: 'https://api.census.gov/data/id/ABSCB2023',
  }),
  record({
    record_id: HCUP_FIXTURE_ID,
    title: 'HCUP National Inpatient Sample',
    source_id: 'ahrq-hcup',
    source_name: 'AHRQ HCUP',
    evidence_id: 'evidence.hcup.documentation',
    url: 'https://hcup-us.ahrq.gov/databases.jsp',
  }),
];

function toolkit() {
  const runtime = createStaticMachineToolkitRuntime({
    records,
    corpus: {
      corpus_version: '1.2.0',
      manifest_sha256: 'a'.repeat(64),
      publication: { generation, observed_at: '2026-09-03T22:22:33.908Z' },
    },
  });
  return createMachineToolkit({ service: runtime.operations, responseContext: runtime.context });
}

function ids(route) {
  return {
    record_id: route.record_id,
    release_id: route.release_id,
    distribution_id: route.distribution_id,
    access_route_id: route.access_route_id,
    expected_generation: generation,
  };
}

test('public CMS, keyed Census and restricted HCUP fixtures produce different legitimate next steps', async () => {
  const tk = toolkit();
  const cmsPlan = await tk.invokeJsonApi('get_access_plan', {
    contract_version: 'observatory.machine.get-access-plan.input.v1.0.0',
    ...ids(cms),
  });
  const censusPlan = await tk.invokeJsonApi('get_access_plan', {
    contract_version: 'observatory.machine.get-access-plan.input.v1.0.0',
    ...ids(census),
  });
  const hcupPlan = await tk.invokeJsonApi('get_access_plan', {
    contract_version: 'observatory.machine.get-access-plan.input.v1.0.0',
    ...ids(hcup),
  });
  assert.equal(cmsPlan.ok, true, JSON.stringify(cmsPlan.error));
  assert.equal(censusPlan.ok, true, JSON.stringify(censusPlan.error));
  assert.equal(hcupPlan.ok, true, JSON.stringify(hcupPlan.error));
  assert.equal(cmsPlan.result.access_class, 'public');
  assert.equal(censusPlan.result.access_class, 'registration');
  assert.equal(hcupPlan.result.access_class, 'application');
  assert.notEqual(cmsPlan.result.process_steps[0], censusPlan.result.process_steps[0]);
  assert.notEqual(censusPlan.result.process_steps[0], hcupPlan.result.process_steps[0]);
  assert.match(cmsPlan.result.human_process, /CMS/);
  assert.match(censusPlan.result.human_process, /Census API key/);
  assert.match(hcupPlan.result.human_process, /restricted/);
  assert.equal(cmsPlan.result.execution_authorized_by_ushso, false);
  assert.equal(hcupPlan.result.human_authorization_gate, true);
  assert.equal(matchQualifiedRoute({ record_id: 'other', release_id: cms.release_id, distribution_id: cms.distribution_id, access_route_id: cms.access_route_id }), null);
});

test('a returned recipe contains no secret or source payload and does not execute because a client inspected it', async () => {
  const tk = toolkit();
  const recipe = await tk.invokeJsonApi('get_retrieval_recipe', {
    contract_version: 'observatory.machine.get-retrieval-recipe.input.v1.0.0',
    ...ids(census),
  });
  assert.equal(recipe.ok, true, JSON.stringify(recipe.error));
  const blob = JSON.stringify(recipe.result);
  assert.equal(recipe.result.retrieval_executed, false);
  assert.equal(recipe.result.payloads_acquired, false);
  assert.match(blob, /\[REDACTED\]/);
  assert.doesNotMatch(blob, /secret-value|sk_live|Bearer /);
  assert.match(recipe.result.sample_requests.join('\n'), /\[REDACTED\]/);
  assert.equal(recipe.result.parameters[0].example_value, '[REDACTED]');
  const cost = recipe.result.checks.find((row) => row.includes('Cost remains'));
  assert.match(cost, /unknown/);
  assert.match(cost, /quota remains unknown/);
  const cmsRecipe = await tk.invokeJsonApi('get_retrieval_recipe', {
    contract_version: 'observatory.machine.get-retrieval-recipe.input.v1.0.0',
    ...ids(cms),
  });
  assert.equal(cmsRecipe.result.authentication_type, 'none');
  assert.equal(cmsRecipe.result.retrieval_executed, false);
});

test('nonretryable route_not_documented no longer tells clients to retry blindly against unchanged metadata', async () => {
  const tk = toolkit();
  const missing = await tk.invokeJsonApi('get_access_plan', {
    contract_version: 'observatory.machine.get-access-plan.input.v1.0.0',
    record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
    release_id: 'release.fake',
    distribution_id: 'distribution.fake',
    access_route_id: 'access.fake',
    expected_generation: generation,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'route_not_documented');
  assert.equal(missing.error.retryable, false);
  assert.equal(missing.result_state, 'unknown');
  assert.match(missing.error.corrective_guidance, /get_asset/);
  assert.doesNotMatch(missing.error.corrective_guidance, /Retry later/i);
  assert.doesNotMatch(missing.error.safe_message, /Retry later/i);
  const absent = await tk.invokeJsonApi('get_retrieval_recipe', {
    contract_version: 'observatory.machine.get-retrieval-recipe.input.v1.0.0',
    record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
    release_id: null,
    distribution_id: null,
    access_route_id: null,
    expected_generation: generation,
  });
  assert.equal(absent.error.code, 'route_not_documented');
  assert.equal(absent.error.retryable, false);
  assert.doesNotMatch(absent.error.corrective_guidance, /Retry later/i);
});
