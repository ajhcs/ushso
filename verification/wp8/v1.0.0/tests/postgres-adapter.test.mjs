import assert from 'node:assert/strict';
import test from 'node:test';

import { digest } from '../../../../contracts/publication/v1.0.0/tools/common.mjs';
import { decodeGenerationCursor } from '../../../../packages/search/generation-cursor-v2.mjs';
import {
  BROWSE_CANDIDATES_SQL,
  HYDRATE_REVISIONS_SQL,
  POSTGRES_SEARCH_ADAPTER_VERSION,
  PostgresSearchBackendV2,
  RESOLVE_ACTIVE_PUBLICATION_SQL,
  SEARCH_CANDIDATES_SQL,
  createDatabasePublicationReadContext,
  resolveDatabasePublicationReadContext,
} from '../../../../packages/search/postgres-search-backend-v2.mjs';
import { buildPublicationManifest } from '../../../../packages/search/publication-lifecycle-v2.mjs';
import {
  buildSearchComponents,
  externalValidatedComponent,
  fixtureBuildReceiptDigest,
  fixtureTimes,
} from '../tools/fixture.mjs';

const CURSOR_SECRET = 'wp8-offline-fixture-cursor-secret-32-bytes-minimum';

function createPublication() {
  const fixture = buildSearchComponents({ suffix: 'adapter' });
  const components = [
    ...Object.values(fixture.components).map(item => item.component),
    externalValidatedComponent({ kind: 'seo', suffix: 'adapter', canonicalManifestRef: fixture.canonicalManifestRef }),
    externalValidatedComponent({ kind: 'coverage', suffix: 'adapter', canonicalManifestRef: fixture.canonicalManifestRef }),
  ];
  const manifest = buildPublicationManifest({
    publicationId: 'publication:wp8-fixture:adapter',
    canonicalManifestRef: fixture.canonicalManifestRef,
    canonicalAsOf: fixture.canonicalManifest.canonical_as_of,
    componentGenerationRefs: components.map(component => ({
      component_kind: component.component_kind,
      generation_id: component.generation_id,
      manifest_digest: component.component_checksum,
    })),
    coverageSnapshotId: 'coverage-snapshot:wp8-fixture:adapter',
    buildReceiptRef: 'build-receipt:wp8-fixture:adapter',
    buildReceiptDigest: fixtureBuildReceiptDigest('adapter'),
    staticCompatibilityRef: {
      manifest_id: 'legacy-static:wp1-fixture',
      manifest_digest: digest('legacy_static_compatibility', { fixture: true }),
    },
    sealedAt: '2026-08-30T22:01:00.000Z',
    rollbackEligibleUntil: fixtureTimes.RETAINED_UNTIL,
  });
  const retained = Object.fromEntries(components.map(component => [component.component_kind, fixtureTimes.RETAINED_UNTIL]));
  return { manifest, context: createDatabasePublicationReadContext({ publicationManifest: manifest, componentRetainedUntil: retained }) };
}

function candidateRow(generationId, index, overrides = {}) {
  return {
    generation_id: generationId,
    document_id: `document:asset:result-${index}`,
    document_type: 'asset_search',
    canonical_id: `asset:result-${index}`,
    revision_id: `revision:asset:result-${index}:v1`,
    document_checksum: String(index).padStart(64, '0'),
    visibility_state: 'public',
    rank_micros: 1_000_000 - index,
    title: `Result ${index}`,
    description: `Bounded metadata result ${index}`,
    authority_tier: 'first_party',
    match_reason_code: 'untuned_lexical_metadata_match',
    match_reason: 'Matched indexed metadata.',
    near_miss: false,
    ...overrides,
  };
}

