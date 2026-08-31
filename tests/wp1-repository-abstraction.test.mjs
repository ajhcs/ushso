import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { StaticCoverageRepository } from '../packages/coverage/static-coverage-repository.mjs';
import { PlannerRepositoryError } from '../packages/planner/planner-repository.mjs';
import { StaticPlannerRepository } from '../packages/planner/static-planner-repository.mjs';
import { assertPublicationReadContext, createStaticPublicationReadContext } from '../packages/registry/publication-read-context.mjs';
import { StaticAssetCatalogRepository } from '../packages/registry/static-asset-catalog-repository.mjs';
import { StaticSearchBackend } from '../packages/search/static-search-backend.mjs';
import { applyLiveVerificationReceipt } from '../worker/live-verification.mjs';
import { PublicQueryService } from '../worker/public-query-service.mjs';
import { createRetrievalEngine } from '../worker/retrieval-v1.1.0.mjs';
import { createStaticPublicQueryService } from '../worker/static-composition.mjs';
import staticWorker from '../worker/static-entry.mjs';
import { createWorker } from '../worker/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => fs.readFile(path.join(root, relative), 'utf8').then(JSON.parse);
const readJsonl = relative => fs.readFile(path.join(root, relative), 'utf8').then(value => value.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse));

const [rawRecords, searchDocuments, joinRoutes, vocabulary, corpus, verification] = await Promise.all([
  readJsonl('packages/retrieval/versions/v1.1.0/corpus/records.jsonl'),
  readJsonl('packages/retrieval/versions/v1.1.0/corpus/search-documents.jsonl'),
  readJsonl('packages/retrieval/versions/v1.1.0/corpus/join-routes.jsonl'),
  readJson('packages/retrieval/versions/v1.1.0/fixtures/controlled-vocabulary.json'),
  readJson('packages/retrieval/versions/v1.1.0/corpus/corpus.json'),
  readJson('verification/v0.1.0/receipts/live-verification-2026-08-30.json')
]);
const records = applyLiveVerificationReceipt(rawRecords, verification);
const engine = createRetrievalEngine({ records, searchDocuments, joinRoutes, vocabulary, corpus });
const bundle = { records, searchDocuments, joinRoutes, vocabulary, corpus, engine };
const loadCatalog = async () => bundle;
const loadEngine = async () => engine;

function retrievalId(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  const hex = number => (number >>> 0).toString(16).padStart(8, '0');
  return `retrieval-${hex(first)}${hex(second)}`;
}

function queryFromIntent(intent, filters = {}) {
  return { question: intent.original_question, normalized_question: intent.normalized_question, interpretation: intent.interpretation, filters };
}

function corpusSummary() {
  return { ...corpus, record_count: records.length, search_document_count: searchDocuments.length, join_route_count: joinRoutes.length };
}

function directResult(record, whyRelevant) {
  return {
    rank: 1,
    score: 1,
    record_id: record.record_id,
    relevance: {
      matched_subjects: [], matched_geographies: [], matched_units: [], matched_terms: [],
      score_components: [{ kind: 'direct_record_lookup', value: 1, reason: whyRelevant, evidence_state: 'verified_first_party' }],
      why_relevant: [whyRelevant]
    },
    record: structuredClone(record)
  };
}

function legacyBrowse(limit) {
  const question = 'Browse published health systems data';
  const intent = engine.interpret({ question, limit: Math.min(limit, 50) });
  const selected = [...records]
    .sort((left, right) => Number(right.record_id.startsWith('us-federal:')) - Number(left.record_id.startsWith('us-federal:')) || left.record_id.localeCompare(right.record_id))
    .slice(0, limit);
  return {
    contract_version: 'observatory-discovery-result.v1.0.0',
    retrieval_id: retrievalId(`browse:${corpus.corpus_id}:${corpus.corpus_version}:${limit}`),
    evidence_mode: 'published_offline_evidence',
    corpus: corpusSummary(),
    query: queryFromIntent(intent, { mode: 'catalog_browse', limit }),
    result_count: selected.length,
    results: selected.map((record, index) => ({ ...directResult(record, 'Included in the published catalog browse view.'), rank: index + 1 })),
    join_routes: joinRoutes,
    warnings: [
      'Browse mode shows the validated federal baseline first, then other published metadata; order does not imply question relevance or quality.',
      'Records describe indexed metadata and retrieval routes; they do not prove current endpoint availability or authorize access.'
    ]
  };
}

function legacyDataset(record) {
  const question = `Open dataset ${record.record_id}`;
  const intent = engine.interpret({ question });
  const siblingCount = records.filter(candidate => candidate.identity?.family?.family_id && candidate.identity.family.family_id === record.identity?.family?.family_id).length;
  return {
    contract_version: 'observatory-discovery-result.v1.0.0',
    retrieval_id: retrievalId(`dataset:${corpus.corpus_id}:${record.record_id}`),
    evidence_mode: 'published_offline_evidence',
    corpus: corpusSummary(),
    query: queryFromIntent(intent, { mode: 'stable_dataset_dereference', record_id: record.record_id, family_sibling_count: Math.max(0, siblingCount - 1) }),
    result_count: 1,
    results: [directResult(record, 'Opened by its stable published record identifier.')],
    join_routes: joinRoutes.filter(route => route.from_record_id === record.record_id || route.to_record_id === record.record_id),
    warnings: ['This page describes indexed metadata and retrieval routes; it does not prove current endpoint availability or authorize access.']
  };
}

