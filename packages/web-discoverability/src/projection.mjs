import {
  LIMITS,
  SEO_ARTIFACT_VERSION,
  SEO_RECORD_DOCUMENT_VERSION,
  assertByteLimit,
  assertDeepFrozen,
  assertExactKeys,
  canonicalDatasetUrl,
  canonicalJson,
  deepFreeze,
  fail,
  identifierValue,
  nullableDate,
  nullableString,
  publicId,
  safePublicHttpsUrl,
  sha256Hex,
  sha256Value,
  siteOrigin as normalizeSiteOrigin,
  sortedUniqueStrings,
  stringValue,
  utcTimestamp,
  utf8Bytes,
  xmlText
} from './safety.mjs';
import { renderDatasetHtml, sitemapIndex, sitemapUrlset } from './render.mjs';

const PUBLICATION_CONTEXT_VERSION = 'ushso-publication-read-context.v1.0.0';
const ACCESS_CLASSIFICATIONS = new Set(['open', 'restricted', 'application', 'paid', 'report_only', 'unknown']);
const EVIDENCE_STATES = new Set(['unknown', 'candidate', 'ambiguous', 'documented', 'observed', 'executed', 'proven', 'source_asserted', 'verified_first_party', 'unavailable']);
const STALENESS_STATES = new Set(['current', 'stale', 'unknown', 'not_applicable']);
const EVIDENCE_SUMMARY_STATES = new Set(['documented', 'observed', 'verified_first_party', 'source_asserted', 'stale', 'unknown']);
const SPATIAL_KINDS = new Set(['country', 'state', 'territory', 'county', 'place', 'region', 'national', 'other', 'unknown']);
const DISTRIBUTION_KINDS = new Set(['download', 'api', 'landing_page', 'documentation', 'other']);
export const PUBLIC_LOCATOR_POLICY_VERSION = 'ushso-public-locator-redaction.v1.0.0';
const DCAT_PROFILES = Object.freeze({
  'dcat-us-1.1': 'https://resources.data.gov/resources/dcat-us/',
  'dcat-3': 'https://www.w3.org/TR/2024/REC-vocab-dcat-3-20240822/'
});

function enumValue(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.has(value)) fail('SEO_ENUM_INVALID', label);
  return value;
}

function publicationPin(publication) {
  if (!publication || typeof publication !== 'object') fail('SEO_PUBLICATION_REQUIRED');
  if (publication.contract_version !== PUBLICATION_CONTEXT_VERSION) fail('SEO_PUBLICATION_VERSION_UNSUPPORTED');
  for (const field of ['publication_manifest_id', 'canonical_revision_manifest_id', 'index_generation', 'coverage_snapshot_id']) {
    identifierValue(publication[field], `publication.${field}`);
  }
  if (!publication.component_generations || typeof publication.component_generations !== 'object') fail('SEO_PUBLICATION_COMPONENTS_REQUIRED');
  const searchGeneration = identifierValue(publication.component_generations.asset_search, 'publication.component_generations.asset_search');
  const seoGeneration = identifierValue(publication.component_generations.seo, 'publication.component_generations.seo');
  if (publication.index_generation !== searchGeneration) fail('SEO_SEARCH_GENERATION_MISMATCH');
  if (!Object.isFrozen(publication) || !Object.isFrozen(publication.component_generations)) fail('SEO_PUBLICATION_NOT_FROZEN');
  const canonicalAsOf = utcTimestamp(publication.canonical_as_of, 'publication.canonical_as_of');
  const pointer = publication.pointer_resolution ?? null;
  if (pointer !== null && pointer.resolved_once_per_request !== true) fail('SEO_POINTER_RESOLUTION_POLICY_INVALID');
  return deepFreeze({
    contract_version: publication.contract_version,
    publication_manifest_id: publication.publication_manifest_id,
    canonical_revision_manifest_id: publication.canonical_revision_manifest_id,
    canonical_as_of: canonicalAsOf,
    search_generation_id: searchGeneration,
    seo_generation_id: seoGeneration,
    coverage_snapshot_id: publication.coverage_snapshot_id,
    seo_generation_checksum: publication.component_checksums?.seo ?? null
  });
}

function evidenceIds(value, label, { minItems = 1 } = {}) {
  const values = sortedUniqueStrings(value, label, { minItems, maxItems: LIMITS.maxEvidenceIds, maxChars: 240 });
  return values.map((item, index) => identifierValue(item, `${label}[${index}]`));
}

function canonicalRevision(value, label) {
  assertExactKeys(value, ['canonical_id', 'revision_id', 'revision_sha256'], [], label);
  return {
    canonical_id: identifierValue(value.canonical_id, `${label}.canonical_id`),
    revision_id: identifierValue(value.revision_id, `${label}.revision_id`),
    revision_sha256: sha256Value(value.revision_sha256, `${label}.revision_sha256`)
  };
}

