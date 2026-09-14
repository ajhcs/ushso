import { representConservativeMeaning } from '../../../../../scripts/research/source-extractors.mjs';
import {
  BASELINE_RECORD_COUNT,
  ORIGINAL_AUDIT_GAPS,
  runFixtureSweep,
} from './sweep.mjs';

export { BASELINE_RECORD_COUNT };

export const QUALIFY_FORMAT = 'ushso.deterministic-qualification.v1';
export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const LAST_GOOD_MANIFEST_SHA256 = '85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e';
export const R03_DENOMINATOR = BASELINE_RECORD_COUNT;
export const R06_DENOMINATOR = BASELINE_RECORD_COUNT;
export const EMPIRICAL_TARGETS = Object.freeze({
  r01_all_ids_have_disposition: { id: 'R01', pass: true, note: 'Engineering evidence only; requirement remains unaccepted.' },
  r03_attempt_coverage: { id: 'R03', pass: false, note: 'Reserved fixture attempts are not full selected-source execution.' },
  r04_working_examples: { id: 'R04', pass: false, note: 'Working examples exist as PR-019 receipts, not corpus-wide payload checks.' },
  r06_unresolved_essential_fields: { id: 'R06', pass: false, note: 'Unresolved dictionary, unit and key gaps remain.' },
});

export async function blockedFetch() {
  const error = new Error('DETERMINISTIC_LIVE_NETWORK_FORBIDDEN');
  error.code = 'DETERMINISTIC_LIVE_NETWORK_FORBIDDEN';
  throw error;
}

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function passageFor(cause, sourceId, recordId) {
  if (cause === 'census_key_required') {
    return freeze({
      kind: 'public_passage',
      locator: 'tests/research-program/fixtures/pr009-census-negative/sample-census-acs.html',
      quote: 'Missing Key',
      record_id: recordId,
      source_id: sourceId,
    });
  }
  if (cause === 'html_not_json_success') {
    return freeze({
      kind: 'public_passage',
      locator: 'packages/connectors/src/content-classifier.mjs',
      quote: 'HTTP success HTML cannot become JSON payload success',
      record_id: recordId,
      source_id: sourceId,
    });
  }
  if (cause === 'dictionary_locator_unresolved') {
    return freeze({
      kind: 'public_passage',
      locator: 'verification/research-program/pr-013/',
      quote: 'XLSX tables without the word dictionary stay unresolved',
      record_id: recordId,
      source_id: sourceId,
    });
  }
  if (cause === 'isolated_non_searchable') {
    return freeze({
      kind: 'public_passage',
      locator: 'verification/research-program/pr-004/evidence.json',
      quote: 'description must be a non-empty string',
      record_id: recordId,
      source_id: sourceId,
    });
  }
  return freeze({
    kind: 'insufficient_evidence',
    locator: null,
    quote: null,
    record_id: recordId,
    source_id: sourceId,
    reason: 'No retained public passage is bound for this residual.',
  });
}

export function reconcileEvidence(sweep, { now = '2026-09-14T00:00:00.000Z' } = {}) {
  const rows = sweep.deficits.rows.map((row) => {
    const outcome = sweep.resumed.outcomes.find((item) => item.record_id === row.record_id);
    const attempted = outcome?.disposition === 'eligible_attempted';
    const captureReceipt = attempted
      ? freeze({
        capture_id: `capture:${row.record_id}`,
        parser_id: row.source_id === 'cms-data-catalog' ? 'cms-layout' : (row.source_id === 'cdc-socrata' ? 'cdc-view' : 'census-api'),
        observed_at: now,
        reused: outcome.reused === true,
      })
      : null;
    const success = attempted && captureReceipt !== null && row.cause !== 'census_key_required';
    if (success && captureReceipt === null) fail('SUCCESS_WITHOUT_RECEIPT');
    const stale = row.cause === 'dictionary_locator_unresolved';
    const partialDictionary = row.cause === 'dictionary_locator_unresolved' || row.cause === 'html_not_json_success';
    return freeze({
      record_id: row.record_id,
      source_id: row.source_id,
      disposition: row.disposition,
      cause: row.cause,
      success,
      promoted: false,
      promotion_blocked: success !== true,
      missing_evidence: captureReceipt === null,
      capture_receipt: captureReceipt,
      parser_receipt: captureReceipt,
      partial_dictionary: partialDictionary,
      stale_observation: stale,
      stale_reason: stale ? 'CMS dictionary locator remains unresolved against current capture' : null,
      timestamp: now,
    });
  });
  const successful = rows.filter((row) => row.success);
  if (successful.some((row) => row.capture_receipt === null || row.parser_receipt === null)) fail('SUCCESS_WITHOUT_RECEIPT');
  if (rows.some((row) => row.missing_evidence && row.promoted === true)) fail('MISSING_EVIDENCE_PROMOTED');
  return freeze({
    format: 'ushso.deterministic-evidence-reconciliation.v1',
    record_count: rows.length,
    rows: freeze(rows),
    successful_count: successful.length,
    failed_or_unattempted: rows.length - successful.length,
    last_good_generation: LAST_GOOD_GENERATION,
    last_good_unchanged: true,
    live_source_traffic: false,
  });
}

