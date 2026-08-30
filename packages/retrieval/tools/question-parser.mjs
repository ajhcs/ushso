const WORD_BOUNDARY = '[^a-z0-9]';

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
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, ' +');
  return new RegExp(`(?:^|${WORD_BOUNDARY})${escaped}(?:$|${WORD_BOUNDARY})`).test(normalizedText);
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

function matchVocabulary(normalizedQuestion, entries, kind, rawQuestion) {
  const matches = [];
  for (const entry of entries ?? []) {
    const aliases = [entry.label, ...(entry.aliases ?? []), ...(entry.phrases ?? [])].filter(Boolean);
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
  const publicOnlyPhrase = [
    'public source', 'public sources', 'publicly available', 'open data', 'free data', 'without registration',
    'no account', 'no application', 'no dua', 'no license'
  ].some(phrase => phrasePresent(normalizedQuestion, phrase));
  const acceptsRestrictedPhrase = [
    'restricted data', 'controlled data', 'claims data', 'dua', 'application required', 'licensed data'
  ].some(phrase => phrasePresent(normalizedQuestion, phrase));
  const includeRestricted = query.include_restricted ?? (publicOnlyPhrase ? false : true);
  return {
    include_restricted: includeRestricted,
    public_only: !includeRestricted,
    accepts_restricted: includeRestricted && acceptsRestrictedPhrase,
    match_basis: query.include_restricted === undefined ? 'question_or_default' : 'explicit_filter'
  };
}

export function validateQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'object' || Array.isArray(rawQuery)) throw new TypeError('query must be an object');
  const allowed = new Set(['question', 'geography', 'subjects', 'units_of_analysis', 'access_statuses', 'include_restricted', 'time_window', 'limit']);
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
  if (rawQuery.limit !== undefined && (!Number.isInteger(rawQuery.limit) || rawQuery.limit < 1 || rawQuery.limit > 50)) throw new TypeError('limit must be an integer from 1 to 50');
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
    limit: rawQuery.limit ?? 10
  };
}

export function parseQuestion(rawQuery, vocabulary) {
  const query = validateQuery(rawQuery);
  const normalizedQuestion = normalizeText(query.question);
  const inferredGeographies = matchVocabulary(normalizedQuestion, vocabulary.geographies, 'geography', query.question);
  const inferredSubjects = matchVocabulary(normalizedQuestion, vocabulary.subjects, 'subject', query.question);
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

  return {
    raw: query,
    original_question: query.question,
    normalized_question: normalizedQuestion,
    interpretation: {
      geographies,
      subjects,
      units_of_analysis: units,
      time_window: explicitTime ?? inferredTime,
      access_intent: accessIntent(normalizedQuestion, query)
    }
  };
}

export function recordSearchText(record) {
  const values = [];
  const walk = value => {
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
      values.push(key.replaceAll('_', ' '));
      walk(item);
    });
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