function publisher(value, label) {
  assertExactKeys(value, ['name', 'canonical_url', 'evidence_ids'], [], label);
  return {
    name: stringValue(value.name, `${label}.name`, { max: LIMITS.maxPublisherChars }),
    canonical_url: value.canonical_url === null ? null : safePublicHttpsUrl(value.canonical_url, `${label}.canonical_url`),
    evidence_ids: evidenceIds(value.evidence_ids, `${label}.evidence_ids`)
  };
}

function temporalCoverage(value, label) {
  if (value === null) return null;
  assertExactKeys(value, ['start', 'end', 'label', 'evidence_ids'], [], label);
  const start = nullableDate(value.start, `${label}.start`);
  const end = nullableDate(value.end, `${label}.end`);
  if (start && end && start > end) fail('SEO_TEMPORAL_RANGE_INVALID', label);
  return {
    start,
    end,
    label: stringValue(value.label, `${label}.label`, { max: LIMITS.maxCoverageLabelChars }),
    evidence_ids: evidenceIds(value.evidence_ids, `${label}.evidence_ids`)
  };
}

function spatialCoverage(value, label) {
  if (!Array.isArray(value) || value.length > LIMITS.maxSpatialCoverageItems) fail('SEO_SPATIAL_COVERAGE_INVALID', label);
  const items = value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(item, ['name', 'kind', 'evidence_ids'], [], itemLabel);
    return {
      name: stringValue(item.name, `${itemLabel}.name`, { max: LIMITS.maxCoverageLabelChars }),
      kind: enumValue(item.kind, SPATIAL_KINDS, `${itemLabel}.kind`),
      evidence_ids: evidenceIds(item.evidence_ids, `${itemLabel}.evidence_ids`)
    };
  }).sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
  const keys = items.map(item => `${item.kind}\u0000${item.name}`);
  if (new Set(keys).size !== keys.length) fail('SEO_SPATIAL_COVERAGE_DUPLICATE', label);
  return items;
}

function access(value, label) {
  assertExactKeys(value, ['classification', 'label', 'boundary', 'evidence_state', 'staleness_state', 'observed_at', 'evidence_ids'], [], label);
  return {
    classification: enumValue(value.classification, ACCESS_CLASSIFICATIONS, `${label}.classification`),
    label: stringValue(value.label, `${label}.label`, { max: LIMITS.maxAccessLabelChars }),
    boundary: stringValue(value.boundary, `${label}.boundary`, { max: LIMITS.maxEvidenceSummaryChars }),
    evidence_state: enumValue(value.evidence_state, EVIDENCE_STATES, `${label}.evidence_state`),
    staleness_state: enumValue(value.staleness_state, STALENESS_STATES, `${label}.staleness_state`),
    observed_at: utcTimestamp(value.observed_at, `${label}.observed_at`),
    evidence_ids: evidenceIds(value.evidence_ids, `${label}.evidence_ids`)
  };
}

function distributions(value, label) {
  if (!Array.isArray(value) || value.length > LIMITS.maxDistributions) fail('SEO_DISTRIBUTIONS_INVALID', label);
  const items = value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(item, ['kind', 'name', 'format', 'media_type', 'access_url', 'download_url', 'evidence_ids'], [], itemLabel);
    const accessUrl = item.access_url === null ? null : safePublicHttpsUrl(item.access_url, `${itemLabel}.access_url`);
    const downloadUrl = item.download_url === null ? null : safePublicHttpsUrl(item.download_url, `${itemLabel}.download_url`);
    if (accessUrl === null && downloadUrl === null) fail('SEO_DISTRIBUTION_URL_REQUIRED', itemLabel);
    const kind = enumValue(item.kind, DISTRIBUTION_KINDS, `${itemLabel}.kind`);
    if (kind === 'download' && downloadUrl === null) fail('SEO_DISTRIBUTION_DOWNLOAD_URL_REQUIRED', itemLabel);
    return {
      kind,
      name: stringValue(item.name, `${itemLabel}.name`, { max: 300 }),
      format: nullableString(item.format, `${itemLabel}.format`, { max: 120 }),
      media_type: nullableString(item.media_type, `${itemLabel}.media_type`, { max: 160 }),
      access_url: accessUrl,
      download_url: downloadUrl,
      evidence_ids: evidenceIds(item.evidence_ids, `${itemLabel}.evidence_ids`)
    };
  }).sort((left, right) => (left.access_url ?? left.download_url).localeCompare(right.access_url ?? right.download_url) || left.name.localeCompare(right.name));
  const keys = items.map(item => `${item.kind}\u0000${item.access_url ?? ''}\u0000${item.download_url ?? ''}\u0000${item.name}`);
  if (new Set(keys).size !== keys.length) fail('SEO_DISTRIBUTION_DUPLICATE', label);
  return items;
}

