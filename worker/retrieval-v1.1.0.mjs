// Runtime promotion of the validated observatory/retrieval/v1.1.0 engine.
import { containsPhrase, normalizeText, parseQuestion, recordSearchText } from '../packages/retrieval/tools/question-parser.mjs';
import { selectJoinRoutes, validateJoinRoute } from '../packages/retrieval/tools/join-routes.mjs';
import { compileDiscoveryIntent } from '../packages/retrieval/tools/intent-compiler.mjs';
import { projectSearchDocuments } from '../packages/retrieval/tools/search-document.mjs';

const RESTRICTED = new Set(['registration_required', 'application_required', 'dua_required', 'licensed_paid', 'controlled']);
const FITNESS_WEIGHT = { primary: 52, supporting: 32, context_only: 12, unknown: 4 };
const EVIDENCE_WEIGHT = { verified_first_party: 8, source_asserted: 5, inferred: 2, unresolved: 0, unavailable: 0 };
const STOPWORDS = new Set(['a', 'an', 'and', 'are', 'can', 'data', 'dataset', 'datasets', 'for', 'from', 'i', 'in', 'is', 'me', 'need', 'of', 'on', 'source', 'sources', 'study', 'the', 'to', 'use', 'what', 'which', 'with']);

function normalizedTokens(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function singularToken(token) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(?:ches|shes|xes|zes|oes)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function editDistanceAtMostOne(left, right) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    const differences = [];
    for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) differences.push(index);
    if (differences.length === 1) return true;
    return differences.length === 2
      && differences[1] === differences[0] + 1
      && left[differences[0]] === right[differences[1]]
      && left[differences[1]] === right[differences[0]];
  }
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      longIndex += 1;
    }
  }
  return true;
}

function tokenMatch(queryToken, documentTokens) {
  const queryBase = singularToken(queryToken);
  for (const documentToken of documentTokens) {
    if (queryToken === documentToken || queryBase === singularToken(documentToken)) return { kind: 'exact', token: documentToken };
  }
  if (queryToken.length < 5) return null;
  for (const documentToken of documentTokens) {
    if (documentToken.length >= 4 && editDistanceAtMostOne(queryBase, singularToken(documentToken))) return { kind: 'fuzzy', token: documentToken };
  }
  return null;
}

function flattenStrings(value, output = [], limit = 256) {
  if (output.length >= limit) return output;
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.some(item => {
    flattenStrings(item, output, limit);
    return output.length >= limit;
  });
  else if (value && typeof value === 'object') Object.values(value).some(item => {
    flattenStrings(item, output, limit);
    return output.length >= limit;
  });
  return output;
}

function lexicalFields(record, searchText) {
  const capabilities = capabilityRows(record);
  const variableMetadata = [
    record.variables,
    record.variable_metadata,
    record.data_dictionary,
    record.schema,
    record.retrieval?.expected_artifacts
  ];
  return [
    { kind: 'title', weight: 10, text: normalizeText(record.title) },
    { kind: 'capability', weight: 7, text: normalizeText(flattenStrings(capabilities).join(' ')) },
    { kind: 'variable', weight: 6, text: normalizeText(flattenStrings(variableMetadata).join(' ')) },
    { kind: 'description', weight: 4, text: normalizeText(record.description) },
    { kind: 'record', weight: 2, text: normalizeText(searchText ?? recordSearchText(record)) }
  ].map(field => ({ ...field, tokens: [...new Set(normalizedTokens(field.text))] }));
}

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
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function capabilityRows(record) {
  return [...(record.capabilities?.topics ?? []), ...(record.capabilities?.use_cases ?? [])];
}

