import { FALSE_TRUTH_BOUNDARY } from './safety.mjs';

const NONRETRYABLE = new Set([
  'invalid_input',
  'record_unavailable_in_generation',
  'schema_context_required',
  'generation_mismatch',
  'generation_unavailable',
  'cursor_expired',
  'clarification_token_invalid',
  'clarification_expired',
  'coverage_unknown',
  'route_not_documented',
  'comparison_limit_exceeded',
  'response_limit_exceeded',
  'planner_unavailable',
]);

const RESTART_REQUIRED = new Set(['cursor_expired', 'generation_unavailable', 'generation_mismatch']);

export const RECOVERY_GUIDANCE = Object.freeze({
  cursor_expired: Object.freeze({
    safe_message: 'The continuation cursor cannot be used for this traversal.',
    corrective_guidance: 'Restart the request without a cursor, preserve the original research question, and keep any valid generation pin. A cursor for one tool or query cannot page a different collection, and an expired cursor must not silently begin a new generation.',
  }),
  generation_unavailable: Object.freeze({
    safe_message: 'The requested generation pin does not match this snapshot.',
    corrective_guidance: 'Restart the request without a cursor, preserve the original research question, and pin to the newly returned generation. Do not continue an expired or foreign cursor across a snapshot change.',
  }),
  generation_mismatch: Object.freeze({
    safe_message: 'The continuation cursor is bound to a different generation than this request.',
    corrective_guidance: 'Restart the request without a cursor, preserve the original research question, and pin to the newly returned generation. Do not page one snapshot with another snapshot\'s cursor.',
  }),
});

export function isRetryableDomainCode(code) {
  return code === 'service_unavailable' || code === 'rate_limited';
}

export function isNonretryableDomainCode(code) {
  return NONRETRYABLE.has(code);
}

export function restartRequiredForCode(code) {
  return RESTART_REQUIRED.has(code);
}

export function recoveryGuidance(code) {
  return RECOVERY_GUIDANCE[code] ?? null;
}

export function shouldRetryEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return false;
  if (envelope.ok === true) return false;
  const code = envelope.error?.code;
  if (envelope.error?.retryable === true) return isRetryableDomainCode(code);
  return false;
}

export function isCompletedResearchTask(envelope) {
  void envelope;
  return false;
}

export function interpretClientEnvelope(envelope, { httpStatus = null } = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return Object.freeze({
      kind: 'invalid_envelope',
      http_status: httpStatus,
      retryable: false,
      restart_required: true,
      completed_research_task: false,
      preserve_next_cursor: false,
      preserve_omitted_sections: false,
    });
  }
  const code = envelope.error?.code ?? null;
  const truncated = envelope.truncated === true;
  return Object.freeze({
    kind: envelope.ok === true ? 'domain_result' : 'domain_error',
    http_status: httpStatus,
    result_state: envelope.result_state ?? null,
    error_code: code,
    retryable: shouldRetryEnvelope(envelope),
    restart_required: envelope.restart_required === true || restartRequiredForCode(code),
    completed_research_task: false,
    transport_success_is_not_task_completion: true,
    preserve_next_cursor: truncated && typeof envelope.next_cursor === 'string',
    preserve_omitted_sections: truncated && Array.isArray(envelope.omitted_sections) && envelope.omitted_sections.length > 0,
    truth_boundary: envelope.truth_boundary ?? FALSE_TRUTH_BOUNDARY,
  });
}

export const RECOVERY_EXAMPLES = Object.freeze({
  expired_cursor_restart: Object.freeze({
    error_code: 'cursor_expired',
    retryable: false,
    restart_required: true,
    drop_cursor: true,
    preserve_research_question: true,
    silent_new_generation: false,
  }),
  unknown_schema_is_not_empty_variables: Object.freeze({
    error_code: 'schema_context_required',
    result_state: 'unknown',
    ok: false,
    empty_fields_forbidden: true,
    completed_research_task: false,
  }),
  partial_page_keeps_cursor: Object.freeze({
    ok: true,
    result_state: 'partial',
    truncated: true,
    preserve_next_cursor: true,
    preserve_omitted_sections: true,
    retry_nonretryable: false,
    completed_research_task: false,
  }),
});
