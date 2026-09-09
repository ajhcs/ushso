import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { semanticErrors } from '../packages/retrieval/tools/record-semantics.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '1.2.0';
const outputRoot = path.join(repositoryRoot, 'packages/retrieval/versions', `v${version}`);
const verificationRoot = path.join(repositoryRoot, 'verification/catalog', `v${version}`);
const vocabularyPath = path.join(repositoryRoot, 'packages/retrieval/versions/v1.1.0/fixtures/controlled-vocabulary.json');
const encoder = new TextEncoder();

const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_PUBLICATION_SHARD_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 3;

const SOURCES = Object.freeze([
  Object.freeze({
    sourceId: 'cms-data-catalog',
    sourceName: 'Centers for Medicare & Medicaid Services Data Catalog',
    publisher: 'Centers for Medicare & Medicaid Services',
    kind: 'dcat',
    url: 'https://data.cms.gov/data.json',
    expectedHost: 'data.cms.gov',
    defaultTopic: Object.freeze({ id: 'payer', label: 'Payer and coverage' }),
  }),
  Object.freeze({
    sourceId: 'cdc-socrata',
    sourceName: 'Centers for Disease Control and Prevention Data Catalog',
    publisher: 'Centers for Disease Control and Prevention',
    kind: 'socrata',
    url: 'https://data.cdc.gov/api/views/metadata/v1',
    expectedHost: 'data.cdc.gov',
    pageSize: 100,
    defaultTopic: Object.freeze({ id: 'public_health', label: 'Public health surveillance' }),
  }),
  Object.freeze({
    sourceId: 'census-api',
    sourceName: 'U.S. Census Bureau API Catalog',
    publisher: 'U.S. Census Bureau',
    kind: 'dcat',
    url: 'https://api.census.gov/data.json',
    expectedHost: 'api.census.gov',
    defaultTopic: Object.freeze({ id: 'geography_access', label: 'Geography, rurality, and access context' }),
  }),
]);