test('database publication context pins every component and is deeply immutable', async () => {
  const { manifest, context } = createPublication();
  assert.equal(context.storage_mode, 'postgresql_immutable_generation');
  assert.equal(context.publication_manifest_id, manifest.publication_id);
  assert.equal(context.canonical_revision_manifest_id, manifest.canonical_manifest_ref.manifest_id);
  assert.equal(context.coverage_snapshot_id, manifest.coverage_snapshot_id);
  assert.equal(Object.keys(context.component_generations).length, 7);
  assert.equal(context.absence_claim_permitted, false);
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.component_generations));
  assert.ok(Object.isFrozen(context.component_retained_until));
  assert.ok(Object.isFrozen(context.component_checksums));

  const componentGenerations = Object.fromEntries(manifest.component_generation_refs.map(reference => [reference.component_kind, reference.generation_id]));
  const componentChecksums = Object.fromEntries(manifest.component_generation_refs.map(reference => [reference.component_kind, reference.manifest_digest.value]));
  const componentRetainedUntil = Object.fromEntries(manifest.component_generation_refs.map(reference => [reference.component_kind, fixtureTimes.RETAINED_UNTIL]));
  const calls = [];
  const resolved = await resolveDatabasePublicationReadContext({
    query: async configuration => {
      calls.push(configuration);
      return { rows: [{
        pointer_sequence: '3',
        publication_id: manifest.publication_id,
        publication_sha256: manifest.publication_digest.value,
        canonical_manifest_id: manifest.canonical_manifest_ref.manifest_id,
        canonical_membership_sha256: manifest.canonical_manifest_ref.digest.value,
        canonical_as_of: new Date(manifest.canonical_as_of),
        coverage_snapshot_id: manifest.coverage_snapshot_id,
        component_generations: componentGenerations,
        component_checksums: componentChecksums,
        component_retained_until: componentRetainedUntil,
        resolved_at: new Date('2026-08-30T22:02:00.000Z'),
        pointer_lookup_cache_disabled: true,
      }] };
    },
  });
  assert.equal(calls[0].text, RESOLVE_ACTIVE_PUBLICATION_SQL);
  assert.equal(resolved.pointer_resolution.sequence, 3);
  assert.equal(resolved.pointer_resolution.resolved_once_per_request, true);
  assert.deepEqual(resolved.component_generations, componentGenerations);
  assert.deepEqual(resolved.component_checksums, componentChecksums);
});

test('bounded indexed search carries explicit generation pins and a signed keyset cursor', async () => {
  const { context } = createPublication();
  const generationId = context.component_generations.asset_search;
  const calls = [];
  const backend = new PostgresSearchBackendV2({
    cursorSecret: CURSOR_SECRET,
    async query(configuration) {
      calls.push(configuration);
      return { rows: [candidateRow(generationId, 1), candidateRow(generationId, 2), candidateRow(generationId, 3)] };
    },
  });
  const response = await backend.searchAssets({
    query: 'hospital financial reports Pennsylvania',
    publication: context,
    filters: { geographies: ['US-PA'], authority_tiers: ['first_party'] },
    limit: 2,
    observedAt: '2026-08-30T22:10:00.000Z',
  });
  assert.equal(backend.adapter_version, POSTGRES_SEARCH_ADAPTER_VERSION);
  assert.equal(response.backend_contract_version, 'ushso-search-backend.v1.0.0');
  assert.equal('adapter_version' in response, false);
  assert.equal(response.quality_status, 'FAIL_PRE_TUNING');
  assert.equal(response.release_ready, false);
  assert.equal(response.result_count, 2);
  assert.equal(response.truncation.truncated, true);
  assert.equal(response.truth_boundary.raw_queries_persisted, 0);
  assert.equal(response.zero_result.absence_claim_permitted, false);
  assert.equal(calls[0].name, 'ushso_search_candidates_v2');
  assert.equal(calls[0].values[0], context.publication_manifest_id);
  assert.equal(calls[0].values[1], generationId);
  assert.equal(calls[0].values[4], 3);
  const cursor = decodeGenerationCursor(response.truncation.next_cursor, {
    secret: CURSOR_SECRET,
    observedAt: '2026-08-30T22:11:00.000Z',
    expectedPublicationManifestId: context.publication_manifest_id,
    expectedGenerationId: generationId,
    expectedProjectionType: 'asset_search',
  });
  assert.equal(cursor.sort.canonical_id, response.results.at(-1).canonical_id);
  assert.equal(cursor.sort.rank_micros, response.results.at(-1).rank_inputs.lexical_rank_micros);
});

