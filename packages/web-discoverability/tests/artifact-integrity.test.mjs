import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WebDiscoverabilityService,
  canonicalJson,
  createStaticRollbackWebDiscoverabilityService,
  createStaticSeoProjectionRepository,
  deepFreeze,
  renderDatasetHtml,
  sha256Hex,
  utf8Bytes,
  verifySeoArtifact
} from '../src/index.mjs';
import { createWp13WebDiscoverabilityCandidateHandler } from '../../../worker/wp13-web-discoverability-candidate.mjs';
import { SITE_ORIGIN, artifact, publication, record } from './fixtures.mjs';

function mutableCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function freezeWithoutInvokingAccessors(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) freezeWithoutInvokingAccessors(descriptor.value, seen);
  }
  Object.freeze(value);
  return value;
}

async function rehashArtifact(candidate) {
  const { artifact_digest: artifactDigest, ...material } = candidate;
  artifactDigest.value = await sha256Hex(canonicalJson(material));
  return candidate;
}

async function rehashDocument(document) {
  const { document_checksum: checksum, ...material } = document;
  checksum.value = await sha256Hex(canonicalJson(material));
}

function handlerFor(candidate, pin = publication()) {
  const projectionRepository = createStaticSeoProjectionRepository({
    artifacts: [deepFreeze(candidate)],
    canonicalSiteOrigin: SITE_ORIGIN
  });
  const service = new WebDiscoverabilityService({
    canonicalSiteOrigin: SITE_ORIGIN,
    publicationResolver: { async resolve() { return pin; } },
    projectionRepository
  });
  return createWp13WebDiscoverabilityCandidateHandler({ service });
}

async function datasetResponse(handler) {
  return handler.handle(new Request(`${SITE_ORIGIN}/datasets/obs%3Aasset%3Acms-facility-directory`, {
    headers: { accept: 'text/html' }
  }));
}

async function assertFailsClosed(candidate, pin = publication()) {
  const response = await datasetResponse(handlerFor(candidate, pin));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await response.text(), /SEO_|generation:|publication:|javascript:|quarantined/iu);
}

test('active reads recompute artifact, document, render, and sitemap digests before serving', async () => {
  const original = await artifact();

  const outer = mutableCopy(original);
  outer.artifact_digest.value = '0'.repeat(64);
  await assertFailsClosed(outer);

  const document = mutableCopy(original);
  document.records[0].document.document_checksum.value = '0'.repeat(64);
  await rehashArtifact(document);
  await assertFailsClosed(document);

  const render = mutableCopy(original);
  render.records[0].render_receipt.html_sha256 = '0'.repeat(64);
  await rehashArtifact(render);
  await assertFailsClosed(render);

  const sitemap = mutableCopy(original);
  sitemap.sitemap.current_sha256 = '0'.repeat(64);
  await rehashArtifact(sitemap);
  await assertFailsClosed(sitemap);
});

test('a deeply frozen quarantined record and a fully rehashed javascript locator fail closed', async () => {
  const original = await artifact();
  const quarantined = mutableCopy(original);
  quarantined.records[0].document.visibility_state = 'quarantined';
  await rehashDocument(quarantined.records[0].document);
  await rehashArtifact(quarantined);
  await assertFailsClosed(quarantined);

  const javascript = mutableCopy(original);
  javascript.records[0].document.content.canonical_source_url = 'javascript:alert(1)';
  const html = renderDatasetHtml(javascript.records[0]);
  javascript.records[0].render_receipt.html_bytes = utf8Bytes(html);
  javascript.records[0].render_receipt.html_sha256 = await sha256Hex(html);
  await rehashDocument(javascript.records[0].document);
  await rehashArtifact(javascript);
  await assertFailsClosed(javascript);
});

test('retained generation shard reads recompute body digests and semantic membership', async () => {
  const pin = publication();
  const original = await artifact({
    publication: pin,
    records: [record({ id: 'obs:asset:a' }), record({ id: 'obs:asset:b' })],
    sitemapShardMaxUrls: 1
  });
  const candidate = mutableCopy(original);
  candidate.sitemap.shards[0].xml = candidate.sitemap.shards[0].xml.replace('obs%3Aasset%3Aa', 'obs%3Aasset%3Ahidden');
  candidate.sitemap.shards[0].sha256 = await sha256Hex(candidate.sitemap.shards[0].xml);
  await rehashArtifact(candidate);
  const handler = handlerFor(candidate, pin);
  const response = await handler.handle(new Request(candidate.sitemap.shards[0].url));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /hidden|SEO_/u);
});

