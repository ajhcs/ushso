export const TOOL_CONTRACT_VERSION = 'observatory-machine-toolkit.v1.0.0';
export const TOOLKIT_VERSION = '1.0.0';
export const WEBMCP_SPECIFICATION = Object.freeze({
  status: 'community_group_draft',
  snapshot_date: '2026-08-26',
  repository: 'https://github.com/webmachinelearning/webmcp',
  commit: '41d12f057167ccf5954dbcf49d99502cb6c84491',
  pinned_specification_url: 'https://github.com/webmachinelearning/webmcp/blob/41d12f057167ccf5954dbcf49d99502cb6c84491/index.bs',
  browser_surface: 'document.modelContext.registerTool'
});

const SCHEMA_ROOT = 'https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas';

const rows = [
  ['search_assets', 'observatory.search_assets', 'Search USHSO research assets', 'Browse indexed public-source asset metadata or identify bounded candidate assets for a stated research need. Returns summaries and evidence only; it does not retrieve source data or run analysis.', 'searchAssets', 'POST', '/api/discover', 65536, 'search-assets-input.schema.json', 'gated'],
  ['get_asset', 'observatory.get_asset', 'Get one USHSO asset', 'Dereference one stable canonical asset view from an immutable generation, including separately bounded releases, distributions, documentation, and schemas.', 'getAsset', 'GET', '/api/datasets/{record_id}', 131072, 'get-asset-input.schema.json', 'gated'],
  ['get_access_plan', 'observatory.get_access_plan', 'Explain an asset access plan', 'Explain source-documented eligibility criteria, requirements, human gates, and process without assessing the requester, authorizing access, or submitting anything.', 'getAccessPlan', 'GET', '/api/datasets/{record_id}/access-plan', 65536, 'get-access-plan-input.schema.json', 'gated'],
  ['get_retrieval_recipe', 'observatory.get_retrieval_recipe', 'Explain an asset retrieval recipe', 'Return bounded, redacted technical metadata for a documented retrieval interface. It may show sample requests, but never source response bodies, payload excerpts, or executed retrieval.', 'getRetrievalRecipe', 'GET', '/api/datasets/{record_id}/retrieval-recipe', 65536, 'get-retrieval-recipe-input.schema.json', 'gated'],
  ['get_variables', 'observatory.get_variables', 'Inspect indexed schema fields', 'Search or page through bounded field metadata for one exact asset, release, distribution, and schema context while preserving partial and unknown dictionary states.', 'getVariables', 'GET', '/api/datasets/{record_id}/variables', 131072, 'get-variables-input.schema.json', 'gated'],
  ['get_join_routes', 'observatory.get_join_routes', 'Inspect documented join routes', 'Return direct or explicitly requested two-hop metadata routes with separate operation, evidence, compatibility, requirements, blockers, and temporal applicability.', 'getJoinRoutes', 'GET', '/api/join-routes', 131072, 'get-join-routes-input.schema.json', 'gated'],
  ['compare_assets', 'observatory.compare_assets', 'Compare asset metadata', 'Compare two to five assets across bounded metadata dimensions, including unknown and incompatible states, without comparing source values or producing analytical rankings.', 'compareAssets', 'POST', '/api/compare-assets', 98304, 'compare-assets-input.schema.json', 'gated'],
  ['get_coverage_status', 'observatory.get_coverage_status', 'Explain USHSO coverage status', 'Return bounded coverage cells, explicit denominators and unknown states, and whether evidence permits an absence claim for the selected public scope.', 'getCoverageStatus', 'GET', '/api/coverage/status', 131072, 'get-coverage-status-input.schema.json', 'gated'],
  ['plan_research', 'observatory.plan_research', 'Compile an evidence-bound research plan', 'Compile a deterministic plan from immutable public metadata and evidence. It recommends and explains source contributions but does not retrieve payloads, execute operations, or perform analysis.', 'planResearch', 'POST', '/api/plan', 262144, 'plan-research-input.schema.json', 'disabled_pending_gates']
];

export const TOOL_DEFINITIONS = Object.freeze(rows.map(([capability, toolName, title, description, serviceMethod, method, route, outputMaxBytes, schemaFile, registrationState]) => Object.freeze({
  capability,
  toolName,
  title,
  description,
  serviceMethod,
  jsonApi: Object.freeze({
    method,
    route,
    generation_parameter: ['search_assets', 'compare_assets', 'plan_research'].includes(capability) ? 'expected_generation' : 'generation'
  }),
  inputSchemaId: `${SCHEMA_ROOT}/${schemaFile}`,
  inputSchema: Object.freeze({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $ref: `${SCHEMA_ROOT}/${schemaFile}`
  }),
  inputMaxBytes: 20480,
  outputMaxBytes,
  authorizationClass: 'public_read_only',
  sideEffectClass: 'none',
  annotations: Object.freeze({ readOnlyHint: true, untrustedContentHint: true }),
  registrationState
})));

export const TOOL_BY_CAPABILITY = new Map(TOOL_DEFINITIONS.map((tool) => [tool.capability, tool]));
export const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.toolName, tool]));

// These flags are the executable public truth. They remain false until a later,
// reviewed release changes the frozen capability manifest after every gate passes.
export const PUBLIC_CAPABILITY_FLAGS = Object.freeze(Object.fromEntries(
  TOOL_DEFINITIONS.map((tool) => [tool.capability, false])
));

export const REGISTRATION_POLICY = Object.freeze({
  enabledToolCount: 0,
  sameOriginOnly: true,
  singleAbortSignal: true,
  cleanUnregisterAll: true,
  authoritativeSourceEgressAllowed: false,
  sourceAcquisitionAllowed: false
});

export const LEGACY_COMPATIBILITY = Object.freeze({
  legacyName: 'observatory.discover_sources',
  preferredName: 'observatory.search_assets',
  strategy: 'versioned_gated_alias',
  registrationState: 'disabled_pending_legacy_audit',
  defaultRegistered: false,
  limitOver20Behavior: 'fail_invalid_input_never_clip'
});
