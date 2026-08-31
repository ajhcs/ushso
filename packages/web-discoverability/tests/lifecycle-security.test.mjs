import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WebDiscoverabilityService,
  createStaticSeoProjectionRepository
} from '../src/index.mjs';
import { createWp13WebDiscoverabilityCandidateHandler } from '../../../worker/wp13-web-discoverability-candidate.mjs';
import { SITE_ORIGIN, alias, artifact, publication, record, withdrawal } from './fixtures.mjs';

async function handlerFor(projection, pin = publication()) {
  const service = new WebDiscoverabilityService({
    canonicalSiteOrigin: SITE_ORIGIN,
    publicationResolver: { async resolve() { return pin; } },
    projectionRepository: createStaticSeoProjectionRepository({ artifacts: [projection], canonicalSiteOrigin: SITE_ORIGIN })
  });
  return createWp13WebDiscoverabilityCandidateHandler({ service });
}

async function response(handler, path, options = {}) {
  return handler.handle(new Request(`https://ushso.example${path}`, {
    method: options.method ?? 'GET',
    headers: { accept: options.accept ?? 'text/html', ...(options.headers ?? {}) }
  }));
}

test('only an admitted permanent public legacy alias redirects and its Location is canonical', async () => {
  const pin = publication();
  const projection = await artifact({ publication: pin, aliases: [alias()] });
  const handler = await handlerFor(projection, pin);
  const redirect = await response(handler, '/datasets/legacy-cms-directory');
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), 'https://ushso.example/datasets/obs%3Aasset%3Acms-facility-directory');
  assert.equal(redirect.headers.get('x-ushso-search-generation'), pin.index_generation);
  assert.equal(redirect.headers.get('vary'), 'Accept');
  assert.doesNotMatch(redirect.headers.get('location'), /[\r\n]/u);
});

test('unknown, never-public, private, quarantined, excluded, and candidate IDs are byte-identical 404s', async () => {
  const pin = publication();
  const projection = await artifact({ publication: pin });
  const handler = await handlerFor(projection, pin);
  const ids = ['unknown', 'never-public', 'private-record', 'quarantined-record', 'excluded-record', 'candidate-record'];
  const receipts = [];
  for (const id of ids) {
    const result = await response(handler, `/datasets/${id}`);
    receipts.push({
      status: result.status,
      headers: [...result.headers].sort(),
      body: await result.text()
    });
  }
  for (const receipt of receipts) {
    assert.equal(receipt.status, 404);
    assert.deepEqual(receipt, receipts[0]);
    assert.doesNotMatch(receipt.body, /private|quarantined|excluded|candidate|never.public|internal reason/iu);
  }
});

test('410 exists only for a proven public_withdrawn assertion and remains a generic tombstone', async () => {
  const pin = publication();
  const projection = await artifact({
    publication: pin,
    withdrawals: [withdrawal()],
    aliases: [alias('legacy-formerly-public', 'obs:asset:formerly-public')]
  });
  const handler = await handlerFor(projection, pin);
  const gone = await response(handler, '/datasets/obs%3Aasset%3Aformerly-public');
  assert.equal(gone.status, 410);
  const body = await gone.text();
  assert.match(body, /Dataset no longer available/u);
  assert.match(body, /previously published at this address/u);
  assert.doesNotMatch(body, /assertion:|evidence:|prior|withdrawal reason|internal/iu);

  const legacy = await response(handler, '/datasets/legacy-formerly-public');
  assert.equal(legacy.status, 308);
  assert.equal(legacy.headers.get('location'), 'https://ushso.example/datasets/obs%3Aasset%3Aformerly-public');

  const hidden = await response(handler, '/datasets/withdrawn-but-unapproved');
  assert.equal(hidden.status, 404);
});

test('projection rejects non-admissible aliases, lifecycle collisions, hidden records, signed links, and internal withdrawal fields', async () => {
  const invalidAlias = alias('bad-alias');
  invalidAlias.state = 'candidate';
  await assert.rejects(() => artifact({ aliases: [invalidAlias] }), /SEO_ALIAS_NOT_ADMISSIBLE/u);

  await assert.rejects(() => artifact({ aliases: [alias('obs:asset:cms-facility-directory')] }), /SEO_ALIAS_TARGET_INVALID/u);
  await assert.rejects(() => artifact({ withdrawals: [withdrawal('obs:asset:cms-facility-directory')] }), /SEO_LIFECYCLE_COLLISION/u);

  const hidden = record();
  hidden.visibility_state = 'quarantined';
  await assert.rejects(() => artifact({ records: [hidden] }), /SEO_RECORD_NOT_PUBLIC/u);

  const signed = record({ sourceUrl: 'https://data.cms.gov/example?token=secret' });
  await assert.rejects(() => artifact({ records: [signed] }), /SEO_SIGNED_URL_FORBIDDEN/u);

  const reasonLeak = { ...withdrawal(), internal_reason: 'sensitive moderation state' };
  await assert.rejects(() => artifact({ withdrawals: [reasonLeak] }), /SEO_FIELD_UNKNOWN/u);
  const unreviewed = withdrawal('obs:asset:unreviewed');
  unreviewed.review_status = 'pending';
  await assert.rejects(() => artifact({ withdrawals: [unreviewed] }), /SEO_WITHDRAWAL_NOT_DISCLOSABLE/u);
});