function subjectScore(record, interpretation, vocabulary, searchText) {
  const document = searchText ?? recordSearchText(record);
  const components = [];
  const matchedSubjects = [];
  for (const subjectMatch of interpretation.subjects) {
    const subject = (vocabulary.subjects ?? []).find(item => item.id === subjectMatch.id);
    const terms = [...new Set([subject?.label, ...(subject?.record_terms ?? []), ...(subject?.aliases ?? [])].filter(Boolean))];
    const matchingCapabilities = capabilityRows(record).filter(capability => {
      const capabilityText = normalizeText([capability.id, capability.label, capability.rationale].join(' '));
      return terms.some(term => containsPhrase(capabilityText, term));
    });
    const matchedTerms = terms.filter(term => containsPhrase(document, term));
    if (!matchingCapabilities.length && !matchedTerms.length) continue;
    matchedSubjects.push(subjectMatch.id);
    if (matchingCapabilities.length) {
      const best = matchingCapabilities.sort((a, b) => (FITNESS_WEIGHT[b.fitness] ?? 0) - (FITNESS_WEIGHT[a.fitness] ?? 0))[0];
      const value = (FITNESS_WEIGHT[best.fitness] ?? 0) + (EVIDENCE_WEIGHT[best.evidence_state] ?? 0);
      components.push({ kind: 'subject_capability', value, reason: `${subjectMatch.label} matches ${best.fitness} capability ${best.label}.`, evidence_state: best.evidence_state });
    } else {
      components.push({ kind: 'subject_lexical', value: 14, reason: `${subjectMatch.label} matches evidence-bound record text.`, evidence_state: 'inferred' });
    }
  }
  return { components, matchedSubjects };
}

function geographyScore(record, interpretation) {
  if (!interpretation.geographies.length) return { eligible: true, components: [], matched: [] };
  const jurisdictions = new Set(record.geography?.jurisdictions ?? []);
  const coverage = record.geography?.coverage_level;
  const components = [];
  const matched = [];
  for (const geography of interpretation.geographies) {
    const code = geography.id.toUpperCase();
    if (jurisdictions.has(code)) {
      components.push({ kind: 'geography_exact', value: 24, reason: `Record explicitly covers ${geography.label}.`, evidence_state: record.geography?.evidence_state ?? 'unresolved' });
      matched.push(code);
    } else if (code !== 'US' && jurisdictions.has('US') && ['national', 'multi_state', 'mixed'].includes(coverage)) {
      components.push({ kind: 'geography_national_support', value: 13, reason: `National record may be filtered or joined for ${geography.label}.`, evidence_state: record.geography?.evidence_state ?? 'unresolved' });
      matched.push(code);
    }
  }
  return { eligible: matched.length > 0, components, matched };
}

function unitScore(record, interpretation) {
  if (!interpretation.units_of_analysis.length) return { eligible: true, components: [], matched: [] };
  const recordUnits = new Set(record.unit_of_analysis ?? []);
  const matched = interpretation.units_of_analysis.filter(unit => recordUnits.has(unit.id));
  const explicitUnits = interpretation.units_of_analysis.filter(unit => unit.evidence === 'explicit_filter');
  if (explicitUnits.length && !explicitUnits.some(unit => recordUnits.has(unit.id))) return { eligible: false, components: [], matched: [] };
  return {
    eligible: true,
    matched: matched.map(value => value.id),
    components: matched.map(unit => ({ kind: 'unit_exact', value: 11, reason: `Record unit of analysis includes ${unit.label}.`, evidence_state: 'source_asserted' }))
  };
}

function years(record) {
  const values = [record.time_coverage?.start, record.time_coverage?.end, record.freshness_verification?.data_through]
    .filter(Boolean)
    .flatMap(value => String(value).match(/\b(?:18|19|20|21)\d{2}\b/g) ?? [])
    .map(Number);
  return values;
}

function timeScore(record, interpretation) {
  const window = interpretation.time_window;
  if (!window) return { eligible: true, components: [] };
  const recordYears = years(record);
  if (!recordYears.length) return { eligible: true, components: [{ kind: 'time_unknown', value: 0, reason: 'Record time coverage is unknown; it was retained but not rewarded.', evidence_state: 'unresolved' }] };
  const start = Math.min(...recordYears);
  const end = Math.max(...recordYears);
  const queryStart = window.start_year ?? -Infinity;
  const queryEnd = window.end_year ?? Infinity;
  if (end < queryStart || start > queryEnd) return { eligible: false, components: [] };
  return { eligible: true, components: [{ kind: 'time_overlap', value: 8, reason: `Record time coverage ${start}-${end} overlaps the requested window.`, evidence_state: record.time_coverage?.evidence_state ?? 'unresolved' }] };
}

