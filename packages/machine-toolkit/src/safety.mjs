import { serializedBytes } from './json.mjs';
import { responseSchemaIssues } from './response-schema.mjs';

export const FALSE_TRUTH_BOUNDARY = Object.freeze({
  source_requests_made: false,
  execution_authorized_by_ushso: false,
  retrieval_executed: false,
  payloads_acquired: false,
  analysis_executed: false,
  identity_merges_performed: false
});

const CORE_REQUIRED = Object.freeze([
  'tool_contract_version', 'capability', 'ok', 'registry_revision', 'index_generation',
  'publication_manifest_id', 'canonical_as_of', 'coverage_snapshot_id', 'result_state',
  'result', 'error', 'evidence_references', 'warnings', 'truncated', 'omitted_sections',
  'next_cursor', 'continuation_expires_at', 'generation_retention_expires_at',
  'restart_required', 'rate_limit', 'truth_boundary'
]);

const TRANSPORT_FIELDS = new Set(['transport_adapter', 'request_id', 'response_generated_at', 'result_snapshot_id', 'candidate_snapshot_id']);
const CORE_ALLOWED = new Set(CORE_REQUIRED);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,127}$/u;
const CURSOR = /^[A-Za-z0-9._~-]{16,2048}$/u;
const ERROR_CODES = new Set(['invalid_input', 'record_unavailable_in_generation', 'schema_context_required', 'generation_mismatch', 'generation_unavailable', 'cursor_expired', 'clarification_token_invalid', 'clarification_expired', 'coverage_unknown', 'route_not_documented', 'comparison_limit_exceeded', 'response_limit_exceeded', 'planner_unavailable', 'rate_limited', 'service_unavailable']);
const RESULT_STATES = new Set(['complete', 'partial', 'empty', 'unknown', 'unavailable', 'gated', 'disabled']);
const RESULT_KEYS = Object.freeze({
  search_assets: new Set(['mode', 'sort', 'ranker_version', 'grouping', 'cursor_binding_digest', 'summaries', 'facet_counts', 'aggregates', 'scoped_zero_statement', 'absence_claim_permitted']),
  get_asset: new Set(['asset', 'source', 'identity_state', 'family_state', 'releases', 'distributions', 'documentation', 'schemas', 'collection_completeness']),
  get_access_plan: new Set(['asset_id', 'release_id', 'distribution_id', 'access_route_id', 'access_class', 'requester_eligibility', 'eligibility_criteria', 'requirements', 'human_process', 'process_steps', 'turnaround_category', 'authoritative_links', 'verified_at', 'human_authorization_gate', 'execution_authorized_by_ushso', 'access_workflow_submitted', 'evidence_ids']),
  get_retrieval_recipe: new Set(['asset_id', 'release_id', 'distribution_id', 'access_route_id', 'interface', 'request_method', 'request_template', 'parameters', 'authentication_type', 'pagination', 'response_formats', 'compression', 'size_category', 'update_behavior', 'parser_hints', 'sample_requests', 'expected_artifacts', 'checks', 'stop_conditions', 'retrieval_executed', 'payloads_acquired', 'evidence_ids']),
  get_variables: new Set(['asset_id', 'release_id', 'distribution_id', 'schema_id', 'schema_completeness', 'fields']),
  get_join_routes: new Set(['from_id', 'to_id', 'max_hops_used', 'routes']),
  compare_assets: new Set(['asset_ids', 'dimensions', 'pairwise_operations', 'ranking_performed', 'source_values_compared']),
  get_coverage_status: new Set(['federal_baseline', 'cells', 'scope_interpretation', 'absence_claim_permitted']),
  plan_research: new Set(['plan', 'clarification_token', 'clarification_expires_at', 'questions'])
});
const SECRET_KEYS = new Set(['authorization_header', 'authorization', 'cookie', 'set_cookie', 'password', 'api_key_value', 'credential', 'credentials', 'signed_url', 'presigned_url']);
const SOURCE_PAYLOAD_KEYS = new Set(['source_rows', 'dataset_rows', 'payload_excerpt', 'payload_body', 'response_body', 'sample_response', 'sample_responses', 'sample_response_rows']);
const ANALYSIS_KEYS = new Set(['market_share', 'financial_benchmark', 'analytical_ranking', 'computed_statistics', 'benchmark_result', 'analysis_results']);
const SOURCE_CONTROL_KEYS = new Set(['tool_name', 'toolname', 'input_schema', 'inputschema', 'annotations', 'system_prompt', 'systemprompt']);
const SECRET_QUERY_NAMES = new Set([
  'token',
  'access_token',
  'api_key',
  'key',
  'signature',
  'sig',
  'x_amz_credential',
  'x_amz_signature',
  'x_amz_security_token',
  'x_goog_signature',
  'x_goog_credential',
  'x_goog_security_token',
  'oauth_token',
  'refresh_token',
  'id_token',
  'session_token',
  'client_secret',
  'private_key'
]);
const SAFE_ERROR_PRIVACY = /\b(?:quarantined|excluded|withdrawn|private|never existed|internal reason|suppressed)\b/iu;
const SECRET_STRING = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*[^\s,;]{4,})/iu;

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (host === 'localhost' || host === 'metadata.google.internal' || /\.(?:localhost|local|internal|home\.arpa|onion)$/u.test(host)) return true;
  const octets = host.split('.');
  if (octets.length === 4 && octets.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)) {
    const [first, second] = octets.map(Number);
    return first === 0 || first === 10 || first === 127 || first >= 224
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && [0, 168].includes(second))
      || (first === 198 && [18, 19].includes(second));
  }
  if (host === '::' || host === '::1' || /^[fd][0-9a-f]{1,3}:/u.test(host) || /^fe[89ab][0-9a-f]:/u.test(host)) return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(host);
  return mapped ? isPrivateHost(mapped[1]) : false;
}

