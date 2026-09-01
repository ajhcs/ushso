import { snapshotDigest } from './common.mjs';

export const GENERATION = 'gen-2026-08-30';
const CONTRACT = 'observatory-machine-toolkit.v1.0.0';
const GENERATED_AT = '2026-08-30T00:00:00Z';
const RETENTION_EXPIRES_AT = '2026-09-01T00:00:00Z';

const FALSE_TRUTH = Object.freeze({
  source_requests_made: false,
  execution_authorized_by_ushso: false,
  retrieval_executed: false,
  payloads_acquired: false,
  analysis_executed: false,
  identity_merges_performed: false
});

const EVIDENCE = Object.freeze([
  {
    evidence_id: 'ev.catalog',
    evidence_class: 'catalog_record',
    public_locator: 'https://example.gov/catalog/asset-a',
    observed_at: '2026-08-29T12:00:00Z',
    evidence_state: 'observed',
    staleness_state: 'current',
    derivation_reference: 'source.direct',
    policy_reference: null
  },
  {
    evidence_id: 'ev.policy',
    evidence_class: 'maintained_policy',
    public_locator: 'https://ushso.org/policies/research-navigator-boundary',
    observed_at: '2026-08-29T12:00:00Z',
    evidence_state: 'documented',
    staleness_state: 'current',
    derivation_reference: 'policy.direct',
    policy_reference: 'research-navigator-boundary.v1'
  }
]);

export const EMPTY_FILTERS = Object.freeze({
  geography_ids: [],
  subject_ids: [],
  grain: [],
  access_classes: [],
  authority_levels: [],
  machine_readiness: [],
  time_period: null,
  negative_constraints: [],
  dimensions: []
});

function rateLimit(overrides = {}) {
  return {
    policy_id: 'public-machine-read.v1',
    limit: 60,
    remaining: 59,
    reset_at: '2026-08-30T00:01:00Z',
    retry_after_seconds: null,
    ...overrides
  };
}

function baseEnvelope(capability) {
  return {
    tool_contract_version: CONTRACT,
    capability,
    transport_adapter: 'json_api',
    request_id: `req.${capability}.json`,
    response_generated_at: GENERATED_AT,
    ok: true,
    result_snapshot_id: null,
    candidate_snapshot_id: null,
    registry_revision: 'registry.rev.42',
    index_generation: GENERATION,
    publication_manifest_id: 'publication.manifest.42',
    canonical_as_of: '2026-08-29T23:59:59Z',
    coverage_snapshot_id: 'coverage.snapshot.42',
    result_state: 'complete',
    result: null,
    error: null,
    evidence_references: structuredClone(EVIDENCE),
    warnings: [
      {
        code: 'public_metadata_only',
        message: 'This response describes indexed public-source metadata and does not contain source-data payloads or analytical results.',
        evidence_ids: ['ev.policy'],
        copy_policy_version: 'research-navigator-boundary.v1'
      }
    ],
    truncated: false,
    omitted_sections: [],
    next_cursor: null,
    continuation_expires_at: null,
    generation_retention_expires_at: RETENTION_EXPIRES_AT,
    restart_required: false,
    rate_limit: rateLimit(),
    truth_boundary: structuredClone(FALSE_TRUTH)
  };
}

function success(capability, result, overrides = {}) {
  const response = { ...baseEnvelope(capability), result, ...overrides };
  const digest = snapshotDigest(response);
  if (capability === 'plan_research') response.candidate_snapshot_id = digest;
  else response.result_snapshot_id = digest;
  return response;
}

function failure(capability, code, overrides = {}) {
  const response = {
    ...baseEnvelope(capability),
    ok: false,
    result_state: 'unavailable',
    result: null,
    error: {
      code,
      safe_message: 'The requested public metadata result is unavailable in the selected scope.',
      retryable: false,
      generation: GENERATION,
      scope: { capability, record_id: null, query_scope_id: null },
      corrective_guidance: 'Check the public input and generation pin, then retry only when the error is retryable.',
      retry_after_seconds: null
    },
    evidence_references: [structuredClone(EVIDENCE[1])],
    warnings: [],
    ...overrides
  };
  response.result_snapshot_id = null;
  response.candidate_snapshot_id = null;
  return response;
}