function accessScore(record, parsed) {
  const status = record.access?.status ?? 'unknown';
  if (parsed.raw.access_statuses.length && !parsed.raw.access_statuses.includes(status)) return { eligible: false, components: [] };
  if (!parsed.interpretation.access_intent.include_restricted && RESTRICTED.has(status)) return { eligible: false, components: [] };
  const value = status === 'public_direct' ? 10 : status === 'public_catalog' ? 7 : RESTRICTED.has(status) ? 1 : 0;
  return {
    eligible: true,
    components: [{
      kind: 'access',
      value,
      reason: RESTRICTED.has(status) ? `Relevant but access is ${status}; restrictions remain visible.` : `Access status is ${status}.`,
      evidence_state: record.access?.evidence_state ?? 'unresolved'
    }]
  };
}

function lexicalScore(record, parsed, searchText) {
  const geographyTokens = new Set(parsed.interpretation.geographies
    .flatMap(match => [match.label, ...(match.matched_aliases ?? [])])
    .flatMap(value => normalizeText(value).split(' '))
    .filter(Boolean));
  const tokens = [...new Set(parsed.normalized_question.split(' ').filter(token => token.length > 2 && !STOPWORDS.has(token) && !geographyTokens.has(token)))];
  const fields = lexicalFields(record, searchText);
  const matches = [];
  for (const token of tokens) {
    const candidates = fields
      .map(field => ({ field, match: tokenMatch(token, field.tokens) }))
      .filter(candidate => candidate.match)
      .sort((left, right) => right.field.weight - left.field.weight || left.field.kind.localeCompare(right.field.kind));
    if (candidates.length) matches.push({ token, ...candidates[0] });
  }
  const components = [];
  for (const field of fields) {
    const fieldMatches = matches.filter(match => match.field.kind === field.kind);
    if (!fieldMatches.length) continue;
    const exact = fieldMatches.filter(match => match.match.kind === 'exact').map(match => match.token);
    const fuzzy = fieldMatches.filter(match => match.match.kind === 'fuzzy').map(match => `${match.token}~${match.match.token}`);
    const value = exact.length * field.weight + fuzzy.length * Math.max(1, Math.floor(field.weight / 2));
    components.push({
      kind: `lexical_${field.kind}`,
      value,
      reason: `${field.kind === 'variable' ? 'Variable and documentation metadata' : `${field.kind[0].toUpperCase()}${field.kind.slice(1)} text`} matches: ${[...exact, ...fuzzy].join(', ')}.`,
      evidence_state: 'inferred'
    });
  }
  const queryPhrase = tokens.join(' ');
  if (tokens.length > 1 && queryPhrase) {
    const phraseField = fields.find(field => containsPhrase(field.text, queryPhrase));
    if (phraseField) components.push({
      kind: `phrase_${phraseField.kind}`,
      value: phraseField.kind === 'title' ? 16 : phraseField.kind === 'capability' ? 11 : phraseField.kind === 'variable' ? 9 : 6,
      reason: `${phraseField.kind === 'title' ? 'Title' : 'Record metadata'} contains the requested phrase "${queryPhrase}".`,
      evidence_state: 'inferred'
    });
  }
  if (matches.length > 1) {
    const coverage = matches.length / Math.max(tokens.length, 1);
    components.push({
      kind: 'lexical_coverage',
      value: Math.max(2, Math.round(8 * coverage)),
      reason: `Record matches ${matches.length} of ${tokens.length} meaningful query terms.`,
      evidence_state: 'inferred'
    });
  }
  return {
    matched: matches.map(match => match.token),
    components
  };
}

function explain(record, scoreComponents, matchedSubjects) {
  const reasons = [];
  for (const component of scoreComponents.filter(component => component.value > 0).sort((a, b) => b.value - a.value)) {
    if (!reasons.includes(component.reason)) reasons.push(component.reason);
    if (reasons.length === 4) break;
  }
  if (!reasons.length) reasons.push('Record passed explicit filters but has only weak lexical relevance in the offline corpus.');
  if (matchedSubjects.length) reasons.push(`Resolved subject concepts: ${matchedSubjects.join(', ')}.`);
  if (RESTRICTED.has(record.access?.status)) reasons.push(`Human action is required because access is ${record.access.status}.`);
  return reasons;
}

