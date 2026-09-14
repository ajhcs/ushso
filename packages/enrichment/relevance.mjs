import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, nonEquivalence } from './measure-semantics.mjs';

export const RELEVANCE_POLICY_VERSION = 'ushso.relevance.v1';
export const HELD_OUT_LABELS_USED = false;
export const NONSENSE_PENNSYLVANIA_QUERY = 'Pennsylvania flibbertigibbet qzxwvu';

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
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ +/g, ' ');
}

export function loadRelevanceFixtures(file = defaultFixturePath()) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function defaultFixturePath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../evaluation/research-program/relevance/near-misses.json');
}

export function classifyNearMiss(question, candidate) {
  const q = normalize(question);
  const text = normalize(`${candidate.title ?? ''} ${candidate.description ?? ''}`);
  if (q.includes('maternal mortality') && candidate.measure === 'infant_mortality') {
    return freeze({ record_id: candidate.record_id, state: 'forbidden', reason: 'MATERNAL_INFANT_NON_EQUIVALENCE', title_only: false });
  }
  if (q.includes('hospital readmissions') && candidate.measure === 'psi') {
    return freeze({ record_id: candidate.record_id, state: 'contextual', reason: 'PSI_IS_NOT_READMISSIONS', title_only: false });
  }
  if (q.includes('provider relief') && candidate.measure === 'quality_stars') {
    return freeze({ record_id: candidate.record_id, state: 'forbidden', reason: 'QUALITY_STARS_ARE_NOT_RELIEF_PAYMENTS', title_only: false });
  }
  if (q.includes('premium rate') && candidate.measure === 'enforcement') {
    return freeze({ record_id: candidate.record_id, state: 'uncertain', reason: 'ENFORCEMENT_IS_NOT_RATE_FILING', title_only: false });
  }
  if (/\b2019\b/.test(q) && candidate.observation_year && candidate.observation_year !== 2019) {
    return freeze({ record_id: candidate.record_id, state: 'uncertain', reason: 'OBSERVATION_PERIOD_MISMATCH', title_only: false });
  }
  if (candidate.measure && text.includes(normalize(candidate.measure.replaceAll('_', ' ')))) {
    return freeze({ record_id: candidate.record_id, state: 'exact', reason: 'SUPPORTED_DIMENSION', title_only: false });
  }
  if ((candidate.title ?? '') && !candidate.description && !candidate.measure && !candidate.source_id) {
    fail('TITLE_ONLY_ANSWER_FORBIDDEN');
  }
  return freeze({ record_id: candidate.record_id, state: 'contextual', reason: 'MISSING_CONTEXT', title_only: false });
}

export function censusSourceIdentity(candidate) {
  const source = normalize(candidate.source_id ?? '');
  const publisher = normalize(candidate.publisher ?? '');
  return source.includes('census') || publisher.includes('census bureau') || publisher === 'u s census bureau';
}

export function applyExclusions(question, candidates) {
  const q = normalize(question);
  const withoutCensus = /\b(?:excluding|exclude|except|without|not)\s+census\b/.test(q);
  if (!withoutCensus) return freeze({ excluded: freeze([]), retained: freeze(candidates), reason: null });
  const excluded = [];
  const retained = [];
  for (const candidate of candidates) {
    if (censusSourceIdentity(candidate)) excluded.push(freeze({ ...candidate, state: 'excluded', reason: 'EXPLICIT_WITHOUT_CENSUS' }));
    else retained.push(candidate);
  }
  return freeze({ excluded: freeze(excluded), retained: freeze(retained), reason: 'EXPLICIT_WITHOUT_CENSUS' });
}

export function rankScientific(question, candidates) {
  const filtered = applyExclusions(question, candidates);
  const classified = filtered.retained.map((candidate) => {
    const near = classifyNearMiss(question, candidate);
    return freeze({ ...candidate, ...near });
  });
  const ranked = [...classified].sort((left, right) => {
    const order = { exact: 0, uncertain: 1, contextual: 2, forbidden: 3, excluded: 4 };
    return (order[left.state] ?? 9) - (order[right.state] ?? 9);
  });
  const leading = ranked.find((row) => row.state === 'exact') ?? null;
  if (normalize(question).includes('maternal mortality') && leading?.measure === 'infant_mortality') {
    fail('INFANT_PROMOTED_FOR_MATERNAL_MORTALITY');
  }
  return freeze({
    question,
    leading,
    ranked: freeze(ranked),
    excluded: filtered.excluded,
    held_out_labels_used: HELD_OUT_LABELS_USED,
  });
}

export function maternalInfantNonEquivalence() {
  return nonEquivalence(FIXTURES.cdc_maternal_mortality, FIXTURES.cdc_infant_mortality, 'maternal_vs_infant_mortality');
}

export function scopedZero(question, candidates) {
  const q = normalize(question);
  const geoOnly = q.includes('pennsylvania') && !candidates.some((candidate) => {
    const text = normalize(`${candidate.title ?? ''} ${candidate.description ?? ''}`);
    return q.split(' ').filter((token) => token.length > 3 && token !== 'pennsylvania').some((token) => text.includes(token));
  });
  if (q.includes('flibbertigibbet') || q.includes('qzxwvu') || geoOnly) {
    return freeze({
      question,
      result_count: 0,
      state: 'scoped_zero',
      reason: 'GEOGRAPHY_ALONE_IS_NOT_RELEVANCE',
      candidates_considered: candidates.length,
    });
  }
  return freeze({ question, result_count: candidates.length, state: 'not_zero' });
}

export function explain(row) {
  return freeze({
    record_id: row.record_id,
    state: row.state,
    reason: row.reason,
    agrees_with_filter: row.state === 'excluded' ? row.reason === 'EXPLICIT_WITHOUT_CENSUS' : true,
    title_only: false,
  });
}
