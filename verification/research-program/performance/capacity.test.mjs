import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  EXISTING_DEPLOYMENT_REQUIREMENTS,
  HISTORICAL_ALL_SAMPLES_300MS,
  LAST_GOOD_CORPUS_RECORD_COUNT,
  LAST_GOOD_GENERATION,
  SEARCH_PACKAGE_CONTENT_DIGEST,
  blockedFetch,
  defineWorkload,
  dispositionC0091,
  measureBoundedDelivery,
  reportCosts,
  runCapacity,
} from '../../../scripts/research-program/capacity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('workload and cost ceilings are named before measurement and do not weaken accepted gates', () => {
  const workload = defineWorkload();
  assert.equal(workload.named_before_measurement, true);
  assert.equal(workload.last_good_generation, LAST_GOOD_GENERATION);
  assert.equal(workload.last_good_corpus_record_count, LAST_GOOD_CORPUS_RECORD_COUNT);
  assert.equal(EXISTING_DEPLOYMENT_REQUIREMENTS.silently_weakened, false);
  assert.equal(EXISTING_DEPLOYMENT_REQUIREMENTS.wp14_record_search_p95_ms, 600);
  assert.equal(EXISTING_DEPLOYMENT_REQUIREMENTS.wp14_record_search_p99_ms, 1500);
  assert.equal(HISTORICAL_ALL_SAMPLES_300MS.status, 'not_met');
  assert.equal(workload.proposed_slo.record_search_p95_ms, 600);
  assert.equal(workload.cost_ceilings.numeric_budget_usd, null);
  assert.equal(workload.cost_ceilings.owner_deferral_is_zero_dollar_cap, false);
  assert.equal(workload.cost_ceilings.owner_deferral_proves_cheapest_topology, false);
  assert.ok(workload.query_mix.length >= 6);
});

test('fixture 1x/2x indexed-metadata measurement keeps output parity and cannot qualify production', () => {
  const measurement = measureBoundedDelivery({ fetchImpl: blockedFetch });
  assert.equal(measurement.source_acquisition_during_user_search, false);
  assert.equal(measurement.fetch_invoked, false);
  assert.equal(measurement.output_parity_exact, true);
  assert.equal(measurement.qualification.small_fixture_qualifies_production_capacity, false);
  assert.equal(measurement.qualification.warm_only_average_qualifies_cold_start, false);
  assert.equal(measurement.qualification.production_capacity_qualified, false);
  assert.equal(measurement.timing_classes.browser_time, 'unmeasured');
  assert.equal(measurement.timing_classes.edge_network_latency, 'unmeasured');
  assert.equal(measurement.timing_classes.upstream_collection, 'not_invoked_during_user_search');
  assert.equal(measurement.current_1x.copies, 1);
  assert.equal(measurement.twice_planned_load.copies, 2);
  assert.ok(measurement.current_1x.summary.query.n >= 6);
  assert.equal(measurement.twice_planned_load.summary.query.n, measurement.current_1x.summary.query.n * 2);
  assert.ok(measurement.current_1x.outputs.every((row) => row.variables_payload_present === false));
  assert.ok(measurement.current_1x.outputs.every((row) => row.mrf_payload_present === false));
  assert.equal(measurement.storage.last_good_corpus_record_count, 3434);
  assert.notEqual(measurement.storage.offline_fixture_record_count, 3434);
});

test('C-009-1 remains unresolved without actual account terms and measured production cost', () => {
  const c0091 = dispositionC0091();
  const costs = reportCosts();
  assert.equal(c0091.status, 'unresolved');
  assert.equal(c0091.measured_cheapest_new_topology, null);
  assert.equal(c0091.actual_account_terms, 'absent');
  assert.equal(c0091.public_prices_and_publication_asset_lengths_sufficient, false);
  assert.equal(costs.numeric_budget_usd, null);
  assert.equal(costs.premium_infrastructure_assumed, false);
  assert.equal(costs.paid_resource_created, false);
});

test('search package tree is unmodified and capacity CLI does not invent live fetch', async () => {
  const report = runCapacity();
  assert.equal(report.search_package_content_digest, SEARCH_PACKAGE_CONTENT_DIGEST);
  assert.equal(report.http_200_is_completed_research_task, false);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/search/manifests/package-manifest.json'), 'utf8'));
  assert.equal(manifest.package_content_digest.value, SEARCH_PACKAGE_CONTENT_DIGEST);
  assert.equal(manifest.file_count, 18);
  const { execFileSync } = await import('node:child_process');
  const changed = execFileSync('git', ['-C', ROOT, 'diff', '--name-only', 'HEAD', '--', 'packages/search'], { encoding: 'utf8' }).trim();
  assert.equal(changed, '');
  assert.throws(() => blockedFetch(), /CAPACITY_FETCH_FORBIDDEN/);
});