function pair(response, tool, input, caseId, caseKind = 'success') {
  const jsonResponse = structuredClone(response);
  jsonResponse.transport_adapter = 'json_api';
  jsonResponse.request_id = `${caseId}.json`;
  const webResponse = structuredClone(response);
  webResponse.transport_adapter = 'webmcp';
  webResponse.request_id = `${caseId}.web`;
  return {
    case_id: caseId,
    case_kind: caseKind,
    capability: tool.capability,
    input_schema_id: tool.input_schema_id,
    response_schema_id: tool.response_schema_id,
    input,
    json_api: { method: tool.json_api.method, route: tool.json_api.route, response: jsonResponse },
    webmcp: { tool_name: tool.tool_name, response: webResponse }
  };
}

function searchInput(mode = 'search') {
  if (mode === 'browse') {
    return {
      contract_version: 'observatory.machine.search-assets.input.v1.0.0',
      mode: 'browse',
      filters: structuredClone(EMPTY_FILTERS),
      sort: 'title_asc',
      grouping: 'none',
      limit: 5,
      cursor: null,
      expected_generation: GENERATION
    };
  }
  return {
    contract_version: 'observatory.machine.search-assets.input.v1.0.0',
    mode: 'search',
    research_need: 'Identify public hospital facility metadata suitable for a documented linkage design.',
    filters: structuredClone(EMPTY_FILTERS),
    grouping: 'none',
    limit: 5,
    cursor: null,
    expected_generation: GENERATION
  };
}

function summary(mode) {
  const relevance = mode === 'search';
  return {
    asset_id: 'asset.a',
    title: 'Example Hospital Facility Directory',
    geography_ids: ['geo.us'],
    grain: 'facility',
    time_intervals: [{ start: '2025-01-01', end: '2025-12-31', period_kind: 'calendar', precision: 'year' }],
    access_class: 'public',
    machine_readiness: 'schema_indexed',
    evidence_state: 'observed',
    observed_at: '2026-08-29T12:00:00Z',
    staleness_state: 'current',
    evidence_ids: ['ev.catalog'],
    role_candidates: relevance ? ['role.facility_frame'] : null,
    why_relevant: relevance ? ['Facility grain and a documented public distribution match the stated metadata need.'] : null,
    confidence: relevance ? 'moderate' : null,
    derivation_references: relevance ? ['ranker.frozen.v1'] : null,
    near_miss_reasons: relevance ? [] : null
  };
}

function searchResult(mode) {
  return {
    mode,
    sort: mode === 'search' ? 'frozen_rank_tuple' : 'title_asc',
    ranker_version: mode === 'search' ? 'ranker.frozen.v1' : 'sort.total-order.v1',
    grouping: 'none',
    cursor_binding_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    summaries: [summary(mode)],
    facet_counts: [{ dimension: 'grain', value: 'facility', count: 1, count_state: 'exact', denominator_scope: 'Selected immutable generation and normalized filters.', evidence_ids: ['ev.catalog'] }],
    aggregates: [{ dimension: 'source', value: 'source.example', count: 1, count_state: 'exact', denominator_scope: 'Selected immutable generation and normalized filters.', evidence_ids: ['ev.catalog'] }],
    scoped_zero_statement: 'No corpus-wide absence claim is made; zero items would mean only that this bounded generation and filter scope returned none.',
    absence_claim_permitted: false
  };
}

const assetResult = {
  asset: { asset_id: 'asset.a', title: 'Example Hospital Facility Directory', asset_kind: 'dataset', evidence_ids: ['ev.catalog'] },
  source: { source_id: 'source.example', name: 'Example Department of Health', authority_level: 'authoritative', evidence_ids: ['ev.catalog'] },
  identity_state: 'source_scoped',
  family_state: 'candidate',
  releases: [{ record_id: 'release.a.2025', record_type: 'release', label: '2025 release', lifecycle_state: 'active', evidence_ids: ['ev.catalog'] }],
  distributions: [{ record_id: 'distribution.a.csv', record_type: 'distribution', label: 'CSV distribution', lifecycle_state: 'active', evidence_ids: ['ev.catalog'] }],
  documentation: [{ record_id: 'documentation.a.dictionary', record_type: 'documentation', label: 'Public data dictionary', lifecycle_state: 'active', evidence_ids: ['ev.catalog'] }],
  schemas: [{ record_id: 'schema.a.2025', record_type: 'schema', label: '2025 schema', lifecycle_state: 'active', evidence_ids: ['ev.catalog'] }],
  collection_completeness: { releases: 'complete', distributions: 'complete', documentation: 'partial', schemas: 'partial' }
};