function issue(code, path, message = code) {
  return { code, path, message };
}

function visit(value, callback, path = '') {
  callback(value, path);
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, callback, `${path}/${index}`));
  else for (const [key, entry] of Object.entries(value)) visit(entry, callback, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
}

export function prohibitedOutputIssues(value) {
  const issues = [];
  visit(value, (entry, path) => {
    if (typeof entry === 'string') {
      if (SECRET_STRING.test(entry)) issues.push(issue('SECRET_VALUE_PROHIBITED', path));
      if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(entry)) {
        try {
          const url = new URL(entry);
          if (!['http:', 'https:'].includes(url.protocol)) issues.push(issue('URL_PROTOCOL_PROHIBITED', path));
          for (const name of url.searchParams.keys()) {
            const normalized = name.toLowerCase().replaceAll('-', '_');
            if (SECRET_QUERY_NAMES.has(normalized)) issues.push(issue('SECRET_QUERY_PROHIBITED', path));
          }
          if (url.username || url.password) issues.push(issue('URL_CREDENTIAL_PROHIBITED', path));
          if (isPrivateHost(url.hostname)) issues.push(issue('PRIVATE_LOCATOR_PROHIBITED', path));
        } catch {
          // URI syntax is enforced by the canonical service schema boundary.
        }
      }
      return;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    for (const key of Object.keys(entry)) {
      const normalized = key.toLowerCase();
      const fieldPath = `${path}/${key}`;
      if (SECRET_KEYS.has(normalized)) issues.push(issue('SECRET_FIELD_PROHIBITED', fieldPath));
      if (SOURCE_PAYLOAD_KEYS.has(normalized)) issues.push(issue('SOURCE_PAYLOAD_PROHIBITED', fieldPath));
      if (ANALYSIS_KEYS.has(normalized)) issues.push(issue('ANALYSIS_RESULT_PROHIBITED', fieldPath));
      if (path.startsWith('/result') && SOURCE_CONTROL_KEYS.has(normalized)) issues.push(issue('SOURCE_CONTROL_FIELD_PROHIBITED', fieldPath));
    }
  });
  return issues;
}

