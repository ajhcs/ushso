#!/usr/bin/env node
import path from 'node:path';
import { loadLegacyCorpus } from '../src/legacy-loader.mjs';
import { normalizeLegacyCorpus } from '../src/normalize.mjs';
import { PACKAGE_ROOT, stableJson, writeAtomic } from './common.mjs';

const legacy = await loadLegacyCorpus();
const normalized = normalizeLegacyCorpus(legacy);
await writeAtomic(path.join(PACKAGE_ROOT, 'fixtures/import-plan.json'), stableJson(normalized.plan));
await writeAtomic(path.join(PACKAGE_ROOT, 'fixtures/parity-pins.json'), stableJson({
  fixture_version: 'ushso-normalization-parity-pins.v1.0.0',
  import_id: normalized.import_id,
  source: normalized.plan.source,
  bundle_fingerprint: normalized.plan.bundle_fingerprint,
  projection_fingerprint: normalized.plan.projection_fingerprint,
  record_count: normalized.projection.records.length,
  search_document_count: normalized.projection.search_documents.length,
  join_route_count: normalized.projection.join_routes.length,
  absence_claim_permitted: false,
  external_requests: 0,
  payloads_acquired: 0,
  analyses_executed: 0
}));
process.stdout.write(`${JSON.stringify({ status: 'pass', import_id: normalized.import_id, record_mappings: normalized.plan.record_mappings.length, join_route_mappings: normalized.plan.join_route_mappings.length, review_candidates: normalized.plan.identity_review_candidates.length })}\n`);
