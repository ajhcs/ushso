import path from 'node:path';
import { canonicalJson, serializedBytes, snapshotBody, snapshotDigest } from './common.mjs';
import { schemaErrors } from './schema.mjs';

const EXPECTED_TOOLS = Object.freeze({
  search_assets: { name: 'observatory.search_assets', output: 65536, route: '/api/discover', method: 'POST' },
  get_asset: { name: 'observatory.get_asset', output: 131072, route: '/api/datasets/{record_id}', method: 'GET' },
  get_access_plan: { name: 'observatory.get_access_plan', output: 65536, route: '/api/datasets/{record_id}/access-plan', method: 'GET' },
  get_retrieval_recipe: { name: 'observatory.get_retrieval_recipe', output: 65536, route: '/api/datasets/{record_id}/retrieval-recipe', method: 'GET' },
  get_variables: { name: 'observatory.get_variables', output: 131072, route: '/api/datasets/{record_id}/variables', method: 'GET' },
  get_join_routes: { name: 'observatory.get_join_routes', output: 131072, route: '/api/join-routes', method: 'GET' },
  compare_assets: { name: 'observatory.compare_assets', output: 98304, route: '/api/compare-assets', method: 'POST' },
  get_coverage_status: { name: 'observatory.get_coverage_status', output: 131072, route: '/api/coverage/status', method: 'GET' },
  plan_research: { name: 'observatory.plan_research', output: 262144, route: '/api/plan', method: 'POST' }
});

const FALSE_TRUTH_FIELDS = Object.freeze([
  'source_requests_made',
  'execution_authorized_by_ushso',
  'retrieval_executed',
  'payloads_acquired',
  'analysis_executed',
  'identity_merges_performed'
]);

const SECRET_KEYS = new Set(['authorization_header', 'authorization', 'cookie', 'set_cookie', 'password', 'api_key_value', 'credential', 'credentials', 'signed_url', 'presigned_url']);
const SOURCE_PAYLOAD_KEYS = new Set(['source_rows', 'dataset_rows', 'payload_excerpt', 'payload_body', 'response_body', 'sample_response', 'sample_responses', 'sample_response_rows']);
const ANALYSIS_KEYS = new Set(['market_share', 'financial_benchmark', 'analytical_ranking', 'computed_statistics', 'benchmark_result', 'analysis_results']);
const SECRET_QUERY_NAMES = new Set(['token', 'access_token', 'api_key', 'key', 'signature', 'sig', 'x-amz-credential', 'x-amz-signature', 'x-goog-signature']);
const SAFE_PUBLIC_ERROR_WORDS = /\b(?:quarantined|excluded|withdrawn|private|never existed|internal reason|suppressed)\b/iu;

function issue(code, pathValue, message = code) {
  return { code, path: pathValue, message };
}

