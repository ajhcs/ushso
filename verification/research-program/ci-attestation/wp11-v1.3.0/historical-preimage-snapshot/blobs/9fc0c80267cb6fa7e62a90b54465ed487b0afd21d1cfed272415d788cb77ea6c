import type { CanonicalResearchPlan, OperationEvidenceState, OperationKind, PlanStatus } from '../types/researchPlan'

export const RESEARCH_PLAN_CONTRACT_VERSION = 'observatory-research-plan.v1.0.0' as const
export const RESEARCH_PLAN_CONTRACT_ENDPOINT = '/api/contracts/research-plan/v1.0.0' as const
export const RESEARCH_PLAN_ENDPOINT = '/api/plan' as const

export const PLAN_SECTION_ORDER = [
  'lead-answer',
  'source-roles',
  'coverage-gaps',
  'operation-map',
  'acquisition-instructions',
  'downstream-support',
  'limitations-and-pins',
  'json-export',
] as const

const planStatuses = new Set<PlanStatus>(['unsupported', 'clarification_required', 'incomplete', 'ready_with_constraints', 'ready'])
const operationKinds = new Set<OperationKind>(['join', 'crosswalk', 'aggregate', 'filter', 'temporal_alignment', 'measure_harmonization'])
const evidenceStates = new Set<OperationEvidenceState>(['unknown', 'candidate', 'ambiguous', 'documented', 'observed', 'executed', 'proven'])
const compatibilityStates = new Set(['compatible', 'conditional', 'incompatible', 'unknown'])
const forbiddenOutputKeys = new Set([
  'analysis_result',
  'market_share',
  'financial_benchmark',
  'computed_measure',
  'computed_estimate',
  'ranking_output',
  'source_payload',
  'row_data',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message)
}

function assertNoAnalyticsPayload(value: unknown, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAnalyticsPayload(item, `${path}[${index}]`))
    return
  }
  if (!isObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    requireCondition(!forbiddenOutputKeys.has(key), `${path}.${key} crosses the recommendation-only boundary.`)
    assertNoAnalyticsPayload(child, `${path}.${key}`)
  }
}

function assertTruthBoundary(value: unknown, path: string) {
  requireCondition(isObject(value), `${path} must be an object.`)
  const requiredFalse = [
    'source_requests_made',
    'execution_authorized_by_ushso',
    'retrieval_executed',
    'payloads_acquired',
    'analysis_executed',
    'identity_merges_performed',
  ]
  requiredFalse.forEach((key) => requireCondition(value[key] === false, `${path}.${key} must be false.`))
}

export function assertCanonicalResearchPlanSurface(value: unknown): asserts value is CanonicalResearchPlan {
  requireCondition(isObject(value), 'Research plan must be an object.')
  requireCondition(value.contract_version === RESEARCH_PLAN_CONTRACT_VERSION, 'Research plan contract version is unsupported.')
  requireCondition(typeof value.plan_id === 'string' && value.plan_id.startsWith('sha256:'), 'Research plan ID must be a digest.')
  requireCondition(planStatuses.has(value.plan_status as PlanStatus), 'Research plan status is unsupported.')
  requireCondition(Array.isArray(value.plan_status_reason_codes) && value.plan_status_reason_codes.length > 0, 'Research plan status requires reason codes.')
  requireCondition(isObject(value.generated_from) && typeof value.generated_from.coverage_snapshot_id === 'string' && typeof value.generated_from.canonical_as_of === 'string', 'Research plan generation pins are incomplete.')
  requireCondition(isObject(value.interpreted_need) && typeof value.interpreted_need.summary === 'string', 'Research plan interpreted need is incomplete.')
  requireCondition(isObject(value.response) && isObject(value.response.critical_claim_projection), 'Research plan response is incomplete.')
  requireCondition(value.response.critical_claim_projection.plan_status === value.plan_status, 'Human and critical-claim plan statuses differ.')
  requireCondition(Array.isArray(value.asset_contributions), 'Research plan contributions must be an array.')
  requireCondition(isObject(value.bundle_assessment), 'Research plan bundle assessment is missing.')
  requireCondition(Array.isArray(value.operations), 'Research plan operations must be an array.')
  for (const operation of value.operations) {
    requireCondition(isObject(operation), 'Research plan operation must be an object.')
    requireCondition(operationKinds.has(operation.operation_kind as OperationKind), 'Research plan operation kind is invalid.')
    requireCondition(evidenceStates.has(operation.evidence_state as OperationEvidenceState), 'Research plan operation evidence state is invalid.')
    requireCondition(compatibilityStates.has(String(operation.compatibility)), 'Research plan operation compatibility is invalid.')
    requireCondition(Array.isArray(operation.requirements), 'Research plan operation requirements must remain a separate array.')
    requireCondition(Array.isArray(operation.blockers), 'Research plan operation blockers must remain a separate array.')
    requireCondition(operation.executed === false, 'Research plan operations cannot be marked executed.')
  }
  requireCondition(isObject(value.acquisition_plan) && Array.isArray(value.acquisition_plan.steps), 'Research plan acquisition instructions are missing.')
  for (const step of value.acquisition_plan.steps) {
    requireCondition(isObject(step) && step.execution_state === 'not_executed', 'Acquisition steps must remain non-executed.')
  }
  requireCondition(isObject(value.downstream_handoff) && Array.isArray(value.downstream_handoff.analysis_decisions), 'Research plan downstream handoff is missing.')
  requireCondition(value.downstream_handoff.execution_location === 'outside_ushso', 'Downstream execution must remain outside USHSO.')
  requireCondition(Array.isArray(value.important_limitations) && Array.isArray(value.unresolved_gaps) && Array.isArray(value.conditions_not_recommend), 'Research plan limits and gaps must be explicit arrays.')
  requireCondition(Array.isArray(value.evidence_references) && value.evidence_references.length > 0, 'Research plan evidence references are missing.')
  assertTruthBoundary(value.truth_boundary, '$.truth_boundary')
  assertTruthBoundary(value.response.critical_claim_projection.truth_boundary, '$.response.critical_claim_projection.truth_boundary')
  assertNoAnalyticsPayload(value)
}
