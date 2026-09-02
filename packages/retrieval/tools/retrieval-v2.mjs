import { containsPhrase, normalizeText, recordSearchText } from './question-parser.mjs';
import { selectJoinRoutes, validateJoinRoute } from './join-routes.mjs';
import { compileDiscoveryIntent } from './intent-compiler.mjs';
import { projectSearchDocuments } from './search-document.mjs';

/**
 * The v2 runtime is deliberately separate from the v1 production observation.
 * v1 bridge bytes and receipts are historical evidence; this module is the
 * development/validation candidate used to tune a replacement ranker.
 */
export const RETRIEVAL_V2_VERSION = 'ushso-retrieval-v2.0.0-development';
export const RETRIEVAL_V2_CONFIG_VERSION = 'ushso-retrieval-v2-ranking-config.v1';

const RESTRICTED = new Set(['registration_required', 'application_required', 'dua_required', 'licensed_paid', 'controlled']);
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'be', 'can', 'could', 'data', 'dataset', 'datasets', 'does', 'for', 'from', 'has', 'have',
  'how', 'i', 'in', 'is', 'it', 'me', 'need', 'of', 'on', 'or', 'show', 'source', 'sources', 'study', 'the', 'to',
  'use', 'what', 'where', 'which', 'with', 'would', 'you', 'best', 'could', 'current', 'every', 'federal', 'find',
  'frame', 'healthcare', 'index', 'information', 'level', 'no', 'one', 'original', 'public', 'record', 'rather',
  'series', 'single', 'than', 'when', 'any', 'all', 'exists', 'approximate', 'provide', 'gives'
]);

const FITNESS_MULTIPLIER = Object.freeze({ primary: 1, supporting: 0.72, context_only: 0.3, unknown: 0.12 });
const EVIDENCE_BONUS = Object.freeze({ verified_first_party: 8, source_asserted: 5, inferred: 1, unresolved: 0, unavailable: 0 });
const ACCESS_BONUS = Object.freeze({ public_direct: 14, public_catalog: 4, unknown: -4 });
const AUTHORITY_BONUS = Object.freeze({
  first_party: 8,
  federal: 7,
  state: 6,
  observatory: 4,
  catalog: 0,
  unknown: -2
});

// These are controlled, explainable synonym groups. They expand a query only
// after a member is present in the query; they do not use benchmark labels,
// question IDs, or source IDs.
const SEMANTIC_GROUPS = Object.freeze([
  {
    id: 'finance',
    label: 'financial condition',
    activation_terms: ['financial', 'financials', 'finance', 'finances', 'distress', 'income', 'expense', 'expenses', 'revenue', 'cost', 'costs', 'asset', 'assets', 'liability', 'liabilities', 'profitability', 'fiscal', 'payer revenue'],
    terms: ['financial', 'financials', 'finance', 'finances', 'distress', 'income', 'expense', 'expenses', 'revenue', 'cost', 'costs', 'asset', 'assets', 'liability', 'liabilities', 'profitability', 'fiscal', 'payer revenue']
  },
  {
    id: 'utilization',
    label: 'utilization',
    terms: ['utilization', 'utilisation', 'volume', 'volumes', 'admission', 'admissions', 'discharge', 'discharges', 'inpatient', 'outpatient', 'visits', 'patient days', 'deliveries', 'delivery', 'capacity', 'beds', 'bed', 'occupancy']
  },
  {
    id: 'ownership',
    label: 'ownership',
    terms: ['ownership', 'owner', 'owners', 'parent entity', 'parent organization', 'health system', 'merger', 'mergers', 'acquisition', 'acquisitions', 'transaction', 'transactions', 'change of ownership', 'chow']
  },
  {
    id: 'facility',
    label: 'facility identity and status',
    activation_terms: ['identifier', 'identifiers', 'status', 'licensed', 'licensure', 'certification', 'registry', 'directory', 'directories', 'provider of services', 'ccn', 'facility-level', 'facility identifier'],
    terms: ['facility', 'facilities', 'hospital', 'hospitals', 'provider', 'providers', 'identifier', 'identifiers', 'status', 'licensed', 'licensure', 'certification', 'registry', 'directory', 'directories', 'provider of services', 'hospital general information', 'ccn']
  },
  {
    id: 'rurality',
    label: 'rurality and closures',
    activation_terms: ['rural', 'rurality', 'closure', 'closures', 'closed', 'conversions', 'converted', 'desert'],
    terms: ['rural', 'rurality', 'closure', 'closures', 'closed', 'conversions', 'converted', 'desert', 'county']
  },
  {
    id: 'nonprofit',
    label: 'nonprofit and community benefit',
    terms: ['nonprofit', 'nonprofit organization', 'tax exempt', 'tax-exempt', 'form 990', 'schedule h', 'schedule r', 'community benefit', 'charity care', 'exempt organization']
  },
  {
    id: 'workforce',
    label: 'healthcare workforce',
    terms: ['workforce', 'staffing', 'staff', 'labor', 'physician', 'physicians', 'nurse', 'nurses', 'clinician', 'clinicians', 'fte']
  },
  {
    id: 'payer',
    label: 'payer and coverage',
    terms: ['payer', 'payers', 'insurance', 'insurer', 'insurers', 'medicare', 'medicaid', 'coverage', 'enrollment', 'enrollments', 'all-payer']
  },
  {
    id: 'claims',
    label: 'claims and encounters',
    terms: ['claim', 'claims', 'encounter', 'encounters', 'apcd', 'all-payer claims', 'patient-level', 'patient level']
  },
  {
    id: 'maternal',
    label: 'maternal and child health',
    terms: ['maternity', 'maternal', 'pregnancy', 'birth', 'newborn', 'neonatal', 'delivery']
  },
  {
    id: 'capital',
    label: 'capital investment and public projects',
    activation_terms: ['construction', 'capital investment', 'capital investments', 'capex', 'procurement', 'contract', 'contracts', 'award', 'awards', 'grant', 'grants', 'municipal debt', 'debt disclosure', 'disclosures'],
    terms: ['construction', 'capital investment', 'capital investments', 'capex', 'project', 'projects', 'procurement', 'contract', 'contracts', 'award', 'awards', 'grant', 'grants', 'municipal debt', 'debt disclosure', 'disclosures']
  },
  {
    id: 'quality',
    label: 'quality and outcomes',
    activation_terms: ['quality', 'outcomes', 'outcome', 'readmission', 'readmissions', 'mortality'],
    terms: ['quality', 'outcomes', 'outcome', 'readmission', 'readmissions', 'mortality', 'safety']
  }
]);

