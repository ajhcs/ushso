export const VERSION = '1.0.0';
export const AS_OF = '2026-08-30T00:00:00Z';
export const REGISTRY_REVISION = 'coverage-registry:wp9:v1.0.0';
export const SOURCE_SCOPE_REVISION = 'coverage-source-scopes:wp9:v1.0.0';
export const POLICY_REVISION = 'coverage-policy:v1.0.0';
export const CONNECTOR_REVISION = 'connector:evidence-only-import:v1.0.0';
export const CONNECTOR_CONFIGURATION_REVISION = 'connector-config:federal-baseline:wp9:v1.0.0';
export const CANONICAL_REVISION = 'canonical-evidence-boundary:wp9:no-imported-facts:v1';
export const INDEX_GENERATION = 'retrieval-corpus:v1.1.0:adcfb56babc981a4c7dfc787af86d56f5fb2a31e84de02f9db8c93f0548b5d03';
export const COVERAGE_SNAPSHOT_ID = 'coverage-snapshot:wp9:v1.0.0';
export const COVERAGE_MATRIX_ID = 'coverage-matrix:state-source-class:v1.0.0';
export const PUBLIC_POSITIONING = '14-source, live-metadata-validated federal baseline plus selected state coverage';

export const CANONICAL_COVERAGE_CELL_STATES = Object.freeze([
  'integrated',
  'candidate',
  'navigation_only',
  'evidence_gap',
  'inaccessible',
  'unknown',
  'not_assessed'
]);

function pin(value, notApplicableReason = null) {
  return Object.freeze({ value, not_applicable_reason: notApplicableReason });
}

export const REVISION_PINS = Object.freeze({
  registry_revision: pin(REGISTRY_REVISION),
  source_scope_revision: pin(SOURCE_SCOPE_REVISION),
  policy_revision: pin(POLICY_REVISION),
  connector_revision: pin(CONNECTOR_REVISION),
  connector_configuration_revision: pin(CONNECTOR_CONFIGURATION_REVISION),
  canonical_revision: pin(CANONICAL_REVISION),
  coverage_contract_version: pin('1.0.0'),
  index_generation: pin(INDEX_GENERATION)
});

export const REPORTING_WINDOW = Object.freeze({ kind: 'instant', start: null, end: null });

export const TRUTH_BOUNDARY = Object.freeze({
  source_requests_made: false,
  execution_authorized_by_ushso: false,
  retrieval_executed: false,
  payloads_acquired: false,
  analysis_executed: false,
  identity_merges_performed: false
});
