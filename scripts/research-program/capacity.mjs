#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createRetrievalEngine } from '../../packages/retrieval/tools/retrieval-core.mjs';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const LAST_GOOD_CORPUS_RECORD_COUNT = 3434;
export const SEARCH_PACKAGE_CONTENT_DIGEST = 'ed9faf0180a66001e9479771545b92f22dce3748580fd330f0d8424f4b53c1f0';
export const HISTORICAL_ALL_SAMPLES_300MS = Object.freeze({
  target_ms: 300,
  status: 'not_met',
  sample: '141 warm Worker requests, 2026-09-07T02:04:21.246Z',
  mean_ms: 162.66,
  p95_ms: 263.87,
  max_ms: 322.59,
  cold_start_qualified: false,
  concurrent_load_qualified: false,
});
export const EXISTING_DEPLOYMENT_REQUIREMENTS = Object.freeze({
  wp14_record_search_p95_ms: 600,
  wp14_record_search_p99_ms: 1500,
  wp14_bundle_plan_p95_ms: 1200,
  wp14_bundle_plan_p99_ms: 3000,
  historical_all_samples_300ms: HISTORICAL_ALL_SAMPLES_300MS,
  silently_weakened: false,
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

function readJsonl(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function defineWorkload() {
  const corpus = readJson('packages/retrieval/corpus/corpus.json');
  const queries = readJsonl('packages/retrieval/fixtures/published-queries.jsonl');
  return Object.freeze({
    named_before_measurement: true,
    last_good_generation: LAST_GOOD_GENERATION,
    last_good_corpus_record_count: LAST_GOOD_CORPUS_RECORD_COUNT,
    offline_fixture_corpus_id: corpus.corpus_id,
    offline_fixture_record_count: corpus.record_count,
    offline_fixture_search_document_count: corpus.search_document_count,
    dictionary_fixture_bytes: fs.statSync(path.join(ROOT, 'packages/retrieval/fixtures/controlled-vocabulary.json')).size,
    query_mix: queries.map((row) => Object.freeze({ query_id: row.query_id, path: 'query', question: row.query.question, limit: row.query.limit })),
    cold_definition: 'First request after a process start with no prior retrieve/detail in that process. This fixture does not isolate Worker isolate cold starts, CDN, or Hyperdrive.',
    warm_definition: 'Subsequent requests in the same Node process after the engine is constructed.',
    concurrency: Object.freeze({ planned_1x: 1, planned_2x: 2, production_peak_rps_candidate: 20, twice_planned_rps_candidate: 40 }),
    regions: Object.freeze({ measured: 'local_process', production: 'unmeasured' }),
    response_sizes: Object.freeze({ class: 'indexed_metadata_only', dataset_payload: false }),
    source_job_contention: Object.freeze({ user_search_starts_source_jobs: false, scheduler_default_disabled: true }),
    cost_ceilings: Object.freeze({
      numeric_budget_usd: null,
      owner_deferral: 'Cheap as possible; do not invent a numeric budget.',
      owner_deferral_is_zero_dollar_cap: false,
      owner_deferral_proves_cheapest_topology: false,
      use_existing_infrastructure_first: true,
    }),
    existing_deployment_requirements: EXISTING_DEPLOYMENT_REQUIREMENTS,
    proposed_slo: Object.freeze({
      record_search_p95_ms: EXISTING_DEPLOYMENT_REQUIREMENTS.wp14_record_search_p95_ms,
      record_search_p99_ms: EXISTING_DEPLOYMENT_REQUIREMENTS.wp14_record_search_p99_ms,
      historical_all_samples_300ms_status: HISTORICAL_ALL_SAMPLES_300MS.status,
      comparison: 'Proposed SLOs do not relax WP14 600/1500 ms or rewrite the unmet 300 ms all-samples diagnostic as passed.',
    }),
  });
}

function metadataVariables(record) {
  return Object.freeze({
    record_id: record.record_id,
    variables_payload_present: false,
    codebook_present: false,
    note: 'Current access, freshness, variables, codebooks, and analytic fitness require independent owner-approved review.',
    expected_artifacts: record.retrieval?.expected_artifacts ?? [],
  });
}

function metadataMrf(record) {
  const text = JSON.stringify(record);
  return Object.freeze({
    record_id: record.record_id,
    mrf_payload_present: /machine[- ]readable|transparency in coverage|\bmrf\b/i.test(text) && false,
    indexed_metadata_only: true,
    note: 'User search returns indexed metadata. Finding a source is not obtaining restricted data or an MRF payload.',
  });
}

function measurePath(name, fn) {
  const started = performance.now();
  const value = fn();
  const elapsed_ms = performance.now() - started;
  return { name, elapsed_ms, value };
}

export function measureBoundedDelivery({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl === 'function' && fetchImpl !== blockedFetch) {
    throw new Error('CAPACITY_MEASUREMENT_MUST_NOT_USE_LIVE_FETCH');
  }
  const workload = defineWorkload();
  const records = readJsonl('packages/retrieval/corpus/records.jsonl');
  const searchDocuments = readJsonl('packages/retrieval/corpus/search-documents.jsonl');
  const joinRoutes = readJsonl('packages/retrieval/corpus/join-routes.jsonl');
  const vocabulary = readJson('packages/retrieval/fixtures/controlled-vocabulary.json');
  const corpus = readJson('packages/retrieval/corpus/corpus.json');
  const engine = createRetrievalEngine({ records, searchDocuments, joinRoutes, vocabulary, corpus });
  const queries = workload.query_mix;
  const firstRecord = records[0];

  const runMix = (label, copies) => {
    const samples = [];
    const outputs = [];
    for (let copy = 0; copy < copies; copy += 1) {
      for (const query of queries) {
        const querySample = measurePath('query', () => engine.retrieve({ question: query.question, limit: query.limit }));
        const detailSample = measurePath('detail', () => structuredClone(firstRecord));
        const variablesSample = measurePath('variables_metadata', () => metadataVariables(firstRecord));
        const mrfSample = measurePath('mrf_metadata', () => metadataMrf(firstRecord));
        samples.push(querySample, detailSample, variablesSample, mrfSample);
        outputs.push({
          copy,
          query_id: query.query_id,
          retrieval_id: querySample.value.retrieval_id,
          result_count: querySample.value.result_count,
          record_ids: querySample.value.results.map((row) => row.record_id),
          variables_payload_present: variablesSample.value.variables_payload_present,
          mrf_payload_present: mrfSample.value.mrf_payload_present,
        });
      }
    }
    const byPath = {};
    for (const sample of samples) {
      byPath[sample.name] ??= [];
      byPath[sample.name].push(sample.elapsed_ms);
    }
    const summary = {};
    for (const [name, values] of Object.entries(byPath)) {
      const sorted = [...values].sort((a, b) => a - b);
      summary[name] = {
        n: sorted.length,
        min_ms: sorted[0],
        mean_ms: values.reduce((a, b) => a + b, 0) / values.length,
        p95_ms: percentile(sorted, 95),
        max_ms: sorted[sorted.length - 1],
      };
    }
    return { label, copies, samples: samples.map((s) => ({ name: s.name, elapsed_ms: s.elapsed_ms })), summary, outputs };
  };

  const memoryBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const current = runMix('current_1x_fixture', 1);
  const twice = runMix('twice_planned_load_fixture', 2);
  const cpu = process.cpuUsage(cpuBefore);
  const memoryAfter = process.memoryUsage();

  const firstOutputs = current.outputs.map((row) => ({ query_id: row.query_id, retrieval_id: row.retrieval_id, record_ids: row.record_ids }));
  const secondOutputs = twice.outputs.filter((row) => row.copy === 0).map((row) => ({ query_id: row.query_id, retrieval_id: row.retrieval_id, record_ids: row.record_ids }));
  const outputParityExact = JSON.stringify(firstOutputs) === JSON.stringify(secondOutputs);

  const recordsBytes = fs.statSync(path.join(ROOT, 'packages/retrieval/corpus/records.jsonl')).size;
  const searchDocBytes = fs.statSync(path.join(ROOT, 'packages/retrieval/corpus/search-documents.jsonl')).size;

  return Object.freeze({
    workload,
    timing_classes: Object.freeze({
      browser_time: 'unmeasured',
      edge_network_latency: 'unmeasured',
      local_indexed_metadata_cpu: 'measured_fixture_process',
      upstream_collection: 'not_invoked_during_user_search',
    }),
    source_acquisition_during_user_search: false,
    fetch_invoked: false,
    current_1x: current,
    twice_planned_load: twice,
    output_parity_exact: outputParityExact,
    memory: Object.freeze({
      rss_before: memoryBefore.rss,
      rss_after: memoryAfter.rss,
      heap_used_after: memoryAfter.heapUsed,
      note: 'Node process counters for this fixture. Not a Worker isolate peak and not a production capacity claim.',
    }),
    cpu: Object.freeze({ user_us: cpu.user, system_us: cpu.system }),
    storage: Object.freeze({
      offline_records_bytes: recordsBytes,
      offline_search_documents_bytes: searchDocBytes,
      last_good_corpus_record_count: LAST_GOOD_CORPUS_RECORD_COUNT,
      offline_fixture_record_count: workload.offline_fixture_record_count,
    }),
    asset_counts: Object.freeze({
      offline_records: workload.offline_fixture_record_count,
      last_good_records: LAST_GOOD_CORPUS_RECORD_COUNT,
    }),
    index_cache_topology: Object.freeze({
      current_public: 'immutable_static_jsonl',
      proposed_postgresql_search: 'untuned_successor_not_production',
      comparison: 'No production topology change is selected from this fixture.',
    }),
    qualification: Object.freeze({
      small_fixture_qualifies_production_capacity: false,
      warm_only_average_qualifies_cold_start: false,
      production_capacity_qualified: false,
      cold_start_qualified: false,
      twice_planned_production_load_qualified: false,
    }),
  });
}

export function blockedFetch() {
  throw new Error('CAPACITY_FETCH_FORBIDDEN');
}

export function dispositionC0091() {
  return Object.freeze({
    id: 'C-009-1-measured-topology-qualification',
    status: 'unresolved',
    measured_cheapest_new_topology: null,
    actual_account_terms: 'absent',
    shared_allowances: 'absent',
    measured_steady_workload: 'absent_for_production',
    measured_burst_workload: 'absent_for_production',
    measured_cost: 'absent',
    storage_transfer: 'absent_for_production',
    rights_capacity_recovery: 'unchanged_and_unqualified_by_this_fixture',
    public_prices_and_publication_asset_lengths_sufficient: false,
    owner_budget_deferral_is_zero_dollar_cap: false,
    owner_budget_deferral_proves_cheapest_topology: false,
    failed_targets: Object.freeze([
      'historical_all_samples_300ms_not_met',
      'production_cold_start_unmeasured',
      'authorized_30_minute_2x_load_unrun',
    ]),
    note: 'Public prices and publication asset lengths alone are insufficient. Keep C-009-1 unresolved.',
  });
}

export function reportCosts() {
  return Object.freeze({
    numeric_budget_usd: null,
    steady_cost_usd: null,
    burst_cost_usd: null,
    provider_fees_usd: null,
    storage_cost_usd: null,
    review_operations_cost_usd: null,
    retained_option: 'existing_static_public_runtime_and_disabled_scheduler',
    premium_infrastructure_assumed: false,
    paid_resource_created: false,
    production_activation_issued: false,
  });
}

export function runCapacity() {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = blockedFetch;
  try {
    const measurement = measureBoundedDelivery({ fetchImpl: blockedFetch });
    return Object.freeze({
      format: 'ushso.pr077-capacity.v1',
      generation: LAST_GOOD_GENERATION,
      search_package_content_digest: SEARCH_PACKAGE_CONTENT_DIGEST,
      measurement,
      c0091: dispositionC0091(),
      costs: reportCosts(),
      http_200_is_completed_research_task: false,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(runCapacity(), null, 2)}\n`);
}
