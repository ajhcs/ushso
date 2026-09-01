import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WebDiscoverabilityService,
  createStaticRollbackWebDiscoverabilityService,
  createStaticSeoProjectionRepository
} from '../src/index.mjs';
import { createWp13WebDiscoverabilityCandidateHandler } from '../../../worker/wp13-web-discoverability-candidate.mjs';
import { SITE_ORIGIN, artifact, publication, record } from './fixtures.mjs';

function datasetRequest(id = 'obs%3Aasset%3Acms-facility-directory') {
  return new Request(`https://ushso.example/datasets/${id}`, { headers: { accept: 'text/html' } });
}

test('pointer flips cannot assemble one page from mixed search/SEO generations', async () => {
  const pinA = publication({ suffix: 'a', pointerSequence: 10 });
  const pinB = publication({ suffix: 'b', pointerSequence: 11 });
  const artifactA = await artifact({ publication: pinA, records: [record({ title: 'Generation A title' })] });
  const artifactB = await artifact({ publication: pinB, records: [record({ title: 'Generation B title' })] });
  let active = pinA;
  let resolutionCount = 0;
  const service = new WebDiscoverabilityService({
    canonicalSiteOrigin: SITE_ORIGIN,
    publicationResolver: {
      async resolve() {
        resolutionCount += 1;
        const resolved = active;
        active = pinB;
        return resolved;
      }
    },
    projectionRepository: createStaticSeoProjectionRepository({ artifacts: [artifactA, artifactB], canonicalSiteOrigin: SITE_ORIGIN })
  });
  const handler = createWp13WebDiscoverabilityCandidateHandler({ service });

  const first = await handler.handle(datasetRequest());
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-ushso-search-generation'), pinA.index_generation);
  assert.equal(first.headers.get('x-ushso-seo-generation'), pinA.component_generations.seo);
  const firstBody = await first.text();
  assert.match(firstBody, /Generation A title/u);
  assert.doesNotMatch(firstBody, /Generation B title/u);
  assert.match(firstBody, new RegExp(`data-publication-generation="${pinA.index_generation}"`, 'u'));
  assert.equal(resolutionCount, 1);

  const second = await handler.handle(datasetRequest());
  assert.equal(second.headers.get('x-ushso-search-generation'), pinB.index_generation);
  assert.match(await second.text(), /Generation B title/u);
  assert.equal(resolutionCount, 2);
});

test('SEO and canonical API snapshots preserve critical-field and generation parity', async () => {
  const pin = publication({ suffix: 'a', pointerSequence: 12 });
  const canonical = record();
  const projection = await artifact({ publication: pin, records: [canonical] });
  const seo = projection.records[0];
  const canonicalApiSnapshot = Object.freeze({
    generation_pins: {
      publication_manifest_id: pin.publication_manifest_id,
      search_generation_id: pin.index_generation,
      canonical_revision_manifest_id: pin.canonical_revision_manifest_id
    },
    record: canonical
  });
  assert.equal(seo.publication_pin.publication_manifest_id, canonicalApiSnapshot.generation_pins.publication_manifest_id);
  assert.equal(seo.publication_pin.search_generation_id, canonicalApiSnapshot.generation_pins.search_generation_id);
  assert.equal(seo.document.canonical_revisions[0].revision_id, canonicalApiSnapshot.record.canonical_revision.revision_id);
  assert.equal(seo.document.content.title, canonicalApiSnapshot.record.title);
  assert.equal(seo.document.content.description, canonicalApiSnapshot.record.description);
  assert.equal(seo.document.content.publisher.name, canonicalApiSnapshot.record.publisher.name);
  assert.equal(seo.document.content.access.boundary, canonicalApiSnapshot.record.access.boundary);
  assert.equal(seo.document.content.evidence_summary.status, canonicalApiSnapshot.record.evidence_summary.status);
});

test('generation-pinned sitemap shards survive an active-pointer race', async () => {
  const pinA = publication({ suffix: 'a', pointerSequence: 20 });
  const pinB = publication({ suffix: 'b', pointerSequence: 21 });
  const recordsA = [record({ id: 'obs:asset:a-one' }), record({ id: 'obs:asset:a-two' })];
  const recordsB = [record({ id: 'obs:asset:b-one' }), record({ id: 'obs:asset:b-two' })];
  const artifactA = await artifact({ publication: pinA, records: recordsA, sitemapShardMaxUrls: 1 });
  const artifactB = await artifact({ publication: pinB, records: recordsB, sitemapShardMaxUrls: 1 });
  let active = pinA;
  const service = new WebDiscoverabilityService({
    canonicalSiteOrigin: SITE_ORIGIN,
    publicationResolver: { async resolve() { return active; } },
    projectionRepository: createStaticSeoProjectionRepository({ artifacts: [artifactA, artifactB], canonicalSiteOrigin: SITE_ORIGIN })
  });
  const handler = createWp13WebDiscoverabilityCandidateHandler({ service });
  const indexResponse = await handler.handle(new Request('https://ushso.example/sitemap.xml'));
  assert.equal(indexResponse.headers.get('x-ushso-seo-generation'), pinA.component_generations.seo);
  const index = await indexResponse.text();
  const shardUrl = /<loc>(.*?)<\/loc>/u.exec(index)?.[1];
  assert.ok(shardUrl);

  active = pinB;
  const shardResponse = await handler.handle(new Request(shardUrl));
  assert.equal(shardResponse.status, 200);
  assert.equal(shardResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(shardResponse.headers.get('x-ushso-seo-generation'), pinA.component_generations.seo);
  const shard = await shardResponse.text();
  assert.match(shard, /obs%3Aasset%3Aa-/u);
  assert.doesNotMatch(shard, /obs%3Aasset%3Ab-/u);

  const unknown = await handler.handle(new Request('https://ushso.example/sitemaps/generation%3Aunknown%3Aseo/datasets-00001.xml'));
  assert.equal(unknown.status, 404);
  assert.equal(await unknown.text(), '');
});

test('explicit static rollback composition serves a sealed prior artifact without pointer or source egress', async () => {
  const prior = publication({ suffix: 'a', pointerSequence: 30 });
  const priorArtifact = await artifact({ publication: prior, records: [record({ title: 'Sealed rollback record' })] });
  const service = createStaticRollbackWebDiscoverabilityService({ canonicalSiteOrigin: SITE_ORIGIN, publication: prior, artifacts: [priorArtifact] });
  const handler = createWp13WebDiscoverabilityCandidateHandler({ service });
  const result = await handler.handle(datasetRequest());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('x-ushso-publication-manifest'), prior.publication_manifest_id);
  assert.match(await result.text(), /Sealed rollback record/u);
});

test('artifact/publication mismatch fails closed instead of crossing revisions', async () => {
  const pinA = publication({ suffix: 'a' });
  const pinB = publication({ suffix: 'b' });
  const artifactA = await artifact({ publication: pinA });
  const service = new WebDiscoverabilityService({
    canonicalSiteOrigin: SITE_ORIGIN,
    publicationResolver: { async resolve() { return pinB; } },
    projectionRepository: createStaticSeoProjectionRepository({ artifacts: [artifactA], canonicalSiteOrigin: SITE_ORIGIN })
  });
  const handler = createWp13WebDiscoverabilityCandidateHandler({ service });
  const result = await handler.handle(datasetRequest());
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('x-ushso-search-generation'), null);
  assert.doesNotMatch(await result.text(), /generation:|publication:|SEO_/u);
});