function evidenceSummary(value, label) {
  assertExactKeys(value, ['status', 'summary', 'observed_at', 'evidence_ids'], [], label);
  return {
    status: enumValue(value.status, EVIDENCE_SUMMARY_STATES, `${label}.status`),
    summary: stringValue(value.summary, `${label}.summary`, { max: LIMITS.maxEvidenceSummaryChars }),
    observed_at: utcTimestamp(value.observed_at, `${label}.observed_at`),
    evidence_ids: evidenceIds(value.evidence_ids, `${label}.evidence_ids`)
  };
}

function dcatUs(value, label) {
  if (value === null) return null;
  assertExactKeys(value, ['profile', 'evidence_ids'], [], label);
  const profile = stringValue(value.profile, `${label}.profile`, { max: 50 });
  if (!Object.hasOwn(DCAT_PROFILES, profile)) fail('SEO_DCAT_PROFILE_UNSUPPORTED', profile);
  return {
    profile,
    profile_url: DCAT_PROFILES[profile],
    evidence_ids: evidenceIds(value.evidence_ids, `${label}.evidence_ids`)
  };
}

function publicLocatorAttestations(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.maxPublicLocatorAttestations) {
    fail('SEO_PUBLIC_LOCATOR_ATTESTATIONS_INVALID', label);
  }
  const attestations = value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(item, [
      'url', 'policy_version', 'disclosure_state', 'redaction_state', 'verified_at', 'evidence_ids'
    ], [], itemLabel);
    if (item.policy_version !== PUBLIC_LOCATOR_POLICY_VERSION) fail('SEO_PUBLIC_LOCATOR_POLICY_UNSUPPORTED', itemLabel);
    if (item.disclosure_state !== 'admissible_public') fail('SEO_PUBLIC_LOCATOR_DISCLOSURE_INVALID', itemLabel);
    if (item.redaction_state !== 'verified_public_safe') fail('SEO_PUBLIC_LOCATOR_REDACTION_INVALID', itemLabel);
    return {
      url: safePublicHttpsUrl(item.url, `${itemLabel}.url`),
      policy_version: PUBLIC_LOCATOR_POLICY_VERSION,
      disclosure_state: 'admissible_public',
      redaction_state: 'verified_public_safe',
      verified_at: utcTimestamp(item.verified_at, `${itemLabel}.verified_at`),
      evidence_ids: evidenceIds(item.evidence_ids, `${itemLabel}.evidence_ids`)
    };
  }).sort((left, right) => left.url.localeCompare(right.url));
  const urls = attestations.map(item => item.url);
  if (new Set(urls).size !== urls.length) fail('SEO_PUBLIC_LOCATOR_DUPLICATE', label);
  return attestations;
}

function assertedPublicLocatorUrls(content) {
  return sortedUniqueStrings([...new Set([
    content.publisher.canonical_url,
    content.canonical_source_url,
    content.license_url,
    ...content.distributions.flatMap(item => [item.access_url, item.download_url])
  ].filter(value => value !== null))], 'public_locator_urls', {
    minItems: 1,
    maxItems: LIMITS.maxPublicLocatorAttestations,
    maxChars: LIMITS.maxUrlChars
  });
}

function assertPublicLocatorCoverage(content, label) {
  const asserted = assertedPublicLocatorUrls(content);
  const attested = content.public_locator_attestations.map(item => item.url);
  if (canonicalJson(asserted) !== canonicalJson(attested)) fail('SEO_PUBLIC_LOCATOR_COVERAGE_MISMATCH', label);
}

function truthRefs(value, label) {
  assertExactKeys(value, ['evidence', 'assertions', 'access_observations', 'documentation', 'relationships'], [], label);
  return {
    evidence: evidenceIds(value.evidence, `${label}.evidence`, { minItems: 1 }),
    assertions: evidenceIds(value.assertions, `${label}.assertions`, { minItems: 0 }),
    access_observations: evidenceIds(value.access_observations, `${label}.access_observations`, { minItems: 1 }),
    documentation: evidenceIds(value.documentation, `${label}.documentation`, { minItems: 0 }),
    relationships: evidenceIds(value.relationships, `${label}.relationships`, { minItems: 0 })
  };
}

function assertFactEvidence(content, truth, label) {
  const permitted = new Set(Object.values(truth).flat());
  const claimed = [
    ...content.publisher.evidence_ids,
    ...(content.temporal_coverage?.evidence_ids ?? []),
    ...content.spatial_coverage.flatMap(item => item.evidence_ids),
    ...content.access.evidence_ids,
    ...content.distributions.flatMap(item => item.evidence_ids),
    ...content.evidence_summary.evidence_ids,
    ...(content.dcat_us?.evidence_ids ?? []),
    ...content.public_locator_attestations.flatMap(item => item.evidence_ids)
  ];
  for (const evidenceId of claimed) if (!permitted.has(evidenceId)) fail('SEO_FACT_EVIDENCE_UNPINNED', `${label}:${evidenceId}`);
}