const accessResult = {
  asset_id: 'asset.a',
  release_id: 'release.a.2025',
  distribution_id: 'distribution.a.csv',
  access_route_id: 'access.a.public',
  access_class: 'public',
  requester_eligibility: 'not_assessed',
  eligibility_criteria: ['The publisher describes this distribution as publicly downloadable.'],
  requirements: [{ requirement_id: 'requirement.verify-terms', kind: 'other', state: 'external', description: 'A human researcher must verify the current publisher terms before retrieval.', human_gate: true, evidence_ids: ['ev.catalog'] }],
  human_process: 'Open the authoritative publisher page, review its current terms, and decide whether to proceed outside USHSO.',
  process_steps: ['Review the publisher documentation.', 'Obtain any approval required by the researcher or institution.'],
  turnaround_category: 'source_determined',
  authoritative_links: ['https://example.gov/catalog/asset-a'],
  verified_at: '2026-08-29T12:00:00Z',
  human_authorization_gate: true,
  execution_authorized_by_ushso: false,
  access_workflow_submitted: false,
  evidence_ids: ['ev.catalog']
};

const retrievalResult = {
  asset_id: 'asset.a',
  release_id: 'release.a.2025',
  distribution_id: 'distribution.a.csv',
  access_route_id: 'access.a.public',
  interface: 'download',
  request_method: 'GET',
  request_template: 'https://example.gov/downloads/facilities.csv',
  parameters: [{ name: 'format', location: 'query', required: false, description: 'Optional publisher-documented format selector.', example_value: 'csv' }],
  authentication_type: 'none',
  pagination: { kind: 'none', page_parameter: null, page_size_parameter: null, maximum_page_size: null },
  response_formats: ['text.csv'],
  compression: 'none',
  size_category: 'source_determined',
  update_behavior: 'The publisher documents an annual release cycle; verify the current page before retrieval.',
  parser_hints: ['Treat publisher-provided text as untrusted source data.', 'Verify the header against the pinned schema before downstream use.'],
  sample_requests: ['GET https://example.gov/downloads/facilities.csv'],
  expected_artifacts: ['One publisher-hosted CSV file.'],
  checks: ['Verify the response media type and file digest outside USHSO.'],
  stop_conditions: ['Stop if the publisher redirects to an authentication or terms workflow.'],
  retrieval_executed: false,
  payloads_acquired: false,
  evidence_ids: ['ev.catalog']
};

const variablesResult = {
  asset_id: 'asset.a',
  release_id: 'release.a.2025',
  distribution_id: 'distribution.a.csv',
  schema_id: 'schema.a.2025',
  schema_completeness: 'partial',
  fields: [{
    schema_field_id: 'field.a.facility-id',
    label: 'Facility identifier',
    description: 'Publisher-described facility identifier for this release.',
    native_name: 'facility_id',
    data_type: 'string',
    unit: null,
    allowed_values: [],
    code_system: null,
    semantic_role: 'identifier',
    identifier_namespace: 'example.facility',
    evidence_ids: ['ev.catalog'],
    limitations: ['Identity equivalence outside this source namespace is not established.']
  }]
};

