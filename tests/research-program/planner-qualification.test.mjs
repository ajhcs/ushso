import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createMachineCursorSigner } from '../../worker/machine-cursor.mjs';
import { createStaticMachineToolkitRuntime } from '../../worker/static-machine-toolkit-service.mjs';
import { createMachineToolkit } from '../../packages/machine-toolkit/src/index.mjs';
import { PUBLIC_CAPABILITY_FLAGS } from '../../packages/machine-toolkit/src/manifest.mjs';
import { LAST_GOOD_GENERATION, PLANNER_PUBLIC_ACTIVATION, compileMetadataPlan, assertNoInvention } from '../../packages/planner/index.mjs';
import { HCRIS_HOSPITAL_COST_REPORT_ID } from '../../packages/registry/asset-context-collections.mjs';

const corpus = JSON.parse(readFileSync('packages/retrieval/versions/v1.2.0/corpus/corpus.json', 'utf8'));
const hcris = readFileSync('packages/retrieval/versions/v1.2.0/corpus/records-0003.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
  .find((record) => record.record_id === HCRIS_HOSPITAL_COST_REPORT_ID);
const planPage = readFileSync('apps/web/src/pages/PlanPage.tsx', 'utf8');
const workerIndex = readFileSync('worker/index.mjs', 'utf8');
const webmcp = JSON.parse(readFileSync('packages/machine-toolkit/public-webmcp-tool.json', 'utf8'));
const activationContract = JSON.parse(readFileSync('contracts/machine-toolkit/planner-activation.v1.json', 'utf8'));

function toolkit() {
  const runtime = createStaticMachineToolkitRuntime({
    corpus: { ...corpus, publication: { ...corpus.publication, generation: LAST_GOOD_GENERATION } },
    records: [hcris],
  }, { cursorSigner: createMachineCursorSigner() });
  return createMachineToolkit({ service: runtime.operations, responseContext: runtime.context });
}

test('no invented dataset, field, join or analysis output can appear; insufficient evidence returns an incomplete plan', () => {
  const invented = compileMetadataPlan({
    question: 'Invent a secret hospital file and CCN=NPI merge',
    product_keys: ['invented-dataset', 'cms-hcris-hospital-provider-cost-report'],
    fields: ['invented_field', 'PROVNUM'],
    join_route_ids: ['ccn-equals-npi'],
    analysis_requested: false,
  });
  assert.equal(invented.status, 'incomplete');
  assert.ok(invented.named_gaps.some((gap) => gap.kind === 'unknown_or_invented_source'));
  assert.ok(invented.named_gaps.some((gap) => gap.kind === 'invented_field'));
  assert.ok(invented.named_gaps.some((gap) => gap.kind === 'invented_or_forbidden_join'));
  assert.equal(invented.analysis_output, null);
  assert.equal(invented.qualified_joins.length, 0);
  assertNoInvention(invented);
  assert.throws(() => compileMetadataPlan({ product_keys: ['cms-hcris-hospital-provider-cost-report'], analysis_requested: true }), /ANALYSIS_OUTSIDE_INVOCATION/);
});

test('the same pinned selections produce the same plan; missing required sources remain a named gap', () => {
  const input = {
    question: 'Hospital cost-report net patient revenue for Pennsylvania',
    product_keys: ['cms-hcris-hospital-provider-cost-report', 'pa-phc4-public-financial-reports'],
    fields: ['PROVNUM', 'NET_PATIENT_REVENUE'],
    join_route_ids: ['hcris-phc4'],
    generation: LAST_GOOD_GENERATION,
  };
  const first = compileMetadataPlan(input);
  const second = compileMetadataPlan({ ...input, product_keys: ['pa-phc4-public-financial-reports', 'cms-hcris-hospital-provider-cost-report'] });
  assert.equal(first.plan_sha256, second.plan_sha256);
  assert.equal(first.status, 'ready_with_constraints');
  assert.equal(first.plan_research_enabled, false);
  assert.equal(first.study_design_certified, false);
  assert.equal(first.two_hop_composition.composed, false);
  const missing = compileMetadataPlan({
    question: 'County uninsured estimates without inventing Census coverage',
    product_keys: ['cdc-places'],
    fields: ['countyfips', 'uninsured_adults'],
    require_products: ['census-sahie'],
    exclude_sources: ['census-sahie'],
  });
  assert.equal(missing.status, 'incomplete');
  assert.ok(missing.named_gaps.some((gap) => gap.kind === 'missing_required_source' && gap.product_key === 'census-sahie'));
  const pricing = compileMetadataPlan({
    question: 'Hospital cash prices from a complete MRF',
    product_keys: ['cms-hospital-mrf'],
  });
  assert.equal(pricing.status, 'incomplete');
  assert.ok(pricing.named_gaps.some((gap) => gap.kind === 'unknown_mrf_locator'));
});

test('eight existing tools continue working if planner activation is not accepted; no status text claims an enabled planner prematurely', async () => {
  assert.equal(PLANNER_PUBLIC_ACTIVATION.plan_research_enabled, false);
  assert.equal(PUBLIC_CAPABILITY_FLAGS.plan_research, false);
  assert.equal(Object.values(PUBLIC_CAPABILITY_FLAGS).filter(Boolean).length, 8);
  assert.equal(webmcp.planner_enabled, false);
  assert.equal(activationContract.plan_research_enabled, false);
  assert.match(planPage, /Plan compilation is not available yet/);
  assert.match(planPage, /gated compiler remains disabled/);
  assert.doesNotMatch(planPage, /planner is enabled|plan_research is enabled/i);
  assert.equal(workerIndex.includes('packages/enrichment'), false);
  const tk = toolkit();
  const coverage = await tk.invokeJsonApi('get_coverage_status', {
    contract_version: 'observatory.machine.get-coverage-status.input.v1.0.0',
    geography_ids: ['geo.us'],
    subject_ids: [],
    source_classes: [],
    time_period: null,
    authority_levels: [],
    limit: 1,
    cursor: null,
    expected_generation: LAST_GOOD_GENERATION,
  });
  assert.equal(coverage.ok, true, JSON.stringify(coverage.error));
  const planner = await tk.invokeJsonApi('plan_research', {
    contract_version: 'observatory.machine.plan-research.input.v1.0.0',
    mode: 'initial',
    research_need: 'Hospital cost-report net patient revenue',
    constraints: {
      geography_ids: [],
      time_period: null,
      grain: null,
      access_classes: [],
      machine_access_required: false,
      intended_analyses: [],
    },
    expected_generation: LAST_GOOD_GENERATION,
  });
  assert.equal(planner.ok, false);
  assert.equal(planner.error.code, 'planner_unavailable');
  assert.equal(planner.result_state, 'disabled');
});
