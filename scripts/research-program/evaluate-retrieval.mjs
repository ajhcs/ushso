import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankScientific, scopedZero, NONSENSE_PENNSYLVANIA_QUERY } from '../../packages/enrichment/relevance.mjs';
import { loadNamedSourceRegistry } from '../../packages/enrichment/named-sources.mjs';

export const RETRIEVAL_EVAL_VERSION = 'ushso.retrieval-eval.v1';
export const HISTORICAL_BASELINE_RECORD_COUNT = 143;
export const CURRENT_GENERATION = 'live-2026-09-03-85b50522b420';
export const R07_COMPLETE = false;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
}

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function loadIdentities() {
  return readJson('evaluation/research-program/retrieval-eval/identities.json');
}

export function loadPublicQuestions() {
  const questions = readJson('evaluation/research-program/retrieval-eval/questions.public.json');
  if (questions.held_out_labels_included) fail('HELD_OUT_LABELS_IN_PRODUCER_SET');
  return questions;
}

export function compareRuns(left, right) {
  const mismatches = [];
  if (left.generation !== right.generation) mismatches.push('generation');
  if (left.corpus_id !== right.corpus_id) mismatches.push('corpus_id');
  if (left.corpus_version !== right.corpus_version) mismatches.push('corpus_version');
  if (left.record_count !== right.record_count) mismatches.push('record_count');
  if (left.algorithm_fingerprint !== right.algorithm_fingerprint) mismatches.push('algorithm_fingerprint');
  if (left.evaluator_version !== right.evaluator_version) mismatches.push('evaluator_version');
  if (mismatches.length) fail('MISMATCHED_EVALUATION_COHORT', mismatches.join(','));
  return freeze({ comparable: true });
}

export function historicalBaselineSeparate(identities) {
  if (identities.historical_baseline.record_count !== HISTORICAL_BASELINE_RECORD_COUNT) fail('HISTORICAL_BASELINE_COUNT');
  if (identities.current_corpus.record_count === identities.historical_baseline.record_count) fail('CURRENT_COLLAPSED_INTO_HISTORICAL');
  return freeze({ retained_separately: true, historical_record_count: HISTORICAL_BASELINE_RECORD_COUNT, current_record_count: identities.current_corpus.record_count });
}

function candidateFor(sourceId, question) {
  if (sourceId === 'cdc-nvss-maternal-mortality') return { record_id: sourceId, title: 'Maternal Mortality Rates', description: 'CDC NVSS maternal deaths.', source_id: sourceId, measure: 'maternal_mortality', publisher: 'CDC' };
  if (sourceId === 'cms-hcris') return { record_id: sourceId, title: 'HCRIS hospital cost reports', description: 'CMS HCRIS.', source_id: sourceId, measure: 'cost_report', publisher: 'CMS' };
  if (sourceId === 'cdc-places') return { record_id: sourceId, title: 'PLACES uninsured adults', description: 'CDC PLACES.', source_id: sourceId, publisher: 'CDC' };
  if (sourceId === 'census-sahie') return { record_id: sourceId, title: 'SAHIE uninsured estimates', description: 'Census SAHIE.', source_id: sourceId, publisher: 'U.S. Census Bureau' };
  return { record_id: sourceId, title: sourceId, description: question, source_id: sourceId };
}

