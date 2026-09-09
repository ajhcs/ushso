import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createWorker, loadCatalogFromAssets } from '../worker/index.mjs';

if (typeof globalThis.gc !== 'function') throw new Error('RUNTIME_GATE_REQUIRES_NODE_EXPOSE_GC');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'apps/web/dist');
const encoder = new TextEncoder();
const thresholds = Object.freeze({
  catalog_records_minimum: 3000,
  retained_heap_delta_mib_maximum: 64,
  catalog_load_ms_maximum: 2000,
  legacy_search_ms_maximum: 1500,
  machine_search_ms_maximum: 1000,
  catalog_response_bytes_maximum: 2 * 1024 * 1024,
});

const assets = Object.freeze({
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const target = path.resolve(dist, `.${pathname}`);
    if (!target.startsWith(`${dist}${path.sep}`)) return new Response('', { status: 403 });
    try { return new Response(await fs.readFile(target), { status: 200 }); }
    catch (error) { return new Response('', { status: error?.code === 'ENOENT' ? 404 : 500 }); }
  },
});
const env = { ASSETS: assets };

globalThis.gc();
const heapBefore = process.memoryUsage().heapUsed;
const loadStarted = performance.now();
const catalog = await loadCatalogFromAssets(new Request('https://ushso.test/api/health'), env);
const catalogLoadMs = performance.now() - loadStarted;
globalThis.gc();
const heapAfter = process.memoryUsage().heapUsed;
const worker = createWorker();

async function invoke(request) {
  const started = performance.now();
  const response = await worker.fetch(request, env);
  const body = await response.text();
  return { status: response.status, milliseconds: performance.now() - started, bytes: encoder.encode(body).byteLength, body };
}

const legacySearch = await invoke(new Request('https://ushso.test/api/discover', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'hospital quality', limit: 20 }),
}));
const machineSearch = await invoke(new Request('https://ushso.test/api/machine/v1/search-assets', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    contract_version: 'observatory.machine.search-assets.input.v1.0.0', mode: 'search', research_need: 'hospital quality',
    filters: { geography_ids: [], subject_ids: [], grain: [], access_classes: [], authority_levels: [], machine_readiness: [], time_period: null, negative_constraints: [], dimensions: [] },
    grouping: 'none', limit: 20, cursor: null, expected_generation: catalog.corpus.publication.generation,
  }),
}));
const browse = await invoke(new Request('https://ushso.test/api/catalog?limit=200'));

const measurements = {
  catalog_records: catalog.records.length,
  search_documents_loaded: catalog.searchDocuments.length,
  retained_heap_delta_mib: Number(((heapAfter - heapBefore) / 1048576).toFixed(1)),
  catalog_load_ms: Math.round(catalogLoadMs),
  legacy_search_ms: Math.round(legacySearch.milliseconds),
  machine_search_ms: Math.round(machineSearch.milliseconds),
  catalog_response_bytes: browse.bytes,
};
const failures = [];
if (measurements.catalog_records < thresholds.catalog_records_minimum) failures.push('catalog_records');
if (measurements.search_documents_loaded !== 0) failures.push('duplicate_search_documents_loaded');
if (measurements.retained_heap_delta_mib > thresholds.retained_heap_delta_mib_maximum) failures.push('retained_heap_delta_mib');
if (measurements.catalog_load_ms > thresholds.catalog_load_ms_maximum) failures.push('catalog_load_ms');
if (measurements.legacy_search_ms > thresholds.legacy_search_ms_maximum) failures.push('legacy_search_ms');
if (measurements.machine_search_ms > thresholds.machine_search_ms_maximum) failures.push('machine_search_ms');
if (measurements.catalog_response_bytes > thresholds.catalog_response_bytes_maximum) failures.push('catalog_response_bytes');
if ([legacySearch, machineSearch, browse].some(result => result.status !== 200)) failures.push('http_status');

const receipt = { status: failures.length ? 'FAIL' : 'PASS', thresholds, measurements, failures };
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
