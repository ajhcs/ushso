import {consumeLexicalArtifact} from './lexical-artifact.mjs';
import { containsNormalizedPhrase, normalizeText, parseQuestion, recordSearchText } from './question-parser-v1.2.mjs';
import { selectJoinRoutes, validateJoinRoute } from './join-routes.mjs';
import { compileDiscoveryIntent } from './intent-compiler-v1.2.mjs';
import { projectSearchDocuments } from './search-document-v1.2.mjs';
import {
  accessDimensions,
  auditEvidence,
  dateDimensions,
  descriptionQuality,
  freshnessState,
  metadataDimensions,
  reviewedTopics,
  retrievalPlan,
  validateCatalogRecords
} from './catalog-contract.mjs';

const FROZEN_OBSERVATION_CLOCK = '1970-01-01T00:00:00.000Z';
const RESTRICTED = new Set(['registration_required', 'application_required', 'dua_required', 'licensed_paid', 'controlled']);
const FITNESS_WEIGHT = { primary: 52, supporting: 32, context_only: 12, unknown: 4 };
const EVIDENCE_WEIGHT = { verified_first_party: 8, source_asserted: 5, inferred: 2, unresolved: 0, unavailable: 0 };
const STOPWORDS = new Set(['a', 'about', 'an', 'and', 'are', 'by', 'can', 'data', 'dataset', 'datasets', 'describe', 'excluding', 'exclude', 'except', 'find', 'for', 'from', 'i', 'in', 'is', 'me', 'need', 'no', 'not', 'of', 'on', 'only', 'public', 'show', 'source', 'sources', 'study', 'the', 'to', 'use', 'what', 'which', 'with', 'without']);
const RANKING_VERSION = 'observatory-canonical-ranking.v1.2.0';
const SORTS = new Set(['canonical_relevance', 'title_asc', 'release_newest', 'observation_latest']);
const FACET_SOURCE_LABELS = {
  'cdc-socrata': 'Centers for Disease Control and Prevention Data Catalog',
  'census-api': 'U.S. Census Bureau API Catalog',
  'cms-data-catalog': 'Centers for Medicare & Medicaid Services Data Catalog'
};
const FACET_ACCESS_LABELS = {
  public_direct: 'Public direct',
  public_catalog: 'Public catalog metadata; payload access unresolved',
  registration_required: 'Registration required',
  application_required: 'Application required',
  dua_required: 'Data-use agreement required',
  licensed_paid: 'Licensed / paid',
  controlled: 'Controlled access',
  temporarily_unavailable: 'Temporarily unavailable',
  unavailable: 'Unavailable',
  unknown: 'Access unresolved'
};
const FACET_GEOGRAPHY_LABELS = {
  national: 'National coverage',
  multi_state: 'Multi-state coverage',
  state: 'State coverage',
  county: 'County coverage',
  facility: 'Facility coverage',
  mixed: 'Mixed coverage',
  unknown: 'Geography unresolved',
  US: 'United States jurisdiction',
  'US-PA': 'Pennsylvania',
  'US-CA': 'California',
  'US-TX': 'Texas',
  'US-NY': 'New York'
};
const FACET_UNIT_LABELS = {
  county_equivalent: 'County equivalent',
  facility_period: 'Facility-period',
  health_system: 'Health system',
  survey_response: 'Survey response',
  unknown: 'Observation unit unresolved'
};
const FACET_CAPABILITY_LABELS = {
  behavioral_health: 'Behavioral health and substance use',
  claims: 'Claims and encounters',
  costs_prices: 'Costs, prices, and transparency',
  facility_licensure: 'Facility licensure and certification',
  geography_access: 'Geography, rurality, and access context',
  hospital_capacity: 'Hospital capacity and operations',
  hospital_financials: 'Hospital financials',
  maternal_child_health: 'Maternal and child health',
  ownership: 'Ownership and organizational relationships',
  public_health: 'Public health surveillance',
  quality: 'Quality and outcomes',
  payer: 'Payer and coverage',
  utilization: 'Hospital and provider utilization',
  workforce: 'Healthcare workforce',
  'topic:hospital-financials': 'Hospital financials',
  'topic:utilization': 'Hospital and provider utilization',
  'topic:claims': 'Claims and encounters',
  'topic:quality': 'Quality and outcomes',
  'topic:workforce': 'Healthcare workforce',
  'topic:public-health': 'Public health surveillance',
  'topic:payer': 'Payer and coverage',
  'topic:ownership': 'Ownership and organizational relationships',
  'topic:costs-prices': 'Costs, prices, and transparency',
  'use-case-metadata-discovery': 'Metadata discovery and source routing',
  'use-case-access-routing': 'Access routing'
};

export function resolveObservationClock(now, corpus = {}) {
  if (now == null || now === '') {
    return new Date(corpus.published_at ?? corpus.built_at ?? FROZEN_OBSERVATION_CLOCK);
  }
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(date.valueOf())) throw new TypeError('observation clock is invalid');
  return date;
}

function lastSuccessfulCatalogMetadataCheck(historical = {}) {
  const status = historical.verification_status;
  if (status === 'current_verified' || status === 'stale') return historical.metadata_observed_at ?? null;
  return null;
}