function normalizedRecord(value, origin, label) {
  assertExactKeys(value, [
    'public_id', 'visibility_state', 'lifecycle_state', 'canonical_revision', 'title', 'description',
    'publisher', 'temporal_coverage', 'spatial_coverage', 'access', 'distributions',
    'evidence_summary', 'canonical_source_url', 'license_url', 'modified_at', 'dcat_us',
    'public_locator_attestations', 'truth_refs'
  ], [], label);
  if (value.visibility_state !== 'public') fail('SEO_RECORD_NOT_PUBLIC', label);
  if (!['active', 'superseded'].includes(value.lifecycle_state)) fail('SEO_RECORD_LIFECYCLE_INELIGIBLE', label);
  const id = publicId(value.public_id, `${label}.public_id`);
  const truth = truthRefs(value.truth_refs, `${label}.truth_refs`);
  const content = {
    content_version: SEO_RECORD_DOCUMENT_VERSION,
    public_id: id,
    canonical_url: canonicalDatasetUrl(origin, id),
    lifecycle_state: value.lifecycle_state,
    title: stringValue(value.title, `${label}.title`, { max: LIMITS.maxTitleChars }),
    description: stringValue(value.description, `${label}.description`, { max: LIMITS.maxDescriptionChars }),
    publisher: publisher(value.publisher, `${label}.publisher`),
    temporal_coverage: temporalCoverage(value.temporal_coverage, `${label}.temporal_coverage`),
    spatial_coverage: spatialCoverage(value.spatial_coverage, `${label}.spatial_coverage`),
    access: access(value.access, `${label}.access`),
    distributions: distributions(value.distributions, `${label}.distributions`),
    evidence_summary: evidenceSummary(value.evidence_summary, `${label}.evidence_summary`),
    canonical_source_url: safePublicHttpsUrl(value.canonical_source_url, `${label}.canonical_source_url`),
    license_url: value.license_url === null ? null : safePublicHttpsUrl(value.license_url, `${label}.license_url`),
    modified_at: value.modified_at === null ? null : utcTimestamp(value.modified_at, `${label}.modified_at`),
    dcat_us: dcatUs(value.dcat_us, `${label}.dcat_us`),
    public_locator_attestations: publicLocatorAttestations(value.public_locator_attestations, `${label}.public_locator_attestations`)
  };
  assertPublicLocatorCoverage(content, label);
  assertFactEvidence(content, truth, label);
  return { id, revision: canonicalRevision(value.canonical_revision, `${label}.canonical_revision`), content, truth };
}

async function recordDocument(value, { origin, pin, projectedAt }, index) {
  const normalized = normalizedRecord(value, origin, `records[${index}]`);
  const identityHash = await sha256Hex(`${pin.seo_generation_id}\u0000${normalized.id}`);
  const material = {
    projection_version: 'projection-document.v1',
    document_id: `seo-document:${identityHash}`,
    document_type: 'seo',
    projection_schema_version: '1.0.0',
    generation_id: pin.seo_generation_id,
    projected_at: projectedAt,
    canonical_revisions: [normalized.revision],
    projection_input_refs: [normalized.revision.revision_id],
    visibility_state: 'public',
    truth_refs: normalized.truth,
    content: normalized.content,
    source_of_truth: false,
    immutable: true
  };
  const checksum = await sha256Hex(canonicalJson(material));
  const document = deepFreeze({
    ...material,
    document_checksum: {
      algorithm: 'sha256',
      canonicalization: 'ushso-canonical-json-v1',
      domain: 'projection_document',
      value: checksum
    }
  });
  const renderable = {
    public_id: normalized.id,
    document,
    publication_pin: pin
  };
  const html = renderDatasetHtml(renderable);
  return deepFreeze({
    ...renderable,
    render_receipt: {
      renderer_version: 'ushso-seo-html.v1.0.0',
      html_bytes: utf8Bytes(html),
      html_sha256: await sha256Hex(html)
    }
  });
}

function normalizedAlias(value, label) {
  assertExactKeys(value, ['alias_id', 'target_public_id', 'assertion_id', 'evidence_id', 'assertion_type', 'state', 'visibility_state', 'permanent'], [], label);
  if (value.assertion_type !== 'legacy_public_alias' || value.state !== 'accepted' || value.visibility_state !== 'public' || value.permanent !== true) {
    fail('SEO_ALIAS_NOT_ADMISSIBLE', label);
  }
  return {
    alias_id: publicId(value.alias_id, `${label}.alias_id`),
    target_public_id: publicId(value.target_public_id, `${label}.target_public_id`),
    assertion_id: identifierValue(value.assertion_id, `${label}.assertion_id`),
    evidence_id: identifierValue(value.evidence_id, `${label}.evidence_id`),
    assertion_type: 'legacy_public_alias',
    state: 'accepted',
    visibility_state: 'public',
    permanent: true
  };
}