test('explicit static rollback reads verify the sealed artifact rather than trusting frozen bytes', async () => {
  const pin = publication();
  const original = await artifact({ publication: pin });
  const candidate = mutableCopy(original);
  candidate.records[0].render_receipt.html_bytes += 1;
  await rehashArtifact(candidate);
  const service = createStaticRollbackWebDiscoverabilityService({
    canonicalSiteOrigin: SITE_ORIGIN,
    publication: pin,
    artifacts: [deepFreeze(candidate)]
  });
  const handler = createWp13WebDiscoverabilityCandidateHandler({ service });
  const response = await datasetResponse(handler);
  assert.equal(response.status, 503);
});

test('a repository-shaped object cannot bypass service-owned verification', async () => {
  const pin = publication();
  const raw = mutableCopy(await artifact({ publication: pin }));
  raw.records[0].document.content.canonical_source_url = 'javascript:alert(1)';
  const html = renderDatasetHtml(raw.records[0]);
  raw.records[0].render_receipt.html_bytes = utf8Bytes(html);
  raw.records[0].render_receipt.html_sha256 = await sha256Hex(html);
  await rehashDocument(raw.records[0].document);
  await rehashArtifact(raw);
  deepFreeze(raw);
  const projectionRepository = Object.freeze({
    repository_version: 'ushso-seo-projection-repository.v1.0.0',
    canonical_site_origin: SITE_ORIGIN,
    async readGeneration() { return raw; },
    async readRetainedGeneration() { return raw; }
  });
  const service = new WebDiscoverabilityService({
    canonicalSiteOrigin: SITE_ORIGIN,
    publicationResolver: { async resolve() { return pin; } },
    projectionRepository
  });
  const response = await datasetResponse(createWp13WebDiscoverabilityCandidateHandler({ service }));
  assert.equal(response.status, 503);
});

test('deep-frozen switching accessors cannot cross the active or retained verification boundary', async () => {
  const pin = publication();
  const activeRaw = mutableCopy(await artifact({ publication: pin }));
  const safeSource = activeRaw.records[0].document.content.canonical_source_url;
  let exposeUnsafeSource = false;
  Object.defineProperty(activeRaw.records[0].document.content, 'canonical_source_url', {
    enumerable: true,
    configurable: false,
    get() { return exposeUnsafeSource ? 'javascript:alert(1)' : safeSource; }
  });
  freezeWithoutInvokingAccessors(activeRaw);
  const activeVerified = await verifySeoArtifact(activeRaw, { canonicalSiteOrigin: SITE_ORIGIN });
  exposeUnsafeSource = true;
  assert.equal(activeVerified.artifact.records[0].document.content.canonical_source_url, safeSource);
  assert.doesNotMatch(renderDatasetHtml(activeVerified.artifact.records[0]), /javascript:/u);

  const retainedRaw = mutableCopy(await artifact({
    publication: pin,
    records: [record({ id: 'obs:asset:a' }), record({ id: 'obs:asset:b' })],
    sitemapShardMaxUrls: 1
  }));
  const safeXml = retainedRaw.sitemap.shards[0].xml;
  let exposeUnsafeXml = false;
  Object.defineProperty(retainedRaw.sitemap.shards[0], 'xml', {
    enumerable: true,
    configurable: false,
    get() { return exposeUnsafeXml ? safeXml.replace('obs%3Aasset%3Aa', 'obs%3Aasset%3Ahidden') : safeXml; }
  });
  freezeWithoutInvokingAccessors(retainedRaw);
  const retainedVerified = await verifySeoArtifact(retainedRaw, { canonicalSiteOrigin: SITE_ORIGIN });
  exposeUnsafeXml = true;
  assert.equal(retainedVerified.artifact.sitemap.shards[0].xml, safeXml);
  assert.doesNotMatch(retainedVerified.artifact.sitemap.shards[0].xml, /hidden/u);
});
