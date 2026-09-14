import { createHash } from 'node:crypto';
import { parseConstrainedExtraction } from './extract.mjs';

export const VALIDATOR_ID = 'ushso.claim-validator.v1';

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function captureText(task) {
  const chunks = (task.chunks ?? []).map((chunk) => chunk.text).join('\n');
  return String(task.source_bytes ?? chunks ?? '');
}

export function quoteSupported(task, quotation, span) {
  const text = captureText(task);
  if (!quotation) return false;
  if (typeof span?.start === 'number' && typeof span?.end === 'number' && span.end >= span.start) {
    const sliced = text.slice(span.start, span.end);
    if (sliced === quotation) return true;
  }
  return text.includes(quotation);
}

export function semanticRoleMatches(task, proposal) {
  const expected = task.semantic_role ?? task.field;
  if (proposal.claim_type === 'unit' && expected !== 'unit' && task.field !== 'unit') return false;
  if (proposal.claim_type === 'definition' && expected === 'unit') return false;
  if (task.expected_value && proposal.value !== task.expected_value && proposal.claim_type !== 'abstention') return 'review';
  return true;
}

export function inventedUnitOrDefinition(task, proposal) {
  const text = captureText(task);
  if (!proposal.value) return false;
  if ((proposal.claim_type === 'unit' || proposal.claim_type === 'definition') && !text.includes(proposal.value)) return true;
  return false;
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
  const supported = quoteSupported(task, proposal.quotation, proposal.span);
  if (!supported) reasons.push('UNRESOLVABLE_CITATION');
  if (inventedUnitOrDefinition(task, proposal)) reasons.push('INVENTED_UNIT_OR_DEFINITION');
  const role = semanticRoleMatches(task, proposal);
  if (role === false) reasons.push('WRONG_SEMANTIC_ROLE');
  if (role === 'review') reasons.push('SEMANTIC_ROLE_REVIEW');
  const hallucination = proposal.schema_valid === true && (!supported || reasons.includes('INVENTED_UNIT_OR_DEFINITION') || proposal.passage_ids.length === 0);
  if (hallucination) reasons.push('SCHEMA_VALID_HALLUCINATION');
  const reviewOnly = reasons.length === 1 && reasons[0] === 'WRONG_SEMANTIC_ROLE' && supported;
  const status = reasons.length === 0 ? 'accepted' : (reviewOnly || reasons.includes('SEMANTIC_ROLE_REVIEW') && supported && !reasons.includes('UNRESOLVABLE_CITATION') && !reasons.includes('INVENTED_UNIT_OR_DEFINITION') && !reasons.includes('SCHEMA_VALID_HALLUCINATION') ? 'review' : 'rejected');
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