function normalizedWithdrawal(value, label) {
  assertExactKeys(value, [
    'public_id', 'lifecycle_state', 'disclosure_state', 'assertion_evidence_state', 'review_status',
    'disclosure_approved', 'assertion_id', 'evidence_ids', 'prior_publication_manifest_id',
    'prior_seo_generation_id', 'prior_public_document_id', 'prior_public_document_sha256', 'withdrawn_at'
  ], [], label);
  if (value.lifecycle_state !== 'public_withdrawn' || value.disclosure_state !== 'admissible_public'
      || value.assertion_evidence_state !== 'proven' || value.review_status !== 'reviewed' || value.disclosure_approved !== true) {
    fail('SEO_WITHDRAWAL_NOT_DISCLOSABLE', label);
  }
  return {
    public_id: publicId(value.public_id, `${label}.public_id`),
    lifecycle_state: 'public_withdrawn',
    disclosure_state: 'admissible_public',
    assertion_evidence_state: 'proven',
    review_status: 'reviewed',
    disclosure_approved: true,
    assertion_id: identifierValue(value.assertion_id, `${label}.assertion_id`),
    evidence_ids: evidenceIds(value.evidence_ids, `${label}.evidence_ids`),
    prior_publication_manifest_id: identifierValue(value.prior_publication_manifest_id, `${label}.prior_publication_manifest_id`),
    prior_seo_generation_id: identifierValue(value.prior_seo_generation_id, `${label}.prior_seo_generation_id`),
    prior_public_document_id: identifierValue(value.prior_public_document_id, `${label}.prior_public_document_id`),
    prior_public_document_sha256: sha256Value(value.prior_public_document_sha256, `${label}.prior_public_document_sha256`),
    withdrawn_at: utcTimestamp(value.withdrawn_at, `${label}.withdrawn_at`)
  };
}

function sitemapChunks(urls, lastModified, maxUrls) {
  if (urls.length === 0) return [[]];
  const prefix = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  const suffix = '\n</urlset>\n';
  const overheadBytes = utf8Bytes(prefix) + utf8Bytes(suffix);
  const chunks = [];
  let current = [];
  let currentBytes = overheadBytes;
  for (const url of urls) {
    const line = `  <url><loc>${xmlText(url)}</loc><lastmod>${xmlText(lastModified)}</lastmod></url>`;
    const addedBytes = utf8Bytes(line) + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && (current.length >= maxUrls || currentBytes + addedBytes > LIMITS.sitemapShardMaxBytes)) {
      chunks.push(current);
      current = [url];
      currentBytes = overheadBytes + utf8Bytes(line);
      if (currentBytes > LIMITS.sitemapShardMaxBytes) fail('SEO_SITEMAP_URL_TOO_LARGE');
    } else {
      current.push(url);
      currentBytes += addedBytes;
      if (currentBytes > LIMITS.sitemapShardMaxBytes) fail('SEO_SITEMAP_URL_TOO_LARGE');
    }
  }
  chunks.push(current);
  if (chunks.length > LIMITS.maxSitemapShards) fail('SEO_SITEMAP_SHARD_COUNT_EXCEEDED');
  return chunks;
}

async function buildSitemap(records, origin, pin, maxUrls) {
  const urls = records.map(record => record.document.content.canonical_url);
  const lastModified = pin.canonical_as_of.slice(0, 10);
  const chunks = sitemapChunks(urls, lastModified, maxUrls);
  if (chunks.length === 1) {
    const xml = sitemapUrlset(chunks[0], lastModified);
    return deepFreeze({
      kind: 'urlset',
      current_path: '/sitemap.xml',
      current_xml: xml,
      current_sha256: await sha256Hex(xml),
      url_count: urls.length,
      shards: []
    });
  }
  const generationSegment = encodeURIComponent(pin.seo_generation_id);
  const shards = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const path = `/sitemaps/${generationSegment}/datasets-${String(index + 1).padStart(5, '0')}.xml`;
    const xml = sitemapUrlset(chunks[index], lastModified);
    shards.push({
      path,
      url: `${origin}${path}`,
      xml,
      sha256: await sha256Hex(xml),
      url_count: chunks[index].length
    });
  }
  const currentXml = sitemapIndex(shards.map(shard => shard.url), lastModified);
  assertByteLimit(currentXml, LIMITS.sitemapIndexMaxBytes, 'SEO_SITEMAP_INDEX_BYTES_EXCEEDED');
  return deepFreeze({
    kind: 'index',
    current_path: '/sitemap.xml',
    current_xml: currentXml,
    current_sha256: await sha256Hex(currentXml),
    url_count: urls.length,
    shards
  });
}