function countIssues(core, input) {
  if (!core.ok || !core.result) return [];
  const result = core.result;
  const issues = [];
  const maximum = (array, limit, path) => {
    if (!Array.isArray(array) || array.length > limit) issues.push(issue('CARDINALITY_EXCEEDED', path));
  };
  switch (core.capability) {
    case 'search_assets':
      maximum(result.summaries, input.limit, '/result/summaries');
      maximum(result.facet_counts, 100, '/result/facet_counts');
      maximum(result.aggregates, 100, '/result/aggregates');
      break;
    case 'get_asset':
      for (const name of ['releases', 'distributions', 'documentation', 'schemas']) maximum(result[name], input.collection_limits[name], `/result/${name}`);
      break;
    case 'get_access_plan':
      maximum(result.requirements, 50, '/result/requirements');
      maximum(result.process_steps, 50, '/result/process_steps');
      break;
    case 'get_retrieval_recipe':
      maximum(result.parameters, 100, '/result/parameters');
      maximum(result.parser_hints, 100, '/result/parser_hints');
      maximum(result.sample_requests, 10, '/result/sample_requests');
      break;
    case 'get_variables':
      maximum(result.fields, input.limit, '/result/fields');
      if (Array.isArray(result.fields)) for (const [index, field] of result.fields.entries()) maximum(field.allowed_values, 100, `/result/fields/${index}/allowed_values`);
      break;
    case 'get_join_routes':
      maximum(result.routes, input.limit, '/result/routes');
      if (Array.isArray(result.routes)) for (const [index, route] of result.routes.entries()) {
        if (!Number.isInteger(route.hop_count) || route.hop_count > input.max_hops || (!input.include_indirect && route.hop_count > 1)) issues.push(issue('JOIN_HOP_LIMIT_EXCEEDED', `/result/routes/${index}/hop_count`));
      }
      break;
    case 'compare_assets':
      maximum(result.asset_ids, 5, '/result/asset_ids');
      maximum(result.dimensions, input.dimensions.length, '/result/dimensions');
      maximum(result.pairwise_operations, Math.min(10, (input.asset_ids.length * (input.asset_ids.length - 1)) / 2), '/result/pairwise_operations');
      break;
    case 'get_coverage_status':
      maximum(result.cells, input.limit, '/result/cells');
      break;
    case 'plan_research':
      issues.push(issue('PLANNER_MUST_REMAIN_UNAVAILABLE', '/result'));
      break;
  }
  return issues;
}

function truthIssues(core) {
  const issues = [];
  const truth = core.truth_boundary;
  for (const [key, expected] of Object.entries(FALSE_TRUTH_BOUNDARY)) if (truth?.[key] !== expected) issues.push(issue('TRUTH_BOUNDARY_VIOLATION', `/truth_boundary/${key}`));
  if (!truth || Object.keys(truth).length !== Object.keys(FALSE_TRUTH_BOUNDARY).length) issues.push(issue('TRUTH_BOUNDARY_SHAPE', '/truth_boundary'));
  return issues;
}