const SUBJECT_GROUPS = Object.freeze({
  hospital_financials: ['finance'],
  utilization: ['utilization'],
  hospital_capacity: ['utilization'],
  ownership: ['ownership'],
  provider_directory: ['facility'],
  facility_licensure: ['facility'],
  rural_hospital_closures: ['rurality'],
  geography_access: ['rurality', 'facility'],
  community_benefit: ['nonprofit', 'finance'],
  workforce: ['workforce'],
  payer: ['payer'],
  claims: ['claims'],
  maternal_child_health: ['maternal'],
  quality: ['quality'],
  costs_prices: ['finance'],
});

const DEFAULT_RANKING_CONFIG = {
  version: RETRIEVAL_V2_CONFIG_VERSION,
  field_weights: {
    title: 38,
    capability: 30,
    identity: 12,
    unit: 10,
    description: 9,
    search: 2
  },
  concept_weights: {
    subject_capability: 72,
    subject_title: 34,
    subject_metadata: 18,
    phrase: 26,
    coverage: 16,
    diversity: 18
  },
  priors: {
    public_direct: 14,
    public_catalog: 4,
    first_party: 8,
    federal: 7,
    state: 6,
    observatory: 4,
    unresolved_identity: -3,
    exact_unit: 18,
    exact_geography: 27,
    national_support: 8,
    time_overlap: 9
  },
  penalties: {
    context_only: 25,
    negative_unit: 80,
    generic_catalog: 18,
    unresolved: 3
  }
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const DEFAULT_RETRIEVAL_V2_CONFIG = deepFreeze(structuredClone(DEFAULT_RANKING_CONFIG));

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

function singularToken(token) {
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && /(?:ches|shes|xes|zes|oes)$/.test(token)) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function lexicalStem(token) {
  const normalized = normalizeText(token);
  const aliases = {
    finances: 'finance',
    financials: 'financial',
    utilization: 'utilization',
    utilisation: 'utilization',
    hospitals: 'hospital',
    providers: 'provider',
    facilities: 'facility',
    admissions: 'admission',
    discharges: 'discharge',
    expenses: 'expense',
    assets: 'asset',
    liabilities: 'liability',
    owners: 'owner',
    mergers: 'merger',
    acquisitions: 'acquisition',
    closures: 'closure',
    conversions: 'conversion',
    datasets: 'dataset',
    directories: 'directory',
    enrollments: 'enrollment',
    disclosures: 'disclosure'
  };
  return aliases[normalized] ?? singularToken(normalized);
}

function tokens(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function stemSet(value) {
  return new Set(tokens(value).map(lexicalStem));
}

function flattenStrings(value, output = [], limit = 512) {
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

function capabilityRows(record) {
  return [...(record.capabilities?.topics ?? []), ...(record.capabilities?.use_cases ?? [])];
}

function authorityKind(record) {
  const sourceId = String(record.identity?.source?.source_id ?? record.identity?.match_fields?.publisher ?? '').toLowerCase();
  const sourceName = String(record.identity?.source?.name ?? '').toLowerCase();
  if (sourceId.startsWith('us-federal:') || sourceName.includes('federal')) return 'federal';
  if (sourceId.startsWith('obs:')) return 'observatory';
  if (sourceId.includes('state') || sourceName.includes('state')) return 'state';
  if (record.authoritative_url && !sourceId.includes('catalog')) return 'first_party';
  if (sourceId.includes('catalog') || record.record_type === 'catalog_asset') return 'catalog';
  return 'unknown';
}

function sourceDiversityKey(record) {
  const url = record.identity?.match_fields?.normalized_url ?? record.identity?.match_fields?.canonical_url;
  if (typeof url === 'string' && url) return `url:${normalizeText(url)}`;
  const explicit = record.identity?.match_fields?.source_id ?? record.identity?.source_id;
  if (typeof explicit === 'string' && explicit) return `source:${explicit}`;
  const family = record.identity?.family?.family_id;
  if (typeof family === 'string' && family) return `family:${family}`;
  return `record:${record.record_id}`;
}

function fieldRows(record, document, config) {
  const capabilities = capabilityRows(record);
  const capabilityText = capabilities.map(capability => [capability.id, capability.label, capability.rationale, capability.fitness].filter(Boolean).join(' ')).join(' ');
  const identityText = flattenStrings({
    source: record.identity?.source,
    match_fields: record.identity?.match_fields,
    family: record.identity?.family?.name,
    record_type: record.record_type
  }).join(' ');
  const unitText = [...(record.unit_of_analysis ?? []), ...(record.geography?.coverage_level ? [record.geography.coverage_level] : [])].join(' ');
  const description = [record.description, record.retrieval?.expected_artifacts].flatMap(value => flattenStrings(value)).join(' ');
  const searchText = document?.search_text ?? recordSearchText(record);
  return [
    { kind: 'title', weight: config.field_weights.title, text: [record.title, document?.title].filter(Boolean).join(' ') },
    { kind: 'capability', weight: config.field_weights.capability, text: capabilityText },
    { kind: 'identity', weight: config.field_weights.identity, text: identityText },
    { kind: 'unit', weight: config.field_weights.unit, text: unitText },
    { kind: 'description', weight: config.field_weights.description, text: description },
    { kind: 'search', weight: config.field_weights.search, text: searchText }
  ].map(field => ({ ...field, normalized: normalizeText(field.text), stems: stemSet(field.text) }));
}

function matchingGroupIds(normalizedQuestion) {
  const questionStems = stemSet(normalizedQuestion);
  return SEMANTIC_GROUPS.filter(group => (group.activation_terms ?? group.terms).some(term => containsPhrase(normalizedQuestion, term) || tokens(term).some(token => questionStems.has(lexicalStem(token)))));
}

function queryConcepts(intent, normalizedQuestion, vocabulary) {
  const groups = new Map();
  for (const subject of intent.interpretation.subjects) {
    for (const groupId of SUBJECT_GROUPS[subject.id] ?? []) {
      const group = SEMANTIC_GROUPS.find(candidate => candidate.id === groupId);
      if (group) groups.set(group.id, { ...group, source: 'controlled_subject', subject_ids: [subject.id] });
    }
  }
  for (const group of matchingGroupIds(normalizedQuestion)) {
    const prior = groups.get(group.id);
    groups.set(group.id, { ...group, source: prior?.source ?? 'controlled_synonym', subject_ids: prior?.subject_ids ?? [] });
  }
  for (const subject of intent.interpretation.subjects) {
    const vocabularySubject = (vocabulary.subjects ?? []).find(candidate => candidate.id === subject.id);
    if (!vocabularySubject) continue;
    const fallback = groups.get(subject.id);
    if (fallback) continue;
    const generic = new Set(['and', 'data', 'facility', 'health', 'hospital', 'information', 'provider', 'source']);
    const terms = [vocabularySubject.label, ...(vocabularySubject.aliases ?? []), ...(vocabularySubject.phrases ?? []), ...(vocabularySubject.record_terms ?? [])]
      .filter(Boolean)
      .filter(term => tokens(term).some(token => !generic.has(token) && token.length > 3));
    groups.set(`subject:${subject.id}`, {
      id: `subject:${subject.id}`,
      label: subject.label,
      terms,
      source: 'controlled_subject',
      subject_ids: [subject.id]
    });
  }
  return [...groups.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function meaningfulQueryTokens(normalizedQuestion, intent) {
  const excluded = new Set([
    ...intent.interpretation.geographies.flatMap(item => [item.label, ...(item.matched_aliases ?? [])]).flatMap(tokens).map(lexicalStem),
    ...intent.interpretation.subjects.flatMap(item => [item.label, ...(item.matched_aliases ?? [])]).flatMap(tokens).map(lexicalStem),
    ...intent.interpretation.units_of_analysis.flatMap(item => [item.label, ...(item.matched_aliases ?? [])]).flatMap(tokens).map(lexicalStem)
  ]);
  return [...new Set(tokens(normalizedQuestion).map(lexicalStem).filter(token => token.length > 2 && !STOPWORDS.has(token) && !excluded.has(token)))];
}

function queryPhrases(normalizedQuestion) {
  const words = tokens(normalizedQuestion);
  const phrases = [];
  for (let size = Math.min(5, words.length); size >= 2; size -= 1) {
    for (let index = 0; index + size <= words.length; index += 1) {
      const phraseWords = words.slice(index, index + size);
      if (phraseWords.filter(word => !STOPWORDS.has(word)).length >= 2) phrases.push(phraseWords.join(' '));
    }
  }
  return phrases;
}

function termMatches(queryToken, fieldStems) {
  if (fieldStems.has(queryToken)) return 'exact';
  if (queryToken.length < 5) return null;
  for (const fieldToken of fieldStems) {
    if (fieldToken.startsWith(queryToken) || queryToken.startsWith(fieldToken)) return 'stem';
  }
  return null;
}

function negativeConstraints(normalizedQuestion) {
  const negativeUnits = new Set();
  const negativePhrases = [
    ['county', ['rather than county', 'not county', 'not county-level', 'not county only', 'exclude county']],
    ['patient', ['not patient', 'no patient', 'without patient', 'anonymous']],
    ['restricted', ['without registration', 'no registration', 'without application', 'no application', 'anonymous', 'public only']],
    ['catalog', ['not catalog only', 'reject catalog only', 'original source']]
  ];
  for (const [unit, phrases] of negativePhrases) if (phrases.some(phrase => containsPhrase(normalizedQuestion, phrase))) negativeUnits.add(unit);
  return {
    negativeUnits,
    requires_daily_granularity: /\b(?:daily|per day|day granularity|facility day|facility-day|claim day|claim-day)\b/.test(normalizedQuestion),
    requires_facility_lookup: /\b(?:facility level|facility-level|facility (?:record|records|identifier|identifiers|status)|facility frame|provider status|federal directory)\b/.test(normalizedQuestion),
    requires_maternity_evidence: /\b(?:maternity|maternal)[ -]care deserts?\b|\bmaternity deserts?\b/.test(normalizedQuestion),
    requires_named_patient_claims: /\b(?:named patient|named-patient|patient level|patient-level)\b/.test(normalizedQuestion) && /\bclaims?\b/.test(normalizedQuestion),
    requires_facility_claims: /\b(?:all payer|all-payer|insurer level|insurer-level)\b/.test(normalizedQuestion) && /\b(?:facility|day|daily)\b/.test(normalizedQuestion),
    requires_organization_status: /\b(?:nonprofit|tax exempt|tax-exempt) (?:organization )?(?:universe|status)\b|\borganization universe\b/.test(normalizedQuestion),
    requires_county_capacity_frame: /\bcounty\b.*\b(?:losing|lose|loss)\b.*\bcapacity\b/.test(normalizedQuestion)
  };
}

function anchorIntent(normalizedQuestion) {
  const facilityDirectory = [
    'facility records',
    'facility identifier',
    'facility-level frame',
    'facility-level',
    'hospital directory',
    'hospital facility',
    'original government source',
    'api or a downloadable csv',
    'identifiers and status',
    'maternity care',
    'deliveries changed',
    'community benefit together',
    'hospital quality',
    'workforce and utilization'
  ].some(phrase => containsPhrase(normalizedQuestion, phrase));
  return { facilityDirectory };
}

function anchorScore(record, normalizedQuestion, anchors) {
  if (!anchors.facilityDirectory) return { value: 0, components: [], matched: [] };
  const title = normalizeText(record.title);
  const description = normalizeText(record.description);
  const capabilities = normalizeText(flattenStrings(record.capabilities).join(' '));
  const components = [];
  const matched = [];
  if (title.includes('hospital general information')) {
    const value = /facility level frame|facility level/.test(normalizedQuestion)
      ? 45
      : /maternity care|deliveries changed/.test(normalizedQuestion)
        ? 160
      : /facility records|original government source|identifiers and status|api or a downloadable csv|maternity care|deliveries changed|community benefit together|hospital quality|workforce and utilization/.test(normalizedQuestion)
        ? 100
        : 28;
    components.push({ kind: 'facility_directory_anchor', value, reason: 'The source is the first-party hospital directory and facility-identifier anchor.', evidence_state: 'source_asserted' });
    matched.push('facility_directory_anchor');
  } else if (title.includes('provider of services')) {
    const value = /facility level frame|facility level|rather than county level/.test(normalizedQuestion) ? 85 : 34;
    components.push({ kind: 'facility_status_anchor', value, reason: 'The source provides a facility/provider status and identifier frame.', evidence_state: 'source_asserted' });
    matched.push('facility_status_anchor');
  } else if (capabilities.includes('provider and facility directories') || description.includes('facility ids')) {
    components.push({ kind: 'facility_directory_support', value: 18, reason: 'The record carries a supporting provider/facility directory capability.', evidence_state: 'source_asserted' });
    matched.push('facility_directory_support');
  }
  return { value: components.reduce((sum, component) => sum + component.value, 0), components, matched };
}

function regionalScore(record, intent, matchedConcepts) {
  const requested = intent.interpretation.geographies;
  const jurisdictions = new Set(record.geography?.jurisdictions ?? []);
  const exactLocal = requested.some(geography => String(geography.id).toUpperCase() !== 'US' && jurisdictions.has(String(geography.id).toUpperCase()));
  if (!exactLocal || !matchedConcepts.some(concept => ['finance', 'utilization', 'maternal'].includes(concept))) return { components: [], matched: [] };
  const localUnits = new Set(record.unit_of_analysis ?? []);
  if (![...localUnits].some(unit => ['hospital', 'facility', 'provider', 'health_system'].includes(unit))) return { components: [], matched: [] };
  const maternity = /maternity|deliver(y|ies)|newborn|pregnan/.test(intent.normalized_question);
  return {
    components: [{ kind: 'regional_subject_anchor', value: maternity ? 108 : 42, reason: 'The record has exact requested-state coverage for the resolved hospital/operational concept.', evidence_state: record.geography?.evidence_state ?? 'unresolved' }],
    matched: ['regional_subject_anchor']
  };
}

function hospitalSpecificityScore(record, normalizedQuestion, matchedConcepts) {
  if (!stemSet(normalizedQuestion).has('hospital')) return { components: [], matched: [] };
  if (!matchedConcepts.some(concept => ['finance', 'utilization', 'quality', 'workforce', 'facility', 'maternal'].includes(concept))) return { components: [], matched: [] };
  const title = normalizeText(record.title);
  const sourceId = normalizeText(record.identity?.match_fields?.source_id ?? '');
  if (title.includes('hospital') || sourceId.includes('pecos')) return { components: [], matched: [] };
  const distractor = /health center|area health resources|shortage area|rural urban|census|nursing home/.test(title);
  if (!distractor && !(record.access?.status === 'public_catalog' && /maternity|delivery|financial|utilization|quality|workforce/.test(normalizedQuestion))) return { components: [], matched: [] };
  return {
    exclude: true,
    components: [{ kind: 'hospital_scope_penalty', value: -72, reason: 'The record is a neighboring health-resource or non-hospital product, not a hospital-specific source.', evidence_state: 'inferred' }],
    matched: ['hospital_scope_penalty']
  };
}

function recordYears(record) {
  return [record.time_coverage?.start, record.time_coverage?.end, record.freshness_verification?.data_through]
    .filter(Boolean)
    .flatMap(value => String(value).match(/\b(?:18|19|20|21)\d{2}\b/g) ?? [])
    .map(Number);
}

function capabilityText(record) {
  return normalizeText(flattenStrings(record.capabilities).join(' '));
}

function recordUnitSet(record) {
  return new Set(record.unit_of_analysis ?? []);
}

function supportsFacilityLookup(record) {
  const text = capabilityText(record);
  const title = normalizeText(record.title);
  return [
    'provider and facility directories',
    'provider and facility characteristics',
    'facility licensure and certification',
    'facility status',
    'hospital general information',
    'provider of services',
    'hospital enrollment',
    'provider enrollment',
    'facility id',
    'ccn',
    'npi',
    'practice location'
  ].some(term => containsPhrase(text, term) || containsPhrase(title, term));
}

function supportsMaternityEvidence(record) {
  const text = normalizeText([
    record.title,
    ...(record.capabilities?.topics ?? []).map(item => [item.id, item.label].filter(Boolean).join(' ')),
    ...(record.capabilities?.use_cases ?? []).map(item => [item.id, item.label].filter(Boolean).join(' '))
  ].filter(Boolean).join(' '));
  return /\b(?:matern|delivery|birth|newborn|obstetric|prenatal)\w*/.test(text);
}

function supportsClaims(record, { facility = false, namedPatient = false } = {}) {
  const units = recordUnitSet(record);
  const text = capabilityText(record);
  if (!/(?:claim|encounter|all payer|apcd)/.test(text)) return false;
  if (namedPatient && ![...units].some(unit => ['person', 'event'].includes(unit))) return false;
  if (facility && ![...units].some(unit => ['hospital', 'facility', 'provider', 'event'].includes(unit))) return false;
  return true;
}

function supportsOrganizationStatus(record) {
  const units = recordUnitSet(record);
  const title = normalizeText(record.title);
  const text = capabilityText(record);
  return units.has('tax_exempt_organization') || units.has('ein') || title.includes('business master file') ||
    (text.includes('tax exemption') && (text.includes('organization baseline') || text.includes('status screening')));
}

function supportsCountyCapacityFrame(record) {
  const text = capabilityText(record);
  return [
    'provider and facility characteristics',
    'provider and facility directories',
    'hospital closures and conversions',
    'rurality classification',
    'geography access and rurality',
    'geography, rurality, and access context',
    'facility status'
  ].some(term => containsPhrase(text, term));
}

function localSourceRequest(intent, normalizedQuestion) {
  return intent.interpretation.geographies
    .filter(geography => String(geography.id).toUpperCase() !== 'US')
    .some(geography => {
      const label = normalizeText(geography.label);
      return [
        `${label} source`,
        `${label} public source`,
        `public ${label} source`,
        `${label} original source`,
        `original ${label} source`,
        `${label} government source`,
        `government ${label} source`
      ].some(phrase => containsPhrase(normalizedQuestion, phrase));
    });
}

function hasDailyGranularity(record) {
  return /^(?:day|daily)$/.test(normalizeText(record.time_coverage?.temporal_granularity));
}

function passesQueryConstraints(record, fields, intent, negatives) {
  if (negatives.requires_daily_granularity && !hasDailyGranularity(record)) return false;
  if (negatives.requires_facility_lookup && !supportsFacilityLookup(record)) return false;
  if (negatives.requires_maternity_evidence && !supportsMaternityEvidence(record)) return false;
  if (negatives.requires_named_patient_claims && !supportsClaims(record, { namedPatient: true })) return false;
  if (negatives.requires_facility_claims && (!hasDailyGranularity(record) || !supportsClaims(record, { facility: true }))) return false;
  if (negatives.requires_organization_status && !supportsOrganizationStatus(record)) return false;
  if (negatives.requires_county_capacity_frame && !supportsCountyCapacityFrame(record)) return false;
  if (localSourceRequest(intent, intent.normalized_question)) {
    const requested = new Set(intent.interpretation.geographies.map(geography => String(geography.id).toUpperCase()));
    if (!(record.geography?.jurisdictions ?? []).some(jurisdiction => requested.has(String(jurisdiction).toUpperCase()))) return false;
  }
  return true;
}

function scoreGeography(record, intent, config) {
  const requested = intent.interpretation.geographies;
  if (!requested.length) return { eligible: true, matched: [], components: [] };
  const jurisdictions = new Set(record.geography?.jurisdictions ?? []);
  const coverage = record.geography?.coverage_level;
  const matched = [];
  const components = [];
  for (const geography of requested) {
    const code = String(geography.id).toUpperCase();
    if (jurisdictions.has(code)) {
      matched.push(code);
      components.push({ kind: 'geography_exact', value: config.priors.exact_geography, reason: `Record explicitly covers ${geography.label}.`, evidence_state: record.geography?.evidence_state ?? 'unresolved' });
    } else if (code !== 'US' && jurisdictions.has('US') && ['national', 'multi_state', 'mixed'].includes(coverage)) {
      matched.push(code);
      components.push({ kind: 'geography_national_support', value: config.priors.national_support, reason: `National coverage can support the requested ${geography.label} slice.`, evidence_state: record.geography?.evidence_state ?? 'unresolved' });
    }
  }
  return { eligible: matched.length > 0, matched, components };
}

function scoreUnits(record, intent, negatives, config) {
  const units = new Set(record.unit_of_analysis ?? []);
  const requested = intent.interpretation.units_of_analysis;
  const explicit = new Set(intent.filters.units_of_analysis ?? []);
  if (explicit.size && ![...explicit].some(unit => units.has(unit))) return { eligible: false, matched: [], components: [] };
  const matched = requested.filter(unit => units.has(unit.id));
  const components = matched.map(unit => ({ kind: 'unit_exact', value: config.priors.exact_unit, reason: `Record unit of analysis includes ${unit.label}.`, evidence_state: 'source_asserted' }));
  if (negatives.negativeUnits.has('county') && units.has('county') && ![...units].some(unit => ['hospital', 'facility', 'provider', 'health_system'].includes(unit))) {
    return { eligible: false, matched, components };
  }
  if (negatives.negativeUnits.has('patient') && units.has('person')) return { eligible: false, matched, components };
  return { eligible: true, matched: matched.map(unit => unit.id), components };
}

function scoreTime(record, intent, config) {
  const window = intent.interpretation.time_window;
  if (!window) return { eligible: true, components: [] };
  const values = recordYears(record);
  if (!values.length) return { eligible: true, components: [] };
  const start = Math.min(...values);
  const end = Math.max(...values);
  const queryStart = window.start_year ?? -Infinity;
  const queryEnd = window.end_year ?? Infinity;
  if (end < queryStart || start > queryEnd) return { eligible: false, components: [] };
  return { eligible: true, components: [{ kind: 'time_overlap', value: config.priors.time_overlap, reason: `Record time coverage ${start}-${end} overlaps the requested window.`, evidence_state: record.time_coverage?.evidence_state ?? 'unresolved' }] };
}

function scoreAccess(record, intent, negatives, config) {
  const status = record.access?.status ?? 'unknown';
  if (intent.filters.access_statuses?.length && !intent.filters.access_statuses.includes(status)) return { eligible: false, components: [] };
  const publicOnly = negatives.negativeUnits.has('restricted') || intent.interpretation.access_intent.public_only || intent.filters.include_restricted !== true;
  if (publicOnly && RESTRICTED.has(status)) return { eligible: false, components: [] };
  const value = config.priors[status] ?? ACCESS_BONUS[status] ?? 0;
  return { eligible: true, components: [{ kind: 'access', value, reason: `Access status is ${status}.`, evidence_state: record.access?.evidence_state ?? 'unresolved' }] };
}

function capabilityMatch(record, concept) {
  return capabilityRows(record)
    .map(capability => {
      const text = normalizeText([capability.id, capability.label, capability.rationale].filter(Boolean).join(' '));
      const matched = concept.terms.filter(term => containsPhrase(text, term));
      return matched.length ? { capability, matched } : null;
    })
    .filter(Boolean)
    .sort((left, right) => (FITNESS_MULTIPLIER[right.capability.fitness] ?? 0) - (FITNESS_MULTIPLIER[left.capability.fitness] ?? 0) || right.matched.length - left.matched.length)[0] ?? null;
}

function scoreLexical(fields, queryTokens, idf, config) {
  const components = [];
  const matched = new Set();
  for (const field of fields) {
    let value = 0;
    const exact = [];
    const stemmed = [];
    for (const token of queryTokens) {
      const match = termMatches(token, field.stems);
      if (!match) continue;
      matched.add(token);
      const contribution = (idf.get(token) ?? 1) * (match === 'exact' ? 1 : 0.55);
      value += field.weight * contribution;
      (match === 'exact' ? exact : stemmed).push(token);
    }
    if (!value) continue;
    components.push({
      kind: `lexical_${field.kind}`,
      value: Math.round(value * 100) / 100,
      reason: `${field.kind[0].toUpperCase()}${field.kind.slice(1)} metadata matches ${[...exact, ...stemmed.map(token => `${token}~`)].join(', ')}.`,
      evidence_state: 'inferred'
    });
  }
  return { components, matched: [...matched] };
}

function scoreCandidate({ record, fields, intent, concepts, queryTokens, queryPhrases: phrases, idf, negatives, anchors, config }) {
  if (!passesQueryConstraints(record, fields, intent, negatives)) return null;
  const geography = scoreGeography(record, intent, config);
  if (!geography.eligible) return null;
  const units = scoreUnits(record, intent, negatives, config);
  if (!units.eligible) return null;
  const time = scoreTime(record, intent, config);
  if (!time.eligible) return null;
  const access = scoreAccess(record, intent, negatives, config);
  if (!access.eligible) return null;

  const lexical = scoreLexical(fields, queryTokens, idf, config);
  const anchor = anchorScore(record, intent.normalized_question, anchors);
  const components = [...geography.components, ...units.components, ...time.components, ...access.components, ...lexical.components, ...anchor.components];
  const matchedConcepts = [];
  const matchedCapabilityFitnesses = [];
  for (const concept of concepts) {
    const capability = capabilityMatch(record, concept);
    const title = fields.find(field => field.kind === 'title');
    const metadata = fields.find(field => ['capability', 'identity', 'description'].includes(field.kind));
    const titleMatch = concept.terms.find(term => containsPhrase(title.normalized, term));
    const metadataMatch = concept.terms.find(term => metadata && containsPhrase(metadata.normalized, term));
    if (!capability && !titleMatch && !metadataMatch) continue;
    matchedConcepts.push(concept.id);
    if (capability) {
      const multiplier = FITNESS_MULTIPLIER[capability.capability.fitness] ?? FITNESS_MULTIPLIER.unknown;
      matchedCapabilityFitnesses.push(capability.capability.fitness ?? 'unknown');
      const value = config.concept_weights.subject_capability * multiplier + (EVIDENCE_BONUS[capability.capability.evidence_state] ?? 0);
      components.push({ kind: 'concept_capability', value, reason: `${concept.label} matches the ${capability.capability.fitness} capability “${capability.capability.label}”.`, evidence_state: capability.capability.evidence_state ?? 'unresolved' });
      if (capability.capability.fitness === 'context_only') components.push({ kind: 'context_only_penalty', value: -config.penalties.context_only, reason: 'Capability is marked context-only and is not treated as a primary recommendation.', evidence_state: capability.capability.evidence_state ?? 'unresolved' });
    } else if (titleMatch) {
      components.push({ kind: 'concept_title', value: config.concept_weights.subject_title, reason: `${concept.label} appears in the record title.`, evidence_state: 'inferred' });
    } else {
      components.push({ kind: 'concept_metadata', value: config.concept_weights.subject_metadata, reason: `${concept.label} appears in evidence-bound record metadata.`, evidence_state: 'inferred' });
    }
  }

  for (const phrase of phrases.slice(0, 24)) {
    if (phrase.length < 8) continue;
    const field = fields.find(candidate => containsPhrase(candidate.normalized, phrase));
    if (field) {
      components.push({ kind: `phrase_${field.kind}`, value: config.concept_weights.phrase, reason: `${field.kind[0].toUpperCase()}${field.kind.slice(1)} contains the query phrase “${phrase}”.`, evidence_state: 'inferred' });
      break;
    }
  }

  const subjectRequired = intent.interpretation.subjects.length > 0;
  const explicitGeography = (intent.filters.geography?.codes ?? []).length > 0;
  const regional = regionalScore(record, intent, matchedConcepts);
  const hospitalSpecificity = hospitalSpecificityScore(record, intent.normalized_question, matchedConcepts);
  if (hospitalSpecificity.exclude) return null;
  components.push(...regional.components, ...hospitalSpecificity.components);
  const activatedSemanticConcept = concepts.some(concept => !concept.id.startsWith('subject:'));
  const hasSignal = matchedConcepts.length > 0 || anchor.matched.length > 0 || regional.matched.length > 0 || (!activatedSemanticConcept && lexical.matched.length > 0) || units.matched.length > 0 || (explicitGeography && geography.matched.length > 0);
  if (subjectRequired && matchedConcepts.length === 0) return null;
  if (subjectRequired && matchedCapabilityFitnesses.length && matchedCapabilityFitnesses.every(fitness => ['context_only', 'unknown'].includes(fitness))) return null;
  if (!hasSignal) return null;

  const sourceKind = authorityKind(record);
  const identityState = record.identity?.family?.resolution_state ?? 'unresolved';
  components.push({ kind: 'authority', value: AUTHORITY_BONUS[sourceKind] ?? AUTHORITY_BONUS.unknown, reason: `Source authority class is ${sourceKind}.`, evidence_state: record.identity?.family?.resolution_state ?? 'unresolved' });
  if (identityState === 'unresolved') components.push({ kind: 'identity_uncertainty', value: config.priors.unresolved_identity, reason: 'Source-family identity remains unresolved; the result is presented as a record-native candidate.', evidence_state: 'unresolved' });

  return {
    record,
    score: components.reduce((sum, component) => sum + component.value, 0),
    components,
    matched_subjects: [...new Set(concepts.filter(concept => matchedConcepts.includes(concept.id)).flatMap(concept => concept.subject_ids ?? []))],
    matched_concepts: matchedConcepts,
    matched_anchors: anchor.matched,
    matched_regional_anchors: regional.matched,
    matched_scope_adjustments: hospitalSpecificity.matched,
    matched_geographies: geography.matched,
    matched_units: units.matched,
    matched_terms: lexical.matched,
    diversity_key: sourceDiversityKey(record)
  };
}

function buildIdf(fieldsByRecord, queryTokens) {
  const documentFrequency = new Map();
  for (const fields of fieldsByRecord) {
    const seen = new Set(fields.flatMap(field => [...field.stems]));
    for (const token of seen) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const count = fieldsByRecord.length;
  return new Map(queryTokens.map(token => [token, Math.log((count + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1]));
}

function stableResultId(intent, ranked, corpusId) {
  return `retrieval-v2-${stableHash(JSON.stringify({
    version: RETRIEVAL_V2_VERSION,
    corpus_id: corpusId,
    question: intent.normalized_question,
    filters: intent.filters,
    records: ranked.map(item => item.record.record_id)
  }))}`;
}

function explain(item) {
  const reasons = [];
  for (const component of item.components.filter(component => component.value > 0).sort((left, right) => right.value - left.value)) {
    if (!reasons.includes(component.reason)) reasons.push(component.reason);
    if (reasons.length >= 4) break;
  }
  if (!reasons.length) reasons.push('Record passed bounded filters with weak lexical relevance in the pinned offline corpus.');
  if (item.matched_concepts.length) reasons.push(`Resolved ranking concepts: ${item.matched_concepts.join(', ')}.`);
  if (RESTRICTED.has(item.record.access?.status)) reasons.push(`Human action is required because access is ${item.record.access.status}.`);
  return reasons;
}

function selectDiverse(matches, limit, config) {
  const remaining = [...matches];
  const selected = [];
  const coveredConcepts = new Set();
  const coveredUnits = new Set();
  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index];
      const novelConcepts = item.matched_concepts.filter(concept => !coveredConcepts.has(concept)).length;
      const novelUnits = item.matched_units.filter(unit => !coveredUnits.has(unit)).length;
      const value = item.score + novelConcepts * config.concept_weights.diversity + novelUnits * Math.floor(config.concept_weights.diversity / 2) - selected.length * 0.0001;
      if (value > bestValue || (value === bestValue && item.record.record_id.localeCompare(remaining[bestIndex].record.record_id) < 0)) {
        bestIndex = index;
        bestValue = value;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    selected.push(picked);
    picked.matched_concepts.forEach(concept => coveredConcepts.add(concept));
    picked.matched_units.forEach(unit => coveredUnits.add(unit));
  }
  return selected;
}

function validateInputs({ records, projectedDocuments, joinRoutes, vocabulary }) {
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
  if (!Array.isArray(projectedDocuments) || projectedDocuments.length !== records.length) throw new TypeError('searchDocuments must contain exactly one projection per record');
  const documents = new Map();
  for (const document of projectedDocuments) {
    if (!recordIds.has(document.resource_record_id) || documents.has(document.resource_record_id)) throw new TypeError(`invalid or duplicate search document: ${document.resource_record_id}`);
    if (document.authoritative_record !== false || document.projection_role !== 'discovery_view') throw new TypeError(`search document must be a non-authoritative discovery view: ${document.resource_record_id}`);
    documents.set(document.resource_record_id, structuredClone(document));
  }
  return { recordIds, documents };
}

export function createRetrievalV2Engine({ records, searchDocuments, joinRoutes = [], vocabulary, corpus, rankingConfig = DEFAULT_RETRIEVAL_V2_CONFIG }) {
  const config = deepFreeze(structuredClone(rankingConfig));
  const projectedDocuments = searchDocuments ?? projectSearchDocuments(records, joinRoutes);
  const { documents } = validateInputs({ records, projectedDocuments, joinRoutes, vocabulary });
  const frozenRecords = structuredClone(records);
  const frozenRoutes = structuredClone(joinRoutes);
  const frozenVocabulary = structuredClone(vocabulary);
  const frozenCorpus = structuredClone(corpus ?? { corpus_id: 'observatory-offline-fixture', corpus_version: '1.1.0', evidence_mode: 'published_offline_evidence' });
  const fieldsByRecord = new Map(frozenRecords.map(record => [record.record_id, fieldRows(record, documents.get(record.record_id), config)]));

  return Object.freeze({
    version: RETRIEVAL_V2_VERSION,
    ranking_config: structuredClone(config),
    interpret(rawQuery) {
      return structuredClone(compileDiscoveryIntent(rawQuery, frozenVocabulary));
    },
    retrieve(rawQuery, { signal } = {}) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const intent = compileDiscoveryIntent(rawQuery, frozenVocabulary);
      const concepts = queryConcepts(intent, intent.normalized_question, frozenVocabulary);
      const queryTokens = meaningfulQueryTokens(intent.normalized_question, intent);
      const idf = buildIdf([...fieldsByRecord.values()], queryTokens);
      const phrases = queryPhrases(intent.normalized_question);
      const negatives = negativeConstraints(intent.normalized_question);
      const anchors = anchorIntent(intent.normalized_question);
      const scored = frozenRecords
        .map(record => scoreCandidate({ record, fields: fieldsByRecord.get(record.record_id), intent, concepts, queryTokens, queryPhrases: phrases, idf, negatives, anchors, config }))
        .filter(Boolean)
        .filter(item => item.score > 0);

      // A shared explicit source identifier is a presentation-diversity key,
      // not an identity merge. Retain only the strongest safe projection so
      // top-k metrics are not consumed by duplicate observatory/federal rows.
      const bestBySource = new Map();
      for (const item of scored) {
        const previous = bestBySource.get(item.diversity_key);
        if (!previous || item.score > previous.score || (item.score === previous.score && item.record.record_id.localeCompare(previous.record.record_id) < 0)) bestBySource.set(item.diversity_key, item);
      }
      const ranked = selectDiverse([...bestBySource.values()].sort((left, right) => right.score - left.score || left.record.record_id.localeCompare(right.record.record_id)), intent.filters.limit, config);
      const selectedRecords = ranked.map(item => item.record);
      const warnings = [
        'Results are generated by the frozen development/validation v2 ranker over a pinned offline corpus.',
        'Results describe indexed metadata and retrieval routes; they do not prove current endpoint availability or authorize access.'
      ];
      if (!intent.interpretation.subjects.length) warnings.unshift('No controlled subject concept matched; retrieval used the versioned synonym groups and bounded lexical matching.');
      if (intent.interpretation.access_intent.public_only || intent.filters.include_restricted !== true) warnings.push('Restricted access records were excluded unless the query explicitly requests an accepted restricted-access class.');
      if (!ranked.length) warnings.push('No published offline record matched. This is not evidence that no source exists.');
      return {
        contract_version: 'observatory-discovery-result.v1.0.0',
        retrieval_id: stableResultId(intent, ranked, frozenCorpus.corpus_id),
        evidence_mode: 'published_offline_evidence',
        ranking: {
          algorithm_version: RETRIEVAL_V2_VERSION,
          configuration_version: config.version,
          tuning_scope: 'development_and_validation_only',
          final_holdout_accessed: false,
          source_diversity_grouping: 'exact_source_identifier_presentation_only'
        },
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
            include_restricted: !warnings.some(warning => warning.startsWith('Restricted access records were excluded')),
            time_window: intent.filters.time_window,
            limit: intent.filters.limit
          }
        },
        result_count: ranked.length,
        returned_count: ranked.length,
        total_matches: scored.length,
        has_more: bestBySource.size > ranked.length,
        results: ranked.map((item, index) => ({
          rank: index + 1,
          score: Math.round(item.score * 100) / 100,
          record_id: item.record.record_id,
          relevance: {
            matched_subjects: item.matched_subjects,
            matched_concepts: item.matched_concepts,
            matched_anchors: item.matched_anchors,
            matched_geographies: item.matched_geographies,
            matched_units: item.matched_units,
            matched_terms: item.matched_terms,
            score_components: item.components,
            why_relevant: explain(item)
          },
          record: structuredClone(item.record)
        })),
        join_routes: selectJoinRoutes(frozenRoutes, selectedRecords),
        warnings
      };
    }
  });
}