export async function buildSeoGenerationArtifact({
  publication,
  siteOrigin,
  projectedAt,
  records,
  aliases = [],
  withdrawals = [],
  sitemapShardMaxUrls = LIMITS.sitemapShardMaxUrls
}) {
  const pin = publicationPin(publication);
  const origin = normalizeSiteOrigin(siteOrigin);
  utcTimestamp(projectedAt, 'projected_at');
  if (!Array.isArray(records) || records.length > LIMITS.maxRecords) fail('SEO_RECORD_COUNT_EXCEEDED');
  if (!Array.isArray(aliases) || aliases.length > LIMITS.maxAliases) fail('SEO_ALIAS_COUNT_EXCEEDED');
  if (!Array.isArray(withdrawals) || withdrawals.length > LIMITS.maxWithdrawals) fail('SEO_WITHDRAWAL_COUNT_EXCEEDED');
  if (!Number.isSafeInteger(sitemapShardMaxUrls) || sitemapShardMaxUrls < 1 || sitemapShardMaxUrls > LIMITS.sitemapShardMaxUrls) {
    fail('SEO_SITEMAP_SHARD_LIMIT_INVALID');
  }
  const projectedRecords = [];
  let componentBytes = 0;
  for (let index = 0; index < records.length; index += 1) {
    const projected = await recordDocument(records[index], { origin, pin, projectedAt }, index);
    componentBytes += utf8Bytes(canonicalJson(projected));
    if (componentBytes > LIMITS.maxArtifactBytes / 2) fail('SEO_ARTIFACT_COMPONENT_BYTES_EXCEEDED');
    projectedRecords.push(projected);
  }
  projectedRecords.sort((left, right) => left.public_id.localeCompare(right.public_id));
  const recordIds = projectedRecords.map(record => record.public_id);
  if (new Set(recordIds).size !== recordIds.length) fail('SEO_PUBLIC_ID_DUPLICATE');
  const recordIdSet = new Set(recordIds);

  const projectedAliases = [];
  for (let index = 0; index < aliases.length; index += 1) {
    const projected = normalizedAlias(aliases[index], `aliases[${index}]`);
    componentBytes += utf8Bytes(canonicalJson(projected));
    if (componentBytes > LIMITS.maxArtifactBytes / 2) fail('SEO_ARTIFACT_COMPONENT_BYTES_EXCEEDED');
    projectedAliases.push(projected);
  }
  projectedAliases.sort((left, right) => left.alias_id.localeCompare(right.alias_id));
  const aliasIds = projectedAliases.map(alias => alias.alias_id);
  if (new Set(aliasIds).size !== aliasIds.length) fail('SEO_ALIAS_DUPLICATE');
  for (const alias of projectedAliases) {
    if (recordIdSet.has(alias.alias_id) || alias.alias_id === alias.target_public_id) fail('SEO_ALIAS_TARGET_INVALID', alias.alias_id);
  }

  const projectedWithdrawals = [];
  for (let index = 0; index < withdrawals.length; index += 1) {
    const projected = normalizedWithdrawal(withdrawals[index], `withdrawals[${index}]`);
    componentBytes += utf8Bytes(canonicalJson(projected));
    if (componentBytes > LIMITS.maxArtifactBytes / 2) fail('SEO_ARTIFACT_COMPONENT_BYTES_EXCEEDED');
    projectedWithdrawals.push(projected);
  }
  projectedWithdrawals.sort((left, right) => left.public_id.localeCompare(right.public_id));
  const withdrawalIds = projectedWithdrawals.map(withdrawal => withdrawal.public_id);
  if (new Set(withdrawalIds).size !== withdrawalIds.length) fail('SEO_WITHDRAWAL_DUPLICATE');
  const aliasIdSet = new Set(aliasIds);
  const withdrawalIdSet = new Set(withdrawalIds);
  for (const alias of projectedAliases) {
    if (!recordIdSet.has(alias.target_public_id) && !withdrawalIdSet.has(alias.target_public_id)) fail('SEO_ALIAS_TARGET_INVALID', alias.alias_id);
  }
  for (const withdrawal of projectedWithdrawals) {
    if (recordIdSet.has(withdrawal.public_id) || aliasIdSet.has(withdrawal.public_id)) fail('SEO_LIFECYCLE_COLLISION', withdrawal.public_id);
    if (withdrawal.prior_publication_manifest_id === pin.publication_manifest_id || withdrawal.prior_seo_generation_id === pin.seo_generation_id) {
      fail('SEO_WITHDRAWAL_PRIOR_PUBLICATION_INVALID', withdrawal.public_id);
    }
  }

  const sitemap = await buildSitemap(projectedRecords, origin, pin, sitemapShardMaxUrls);
  if (sitemap.url_count !== projectedRecords.length) fail('SEO_SITEMAP_RECONCILIATION_FAILED');
  const indexes = deepFreeze({
    record_by_public_id: Object.fromEntries(projectedRecords.map((record, index) => [record.public_id, index])),
    alias_by_public_id: Object.fromEntries(projectedAliases.map((alias, index) => [alias.alias_id, index])),
    withdrawal_by_public_id: Object.fromEntries(projectedWithdrawals.map((withdrawal, index) => [withdrawal.public_id, index])),
    sitemap_shard_by_path: Object.fromEntries(sitemap.shards.map((shard, index) => [shard.path, index]))
  });
  const material = {
    artifact_version: SEO_ARTIFACT_VERSION,
    site_origin: origin,
    projected_at: projectedAt,
    publication_pin: pin,
    records: projectedRecords,
    aliases: projectedAliases,
    withdrawals: projectedWithdrawals,
    sitemap,
    indexes,
    source_of_truth: false,
    immutable: true
  };
  const serializedMaterial = canonicalJson(material);
  assertByteLimit(serializedMaterial, LIMITS.maxArtifactBytes, 'SEO_ARTIFACT_BYTES_EXCEEDED');
  const artifactDigest = await sha256Hex(serializedMaterial);
  return deepFreeze({
    ...material,
    artifact_digest: {
      algorithm: 'sha256',
      canonicalization: 'ushso-canonical-json-v1',
      domain: 'seo_generation_artifact',
      value: artifactDigest
    }
  });
}

