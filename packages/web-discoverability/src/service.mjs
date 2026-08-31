import {
  WEB_DISCOVERABILITY_VERSION,
  assertSignal,
  canonicalDatasetUrl,
  deepFreeze,
  fail,
  publicId,
  siteOrigin,
  stringValue
} from './safety.mjs';
import {
  assertSeoArtifactHeader,
  assertSeoArtifactMatchesPublication,
  verifySeoArtifact
} from './projection.mjs';

export const SEO_PROJECTION_REPOSITORY_VERSION = 'ushso-seo-projection-repository.v1.0.0';
export const WEB_DISCOVERABILITY_SERVICE_VERSION = WEB_DISCOVERABILITY_VERSION;
const SESSION_OWNER = Symbol('ushso.web-discoverability.session-owner');

function hasOwn(value, key) {
  return Object.hasOwn(value, key);
}

export function assertSeoProjectionRepository(value) {
  if (!value || value.repository_version !== SEO_PROJECTION_REPOSITORY_VERSION) fail('SEO_REPOSITORY_VERSION_UNSUPPORTED');
  siteOrigin(value.canonical_site_origin);
  for (const method of ['readGeneration', 'readRetainedGeneration']) if (typeof value[method] !== 'function') fail('SEO_REPOSITORY_METHOD_REQUIRED', method);
  return value;
}

export class ImmutableSeoProjectionRepository {
  repository_version = SEO_PROJECTION_REPOSITORY_VERSION;

  constructor({ canonicalSiteOrigin, readGeneration, readRetainedGeneration }) {
    if (typeof readGeneration !== 'function' || typeof readRetainedGeneration !== 'function') fail('SEO_REPOSITORY_READER_REQUIRED');
    this.canonical_site_origin = siteOrigin(canonicalSiteOrigin);
    this.readCurrent = readGeneration;
    this.readRetained = readRetainedGeneration;
    Object.freeze(this);
  }

  async readGeneration(options) {
    assertSignal(options.signal);
    const artifact = await this.readCurrent(options);
    assertSignal(options.signal);
    return artifact;
  }

  async readRetainedGeneration(options) {
    assertSignal(options.signal);
    const candidate = await this.readRetained(options);
    assertSignal(options.signal);
    if (candidate === null) return null;
    return candidate;
  }
}

export function createStaticSeoProjectionRepository({ artifacts, canonicalSiteOrigin }) {
  if (!Array.isArray(artifacts) || artifacts.length < 1) fail('SEO_STATIC_ARTIFACT_REQUIRED');
  const expectedOrigin = siteOrigin(canonicalSiteOrigin);
  const byPublication = new Map();
  const bySeoGeneration = new Map();
  for (const artifact of artifacts) {
    assertSeoArtifactHeader(artifact);
    if (artifact.site_origin !== expectedOrigin) fail('SEO_ARTIFACT_SITE_ORIGIN_MISMATCH');
    const publicationId = artifact.publication_pin.publication_manifest_id;
    const seoGenerationId = artifact.publication_pin.seo_generation_id;
    if (byPublication.has(publicationId) || bySeoGeneration.has(seoGenerationId)) fail('SEO_STATIC_ARTIFACT_DUPLICATE');
    byPublication.set(publicationId, artifact);
    bySeoGeneration.set(seoGenerationId, artifact);
  }
  return new ImmutableSeoProjectionRepository({
    canonicalSiteOrigin: expectedOrigin,
    async readGeneration({ publication }) {
      const artifact = byPublication.get(publication.publication_manifest_id);
      if (!artifact) fail('SEO_GENERATION_UNAVAILABLE');
      return artifact;
    },
    async readRetainedGeneration({ seoGenerationId }) {
      return bySeoGeneration.get(seoGenerationId) ?? null;
    }
  });
}

export class WebDiscoverabilityService {
  service_version = WEB_DISCOVERABILITY_SERVICE_VERSION;

  constructor({ canonicalSiteOrigin, publicationResolver, projectionRepository }) {
    if (!publicationResolver || typeof publicationResolver.resolve !== 'function') fail('SEO_PUBLICATION_RESOLVER_REQUIRED');
    this.canonical_site_origin = siteOrigin(canonicalSiteOrigin);
    this.publicationResolver = publicationResolver;
    this.projectionRepository = assertSeoProjectionRepository(projectionRepository);
    if (this.projectionRepository.canonical_site_origin !== this.canonical_site_origin) fail('SEO_REPOSITORY_SITE_ORIGIN_MISMATCH');
    Object.freeze(this);
  }