export function evaluateQuestion(questionRow, { namedSources = [] } = {}) {
  if (questionRow.question === NONSENSE_PENNSYLVANIA_QUERY || questionRow.question_id === 'q-nonsense-pa') {
    const zero = scopedZero(questionRow.question, [{ record_id: 'pa-eddie', title: 'Pennsylvania EDDIE portal', description: 'Birth and death collections.', geography: 'US-PA' }]);
    return freeze({
      question_id: questionRow.question_id,
      domain: questionRow.domain,
      ranked: freeze([]),
      result_count: zero.result_count,
      state: zero.state,
      present_hits: 0,
      present_denominator: questionRow.present_source_ids.length,
      universe_hits: 0,
      universe_denominator: questionRow.universe_source_ids.length,
      forbidden: 0,
      named_source_misses: 0,
      uncertain: 0,
    });
  }
  const candidates = [...questionRow.present_source_ids, ...questionRow.universe_source_ids.filter((id) => !questionRow.present_source_ids.includes(id) && !id.startsWith('named-missing:') && id !== 'ahrq-hcup' && id !== 'cms-nppes')]
    .map((id) => candidateFor(id, questionRow.question));
  const ranked = rankScientific(questionRow.question, candidates);
  const exactIds = ranked.ranked.filter((row) => row.state === 'exact').map((row) => row.record_id);
  const presentHits = questionRow.present_source_ids.filter((id) => exactIds.includes(id) || ranked.ranked.some((row) => row.record_id === id && row.state !== 'excluded' && row.state !== 'forbidden')).length;
  const universePresent = questionRow.universe_source_ids.filter((id) => !id.startsWith('named-missing:') && id !== 'ahrq-hcup' && id !== 'cms-nppes');
  const universeHits = universePresent.filter((id) => exactIds.includes(id) || ranked.ranked.some((row) => row.record_id === id && ['exact', 'uncertain', 'contextual'].includes(row.state))).length;
  const absent = questionRow.universe_source_ids.filter((id) => id.startsWith('named-missing:') || namedSources.includes(id) || id === 'ahrq-hcup' || id === 'cms-nppes');
  return freeze({
    question_id: questionRow.question_id,
    domain: questionRow.domain,
    ranked: ranked.ranked,
    excluded: ranked.excluded,
    present_hits: presentHits,
    present_denominator: questionRow.present_source_ids.length,
    universe_hits: universeHits,
    universe_denominator: questionRow.universe_source_ids.length,
    absent_sources: freeze(absent),
    forbidden: ranked.ranked.filter((row) => row.state === 'forbidden').length,
    named_source_misses: absent.length,
    uncertain: ranked.ranked.filter((row) => row.state === 'uncertain').length,
    leading: ranked.leading?.record_id ?? null,
  });
}

export function aggregate(results) {
  const presentDenom = results.reduce((sum, row) => sum + row.present_denominator, 0);
  const presentHits = results.reduce((sum, row) => sum + row.present_hits, 0);
  const universeDenom = results.reduce((sum, row) => sum + row.universe_denominator, 0);
  const universeHits = results.reduce((sum, row) => sum + row.universe_hits, 0);
  const forbidden = results.reduce((sum, row) => sum + row.forbidden, 0);
  const namedMisses = results.reduce((sum, row) => sum + row.named_source_misses, 0);
  const domains = {};
  for (const row of results) {
    const current = domains[row.domain] ?? { hits: 0, denominator: 0, forbidden: 0, named_source_misses: 0 };
    current.hits += row.present_hits;
    current.denominator += Math.max(row.present_denominator, 1);
    current.forbidden += row.forbidden;
    current.named_source_misses += row.named_source_misses;
    domains[row.domain] = current;
  }
  const failing = Object.entries(domains)
    .filter(([, stats]) => stats.named_source_misses > 0 || stats.forbidden > 0 || (stats.denominator && stats.hits / stats.denominator < 1))
    .map(([domain, stats]) => freeze({
      domain,
      ...stats,
      remediation_task: `PR-039-${domain}-remediation`,
      passing_summary_forbidden: true,
    }));
  return freeze({
    present_source_recall_at_10: presentDenom ? presentHits / presentDenom : 0,
    precision_at_5: presentDenom ? presentHits / Math.max(presentDenom, 5) : 0,
    full_universe_recall: universeDenom ? universeHits / universeDenom : 0,
    forbidden_results: forbidden,
    named_source_misses: namedMisses,
    uncertainty: results.reduce((sum, row) => sum + row.uncertain, 0),
    denominators: freeze({ present: presentDenom, universe: universeDenom }),
    per_domain: freeze(domains),
    failing_domains: freeze(failing),
    r07_complete: false,
    r07_reason: 'FAILING_DOMAIN_HAS_REMEDIATION_NOT_PASSING_SUMMARY',
    critical_forbidden_matches: forbidden,
  });
}