function structuralIssues(core, capability) {
  const issues = [];
  for (const key of Object.keys(core)) if (!CORE_ALLOWED.has(key)) issues.push(issue('CORE_FIELD_PROHIBITED', `/${key}`));
  for (const key of ['registry_revision', 'index_generation', 'publication_manifest_id']) if (!STABLE_ID.test(core[key] ?? '')) issues.push(issue('PIN_INVALID', `/${key}`));
  if (!RESULT_STATES.has(core.result_state)) issues.push(issue('RESULT_STATE_INVALID', '/result_state'));
  for (const key of ['canonical_as_of', 'generation_retention_expires_at', 'continuation_expires_at']) if (core[key] !== null && !Number.isFinite(Date.parse(core[key]))) issues.push(issue('TIME_INVALID', `/${key}`));
  if (core.coverage_snapshot_id !== null && !STABLE_ID.test(core.coverage_snapshot_id ?? '')) issues.push(issue('PIN_INVALID', '/coverage_snapshot_id'));
  if (core.next_cursor !== null && !CURSOR.test(core.next_cursor ?? '')) issues.push(issue('CURSOR_INVALID', '/next_cursor'));
  if (core.ok && core.result && typeof core.result === 'object' && !Array.isArray(core.result)) {
    const allowed = RESULT_KEYS[capability];
    for (const key of Object.keys(core.result)) if (!allowed?.has(key)) issues.push(issue('RESULT_FIELD_PROHIBITED', `/result/${key}`));
  }
  if (core.error) {
    const errorKeys = new Set(['code', 'safe_message', 'retryable', 'generation', 'scope', 'corrective_guidance', 'retry_after_seconds']);
    for (const key of Object.keys(core.error)) if (!errorKeys.has(key)) issues.push(issue('ERROR_FIELD_PROHIBITED', `/error/${key}`));
    if (!ERROR_CODES.has(core.error.code)) issues.push(issue('ERROR_CODE_INVALID', '/error/code'));
  }
  const evidenceIds = new Set();
  for (const [index, reference] of (core.evidence_references ?? []).entries()) {
    if (!reference || typeof reference !== 'object' || !STABLE_ID.test(reference.evidence_id ?? '') || evidenceIds.has(reference.evidence_id)) issues.push(issue('EVIDENCE_REFERENCE_INVALID', `/evidence_references/${index}`));
    evidenceIds.add(reference?.evidence_id);
  }
  visit({ result: core.result, warnings: core.warnings }, (entry, path) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Array.isArray(entry.evidence_ids)) return;
    for (const id of entry.evidence_ids) if (!evidenceIds.has(id)) issues.push(issue('EVIDENCE_UNRESOLVED', `${path}/evidence_ids`));
  });
  return issues;
}

function paginationIssues(core, referenceTime) {
  const issues = [];
  const generated = Date.parse(referenceTime ?? core.canonical_as_of);
  const continuation = core.continuation_expires_at === null ? null : Date.parse(core.continuation_expires_at);
  const retention = core.generation_retention_expires_at === null ? null : Date.parse(core.generation_retention_expires_at);
  if (core.truncated) {
    if (!core.next_cursor || !core.continuation_expires_at || !Array.isArray(core.omitted_sections) || core.omitted_sections.length === 0) issues.push(issue('PAGINATION_INCONSISTENT', '/truncated'));
    if (!Number.isFinite(generated) || !Number.isFinite(continuation) || continuation - generated > 1_800_000 || continuation < generated) issues.push(issue('CURSOR_TTL_INVALID', '/continuation_expires_at'));
    if (retention !== null && Number.isFinite(retention) && continuation > retention) issues.push(issue('CONTINUATION_AFTER_RETENTION', '/continuation_expires_at'));
  } else if (core.next_cursor !== null || core.continuation_expires_at !== null || !Array.isArray(core.omitted_sections) || core.omitted_sections.length !== 0) {
    issues.push(issue('PAGINATION_INCONSISTENT', '/next_cursor'));
  }
  if (core.error?.code === 'cursor_expired' && core.restart_required !== true) issues.push(issue('RESTART_REQUIRED', '/restart_required'));
  return issues;
}

