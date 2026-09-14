import { createHash } from 'node:crypto';
import { taskIdentity } from './job-cache.mjs';

export const TASK_TYPES = Object.freeze({
  prose_definition: { model_extraction: true, adjudication_proposal: false },
  table_extraction: { model_extraction: true, adjudication_proposal: false },
  scientific_ambiguity: { model_extraction: false, adjudication_proposal: true },
  missing_evidence: { model_extraction: false, adjudication_proposal: false },
  access_blockade: { model_extraction: false, adjudication_proposal: false },
});

export const DEFAULT_TOKEN_BUDGET = 1800;

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

export function classifyResidualType(input = {}) {
  if (input.missing_publisher_document === true || input.cause === 'missing_publisher_document' || input.evidence?.kind === 'insufficient_evidence') {
    return 'missing_evidence';
  }
  if (input.access_blocked === true || input.cause === 'census_key_required' || input.cause === 'blocked_policy') {
    return 'access_blockade';
  }
  if (input.scientific_ambiguity === true || input.cause === 'scientific_ambiguity') {
    return 'scientific_ambiguity';
  }
  if (input.table === true || input.cause === 'dictionary_locator_unresolved' || input.field === 'dictionary') {
    return 'table_extraction';
  }
  return 'prose_definition';
}

export function chunkPassages({
  pages = [],
  tokenBudget = DEFAULT_TOKEN_BUDGET,
  field,
  header,
  denominator,
} = {}) {
  if (!Array.isArray(pages) || pages.length === 0) fail('PAGES_REQUIRED');
  const headerText = header ?? pages[0]?.header ?? null;
  const denominatorText = denominator ?? pages[0]?.denominator ?? null;
  const chunks = [];
  let overlapId = 0;
  for (const page of pages) {
    const body = String(page.text ?? '');
    const prefix = [headerText, denominatorText].filter(Boolean).join('\n');
    const window = tokenBudget * 4;
    let start = 0;
    let part = 0;
    while (start < body.length) {
      const slice = body.slice(start, start + window);
      const overlap = start > 0 ? body.slice(Math.max(0, start - 80), start) : '';
      const text = [prefix, overlap ? `[overlap ${overlapId}]${overlap}` : '', slice].filter(Boolean).join('\n');
      chunks.push(freeze({
        chunk_id: `${page.page ?? 1}.${part}`,
        page: page.page ?? 1,
        field,
        header: headerText,
        denominator: denominatorText,
        overlap_id: overlap ? `overlap:${overlapId}` : null,
        text,
        token_estimate: estimateTokens(text),
      }));
      start += window;
      part += 1;
      if (overlap) overlapId += 1;
    }
  }
  const fields = chunks.map((chunk) => chunk.field);
  if (new Set(fields).size !== 1) fail('FIELD_DOUBLE_COUNT');
  if (headerText && chunks.some((chunk) => chunk.header !== headerText)) fail('HEADER_LOST');
  if (denominatorText && chunks.some((chunk) => chunk.denominator !== denominatorText)) fail('DENOMINATOR_LOST');
  return freeze(chunks);
}

export function buildResidualTask(input = {}) {
  const type = classifyResidualType(input);
  const spec = TASK_TYPES[type];
  const missingDoc = input.missing_publisher_document === true || type === 'missing_evidence';
  const asksGuess = input.ask_model_to_guess === true;
  if (missingDoc && asksGuess) fail('MISSING_DOCUMENT_NOT_GUESSED');
  if (input.ask_to_authorize_access === true || input.ask_endpoint_availability === true) fail('MODEL_NOT_ASKED_TO_AUTHORIZE_ACCESS');
  if (input.entire_corpus === true) fail('TASK_NOT_ENTIRE_CORPUS');
  const sourceBytes = input.source_bytes ?? input.evidence?.quote ?? null;
  const incomplete = missingDoc || !sourceBytes || input.low_information === true || input.oversized === true;
  let status = 'accepted';
  if (missingDoc) status = 'abstain';
  else if (input.oversized === true || input.low_information === true) status = 'return_to_parsing';
  else if (!sourceBytes) status = 'abstain';
  const chunks = status === 'accepted' && Array.isArray(input.pages)
    ? chunkPassages({ pages: input.pages, field: input.field, header: input.header, denominator: input.denominator, tokenBudget: input.tokenBudget })
    : freeze([]);
  if (status === 'accepted' && !sourceBytes) fail('SOURCE_BYTES_REQUIRED');
  const taskId = input.task_id ?? `task:${createHash('sha256').update(JSON.stringify({
    record_id: input.record_id,
    field: input.field,
    type,
    source: sourceBytes,
  })).digest('hex').slice(0, 24)}`;
  const identity = taskIdentity({
    sourceBytes: sourceBytes ?? '',
    parserVersion: 'pr025-task-builder',
    prompt: type,
    schemaVersion: 'ushso.residual-task.v1',
    model: 'none-until-accepted-extraction',
    providerPolicyVersion: 'openrouter-privacy-2026-09-10',
    scope: taskId,
  });
  const cannot = [];
  if (missingDoc) cannot.push('publisher_document_absent');
  if (type === 'access_blockade') cannot.push('access_not_authorized_by_model');
  if (type === 'scientific_ambiguity') cannot.push('scientific_adjudication_required');
  if (incomplete && status !== 'accepted') cannot.push('incomplete_context');
  const task = freeze({
    task_id: taskId,
    identity,
    task_type: type,
    record_id: input.record_id ?? 'unknown',
    field: input.field ?? 'unresolved_field',
    status,
    model_extraction: spec.model_extraction && status === 'accepted',
    adjudication_proposal: spec.adjudication_proposal,
    source_bytes: status === 'accepted' ? sourceBytes : sourceBytes,
    source_release: input.source_release ?? null,
    chunks,
    token_estimate: chunks.reduce((sum, chunk) => sum + chunk.token_estimate, 0) || estimateTokens(sourceBytes),
    cannot_conclude: freeze(cannot),
    asks_to_guess_missing_document: false,
    asks_to_authorize_access: false,
    processes_entire_corpus: false,
    expected_output_scope: freeze({ field: input.field ?? 'unresolved_field', record_id: input.record_id ?? null }),
  });
  if (task.asks_to_guess_missing_document === true) fail('MISSING_DOCUMENT_NOT_GUESSED');
  if (task.processes_entire_corpus === true) fail('TASK_NOT_ENTIRE_CORPUS');
  if (task.status === 'accepted' && !task.source_bytes) fail('SOURCE_BYTES_REQUIRED');
  return task;
}

export function buildResidualManifest(residuals = [], options = {}) {
  const tasks = residuals.map((row) => buildResidualTask({ ...options, ...row }));
  if (tasks.length >= 3434) fail('TASK_NOT_ENTIRE_CORPUS');
  return freeze({
    format: 'ushso.residual-task-manifest.v1',
    task_count: tasks.length,
    processes_entire_corpus: false,
    tasks: freeze(tasks),
  });
}