function request(url = 'https://ushso.org/api/catalog') {
  return new Request(url);
}

test('PublicationReadContext is new per request, deeply frozen, and shared by every repository call', async () => {
  const catalogRepository = new StaticAssetCatalogRepository({ loadCatalog });
  const searchBackend = new StaticSearchBackend({ loadEngine });
  const seen = [];
  for (const [target, methods] of [
    [catalogRepository, ['getCatalogSummary', 'browseAssets', 'getJoinRoutes']],
    [searchBackend, ['interpret']]
  ]) {
    for (const method of methods) {
      const original = target[method].bind(target);
      target[method] = options => {
        seen.push(options.publication);
        return original(options);
      };
    }
  }
  const service = new PublicQueryService({
    publicationResolver: { resolve: async () => createStaticPublicationReadContext(corpus) },
    catalogRepository,
    searchBackend,
    coverageRepository: new StaticCoverageRepository(),
    plannerRepository: new StaticPlannerRepository()
  });
  const first = await service.openRequest({ request: request(), env: {} });
  const second = await service.openRequest({ request: request(), env: {} });
  assert.notStrictEqual(first.publication, second.publication);
  assertPublicationReadContext(first.publication);
  await service.browse(first, 5);
  assert.ok(seen.length >= 4);
  assert.ok(seen.every(value => value === first.publication));
});

test('static adapters reproduce exact legacy browse, dataset, and discovery structures', async () => {
  const service = createStaticPublicQueryService({ loadCatalog, loadEngine });
  const session = await service.openRequest({ request: request(), env: {} });
  const browse = await service.browse(session, 17);
  assert.deepEqual(browse, legacyBrowse(17));
  assert.equal(JSON.stringify(browse), JSON.stringify(legacyBrowse(17)));

  const target = records.find(record => record.record_id.startsWith('obs:asset:')) ?? records[0];
  const dataset = await service.dataset(session, target.record_id.replace(/^obs:asset:/, ''));
  assert.deepEqual(dataset, legacyDataset(target));
  assert.equal(JSON.stringify(dataset), JSON.stringify(legacyDataset(target)));

  const query = { question: 'hospital financial and utilization data for Pennsylvania', limit: 15 };
  assert.deepEqual(await service.discover(session, query), engine.retrieve(query));
});

test('Worker dependency injection preserves exact response bytes, fields, ordering, and cache headers', async () => {
  const service = createStaticPublicQueryService({ loadCatalog, loadEngine });
  const worker = createWorker({ publicQueryService: service });
  const response = await worker.fetch(request('https://ushso.org/api/catalog?limit=7'), { ASSETS: { fetch: async () => new Response('{}') } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(await response.text(), `${JSON.stringify(legacyBrowse(7))}\n`);
});

test('legacy static coverage is typed unknown and planner fails closed', async () => {
  const service = createStaticPublicQueryService({ loadCatalog, loadEngine });
  const session = await service.openRequest({ request: request(), env: {} });
  const coverage = await service.getCoverageStatus(session);
  assert.equal(coverage.status, 'unknown');
  assert.equal(coverage.reason_code, 'legacy_static_component_unavailable');
  assert.equal(coverage.absence_claim_permitted, false);
  await assert.rejects(() => service.planResearch(session, { research_need: 'hospital finance' }), error => {
    assert.ok(error instanceof PlannerRepositoryError);
    assert.equal(error.code, 'planner_unavailable');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('explicit static rollback entry requires only the ASSETS binding', async () => {
  const publicRoot = path.join(root, 'apps/web/public');
  const assets = {
    async fetch(assetRequest) {
      const pathname = new URL(assetRequest.url).pathname;
      try {
        const bytes = await fs.readFile(path.join(publicRoot, pathname.replace(/^\//, '')));
        return new Response(bytes, { status: 200 });
      } catch (error) {
        if (error?.code === 'ENOENT') return new Response('not found', { status: 404 });
        throw error;
      }
    }
  };
  const env = new Proxy({ ASSETS: assets }, {
    get(target, property) {
      if (property !== 'ASSETS') throw new Error(`unexpected static binding access: ${String(property)}`);
      return target.ASSETS;
    }
  });
  const response = await staticWorker.fetch(request('https://ushso.org/api/catalog?limit=1'), env);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.corpus.record_count, 157);
  assert.equal(result.result_count, 1);
});

test('static SearchBackend remains pinned to the promoted production retrieval module', async () => {
  const runtime = await fs.readFile(path.join(root, 'worker/retrieval-v1.1.0.mjs'));
  const digest = createHash('sha256').update(runtime).digest('hex');
  assert.equal(digest, 'b1e104055dc5e00b66769773ee33fe8c364aa7d3c7c872367145666bcb06dd5b');
  const workerSource = await fs.readFile(path.join(root, 'worker/index.mjs'), 'utf8');
  assert.match(workerSource, /from ['"]\.\/retrieval-v1\.1\.0\.mjs['"]/);
  assert.doesNotMatch(workerSource, /packages\/retrieval\/tools\/retrieval-core/);
});