function semanticIssues(core, input) {
  const issues = [];
  if (core.ok) {
    if (core.error !== null || core.result === null) issues.push(issue('SUCCESS_SHAPE_INVALID', '/ok'));
  } else if (core.error === null || core.result !== null) issues.push(issue('ERROR_SHAPE_INVALID', '/ok'));
  if (input.expected_generation && core.index_generation !== input.expected_generation) issues.push(issue('GENERATION_PIN_MISMATCH', '/index_generation'));
  if (core.error?.code === 'record_unavailable_in_generation' && core.error.scope?.record_id == null) issues.push(issue('PUBLIC_RECORD_SCOPE_REQUIRED', '/error/scope/record_id'));
  if (core.error && SAFE_ERROR_PRIVACY.test(`${core.error.safe_message} ${core.error.corrective_guidance}`)) issues.push(issue('PUBLIC_ERROR_PRIVACY_LEAK', '/error/safe_message'));
  if (core.error?.code === 'rate_limited' && (core.error.retryable !== true || core.error.retry_after_seconds === null || core.error.retry_after_seconds !== core.rate_limit?.retry_after_seconds)) issues.push(issue('RATE_LIMIT_INCONSISTENT', '/error/retry_after_seconds'));
  if ((core.rate_limit?.remaining ?? 0) > (core.rate_limit?.limit ?? 0)) issues.push(issue('RATE_LIMIT_INCONSISTENT', '/rate_limit/remaining'));
  if (core.capability === 'search_assets' && core.ok) {
    if (core.result.mode !== input.mode) issues.push(issue('SEARCH_MODE_MISMATCH', '/result/mode'));
    if (input.mode === 'browse' && core.result.sort !== input.sort) issues.push(issue('BROWSE_SORT_MISMATCH', '/result/sort'));
    if (input.mode === 'search' && core.result.sort !== 'frozen_rank_tuple') issues.push(issue('SEARCH_RANK_TUPLE_REQUIRED', '/result/sort'));
    for (const [index, summary] of (core.result.summaries ?? []).entries()) {
      const relevance = [summary.role_candidates, summary.why_relevant, summary.confidence, summary.derivation_references, summary.near_miss_reasons];
      if (input.mode === 'browse' && relevance.some((value) => value !== null)) issues.push(issue('BROWSE_RELEVANCE_PROHIBITED', `/result/summaries/${index}`));
      if (input.mode === 'search' && relevance.some((value) => value === null)) issues.push(issue('SEARCH_RELEVANCE_REQUIRED', `/result/summaries/${index}`));
    }
    if (core.result.absence_claim_permitted !== false) issues.push(issue('ABSENCE_CLAIM_UNSUPPORTED', '/result/absence_claim_permitted'));
  }
  if (core.capability === 'get_asset' && core.ok && (!core.result.asset || !core.result.source || typeof core.result.identity_state !== 'string' || typeof core.result.family_state !== 'string')) issues.push(issue('ASSET_VIEW_INCOMPLETE', '/result'));
  if (core.capability === 'get_access_plan' && core.ok && (core.result.requester_eligibility !== 'not_assessed' || core.result.execution_authorized_by_ushso !== false || core.result.access_workflow_submitted !== false)) issues.push(issue('ACCESS_EXECUTION_PROHIBITED', '/result'));
  if (core.capability === 'get_retrieval_recipe' && core.ok && (core.result.retrieval_executed !== false || core.result.payloads_acquired !== false)) issues.push(issue('RETRIEVAL_EXECUTION_PROHIBITED', '/result'));
  if (core.capability === 'get_variables' && core.ok && ![core.result.release_id, core.result.distribution_id, core.result.schema_id].every((value) => typeof value === 'string')) issues.push(issue('SCHEMA_CONTEXT_REQUIRED', '/result'));
  if (core.capability === 'get_join_routes' && core.ok) {
    const executionEvidence = new Set((core.evidence_references ?? []).filter((reference) => ['controlled_test', 'external_execution_record'].includes(reference.evidence_class)).map((reference) => reference.evidence_id));
    for (const [index, route] of (core.result.routes ?? []).entries()) if (['executed', 'proven'].includes(route.evidence_state) && !(route.evidence_ids ?? []).some((id) => executionEvidence.has(id))) issues.push(issue('JOIN_EVIDENCE_UPGRADE', `/result/routes/${index}/evidence_state`));
  }
  if (core.capability === 'compare_assets' && core.ok) {
    if (core.result.ranking_performed !== false || core.result.source_values_compared !== false) issues.push(issue('ANALYSIS_PROHIBITED', '/result'));
    const actualIds = [...(core.result.asset_ids ?? [])].sort();
    const inputIds = [...input.asset_ids].sort();
    if (JSON.stringify(actualIds) !== JSON.stringify(inputIds)) issues.push(issue('COMPARISON_ASSET_MISMATCH', '/result/asset_ids'));
  }
  if (core.capability === 'get_coverage_status' && core.ok) {
    const permitted = [];
    for (const [index, cell] of (core.result.cells ?? []).entries()) {
      if (cell.absence_claim_permitted) permitted.push(cell);
      if (cell.absence_claim_permitted && !(cell.completeness_state === 'complete' && cell.denominator?.status === 'known' && cell.denominator?.bounded_inventory_complete && cell.denominator?.count !== null && cell.denominator?.membership_manifest_digest !== null)) issues.push(issue('ABSENCE_CLAIM_UNSUPPORTED', `/result/cells/${index}/absence_claim_permitted`));
      if (cell.completeness_state === 'complete' && (cell.denominator?.status === 'unknown' || !cell.denominator?.bounded_inventory_complete)) issues.push(issue('UNKNOWN_COLLAPSE', `/result/cells/${index}/completeness_state`));
    }
    if (core.result.absence_claim_permitted && permitted.length !== (core.result.cells ?? []).length) issues.push(issue('ABSENCE_CLAIM_UNSUPPORTED', '/result/absence_claim_permitted'));
  }
  const atomic = ['get_access_plan', 'get_retrieval_recipe', 'compare_assets', 'plan_research'];
  if (atomic.includes(core.capability) && (core.truncated || core.result_state === 'partial')) issues.push(issue('SAFETY_ATOMIC_PARTIAL', '/result_state'));
  return issues;
}