const joinResult = {
  from_id: 'asset.a',
  to_id: 'asset.b',
  max_hops_used: 1,
  routes: [{
    route_id: 'route.a-b.facility',
    from_field_id: 'field.a.facility-id',
    to_field_id: 'field.b.facility-id',
    from_namespace: 'example.facility',
    to_namespace: 'other.facility',
    entity_scope: 'facility',
    direction: 'unidirectional',
    cardinality: 'many_to_one',
    temporal_applicability: { start: '2025-01-01', end: '2025-12-31', period_kind: 'calendar', precision: 'year' },
    normalization: 'Normalize documented padding before applying the publisher-maintained crosswalk.',
    operation_kind: 'crosswalk',
    evidence_state: 'documented',
    compatibility: 'conditional',
    requirements: [{ requirement_id: 'requirement.crosswalk', kind: 'crosswalk', state: 'external', description: 'Acquire and validate the publisher-maintained crosswalk for the same period.', human_gate: true, evidence_ids: ['ev.catalog'] }],
    blockers: [{ blocker_id: 'blocker.not-executed', kind: 'evidence_missing', state: 'open', description: 'USHSO has not executed or proven this route over source data.', evidence_ids: ['ev.policy'] }],
    caveats: ['Documentation evidence does not establish executed or proven compatibility.'],
    evidence_ids: ['ev.catalog'],
    hop_count: 1
  }]
};

const compareResult = {
  asset_ids: ['asset.a', 'asset.b'],
  dimensions: [{
    dimension: 'access',
    state: 'comparable',
    values: [
      { asset_id: 'asset.a', metadata_value: 'public', state: 'known' },
      { asset_id: 'asset.b', metadata_value: null, state: 'unknown' }
    ],
    explanation: 'The comparison preserves unknown metadata and does not infer a value for asset.b.',
    evidence_ids: ['ev.catalog']
  }],
  pairwise_operations: [{
    left_asset_id: 'asset.a',
    right_asset_id: 'asset.b',
    operation_kind: 'crosswalk',
    evidence_state: 'documented',
    compatibility: 'conditional',
    requirements: [{ requirement_id: 'requirement.crosswalk', kind: 'crosswalk', state: 'external', description: 'Validate the documented crosswalk outside USHSO.', human_gate: true, evidence_ids: ['ev.catalog'] }],
    blockers: [{ blocker_id: 'blocker.not-executed', kind: 'evidence_missing', state: 'open', description: 'No executed join evidence is present.', evidence_ids: ['ev.policy'] }],
    evidence_ids: ['ev.catalog']
  }],
  ranking_performed: false,
  source_values_compared: false
};

const coverageResult = {
  federal_baseline: { state: 'partial', source_scope_count: 1, description: 'The federal baseline reflects only explicitly tracked connector scopes in this snapshot.', evidence_ids: ['ev.catalog'] },
  cells: [{
    cell_id: 'coverage.us.example',
    geography_id: 'geo.us',
    source_class: 'facility_directory',
    coverage_cell_state: 'unknown',
    processing_status: 'pending',
    completeness_state: 'unknown',
    denominator: { definition_id: 'denominator.connector-scope.v1', unit: 'connector_scope', count: null, status: 'unknown', bounded_inventory_complete: false, membership_manifest_digest: null },
    interpretation: 'The current bounded inventory is incomplete, so nonappearance must not be interpreted as source absence.',
    absence_claim_permitted: false,
    evidence_ids: ['ev.catalog']
  }],
  scope_interpretation: 'Coverage describes indexed public metadata for named connector scopes and is not a census of all possible sources.',
  absence_claim_permitted: false
};