export function createResidualTasks(reconciliation, { maxResiduals = 12 } = {}) {
  const excluded = new Set(['census_key_required', 'unknown_eligibility', 'blocked_policy', 'not_applicable', 'eligible_unattempted']);
  const candidates = reconciliation.rows.filter((row) => {
    if (excluded.has(row.cause)) return false;
    if (row.cause === 'census_key_required') return false;
    if (row.missing_evidence && row.cause !== 'isolated_non_searchable' && row.cause !== 'html_not_json_success' && row.cause !== 'dictionary_locator_unresolved' && row.cause !== 'isolated_non_searchable') return false;
    return ['dictionary_locator_unresolved', 'html_not_json_success', 'isolated_non_searchable'].includes(row.cause);
  });
  const selected = [];
  const seen = new Set();
  for (const cause of ['dictionary_locator_unresolved', 'html_not_json_success', 'isolated_non_searchable']) {
    const hit = candidates.find((row) => row.cause === cause && !seen.has(row.record_id));
    if (hit) {
      selected.push(hit);
      seen.add(hit.record_id);
    }
  }
  for (const row of candidates) {
    if (selected.length >= maxResiduals) break;
    if (seen.has(row.record_id)) continue;
    selected.push(row);
    seen.add(row.record_id);
  }
  const tasks = selected.map((row, index) => {
    const evidence = passageFor(row.cause, row.source_id, row.record_id);
    const llmForbidden = evidence.kind !== 'public_passage';
    return freeze({
      residual_id: `residual:${String(index + 1).padStart(3, '0')}`,
      record_id: row.record_id,
      source_id: row.source_id,
      field: row.cause === 'dictionary_locator_unresolved' ? 'dictionary' : (row.cause === 'html_not_json_success' ? 'payload_media_type' : 'description'),
      cause: row.cause,
      owner: row.cause === 'html_not_json_success' || row.cause === 'dictionary_locator_unresolved' ? 'engineering' : 'research-program',
      excludes_credentials: true,
      excludes_forbidden_access: true,
      llm_from_memory_forbidden: true,
      evidence,
      insufficient_evidence: evidence.kind === 'insufficient_evidence',
      next_phase: 'PR-022 residual extraction only if public passage is bound',
    });
  });
  if (tasks.length >= BASELINE_RECORD_COUNT) fail('RESIDUAL_IS_ENTIRE_CORPUS');
  if (tasks.some((task) => task.llm_from_memory_forbidden !== true)) fail('LLM_MEMORY_TASK');
  if (tasks.some((task) => task.evidence.kind !== 'public_passage' && task.evidence.kind !== 'insufficient_evidence')) fail('RESIDUAL_EVIDENCE_SHAPE');
  return freeze({
    format: 'ushso.deterministic-residual-queue.v1',
    task_count: tasks.length,
    corpus_count: BASELINE_RECORD_COUNT,
    not_entire_corpus: tasks.length < BASELINE_RECORD_COUNT,
    tasks: freeze(tasks),
    excluded_causes: freeze([...excluded]),
    last_good_generation: LAST_GOOD_GENERATION,
    live_source_traffic: false,
  });
}

export function assertFailedThresholdsRemainFailed(targets = EMPIRICAL_TARGETS) {
  const failed = Object.values(targets).filter((row) => row.pass === false);
  if (failed.length === 0) fail('NO_FAILED_THRESHOLD_RECORDED');
  for (const row of failed) {
    if (row.pass !== false) fail('FAILED_THRESHOLD_FLIPPED');
  }
  return freeze({
    failed_count: failed.length,
    failed_ids: freeze(failed.map((row) => row.id)),
    undocumented_exception: false,
  });
}