export function projectFreshness(record, now) {
  const clock = now instanceof Date ? now : resolveObservationClock(now);
  const historical = record?.freshness_verification ?? {};
  const base = freshnessState(record, clock);
  const lastSuccessful = lastSuccessfulCatalogMetadataCheck(historical);
  const failedRefresh = historical.failed_refresh_state ?? 'none_recorded';
  const latestAttemptAt = failedRefresh === 'none_recorded' ? lastSuccessful : (historical.latest_attempt_at ?? null);
  const latestAttemptOutcome = failedRefresh !== 'none_recorded'
    ? failedRefresh
    : historical.verification_status === 'current_verified'
      ? 'succeeded'
      : historical.verification_status ?? 'unknown';
  const staleStatus = historical.verification_status === 'stale'
    ? 'stale_historical_success'
    : base.freshness_state === 'overdue'
      ? 'review_overdue'
      : 'not_stale';
  return {
    ...base,
    evaluated_at: clock.toISOString(),
    last_successful_metadata_check: lastSuccessful,
    latest_attempt: {
      at: latestAttemptAt,
      outcome: latestAttemptOutcome,
      scope: 'catalog_metadata'
    },
    catalog_metadata_check: {
      state: historical.verification_status ?? 'unknown',
      at: historical.metadata_observed_at ?? null,
      scope: 'catalog_metadata'
    },
    payload_check: {
      state: 'not_attempted',
      at: null,
      scope: 'payload',
      note: 'Catalog metadata observation is not a payload-access check.'
    },
    stale_status: staleStatus
  };
}

function resultFreshness(record, effectiveNow, requestClockProvided) {
  return requestClockProvided ? projectFreshness(record, effectiveNow) : freshnessState(record, effectiveNow);
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
  return [...reviewedTopics(record), ...(record.capabilities?.use_cases ?? [])];
}

function boundedRecordSearchText(record) {
  return normalizeText([
    record.title,
    record.description,
    record.identity?.asset?.name,
    record.identity?.match_fields?.normalized_title,
    record.identity?.match_fields?.publisher,
    record.identity?.source?.name,
    record.identity?.source?.source_id,
    ...capabilityRows(record).flatMap(capability => [capability.id, capability.label]),
    ...(record.unit_of_analysis ?? []),
    record.geography?.coverage_level,
    ...(record.geography?.jurisdictions ?? [])
  ].filter(Boolean).join(' '));
}

function normalizedPhrasePresent(normalizedText, normalizedPhrase) {
  if (!normalizedPhrase.length) return false;
  let offset = normalizedText.indexOf(normalizedPhrase);
  while (offset !== -1) {
    const end = offset + normalizedPhrase.length;
    if ((offset === 0 || normalizedText.charCodeAt(offset - 1) === 32)
      && (end === normalizedText.length || normalizedText.charCodeAt(end) === 32)) return true;
    offset = normalizedText.indexOf(normalizedPhrase, offset + 1);
  }
  return false;
}

function prepareScoring(parsed, vocabulary) {
  const conceptTokens = new Set(parsed.interpretation.geographies
    .flatMap(match => [match.label, ...(match.matched_aliases ?? [])])
    .flatMap(value => normalizeText(value).split(' '))
    .filter(Boolean));
  const lexicalTokens = [...new Set((parsed.interpretation.positive_terms ?? parsed.normalized_question.split(' '))
    .filter(token => token.length > 2 && !STOPWORDS.has(token) && !conceptTokens.has(token)))];
  const essentialTerms = (parsed.interpretation.positive_terms ?? [])
    .filter(term => term.length > 2 && !STOPWORDS.has(term))
    .filter(term => !parsed.interpretation.geographies.some(geo => [geo.label, ...(geo.matched_aliases ?? [])]
      .some(alias => normalizeText(alias).split(' ').includes(term))));
  const subjects = parsed.interpretation.subjects.map(subjectMatch => {
    const subject = (vocabulary.subjects ?? []).find(item => item.id === subjectMatch.id);
    const payerNames = (subjectMatch.matched_aliases ?? [])
      .map(normalizeText)
      .filter(term => ['medicaid', 'medicare', 'medical assistance', 'commercial payer'].includes(term));
    const terms = [...new Set((payerNames.length
      ? payerNames
      : [subject?.label, ...(subject?.record_terms ?? []), ...(subject?.aliases ?? [])]
        .filter(Boolean).map(normalizeText)).filter(Boolean))];
    const directAliasTokens = (subjectMatch.matched_aliases ?? [])
      .filter(alias => !alias.startsWith('implied_by:'))
      .map(alias => normalizeText(alias).split(' ').filter(Boolean));
    return { subjectMatch, terms, directAliasTokens };
  });
  const supportedExclusions = parsed.interpretation.exclusions
    .filter(item => item.support === 'supported')
    .map(item => normalizeText(item.normalized_phrase).split(' ').map(singularToken).join(' '));
  return { lexicalTokens, essentialTerms, subjects, supportedExclusions };
}

function prepareRecordScoring(record, lexicalIndex) {
  return {
    directTokenBases: `${lexicalIndex[0].text} ${lexicalIndex[1].text}`,
    capabilities: capabilityRows(record).map(capability => ({
      capability,
      text: JSON.parse(JSON.stringify(normalizeText([capability.id, capability.label, capability.rationale].join(' ')))),
      id: normalizeText(capability.id).replace(/^topic /, '')
    }))
  };
}