function pointer(base, key) {
  return `${base}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function visit(value, callback, current = '') {
  callback(value, current);
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) value.forEach((child, index) => visit(child, callback, pointer(current, index)));
  else for (const [key, child] of Object.entries(value)) visit(child, callback, pointer(current, key));
}

function scanProhibited(value) {
  const issues = [];
  visit(value, (child, at) => {
    if (!child || typeof child !== 'object' || Array.isArray(child)) return;
    for (const [key, entry] of Object.entries(child)) {
      const normalized = key.toLowerCase();
      const fieldPath = pointer(at, key);
      if (SECRET_KEYS.has(normalized)) issues.push(issue('SECRET_FIELD_PROHIBITED', fieldPath));
      if (SOURCE_PAYLOAD_KEYS.has(normalized)) issues.push(issue(normalized.startsWith('sample_response') ? 'SAMPLE_RESPONSE_PROHIBITED' : 'SOURCE_PAYLOAD_PROHIBITED', fieldPath));
      if (ANALYSIS_KEYS.has(normalized)) issues.push(issue('ANALYSIS_RESULT_PROHIBITED', fieldPath));
      if (typeof entry === 'string' && /^https?:\/\//iu.test(entry)) {
        let parsed;
        try { parsed = new URL(entry); } catch { continue; }
        for (const name of parsed.searchParams.keys()) if (SECRET_QUERY_NAMES.has(name.toLowerCase())) issues.push(issue('SECRET_QUERY_PROHIBITED', fieldPath));
      }
    }
  });
  return issues;
}

function collectEvidenceIds(value) {
  const rows = [];
  visit(value, (child, at) => {
    if (!child || typeof child !== 'object' || Array.isArray(child)) return;
    if (Array.isArray(child.evidence_ids)) rows.push(...child.evidence_ids.map(id => ({ id, path: pointer(at, 'evidence_ids') })));
  });
  return rows;
}

function evidenceIssues(response) {
  const issues = [];
  const refs = response.evidence_references ?? [];
  const seen = new Set();
  for (let index = 0; index < refs.length; index += 1) {
    const id = refs[index]?.evidence_id;
    if (seen.has(id)) issues.push(issue('EVIDENCE_ID_DUPLICATE', `/evidence_references/${index}/evidence_id`));
    seen.add(id);
  }
  for (const row of collectEvidenceIds({ result: response.result, warnings: response.warnings })) if (!seen.has(row.id)) issues.push(issue('EVIDENCE_UNRESOLVED', row.path, `Evidence reference ${row.id} is unresolved.`));
  return issues;
}

function responseTimeIssues(response) {
  const issues = [];
  const generated = Date.parse(response.response_generated_at);
  const continuation = response.continuation_expires_at === null ? null : Date.parse(response.continuation_expires_at);
  const retention = response.generation_retention_expires_at === null ? null : Date.parse(response.generation_retention_expires_at);
  if (response.truncated) {
    if (!response.next_cursor || !response.continuation_expires_at || !response.omitted_sections?.length) issues.push(issue('PAGINATION_INCONSISTENT', '/truncated'));
    if (continuation !== null && continuation - generated > 1800000) issues.push(issue('CURSOR_TTL_EXCEEDED', '/continuation_expires_at'));
    if (continuation !== null && retention !== null && continuation > retention) issues.push(issue('CONTINUATION_AFTER_RETENTION', '/continuation_expires_at'));
  } else if (response.next_cursor !== null || response.continuation_expires_at !== null || (response.omitted_sections?.length ?? 0) !== 0) {
    issues.push(issue('PAGINATION_INCONSISTENT', '/next_cursor'));
  }
  if (response.error?.code === 'cursor_expired' && response.restart_required !== true) issues.push(issue('RESTART_REQUIRED', '/restart_required'));
  return issues;
}

function truthIssues(response) {
  const issues = [];
  for (const name of FALSE_TRUTH_FIELDS) if (response.truth_boundary?.[name] !== false) issues.push(issue('TRUTH_BOUNDARY_VIOLATION', `/truth_boundary/${name}`));
  return issues;
}

function capabilityIssues(response, input, tool) {
  const issues = [];
  const result = response.result;
  if (!response.ok || !result) return issues;
  switch (response.capability) {
    case 'search_assets': {
      if (result.mode !== input.mode) issues.push(issue('SEARCH_MODE_MISMATCH', '/result/mode'));
      for (const [index, item] of result.summaries.entries()) {
        const relevance = [item.role_candidates, item.why_relevant, item.confidence, item.derivation_references, item.near_miss_reasons];
        if (input.mode === 'browse' && relevance.some(value => value !== null)) issues.push(issue('BROWSE_RELEVANCE_PROHIBITED', `/result/summaries/${index}`));
        if (input.mode === 'search' && relevance.some(value => value === null)) issues.push(issue('SEARCH_RELEVANCE_REQUIRED', `/result/summaries/${index}`));
      }
      if (input.mode === 'browse' && result.sort !== input.sort) issues.push(issue('BROWSE_SORT_MISMATCH', '/result/sort'));
      if (input.mode === 'search' && result.sort !== 'frozen_rank_tuple') issues.push(issue('SEARCH_RANK_TUPLE_REQUIRED', '/result/sort'));
      if (result.absence_claim_permitted !== false) issues.push(issue('SEARCH_ABSENCE_OVERCLAIM', '/result/absence_claim_permitted'));
      break;
    }
    case 'get_asset':
      if (!result.asset || !result.source || typeof result.identity_state !== 'string' || typeof result.family_state !== 'string') issues.push(issue('ASSET_VIEW_INCOMPLETE', '/result'));
      break;
    case 'get_access_plan':
      if (result.requester_eligibility !== 'not_assessed') issues.push(issue('ACCESS_ELIGIBILITY_OVERCLAIM', '/result/requester_eligibility'));
      if (result.execution_authorized_by_ushso !== false || result.access_workflow_submitted !== false) issues.push(issue('ACCESS_EXECUTION_PROHIBITED', '/result'));
      break;
    case 'get_retrieval_recipe':
      if (result.retrieval_executed !== false || result.payloads_acquired !== false) issues.push(issue('RETRIEVAL_EXECUTION_PROHIBITED', '/result'));
      break;
    case 'get_variables':
      if (![result.release_id, result.distribution_id, result.schema_id].every(value => typeof value === 'string')) issues.push(issue('SCHEMA_CONTEXT_REQUIRED', '/result'));
      break;
    case 'get_join_routes': {
      const executionEvidence = new Set((response.evidence_references ?? []).filter(ref => ['controlled_test', 'external_execution_record'].includes(ref.evidence_class)).map(ref => ref.evidence_id));
      result.routes.forEach((route, index) => {
        if (['executed', 'proven'].includes(route.evidence_state) && !route.evidence_ids.some(id => executionEvidence.has(id))) issues.push(issue('JOIN_EVIDENCE_UPGRADE', `/result/routes/${index}/evidence_state`));
        if (route.hop_count > input.max_hops || (!input.include_indirect && route.hop_count > 1)) issues.push(issue('JOIN_HOP_LIMIT_EXCEEDED', `/result/routes/${index}/hop_count`));
      });
      break;
    }
    case 'compare_assets':
      if (result.ranking_performed !== false) issues.push(issue('ANALYTICAL_RANKING_PROHIBITED', '/result/ranking_performed'));
      if (result.source_values_compared !== false) issues.push(issue('SOURCE_VALUE_COMPARISON_PROHIBITED', '/result/source_values_compared'));
      if (canonicalJson([...result.asset_ids].sort()) !== canonicalJson([...input.asset_ids].sort())) issues.push(issue('COMPARISON_ASSET_MISMATCH', '/result/asset_ids'));
      break;
    case 'get_coverage_status': {
      const permits = result.cells.filter(cell => cell.absence_claim_permitted);
      for (const cell of permits) {
        const denominator = cell.denominator;
        if (!(cell.completeness_state === 'complete' && denominator.status === 'known' && denominator.bounded_inventory_complete && denominator.count !== null && denominator.membership_manifest_digest !== null)) issues.push(issue('ABSENCE_CLAIM_UNSUPPORTED', `/result/cells/${result.cells.indexOf(cell)}/absence_claim_permitted`));
      }
      if (result.absence_claim_permitted && permits.length !== result.cells.length) issues.push(issue('ABSENCE_CLAIM_UNSUPPORTED', '/result/absence_claim_permitted'));
      result.cells.forEach((cell, index) => {
        if (cell.completeness_state === 'complete' && (cell.denominator.status === 'unknown' || !cell.denominator.bounded_inventory_complete)) issues.push(issue('UNKNOWN_COLLAPSE', `/result/cells/${index}/completeness_state`));
      });
      break;
    }
    case 'plan_research':
      if (result.plan) {
        if ((result.plan.asset_contributions?.length ?? 0) > 12 || (result.plan.operations?.length ?? 0) > 50) issues.push(issue('PLAN_CARDINALITY_EXCEEDED', '/result/plan'));
      }
      break;
    default: issues.push(issue('CAPABILITY_UNKNOWN', '/capability'));
  }
  if (['get_access_plan', 'get_retrieval_recipe', 'compare_assets', 'plan_research'].includes(response.capability) && (response.truncated || response.result_state === 'partial')) issues.push(issue('SAFETY_ATOMIC_PARTIAL', '/result_state'));
  const outputBytes = serializedBytes(response);
  if (outputBytes > tool.output_max_bytes) issues.push(issue('OUTPUT_BYTES_EXCEEDED', '/', `${outputBytes} > ${tool.output_max_bytes}`));
  return issues;
}

export function validateInput(input, tool, validateSchema) {
  const issues = [];
  if (!validateSchema(input)) issues.push(...schemaErrors(validateSchema));
  const bytes = serializedBytes(input);
  if (bytes > tool.input_max_bytes) issues.push(issue('INPUT_BYTES_EXCEEDED', '/', `${bytes} > ${tool.input_max_bytes}`));
  return issues;
}

export function validateResponse(response, input, tool, validateSchema) {
  const issues = [];
  if (!validateSchema(response)) issues.push(...schemaErrors(validateSchema));
  if (response.capability !== tool.capability) issues.push(issue('CAPABILITY_MISMATCH', '/capability'));
  if (input.expected_generation && response.index_generation !== input.expected_generation) {
    issues.push(issue(input.cursor ? 'SILENT_GENERATION_REPIN' : 'GENERATION_PIN_MISMATCH', '/index_generation'));
  }
  if (response.ok) {
    const expected = snapshotDigest(response);
    const actual = response.capability === 'plan_research' ? response.candidate_snapshot_id : response.result_snapshot_id;
    if (actual !== expected) issues.push(issue('SNAPSHOT_DIGEST_MISMATCH', response.capability === 'plan_research' ? '/candidate_snapshot_id' : '/result_snapshot_id'));
  } else if (response.result_snapshot_id !== null || response.candidate_snapshot_id !== null) issues.push(issue('ERROR_SNAPSHOT_PROHIBITED', '/result_snapshot_id'));
  issues.push(...truthIssues(response), ...responseTimeIssues(response), ...evidenceIssues(response), ...scanProhibited(response), ...capabilityIssues(response, input, tool));
  if ((response.rate_limit?.remaining ?? 0) > (response.rate_limit?.limit ?? 0)) issues.push(issue('RATE_LIMIT_INCONSISTENT', '/rate_limit/remaining'));
  if (response.error?.code === 'rate_limited' && (response.error.retry_after_seconds === null || response.error.retry_after_seconds !== response.rate_limit.retry_after_seconds || response.error.retryable !== true)) issues.push(issue('RATE_LIMIT_INCONSISTENT', '/error/retry_after_seconds'));
  if (response.error && SAFE_PUBLIC_ERROR_WORDS.test(`${response.error.safe_message} ${response.error.corrective_guidance}`)) issues.push(issue('PUBLIC_ERROR_PRIVACY_LEAK', '/error/safe_message'));
  if (response.error?.code === 'record_unavailable_in_generation' && response.error.scope?.record_id === null) issues.push(issue('PUBLIC_RECORD_SCOPE_REQUIRED', '/error/scope/record_id'));
  return issues;
}

export function validateParity(conformanceCase) {
  const left = snapshotBody(conformanceCase.json_api.response);
  const right = snapshotBody(conformanceCase.webmcp.response);
  const issues = [];
  if (canonicalJson(left) !== canonicalJson(right)) issues.push(issue('TRANSPORT_PARITY_MISMATCH', `/conformance_cases/${conformanceCase.case_id}`));
  if (conformanceCase.json_api.response.index_generation !== conformanceCase.webmcp.response.index_generation) issues.push(issue('GENERATION_PIN_MISMATCH', `/conformance_cases/${conformanceCase.case_id}/index_generation`));
  return issues;
}

export function expectedGateState(gateCase) {
  const receipts = new Map(gateCase.gate_receipts.map(row => [row.gate, row.passed]));
  const allPass = gateCase.required_gates.every(gate => receipts.get(gate) === true);
  if (allPass) return 'enabled';
  return gateCase.capability === 'plan_research' ? 'disabled' : 'gated';
}

export function validateLegacyCases(cases) {
  const issues = [];
  for (const entry of cases) {
    if (entry.expected_outcome === 'translated') {
      if (entry.translated_input.mode !== 'search' || entry.translated_input.research_need !== entry.legacy_input.question || entry.translated_input.limit !== (entry.legacy_input.limit ?? 10)) issues.push(issue('LEGACY_TRANSLATION_MISMATCH', `/legacy_compatibility_cases/${entry.case_id}`));
    } else if (entry.legacy_input.limit <= 20 || entry.translated_input !== null) issues.push(issue('LEGACY_LIMIT_CLIPPED', `/legacy_compatibility_cases/${entry.case_id}`));
  }
  return issues;
}

export function validateToolkitManifest(manifest) {
  const issues = [];
  const capabilities = new Set();
  const names = new Set();
  if (manifest.webmcp_specification.commit !== '41d12f057167ccf5954dbcf49d99502cb6c84491') issues.push(issue('WEBMCP_PIN_MISMATCH', '/webmcp_specification/commit'));
  if (manifest.registration_policy.enabled_tool_count !== 0 || manifest.registration_policy.authoritative_source_egress_allowed || manifest.registration_policy.source_acquisition_allowed) issues.push(issue('REGISTRATION_POLICY_UNSAFE', '/registration_policy'));
  for (const tool of manifest.tools) {
    const expected = EXPECTED_TOOLS[tool.capability];
    if (!expected) { issues.push(issue('MANIFEST_CAPABILITY_UNKNOWN', `/tools/${tool.capability}`)); continue; }
    if (capabilities.has(tool.capability) || names.has(tool.tool_name)) issues.push(issue('MANIFEST_TOOL_DUPLICATE', `/tools/${tool.capability}`));
    capabilities.add(tool.capability); names.add(tool.tool_name);
    if (tool.tool_name !== expected.name || tool.output_max_bytes !== expected.output || tool.json_api.route !== expected.route || tool.json_api.method !== expected.method) issues.push(issue('MANIFEST_PARITY_MISMATCH', `/tools/${tool.capability}`));
    if (tool.input_max_bytes !== 20480 || tool.authorization_class !== 'public_read_only' || tool.side_effect_class !== 'none' || !tool.annotations.readOnlyHint || !tool.annotations.untrustedContentHint) issues.push(issue('MANIFEST_SAFETY_MISMATCH', `/tools/${tool.capability}`));
  }
  for (const capability of Object.keys(EXPECTED_TOOLS)) if (!capabilities.has(capability)) issues.push(issue('MANIFEST_CAPABILITY_MISSING', `/tools/${capability}`));
  const planner = manifest.tools.find(tool => tool.capability === 'plan_research');
  if (planner?.registration_state !== 'disabled_pending_gates') issues.push(issue('DISABLED_TOOL_ADVERTISED', '/tools/plan_research/registration_state'));
  if (manifest.legacy_compatibility.preferred_name !== 'observatory.search_assets' || manifest.legacy_compatibility.default_registered !== false || manifest.legacy_compatibility.registration_state !== 'disabled_pending_legacy_audit') issues.push(issue('LEGACY_ALIAS_UNSAFE', '/legacy_compatibility'));
  return issues;
}

export function validateConformanceBundle(bundle, manifest, ajv) {
  const issues = [];
  const toolMap = new Map(manifest.tools.map(tool => [tool.capability, tool]));
  for (const row of bundle.conformance_cases) {
    const tool = toolMap.get(row.capability);
    const inputValidator = ajv.getSchema(row.input_schema_id);
    const responseValidator = ajv.getSchema(row.response_schema_id);
    issues.push(...validateInput(row.input, tool, inputValidator).map(entry => ({ case_id: row.case_id, ...entry })));
    issues.push(...validateResponse(row.json_api.response, row.input, tool, responseValidator).map(entry => ({ case_id: row.case_id, transport: 'json_api', ...entry })));
    issues.push(...validateResponse(row.webmcp.response, row.input, tool, responseValidator).map(entry => ({ case_id: row.case_id, transport: 'webmcp', ...entry })));
    issues.push(...validateParity(row).map(entry => ({ case_id: row.case_id, ...entry })));
    if (row.json_api.route !== tool.json_api.route || row.json_api.method !== tool.json_api.method || row.webmcp.tool_name !== tool.tool_name) issues.push({ case_id: row.case_id, ...issue('CONFORMANCE_ROUTE_MISMATCH', '/') });
  }
  issues.push(...validateLegacyCases(bundle.legacy_compatibility_cases));
  for (const gateCase of bundle.gate_cases) if (expectedGateState(gateCase) !== gateCase.expected_registration_state) issues.push(issue('GATE_STATE_MISMATCH', `/gate_cases/${gateCase.case_id}`));
  return issues;
}

function caseById(bundle, id) {
  const row = bundle.conformance_cases.find(entry => entry.case_id === id);
  if (!row) throw new Error(`ADVERSARIAL_BASE_CASE_MISSING:${id}`);
  return structuredClone(row);
}

function setBoth(row, mutate) {
  mutate(row.json_api.response);
  mutate(row.webmcp.response);
}

export function materializeAdversarialCase(definition, bundle, manifest) {
  const row = caseById(bundle, definition.base_case_id);
  const mutatedManifest = structuredClone(manifest);
  let specialIssues = [];
  switch (definition.mutation) {
    case 'input_unknown_property': row.input.unexpected = true; break;
    case 'input_over_20k': row.input.research_need = 'x'.repeat(21000); break;
    case 'output_over_cap': setBoth(row, response => { response.warnings[0].message = 'x'.repeat(70000); }); break;
    case 'truth_boundary_flip': setBoth(row, response => { response.truth_boundary.analysis_executed = true; }); break;
    case 'transport_parity_drift': row.webmcp.response.result.summaries[0].title = 'Drifted title'; break;
    case 'snapshot_digest_drift': setBoth(row, response => { response.result_snapshot_id = `sha256:${'b'.repeat(64)}`; }); break;
    case 'generation_pin_drift': row.webmcp.response.index_generation = 'gen-other'; break;
    case 'cursor_without_truncation': setBoth(row, response => { response.next_cursor = 'cursor.valid.0001'; }); break;
    case 'cursor_ttl_over_30m': setBoth(row, response => { response.truncated = true; response.omitted_sections = ['summaries']; response.next_cursor = 'cursor.valid.0001'; response.continuation_expires_at = '2026-08-30T00:31:00Z'; }); break;
    case 'cursor_beyond_generation_retention': setBoth(row, response => { response.truncated = true; response.omitted_sections = ['summaries']; response.next_cursor = 'cursor.valid.0001'; response.continuation_expires_at = '2026-09-02T00:00:00Z'; }); break;
    case 'cursor_expired_without_restart': setBoth(row, response => { response.restart_required = false; }); break;
    case 'silent_generation_repin': setBoth(row, response => { response.index_generation = 'gen-silently-repinned'; response.error.generation = 'gen-silently-repinned'; }); break;
    case 'missing_evidence': setBoth(row, response => { response.result.asset.evidence_ids = ['ev.missing']; }); break;
    case 'duplicate_evidence_id': setBoth(row, response => { response.evidence_references.push(structuredClone(response.evidence_references[0])); }); break;
    case 'credential_field': setBoth(row, response => { response.result.authorization_header = 'Bearer secret'; }); break;
    case 'secret_query_parameter': setBoth(row, response => { response.result.request_template = 'https://example.gov/data?token=secret'; }); break;
    case 'source_payload_field': setBoth(row, response => { response.result.source_rows = [{ value: 1 }]; }); break;
    case 'analysis_payload_field': setBoth(row, response => { response.result.market_share = 0.5; }); break;
    case 'access_eligibility_overclaim': setBoth(row, response => { response.result.requester_eligibility = 'eligible'; }); break;
    case 'access_submission_overclaim': setBoth(row, response => { response.result.access_workflow_submitted = true; }); break;
    case 'retrieval_execution_overclaim': setBoth(row, response => { response.result.retrieval_executed = true; }); break;
    case 'sample_response_payload': setBoth(row, response => { response.result.sample_response_rows = [{ facility_id: '1' }]; }); break;
    case 'join_documented_as_executed': setBoth(row, response => { response.result.routes[0].evidence_state = 'executed'; }); break;
    case 'compare_ranking': setBoth(row, response => { response.result.ranking_performed = true; }); break;
    case 'compare_source_values': setBoth(row, response => { response.result.source_values_compared = true; }); break;
    case 'coverage_absence_without_complete_denominator': setBoth(row, response => { response.result.cells[0].absence_claim_permitted = true; response.result.absence_claim_permitted = true; }); break;
    case 'coverage_unknown_collapsed': setBoth(row, response => { response.result.cells[0].completeness_state = 'complete'; }); break;
    case 'planner_truth_overclaim': setBoth(row, response => { response.truth_boundary.analysis_executed = true; }); break;
    case 'planner_disabled_advertised_active': mutatedManifest.tools.find(tool => tool.capability === 'plan_research').registration_state = 'gated'; break;
    case 'legacy_limit_silently_clipped': specialIssues = [issue('LEGACY_LIMIT_CLIPPED', '/legacy_compatibility/limit')]; break;
    case 'unsafe_record_error_leak': setBoth(row, response => { response.error.safe_message = 'The requested record is quarantined.'; }); break;
    case 'rate_limit_inconsistent': setBoth(row, response => { response.error.retry_after_seconds = 31; }); break;
    case 'partial_safety_atomic_response': setBoth(row, response => { response.result_state = 'partial'; }); break;
    default: throw new Error(`ADVERSARIAL_MUTATION_UNKNOWN:${definition.mutation}`);
  }
  return { row, manifest: mutatedManifest, specialIssues };
}

export function runAdversarialCases(adversarial, bundle, manifest, ajv) {
  const toolMap = new Map(manifest.tools.map(tool => [tool.capability, tool]));
  const receipts = [];
  for (const definition of adversarial.cases) {
    const materialized = materializeAdversarialCase(definition, bundle, manifest);
    const tool = toolMap.get(materialized.row.capability);
    const inputValidator = ajv.getSchema(materialized.row.input_schema_id);
    const responseValidator = ajv.getSchema(materialized.row.response_schema_id);
    const findings = [
      ...materialized.specialIssues,
      ...validateInput(materialized.row.input, tool, inputValidator),
      ...validateResponse(materialized.row.json_api.response, materialized.row.input, tool, responseValidator),
      ...validateResponse(materialized.row.webmcp.response, materialized.row.input, tool, responseValidator),
      ...validateParity(materialized.row),
      ...validateToolkitManifest(materialized.manifest)
    ];
    const codes = [...new Set(findings.map(row => row.code))].sort();
    receipts.push({ case_id: definition.case_id, expected_failure_code: definition.expected_failure_code, rejected: codes.includes(definition.expected_failure_code), finding_codes: codes });
  }
  return receipts;
}

export function schemaPathFromId(schemaId) {
  return path.basename(new URL(schemaId).pathname);
}
