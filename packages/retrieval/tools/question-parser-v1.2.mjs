const SEARCH_ALIAS_SUCCESSOR = Object.freeze({
  maternal_child_health: ['maternal mortality', 'maternal death']
});
const PUBLIC_ONLY_PHRASES = Object.freeze([
  'public source', 'public sources', 'publicly available', 'open data', 'free data', 'without registration',
  'public only', 'public use data', 'public use', 'no account', 'no application', 'no dua', 'no license'
]);
const NO_COST_PHRASES = Object.freeze([
  'free data', 'no cost', 'at no cost', 'without cost', 'without fees', 'no fee', 'no fees'
]);
const NORMALIZED_PHRASE_CACHE_LIMIT = 2048;
const normalizedPhraseCache = new Map();

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ +/g, ' ');
}

function phrasePresent(normalizedText, phrase) {
  const cacheKey = String(phrase ?? '');
  let normalizedPhrase = normalizedPhraseCache.get(cacheKey);
  if (normalizedPhrase === undefined) {
    normalizedPhrase = normalizeText(cacheKey);
    if (normalizedPhraseCache.size >= NORMALIZED_PHRASE_CACHE_LIMIT) {
      normalizedPhraseCache.delete(normalizedPhraseCache.keys().next().value);
    }
    normalizedPhraseCache.set(cacheKey, normalizedPhrase);
  }
  if (!normalizedPhrase) return false;
  // Both operands contain lowercase alphanumerics separated by single spaces,
  // so padded substring matching is the same whole-phrase boundary check
  // without compiling a regular expression for every record.
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function uniqueBy(values, key) {
  const seen = new Set();
  return values.filter(value => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function matchVocabulary(normalizedQuestion, entries, kind, rawQuestion, successorAliases = null) {
  const matches = [];
  for (const entry of entries ?? []) {
    const aliases = [entry.label, ...(entry.aliases ?? []), ...(entry.phrases ?? []), ...(successorAliases?.[entry.id] ?? [])].filter(Boolean);
    const matched = aliases.filter(alias => {
      const normalizedAlias = normalizeText(alias);
      if (kind === 'geography' && normalizedAlias.length === 2) {
        return new RegExp(`(?:^|[^A-Z])${normalizedAlias.toUpperCase()}(?:$|[^A-Z])`).test(rawQuestion);
      }
      return phrasePresent(normalizedQuestion, alias);
    });
    if (matched.length) {
      matches.push({
        id: entry.id ?? entry.code,
        label: entry.label,
        kind,
        matched_aliases: [...new Set(matched.map(normalizeText))].sort(),
        evidence: 'controlled_vocabulary'
      });
    }
  }
  return uniqueBy(matches, value => value.id).sort((a, b) => a.id.localeCompare(b.id));
}

function parseYears(normalizedQuestion) {
  const years = [...normalizedQuestion.matchAll(/\b(?:18|19|20|21)\d{2}\b/g)].map(match => Number(match[0]));
  if (!years.length) return null;
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  if (/\b(since|after|from)\b/.test(normalizedQuestion) && sorted.length === 1) {
    return { start_year: sorted[0], end_year: null, match_basis: 'question_text' };
  }
  if (/\b(before|through|until|to)\b/.test(normalizedQuestion) && sorted.length === 1) {
    return { start_year: null, end_year: sorted[0], match_basis: 'question_text' };
  }
  return { start_year: sorted[0], end_year: sorted.at(-1), match_basis: 'question_text' };
}

function accessIntent(normalizedQuestion, query) {
  const matchedPublicPhrases = PUBLIC_ONLY_PHRASES.filter(phrase => phrasePresent(normalizedQuestion, phrase));
  const matchedNoCostPhrases = NO_COST_PHRASES.filter(phrase => phrasePresent(normalizedQuestion, phrase));
  const publicOnlyPhrase = matchedPublicPhrases.length > 0;
  const ambiguousPublicHospital = !publicOnlyPhrase && phrasePresent(normalizedQuestion, 'public hospital');
  const acceptsRestrictedPhrase = [
    'restricted data', 'controlled data', 'claims data', 'dua', 'application required', 'licensed data'
  ].some(phrase => phrasePresent(normalizedQuestion, phrase));
  const includeRestricted = query.include_restricted ?? (publicOnlyPhrase ? false : true);
  return {
    include_restricted: includeRestricted,
    public_only: !includeRestricted,
    accepts_restricted: includeRestricted && acceptsRestrictedPhrase,
    match_basis: query.include_restricted === undefined ? 'question_or_default' : 'explicit_filter',
    payload_requirement: publicOnlyPhrase ? 'documented_public_payload' : 'unspecified',
    cost_requirement: matchedNoCostPhrases.length ? 'documented_no_fee' : 'unspecified',
    ambiguity: ambiguousPublicHospital ? 'public_access_or_ownership' : null,
    matched_phrases: ambiguousPublicHospital ? ['public'] : matchedPublicPhrases,
    interpretation_note: publicOnlyPhrase
      ? matchedNoCostPhrases.length
        ? 'Catalog visibility alone does not satisfy this request; a confirmed match requires documented public payload access and documented absence of fees.'
        : 'Catalog visibility alone does not satisfy this request; only documented public payload access is a confirmed match.'
      : ambiguousPublicHospital
        ? '“Public hospital” could mean public payload access or government ownership; no access constraint was silently applied.'
        : null
  };
}

function exclusionIntent(normalizedQuestion, query) {
  const explicit = query.exclusions.map(value => ({ phrase: value, normalized_phrase: normalizeText(value), match_basis: 'explicit_filter', support: 'supported' }));
  const patterns = [...normalizedQuestion.matchAll(/\b(?:excluding|exclude|except|without|not)\s+([a-z0-9][a-z0-9 ]{1,80})/g)];
  const inferred = patterns.map(match => {
    const phrase = match[1].split(/\b(?:and|but|for|from|in|with)\b/)[0].trim();
    const supported = ['nursing home', 'nursing homes', 'marketplace', 'medicare', 'medicaid'].includes(phrase);
    return { phrase, normalized_phrase: phrase, match_basis: 'question_text', support: supported ? 'supported' : 'unsupported' };
  }).filter(item => item.normalized_phrase);
  return uniqueBy([...explicit, ...inferred], value => value.normalized_phrase);
}

function namedSourceIntent(normalizedQuestion, registry) {
  return (registry?.sources ?? []).filter(source => [source.name, ...(source.acronyms ?? []), ...(source.aliases ?? [])]
    .some(alias => phrasePresent(normalizedQuestion, alias)))
    .map(source => ({
      source_id: source.source_id,
      name: source.name,
      matched_aliases: [source.name, ...(source.acronyms ?? []), ...(source.aliases ?? [])]
        .filter(alias => phrasePresent(normalizedQuestion, alias)).map(normalizeText),
      indexed_record_ids: [...(source.indexed_record_ids ?? [])],
      official_discovery_url: source.official_discovery_url ?? null,
      registry_evidence_state: source.evidence_state ?? 'unresolved'
    }));
}

function positiveTerms(normalizedQuestion, access, exclusions, namedSources, timeWindow) {
  let text = ` ${normalizedQuestion} `;
  const removePhrase = phrase => {
    const normalized = normalizeText(phrase);
    if (!normalized) return;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, ' +');
    text = text.replace(new RegExp(`(?:^| )${escaped}(?= |$)`, 'g'), ' ');
  };
  for (const phrase of access.matched_phrases ?? []) removePhrase(phrase);
  for (const exclusion of exclusions) {
    const phrase = normalizeText(exclusion.normalized_phrase);
    if (!phrase) continue;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, ' +');
    text = text.replace(new RegExp(`(?:^| )(?:excluding|exclude|except|without|not) +${escaped}(?= |$)`, 'g'), ' ');
  }
  for (const source of namedSources) {
    const aliases = [...(source.matched_aliases ?? [])].sort((left, right) => normalizeText(right).length - normalizeText(left).length);
    for (const alias of aliases) removePhrase(alias);
  }
  if (timeWindow) {
    text = text.replace(/\b(?:18|19|20|21)\d{2}\b/g, ' ');
    text = text.replace(/\b(?:since|after|from|before|through|until|to|between)\b/g, ' ');
  }
  return [...new Set(text.trim().split(/ +/).filter(Boolean))];
}

export function validateQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'object' || Array.isArray(rawQuery)) throw new TypeError('query must be an object');
  const allowed = new Set(['question', 'geography', 'subjects', 'units_of_analysis', 'access_statuses', 'include_restricted', 'time_window', 'limit', 'page_size', 'cursor', 'generation', 'sort', 'facet_filters', 'exclusions']);
  for (const key of Object.keys(rawQuery)) if (!allowed.has(key)) throw new TypeError(`unknown query property: ${key}`);
  if (typeof rawQuery.question !== 'string' || rawQuery.question.trim().length < 3 || rawQuery.question.length > 500) {
    throw new TypeError('question must contain 3 to 500 characters');
  }
  const uniqueStrings = (value, name) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim()) || new Set(value).size !== value.length) {
      throw new TypeError(`${name} must be an array of unique non-empty strings`);
    }
    return value.map(item => item.trim());
  };
  if (rawQuery.include_restricted !== undefined && typeof rawQuery.include_restricted !== 'boolean') throw new TypeError('include_restricted must be boolean');
  if (rawQuery.limit !== undefined && (!Number.isInteger(rawQuery.limit) || rawQuery.limit < 1 || rawQuery.limit > 200)) throw new TypeError('limit must be an integer from 1 to 200');
  if (rawQuery.page_size !== undefined && (!Number.isInteger(rawQuery.page_size) || rawQuery.page_size < 1 || rawQuery.page_size > 200)) throw new TypeError('page_size must be an integer from 1 to 200');
  if (rawQuery.limit !== undefined && rawQuery.page_size !== undefined && rawQuery.limit !== rawQuery.page_size) throw new TypeError('limit and page_size must match when both are supplied');
  if (rawQuery.cursor !== undefined && rawQuery.cursor !== null && (typeof rawQuery.cursor !== 'string' || rawQuery.cursor.length < 8 || rawQuery.cursor.length > 512)) throw new TypeError('cursor must be null or an opaque string from 8 to 512 characters');
  if (rawQuery.generation !== undefined && rawQuery.generation !== null && (typeof rawQuery.generation !== 'string' || !rawQuery.generation.trim() || rawQuery.generation.length > 160)) throw new TypeError('generation must be null or a non-empty string up to 160 characters');
  const allowedSorts = new Set(['canonical_relevance', 'title_asc', 'release_newest', 'observation_latest']);
  if (rawQuery.sort !== undefined && !allowedSorts.has(rawQuery.sort)) throw new TypeError(`sort must be one of: ${[...allowedSorts].join(', ')}`);
  if (rawQuery.facet_filters !== undefined && (!rawQuery.facet_filters || typeof rawQuery.facet_filters !== 'object' || Array.isArray(rawQuery.facet_filters))) throw new TypeError('facet_filters must be an object');
  const facetFilters = {};
  for (const [key, value] of Object.entries(rawQuery.facet_filters ?? {})) {
    if (!['source', 'geography', 'access_status', 'unit_of_analysis', 'capability'].includes(key)) throw new TypeError(`unknown facet filter: ${key}`);
    facetFilters[key] = uniqueStrings(value, `facet_filters.${key}`);
  }
  if (rawQuery.geography !== undefined && (!rawQuery.geography || typeof rawQuery.geography !== 'object' || Array.isArray(rawQuery.geography))) throw new TypeError('geography must be an object');
  const geography = rawQuery.geography ? {
    codes: uniqueStrings(rawQuery.geography.codes, 'geography.codes'),
    levels: uniqueStrings(rawQuery.geography.levels, 'geography.levels')
  } : { codes: [], levels: [] };
  const allowedGeoKeys = new Set(['codes', 'levels']);
  for (const key of Object.keys(rawQuery.geography ?? {})) if (!allowedGeoKeys.has(key)) throw new TypeError(`unknown geography property: ${key}`);
  const timeWindow = rawQuery.time_window ?? null;
  if (timeWindow !== null) {
    if (!timeWindow || typeof timeWindow !== 'object' || Array.isArray(timeWindow)) throw new TypeError('time_window must be an object');
    for (const key of Object.keys(timeWindow)) if (!['start_year', 'end_year'].includes(key)) throw new TypeError(`unknown time_window property: ${key}`);
    for (const key of ['start_year', 'end_year']) {
      if (timeWindow[key] !== undefined && (!Number.isInteger(timeWindow[key]) || timeWindow[key] < 1800 || timeWindow[key] > 2200)) throw new TypeError(`${key} must be an integer from 1800 to 2200`);
    }
    if (timeWindow.start_year !== undefined && timeWindow.end_year !== undefined && timeWindow.start_year > timeWindow.end_year) throw new TypeError('time_window start_year must not exceed end_year');
  }
  return {
    question: rawQuery.question.trim(),
    geography,
    subjects: uniqueStrings(rawQuery.subjects, 'subjects'),
    units_of_analysis: uniqueStrings(rawQuery.units_of_analysis, 'units_of_analysis'),
    access_statuses: uniqueStrings(rawQuery.access_statuses, 'access_statuses'),
    include_restricted: rawQuery.include_restricted,
    time_window: timeWindow,
    limit: rawQuery.page_size ?? rawQuery.limit ?? 10,
    page_size: rawQuery.page_size ?? rawQuery.limit ?? 10,
    cursor: rawQuery.cursor ?? null,
    generation: rawQuery.generation?.trim() ?? null,
    sort: rawQuery.sort ?? 'canonical_relevance',
    facet_filters: facetFilters,
    exclusions: uniqueStrings(rawQuery.exclusions, 'exclusions')
  };
}

