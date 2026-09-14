import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HISTORICAL_PA_PUBLISHED_RECORD_COUNT,
  LAST_GOOD_GENERATION,
  archiveHistoricalReadiness,
  assembleAcceptedPublicationManifest,
  assertProjectionParity,
  expiredGenerationBehavior,
  pageDictionary,
  pennsylvaniaCurrentPublishedCount,
  publishOrKeepLastGood,
  serveBoundedAssets,
  staticFallbackContext,
} from '../../packages/registry/publication-parity.mjs';

const readinessPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../apps/web/public/state-readiness-v0.1.0.json');

test('manifest closure rejects missing assets and historical Pennsylvania counts are not current coverage', () => {
  const readiness = JSON.parse(readFileSync(readinessPath, 'utf8'));
  assert.equal(readiness.corpus_version, '1.1.0');
  const pa = readiness.states.find((state) => state.postal === 'PA');
  assert.equal(pa.published_state_record_count, HISTORICAL_PA_PUBLISHED_RECORD_COUNT);
  const archived = archiveHistoricalReadiness(readiness);
  assert.equal(archived.historical_view, true);
  assert.equal(archived.current_coverage, false);
  assert.equal(pennsylvaniaCurrentPublishedCount(readiness), 0);
  const archivedPa = archived.states.find((state) => state.postal === 'PA');
  assert.equal(archivedPa.current_published_state_record_count, 0);
  assert.equal(archivedPa.archived_published_state_record_count, 24);
  assert.equal(archivedPa.published_state_record_count_is_current, false);
  assert.throws(() => assembleAcceptedPublicationManifest({ assets: [], dictionaryBindings: [], examples: [], sourceCards: [], coverage: {}, searchProjection: {} }), { code: 'MISSING_ASSET' });
  const manifest = assembleAcceptedPublicationManifest({
    assets: [
      { id: 'canonical', kind: 'canonical_revision', sha256: 'a'.repeat(64) },
      { id: 'dict', kind: 'dictionary', sha256: 'b'.repeat(64) },
      { id: 'ex', kind: 'example', sha256: 'c'.repeat(64) },
      { id: 'card', kind: 'source_card', sha256: 'd'.repeat(64) },
      { id: 'cov', kind: 'coverage', sha256: 'e'.repeat(64) },
      { id: 'search', kind: 'search_projection', sha256: 'f'.repeat(64) },
    ],
    dictionaryBindings: [{ id: 'dict' }],
    examples: [{ id: 'ex' }],
    sourceCards: [{ id: 'card' }],
    coverage: { record_count: 3434 },
    searchProjection: { generation: LAST_GOOD_GENERATION },
    contractVersions: { publication: '1.0.0' },
    sourceContext: 'cdc-socrata',
    expectedSourceContext: 'cdc-socrata',
  });
  assert.equal(manifest.coverage.historical_pennsylvania_is_current, false);
  assert.throws(() => assembleAcceptedPublicationManifest({
    assets: manifest.assets,
    dictionaryBindings: [{ id: 'dict' }],
    examples: [{ id: 'ex' }],
    sourceCards: [{ id: 'card' }],
    coverage: { record_count: 3434 },
    searchProjection: { generation: LAST_GOOD_GENERATION },
    sourceContext: 'cms',
    expectedSourceContext: 'cdc-socrata',
  }), { code: 'SOURCE_CONTEXT_MISMATCH' });
  assert.throws(() => assembleAcceptedPublicationManifest({
    assets: manifest.assets,
    dictionaryBindings: [{ id: 'dict' }],
    examples: [{ id: 'ex' }],
    sourceCards: [{ id: 'card' }],
    coverage: { record_count: 3434 },
    searchProjection: { generation: LAST_GOOD_GENERATION },
    partialFragments: ['orphan'],
  }), { code: 'UNDECLARED_PARTIAL_FRAGMENT' });
});

test('large dictionaries page predictably and one bad asset does not blank the catalog', () => {
  const entries = Array.from({ length: 120 }, (_, index) => ({ field: `f${index}`, definition: 'x'.repeat(20) }));
  const paged = pageDictionary(entries, { pageSize: 40, maxPageBytes: 64 * 1024 });
  assert.equal(paged.predictable, true);
  assert.ok(paged.page_count >= 3);
  assert.ok(paged.pages.every((page) => page.length <= 40));
  const served = serveBoundedAssets([
    { id: 'ok-1', kind: 'record', ok: true, body: { id: '1' } },
    { id: 'bad', kind: 'dictionary', ok: false, error: 'ASSET_CORRUPT' },
    { id: 'ok-2', kind: 'example', ok: true, body: { id: '2' } },
  ]);
  assert.equal(served.catalog_blanked, false);
  assert.equal(served.served.length, 2);
  assert.equal(served.failed.length, 1);
});

test('mixed generations fail closed and failed publication leaves last-good live; static fallback remains available', () => {
  assert.throws(() => assertProjectionParity({
    catalogGeneration: LAST_GOOD_GENERATION,
    dictionaryGeneration: 'other',
    searchGeneration: LAST_GOOD_GENERATION,
    uiGeneration: LAST_GOOD_GENERATION,
  }), { code: 'MIXED_GENERATION' });
  const failed = publishOrKeepLastGood({ candidate: { generation: 'candidate-fail', closed: false }, failClosed: true });
  assert.equal(failed.published, false);
  assert.equal(failed.live_generation, LAST_GOOD_GENERATION);
  assert.equal(failed.last_good_left_live, true);
  const expired = expiredGenerationBehavior('legacy-static:1.1.0:old');
  assert.equal(expired.status, 'expired_generation');
  assert.equal(expired.live_generation, LAST_GOOD_GENERATION);
  const fallback = staticFallbackContext({ corpus_id: 'ushso-live-catalog-2026-09-03', corpus_version: '1.2.0', manifest_sha256: LAST_GOOD_GENERATION.replace('live-2026-09-03-', '') });
  assert.equal(fallback.storage_mode, 'legacy_static_assets');
  assert.equal(fallback.absence_claim_permitted, false);
});