function inputFor(capability) {
  switch (capability) {
    case 'get_asset': return { contract_version: 'observatory.machine.get-asset.input.v1.0.0', record_id: 'asset.a', expected_generation: GENERATION, collection_limits: { releases: 20, distributions: 20, documentation: 20, schemas: 20 }, collection_cursors: { releases: null, distributions: null, documentation: null, schemas: null } };
    case 'get_access_plan': return { contract_version: 'observatory.machine.get-access-plan.input.v1.0.0', record_id: 'asset.a', release_id: 'release.a.2025', distribution_id: 'distribution.a.csv', access_route_id: 'access.a.public', expected_generation: GENERATION };
    case 'get_retrieval_recipe': return { contract_version: 'observatory.machine.get-retrieval-recipe.input.v1.0.0', record_id: 'asset.a', release_id: 'release.a.2025', distribution_id: 'distribution.a.csv', access_route_id: 'access.a.public', expected_generation: GENERATION };
    case 'get_variables': return { contract_version: 'observatory.machine.get-variables.input.v1.0.0', record_id: 'asset.a', release_id: 'release.a.2025', distribution_id: 'distribution.a.csv', schema_id: 'schema.a.2025', semantic_query: 'facility identifier', filters: [], limit: 25, cursor: null, expected_generation: GENERATION };
    case 'get_join_routes': return { contract_version: 'observatory.machine.get-join-routes.input.v1.0.0', from_id: 'asset.a', to_id: 'asset.b', from_release_id: 'release.a.2025', to_release_id: 'release.b.2025', research_purpose: 'Document a possible facility-level linkage.', include_indirect: false, max_hops: 1, limit: 50, expected_generation: GENERATION };
    case 'compare_assets': return { contract_version: 'observatory.machine.compare-assets.input.v1.0.0', asset_ids: ['asset.a', 'asset.b'], dimensions: ['access'], expected_generation: GENERATION };
    case 'get_coverage_status': return { contract_version: 'observatory.machine.get-coverage-status.input.v1.0.0', geography_ids: ['geo.us'], subject_ids: [], source_classes: ['facility_directory'], time_period: null, authority_levels: ['authoritative'], limit: 100, cursor: null, expected_generation: GENERATION };
    case 'plan_research': return { contract_version: 'observatory.machine.plan-research.input.v1.0.0', mode: 'initial', research_need: 'Design an evidence-bound facility metadata study.', constraints: { geography_ids: ['geo.us'], time_period: null, grain: 'facility', access_classes: ['public'], machine_access_required: false, intended_analyses: ['external_descriptive_analysis'] }, expected_generation: GENERATION };
    default: throw new Error(`UNSUPPORTED_CAPABILITY:${capability}`);
  }
}