  async openRequest({ request, env }) {
    if (!request || typeof request !== 'object') fail('SEO_REQUEST_REQUIRED');
    const signal = request.signal;
    assertSignal(signal);
    const publication = await this.publicationResolver.resolve({ request, env, signal });
    assertSignal(signal);
    const candidate = await this.projectionRepository.readGeneration({ publication, request, env, signal });
    const verified = await verifySeoArtifact(candidate, { canonicalSiteOrigin: this.canonical_site_origin });
    const artifact = assertSeoArtifactMatchesPublication(verified.artifact, publication);
    assertSignal(signal);
    return Object.freeze({ publication, artifact, request, env, signal, [SESSION_OWNER]: this });
  }

  #session(value) {
    if (!value || value[SESSION_OWNER] !== this) fail('SEO_SESSION_INVALID');
    assertSignal(value.signal);
    return value;
  }

  resolveDataset(session, value) {
    const { artifact } = this.#session(session);
    const id = publicId(value);
    const recordIndex = artifact.indexes.record_by_public_id[id];
    if (hasOwn(artifact.indexes.record_by_public_id, id)) return deepFreeze({ kind: 'record', record: artifact.records[recordIndex] });
    const aliasIndex = artifact.indexes.alias_by_public_id[id];
    if (hasOwn(artifact.indexes.alias_by_public_id, id)) {
      const alias = artifact.aliases[aliasIndex];
      if (!hasOwn(artifact.indexes.record_by_public_id, alias.target_public_id)
          && !hasOwn(artifact.indexes.withdrawal_by_public_id, alias.target_public_id)) fail('SEO_ALIAS_TARGET_MISSING');
      return deepFreeze({
        kind: 'redirect',
        status: 308,
        target_public_id: alias.target_public_id,
        location: canonicalDatasetUrl(this.canonical_site_origin, alias.target_public_id)
      });
    }
    const withdrawalIndex = artifact.indexes.withdrawal_by_public_id[id];
    if (hasOwn(artifact.indexes.withdrawal_by_public_id, id)) {
      return deepFreeze({
        kind: 'gone',
        canonical_url: canonicalDatasetUrl(this.canonical_site_origin, id)
      });
    }
    return deepFreeze({ kind: 'not_found' });
  }

  currentSitemap(session) {
    const { artifact } = this.#session(session);
    return deepFreeze({
      kind: artifact.sitemap.kind,
      xml: artifact.sitemap.current_xml,
      sha256: artifact.sitemap.current_sha256,
      publication_pin: artifact.publication_pin
    });
  }

  robots(session) {
    const { artifact } = this.#session(session);
    return deepFreeze({ origin: this.canonical_site_origin, publication_pin: artifact.publication_pin });
  }

  async retainedSitemapShard({ request, env, seoGenerationId, path }) {
    stringValue(seoGenerationId, 'seo_generation_id', { max: 240 });
    stringValue(path, 'sitemap_path', { max: 600 });
    const signal = request?.signal;
    assertSignal(signal);
    const candidate = await this.projectionRepository.readRetainedGeneration({ seoGenerationId, path, request, env, signal });
    assertSignal(signal);
    if (candidate === null) return deepFreeze({ kind: 'not_found' });
    const verified = await verifySeoArtifact(candidate, { canonicalSiteOrigin: this.canonical_site_origin });
    const artifact = verified.artifact;
    if (artifact.publication_pin.seo_generation_id !== seoGenerationId) fail('SEO_RETAINED_GENERATION_MISMATCH');
    const index = artifact.indexes.sitemap_shard_by_path[path];
    if (!hasOwn(artifact.indexes.sitemap_shard_by_path, path)) return deepFreeze({ kind: 'not_found' });
    const shard = artifact.sitemap.shards[index];
    if (shard.path !== path) fail('SEO_SITEMAP_SHARD_INDEX_INVALID');
    return deepFreeze({ kind: 'sitemap_shard', xml: shard.xml, sha256: shard.sha256, publication_pin: artifact.publication_pin });
  }
}

export function createStaticRollbackWebDiscoverabilityService({ canonicalSiteOrigin, publication, artifacts }) {
  const projectionRepository = createStaticSeoProjectionRepository({ artifacts, canonicalSiteOrigin });
  const publicationResolver = Object.freeze({
    async resolve() {
      return publication;
    }
  });
  return new WebDiscoverabilityService({ canonicalSiteOrigin, publicationResolver, projectionRepository });
}