function subjectScore(record, preparedSubjects, searchText, recordScoring) {
  const document = searchText ?? recordSearchText(record);
  const components = [];
  const matchedSubjects = [];
  const supportedSubjects = [];
  for (const { subjectMatch, terms, directAliasTokens } of preparedSubjects) {
    const matchingEntries = recordScoring.capabilities.filter(entry => terms.some(term => normalizedPhrasePresent(entry.text, term)));
    const matchingCapabilities = matchingEntries.map(entry => entry.capability);
    if (!matchingCapabilities.length && !terms.some(term => normalizedPhrasePresent(document, term))) continue;
    matchedSubjects.push(subjectMatch.id);
    const directTextMatch = directAliasTokens.some(aliasTokens => aliasTokens.every(term => normalizedPhrasePresent(recordScoring.directTokenBases, singularToken(term))));
    const identityCapability = matchingEntries.find(({ capability, id }) => {
      return id === normalizeText(subjectMatch.id).replaceAll('_', ' ')
        && ['primary', 'supporting'].includes(capability.fitness)
        && ['verified_first_party', 'source_asserted'].includes(capability.evidence_state);
    })?.capability;
    if (directTextMatch || identityCapability) supportedSubjects.push(subjectMatch.id);
    if (identityCapability) {
      const best = identityCapability;
      const value = (FITNESS_WEIGHT[best.fitness] ?? 0) + (EVIDENCE_WEIGHT[best.evidence_state] ?? 0);
      components.push({ kind: 'subject_capability', value, reason: `${subjectMatch.label} matches identity-bound ${best.fitness} capability ${best.label}.`, evidence_state: best.evidence_state });
    } else if (directTextMatch) {
      components.push({ kind: 'subject_direct_text', value: 28, reason: `${subjectMatch.label} is stated directly in publisher title or description text.`, evidence_state: 'source_asserted' });
    } else if (matchingCapabilities.length) {
      const best = matchingCapabilities.sort((a, b) => (FITNESS_WEIGHT[b.fitness] ?? 0) - (FITNESS_WEIGHT[a.fitness] ?? 0))[0];
      const value = Math.min(12, (FITNESS_WEIGHT[best.fitness] ?? 0) / 4);
      components.push({ kind: 'subject_context', value, reason: `${subjectMatch.label} has contextual capability metadata only.`, evidence_state: best.evidence_state });
    } else {
      components.push({ kind: 'subject_context', value: 6, reason: `${subjectMatch.label} matches broader indexed metadata only.`, evidence_state: 'inferred' });
    }
  }
  return { components, matchedSubjects, supportedSubjects };
}

function geographyScore(record, interpretation) {
  if (!interpretation.geographies.length) return { eligible: true, components: [], matched: [], compatibility: 'not_requested', uncertainty: [] };
  const jurisdictions = new Set(record.geography?.jurisdictions ?? []);
  const coverage = record.geography?.coverage_level;
  const components = [];
  const matched = [];
  let hasUnknown = false;
  let hasIncompatible = false;
  for (const geography of interpretation.geographies) {
    const code = geography.id.toUpperCase();
    if (jurisdictions.has(code)) {
      components.push({ kind: 'geography_exact', value: 24, reason: `Record explicitly covers ${geography.label}.`, evidence_state: record.geography?.evidence_state ?? 'unresolved' });
      matched.push(code);
    } else if (code !== 'US' && (jurisdictions.has('US') || coverage === 'unknown' || jurisdictions.has('unknown'))) {
      hasUnknown = true;
      components.push({ kind: 'geography_unknown', value: 0, reason: `Coverage for ${geography.label} is unknown; national catalog scope is not treated as state support.`, evidence_state: 'unresolved' });
    } else hasIncompatible = true;
  }
  const compatibility = matched.length ? 'supported' : hasUnknown ? 'unknown' : hasIncompatible ? 'incompatible' : 'unknown';
  return {
    eligible: compatibility !== 'incompatible',
    components,
    matched,
    compatibility,
    uncertainty: compatibility === 'unknown' ? ['geographic_coverage_unknown'] : []
  };
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
    components: matched.map(unit => ({ kind: 'unit_inferred', value: 5, reason: `An inferred search tag includes ${unit.label}; observation grain remains unresolved.`, evidence_state: 'inferred' }))
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
  if (!window) return { eligible: true, components: [], compatibility: 'not_requested', uncertainty: [] };
  const recordYears = years(record);
  if (!recordYears.length) return { eligible: true, compatibility: 'unknown', uncertainty: ['observation_period_unknown'], components: [{ kind: 'time_unknown', value: 0, reason: 'Observation coverage is unknown; release or verification dates were not substituted.', evidence_state: 'unresolved' }] };
  const start = Math.min(...recordYears);
  const end = Math.max(...recordYears);
  const queryStart = window.start_year ?? -Infinity;
  const queryEnd = window.end_year ?? Infinity;
  if (end < queryStart || start > queryEnd) return { eligible: false, compatibility: 'incompatible', uncertainty: [], components: [] };
  return { eligible: true, compatibility: 'supported', uncertainty: [], components: [{ kind: 'time_overlap', value: 8, reason: `Documented observation coverage ${start}-${end} overlaps the requested window.`, evidence_state: record.time_coverage?.evidence_state ?? 'unresolved' }] };
}

function cachedAccessDimensions(record, recordScoring) {
  if (recordScoring?.accessDimensions) return recordScoring.accessDimensions;
  const dimensions = accessDimensions(record);
  if (recordScoring) recordScoring.accessDimensions = dimensions;
  return dimensions;
}