export function buildFixtureBundle(manifest) {
  const byCapability = new Map(manifest.tools.map(tool => [tool.capability, tool]));
  const cases = [];
  cases.push(pair(success('search_assets', searchResult('search')), byCapability.get('search_assets'), searchInput('search'), 'search.search.success'));
  cases.push(pair(success('search_assets', searchResult('browse')), byCapability.get('search_assets'), searchInput('browse'), 'search.browse.success'));
  cases.push(pair(success('get_asset', assetResult, { result_state: 'partial' }), byCapability.get('get_asset'), inputFor('get_asset'), 'asset.partial.success'));
  cases.push(pair(success('get_access_plan', accessResult), byCapability.get('get_access_plan'), inputFor('get_access_plan'), 'access.success'));
  cases.push(pair(success('get_retrieval_recipe', retrievalResult), byCapability.get('get_retrieval_recipe'), inputFor('get_retrieval_recipe'), 'retrieval.success'));
  cases.push(pair(success('get_variables', variablesResult, { result_state: 'partial' }), byCapability.get('get_variables'), inputFor('get_variables'), 'variables.partial.success'));
  cases.push(pair(success('get_join_routes', joinResult), byCapability.get('get_join_routes'), inputFor('get_join_routes'), 'joins.success'));
  cases.push(pair(success('compare_assets', compareResult), byCapability.get('compare_assets'), inputFor('compare_assets'), 'compare.success'));
  cases.push(pair(success('get_coverage_status', coverageResult, { result_state: 'partial' }), byCapability.get('get_coverage_status'), inputFor('get_coverage_status'), 'coverage.unknown.success'));

  const gated = failure('plan_research', 'planner_unavailable', { result_state: 'gated' });
  gated.error.safe_message = 'The research-plan compiler is gated until every required safety and usefulness receipt passes.';
  gated.error.corrective_guidance = 'Use the inspection tools while the plan_research capability remains gated.';
  cases.push(pair(gated, byCapability.get('plan_research'), inputFor('plan_research'), 'planner.gated', 'planner_gated'));
  const disabled = failure('plan_research', 'planner_unavailable', { result_state: 'disabled' });
  disabled.error.safe_message = 'The research-plan compiler is not enabled in the public capability manifest.';
  disabled.error.corrective_guidance = 'Do not advertise or invoke plan_research until the manifest is promoted with passing receipts.';
  cases.push(pair(disabled, byCapability.get('plan_research'), inputFor('plan_research'), 'planner.disabled', 'planner_disabled'));

  const unavailable = failure('get_asset', 'record_unavailable_in_generation');
  unavailable.error.scope.record_id = 'asset.unresolved';
  cases.push(pair(unavailable, byCapability.get('get_asset'), { ...inputFor('get_asset'), record_id: 'asset.unresolved' }, 'asset.unavailable', 'domain_error'));

  const expiredInput = { ...searchInput('browse'), cursor: 'cursor.expired.0001' };
  const expired = failure('search_assets', 'cursor_expired', { restart_required: true });
  expired.error.safe_message = 'The opaque cursor can no longer continue in its pinned generation.';
  expired.error.corrective_guidance = 'Restart the request without a cursor and retain the newly returned generation.';
  cases.push(pair(expired, byCapability.get('search_assets'), expiredInput, 'search.cursor-expired', 'domain_error'));

  const limited = failure('search_assets', 'rate_limited', {
    rate_limit: rateLimit({ remaining: 0, retry_after_seconds: 30 })
  });
  limited.error.safe_message = 'The public machine-read rate limit was reached.';
  limited.error.retryable = true;
  limited.error.corrective_guidance = 'Retry after the stated interval without changing the generation pin.';
  limited.error.retry_after_seconds = 30;
  cases.push(pair(limited, byCapability.get('search_assets'), searchInput('search'), 'search.rate-limited', 'rate_limited'));

  const planGates = byCapability.get('plan_research').required_gates;
  return {
    contract_version: 'observatory-machine-toolkit-fixtures.v1.0.0',
    manifest_id: manifest.manifest_id,
    conformance_cases: cases,
    legacy_compatibility_cases: [
      {
        case_id: 'legacy.safe.translation',
        legacy_input: { question: 'Find public facility metadata.', limit: 5 },
        translated_input: { ...searchInput('search'), research_need: 'Find public facility metadata.', limit: 5, expected_generation: null },
        expected_outcome: 'translated'
      },
      {
        case_id: 'legacy.limit.fail-closed',
        legacy_input: { question: 'Find public facility metadata.', limit: 21 },
        translated_input: null,
        expected_outcome: 'invalid_input_never_clip'
      }
    ],
    gate_cases: [
      {
        case_id: 'planner.all-gates-pass', capability: 'plan_research', required_gates: planGates,
        gate_receipts: planGates.map(gate => ({ gate, passed: true })), expected_registration_state: 'enabled'
      },
      {
        case_id: 'planner.one-gate-missing', capability: 'plan_research', required_gates: planGates,
        gate_receipts: planGates.map(gate => ({ gate, passed: gate !== 'planner_safety' })), expected_registration_state: 'disabled'
      },
      {
        case_id: 'search.base-gated', capability: 'search_assets', required_gates: byCapability.get('search_assets').required_gates,
        gate_receipts: byCapability.get('search_assets').required_gates.map(gate => ({ gate, passed: gate !== 'retrieval' })), expected_registration_state: 'gated'
      }
    ]
  };
}

