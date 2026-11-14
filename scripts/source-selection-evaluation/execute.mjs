import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executionIdentity } from './identity.mjs';
import { loadCatalogFromAssets, createWorker } from '../../worker/index.mjs';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function frozenBinding(inventory, base = root) {
  const files = new Map();
  const baseReal = await realpath(base);
  for (const item of inventory) {
    if (!item.url.startsWith('/corpus-v1.2.0/') || item.url.includes('..') || files.has(item.url)) throw new Error('INVALID_ASSET_PATH');
    const resolved = await realpath(path.resolve(baseReal, item.file));
    if (!resolved.startsWith(baseReal + path.sep)) throw new Error('ASSET_OUTSIDE_ROOT');
    const bytes = await readFile(resolved);
    if (sha(bytes) !== item.sha256) throw new Error('ASSET_DIGEST_MISMATCH');
    files.set(item.url, bytes);
  }
  if (!files.has('/corpus-v1.2.0/fixtures/named-source-registry.json')) throw new Error('REQUIRED_REGISTRY_MISSING');
  return { async fetch(request) {
    const url = new URL(request.url);
    if (url.origin !== 'https://evaluation.invalid' || !files.has(url.pathname)) throw new Error('UNINVENTORIED_ASSET');
    return new Response(files.get(url.pathname));
  } };
}
export function rankingView(result) {
  const { corpus, ranking, pagination, sections, partial_results, named_source_resolution, warnings } = result;
  return { corpus, ranking, pagination, sections, partial_results, named_source_resolution, warnings, results: (result.results ?? []).map(({record_id,rank,score,match_state,uncertainty_reasons}) => ({record_id,rank,score,match_state,uncertainty_reasons})) };
}
export function validateQueries(cohort) {
  if (!cohort.cohort_id || cohort.split !== 'public_regression' || (!Array.isArray(cohort.queries) || cohort.queries.length === 0)) throw new Error('INVALID_COHORT');
  const ids = new Set();
  for (const q of cohort.queries) {
    if (Object.keys(q).some(k => !['query_id', 'text', 'stratum'].includes(k)) || !q.query_id || ids.has(q.query_id) || typeof q.text !== 'string') throw new Error('INVALID_PUBLIC_QUERY');
    ids.add(q.query_id);
  }
}
export async function execute(manifest, cohort) {
  validateQueries(cohort);
  const identity = await executionIdentity();
  if (manifest.lane !== 'source_module_http_nonindexed') throw new Error('UNSUPPORTED_BUILD_LANE');
  const env = { ASSETS: await frozenBinding(manifest.assets) };
  const loadCatalog = (request, environment) => loadCatalogFromAssets(request, environment, { lexicalExpected: null });
  const worker = createWorker({ loadCatalog, loadEngine: async (r, e) => (await loadCatalog(r, e)).engine });
  const rows = [];
  let corpusUnits = null;
  const oldFetch = globalThis.fetch;
  let networkAttempts = 0;
  globalThis.fetch = async () => { networkAttempts++; throw new Error('EXTERNAL_NETWORK_FORBIDDEN'); };
  try {
    for (const q of cohort.queries) {
      const query = { question: q.text, limit: 20, page_size: 20 };
      try {
        const request = new Request('https://evaluation.invalid/api/discover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(query) });
        const catalog = await loadCatalog(request, env);
        const observedUnits = catalog.records.map(r => r.record_id).sort();
        if (corpusUnits && JSON.stringify(corpusUnits) !== JSON.stringify(observedUnits)) throw new Error('CORPUS_MEMBERSHIP_CHANGED');
        corpusUnits = observedUnits;
        const direct = catalog.engine.retrieve(query, { now: null });
        const response = await worker.fetch(request, env);
        const api = await response.json();
        const parity = response.ok && JSON.stringify(rankingView(direct)) === JSON.stringify(rankingView(api));
        const fullParity = JSON.stringify(direct) === JSON.stringify(api);
        rows.push({ query_id: q.query_id, stratum: q.stratum, status: parity ? 'ok' : 'parity_failed', parity: { ranking_and_classification: parity, full_contract: fullParity, full_contract_limitation: fullParity ? null : 'API enrichment and request-time freshness differ; retained full outputs require separate review.' }, http_status: response.status, direct, api,
          ranked: (direct.results ?? []).map(r => ({ unit_id: r.record_id, match_state: r.match_state, rank: r.rank })) });
      } catch (error) { rows.push({ query_id: q.query_id, stratum: q.stratum, status: 'engine_failed', error: { code: error.code ?? 'ENGINE_ERROR', message: error.message }, ranked: [] }); }
    }
  } finally { globalThis.fetch = oldFetch; }
  const finalIdentity = await executionIdentity();
  if (identity.source_graph_sha256 !== finalIdentity.source_graph_sha256 || identity.lockfile_sha256 !== finalIdentity.lockfile_sha256) throw new Error('SOURCE_CHANGED_DURING_EXECUTION');
  return { identity, schema: 'ushso.frozen-retrieval.v2', lane: manifest.lane, manifest_sha256: sha(JSON.stringify(manifest)), cohort_sha256: sha(JSON.stringify(cohort)), cohort_id: cohort.cohort_id,
    source_unit: 'record_id', corpus_units: corpusUnits, corpus_units_sha256: corpusUnits ? sha(JSON.stringify(corpusUnits)) : null, network_attempts: networkAttempts, independent_acceptance: 'not_run', rows };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [manifestFile, cohortFile, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: execute.mjs MANIFEST COHORT OUTPUT');
  const result = await execute(JSON.parse(await readFile(manifestFile)), JSON.parse(await readFile(cohortFile)));
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  if (result.rows.some(x => x.status !== 'ok') || result.network_attempts) process.exitCode = 1;
  console.log(JSON.stringify({ output, sha256: sha(await readFile(output)), rows: result.rows.length, failures: result.rows.filter(x => x.status !== 'ok').length }));
}