function accessScore(record, parsed, recordScoring = null) {
  const status = record.access?.status ?? 'unknown';
  if (parsed.raw.access_statuses.length && !parsed.raw.access_statuses.includes(status)) return { eligible: false, components: [], compatibility: 'incompatible', uncertainty: [] };
  if (!parsed.interpretation.access_intent.include_restricted && RESTRICTED.has(status)) return { eligible: false, components: [], compatibility: 'incompatible', uncertainty: [] };
  const publicRequested = parsed.interpretation.access_intent.public_only;
  const costRequested = parsed.interpretation.access_intent.cost_requirement === 'documented_no_fee';
  const dimensions = publicRequested || costRequested ? cachedAccessDimensions(record, recordScoring) : null;
  if (publicRequested && dimensions.payload_access === 'documented_restricted') return { eligible: false, components: [], compatibility: 'incompatible', uncertainty: [] };
  const documentedPublic = publicRequested ? dimensions.payload_access === 'documented_public' : false;
  const publicCompatibility = !publicRequested ? 'not_requested' : documentedPublic ? 'supported' : 'unknown';
  const costState = costRequested ? dimensions.cost_state : null;
  const costCompatibility = !costRequested
    ? 'not_requested'
    : costState === 'documented_free'
      ? 'supported'
      : costState === 'payment_required' ? 'incompatible' : 'unknown';
  if (costCompatibility === 'incompatible') return { eligible: false, components: [], compatibility: 'incompatible', uncertainty: [] };
  const requestedCompatibilities = [publicCompatibility, costCompatibility].filter(value => value !== 'not_requested');
  const compatibility = requestedCompatibilities.includes('unknown')
    ? 'unknown'
    : requestedCompatibilities.length ? 'supported' : 'not_requested';
  const uncertainty = [];
  if (publicCompatibility === 'unknown') uncertainty.push('public_payload_access_unknown');
  if (costCompatibility === 'unknown') uncertainty.push('cost_evidence_unknown');
  const components = [];
  if (publicRequested) components.push({
    kind: 'access',
    value: documentedPublic ? 18 : 0,
    reason: RESTRICTED.has(status) ? `Relevant but access is ${status}; restrictions remain visible.` : `Access status is ${status}.`,
    evidence_state: record.access?.evidence_state ?? 'unresolved'
  });
  if (costRequested) components.push({
    kind: 'cost',
    value: costCompatibility === 'supported' ? 6 : 0,
    reason: costCompatibility === 'supported'
      ? 'The indexed asset has documented absence of fees.'
      : 'The indexed asset has no documented evidence establishing absence of fees.',
    evidence_state: costCompatibility === 'supported' ? record.access?.evidence_state ?? 'unresolved' : 'unresolved'
  });
  return {
    eligible: true,
    compatibility,
    uncertainty,
    components
  };
}

function singularToken(token) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(?:ches|shes|xes|zes|oes)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function tokenMatch(queryToken, fieldTokens) {
  // Exact token matches are overwhelmingly common and Array#includes stays in
  // the runtime's optimized native loop. Only pay the singularization cost
  // when an exact token is absent.
  if (fieldTokens.includes(queryToken)) return { kind: 'exact', token: queryToken };
  const queryBase = singularToken(queryToken);
  for (const token of fieldTokens) if (queryBase === singularToken(token)) return { kind: 'exact', token };
  return null;
}

function compactLexicalIndex(record, document) {
  const compact = text => [...new Set([...new Set(text.split(' ').filter(Boolean))].map(singularToken))].join(' ');
  return [
    { kind: 'title', weight: 10, text: compact(normalizeText(record.title)) },
    { kind: 'description', weight: 4, text: compact(normalizeText(record.description)) },
    { kind: 'record', weight: 2, text: compact(document) }
  ];
}

