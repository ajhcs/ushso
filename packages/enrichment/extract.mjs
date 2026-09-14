import { createHash } from 'node:crypto';

export const EXTRACT_FORMAT = 'ushso.extraction-proposal.v1';
export const CLAIM_TYPES = Object.freeze(['literal', 'definition', 'unit', 'table_value', 'abstention']);
export const UNCERTAINTY = Object.freeze(['certain', 'uncertain', 'insufficient_evidence']);

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function requiredProposalFields() {
  return freeze(['field', 'value', 'passage_ids', 'quotation', 'span', 'claim_type', 'uncertainty', 'abstention_reason']);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseConstrainedExtraction(raw, task) {
  const rawText = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
  let payload;
  try {
    payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    fail('SYNTAX_FAILURE');
  }
  if (!isPlainObject(payload)) fail('SYNTAX_FAILURE');
  for (const key of requiredProposalFields()) {
    if (!Object.hasOwn(payload, key)) fail('RESPONSE_SCHEMA_INVALID');
  }
  if (typeof payload.field !== 'string' || payload.field.length < 1) fail('RESPONSE_SCHEMA_INVALID');
  if (!(typeof payload.value === 'string' || payload.value === null)) fail('RESPONSE_SCHEMA_INVALID');
  if (!Array.isArray(payload.passage_ids) || payload.passage_ids.some((id) => typeof id !== 'string')) fail('RESPONSE_SCHEMA_INVALID');
  if (typeof payload.quotation !== 'string') fail('RESPONSE_SCHEMA_INVALID');
  if (!isPlainObject(payload.span) || typeof payload.span.start !== 'number' || typeof payload.span.end !== 'number') fail('RESPONSE_SCHEMA_INVALID');
  if (!CLAIM_TYPES.includes(payload.claim_type)) fail('RESPONSE_SCHEMA_INVALID');
  if (!UNCERTAINTY.includes(payload.uncertainty)) fail('RESPONSE_SCHEMA_INVALID');
  if (!(typeof payload.abstention_reason === 'string' || payload.abstention_reason === null)) fail('RESPONSE_SCHEMA_INVALID');
  if (payload.record_id && payload.record_id !== task.record_id) fail('UNKNOWN_RECORD_ID');
  if (payload.field !== task.field) fail('UNKNOWN_FIELD');
  const allowedPassages = new Set((task.chunks ?? []).map((chunk) => chunk.chunk_id).concat(task.evidence_ids ?? []));
  if (task.source_bytes) allowedPassages.add('source');
  for (const id of payload.passage_ids) {
    if (!allowedPassages.has(id)) fail('UNKNOWN_CITATION');
  }
  return freeze({
    format: EXTRACT_FORMAT,
    field: payload.field,
    value: payload.value,
    passage_ids: freeze([...payload.passage_ids]),
    quotation: payload.quotation,
    span: freeze({ start: payload.span.start, end: payload.span.end }),
    claim_type: payload.claim_type,
    uncertainty: payload.uncertainty,
    abstention_reason: payload.abstention_reason,
    record_id: task.record_id,
    raw_response: rawText,
    schema_valid: true,
    scientific_certified: false,
  });
}
