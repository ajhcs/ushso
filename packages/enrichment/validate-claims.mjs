import { createHash } from 'node:crypto';
import { parseConstrainedExtraction } from './extract.mjs';

export const VALIDATOR_ID = 'ushso.claim-validator.v2';

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function validSpan(span, length) {
  return Number.isSafeInteger(span?.start) && Number.isSafeInteger(span?.end)
    && span.start >= 0 && span.end > span.start && span.end <= length;
}

/** Spans are UTF-16 offsets into the immutable source_bytes string. */
export function quoteSupported(task, quotation, span, passageIds = ['source']) {
  const text = task.source_bytes;
  if (typeof text !== 'string' || !quotation || !validSpan(span, text.length)
    || text.slice(span.start, span.end) !== quotation || !passageIds.length) return false;
  return passageIds.every((id) => {
    if (id === 'source') return true;
    const matches = (task.chunks ?? []).filter((chunk) => chunk.chunk_id === id);
    if (matches.length !== 1) return false;
    const range = matches[0].source_span;
    return validSpan(range, text.length) && range.start <= span.start && range.end >= span.end;
  });
}

// Literal extraction may select a whole term from a quotation, but cannot turn
// 120 into 12, -12 into 12, or a value elsewhere in the capture into evidence.
function quotedValueSupported(proposal) {
  const { value, quotation } = proposal;
  if (typeof value !== 'string' || !value.trim()) return false;
  const numeric = /^[+\-−]?(?:\d|\.\d)/u.test(value);
  const boundary = numeric ? /[\p{L}\p{N}\p{Pd}_%+−﹢＋]/u : /[\p{L}\p{N}_]/u;
  let offset = quotation.indexOf(value);
  while (offset !== -1) {
    const before = offset === 0 ? '' : quotation[offset - 1];
    const after = quotation[offset + value.length] ?? '';
    const numericContinuation = numeric && (/[.,]/.test(before) || (/[.,]/.test(after) && /\d/.test(quotation[offset + value.length + 1] ?? '')));
    if (!boundary.test(before) && !boundary.test(after) && !numericContinuation) return true;
    offset = quotation.indexOf(value, offset + 1);
  }
  return false;
}

export function semanticRoleMatches(task, proposal) {
  const expected = task.semantic_role ?? task.field;
  if (proposal.claim_type === 'unit' && expected !== 'unit' && task.field !== 'unit') return false;
  if (proposal.claim_type === 'definition' && expected === 'unit') return false;
  if (task.expected_value && proposal.value !== task.expected_value && proposal.claim_type !== 'abstention') return 'review';
  return true;
}

export function inventedUnitOrDefinition(task, proposal) {
  return (proposal.claim_type === 'unit' || proposal.claim_type === 'definition') && !quotedValueSupported(proposal);
}

export function retryableFailure(code) {
  return ['SYNTAX_FAILURE', 'TRANSPORT_FAILURE', 'TRUNCATED_OUTPUT', 'MALFORMED_JSON'].includes(code);
}

export function proposalHash(proposal) {
  return createHash('sha256').update(JSON.stringify({
    field: proposal.field,
    value: proposal.value,
    quotation: proposal.quotation,
    span: proposal.span,
    passage_ids: proposal.passage_ids,
    claim_type: proposal.claim_type,
  })).digest('hex');
}

export function validateClaim({ task, raw, model = 'openai/gpt-4.1-mini', prior = null } = {}) {
  let proposal;
  try {
    proposal = parseConstrainedExtraction(raw, task);
  } catch (error) {
    const code = error.code ?? 'SYNTAX_FAILURE';
    return freeze({
      status: 'rejected',
      retry: retryableFailure(code),
      reason: code,
      scientific_certified: false,
      schema_valid: code !== 'SYNTAX_FAILURE' && code !== 'MALFORMED_JSON',
      raw_response: typeof raw === 'string' ? raw : JSON.stringify(raw ?? null),
      model,
      validators: freeze([VALIDATOR_ID]),
      rejected_fields: freeze([task?.field ?? null]),
    });
  }
  const reasons = [];
  const supported = quoteSupported(task, proposal.quotation, proposal.span, proposal.passage_ids);
  if (!supported) reasons.push('UNRESOLVABLE_CITATION');
  if (inventedUnitOrDefinition(task, proposal)) reasons.push('INVENTED_UNIT_OR_DEFINITION');
  if (proposal.claim_type !== 'abstention' && !quotedValueSupported(proposal)) reasons.push('UNSUPPORTED_QUOTED_VALUE');
  if (proposal.claim_type === 'abstention') reasons.push('ABSTENTION');
  const role = semanticRoleMatches(task, proposal);
  if (role === false) reasons.push('WRONG_SEMANTIC_ROLE');
  if (role === 'review') reasons.push('SEMANTIC_ROLE_REVIEW');
  const hallucination = proposal.schema_valid === true && (!supported || reasons.includes('UNSUPPORTED_QUOTED_VALUE') || proposal.passage_ids.length === 0);
  if (hallucination) reasons.push('SCHEMA_VALID_HALLUCINATION');
  const reviewOnly = reasons.length === 1 && reasons[0] === 'WRONG_SEMANTIC_ROLE' && supported;
  const status = reasons.length === 0 ? 'accepted' : (reviewOnly || reasons.every((reason) => ['WRONG_SEMANTIC_ROLE', 'SEMANTIC_ROLE_REVIEW'].includes(reason)) ? 'review' : 'rejected');
  if (status === 'accepted' && !supported) fail('ACCEPTED_WITHOUT_CITATION');
  const hash = proposalHash(proposal);
  if (prior && prior.hash === hash && prior.status === 'rejected') {
    return freeze({
      status: 'rejected',
      retry: false,
      reason: 'UNSUPPORTED_CLAIM_STABLE',
      prior_status: 'rejected',
      hash,
      scientific_certified: false,
      schema_valid: true,
      proposal,
      model,
      validators: freeze([VALIDATOR_ID]),
      rejected_fields: freeze([proposal.field]),
      resolvable_citation: supported,
    });
  }
  const result = freeze({
    format: 'ushso.claim-validation.v1',
    status,
    retry: false,
    reasons: freeze(reasons),
    hash,
    proposal,
    raw_response: proposal.raw_response,
    model,
    validators: freeze([VALIDATOR_ID]),
    rejected_fields: freeze(status === 'accepted' ? [] : [proposal.field]),
    resolvable_citation: supported,
    quote_match: supported,
    scientific_certified: false,
    schema_valid: true,
    traceable_without_model: status === 'accepted',
  });
  if (result.status === 'accepted' && result.resolvable_citation !== true) fail('ACCEPTED_WITHOUT_CITATION');
  if (result.scientific_certified === true) fail('QUOTE_MATCH_NOT_SCIENTIFIC_CERTIFICATION');
  return result;
}

export function validateBatch(items) {
  const results = items.map((item) => validateClaim(item));
  const accepted = results.filter((row) => row.status === 'accepted');
  if (accepted.some((row) => row.resolvable_citation !== true)) fail('ACCEPTED_WITHOUT_CITATION');
  return freeze({
    results: freeze(results),
    accepted_with_resolvable_citations: accepted.length === 0 || accepted.every((row) => row.resolvable_citation === true),
  });
}
