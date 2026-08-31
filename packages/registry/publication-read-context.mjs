export const PUBLICATION_READ_CONTEXT_VERSION = 'ushso-publication-read-context.v1.0.0';

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function freezeRecord(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeRecord(child);
  }
  return Object.freeze(value);
}

/**
 * Create the one immutable semantic pin passed through every repository call in
 * a public request. This compatibility context describes the legacy v1.1.0
 * static bundle; it is intentionally not added to immutable v1 wire responses.
 */
export function createStaticPublicationReadContext(corpus) {
  if (!corpus || typeof corpus !== 'object') throw new TypeError('corpus metadata is required');
  const corpusId = requireString(corpus.corpus_id, 'corpus.corpus_id');
  const corpusVersion = requireString(corpus.corpus_version, 'corpus.corpus_version');
  const fingerprint = staticCorpusFingerprint(corpus);
  const generation = `legacy-static:${corpusVersion}:${fingerprint}`;

  return freezeRecord({
    contract_version: PUBLICATION_READ_CONTEXT_VERSION,
    publication_manifest_id: `legacy:static:${corpusVersion}:${fingerprint}`,
    canonical_revision_manifest_id: `legacy:canonical:${corpusVersion}:${fingerprint}`,
    canonical_as_of: null,
    index_generation: generation,
    coverage_snapshot_id: `legacy:coverage:unknown:${corpusVersion}`,
    component_generations: {
      asset_search: generation,
      release_distribution_search: null,
      schema_field_search: null,
      source_search: null,
      join_edge_search: generation,
      seo: null,
      coverage: null
    },
    corpus: {
      corpus_id: corpusId,
      corpus_version: corpusVersion,
      content_fingerprint_sha256: fingerprint,
      algorithm_fingerprint_sha256: corpus.algorithm_fingerprint_sha256 ?? null
    },
    storage_mode: 'legacy_static_assets',
    absence_claim_permitted: false
  });
}

export function staticCorpusFingerprint(corpus) {
  if (!corpus || typeof corpus !== 'object') throw new TypeError('corpus metadata is required');
  if (typeof corpus.manifest_sha256 === 'string' && corpus.manifest_sha256.length > 0) return corpus.manifest_sha256;
  return `fixture:${requireString(corpus.corpus_id, 'corpus.corpus_id')}:${requireString(corpus.corpus_version, 'corpus.corpus_version')}`;
}

export function assertPublicationReadContext(value) {
  if (!value || typeof value !== 'object') throw new TypeError('publication read context is required');
  if (value.contract_version !== PUBLICATION_READ_CONTEXT_VERSION) throw new TypeError('publication read context version is unsupported');
  requireString(value.publication_manifest_id, 'publication_manifest_id');
  requireString(value.canonical_revision_manifest_id, 'canonical_revision_manifest_id');
  requireString(value.index_generation, 'index_generation');
  requireString(value.coverage_snapshot_id, 'coverage_snapshot_id');
  if (value.absence_claim_permitted !== false) throw new TypeError('legacy static publication cannot permit absence claims');
  if (!Object.isFrozen(value) || !Object.isFrozen(value.component_generations) || !Object.isFrozen(value.corpus)) {
    throw new TypeError('publication read context must be deeply frozen');
  }
  return value;
}

export function assertSamePublication(expected, actual, label = 'repository result') {
  assertPublicationReadContext(expected);
  if (actual !== expected) throw new TypeError(`${label} did not preserve the request publication context`);
  return actual;
}