function scoreRecord(record, parsed, vocabulary, searchText) {
  const geography = geographyScore(record, parsed.interpretation);
  if (!geography.eligible) return null;
  const unit = unitScore(record, parsed.interpretation);
  if (!unit.eligible) return null;
  const time = timeScore(record, parsed.interpretation);
  if (!time.eligible) return null;
  const access = accessScore(record, parsed);
  if (!access.eligible) return null;
  const subject = subjectScore(record, parsed.interpretation, vocabulary, searchText);
  const lexical = lexicalScore(record, parsed, searchText);
  const components = [...subject.components, ...geography.components, ...unit.components, ...time.components, ...access.components, ...lexical.components];
  const subjectRequired = parsed.interpretation.subjects.length > 0;
  if (subjectRequired && !subject.matchedSubjects.length) return null;
  const explicitGeographyFilterMatched = parsed.raw.geography.codes.length > 0 && geography.matched.length > 0;
  if (!subjectRequired && !lexical.matched.length && !unit.matched.length && !explicitGeographyFilterMatched) return null;
  return {
    record,
    score: components.reduce((sum, component) => sum + component.value, 0),
    components,
    matched_subjects: subject.matchedSubjects,
    matched_geographies: geography.matched,
    matched_units: unit.matched,
    matched_terms: lexical.matched
  };
}

function stableResultId(parsed, ranked, corpusId) {
  const seed = JSON.stringify({
    corpus_id: corpusId,
    question: parsed.normalized_question,
    filters: parsed.raw,
    records: ranked.map(item => item.record.record_id)
  });
  return `retrieval-${stableHash(seed)}`;
}

export function createRetrievalEngine({ records, searchDocuments, joinRoutes = [], vocabulary, corpus }) {
  if (!Array.isArray(records) || records.length === 0) throw new TypeError('records must be a non-empty array');
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
  const projectedDocuments = searchDocuments ?? projectSearchDocuments(records, joinRoutes);
  if (!Array.isArray(projectedDocuments) || projectedDocuments.length !== records.length) throw new TypeError('searchDocuments must contain exactly one projection per record');
  const searchDocumentByRecord = new Map();
  for (const document of projectedDocuments) {
    if (!recordIds.has(document.resource_record_id) || searchDocumentByRecord.has(document.resource_record_id)) throw new TypeError(`invalid or duplicate search document: ${document.resource_record_id}`);
    if (document.authoritative_record !== false || document.projection_role !== 'discovery_view') throw new TypeError(`search document must be a non-authoritative discovery view: ${document.resource_record_id}`);
    searchDocumentByRecord.set(document.resource_record_id, structuredClone(document));
  }
  const frozenRecords = structuredClone(records);
  const frozenRoutes = structuredClone(joinRoutes);
  const frozenVocabulary = structuredClone(vocabulary);
  const frozenCorpus = structuredClone(corpus ?? { corpus_id: 'observatory-offline-fixture', corpus_version: '1.0.0', evidence_mode: 'published_offline_evidence' });
  return Object.freeze({
    interpret(rawQuery) {
      return structuredClone(compileDiscoveryIntent(rawQuery, frozenVocabulary));
    },
    retrieve(rawQuery, { signal } = {}) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const intent = compileDiscoveryIntent(rawQuery, frozenVocabulary);
      const parsed = { ...intent, raw: intent.filters };
      const ranked = frozenRecords
        .map(record => scoreRecord(record, parsed, frozenVocabulary, searchDocumentByRecord.get(record.record_id)?.search_text))
        .filter(Boolean)
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.record.record_id.localeCompare(b.record.record_id))
        .slice(0, parsed.raw.limit);
      const selectedRecords = ranked.map(item => item.record);
      const warnings = [];
      if (!parsed.interpretation.subjects.length) warnings.push('No controlled subject concept matched; retrieval used explicit filters and bounded lexical matching only.');
      if (!ranked.length) warnings.push('No published offline record matched. This is not evidence that no source exists.');
      warnings.push('Results describe indexed metadata and retrieval routes; they do not prove current endpoint availability or authorize access.');
      return {
        contract_version: 'observatory-discovery-result.v1.0.0',
        retrieval_id: stableResultId(parsed, ranked, frozenCorpus.corpus_id),
        evidence_mode: 'published_offline_evidence',
        corpus: { ...frozenCorpus, record_count: frozenRecords.length, search_document_count: projectedDocuments.length, join_route_count: frozenRoutes.length },
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
            limit: intent.filters.limit
          }
        },
        result_count: ranked.length,
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
            why_relevant: explain(item.record, item.components, item.matched_subjects)
          },
          record: structuredClone(item.record)
        })),
        join_routes: selectJoinRoutes(frozenRoutes, selectedRecords),
        warnings
      };
    }
  });
}
