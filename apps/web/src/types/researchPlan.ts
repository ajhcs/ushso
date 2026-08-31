export type PlanStatus =
  | 'unsupported'
  | 'clarification_required'
  | 'incomplete'
  | 'ready_with_constraints'
  | 'ready'

export type RecommendationState = 'essential' | 'supporting' | 'conditional' | 'rejected' | 'unavailable'
export type OperationKind = 'join' | 'crosswalk' | 'aggregate' | 'filter' | 'temporal_alignment' | 'measure_harmonization'
export type OperationEvidenceState = 'unknown' | 'candidate' | 'ambiguous' | 'documented' | 'observed' | 'executed' | 'proven'
export type CompatibilityState = 'compatible' | 'conditional' | 'incompatible' | 'unknown'

export interface PlanTruthBoundary {
  source_requests_made: false
  execution_authorized_by_ushso: false
  retrieval_executed: false
  payloads_acquired: false
  analysis_executed: false
  identity_merges_performed: false
}

export interface PlanPeriod {
  start: string
  end: string
  period_kind: 'calendar' | 'fiscal' | 'mixed' | 'unknown'
  precision: string
}

export interface PlanCoverage {
  period: PlanPeriod | null
  geographies: string[]
  grain: 'facility' | 'campus' | 'organization' | 'system' | 'county' | 'state' | 'national' | 'mixed' | 'unknown' | null
  coverage_state: string
  evidence_reference_ids: string[]
}

export interface PlanRequirement {
  requirement_id: string
  kind: string
  state: 'satisfied' | 'unsatisfied' | 'external' | 'unknown' | 'not_applicable'
  description?: string
  evidence_reference_ids?: string[]
}

export interface PlanHumanGate {
  gate_id: string
  kind: string
  state: 'not_started' | 'external_required' | 'satisfied_outside_ushso' | 'not_applicable' | 'unknown'
  description?: string
  evidence_reference_ids?: string[]
}

export interface PlanBlocker {
  blocker_id: string
  kind: string
  state: 'open' | 'resolved' | 'external' | 'unknown'
  fatal: boolean
  description?: string
  evidence_reference_ids?: string[]
}

export interface PlanClaim {
  claim_id: string
  code: string
  severity: string
  text: string
  affected_ids: string[]
  evidence_reference_ids: string[]
}

export interface AssetContribution {
  contribution_id: string
  role_id: string
  role_kind: string
  essential: boolean
  recommendation_state: RecommendationState
  selection_level: 'exact_distribution' | 'asset_placeholder' | 'family_placeholder' | 'source_placeholder' | 'unresolved'
  asset_id: string | null
  release_id: string | null
  distribution_id: string | null
  access_route_id: string | null
  source_id: string
  coverage: PlanCoverage
  fitness: string[]
  limitations: string[]
  access: {
    access_class: string
    visibility_state: string
    payload_access_state: string
    authorization_state: string
    requirements: PlanRequirement[]
    human_gates: PlanHumanGate[]
    evidence_reference_ids: string[]
  }
  identity_context: {
    identity_snapshot_id: string
    valid_at: string
    resolution_state: string
    evidence_reference_ids: string[]
  }
  evidence_reference_ids: string[]
}

export interface PlanOperation {
  operation_id: string
  operation_kind: OperationKind
  essential: boolean
  input_ids: string[]
  output_id: string
  depends_on: string[]
  source_grain: string
  target_grain: string
  period_kind: string
  evidence_state: OperationEvidenceState
  basis_evidence_state: OperationEvidenceState
  compatibility: CompatibilityState
  join_route_id: string | null
  identifier_namespace_id: string | null
  measure_additivity: string
  identity_context: {
    identity_snapshot_id: string
    valid_from: string
    valid_to: string
    resolution_state: string
    evidence_reference_ids: string[]
  }
  requirements: PlanRequirement[]
  blockers: PlanBlocker[]
  executed: false
  evidence_reference_ids: string[]
}