function assertDigestDescriptor(value, domain, label) {
  assertExactKeys(value, ['algorithm', 'canonicalization', 'domain', 'value'], [], label);
  if (value.algorithm !== 'sha256' || value.canonicalization !== 'ushso-canonical-json-v1' || value.domain !== domain) {
    fail('SEO_DIGEST_DESCRIPTOR_INVALID', label);
  }
  sha256Value(value.value, `${label}.value`);
  return value;
}

async function assertDigestMatches(actual, material, code) {
  const recomputed = await sha256Hex(typeof material === 'string' ? material : canonicalJson(material));
  if (actual !== recomputed) fail(code);
  return recomputed;
}

function sourceRecordFromProjected(record, index) {
  const label = `artifact.records[${index}]`;
  if (!record || !record.document || !record.document.content) fail('SEO_ARTIFACT_RECORD_INVALID', label);
  if (!Array.isArray(record.document.canonical_revisions) || record.document.canonical_revisions.length !== 1) {
    fail('SEO_ARTIFACT_CANONICAL_REVISION_INVALID', label);
  }
  const content = record.document.content;
  return {
    public_id: record.public_id,
    visibility_state: record.document.visibility_state,
    lifecycle_state: content.lifecycle_state,
    canonical_revision: record.document.canonical_revisions[0],
    title: content.title,
    description: content.description,
    publisher: content.publisher,
    temporal_coverage: content.temporal_coverage,
    spatial_coverage: content.spatial_coverage,
    access: content.access,
    distributions: content.distributions,
    evidence_summary: content.evidence_summary,
    canonical_source_url: content.canonical_source_url,
    license_url: content.license_url,
    modified_at: content.modified_at,
    dcat_us: content.dcat_us === null ? null : {
      profile: content.dcat_us.profile,
      evidence_ids: content.dcat_us.evidence_ids
    },
    public_locator_attestations: content.public_locator_attestations,
    truth_refs: record.document.truth_refs
  };
}

function publicationFromPin(pin) {
  return deepFreeze({
    contract_version: pin.contract_version,
    publication_manifest_id: pin.publication_manifest_id,
    canonical_revision_manifest_id: pin.canonical_revision_manifest_id,
    canonical_as_of: pin.canonical_as_of,
    index_generation: pin.search_generation_id,
    coverage_snapshot_id: pin.coverage_snapshot_id,
    component_generations: {
      asset_search: pin.search_generation_id,
      seo: pin.seo_generation_id
    },
    component_checksums: {
      seo: pin.seo_generation_checksum
    },
    pointer_resolution: null
  });
}

function inferredSitemapShardLimit(sitemap) {
  if (sitemap.kind !== 'index') return LIMITS.sitemapShardMaxUrls;
  if (!Array.isArray(sitemap.shards) || sitemap.shards.length < 2) fail('SEO_SITEMAP_SHAPE_INVALID');
  return Math.max(...sitemap.shards.map(shard => shard.url_count));
}

