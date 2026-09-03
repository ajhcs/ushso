// Memory-bounded retrieval for the live v1.2 catalog. Derived search text is
// evaluated on demand so canonical records are not duplicated in the isolate.
import { compileDiscoveryIntent } from '../packages/retrieval/tools/intent-compiler.mjs';
import { selectJoinRoutes, validateJoinRoute } from '../packages/retrieval/tools/join-routes.mjs';
import { normalizeText } from '../packages/retrieval/tools/question-parser.mjs';

const RESTRICTED = new Set(['registration_required', 'application_required', 'dua_required', 'licensed_paid', 'controlled']);
const STOPWORDS = new Set(['a', 'an', 'and', 'are', 'can', 'data', 'dataset', 'datasets', 'for', 'from', 'i', 'in', 'is', 'me', 'need', 'of', 'on', 'source', 'sources', 'study', 'the', 'to', 'use', 'what', 'which', 'with']);

function stableHash(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  const hex = number => (number >>> 0).toString(16).padStart(8, '0');
  return `${hex(first)}${hex(second)}`;
}

function phrasePresent(normalizedText, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  return normalizedPhrase.length > 0 && ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function capabilities(record) {
  return [...(record.capabilities?.topics ?? []), ...(record.capabilities?.use_cases ?? [])];
}

function searchText(record) {
  return normalizeText([
    record.title,
    record.description,
    record.identity?.source?.name,
    ...capabilities(record).flatMap(capability => [capability.id, capability.label]),
  ].filter(Boolean).join(' '));
}

function recordYears(record) {
  return [record.time_coverage?.start, record.time_coverage?.end, record.freshness_verification?.data_through]
    .filter(Boolean)
    .flatMap(value => String(value).match(/\b(?:18|19|20|21)\d{2}\b/gu) ?? [])
    .map(Number);
}

function scoreRecord(record, intent, vocabulary) {
  const parsed = intent.filters;
  const components = [];
  const matchedGeographies = [];
  const jurisdictions = new Set(record.geography?.jurisdictions ?? []);
  for (const geography of intent.interpretation.geographies) {
    const code = geography.id.toUpperCase();
    if (jurisdictions.has(code)) {
      matchedGeographies.push(code);
      components.push({ kind: 'geography_exact', value: 24, reason: `Record explicitly covers ${geography.label}.`, evidence_state: record.geography?.evidence_state ?? 'unresolved' });
    }
  }
  if (intent.interpretation.geographies.length && !matchedGeographies.length) return null;

  const recordUnits = new Set(record.unit_of_analysis ?? []);
  const matchedUnits = intent.interpretation.units_of_analysis.filter(unit => recordUnits.has(unit.id));
  const explicitUnits = intent.interpretation.units_of_analysis.filter(unit => unit.evidence === 'explicit_filter');
  if (explicitUnits.length && !matchedUnits.length) return null;
  for (const unit of matchedUnits) components.push({
    kind: 'unit_exact', value: 11, reason: `Record metadata identifies ${unit.label} as a unit of analysis.`, evidence_state: 'inferred',
  });

  const years = recordYears(record);
  if (intent.interpretation.time_window && years.length) {
    const start = Math.min(...years);
    const end = Math.max(...years);
    const queryStart = intent.interpretation.time_window.start_year ?? -Infinity;
    const queryEnd = intent.interpretation.time_window.end_year ?? Infinity;
    if (end < queryStart || start > queryEnd) return null;
    components.push({ kind: 'time_overlap', value: 8, reason: `Indexed metadata years ${start}-${end} overlap the requested window.`, evidence_state: record.time_coverage?.evidence_state ?? 'unresolved' });
  } else if (intent.interpretation.time_window) {
    components.push({ kind: 'time_unknown', value: 0, reason: 'Time coverage is unknown; the record was retained without a time relevance bonus.', evidence_state: 'unresolved' });
  }

  const status = record.access?.status ?? 'unknown';
  if (parsed.access_statuses.length && !parsed.access_statuses.includes(status)) return null;
  if (!intent.interpretation.access_intent.include_restricted && RESTRICTED.has(status)) return null;
  components.push({ kind: 'access', value: status === 'public_catalog' ? 7 : 0, reason: `Indexed access status is ${status}.`, evidence_state: record.access?.evidence_state ?? 'unresolved' });

  const normalized = searchText(record);
  const matchedSubjects = [];
  for (const match of intent.interpretation.subjects) {
    const subject = (vocabulary.subjects ?? []).find(item => item.id === match.id);
    const terms = [...new Set([subject?.label, ...(subject?.record_terms ?? []), ...(subject?.aliases ?? [])].filter(Boolean))];
    if (!terms.some(term => phrasePresent(normalized, term))) continue;
    matchedSubjects.push(match.id);
    components.push({ kind: 'subject_lexical', value: 14, reason: `${match.label} matches indexed record metadata.`, evidence_state: 'inferred' });
  }
  if (intent.interpretation.subjects.length && !matchedSubjects.length) return null;

  const geographyTerms = new Set(intent.interpretation.geographies
    .flatMap(match => [match.label, ...(match.matched_aliases ?? [])])
    .flatMap(value => normalizeText(value).split(' ')));
  const queryTerms = [...new Set(intent.normalized_question.split(' ')
    .filter(term => term.length > 2 && !STOPWORDS.has(term) && !geographyTerms.has(term)))];
  const matchedTerms = queryTerms.filter(term => phrasePresent(normalized, term));
  if (matchedTerms.length) components.push({
    kind: 'lexical_record', value: Math.min(40, matchedTerms.length * 6),
    reason: `Indexed metadata matches: ${matchedTerms.join(', ')}.`, evidence_state: 'inferred',
  });
  const explicitGeography = parsed.geography.codes.length > 0 && matchedGeographies.length > 0;
  if (!intent.interpretation.subjects.length && !matchedTerms.length && !matchedUnits.length && !explicitGeography) return null;

  return {
    record,
    score: components.reduce((total, component) => total + component.value, 0),
    components,
    matched_subjects: matchedSubjects,
    matched_geographies: matchedGeographies,
    matched_units: matchedUnits.map(unit => unit.id),
    matched_terms: matchedTerms,
  };
}

function resultId(intent, ranked, corpusId) {
  return `retrieval-${stableHash(JSON.stringify({
    corpus_id: corpusId,
    question: intent.normalized_question,
    filters: intent.filters,
    records: ranked.map(item => item.record.record_id),
  }))}`;
}

function explain(item) {
  const reasons = item.components
    .filter(component => component.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 4)
    .map(component => component.reason);
  return reasons.length ? [...new Set(reasons)] : ['Record passed explicit filters but has only weak lexical relevance in the bounded catalog metadata.'];
}

export function createRetrievalEngine({ records, searchDocuments = [], joinRoutes = [], vocabulary, corpus }) {
  if (!Array.isArray(records) || records.length === 0) throw new TypeError('records must be a non-empty array');
  if (!Array.isArray(searchDocuments) || searchDocuments.length !== 0) throw new TypeError('v1.2 runtime requires on-demand search projection');
  if (!vocabulary || !Array.isArray(vocabulary.subjects) || !Array.isArray(vocabulary.geographies) || !Array.isArray(vocabulary.units)) throw new TypeError('vocabulary must define subjects, geographies, and units');
  const recordIds = new Set();
  for (const record of records) {
    if (!record?.record_id || recordIds.has(record.record_id)) throw new TypeError(`duplicate or missing record_id: ${record?.record_id}`);
    recordIds.add(record.record_id);
  }
  for (const route of joinRoutes) {
    validateJoinRoute(route);
    if (!recordIds.has(route.from_record_id) || !recordIds.has(route.to_record_id)) throw new TypeError(`join route ${route.route_id} references a record outside the corpus`);
  }
  const publishedCorpus = corpus ?? { corpus_id: 'observatory-live-catalog', corpus_version: '1.2.0', evidence_mode: 'live_first_party_metadata' };

  return Object.freeze({
    interpret(rawQuery) {
      return structuredClone(compileDiscoveryIntent(rawQuery, vocabulary));
    },
    retrieve(rawQuery, { signal } = {}) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const intent = compileDiscoveryIntent(rawQuery, vocabulary);
      const matches = records.map(record => scoreRecord(record, intent, vocabulary))
        .filter(Boolean)
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || left.record.record_id.localeCompare(right.record.record_id));
      const ranked = matches.slice(0, intent.filters.limit);
      const selectedRecords = ranked.map(item => item.record);
      const warnings = [];
      if (!intent.interpretation.subjects.length) warnings.push('No controlled subject concept matched; retrieval used explicit filters and bounded lexical metadata matching only.');
      if (!ranked.length) warnings.push('No published record matched. This is not evidence that no source exists.');
      warnings.push('Verification applies to live first-party catalog metadata, not dataset payload availability, schema completeness, authorization, geographic coverage, or analytic fitness.');
      return {
        contract_version: 'observatory-discovery-result.v1.0.0',
        retrieval_id: resultId(intent, ranked, publishedCorpus.corpus_id),
        evidence_mode: 'published_offline_evidence',
        corpus: { ...publishedCorpus, record_count: records.length, search_document_count: 0, join_route_count: joinRoutes.length },
        query: {
          question: intent.original_question,
          normalized_question: intent.normalized_question,
          interpretation: intent.interpretation,
          filters: {
            geography: intent.filters.geography,
            subjects: intent.filters.subjects,
            units_of_analysis: intent.filters.units_of_analysis,
            access_statuses: intent.filters.access_statuses,
            include_restricted: intent.interpretation.access_intent.include_restricted,
            time_window: intent.filters.time_window,
            limit: intent.filters.limit,
          },
        },
        result_count: ranked.length,
        returned_count: ranked.length,
        total_matches: matches.length,
        has_more: matches.length > ranked.length,
        results: ranked.map((item, index) => ({
          rank: index + 1,
          score: item.score,
          record_id: item.record.record_id,
          relevance: {
            matched_subjects: item.matched_subjects,
            matched_geographies: item.matched_geographies,
            matched_units: item.matched_units,
            matched_terms: item.matched_terms,
            score_components: item.components,
            why_relevant: explain(item),
          },
          record: structuredClone(item.record),
        })),
        join_routes: selectJoinRoutes(joinRoutes, selectedRecords),
        warnings,
      };
    },
  });
}