export const ADVERSARIAL_CASES = Object.freeze({
  contract_version: 'observatory-machine-toolkit-adversarial.v1.0.0',
  cases: [
    ['unknown-property', 'search.search.success', 'input_unknown_property', 'SCHEMA_INVALID', 'schema'],
    ['input-over-cap', 'search.search.success', 'input_over_20k', 'INPUT_BYTES_EXCEEDED', 'semantic'],
    ['output-over-cap', 'search.search.success', 'output_over_cap', 'OUTPUT_BYTES_EXCEEDED', 'semantic'],
    ['truth-flip', 'search.search.success', 'truth_boundary_flip', 'TRUTH_BOUNDARY_VIOLATION', 'schema'],
    ['parity-drift', 'search.search.success', 'transport_parity_drift', 'TRANSPORT_PARITY_MISMATCH', 'parity'],
    ['snapshot-drift', 'search.search.success', 'snapshot_digest_drift', 'SNAPSHOT_DIGEST_MISMATCH', 'semantic'],
    ['generation-drift', 'search.search.success', 'generation_pin_drift', 'GENERATION_PIN_MISMATCH', 'parity'],
    ['cursor-without-truncation', 'search.search.success', 'cursor_without_truncation', 'PAGINATION_INCONSISTENT', 'semantic'],
    ['cursor-too-long-lived', 'search.search.success', 'cursor_ttl_over_30m', 'CURSOR_TTL_EXCEEDED', 'semantic'],
    ['cursor-retention-overrun', 'search.search.success', 'cursor_beyond_generation_retention', 'CONTINUATION_AFTER_RETENTION', 'semantic'],
    ['cursor-expiry-no-restart', 'search.cursor-expired', 'cursor_expired_without_restart', 'RESTART_REQUIRED', 'semantic'],
    ['silent-repin', 'search.cursor-expired', 'silent_generation_repin', 'SILENT_GENERATION_REPIN', 'semantic'],
    ['missing-evidence', 'asset.partial.success', 'missing_evidence', 'EVIDENCE_UNRESOLVED', 'semantic'],
    ['duplicate-evidence', 'asset.partial.success', 'duplicate_evidence_id', 'EVIDENCE_ID_DUPLICATE', 'semantic'],
    ['credential', 'retrieval.success', 'credential_field', 'SECRET_FIELD_PROHIBITED', 'semantic'],
    ['signed-url', 'retrieval.success', 'secret_query_parameter', 'SECRET_QUERY_PROHIBITED', 'semantic'],
    ['payload', 'retrieval.success', 'source_payload_field', 'SOURCE_PAYLOAD_PROHIBITED', 'semantic'],
    ['analysis', 'compare.success', 'analysis_payload_field', 'ANALYSIS_RESULT_PROHIBITED', 'semantic'],
    ['eligibility-overclaim', 'access.success', 'access_eligibility_overclaim', 'ACCESS_ELIGIBILITY_OVERCLAIM', 'schema'],
    ['access-submitted', 'access.success', 'access_submission_overclaim', 'ACCESS_EXECUTION_PROHIBITED', 'schema'],
    ['retrieval-executed', 'retrieval.success', 'retrieval_execution_overclaim', 'RETRIEVAL_EXECUTION_PROHIBITED', 'schema'],
    ['sample-response', 'retrieval.success', 'sample_response_payload', 'SAMPLE_RESPONSE_PROHIBITED', 'semantic'],
    ['join-upgrade', 'joins.success', 'join_documented_as_executed', 'JOIN_EVIDENCE_UPGRADE', 'semantic'],
    ['ranking', 'compare.success', 'compare_ranking', 'ANALYTICAL_RANKING_PROHIBITED', 'semantic'],
    ['source-values', 'compare.success', 'compare_source_values', 'SOURCE_VALUE_COMPARISON_PROHIBITED', 'semantic'],
    ['absence-overclaim', 'coverage.unknown.success', 'coverage_absence_without_complete_denominator', 'ABSENCE_CLAIM_UNSUPPORTED', 'semantic'],
    ['unknown-collapse', 'coverage.unknown.success', 'coverage_unknown_collapsed', 'UNKNOWN_COLLAPSE', 'semantic'],
    ['planner-truth', 'planner.gated', 'planner_truth_overclaim', 'TRUTH_BOUNDARY_VIOLATION', 'schema'],
    ['planner-advertised', 'planner.disabled', 'planner_disabled_advertised_active', 'DISABLED_TOOL_ADVERTISED', 'manifest'],
    ['legacy-clipped', 'search.search.success', 'legacy_limit_silently_clipped', 'LEGACY_LIMIT_CLIPPED', 'semantic'],
    ['privacy-leak', 'asset.unavailable', 'unsafe_record_error_leak', 'PUBLIC_ERROR_PRIVACY_LEAK', 'semantic'],
    ['rate-inconsistent', 'search.rate-limited', 'rate_limit_inconsistent', 'RATE_LIMIT_INCONSISTENT', 'semantic'],
    ['partial-atomic', 'access.success', 'partial_safety_atomic_response', 'SAFETY_ATOMIC_PARTIAL', 'semantic']
  ].map(([case_id, base_case_id, mutation, expected_failure_code, expected_layer]) => ({ case_id, base_case_id, mutation, expected_failure_code, expected_layer }))
});
