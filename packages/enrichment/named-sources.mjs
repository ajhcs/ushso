import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NAMED_SOURCE_POLICY_VERSION = 'ushso.named-sources.v1';
export const REPEATED_TITLE_CASES = 579;
export const EXPANSION_FAMILY_COUNT = 12;

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ +/g, ' ');
}

function phrasePresent(text, phrase) {
  const normalizedText = normalize(text);
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return false;
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, ' +');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(normalizedText);
}

export function loadNamedSourceRegistry(file = defaultRegistryPath()) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function defaultRegistryPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../packages/retrieval/fixtures/named-source-registry.v1.0.0.json');
}

export function exactNameAnchors(source) {
  return freeze([source.name, ...(source.acronyms ?? []), ...(source.aliases ?? [])].filter(Boolean));
}

export function resolveNamedSource(question, registry, { catalogText } = {}) {
  const matches = (registry?.sources ?? []).filter((source) => exactNameAnchors(source).some((alias) => phrasePresent(question, alias)));
  if (!matches.length) {
    if (catalogText && /medical expenditure|healthcare cost|national provider|cost containment/i.test(catalogText)) {
      return freeze({ state: 'unrelated_catalog_text', exact: false, fabricated: false, sources: freeze([]) });
    }
    return freeze({ state: 'no_named_source', exact: false, fabricated: false, sources: freeze([]) });
  }
  return freeze({
    state: 'named_source',
    exact: true,
    fabricated: false,
    sources: freeze(matches.map((source) => freeze({
      source_id: source.source_id,
      name: source.name,
      coverage_state: source.coverage_state,
      catalog_membership: source.catalog_membership === true,
      family_identity: source.family_identity ?? source.name,
      indexed_record_ids: freeze([...(source.indexed_record_ids ?? [])]),
    }))),
  });
}

export function refuseSimilarCatalogText(question, catalogRecord, registry) {
  const resolved = resolveNamedSource(question, registry);
  if (!resolved.exact) return freeze({ resolved: false, catalog_is_not_the_named_source: true });
  const recordText = `${catalogRecord.title ?? ''} ${catalogRecord.description ?? ''}`;
  const named = resolved.sources.some((source) => exactNameAnchors(registry.sources.find((entry) => entry.source_id === source.source_id)).some((alias) => phrasePresent(recordText, alias)));
  if (!named) {
    return freeze({
      resolved: true,
      named_source: resolved.sources[0],
      catalog_is_not_the_named_source: true,
      reason: 'SIMILAR_WORDS_ARE_NOT_EXACT_NAME',
    });
  }
  return freeze({ resolved: true, catalog_is_not_the_named_source: false });
}

export function groupReleaseFamilies(records, { sourceNativeLinks = [], documentedSeries = [], repeatedTitleCount = REPEATED_TITLE_CASES } = {}) {
  const byTitle = new Map();
  for (const record of records) {
    const title = normalize(record.title);
    byTitle.set(title, [...(byTitle.get(title) ?? []), record]);
  }
  const repeated = [...byTitle.values()].filter((group) => group.length > 1);
  const repeatedTitles = repeated.reduce((sum, group) => sum + group.length, 0);
  const candidates = repeated.flatMap((group) => group.map((record) => freeze({
    record_id: record.record_id,
    title: record.title,
    status: 'candidate',
    basis: 'title_equality_only',
    merged: false,
    deleted: false,
  })));
  const evidenced = [
    ...sourceNativeLinks.map((link) => freeze({ ...link, status: 'accepted', basis: 'source_declared_lineage' })),
    ...documentedSeries.map((link) => freeze({ ...link, status: 'accepted', basis: 'documented_series' })),
  ];
  return freeze({
    repeated_title_cases_accounted: repeatedTitleCount,
    observed_repeated_title_records: repeatedTitles,
    title_equality_merged: false,
    title_equality_deleted: false,
    ambiguous_title_matches: freeze(candidates),
    evidenced_relations: freeze(evidenced),
  });
}

export function titleMerge(left, right) {
  if (!left || !right) return false;
  if (normalize(left.title) === normalize(right.title) && left.record_id !== right.record_id) {
    fail('TITLE_EQUALITY_MUST_NOT_MERGE');
  }
  return false;
}

export function titleDelete(record, duplicateTitle) {
  if (normalize(record.title) === normalize(duplicateTitle)) fail('TITLE_EQUALITY_MUST_NOT_DELETE');
  return false;
}

export function namedSourceResult(source) {
  const indexed = (source.indexed_record_ids ?? []).length > 0 && source.coverage_state === 'indexed';
  if (indexed) {
    return freeze({
      result_state: 'exact',
      coverage_state: 'indexed',
      fabricated: false,
      catalog_membership: source.catalog_membership === true,
      family_recognition: true,
      indexed_record_ids: freeze([...source.indexed_record_ids]),
    });
  }
  return freeze({
    result_state: 'coverage_gap',
    coverage_state: 'not_indexed',
    fabricated: false,
    catalog_membership: false,
    family_recognition: true,
    explanation: `Named source ${source.name} is recognized but not indexed. Source-intake and the authoritative route remain required. This is not an exact catalog match.`,
    official_discovery_url: source.official_discovery_url ?? null,
  });
}

export function contextualMention(record, source) {
  return freeze({
    result_state: 'contextual',
    named_source_role: 'secondary_mention',
    exact: false,
    record_id: record.record_id,
    source_id: source.source_id,
  });
}

export function expansionFamilyCoverage(registry) {
  const families = (registry.sources ?? []).filter((source) => source.family_identity && source.source_id !== 'ahrq-compendium' && source.source_id !== 'cms-hcris');
  return freeze({
    expansion_family_count: families.length,
    expected: EXPANSION_FAMILY_COUNT,
    not_yet_indexed_without_invented_membership: families.every((source) => source.catalog_membership !== true || (source.indexed_record_ids ?? []).length > 0),
  });
}

export function contentHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