function lexicalScore(record, tokens, searchText, lexicalIndex) {
  const document = searchText ?? recordSearchText(record);
  const fields = lexicalIndex ?? compactLexicalIndex(record, document);
  const matchedRows = tokens.map(token => {
    const base = singularToken(token);
    const field = fields.find(field => normalizedPhrasePresent(field.text, base));
    return field ? { query: token, field } : null;
  }).filter(Boolean);
  const matched = matchedRows.map(row => row.query);
  const components = [];
  const anchor = tokens[0];
  if (anchor && matchedRows.some(row => row.query === anchor && ['title', 'description'].includes(row.field.kind))) {
    components.push({ kind: 'lexical_essential_anchor', value: 24, reason: `Publisher metadata directly states the leading essential term: ${anchor}.`, evidence_state: 'source_asserted' });
  }
  for (const field of fields) {
    const rows = matchedRows.filter(row => row.field.kind === field.kind);
    if (!rows.length) continue;
    const labels = rows.map(row => row.query);
    const value = rows.reduce(sum => sum + field.weight, 0);
    components.push({ kind: `lexical_${field.kind}`, value, reason: `${field.kind === 'title' ? 'Title' : 'Record'} text matches: ${labels.join(', ')}.`, evidence_state: 'inferred' });
  }
  return {
    matched,
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

function scoreRecord(record, parsed, prepared, searchText, lexicalIndex, recordScoring) {
  const document = searchText ?? recordSearchText(record);
  const geography = geographyScore(record, parsed.interpretation);
  if (!geography.eligible) return null;
  const unit = unitScore(record, parsed.interpretation);
  if (!unit.eligible) return null;
  const time = timeScore(record, parsed.interpretation);
  if (!time.eligible) return null;
  const access = accessScore(record, parsed, recordScoring);
  if (!access.eligible) return null;
  const subject = subjectScore(record, prepared.subjects, document, recordScoring);
  const lexical = lexicalScore(record, prepared.lexicalTokens, document, lexicalIndex);
  if (prepared.supportedExclusions.length) {
    const exclusionText = document.split(' ').map(singularToken).join(' ');
    if (prepared.supportedExclusions.some(phrase => containsNormalizedPhrase(exclusionText, phrase))) return null;
  }
  const namedSources = parsed.interpretation.named_sources ?? [];
  const directNamedSources = namedSources.filter(source => source.indexed_record_ids.includes(record.record_id));
  const mentionedNamedSources = namedSources.filter(source => !source.indexed_record_ids.includes(record.record_id)
    && [source.name, ...source.matched_aliases].some(alias => containsNormalizedPhrase(document, alias)));
  const namedSourceComponents = directNamedSources.map(source => ({ kind: 'named_source_direct', value: 120, reason: `This record directly represents requested source ${source.name}.`, evidence_state: source.registry_evidence_state }))
    .concat(mentionedNamedSources.map(source => ({ kind: 'named_source_mention', value: 2, reason: `Record text mentions ${source.name} but does not represent that source.`, evidence_state: 'inferred' })));
  if (namedSources.length && !directNamedSources.length && !mentionedNamedSources.length) return null;
  const components = [...namedSourceComponents, ...subject.components, ...geography.components, ...unit.components, ...time.components, ...access.components, ...lexical.components];
  const subjectRequired = parsed.interpretation.subjects.length > 0;
  if (subjectRequired && subject.matchedSubjects.length !== parsed.interpretation.subjects.length) return null;
  const explicitGeographyFilterMatched = parsed.raw.geography.codes.length > 0 && geography.matched.length > 0;
  if (!subjectRequired && !lexical.matched.length && !unit.matched.length && !explicitGeographyFilterMatched) return null;
  const essentialConceptsSupported = prepared.essentialTerms.length > 0 && prepared.essentialTerms.every(term => normalizedPhrasePresent(recordScoring.directTokenBases, singularToken(term)));
  const subjectsSupported = !subjectRequired || subject.supportedSubjects.length === parsed.interpretation.subjects.length;
  const namedSourceSupported = !namedSources.length || directNamedSources.length === namedSources.length;
  const semanticSupport = essentialConceptsSupported && subjectsSupported && namedSourceSupported && !parsed.interpretation.access_intent.ambiguity;
  return {
    record,
    score: components.reduce((sum, component) => sum + component.value, 0),
    components,
    matched_subjects: subject.matchedSubjects,
    matched_geographies: geography.matched,
    matched_units: unit.matched,
    matched_terms: lexical.matched
    ,geography_compatibility: geography.compatibility
    ,time_compatibility: time.compatibility
    ,access_compatibility: access.compatibility
    ,uncertainty_reasons: [...geography.uncertainty, ...time.uncertainty, ...access.uncertainty]
    ,named_source_role: directNamedSources.length ? 'direct_source' : mentionedNamedSources.length ? 'secondary_mention' : 'not_applicable'
    ,semantic_support: semanticSupport
  };
}

function dateValue(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  if (!Number.isNaN(parsed)) return parsed;
  const year = String(value).match(/\b(?:18|19|20|21)\d{2}\b/);
  return year ? Date.UTC(Number(year[0]), 0, 1) : null;
}

function sortMatches(matches, sort) {
  const canonical = (a, b) => b.score - a.score || a.record.record_id.localeCompare(b.record.record_id);
  if (sort === 'title_asc') return matches.sort((a, b) => a.record.title.localeCompare(b.record.title) || a.record.record_id.localeCompare(b.record.record_id));
  if (sort === 'release_newest') return matches.sort((a, b) => {
    const left = dateValue(dateDimensions(a.record).publisher_release_date);
    const right = dateValue(dateDimensions(b.record).publisher_release_date);
    return (left === null) - (right === null) || (right ?? 0) - (left ?? 0) || canonical(a, b);
  });
  if (sort === 'observation_latest') return matches.sort((a, b) => {
    const left = dateValue(a.record.time_coverage?.end ?? a.record.time_coverage?.start);
    const right = dateValue(b.record.time_coverage?.end ?? b.record.time_coverage?.start);
    return (left === null) - (right === null) || (right ?? 0) - (left ?? 0) || canonical(a, b);
  });
  return matches.sort(canonical);
}

function observedFacetLabel(matches, sectionId, value) {
  const labels = new Set();
  for (const item of matches) {
    if (sectionId === 'source' && item.record.identity?.source?.source_id === value && item.record.identity.source.name) {
      labels.add(item.record.identity.source.name);
    }
    if (sectionId === 'capability') {
      for (const capability of capabilityRows(item.record)) {
        if (capability.id === value && capability.label) labels.add(capability.label);
      }
    }
  }
  return labels.size === 1 ? [...labels][0] : null;
}

function readableFacetLabel(matches, sectionId, value) {
  const captured = observedFacetLabel(matches, sectionId, value);
  if (captured) return captured;
  if (sectionId === 'source') return FACET_SOURCE_LABELS[value] ?? value;
  if (sectionId === 'access_status') return FACET_ACCESS_LABELS[value] ?? value;
  if (sectionId === 'geography') {
    if (FACET_GEOGRAPHY_LABELS[value]) return FACET_GEOGRAPHY_LABELS[value];
    if (/^US-[A-Z]{2}$/.test(String(value))) return 'United States jurisdiction ' + String(value).slice(3);
    return value;
  }
  if (sectionId === 'unit_of_analysis') return FACET_UNIT_LABELS[value] ?? value;
  if (sectionId === 'capability') {
    if (FACET_CAPABILITY_LABELS[value]) return FACET_CAPABILITY_LABELS[value];
    if (/^use-case[:\-]/.test(String(value))) return 'Unresolved research concept';
  }
  return value;
}

function facetResponse(matches) {
  const specifications = [
    ['source', 'Source', item => [item.record.identity?.source?.source_id]],
    ['geography', 'Geography', item => [item.record.geography?.coverage_level, ...(item.record.geography?.jurisdictions ?? [])]],
    ['access_status', 'Access status', item => [item.record.access?.status]],
    ['unit_of_analysis', 'Inferred unit tag', item => item.record.unit_of_analysis ?? []],
    ['capability', 'Research concept', item => capabilityRows(item.record).map(value => value.id)]
  ];
  return {
    count_basis: 'records',
    collection_scope: 'all_matching_records_before_pagination',
    approximate: false,
    sections: specifications.map(([id, label, values]) => {
      const counts = new Map();
      for (const item of matches) for (const value of new Set(values(item).filter(Boolean))) counts.set(value, (counts.get(value) ?? 0) + 1);
      return { id, label, options: [...counts].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([value, count]) => ({ value, label: readableFacetLabel(matches, id, value), count })) };
    })
  };
}

function cursorError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function encodeCursor(value) {
  const json = JSON.stringify(value);
  if (typeof Buffer !== 'undefined') return Buffer.from(json).toString('base64url');
  return btoa(unescape(encodeURIComponent(json))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeCursor(value) {
  try {
    if (typeof Buffer !== 'undefined') return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    return JSON.parse(decodeURIComponent(escape(atob(base64))));
  } catch {
    cursorError('invalid_cursor', 'The continuation cursor is malformed; restart traversal from the first page.');
  }
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

export function createRetrievalEngine({ lexicalArtifact = null, diagnostic = null, records, searchDocuments, joinRoutes = [], vocabulary, corpus, namedSourceRegistry = null, catalogValidation: suppliedCatalogValidation = null }) {
  const mark = stage => { if(typeof diagnostic === 'function') diagnostic({stage, wall_ms: performance.now()}); };
  mark('engine_start');
  if (!Array.isArray(records) || records.length === 0) throw new TypeError('records must be a non-empty array');
  if (!vocabulary || !Array.isArray(vocabulary.subjects) || !Array.isArray(vocabulary.geographies) || !Array.isArray(vocabulary.units)) throw new TypeError('vocabulary must define subjects, geographies, and units');
  const catalogValidation = suppliedCatalogValidation ?? validateCatalogRecords(records);
  if (!catalogValidation.valid.length) throw new TypeError('catalog contains no browser-compatible records');
  mark('validation_complete');
  if (lexicalArtifact && searchDocuments !== null) throw new TypeError('LEXICAL_PROJECTION_MODE_MISMATCH');
  const recordIds = new Set(catalogValidation.valid.map(record => record.record_id));
  const routeIssues = [];
  const acceptedRoutes = [];
  for (const route of joinRoutes) {
    try {
      validateJoinRoute(route);
      if (!recordIds.has(route.from_record_id) || !recordIds.has(route.to_record_id)) throw new TypeError('route references an unavailable or invalid record');
      acceptedRoutes.push(route);
    } catch (error) {
      routeIssues.push({ code: 'invalid_join_route', route_id: route?.route_id ?? null, errors: [error.message] });
    }
  }
  // `null` is an explicit memory-bounded runtime mode: derive search text from
  // each canonical record on demand instead of retaining duplicate projections.
  const projectMissingDocuments = searchDocuments !== null;
  const projectedDocuments = searchDocuments === null ? [] : searchDocuments ?? projectSearchDocuments(catalogValidation.valid, acceptedRoutes);
  if (!Array.isArray(projectedDocuments)) throw new TypeError('searchDocuments must be an array');
  const searchDocumentByRecord = new Map();
  const documentIssues = [];
  for (const document of projectedDocuments) {
    if (!recordIds.has(document?.resource_record_id) || searchDocumentByRecord.has(document?.resource_record_id)
      || document.authoritative_record !== false || document.projection_role !== 'discovery_view') {
      documentIssues.push({ code: 'invalid_search_document', record_id: document?.resource_record_id ?? null, errors: ['Projection is missing, duplicated, authoritative, or references an invalid record.'] });
      continue;
    }
    searchDocumentByRecord.set(document.resource_record_id, structuredClone(document));
  }
  for (const record of catalogValidation.valid) if (projectMissingDocuments && !searchDocumentByRecord.has(record.record_id)) {
    const [projection] = projectSearchDocuments([record], acceptedRoutes);
    searchDocumentByRecord.set(record.record_id, projection);
    documentIssues.push({ code: 'search_document_regenerated', record_id: record.record_id, errors: ['Missing or incompatible projection was regenerated from the valid canonical record.'] });
  }
  // The Worker passes `null` to avoid retaining the much larger projection
  // objects. Cache only the normalized strings needed for scoring so repeated
  // requests neither reconstruct them nor accumulate short-lived heap.
  if (searchDocuments === null) {
    for (const record of catalogValidation.valid) {
      searchDocumentByRecord.set(record.record_id, { search_text: boundedRecordSearchText(record) });
    }
  }
  // Worker ingestion supplies an already validated, privately parsed catalog.
  // Share those records to stay within isolate memory; external callers retain
  // the defensive clone behavior.
  const frozenRecords = suppliedCatalogValidation
    ? catalogValidation.valid
    : structuredClone(catalogValidation.valid).map(record => ({
      ...record,
      capabilities: { ...record.capabilities, topics: reviewedTopics(record) }
    }));
  const frozenRoutes = structuredClone(acceptedRoutes);
  const frozenVocabulary = structuredClone(vocabulary);
  const frozenNamedSources = structuredClone(namedSourceRegistry);
  const frozenCorpus = structuredClone(corpus ?? { corpus_id: 'observatory-offline-fixture', corpus_version: '1.0.0', evidence_mode: 'published_offline_evidence' });
  mark('search_text_complete');
  const lexicalIndexes = lexicalArtifact ? consumeLexicalArtifact(lexicalArtifact, frozenRecords.map(record => record.record_id)) : new Map(frozenRecords.map(record => [record.record_id,
    compactLexicalIndex(record, searchDocumentByRecord.get(record.record_id)?.search_text ?? recordSearchText(record))]));
  mark('lexical_index_complete');
  // Private immutable-catalog cache: one entry per accepted record, never per query.
  // Retain compact normalized text; token arrays remain request-local to bound heap.
  const recordScoring = new Map(frozenRecords.map(record => [record.record_id, prepareRecordScoring(record, lexicalIndexes.get(record.record_id))]));
  mark('scoring_cache_complete');
  const generation = frozenCorpus.manifest_sha256 ?? `${frozenCorpus.corpus_id}@${frozenCorpus.corpus_version}`;
  const partialIssues = [...catalogValidation.invalid, ...routeIssues, ...documentIssues];
  return Object.freeze({
    interpret(rawQuery) {
      return structuredClone(compileDiscoveryIntent(rawQuery, frozenVocabulary, frozenNamedSources));
    },
    retrieve(rawQuery, { signal, now = null, browse = false } = {}) {
      const requestClockProvided = now != null && now !== '';
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const intent = compileDiscoveryIntent(rawQuery, frozenVocabulary, frozenNamedSources);
      const parsed = { ...intent, raw: intent.filters };
      const preparedScoring = prepareScoring(parsed, frozenVocabulary);
      const effectiveNow = resolveObservationClock(now, frozenCorpus);
      if (!SORTS.has(parsed.raw.sort)) cursorError('unsupported_sort', 'The requested sort is not supported by this ranking release.');
      if (parsed.raw.generation && parsed.raw.generation !== generation) cursorError('generation_unavailable', 'The requested catalog generation is unavailable; restart against the published generation.');
      const cursorSignature = stableHash(JSON.stringify({
        generation,
        question: parsed.normalized_question,
        geography: parsed.raw.geography,
        subjects: parsed.raw.subjects,
        units: parsed.raw.units_of_analysis,
        access: parsed.raw.access_statuses,
        include_restricted: parsed.raw.include_restricted,
        time_window: parsed.raw.time_window,
        exclusions: parsed.raw.exclusions,
        facet_filters: parsed.raw.facet_filters,
        sort: parsed.raw.sort,
        page_size: parsed.raw.page_size
      }));
      let offset = 0;
      if (parsed.raw.cursor) {
        const decoded = decodeCursor(parsed.raw.cursor);
        if (decoded.v !== 1 || decoded.generation !== generation) cursorError('generation_unavailable', 'The continuation cursor refers to an unavailable catalog generation; restart traversal.');
        if (decoded.signature !== cursorSignature) cursorError('cursor_query_mismatch', 'The continuation cursor does not match this query, filters, sort, and page size; restart traversal.');
        if (!Number.isInteger(decoded.offset) || decoded.offset < 0) cursorError('invalid_cursor', 'The continuation cursor has an invalid offset; restart traversal.');
        offset = decoded.offset;
      }
      let matches = browse
        ? frozenRecords.map(record => ({
          record,
          score: 0,
          components: [],
          matched_subjects: [],
          matched_geographies: [],
          matched_units: [],
          matched_terms: [],
          uncertainty_reasons: [],
          named_source_role: null,
          semantic_support: false,
          geography_compatibility: 'not_requested',
          time_compatibility: 'not_requested',
          access_compatibility: 'not_requested'
        }))
        : frozenRecords
          .map(record => scoreRecord(record, parsed, preparedScoring,
            searchDocumentByRecord.get(record.record_id)?.search_text, lexicalIndexes.get(record.record_id), recordScoring.get(record.record_id)))
          .filter(Boolean)
          .filter(item => item.score > 0);
      const facetValues = (item, key) => key === 'source' ? [item.record.identity?.source?.source_id]
        : key === 'geography' ? [item.record.geography?.coverage_level, ...(item.record.geography?.jurisdictions ?? [])]
          : key === 'access_status' ? [item.record.access?.status]
            : key === 'unit_of_analysis' ? item.record.unit_of_analysis ?? []
              : capabilityRows(item.record).map(value => value.id);
      for (const [key, required] of Object.entries(parsed.raw.facet_filters)) {
        if (required.length) matches = matches.filter(item => required.some(value => facetValues(item, key).includes(value)));
      }
      const facets = facetResponse(matches);
      sortMatches(matches, parsed.raw.sort);
      if (offset > matches.length) cursorError('cursor_out_of_range', 'The continuation cursor is outside the complete matching collection; restart traversal.');
      const ranked = matches.slice(offset, offset + parsed.raw.page_size);
      const selectedRecords = ranked.map(item => item.record);
      const warnings = [];
      if (!browse && !parsed.interpretation.subjects.length) warnings.push('No controlled subject concept matched; retrieval used explicit filters and bounded lexical matching only.');
      if (!ranked.length) warnings.push('No published offline record matched. This is not evidence that no source exists.');
      warnings.push(...parsed.interpretation.interpretation_warnings);
      if (partialIssues.length) warnings.push(`${partialIssues.length} incompatible catalog item(s) were isolated; valid partial results remain available.`);
      warnings.push('Results describe indexed metadata and retrieval routes; they do not prove current endpoint availability or authorize access.');
      const nextOffset = offset + ranked.length;
      const hasMore = nextOffset < matches.length;
      const nextCursor = hasMore ? encodeCursor({ v: 1, generation, signature: cursorSignature, offset: nextOffset }) : null;
      const namedSourceResolution = (parsed.interpretation.named_sources ?? []).map(source => ({
        source_id: source.source_id,
        name: source.name,
        state: source.indexed_record_ids.some(id => recordIds.has(id)) ? 'indexed' : 'coverage_gap',
        indexed_record_ids: source.indexed_record_ids.filter(id => recordIds.has(id)),
        official_discovery_url: source.official_discovery_url,
        message: source.indexed_record_ids.some(id => recordIds.has(id))
          ? 'The requested source is represented by a direct catalog record.'
          : 'The requested source is not indexed in this generation; secondary mentions do not stand in for it.'
      }));
      const resultRows = ranked.map((item, index) => ({
        rank: offset + index + 1,
        score: item.score,
        record_id: item.record.record_id,
        match_state: !item.semantic_support ? 'contextual' : item.uncertainty_reasons.length ? 'uncertain' : 'supported',
        uncertainty_reasons: [...new Set(item.uncertainty_reasons)],
        metadata: {
          dimensions: metadataDimensions(item.record),
          dates: dateDimensions(item.record),
          access: { ...(cachedAccessDimensions(item.record, recordScoring.get(item.record.record_id))) },
          freshness: resultFreshness(item.record, effectiveNow, requestClockProvided),
          description_quality: descriptionQuality(item.record),
          claim_evidence: auditEvidence(item.record),
          retrieval_plan: retrievalPlan(item.record),
          named_source_role: item.named_source_role,
          geographic_compatibility: item.geography_compatibility,
          observation_time_compatibility: item.time_compatibility,
          access_compatibility: item.access_compatibility
        },
        relevance: {
          matched_subjects: item.matched_subjects,
          matched_geographies: item.matched_geographies,
          matched_units: item.matched_units,
          matched_terms: item.matched_terms,
          score_components: item.components,
          why_relevant: explain(item.record, item.components, item.matched_subjects)
        },
        record: structuredClone(item.record)
      }));
      return {
        contract_version: 'observatory-discovery-result.v1.0.0',
        retrieval_id: stableResultId(parsed, ranked, `${frozenCorpus.corpus_id}:${generation}:${offset}`),
        evidence_mode: 'published_offline_evidence',
        corpus: { ...frozenCorpus, generation, record_count: frozenCorpus.record_count ?? frozenRecords.length, search_document_count: frozenCorpus.search_document_count ?? searchDocumentByRecord.size, join_route_count: frozenRoutes.length },
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
            exclusions: intent.filters.exclusions,
            facet_filters: intent.filters.facet_filters,
            sort: intent.filters.sort,
            generation,
            cursor: intent.filters.cursor,
            page_size: intent.filters.page_size,
            limit: intent.filters.limit
          }
        },
        ranking: { version: RANKING_VERSION, sort: parsed.raw.sort, ordered_ids: resultRows.map(item => item.record_id) },
        pagination: { generation, cursor: parsed.raw.cursor, next_cursor: nextCursor, has_more: hasMore, page_size: parsed.raw.page_size, total_matches: matches.length },
        facets,
        sections: {
          supported: resultRows.filter(item => item.match_state === 'supported').map(item => item.record_id),
          uncertain: resultRows.filter(item => item.match_state === 'uncertain').map(item => item.record_id),
          contextual: resultRows.filter(item => item.match_state === 'contextual').map(item => item.record_id)
        },
        named_source_resolution: namedSourceResolution,
        partial_results: { is_partial: partialIssues.length > 0, invalid_item_count: partialIssues.length, issues: structuredClone(partialIssues) },
        receipt: {
          manifest_version: 'observatory-search-manifest.v1.0.0',
          scope: 'current_page',
          question: intent.original_question,
          interpreted_constraints: structuredClone(intent.interpretation),
          filters: structuredClone(intent.filters),
          sort: parsed.raw.sort,
          displayed_ordered_ids: resultRows.map(item => item.record_id),
          ranking_version: RANKING_VERSION,
          catalog_generation: generation,
          generated_at: effectiveNow.toISOString(),
          citations: resultRows.map(item => ({ record_id: item.record_id, title: item.record.title, source_url: item.record.authoritative_url, evidence_ids: item.record.evidence.map(row => row.evidence_id) })),
          limitations: ['Receipt covers the current page, not every match.', 'Source availability and authorization must be checked at use time.']
        },
        result_count: ranked.length,
        returned_count: ranked.length,
        total_matches: matches.length,
        has_more: hasMore,
        results: resultRows,
        join_routes: selectJoinRoutes(frozenRoutes, selectedRecords),
        warnings
      };
    },
    browse(rawQuery = {}, options = {}) {
      return this.retrieve({ question: 'Browse published health systems data', ...rawQuery }, { ...options, browse: true });
    }
  });
}

export function buildLexicalEntries(records) { return records.map(record => [record.record_id, compactLexicalIndex(record, boundedRecordSearchText(record))]); }