export function parseQuestion(rawQuery, vocabulary, namedSourceRegistry = null) {
  const query = validateQuery(rawQuery);
  const normalizedQuestion = normalizeText(query.question);
  const inferredGeographies = matchVocabulary(normalizedQuestion, vocabulary.geographies, 'geography', query.question);
  const inferredSubjects = matchVocabulary(normalizedQuestion, vocabulary.subjects, 'subject', query.question, namedSourceRegistry ? SEARCH_ALIAS_SUCCESSOR : null);
  const inferredUnits = matchVocabulary(normalizedQuestion, vocabulary.units, 'unit', query.question);

  const explicitGeographies = query.geography.codes.map(code => {
    const entry = (vocabulary.geographies ?? []).find(item => item.code === code || item.id === code || (item.aliases ?? []).some(alias => normalizeText(alias) === normalizeText(code)));
    return { id: entry?.code ?? code, label: entry?.label ?? code, kind: 'geography', matched_aliases: [code], evidence: 'explicit_filter' };
  });
  const explicitSubjects = query.subjects.map(id => {
    const entry = (vocabulary.subjects ?? []).find(item => item.id === id);
    return { id, label: entry?.label ?? id, kind: 'subject', matched_aliases: [id], evidence: 'explicit_filter' };
  });
  const explicitUnits = query.units_of_analysis.map(id => {
    const entry = (vocabulary.units ?? []).find(item => item.id === id);
    return { id, label: entry?.label ?? id, kind: 'unit', matched_aliases: [id], evidence: 'explicit_filter' };
  });

  const geographies = uniqueBy([...explicitGeographies, ...inferredGeographies], value => value.id);
  const subjects = uniqueBy([...explicitSubjects, ...inferredSubjects], value => value.id);
  const subjectImpliedUnits = query.units_of_analysis.length ? [] : subjects.flatMap(subjectMatch => {
    const subject = (vocabulary.subjects ?? []).find(item => item.id === subjectMatch.id);
    return (subject?.implied_units ?? []).map(id => {
      const unit = (vocabulary.units ?? []).find(item => item.id === id);
      return {
        id,
        label: unit?.label ?? id,
        kind: 'unit',
        matched_aliases: [`implied_by:${subjectMatch.id}`],
        evidence: 'controlled_vocabulary'
      };
    });
  });
  const units = uniqueBy([...explicitUnits, ...inferredUnits, ...subjectImpliedUnits], value => value.id);
  const inferredTime = parseYears(normalizedQuestion);
  const explicitTime = query.time_window ? {
    start_year: query.time_window.start_year ?? null,
    end_year: query.time_window.end_year ?? null,
    match_basis: 'explicit_filter'
  } : null;
  const exclusions = exclusionIntent(normalizedQuestion, query);
  const namedSources = namedSourceIntent(normalizedQuestion, namedSourceRegistry);
  const access = accessIntent(normalizedQuestion, query);
  const interpretationWarnings = exclusions
    .filter(item => item.support === 'unsupported')
    .map(item => `The exclusion "${item.phrase}" is not a supported structured filter and was not silently applied.`);
  if (access.ambiguity) interpretationWarnings.push(access.interpretation_note);

  return {
    raw: query,
    original_question: query.question,
    normalized_question: normalizedQuestion,
    interpretation: {
      geographies,
      subjects,
      units_of_analysis: units,
      time_window: explicitTime ?? inferredTime,
      access_intent: access,
      exclusions,
      named_sources: namedSources,
      positive_terms: positiveTerms(normalizedQuestion, access, exclusions, namedSources, explicitTime ?? inferredTime),
      interpretation_warnings: interpretationWarnings
    }
  };
}

export function recordSearchText(record) {
  const values = [];
  const walk = value => {
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk({
    title: record.title,
    description: record.description,
    identity: record.identity,
    capabilities: record.capabilities,
    geography: record.geography,
    unit_of_analysis: record.unit_of_analysis
  });
  return normalizeText(values.join(' '));
}

export function containsPhrase(text, phrase) {
  return phrasePresent(normalizeText(text), phrase);
}

// Use only when the caller already holds normalizeText output. This preserves
// phrase-boundary semantics without re-normalizing every record on hot paths.
export function containsNormalizedPhrase(normalizedText, phrase) {
  return phrasePresent(normalizedText, phrase);
}
