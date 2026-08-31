import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LIMITS } from '../src/index.mjs';
import { artifact, record } from './fixtures.mjs';

test('record fields, cardinalities, source URLs, and rendered output are bounded fail-closed', async () => {
  await assert.rejects(() => artifact({ records: [record({ title: 'x'.repeat(LIMITS.maxTitleChars + 1) })] }), /SEO_STRING_INVALID/u);
  await assert.rejects(() => artifact({ records: [record({ description: 'x'.repeat(LIMITS.maxDescriptionChars + 1) })] }), /SEO_STRING_INVALID/u);

  const tooManySpatial = record();
  tooManySpatial.spatial_coverage = Array.from({ length: LIMITS.maxSpatialCoverageItems + 1 }, (_, index) => ({
    name: `Place ${index}`,
    kind: 'place',
    evidence_ids: ['evidence:spatial']
  }));
  await assert.rejects(() => artifact({ records: [tooManySpatial] }), /SEO_SPATIAL_COVERAGE_INVALID/u);
  const invalidDate = record();
  invalidDate.temporal_coverage.start = '2026-02-31';
  await assert.rejects(() => artifact({ records: [invalidDate] }), /SEO_DATE_INVALID/u);

  const javascript = record({ sourceUrl: 'javascript:alert(1)' });
  await assert.rejects(() => artifact({ records: [javascript] }), /SEO_URL_SCHEME_FORBIDDEN/u);
  const credentials = record({ sourceUrl: 'https://user:secret@data.cms.gov/example' });
  await assert.rejects(() => artifact({ records: [credentials] }), /SEO_URL_SCHEME_FORBIDDEN/u);
  const local = record({ sourceUrl: 'https://127.0.0.1/example' });
  await assert.rejects(() => artifact({ records: [local] }), /SEO_URL_HOST_FORBIDDEN/u);
  const metadata = record({ sourceUrl: 'https://169.254.169.254/latest/meta-data' });
  await assert.rejects(() => artifact({ records: [metadata] }), /SEO_URL_HOST_FORBIDDEN/u);
  const opaqueQuery = record({ sourceUrl: 'https://data.cms.gov/example?view=public' });
  await assert.rejects(() => artifact({ records: [opaqueQuery] }), /SEO_URL_QUERY_FORBIDDEN/u);
  const cloudSignature = record({ sourceUrl: 'https://data.cms.gov/example?X-Goog-Credential=secret' });
  await assert.rejects(() => artifact({ records: [cloudSignature] }), /SEO_SIGNED_URL_FORBIDDEN/u);

  const largeDistributions = Array.from({ length: LIMITS.maxDistributions }, (_, index) => ({
    kind: 'download',
    name: `Distribution ${index} ${'n'.repeat(250)}`,
    format: 'CSV',
    media_type: 'text/csv',
    access_url: `https://data.cms.gov/${'a'.repeat(1_850)}${String(index).padStart(3, '0')}`,
    download_url: `https://data.cms.gov/download/${'b'.repeat(1_840)}${String(index).padStart(3, '0')}`,
    evidence_ids: ['evidence:distribution']
  }));
  await assert.rejects(() => artifact({ records: [record({ distributions: largeDistributions })] }), /SEO_HTML_BYTES_EXCEEDED/u);
});

test('sitemap cardinality and byte limits shard deterministically with complete reconciliation', async () => {
  const records = Array.from({ length: 7 }, (_, index) => record({ id: `obs:asset:record-${index}` }));
  const projection = await artifact({ records, sitemapShardMaxUrls: 2 });
  assert.equal(projection.sitemap.kind, 'index');
  assert.equal(projection.sitemap.shards.length, 4);
  assert.equal(projection.sitemap.shards.reduce((sum, shard) => sum + shard.url_count, 0), records.length);
  assert.ok(projection.sitemap.shards.every(shard => new TextEncoder().encode(shard.xml).byteLength <= LIMITS.sitemapShardMaxBytes));
  assert.deepEqual(projection.sitemap.shards.map(shard => shard.url_count), [2, 2, 2, 1]);
});