test('record path canonicalization and transport behavior are bounded and do not intercept JSON callers', async () => {
  const pin = publication();
  const projection = await artifact({ publication: pin });
  const handler = await handlerFor(projection, pin);
  const canonicalized = await response(handler, '/datasets/obs:asset:cms-facility-directory');
  assert.equal(canonicalized.status, 308);
  assert.equal(canonicalized.headers.get('location'), 'https://ushso.example/datasets/obs%3Aasset%3Acms-facility-directory');
  assert.equal(canonicalized.headers.get('vary'), 'Accept');

  const json = await response(handler, '/datasets/obs%3Aasset%3Acms-facility-directory', { accept: 'application/json' });
  assert.equal(json, null);
  const rejectedHtml = await response(handler, '/datasets/obs%3Aasset%3Acms-facility-directory', { accept: 'text/html;q=0, application/json' });
  assert.equal(rejectedHtml, null);
  const exactRejectionOverridesWildcard = await response(handler, '/datasets/obs%3Aasset%3Acms-facility-directory', { accept: 'text/html;q=0, */*;q=1' });
  assert.equal(exactRejectionOverridesWildcard, null);
  const textWildcard = await response(handler, '/datasets/obs%3Aasset%3Acms-facility-directory', { accept: 'text/*;q=0.5, application/json' });
  assert.equal(textWildcard.status, 200);
  const jsonPost = await response(handler, '/datasets/obs%3Aasset%3Acms-facility-directory', { accept: 'application/json', method: 'POST' });
  assert.equal(jsonPost, null);
  const jsonOptions = await response(handler, '/datasets/obs%3Aasset%3Acms-facility-directory', { accept: 'application/json', method: 'OPTIONS' });
  assert.equal(jsonOptions, null);
  const uppercaseHtml = await response(handler, '/datasets/obs%3Aasset%3Acms-facility-directory', { accept: 'TEXT/HTML' });
  assert.equal(uppercaseHtml.status, 200);
  const post = await response(handler, '/datasets/obs%3Aasset%3Acms-facility-directory', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal(post.headers.get('vary'), 'Accept');
  const unrelated = await response(handler, '/about');
  assert.equal(unrelated, null);

  const head = await response(handler, '/datasets/obs%3Aasset%3Acms-facility-directory', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const longId = `a${':b'.repeat(105)}`;
  const longProjection = await artifact({ publication: pin, records: [record({ id: longId })] });
  const longHandler = await handlerFor(longProjection, pin);
  const longRedirect = await response(longHandler, `/datasets/${longId}`);
  assert.equal(longRedirect.status, 308);
  assert.equal(longRedirect.headers.get('location'), `https://ushso.example/datasets/${encodeURIComponent(longId)}`);
});

test('canonical origin is deployment-owned and cannot be selected by artifact bytes or request host', async () => {
  const pin = publication();
  const poisonedOrigin = await artifact({ publication: pin, siteOrigin: 'https://attacker.example' });
  assert.throws(() => createStaticSeoProjectionRepository({
    artifacts: [poisonedOrigin],
    canonicalSiteOrigin: SITE_ORIGIN
  }), /SEO_ARTIFACT_SITE_ORIGIN_MISMATCH/u);

  const projection = await artifact({ publication: pin, aliases: [alias()] });
  const handler = await handlerFor(projection, pin);
  const redirect = await handler.handle(new Request('https://attacker.example/datasets/legacy-cms-directory', {
    headers: { accept: 'text/html' }
  }));
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), `${SITE_ORIGIN}/datasets/obs%3Aasset%3Acms-facility-directory`);

  const page = await handler.handle(new Request('https://attacker.example/datasets/obs%3Aasset%3Acms-facility-directory', {
    headers: { accept: 'text/html' }
  }));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<link rel="canonical" href="https:\/\/ushso\.example\//u);
});

test('HTML response security policy is fixed and source metadata never controls headers', async () => {
  const pin = publication();
  const projection = await artifact({ publication: pin, records: [record({ title: 'Header\r\nX-Evil: yes' })] });
  const handler = await handlerFor(projection, pin);
  const result = await response(handler, '/datasets/obs%3Aasset%3Acms-facility-directory');
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('x-evil'), null);
  assert.match(result.headers.get('content-security-policy'), /default-src 'none'/u);
  assert.match(await result.text(), /Header\r\nX-Evil: yes/u);
});