export async function verifySeoArtifact(artifact, { canonicalSiteOrigin }) {
  assertSeoArtifact(artifact);
  const expectedOrigin = normalizeSiteOrigin(canonicalSiteOrigin);
  if (artifact.site_origin !== expectedOrigin) fail('SEO_ARTIFACT_SITE_ORIGIN_MISMATCH');

  assertDigestDescriptor(artifact.artifact_digest, 'seo_generation_artifact', 'artifact.artifact_digest');
  const { artifact_digest: artifactDigest, ...artifactMaterial } = artifact;
  await assertDigestMatches(artifactDigest.value, artifactMaterial, 'SEO_ARTIFACT_DIGEST_MISMATCH');

  for (const [index, record] of artifact.records.entries()) {
    const label = `artifact.records[${index}]`;
    assertDigestDescriptor(record.document.document_checksum, 'projection_document', `${label}.document.document_checksum`);
    const { document_checksum: documentChecksum, ...documentMaterial } = record.document;
    await assertDigestMatches(documentChecksum.value, documentMaterial, 'SEO_DOCUMENT_DIGEST_MISMATCH');
    assertExactKeys(record.render_receipt, ['renderer_version', 'html_bytes', 'html_sha256'], [], `${label}.render_receipt`);
    const html = renderDatasetHtml(record);
    if (record.render_receipt.renderer_version !== 'ushso-seo-html.v1.0.0'
        || record.render_receipt.html_bytes !== utf8Bytes(html)) fail('SEO_RENDER_RECEIPT_MISMATCH', label);
    await assertDigestMatches(record.render_receipt.html_sha256, html, 'SEO_RENDER_DIGEST_MISMATCH');
  }

  await assertDigestMatches(artifact.sitemap.current_sha256, artifact.sitemap.current_xml, 'SEO_SITEMAP_DIGEST_MISMATCH');
  for (const shard of artifact.sitemap.shards) {
    await assertDigestMatches(shard.sha256, shard.xml, 'SEO_SITEMAP_SHARD_DIGEST_MISMATCH');
  }

  const rebuilt = await buildSeoGenerationArtifact({
    publication: publicationFromPin(artifact.publication_pin),
    siteOrigin: expectedOrigin,
    projectedAt: artifact.projected_at,
    records: artifact.records.map(sourceRecordFromProjected),
    aliases: artifact.aliases,
    withdrawals: artifact.withdrawals,
    sitemapShardMaxUrls: inferredSitemapShardLimit(artifact.sitemap)
  });
  if (canonicalJson(rebuilt) !== canonicalJson(artifact)) fail('SEO_ARTIFACT_SEMANTIC_MISMATCH');
  return deepFreeze({
    artifact: rebuilt,
    verification_receipt: {
      verification_version: 'ushso-seo-artifact-read-verification.v1.0.0',
      artifact_sha256: rebuilt.artifact_digest.value,
      verified_document_count: rebuilt.records.length,
      verified_render_count: rebuilt.records.length,
      verified_sitemap_count: 1 + rebuilt.sitemap.shards.length,
      canonical_site_origin: expectedOrigin
    }
  });
}

export function assertSeoArtifactMatchesPublication(artifact, publication) {
  assertSeoArtifactHeader(artifact);
  const pin = publicationPin(publication);
  for (const field of ['publication_manifest_id', 'canonical_revision_manifest_id', 'canonical_as_of', 'search_generation_id', 'seo_generation_id', 'coverage_snapshot_id', 'seo_generation_checksum']) {
    if (artifact.publication_pin?.[field] !== pin[field]) fail('SEO_ARTIFACT_PUBLICATION_MISMATCH', field);
  }
  return artifact;
}

export function assertSeoArtifactHeader(artifact) {
  if (!artifact || artifact.artifact_version !== SEO_ARTIFACT_VERSION || artifact.immutable !== true || !Object.isFrozen(artifact)) fail('SEO_ARTIFACT_INVALID');
  assertDeepFrozen(artifact, 'artifact');
  if (!artifact.publication_pin || typeof artifact.publication_pin.seo_generation_id !== 'string') fail('SEO_ARTIFACT_PIN_INVALID');
  if (!Array.isArray(artifact.records) || !Array.isArray(artifact.aliases) || !Array.isArray(artifact.withdrawals)
      || !artifact.indexes || !artifact.sitemap || artifact.sitemap.url_count !== artifact.records.length) fail('SEO_ARTIFACT_SHAPE_INVALID');
  return artifact;
}

export function assertSeoArtifact(artifact) {
  assertSeoArtifactHeader(artifact);
  if (artifact.records.some(record => record.document.visibility_state !== 'public'
    || record.document.generation_id !== artifact.publication_pin.seo_generation_id)) fail('SEO_ARTIFACT_RECORD_LEAK');
  for (const [index, record] of artifact.records.entries()) if (artifact.indexes.record_by_public_id[record.public_id] !== index) fail('SEO_RECORD_INDEX_INVALID');
  for (const [index, alias] of artifact.aliases.entries()) if (artifact.indexes.alias_by_public_id[alias.alias_id] !== index) fail('SEO_ALIAS_INDEX_INVALID');
  for (const [index, withdrawal] of artifact.withdrawals.entries()) if (artifact.indexes.withdrawal_by_public_id[withdrawal.public_id] !== index) fail('SEO_WITHDRAWAL_INDEX_INVALID');
  return artifact;
}

export const SUPPORTED_DCAT_PROFILES = DCAT_PROFILES;