test('duplicate/colliding identifiers and unpinned fact evidence fail closed', async () => {
  await assert.rejects(() => artifact({ records: [record(), record()] }), /SEO_PUBLIC_ID_DUPLICATE/u);
  const unpinned = record();
  unpinned.publisher.evidence_ids = ['evidence:not-in-truth'];
  await assert.rejects(() => artifact({ records: [unpinned] }), /SEO_FACT_EVIDENCE_UNPINNED/u);
});

test('every rendered external URL has exact policy-versioned public-locator and redaction provenance', async () => {
  const missing = record();
  missing.public_locator_attestations.pop();
  await assert.rejects(() => artifact({ records: [missing] }), /SEO_PUBLIC_LOCATOR_COVERAGE_MISMATCH/u);

  const extra = record();
  extra.public_locator_attestations.push({
    ...extra.public_locator_attestations[0],
    url: 'https://unused.cms.gov/public'
  });
  await assert.rejects(() => artifact({ records: [extra] }), /SEO_PUBLIC_LOCATOR_COVERAGE_MISMATCH/u);

  const wrongPolicy = record();
  wrongPolicy.public_locator_attestations[0].policy_version = 'uncontrolled-policy';
  await assert.rejects(() => artifact({ records: [wrongPolicy] }), /SEO_PUBLIC_LOCATOR_POLICY_UNSUPPORTED/u);

  const unpinned = record();
  unpinned.public_locator_attestations[0].evidence_ids = ['evidence:not-pinned'];
  await assert.rejects(() => artifact({ records: [unpinned] }), /SEO_FACT_EVIDENCE_UNPINNED/u);
});

test('secret-bearing URL paths fail closed after repeated decoding while ordinary public paths remain admissible', async () => {
  const forbidden = [
    'https://data.cms.gov/private/token/super-secret',
    'https://data.cms.gov/files/api-key/AKIAABCDEFGHIJKLMNOP',
    'https://data.cms.gov/%74oken/secret-value',
    'https://data.cms.gov/%2574oken/secret-value',
    'https://data.cms.gov/private/%5Ctoken%5Csecret-value',
    'https://data.cms.gov/download;token=secret-value',
    'https://data.cms.gov/files/password:secret-value',
    'https://data.cms.gov/private/catalog-export',
    'https://data.cms.gov/files/client-secret/secret-value',
    'https://data.cms.gov/files/refresh-token/secret-value',
    'https://data.cms.gov/files/client_secret/randomsecret',
    'https://data.cms.gov/files/api_token/randomsecret',
    'https://data.cms.gov/files/id_token/randomsecret',
    'https://data.cms.gov/files/sessionid/deadbeef1234',
    'https://data.cms.gov/files/key/randomsecret',
    'https://data.cms.gov/files/secrets/randomsecret',
    'https://data.cms.gov/files/x-amz-credential/account-role',
    'https://data.cms.gov/files/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.signaturevalue'
  ];
  for (const sourceUrl of forbidden) {
    await assert.rejects(() => artifact({ records: [record({ sourceUrl })] }), /SEO_(?:SECRET_PATH|URL_PATH_CONTROL)_FORBIDDEN/u, sourceUrl);
  }
  const allowed = await artifact({ records: [record({ sourceUrl: 'https://data.cms.gov/provider-data/dataset/public-release' })] });
  assert.equal(allowed.records[0].document.content.canonical_source_url, 'https://data.cms.gov/provider-data/dataset/public-release');
});

test('runtime package and candidate Worker remain portable, zero-egress, and zero-action', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const files = [
    'packages/web-discoverability/src/safety.mjs',
    'packages/web-discoverability/src/projection.mjs',
    'packages/web-discoverability/src/render.mjs',
    'packages/web-discoverability/src/service.mjs',
    'worker/wp13-web-discoverability-candidate.mjs'
  ];
  for (const relative of files) {
    const source = await fs.readFile(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /(?:from|import\s*)\s*['"]node:/u, `${relative} has a Node-only import`);
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/u, `${relative} has a network client`);
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|PUT|PATCH|POST)\b/u, `${relative} contains a mutation action`);
  }
});