export function publishDeterministicReadout({ sweep, reconciliation, residuals, fieldMeanings = [] } = {}) {
  const attemptCoverage = {
    denominator: R03_DENOMINATOR,
    numerator: sweep.compiled.counts.eligible_attempted,
    rate: sweep.compiled.counts.eligible_attempted / R03_DENOMINATOR,
    unattempted_eligible: sweep.compiled.counts.eligible_unattempted,
  };
  const parsedDictionaryYield = {
    denominator: R06_DENOMINATOR,
    numerator: reconciliation.rows.filter((row) => row.partial_dictionary !== true && row.success === true).length,
  };
  const unresolvedEssential = {
    denominator: R06_DENOMINATOR,
    numerator: reconciliation.rows.filter((row) => ['dictionary_locator_unresolved', 'census_key_required', 'html_not_json_success', 'isolated_non_searchable'].includes(row.cause)).length,
  };
  const thresholds = assertFailedThresholdsRemainFailed();
  const bySource = {};
  for (const row of reconciliation.rows) {
    bySource[row.source_id] ??= { records: 0, successful: 0, residuals: 0 };
    bySource[row.source_id].records += 1;
    if (row.success) bySource[row.source_id].successful += 1;
  }
  for (const task of residuals.tasks) {
    bySource[task.source_id] ??= { records: 0, successful: 0, residuals: 0 };
    bySource[task.source_id].residuals += 1;
  }
  const meaning = fieldMeanings.length
    ? fieldMeanings
    : [
      representConservativeMeaning({ source: 'census', release: LAST_GOOD_GENERATION, role: 'identifier', label: 'GEOID', concept: 'Census geography', unitState: 'not_applicable' }),
      representConservativeMeaning({ source: 'cdc', release: LAST_GOOD_GENERATION, role: 'rate', label: 'Crude Prevalence', definition: 'Percent of adults' }),
    ];
  return freeze({
    format: QUALIFY_FORMAT,
    last_good_generation: LAST_GOOD_GENERATION,
    last_good_manifest_sha256: LAST_GOOD_MANIFEST_SHA256,
    last_good_unchanged: true,
    publication_authorized: false,
    requirements_accepted: [],
    attempt_coverage: freeze(attemptCoverage),
    parsed_dictionary_yield: freeze(parsedDictionaryYield),
    working_examples: freeze({
      count: 2,
      notes: 'PR-019 CMS/CDC bounded samples exist; Census keyless HTML is not a tested example.',
    }),
    unresolved_essential_fields: freeze(unresolvedEssential),
    source_differences: freeze(bySource),
    residual_queue_count: residuals.task_count,
    residual_is_entire_corpus: residuals.not_entire_corpus !== true,
    r03_denominator: R03_DENOMINATOR,
    r06_denominator: R06_DENOMINATOR,
    empirical_targets: EMPIRICAL_TARGETS,
    failed_thresholds: thresholds,
    field_meaning_samples: freeze(meaning.map((row) => freeze({ source: row.source, completeness: row.completeness, concept_is_not_definition: row.concept_is_not_definition }))),
    original_audit_gaps: ORIGINAL_AUDIT_GAPS,
    live_source_traffic: false,
    scientific_qualification: false,
  });
}

export function renderDeterministicMarkdown(readout) {
  const failed = readout.failed_thresholds.failed_ids.join(', ');
  return [
    '# Deterministic extraction results',
    '',
    'Status: **not a publication**. Last good public generation remains `' + readout.last_good_generation + '`.',
    '',
    '## Boundary',
    '',
    '- R01–R16 remain unaccepted.',
    '- Failed empirical thresholds: ' + failed + '.',
    '- Residual queue count: ' + String(readout.residual_queue_count) + ' (not the entire 3434 corpus).',
    '- Last-good manifest SHA-256: `' + readout.last_good_manifest_sha256 + '`.',
    '',
    '## Coverage',
    '',
    '- Attempt coverage numerator/denominator: ' + String(readout.attempt_coverage.numerator) + '/' + String(readout.attempt_coverage.denominator) + '.',
    '- Unattempted eligible records: ' + String(readout.attempt_coverage.unattempted_eligible) + '.',
    '- Parsed dictionary yield: ' + String(readout.parsed_dictionary_yield.numerator) + '/' + String(readout.parsed_dictionary_yield.denominator) + '.',
    '- Unresolved essential fields: ' + String(readout.unresolved_essential_fields.numerator) + '/' + String(readout.unresolved_essential_fields.denominator) + '.',
    '',
    '## Next phase',
    '',
    'The next phase receives the residual queue in `packages/coverage/research-program/v1.0.0/src/qualify-deterministic.mjs`, not the entire corpus.',
    '',
  ].join('\n');
}

export async function qualifyDeterministic(options = {}) {
  const sweep = options.sweep ?? await runFixtureSweep({
    repoRoot: options.repoRoot,
    budget: options.budget ?? { max_attempts: 3, max_capture_charges: 3 },
    stopAfter: options.stopAfter ?? 1,
  });
  if (sweep.receipt.record_count !== BASELINE_RECORD_COUNT) fail('SWEEP_COUNT');
  const reconciliation = reconcileEvidence(sweep);
  const residuals = createResidualTasks(reconciliation, { maxResiduals: options.maxResiduals ?? 12 });
  const readout = publishDeterministicReadout({ sweep, reconciliation, residuals });
  if (readout.last_good_generation !== LAST_GOOD_GENERATION) fail('LAST_GOOD_CHANGED');
  if (readout.publication_authorized === true) fail('PUBLICATION_AUTHORIZED');
  if (readout.residual_is_entire_corpus === true) fail('RESIDUAL_IS_ENTIRE_CORPUS');
  return freeze({ sweep, reconciliation, residuals, readout, markdown: renderDeterministicMarkdown(readout) });
}
