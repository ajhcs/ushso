import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMachineToolkit } from '../packages/machine-toolkit/src/index.mjs';
import { createStaticMachineToolkitRuntime } from '../worker/static-machine-toolkit-service.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionRoot = path.join(root, 'packages/retrieval/versions/v1.2.0');

async function loadCatalog() {
  const corpus = JSON.parse(await fs.readFile(path.join(versionRoot, 'corpus/corpus.json'), 'utf8'));
  const records = [];
  for (const file of corpus.record_files) {
    const text = await fs.readFile(path.join(versionRoot, 'corpus', file), 'utf8');
    records.push(...text.trim().split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)));
  }
  return { corpus, records };
}

const filters = {
  geography_ids: [], subject_ids: [], grain: [], access_classes: [], authority_levels: [],
  machine_readiness: [], time_period: null, negative_constraints: [], dimensions: [],
};

test('all eight public inspection operations return contract-safe envelopes', async () => {
  const catalog = await loadCatalog();
  const runtime = createStaticMachineToolkitRuntime(catalog, { now: new Date('2026-09-03T12:00:00Z') });
  const toolkit = createMachineToolkit({
    service: runtime.operations,
    responseContext: runtime.context,
    clock: () => new Date('2026-09-03T12:00:00Z'),
    requestId: ({ capability }) => `request.test.${capability}`,
  });
  const [first, second] = catalog.records;
  const generation = catalog.corpus.publication.generation;
  const contexts = {
    release_id: 'release.test', distribution_id: 'distribution.test', schema_id: 'schema.test', access_route_id: 'access.test',
  };
  const cases = [
    ['search_assets', { contract_version: 'observatory.machine.search-assets.input.v1.0.0', mode: 'search', research_need: first.title, filters, grouping: 'none', limit: 5, cursor: null, expected_generation: generation }],
    ['get_asset', { contract_version: 'observatory.machine.get-asset.input.v1.0.0', record_id: first.record_id, expected_generation: generation, collection_limits: { releases: 20, distributions: 20, documentation: 20, schemas: 20 }, collection_cursors: { releases: null, distributions: null, documentation: null, schemas: null } }],
    ['get_access_plan', { contract_version: 'observatory.machine.get-access-plan.input.v1.0.0', record_id: first.record_id, release_id: contexts.release_id, distribution_id: contexts.distribution_id, access_route_id: contexts.access_route_id, expected_generation: generation }],
    ['get_retrieval_recipe', { contract_version: 'observatory.machine.get-retrieval-recipe.input.v1.0.0', record_id: first.record_id, release_id: contexts.release_id, distribution_id: contexts.distribution_id, access_route_id: contexts.access_route_id, expected_generation: generation }],
    ['get_variables', { contract_version: 'observatory.machine.get-variables.input.v1.0.0', record_id: first.record_id, release_id: contexts.release_id, distribution_id: contexts.distribution_id, schema_id: contexts.schema_id, semantic_query: null, filters: [], limit: 25, cursor: null, expected_generation: generation }],
    ['get_join_routes', { contract_version: 'observatory.machine.get-join-routes.input.v1.0.0', from_id: first.record_id, to_id: second.record_id, from_release_id: null, to_release_id: null, research_purpose: null, include_indirect: false, max_hops: 1, limit: 20, expected_generation: generation }],
    ['compare_assets', { contract_version: 'observatory.machine.compare-assets.input.v1.0.0', asset_ids: [first.record_id, second.record_id], dimensions: ['access', 'freshness', 'geography'], expected_generation: generation }],
    ['get_coverage_status', { contract_version: 'observatory.machine.get-coverage-status.input.v1.0.0', geography_ids: ['geo.us'], subject_ids: [], source_classes: [], time_period: null, authority_levels: ['authoritative'], limit: 25, cursor: null, expected_generation: generation }],
  ];

  for (const [capability, input] of cases) {
    const safetyFailures = [];
    const response = await toolkit.invokeJsonApi(capability, input, { onSafetyFailure: failure => safetyFailures.push(failure) });
    assert.deepEqual(safetyFailures, [], `${capability}: ${JSON.stringify(safetyFailures)}`);
    assert.equal(response.ok, true, `${capability}: ${JSON.stringify(response.error)}`);
    assert.equal(response.capability, capability);
    assert.equal(response.transport_adapter, 'json_api');
    assert.equal(response.index_generation, generation);
    assert.ok(response.result_snapshot_id?.startsWith('sha256:'));
    assert.deepEqual(Object.values(response.truth_boundary), Array(6).fill(false));
  }
});

test('variables preserve missing schema context as a typed unknown error', async () => {
  const catalog = await loadCatalog();
  const runtime = createStaticMachineToolkitRuntime(catalog);
  const toolkit = createMachineToolkit({ service: runtime.operations, responseContext: runtime.context });
  const response = await toolkit.invokeJsonApi('get_variables', {
    contract_version: 'observatory.machine.get-variables.input.v1.0.0', record_id: catalog.records[0].record_id,
    release_id: null, distribution_id: null, schema_id: null, semantic_query: null, filters: [], limit: 25, cursor: null,
    expected_generation: catalog.corpus.publication.generation,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'schema_context_required');
  assert.equal(response.result_state, 'unknown');
});
