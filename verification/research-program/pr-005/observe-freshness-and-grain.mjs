#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRetrievalEngine } from '../../../packages/retrieval/tools/retrieval-core-v1.2.mjs';
import { StaticSearchBackend } from '../../../packages/search/static-search-backend.mjs';
import { PublicQueryService } from '../../../worker/public-query-service.mjs';
import { StaticCoverageRepository } from '../../../packages/coverage/static-coverage-repository.mjs';
import { StaticPlannerRepository } from '../../../packages/planner/static-planner-repository.mjs';
import { StaticAssetCatalogRepository } from '../../../packages/registry/static-asset-catalog-repository.mjs';
import { createStaticPublicationReadContext } from '../../../packages/registry/publication-read-context.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const readJsonl = relative => fs.readFileSync(path.join(root, relative), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const vocabulary = readJson('packages/retrieval/fixtures/controlled-vocabulary.json');
const namedSourceRegistry = readJson('packages/retrieval/fixtures/named-source-registry.v1.0.0.json');
const corpusRecords = readJsonl('packages/retrieval/corpus/records.jsonl');
const template = corpusRecords.find(record => record.record_id === 'obs:asset:unc-sheps-rural-hospital-closures');
if (!template) throw new Error('CLOCK_FIXTURE_TEMPLATE_MISSING');

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function clockRecord() {
  const record = structuredClone(template);
  record.record_id = 'fixture:pr005:clock';
  record.identity.asset.asset_id = record.record_id;
  record.title = 'Hospital financial clock fixture';
  record.unit_of_analysis = ['hospital', 'facility', 'provider', 'state'];
  record.freshness_verification = {
    ...record.freshness_verification,
    next_review_due: '2026-09-05T00:00:00.000Z',
    metadata_observed_at: '2026-09-03T22:22:33.908Z'
  };
  return record;
}

const record = clockRecord();
const corpus = { corpus_id: 'pr005-clock-observation', corpus_version: 'test', manifest_sha256: 'a'.repeat(64) };
const engine = createRetrievalEngine({
  records: [record],
  searchDocuments: null,
  joinRoutes: [],
  vocabulary,
  namedSourceRegistry,
  corpus
});
const frozen = engine.retrieve({ question: 'hospital financials', page_size: 10 });
const afterDeadline = engine.retrieve({ question: 'hospital financials', page_size: 10 }, { now: '2026-09-10T12:00:00.000Z' });
const beforeDeadline = engine.retrieve({ question: 'hospital financials', page_size: 10 }, { now: '2026-09-04T12:00:00.000Z' });
const service = new PublicQueryService({
  publicationResolver: { resolve: async () => createStaticPublicationReadContext(corpus) },
  catalogRepository: new StaticAssetCatalogRepository({
    loadCatalog: async () => ({ records: [record], searchDocuments: [], joinRoutes: [], vocabulary, corpus, engine })
  }),
  searchBackend: new StaticSearchBackend({ loadEngine: async () => engine }),
  coverageRepository: new StaticCoverageRepository(),
  plannerRepository: new StaticPlannerRepository()
});
const liveSession = await service.openRequest({ request: new Request('https://ushso.org/api/discover'), env: {} });
const publicLive = await service.discover(liveSession, { question: 'hospital financials', page_size: 10 });
const pinnedSession = await service.openRequest({
  request: new Request('https://ushso.org/api/discover', { headers: { Date: 'Thu, 10 Sep 2026 12:00:00 GMT' } }),
  env: {},
  now: '2026-09-10T12:00:00.000Z'
});
let publicPinned = null;
let publicPinnedError = null;
try {
  publicPinned = await service.discover(pinnedSession, { question: 'hospital financials', page_size: 10 });
} catch (error) {
  publicPinnedError = String(error?.message ?? error);
}

const output = {
  observed_at: new Date().toISOString(),
  generation_label: 'live-2026-09-03-85b50522b420',
  record_sha256: sha256(record),
  evidence_sha256: sha256(record.evidence),
  f07: {
    frozen_default: frozen.results[0].metadata.freshness,
    frozen_receipt_generated_at: frozen.receipt.generated_at,
    explicit_2026_09_10: afterDeadline.results[0].metadata.freshness,
    explicit_2026_09_04: beforeDeadline.results[0].metadata.freshness,
    public_live_session: {
      evaluated_at: liveSession.evaluatedAt ?? null,
      freshness: publicLive.results[0].metadata.freshness,
      receipt_generated_at: publicLive.receipt.generated_at
    },
    public_pinned_2026_09_10: publicPinned ? {
      evaluated_at: pinnedSession.evaluatedAt ?? null,
      freshness: publicPinned.results[0].metadata.freshness,
      receipt_generated_at: publicPinned.receipt.generated_at
    } : { error: publicPinnedError },
    record_hash_after_public: sha256(publicLive.results[0].record)
  },
  f06: {
    unit_of_analysis: record.unit_of_analysis,
    observation_grain: publicLive.results[0].metadata.dimensions.observation_grain,
    inferred_search_tags: publicLive.results[0].metadata.dimensions.inferred_search_tags
  }
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