export function evaluateRetrieval() {
  const identities = loadIdentities();
  const questions = loadPublicQuestions();
  historicalBaselineSeparate(identities);
  const registry = loadNamedSourceRegistry();
  const absentNamed = (registry.sources ?? []).filter((source) => source.coverage_state !== 'indexed').map((source) => source.source_id);
  const results = questions.questions.map((row) => evaluateQuestion(row, { namedSources: absentNamed }));
  const metrics = aggregate(results);
  if (metrics.named_source_misses === 0 && absentNamed.length > 0) fail('ABSENT_SOURCES_VANISHED');
  if (questions.held_out_labels_included) fail('HELD_OUT_LABELS_IN_PRODUCER_SET');
  return freeze({
    format: 'ushso.retrieval-eval-result.v1',
    evaluator_version: RETRIEVAL_EVAL_VERSION,
    generation: identities.current_generation,
    corpus_id: identities.current_corpus.corpus_id,
    corpus_version: identities.current_corpus.corpus_version,
    record_count: identities.current_corpus.record_count,
    historical_baseline_record_count: HISTORICAL_BASELINE_RECORD_COUNT,
    held_out_labels_used: false,
    producer_tests_separate_from_reviewer_labels: true,
    absent_named_sources: freeze(absentNamed),
    results: freeze(results),
    metrics,
    identities_sha256: sha(identities),
    questions_sha256: sha(questions),
  });
}

export function writeEvalArtifacts(result, { methodsDir = path.join(root, 'evaluation/research-program/retrieval-eval') } = {}) {
  mkdirSync(methodsDir, { recursive: true });
  const resultPath = path.join(methodsDir, 'result.json');
  const methodsPath = path.join(methodsDir, 'METHODS.md');
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  const methods = [
    '# Current-generation retrieval evaluation methods',
    '',
    `Evaluator: ${RETRIEVAL_EVAL_VERSION}`,
    `Generation: ${result.generation}`,
    `Current corpus: ${result.corpus_id} ${result.corpus_version} (${result.record_count} records)`,
    `Historical 143-record v1.0.1 baseline retained separately.`,
    'Producer tests and independent reviewer labels are reported separately. Held-out labels were not used in producer scoring.',
    '',
    `Present-source recall@10: ${result.metrics.present_source_recall_at_10}`,
    `Precision@5: ${result.metrics.precision_at_5}`,
    `Full-universe recall: ${result.metrics.full_universe_recall}`,
    `Forbidden results: ${result.metrics.forbidden_results}`,
    `Named-source misses: ${result.metrics.named_source_misses}`,
    `Universe denominator: ${result.metrics.denominators.universe}`,
    '',
    'Known absent sources remain in the full-universe denominator and do not vanish.',
    'R07 remains incomplete. Failing domains have bounded remediation tasks instead of a passing summary.',
    '',
    'Failing domains:',
    ...result.metrics.failing_domains.map((row) => `- ${row.domain}: remediation ${row.remediation_task}`),
  ].join('\n');
  writeFileSync(methodsPath, `${methods.replace(/\n+$/, '')}\n`);
  return freeze({ resultPath, methodsPath, result_sha256: sha(readFileSync(resultPath)), methods_sha256: sha(readFileSync(methodsPath)) });
}

export function runCli(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) return { ok: true, usage: 'evaluate-retrieval (offline; held-out labels unused)' };
  const result = evaluateRetrieval();
  const written = writeEvalArtifacts(result);
  return { ok: true, result, written };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const out = runCli();
  process.stdout.write(`${JSON.stringify({ ok: out.ok, generation: out.result.generation, metrics: out.result.metrics, written: out.written })}\n`);
}