const TOPIC_RULES = Object.freeze([
  ['behavioral_health', 'Behavioral health and substance use', /mental health|behavioral health|substance|opioid|addiction/iu],
  ['claims', 'Claims and encounters', /claims?|encounters?|all[- ]payer|apcd/iu],
  ['community_benefit', 'Community benefit and tax exemption', /community benefit|charity care|tax exempt|form 990/iu],
  ['costs_prices', 'Costs, prices, and transparency', /cost report|costs?|prices?|charges?|transparency|allowed amount/iu],
  ['facility_licensure', 'Facility licensure and certification', /licen[cs]|certif/iu],
  ['hospital_capacity', 'Hospital capacity and operations', /bed|capacity|occupancy|operations?/iu],
  ['hospital_financials', 'Hospital financials', /financial|finance|cost report/iu],
  ['maternal_child_health', 'Maternal and child health', /maternal|pregnan|birth|newborn|neonatal|child health/iu],
  ['ownership', 'Ownership and organizational relationships', /ownership|change of ownership|merger|acquisition|\bchow\b/iu],
  ['payer', 'Payer and coverage', /medicare|medicaid|insurance|payer|coverage/iu],
  ['provider_directory', 'Provider and facility directories', /provider directory|facility directory|hospital directory|registry/iu],
  ['quality', 'Quality and outcomes', /quality|outcome|readmission|mortality|complication/iu],
  ['rural_hospital_closures', 'Rural hospital closures', /rural hospital|hospital closure/iu],
  ['utilization', 'Hospital and provider utilization', /utilization|patient volume|service volume|admission|discharge/iu],
  ['workforce', 'Healthcare workforce', /workforce|staffing|nurs|clinician|physician|labor force/iu],
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function shardJsonl(rows, prefix) {
  const shards = [];
  let lines = [];
  let bytes = 0;
  for (const row of rows) {
    const line = `${stableJson(row)}\n`;
    const lineBytes = encoder.encode(line).byteLength;
    if (lineBytes > MAX_PUBLICATION_SHARD_BYTES) throw new Error(`PUBLICATION_ROW_TOO_LARGE:${prefix}`);
    if (lines.length > 0 && bytes + lineBytes > MAX_PUBLICATION_SHARD_BYTES) {
      shards.push(lines.join(''));
      lines = [];
      bytes = 0;
    }
    lines.push(line);
    bytes += lineBytes;
  }
  if (lines.length > 0) shards.push(lines.join(''));
  return shards.map((content, index) => ({
    path: `corpus/${prefix}-${String(index + 1).padStart(4, '0')}.jsonl`,
    content,
  }));
}

function cleanText(value, fallback = '') {
  const text = Array.isArray(value) ? value.join('; ') : String(value ?? fallback);
  return text
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 4000);
}

function safeUrl(value, fallback) {
  try {
    const url = new URL(String(value ?? fallback));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol');
    if (url.username || url.password) throw new Error('credentials forbidden');
    return url.toString();
  } catch {
    return fallback;
  }
}

function futureIso(value, milliseconds) {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function compactToken(value) {
  const normalized = String(value).normalize('NFKC').toLowerCase()
    .replace(/^https?:\/\//u, '')
    .replace(/[^a-z0-9._~-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  // Source-native identifiers may be case-sensitive or differ only by
  // punctuation that the public token normalizes. Always bind a digest of the
  // exact identifier so normalization can never collapse distinct records.
  const prefix = normalized.slice(0, 38).replace(/-+$/u, '') || 'record';
  return `${prefix}-${sha256(String(value)).slice(0, 16)}`;
}

function uniqueStrings(values) {
  return [...new Set(values.flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => cleanText(value))
    .filter(Boolean))];
}

function recordText(item) {
  return uniqueStrings([
    item.title, item.name, item.description, item.category, item.theme, item.keyword,
    item.tags, item.attribution, item.publisher?.name,
  ]).join(' ');
}

function topics(item, source, evidenceId) {
  const text = recordText(item);
  const matches = TOPIC_RULES
    .filter(([, , pattern]) => pattern.test(text))
    .slice(0, 4)
    .map(([id, label]) => ({
      id,
      label,
      fitness: 'context_only',
      evidence_state: 'inferred',
      evidence_ids: [evidenceId],
      rationale: 'Classified deterministically from first-party title, description, category, theme, or keyword metadata.',
    }));
  if (matches.length === 0 || !matches.some(topic => topic.id === source.defaultTopic.id)) {
    matches.unshift({
      ...source.defaultTopic,
      fitness: 'context_only',
      evidence_state: 'inferred',
      evidence_ids: [evidenceId],
      rationale: `Default source-scope classification for ${source.sourceName}; analytic fitness is not asserted.`,
    });
  }
  return matches.slice(0, 4);
}

function unitsOfAnalysis(item) {
  const text = recordText(item);
  const values = [];
  for (const [id, pattern] of [
    ['hospital', /hospital/iu], ['facility', /facility|facilities|site\b|sites\b/iu],
    ['provider', /provider|clinician|physician/iu], ['health_system', /health system|hospital system/iu],
    ['county', /county|counties/iu], ['state', /state|statewide/iu],
    ['person', /patient|person|people|beneficiar/iu], ['event', /event|closure|transaction/iu],
    ['survey_response', /survey|response/iu],
  ]) if (pattern.test(text)) values.push(id);
  return values.length > 0 ? values.slice(0, 4) : ['unknown'];
}

function temporal(item) {
  const raw = typeof item.temporal === 'string'
    ? item.temporal
    : item.distribution?.find(distribution => typeof distribution?.temporal === 'string')?.temporal;
  const [startRaw, endRaw] = typeof raw === 'string' ? raw.split('/', 2) : [];
  const valid = value => /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u.test(value ?? '');
  return {
    state: valid(startRaw) || valid(endRaw) ? 'bounded' : 'unknown',
    start: valid(startRaw) ? startRaw : null,
    end: valid(endRaw) ? endRaw : null,
    temporal_granularity: valid(startRaw) && startRaw.length === 4 ? 'year' : 'unknown',
  };
}

function sourceNativeId(item, source) {
  if (source.kind === 'socrata') return item.id;
  return item.identifier ?? item['@id'];
}

function authoritativeUrl(item, source, nativeId) {
  if (source.kind === 'socrata') return `https://${source.expectedHost}/d/${encodeURIComponent(nativeId)}`;
  return safeUrl(item.landingPage ?? item.identifier ?? item['@id'], source.url);
}

function makeRecord(item, source, observedAt) {
  const nativeId = sourceNativeId(item, source);
  if (typeof nativeId !== 'string' || nativeId.length === 0 || nativeId.length > 1000) throw new Error(`INVALID_NATIVE_ID:${source.sourceId}`);
  const title = cleanText(item.title ?? item.name);
  if (!title) throw new Error(`MISSING_TITLE:${source.sourceId}:${nativeId}`);
  const itemDigest = sha256(stableJson(item));
  const token = compactToken(nativeId);
  const recordId = `obs:asset:${source.sourceId}:${token}`;
  const evidenceId = `evidence:${source.sourceId}:${itemDigest.slice(0, 24)}`;
  const provenanceId = `provenance:${source.sourceId}:${itemDigest.slice(0, 24)}`;
  const url = authoritativeUrl(item, source, nativeId);
  const interval = temporal(item);
  const record = {
    access: {
      evidence_ids: [evidenceId],
      evidence_state: 'verified_first_party',
      infrastructure_state: 'unknown',
      mechanisms: ['unknown'],
      requirements: ['Verify current publisher terms before retrieving any dataset payload.'],
      restriction_note: 'The first-party metadata record was live verified. Dataset contents, authorization, and payload retrieval were not executed.',
      status: item.accessLevel === 'public' || source.kind === 'socrata' ? 'public_catalog' : 'public_catalog',
    },
    authoritative_url: url,
    capabilities: {
      topics: topics(item, source, evidenceId),
      use_cases: [{
        id: 'use-case-metadata-discovery',
        label: 'Metadata discovery and source routing',
        fitness: 'context_only',
        evidence_state: 'verified_first_party',
        evidence_ids: [evidenceId],
        rationale: 'The record supports discovery of a first-party catalog entry; inclusion is not an analytic recommendation.',
      }],
    },
    description: cleanText(item.description, `${title} is listed in the ${source.sourceName}.`),
    evidence: [{
      evidence_id: evidenceId,
      claim: `The live first-party ${source.sourceName} returned this metadata record during a bounded catalog enumeration.`,
      state: 'verified_first_party',
      provenance_ids: [provenanceId],
      limitations: [
        'Verification applies to catalog metadata presence and the captured metadata fields only.',
        'No dataset rows, files, query results, authentication workflow, or restricted payload were requested.',
        'The record landing page and every distribution were not individually executed by this enumeration.',
      ],
    }],
    freshness_verification: {
      data_through: interval.end,
      metadata_observed_at: observedAt,
      next_review_due: futureIso(observedAt, 48 * 60 * 60 * 1000),
      update_frequency: 'source_determined',
      verification_method: 'first_party_live',
      verification_status: 'current_verified',
    },
    geography: {
      coverage_level: 'unknown',
      evidence_ids: [evidenceId],
      evidence_state: 'unresolved',
      jurisdictions: [],
      rurality_support: recordText(item).match(/rural/iu) ? 'inferred' : 'unknown',
    },
    identity: {
      asset: { asset_id: recordId, asset_type: 'catalog_record', name: title, version_label: null, version_state: 'rolling' },
      family: {
        candidate_family_ids: [],
        evidence_ids: [evidenceId],
        family_id: `family:${source.sourceId}:${token}`,
        name: `Source-scoped family for ${title}`,
        resolution_state: 'source_asserted',
      },
      identity_index_binding: {
        identity_record_id: null,
        rationale: 'The source-native identifier is preserved without asserting a cross-source identity merge.',
        state: 'source_scoped',
      },
      match_fields: {
        canonical_url: url,
        doi: /^10\.\d{4,9}\//iu.test(nativeId) ? nativeId : null,
        normalized_title: title.normalize('NFKC').toLowerCase(),
        normalized_url: url.replace(/^https?:\/\//u, '').replace(/\/$/u, ''),
        publisher: cleanText(item.publisher?.name ?? item.attribution ?? source.publisher) || source.publisher,
        source_id: nativeId,
        source_portal: new URL(source.url).origin,
      },
      source: { name: source.sourceName, source_id: source.sourceId },
    },
    join_compatibility: {
      keys: [],
      notes: ['No cross-source identity or join route is inferred from catalog metadata alone.'],
      state: 'none_known',
    },
    provenance: [{
      provenance_id: provenanceId,
      kind: 'catalog_metadata',
      locator: source.url,
      observed_at: observedAt,
      capture_state: 'captured_hashed',
      content_sha256: itemDigest,
    }],
    record_id: recordId,
    record_type: 'dataset_asset',
    retrieval: {
      expected_artifacts: ['first-party landing page', 'current publisher terms', 'typed access outcome'],
      failure_policy: 'Preserve unavailable, restricted, stale, and unknown states; never convert a failed request into not_found.',
      instructions: [
        {
          action: 'open',
          expected_result: 'Current publisher metadata or a typed access/unavailability outcome.',
          instruction: 'Open the authoritative publisher page and review current metadata and terms before retrieving data.',
          requires_human: true,
          sequence: 1,
          url,
        },
        {
          action: 'stop_and_report',
          expected_result: 'No unauthorized action or accidental payload acquisition.',
          instruction: 'Stop at authentication, application, agreement, payment, restricted-data, or unexpected payload boundaries.',
          requires_human: true,
          sequence: 2,
          url: null,
        },
      ],
      machine_actionable: false,
      preferred_interface: 'unknown',
    },
    schema_version: 'observatory-record.v1.0.0',
    time_coverage: {
      ...interval,
      evidence_ids: [evidenceId],
      evidence_state: interval.start || interval.end ? 'source_asserted' : 'unresolved',
    },
    title,
    unit_of_analysis: unitsOfAnalysis(item),
  };
  const errors = semanticErrors(record);
  if (errors.length > 0) throw new Error(`RECORD_SEMANTIC_FAILURE:${recordId}:${errors.join(';')}`);
  return record;
}

async function fetchBounded(url, source) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.hostname !== source.expectedHost || target.port) throw new Error(`SOURCE_ROUTE_NOT_ALLOWED:${url}`);
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('REQUEST_TIMEOUT')), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(target, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'USHSO-Metadata-Harvester/1.2 (+https://ushso.org)' },
      });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
          await response.body?.cancel();
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          continue;
        }
        throw new Error(`SOURCE_HTTP_ERROR:${source.sourceId}:${response.status}`);
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json' && contentType !== 'application/ld+json') throw new Error(`SOURCE_CONTENT_TYPE_REJECTED:${source.sourceId}:${contentType ?? 'missing'}`);
      const declared = response.headers.get('content-length');
      if (declared && Number(declared) > MAX_RESPONSE_BYTES) throw new Error(`SOURCE_RESPONSE_TOO_LARGE:${source.sourceId}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error(`SOURCE_BODY_MISSING:${source.sourceId}`);
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel('response size limit exceeded');
          throw new Error(`SOURCE_RESPONSE_TOO_LARGE:${source.sourceId}`);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return {
        parsed: JSON.parse(text),
        receipt: {
          url: target.toString(),
          http_status: response.status,
          content_type: contentType,
          content_length: size,
          etag: response.headers.get('etag'),
          last_modified: response.headers.get('last-modified'),
          body_sha256: sha256(bytes),
          attempt_count: attempt,
        },
      };
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS || String(error?.message).startsWith('SOURCE_')) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function enumerate(source) {
  const pages = [];
  const items = [];
  if (source.kind === 'dcat') {
    const response = await fetchBounded(source.url, source);
    const datasets = Array.isArray(response.parsed) ? response.parsed : response.parsed?.dataset;
    if (!Array.isArray(datasets)) throw new Error(`SOURCE_SCHEMA_DRIFT:${source.sourceId}:dataset`);
    items.push(...datasets);
    pages.push({ ...response.receipt, item_count: datasets.length, page: 1 });
  } else if (source.kind === 'socrata') {
    for (let page = 1; ; page += 1) {
      const url = new URL(source.url);
      url.searchParams.set('limit', String(source.pageSize));
      url.searchParams.set('page', String(page));
      process.stderr.write(`[harvest] ${source.sourceId}: requesting page ${page}\n`);
      const response = await fetchBounded(url, source);
      if (!Array.isArray(response.parsed)) throw new Error(`SOURCE_SCHEMA_DRIFT:${source.sourceId}:array`);
      if (response.parsed.some(item => !item || typeof item.id !== 'string' || typeof (item.name ?? item.title) !== 'string' || Object.hasOwn(item, 'rows'))) {
        throw new Error(`SOURCE_SCHEMA_DRIFT:${source.sourceId}:metadata_item`);
      }
      items.push(...response.parsed);
      pages.push({ ...response.receipt, item_count: response.parsed.length, page });
      process.stderr.write(`[harvest] ${source.sourceId}: accepted page ${page} (${response.parsed.length} records)\n`);
      if (response.parsed.length < source.pageSize) break;
      if (page >= 100) throw new Error(`SOURCE_PAGE_BOUND_EXCEEDED:${source.sourceId}`);
    }
  } else {
    throw new Error(`SOURCE_KIND_UNSUPPORTED:${source.kind}`);
  }
  const nativeIds = items.map(item => sourceNativeId(item, source));
  if (nativeIds.some(id => typeof id !== 'string' || id.length === 0)) throw new Error(`SOURCE_NATIVE_ID_MISSING:${source.sourceId}`);
  if (new Set(nativeIds).size !== nativeIds.length) throw new Error(`SOURCE_DUPLICATE_NATIVE_ID:${source.sourceId}`);
  return { items, pages };
}

async function writeFile(relativePath, content) {
  const target = path.join(outputRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  const bytes = encoder.encode(content);
  return { path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function main() {
  // v1.2.0 is a generated candidate directory. Clear only this exact version
  // before rebuilding so removed shards cannot survive into a later manifest.
  await fs.rm(outputRoot, { recursive: true, force: true });
  const observedAt = new Date().toISOString();
  const sourceResults = [];
  const records = [];
  for (const source of SOURCES) {
    const enumeration = await enumerate(source);
    const sourceRecords = enumeration.items.map(item => makeRecord(item, source, observedAt));
    sourceResults.push({ source, ...enumeration, records: sourceRecords });
    records.push(...sourceRecords);
    process.stderr.write(`[harvest] ${source.sourceId}: ${sourceRecords.length} live metadata records\n`);
  }
  records.sort((left, right) => left.record_id.localeCompare(right.record_id));
  if (new Set(records.map(record => record.record_id)).size !== records.length) throw new Error('CROSS_SOURCE_RECORD_ID_COLLISION');
  if (records.length < 1000) throw new Error(`CATALOG_BREADTH_GATE_FAILED:${records.length}`);
  if (!records.every(record => record.freshness_verification.verification_status === 'current_verified'
    && record.freshness_verification.verification_method === 'first_party_live')) throw new Error('VERIFICATION_GATE_FAILED');

  // Search projections duplicate most of each canonical record and pushed the
  // Worker over its memory budget. The runtime derives bounded search text from
  // canonical records on demand instead of publishing a second in-memory copy.
  const searchDocuments = [];
  const vocabulary = JSON.parse(await fs.readFile(vocabularyPath, 'utf8'));
  const recordCounts = Object.fromEntries(sourceResults.map(result => [result.source.sourceId, result.records.length]));
  const pageCount = sourceResults.reduce((total, result) => total + result.pages.length, 0);
  const corpusId = `ushso-live-catalog-${observedAt.slice(0, 10)}`;
  const generationSeed = stableJson({ records: records.map(record => [record.record_id, record.provenance[0].content_sha256]), observedAt });
  const generation = `live-${observedAt.slice(0, 10)}-${sha256(generationSeed).slice(0, 12)}`;
  const recordShards = shardJsonl(records, 'records');
  const searchDocumentShards = [];
  const corpus = {
    corpus_id: corpusId,
    corpus_version: version,
    evidence_mode: 'live_first_party_metadata',
    manifest_sha256: sha256(generationSeed),
    algorithm_fingerprint_sha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
    record_count: records.length,
    search_document_count: searchDocuments.length,
    join_route_count: 0,
    record_files: recordShards.map(shard => shard.path.slice('corpus/'.length)),
    search_document_files: searchDocumentShards.map(shard => shard.path.slice('corpus/'.length)),
    runtime_search_projection: 'on_demand',
    source_slices: recordCounts,
    publication: { generation, observed_at: observedAt, all_public_records_live_verified: true },
    build_boundary: {
      fixture_only: false,
      external_requests: pageCount,
      payload_downloads: 0,
      identity_index_queries: 0,
      heavy_analysis_lock_touched: false,
      coverage_cells_executed: sourceResults.length,
      accepted_upstream_metadata_requests: pageCount,
    },
  };
  const validation = {
    schema_version: 'observatory-live-catalog-validation.v1.2.0',
    status: 'PASS',
    observed_at: observedAt,
    generation,
    counts: {
      sources: sourceResults.length,
      source_requests: pageCount,
      records: records.length,
      search_documents: searchDocuments.length,
      current_verified: records.length,
      not_live_verified: 0,
      stale: 0,
      unknown: 0,
    },
    gates: {
      minimum_1000_records: records.length >= 1000,
      all_public_records_current_verified: true,
      unique_record_ids: true,
      source_native_ids_unique_within_source: true,
      record_semantics: true,
      complete_source_enumerations: true,
      metadata_only_zero_payloads: true,
      zero_identity_merges: true,
    },
    source_counts: recordCounts,
  };
  const receipt = {
    schema_version: 'observatory-live-catalog-receipt.v1.2.0',
    receipt_id: `live-catalog-${generation}`,
    observed_at: observedAt,
    generation,
    scope: {
      source_count: sourceResults.length,
      record_count: records.length,
      boundary: 'First-party catalog metadata only. No source dataset rows, files, query results, authorization workflows, or restricted payloads were requested.',
    },
    sources: sourceResults.map(result => ({
      source_id: result.source.sourceId,
      source_name: result.source.sourceName,
      collection_url: result.source.url,
      expected_host: result.source.expectedHost,
      enumeration_complete: true,
      native_record_count: result.items.length,
      published_record_count: result.records.length,
      pages: result.pages,
      membership_sha256: sha256(result.records.map(record => record.record_id).sort().join('\n')),
    })),
    totals: {
      current_verified: records.length,
      not_live_verified: 0,
      payload_downloads: 0,
      identity_merges: 0,
    },
  };

  const payloads = [
    ...recordShards.map(shard => [shard.path, shard.content]),
    ...searchDocumentShards.map(shard => [shard.path, shard.content]),
    ['corpus/join-routes.jsonl', ''],
    ['corpus/corpus.json', prettyJson(corpus)],
    ['fixtures/controlled-vocabulary.json', prettyJson(vocabulary)],
    ['validation/validation-report.json', prettyJson(validation)],
  ];
  const files = [];
  for (const [relativePath, content] of payloads) files.push(await writeFile(relativePath, content));
  const manifest = {
    manifest_version: 'observatory-retrieval-corpus-manifest.v1.2.0',
    corpus_id: corpusId,
    corpus_version: version,
    generation,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    safety: validation.gates,
  };
  await writeFile('manifests/corpus-manifest.json', prettyJson(manifest));
  await fs.mkdir(verificationRoot, { recursive: true });
  await fs.writeFile(path.join(verificationRoot, 'live-catalog-receipt.json'), prettyJson(receipt));
  await fs.writeFile(path.join(verificationRoot, 'validation-report.json'), prettyJson(validation));
  process.stdout.write(prettyJson({ status: 'PASS', version, generation, records: records.length, sources: recordCounts, source_requests: pageCount }));
}

await main();