export interface AcquisitionStep {
  step_id: string
  sequence: number
  action_kind: string
  asset_id: string
  release_id: string
  distribution_id: string
  access_route_id: string
  depends_on: string[]
  performed_by: 'researcher' | 'research_institution' | 'source_operator' | 'data_owner'
  human_gate_ids: string[]
  instructions: string
  stop_conditions: string[]
  execution_state: 'not_executed'
  evidence_reference_ids: string[]
}

export interface CanonicalResearchPlan {
  contract_version: 'observatory-research-plan.v1.0.0'
  plan_id: string
  plan_status: PlanStatus
  plan_status_reason_codes: string[]
  generated_from: {
    publication_manifest_id: string
    registry_revision_id: string
    index_generation: string
    coverage_snapshot_id: string
    candidate_snapshot_id: string
    source_manifest_ids: string[]
    normalized_request_hash: string
    canonical_as_of: string
    claim_manifest_id: string
    planner_fingerprint: Record<string, unknown>
  }
  interpreted_need: {
    boundary_state: 'in_scope' | 'outside_product_boundary' | 'unknown'
    summary: string
    geographies: string[]
    requested_period: PlanPeriod | null
    requested_grain: string | null
    required_roles: Array<{
      role_id: string
      role_kind: string
      essential: boolean
      description: string
      evidence_reference_ids: string[]
    }>
    intended_analyses: Array<{
      analysis_id: string
      description: string
      evidence_reference_ids: string[]
    }>
    evidence_reference_ids: string[]
  }
  clarifications: {
    state: 'not_required' | 'open' | 'answered' | 'invalidated'
    question_set_hash: string
    questions: Array<{ question_id: string; prompt: string; required: boolean; answered: boolean; evidence_reference_ids: string[] }>
    answers: unknown[]
    prior_plan_id: string | null
    evidence_reference_ids: string[]
  }
  response: {
    lead: string
    summary: string
    recommendation_confidence: 'none' | 'partial' | 'constrained' | 'confident'
    critical_claim_projection: {
      plan_status: PlanStatus
      plan_status_reason_codes: string[]
      truth_boundary: PlanTruthBoundary
      [key: string]: unknown
    }
    critical_claim_digest: string
    evidence_reference_ids: string[]
  }
  asset_contributions: AssetContribution[]
  bundle_assessment: {
    requested_coverage: PlanCoverage | null
    source_supported_coverage: Array<{ contribution_id: string; coverage: PlanCoverage; evidence_reference_ids: string[] }>
    common_supported_coverage: PlanCoverage | null
    common_coverage_method: 'intersection'
    compatibility: CompatibilityState
    essential_contribution_ids: string[]
    constraints: PlanClaim[]
    evidence_reference_ids: string[]
  }
  operations: PlanOperation[]
  acquisition_plan: {
    steps: AcquisitionStep[]
    complete: boolean
    evidence_reference_ids: string[]
  }
  downstream_handoff: {
    analysis_decisions: Array<{
      analysis_id: string
      label: string
      classification: 'supported' | 'conditional' | 'blocked' | 'unsupported'
      source_support_state: 'supported' | 'conditional' | 'blocked' | 'unsupported' | 'unknown'
      required_operation_ids: string[]
      limitations: string[]
      evidence_reference_ids: string[]
    }>
    handoff_format: 'instructions_only' | 'machine_readable_plan'
    execution_location: 'outside_ushso'
    evidence_reference_ids: string[]
  }
  important_limitations: PlanClaim[]
  unresolved_gaps: PlanClaim[]
  conditions_not_recommend: PlanClaim[]
  evidence_references: Array<{
    evidence_reference_id: string
    evidence_id: string
    observed_at: string
    evidence_state: OperationEvidenceState
    admissibility_state: string
    staleness_state: string
    review_state: string
    [key: string]: unknown
  }>
  truth_boundary: PlanTruthBoundary
}

export type PlanSurfaceState =
  | { status: 'blocked'; code: 'planner_dependency_blocked'; message: string }
  | { status: 'loading' }
  | { status: 'error'; code: string; message: string }
  | { status: 'ready'; plan: CanonicalResearchPlan }
