import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createMachineCursorSigner } from '../../worker/machine-cursor.mjs';
import { createStaticMachineToolkitRuntime } from '../../worker/static-machine-toolkit-service.mjs';
import { createMachineToolkit } from '../../packages/machine-toolkit/src/index.mjs';
import {
  HCRIS_HOSPITAL_COST_REPORT_ID,
  collectAssetContext,
} from '../../packages/registry/asset-context-collections.mjs';

const corpus = JSON.parse(readFileSync('packages/retrieval/versions/v1.2.0/corpus/corpus.json', 'utf8'));
const hcris = readFileSync('packages/retrieval/versions/v1.2.0/corpus/records-0003.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
  .find((record) => record.record_id === HCRIS_HOSPITAL_COST_REPORT_ID);

const unbound = {
  record_id: 'asset.unbound.test',
  title: 'Unbound product',
  identity: { source: { source_id: 'cms-data-catalog', name: 'CMS Data Catalog' } },
  evidence: [{ evidence_id: 'evidence.unbound' }],
  freshness_verification: { metadata_observed_at: '2026-09-03T22:22:33.908Z', verification_status: 'current_verified' },
};

const paged = {
  record_id: 'asset.paged.docs',
  title: 'Paged documentation fixture',
  identity: { source: { source_id: 'cms-data-catalog', name: 'CMS Data Catalog' } },
  evidence: [{ evidence_id: 'evidence.paged' }],
  authoritative_url: 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report',
  provenance: [
    { kind: 'catalog_metadata', locator: 'https://data.cms.gov/data.json' },
    { kind: 'documentation', locator: 'https://data.cms.gov/provider-compliance/cost-reports' },
  ],
  freshness_verification: { metadata_observed_at: '2026-09-03T22:22:33.908Z', verification_status: 'current_verified' },
};

function toolkit(records, { generation = corpus.publication.generation, signer } = {}) {
  const catalog = {
    corpus: {
      ...corpus,
      publication: { ...corpus.publication, generation },
    },
    records,
  };
  const runtime = createStaticMachineToolkitRuntime(catalog, {
    cursorSigner: signer ?? createMachineCursorSigner(),
  });
  return {
    runtime,
    toolkit: createMachineToolkit({ service: runtime.operations, responseContext: runtime.context }),
    generation,
  };
}

const getAssetInput = (record_id, generation, extra = {}) => ({
  contract_version: 'observatory.machine.get-asset.input.v1.0.0',
  record_id,
  expected_generation: generation,
  collection_limits: { releases: 20, distributions: 20, documentation: 20, schemas: 20, ...extra.limits },
  collection_cursors: { releases: null, distributions: null, documentation: null, schemas: null, ...extra.cursors },
});

test('HCRIS has positive contextual collections while an unbound product stays explicitly unknown', () => {
  assert.ok(hcris, 'live HCRIS catalog record is required');
  const hcrisContext = collectAssetContext(hcris);
  assert.equal(hcrisContext.asset_id, HCRIS_HOSPITAL_COST_REPORT_ID);
  assert.equal(hcrisContext.rolling, true);
  assert.equal(hcrisContext.minted_exact_release_from_url, false);
  assert.ok(hcrisContext.documentation.items.length >= 1);
  assert.equal(hcrisContext.documentation.completeness, 'complete');
  assert.equal(hcrisContext.releases.completeness, 'unknown');
  assert.equal(hcrisContext.releases.items.length, 0);
  assert.equal(hcrisContext.distributions.completeness, 'unknown');
  assert.equal(hcrisContext.schemas.completeness, 'unknown');
  const urls = hcrisContext.documentation.items.map((item) => item.record_id);
  assert.ok(urls.includes(hcris.authoritative_url));
  assert.ok(urls.includes('https://data.cms.gov/data.json'));

  const unknown = collectAssetContext(unbound);
  assert.equal(unknown.documentation.completeness, 'unknown');
  assert.equal(unknown.releases.completeness, 'unknown');
  assert.equal(unknown.distributions.completeness, 'unknown');
  assert.equal(unknown.schemas.completeness, 'unknown');
  assert.equal(unknown.documentation.items.length, 0);
});

test('known-empty distributions stay distinct from unknown collections; rolling URLs do not mint releases', () => {
  const edition = {
    ...unbound,
    record_id: 'asset.edition.test',
    identity: { asset: { version_state: 'edition', version_label: '2023' }, source: unbound.identity.source },
  };
  const emptyDistributions = collectAssetContext(edition, {
    binding: { releases: ['release.cms.hcris.2023'], distributions: [] },
  });
  assert.equal(emptyDistributions.releases.completeness, 'complete');
  assert.equal(emptyDistributions.releases.items[0].record_id, 'release.cms.hcris.2023');
  assert.equal(emptyDistributions.distributions.completeness, 'complete');
  assert.equal(emptyDistributions.distributions.items.length, 0);
  assert.equal(emptyDistributions.documentation.completeness, 'unknown');
  const rollingMint = collectAssetContext(hcris, {
    binding: { releases: ['release.should.not.mint'], distributions: [{ identity_state: 'exact', distribution_id: 'distribution.fake' }] },
  });
  assert.equal(rollingMint.releases.completeness, 'unknown');
  assert.equal(rollingMint.distributions.completeness, 'unknown');
});

test('search to get_asset yields actual HCRIS follow-up IDs; tests do not inject fake release IDs', async () => {
  const { toolkit: tk, generation } = toolkit([hcris, unbound]);
  const search = await tk.invokeJsonApi('search_assets', {
    contract_version: 'observatory.machine.search-assets.input.v1.0.0',
    mode: 'search',
    research_need: 'Hospital Provider Cost Report',
    filters: { geography_ids: [], subject_ids: [], grain: [], access_classes: [], authority_levels: [], machine_readiness: [], time_period: null, negative_constraints: [], dimensions: [] },
    grouping: 'none',
    limit: 5,
    cursor: null,
    expected_generation: generation,
  });
  assert.equal(search.ok, true, JSON.stringify(search.error));
  const assetId = search.result.summaries.find((row) => row.title.includes('Hospital Provider Cost Report'))?.asset_id;
  assert.equal(assetId, HCRIS_HOSPITAL_COST_REPORT_ID);
  const asset = await tk.invokeJsonApi('get_asset', getAssetInput(assetId, generation));
  assert.equal(asset.ok, true, JSON.stringify(asset.error));
  assert.equal(asset.result.collection_completeness.documentation, 'complete');
  assert.ok(asset.result.documentation.length >= 1);
  const documentationId = asset.result.documentation[0].record_id;
  assert.equal(typeof documentationId, 'string');
  assert.doesNotMatch(documentationId, /release\.test|release\.fake|distribution\.test/);
  assert.equal(asset.result.releases.length, 0);
  assert.equal(asset.result.collection_completeness.releases, 'unknown');
  const unboundAsset = await tk.invokeJsonApi('get_asset', getAssetInput(unbound.record_id, generation));
  assert.equal(unboundAsset.ok, true);
  assert.equal(unboundAsset.result.collection_completeness.documentation, 'unknown');
  assert.equal(unboundAsset.result.documentation.length, 0);
  assert.equal(unboundAsset.result.collection_completeness.releases, 'unknown');
});

test('pagination across a generation change returns a typed restart; limits never silently clip required context', async () => {
  const signer = createMachineCursorSigner({ signingKey: 'pr055-collection-cursor-key-32bytes' });
  const first = toolkit([paged], { signer });
  const clipped = await first.toolkit.invokeJsonApi('get_asset', getAssetInput(paged.record_id, first.generation, {
    limits: { documentation: 1 },
  }));
  assert.equal(clipped.ok, true, JSON.stringify(clipped.error));
  assert.equal(clipped.result_state, 'partial');
  assert.equal(clipped.truncated, true);
  assert.deepEqual(clipped.omitted_sections, ['documentation']);
  assert.equal(clipped.result.documentation.length, 1);
  assert.equal(clipped.result.collection_completeness.documentation, 'partial');
  assert.ok(clipped.next_cursor);
  const continued = await first.toolkit.invokeJsonApi('get_asset', getAssetInput(paged.record_id, first.generation, {
    limits: { documentation: 1 },
    cursors: { documentation: clipped.next_cursor },
  }));
  assert.equal(continued.ok, true, JSON.stringify(continued.error));
  assert.equal(continued.result.documentation.length, 1);
  assert.notEqual(continued.result.documentation[0].record_id, clipped.result.documentation[0].record_id);
  const whole = collectAssetContext(paged).documentation.items.map((item) => item.record_id);
  assert.equal(whole.length, 3);
  const restarted = toolkit([paged], { generation: 'generation.other', signer });
  const across = await restarted.toolkit.invokeJsonApi('get_asset', getAssetInput(paged.record_id, 'generation.other', {
    limits: { documentation: 1 },
    cursors: { documentation: clipped.next_cursor },
  }));
  assert.equal(across.ok, false);
  assert.equal(across.error.code, 'cursor_expired');
  assert.equal(across.restart_required, true);
});