test('browse, filters, result visibility, and candidate counts fail closed', async () => {
  const { context } = createPublication();
  const generationId = context.component_generations.asset_search;
  const backend = new PostgresSearchBackendV2({
    cursorSecret: CURSOR_SECRET,
    query: async configuration => ({ rows: [candidateRow(generationId, 1)] }),
  });
  const browse = await backend.searchAssets({
    query: '',
    publication: context,
    limit: 5,
    observedAt: '2026-08-30T22:10:00.000Z',
  });
  assert.equal(browse.results[0].rank_inputs.lexical_rank_micros, 999999);
  await assert.rejects(() => backend.searchAssets({
    query: 'finance',
    publication: context,
    filters: { postgres_tsquery: ['forbidden'] },
    observedAt: '2026-08-30T22:10:00.000Z',
  }), error => error.code === 'SEARCH_FILTER_UNKNOWN');

  const leak = new PostgresSearchBackendV2({
    cursorSecret: CURSOR_SECRET,
    query: async () => ({ rows: [candidateRow(generationId, 1, { visibility_state: 'quarantined' })] }),
  });
  await assert.rejects(() => leak.searchAssets({
    query: 'finance',
    publication: context,
    observedAt: '2026-08-30T22:10:00.000Z',
  }), error => error.code === 'POSTGRES_VISIBILITY_LEAK');
});

test('exact hydration rejects missing or cross-generation canonical revisions', async () => {
  const { context } = createPublication();
  const generationId = context.component_generations.asset_search;
  const candidates = [candidateRow(generationId, 1), candidateRow(generationId, 2)].map(row => ({
    canonical_id: row.canonical_id,
    revision_id: row.revision_id,
  }));
  const backend = new PostgresSearchBackendV2({
    cursorSecret: CURSOR_SECRET,
    query: async configuration => {
      const pins = JSON.parse(configuration.values[2]);
      return { rows: pins.map((pin, index) => ({
        generation_id: generationId,
        document_id: `document:asset:result-${index + 1}`,
        canonical_manifest_id: context.canonical_revision_manifest_id,
        ...pin,
        revision_sha256: String(index + 1).padStart(64, '0'),
        canonical_source_ref: { schema: 'ushso_canonical', revision_id: pin.revision_id },
      })) };
    },
  });
  const hydrated = await backend.hydrateExactRevisions({ publication: context, projectionType: 'asset_search', candidates });
  assert.equal(hydrated.rows.length, 2);
  assert.equal(hydrated.generation_id, generationId);
  assert.equal(hydrated.source_of_truth, false);

  const wrong = new PostgresSearchBackendV2({
    cursorSecret: CURSOR_SECRET,
    query: async () => ({ rows: [{ ...candidateRow(generationId, 1), generation_id: 'generation:asset_search:wrong' }] }),
  });
  await assert.rejects(() => wrong.hydrateExactRevisions({ publication: context, projectionType: 'asset_search', candidates: candidates.slice(0, 1) }), error => error.code === 'HYDRATION_REVISION_PIN_MISMATCH');

  const oversized = new PostgresSearchBackendV2({
    cursorSecret: CURSOR_SECRET,
    query: async () => ({ rows: [{
      generation_id: generationId,
      document_id: 'document:asset:result-1',
      canonical_manifest_id: context.canonical_revision_manifest_id,
      ...candidates[0],
      revision_sha256: '1'.repeat(64),
      canonical_source_ref: { bounded_reference: 'x'.repeat(513 * 1024) },
    }] }),
  });
  await assert.rejects(
    () => oversized.hydrateExactRevisions({ publication: context, projectionType: 'asset_search', candidates: candidates.slice(0, 1) }),
    error => error.code === 'HYDRATION_RESPONSE_BYTES_EXCEEDED',
  );
});

test('adapter SQL exposes only bounded generation-pinned functions and no OFFSET or mutable pointer lookup', () => {
  for (const sql of [SEARCH_CANDIDATES_SQL, BROWSE_CANDIDATES_SQL, HYDRATE_REVISIONS_SQL]) {
    assert.match(sql, /ushso_search\.(?:search_candidates|browse_candidates|hydrate_exact_revisions)/u);
    assert.doesNotMatch(sql, /\boffset\b/iu);
    assert.doesNotMatch(sql, /publication_pointer/iu);
    assert.doesNotMatch(sql, /jsonl|readFile|full[_ -]?corpus/iu);
  }
});

test('aborted requests never enter the query executor', async () => {
  const { context } = createPublication();
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  let calls = 0;
  const backend = new PostgresSearchBackendV2({
    cursorSecret: CURSOR_SECRET,
    query: async () => { calls += 1; return { rows: [] }; },
  });
  await assert.rejects(() => backend.searchAssets({
    query: 'finance',
    publication: context,
    observedAt: '2026-08-30T22:10:00.000Z',
    signal: controller.signal,
  }), /cancelled/u);
  assert.equal(calls, 0);
});
