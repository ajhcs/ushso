import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createMachineCursorSigner } from '../../worker/machine-cursor.mjs';
import { createStaticMachineToolkitRuntime } from '../../worker/static-machine-toolkit-service.mjs';
import { createMachineToolkit } from '../../packages/machine-toolkit/src/index.mjs';
import { HCRIS_HOSPITAL_COST_REPORT_ID } from '../../packages/registry/asset-context-collections.mjs';
import { PHC4_PUBLIC_FINANCIAL_REPORTS_ID } from '../../packages/registry/comparison-dimensions.mjs';
import { composeJoinPair, inspectJoinRoutes } from '../../packages/registry/qualified-join-routes.mjs';
import { LAST_GOOD_GENERATION, buildResearchPacket, validateResearchPacket } from '../../packages/registry/research-packet.mjs';

const corpus = JSON.parse(readFileSync('packages/retrieval/versions/v1.2.0/corpus/corpus.json', 'utf8'));
const hcris = readFileSync('packages/retrieval/versions/v1.2.0/corpus/records-0003.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
  .find((record) => record.record_id === HCRIS_HOSPITAL_COST_REPORT_ID);

const phc4 = {
  record_id: PHC4_PUBLIC_FINANCIAL_REPORTS_ID,
  title: 'PHC4 Public Hospital Financial Reports',
  identity: { source: { source_id: 'pa-phc4', name: 'Pennsylvania Health Care Cost Containment Council' } },
  evidence: [{ evidence_id: 'evidence:pa-phc4:public-financial-reports' }],
  freshness_verification: { metadata_observed_at: '2026-09-03T22:22:33.908Z', verification_status: 'current_verified' },
  access: { status: 'unknown' },
};

function toolkit(records = [hcris, phc4]) {
  const catalog = {
    corpus: {
      ...corpus,
      publication: { ...corpus.publication, generation: LAST_GOOD_GENERATION },
    },
    records,
  };
  const runtime = createStaticMachineToolkitRuntime(catalog, {
    now: new Date('2026-09-03T12:00:00Z'),
    cursorSigner: createMachineCursorSigner({ clock: () => Date.parse('2026-09-03T12:00:00Z') }),
  });
  return createMachineToolkit({
    service: runtime.operations,
    responseContext: runtime.context,
    clock: () => new Date('2026-09-03T12:00:00Z'),
  });
}

test('comparing HCRIS and PHC4 shows differing reporting definitions rather than a generic complete result with empty facts', async () => {
  const tk = toolkit();
  const response = await tk.invokeJsonApi('compare_assets', {
    contract_version: 'observatory.machine.compare-assets.input.v1.0.0',
    asset_ids: [HCRIS_HOSPITAL_COST_REPORT_ID, PHC4_PUBLIC_FINANCIAL_REPORTS_ID],
    dimensions: ['access', 'time', 'grain', 'variables_schema', 'geography', 'freshness'],
    expected_generation: LAST_GOOD_GENERATION,
  });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  assert.equal(response.truth_boundary.analysis_executed, false);
  assert.equal(response.result.ranking_performed, false);
  assert.equal(response.result.source_values_compared, false);
  const grain = response.result.dimensions.find((row) => row.dimension === 'grain');
  const schema = response.result.dimensions.find((row) => row.dimension === 'variables_schema');
  const access = response.result.dimensions.find((row) => row.dimension === 'access');
  assert.equal(grain.state, 'incomparable');
  assert.equal(schema.state, 'incomparable');
  assert.equal(access.state, 'incomparable');
  for (const row of [grain, schema, access]) {
    assert.equal(row.values.length, 2);
    assert.ok(row.values.every((value) => value.state === 'known' && value.metadata_value));
    assert.match(row.explanation, /reporting definitions/i);
    assert.notEqual(row.values[0].metadata_value, row.values[1].metadata_value);
  }
  assert.doesNotMatch(JSON.stringify(response.result), /"metadata_value":null.*"metadata_value":null/);
  assert.equal(response.result_state, 'complete');
});

test('an individually valid pair of joins cannot be promoted to a valid combined path without compatibility checks', async () => {
  const composition = composeJoinPair('hcris-nppes', 'nppes-pos');
  assert.equal(composition.composed, false);
  assert.equal(composition.compatible, false);
  assert.equal(composition.adjacent_namespaces, true);
  assert.match(composition.caveat, /not a valid combined path/i);
  const tk = toolkit();
  const response = await tk.invokeJsonApi('get_join_routes', {
    contract_version: 'observatory.machine.get-join-routes.input.v1.0.0',
    from_id: HCRIS_HOSPITAL_COST_REPORT_ID,
    to_id: PHC4_PUBLIC_FINANCIAL_REPORTS_ID,
    from_release_id: null,
    to_release_id: null,
    research_purpose: null,
    include_indirect: true,
    max_hops: 2,
    limit: 20,
    expected_generation: LAST_GOOD_GENERATION,
  });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  assert.ok(response.result.routes.some((route) => route.route_id === 'hcris-phc4'));
  assert.equal(response.result.routes.every((route) => route.hop_count === 1), true);
  assert.equal(response.result.routes.some((route) => route.hop_count === 2 && route.compatibility === 'compatible'), false);
  const inspected = inspectJoinRoutes({
    from_id: HCRIS_HOSPITAL_COST_REPORT_ID,
    to_id: PHC4_PUBLIC_FINANCIAL_REPORTS_ID,
    include_indirect: true,
    max_hops: 2,
  });
  assert.equal(inspected.two_hop_composition.composed, false);
  assert.equal(inspected.ccn_equals_npi, false);
  assert.equal(inspected.r08_complete, false);
});

test('the export can be validated offline and reproduces source identities without LLMs, source fetches, credentials or hidden telemetry', () => {
  const packet = buildResearchPacket({
    question: 'Compare HCRIS and PHC4 hospital financial reporting definitions',
    generation: LAST_GOOD_GENERATION,
    asset_ids: [HCRIS_HOSPITAL_COST_REPORT_ID, PHC4_PUBLIC_FINANCIAL_REPORTS_ID],
    contexts: [{
      record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
      release_id: 'release.cms.hcris.documentation',
      distribution_id: 'distribution.cms.hcris.landing-page',
      schema_id: 'schema.cms.hcris.worksheet-g3.accepted',
      access_route_id: 'access.cms.hcris.public-docs',
    }],
    comparisons: [{ left: HCRIS_HOSPITAL_COST_REPORT_ID, right: PHC4_PUBLIC_FINANCIAL_REPORTS_ID, state: 'incomparable' }],
  });
  const validated = validateResearchPacket(packet);
  assert.equal(validated.valid, true);
  assert.deepEqual(packet.sources.map((source) => source.asset_id), [HCRIS_HOSPITAL_COST_REPORT_ID, PHC4_PUBLIC_FINANCIAL_REPORTS_ID]);
  assert.equal(packet.llm_invoked, false);
  assert.equal(packet.source_data_fetched, false);
  assert.equal(packet.credentials, null);
  assert.equal(packet.hidden_research_query_telemetry, false);
  assert.equal(packet.recipes[0].secrets, null);
  assert.ok(packet.variable_citations[0].fields.includes('field.hcris.PROVNUM'));
  assert.doesNotMatch(JSON.stringify(packet), /authorization|api_key|cookie|signed_url|research_need/i);
  assert.equal(packet.last_good_generation, LAST_GOOD_GENERATION);
});