export function validateCanonicalCore(core, capability, input, options = {}) {
  const issues = [];
  if (!core || typeof core !== 'object' || Array.isArray(core)) return [issue('CORE_NOT_OBJECT', '/')];
  for (const field of CORE_REQUIRED) if (!Object.hasOwn(core, field)) issues.push(issue('CORE_FIELD_MISSING', `/${field}`));
  for (const field of TRANSPORT_FIELDS) if (Object.hasOwn(core, field)) issues.push(issue('TRANSPORT_FIELD_IN_CANONICAL_CORE', `/${field}`));
  if (core.tool_contract_version !== 'observatory-machine-toolkit.v1.0.0') issues.push(issue('CONTRACT_VERSION_MISMATCH', '/tool_contract_version'));
  if (core.capability !== capability) issues.push(issue('CAPABILITY_MISMATCH', '/capability'));
  if (!Array.isArray(core.evidence_references) || core.evidence_references.length > (capability === 'plan_research' ? 200 : 100)) issues.push(issue('EVIDENCE_CARDINALITY_EXCEEDED', '/evidence_references'));
  if (!Array.isArray(core.warnings) || core.warnings.length > 50) issues.push(issue('WARNING_CARDINALITY_EXCEEDED', '/warnings'));
  issues.push(...responseSchemaIssues(core, capability), ...structuralIssues(core, capability), ...truthIssues(core), ...paginationIssues(core, options.responseGeneratedAt), ...semanticIssues(core, input), ...countIssues(core, input), ...prohibitedOutputIssues(core));
  return issues;
}

export function assertOutputBound(response, maximumBytes) {
  const bytes = serializedBytes(response);
  return bytes <= maximumBytes ? null : issue('OUTPUT_BYTES_EXCEEDED', '/', `${bytes} > ${maximumBytes}`);
}
