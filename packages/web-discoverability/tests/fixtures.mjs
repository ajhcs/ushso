import { PUBLIC_LOCATOR_POLICY_VERSION, deepFreeze } from '../src/index.mjs';

export const SITE_ORIGIN = 'https://ushso.example';

export function publication({ suffix = 'a', pointerSequence = 1 } = {}) {
  const search = `generation:${suffix}:asset-search`;
  return deepFreeze({
    contract_version: 'ushso-publication-read-context.v1.0.0',
    publication_manifest_id: `publication:${suffix}`,
    canonical_revision_manifest_id: `canonical:${suffix}`,
    canonical_as_of: `2026-08-${suffix === 'a' ? '20' : '21'}T00:00:00Z`,
    index_generation: search,
    coverage_snapshot_id: `coverage:${suffix}`,
    component_generations: {
      asset_search: search,
      release_distribution_search: `generation:${suffix}:release`,
      schema_field_search: `generation:${suffix}:field`,
      source_search: `generation:${suffix}:source`,
      join_edge_search: `generation:${suffix}:join`,
      seo: `generation:${suffix}:seo`,
      coverage: `generation:${suffix}:coverage`
    },
    component_checksums: {
      asset_search: suffix.repeat(64),
      seo: suffix.repeat(64)
    },
    pointer_resolution: {
      sequence: pointerSequence,
      resolved_once_per_request: true,
      pointer_lookup_cache_disabled: true,
      resolved_at: '2026-08-30T00:00:00Z'
    },
    absence_claim_permitted: false
  });
}

export function record({
  id = 'obs:asset:cms-facility-directory',
  title = 'CMS Facility Directory',
  description = 'Public metadata describing Medicare-certified facilities and the documented access boundary.',
  publisherName = 'Centers for Medicare & Medicaid Services',
  dcat = true,
  dcatProfile = 'dcat-us-1.1',
  sourceUrl = 'https://data.cms.gov/provider-data/dataset/example',
  distributions = undefined,
  licenseUrl = null
} = {}) {
  const projectedDistributions = distributions ?? [{
    kind: 'download',
    name: 'CSV distribution',
    format: 'CSV',
    media_type: 'text/csv',
    access_url: sourceUrl,
    download_url: 'https://data.cms.gov/files/example.csv',
    evidence_ids: ['evidence:distribution']
  }];
  const locatorUrls = [...new Set([
    'https://www.cms.gov/',
    sourceUrl,
    licenseUrl,
    ...projectedDistributions.flatMap(item => [item.access_url, item.download_url])
  ].filter(value => value !== null))].sort();
  const evidence = ['evidence:access', 'evidence:dcat', 'evidence:description', 'evidence:distribution', 'evidence:public-locator', 'evidence:publisher', 'evidence:spatial', 'evidence:temporal'];
  return {
    public_id: id,
    visibility_state: 'public',
    lifecycle_state: 'active',
    canonical_revision: {
      canonical_id: `canonical:${id}`,
      revision_id: `revision:${id}:r1`,
      revision_sha256: 'a'.repeat(64)
    },
    title,
    description,
    publisher: {
      name: publisherName,
      canonical_url: 'https://www.cms.gov/',
      evidence_ids: ['evidence:publisher']
    },
    temporal_coverage: {
      start: '2020-01-01',
      end: '2025-12-31',
      label: '2020 through 2025 (calendar years)',
      evidence_ids: ['evidence:temporal']
    },
    spatial_coverage: [{ name: 'United States', kind: 'national', evidence_ids: ['evidence:spatial'] }],
    access: {
      classification: 'open',
      label: 'Public catalog metadata; verify the selected distribution before use',
      boundary: 'USHSO records metadata and access evidence but does not retrieve or execute the dataset.',
      evidence_state: 'documented',
      staleness_state: 'current',
      observed_at: '2026-08-19T12:00:00Z',
      evidence_ids: ['evidence:access']
    },
    distributions: projectedDistributions,
    evidence_summary: {
      status: 'documented',
      summary: 'First-party catalog metadata is documented; availability and downstream suitability require in-generation evidence.',
      observed_at: '2026-08-19T12:00:00Z',
      evidence_ids: ['evidence:description']
    },
    canonical_source_url: sourceUrl,
    license_url: licenseUrl,
    modified_at: '2026-08-18T00:00:00Z',
    dcat_us: dcat ? { profile: dcatProfile, evidence_ids: ['evidence:dcat'] } : null,
    public_locator_attestations: locatorUrls.map(url => ({
      url,
      policy_version: PUBLIC_LOCATOR_POLICY_VERSION,
      disclosure_state: 'admissible_public',
      redaction_state: 'verified_public_safe',
      verified_at: '2026-08-19T12:00:00Z',
      evidence_ids: ['evidence:public-locator']
    })),
    truth_refs: {
      evidence,
      assertions: [],
      access_observations: ['observation:access'],
      documentation: [],
      relationships: []
    }
  };
}

export function alias(aliasId = 'legacy-cms-directory', target = 'obs:asset:cms-facility-directory') {
  return {
    alias_id: aliasId,
    target_public_id: target,
    assertion_id: `assertion:alias:${aliasId}`,
    evidence_id: `evidence:alias:${aliasId}`,
    assertion_type: 'legacy_public_alias',
    state: 'accepted',
    visibility_state: 'public',
    permanent: true
  };
}

export function withdrawal(id = 'obs:asset:formerly-public') {
  return {
    public_id: id,
    lifecycle_state: 'public_withdrawn',
    disclosure_state: 'admissible_public',
    assertion_evidence_state: 'proven',
    review_status: 'reviewed',
    disclosure_approved: true,
    assertion_id: `assertion:withdrawal:${id}`,
    evidence_ids: [`evidence:prior-publication:${id}`, `evidence:withdrawal:${id}`],
    prior_publication_manifest_id: 'publication:prior',
    prior_seo_generation_id: 'generation:prior:seo',
    prior_public_document_id: `seo-document:prior:${id}`,
    prior_public_document_sha256: 'b'.repeat(64),
    withdrawn_at: '2026-08-22T00:00:00Z'
  };
}

export async function artifact({ publication: pin = publication(), siteOrigin = SITE_ORIGIN, records = [record()], aliases = [], withdrawals = [], sitemapShardMaxUrls } = {}) {
  const { buildSeoGenerationArtifact } = await import('../src/index.mjs');
  return buildSeoGenerationArtifact({
    publication: pin,
    siteOrigin,
    projectedAt: '2026-08-30T00:00:00Z',
    records,
    aliases,
    withdrawals,
    ...(sitemapShardMaxUrls === undefined ? {} : { sitemapShardMaxUrls })
  });
}
