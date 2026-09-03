import { clarificationQuestionSetDigest } from './common.mjs';

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const DIGEST_C = `sha256:${'c'.repeat(64)}`;

const truthBoundary = Object.freeze({
  source_requests_made: false,
  execution_authorized_by_ushso: false,
  retrieval_executed: false,
  payloads_acquired: false,
  analysis_executed: false,
  identity_merges_performed: false
});

function period(start = '2020-01-01', end = '2024-12-31', period_kind = 'calendar') {
  return { start, end, period_kind, precision: 'day' };
}

function coverage({ start, end, period_kind = 'calendar', coverage_state = 'supported', grain = 'facility', geographies = ['geo:us-pa'] } = {}) {
  return {
    period: period(start ?? '2020-01-01', end ?? '2024-12-31', period_kind),
    geographies,
    grain,
    coverage_state,
    evidence_reference_ids: ['ev-main']
  };
}

function evidence() {
  return [{
    evidence_reference_id: 'ev-main',
    evidence_id: 'obs:evidence:planner-fixture',
    claim_pointers: [
      '/plan_status',
      '/plan_status_reason_codes',
      '/interpreted_need',
      '/asset_contributions',
      '/bundle_assessment',
      '/operations',
      '/acquisition_plan',
      '/downstream_handoff',
      '/important_limitations',
      '/unresolved_gaps',
      '/conditions_not_recommend',
      '/truth_boundary'
    ],
    observed_at: '2026-08-29T12:00:00Z',
    evidence_state: 'documented',
    admissibility_state: 'admissible',
    staleness_state: 'current',
    review_state: 'human_reviewed',
    policy_id: 'obs:policy:planner-evidence:v1',
    derivation_lineage: [{ kind: 'policy', reference_id: 'obs:policy:planner-evidence:v1' }]
  }];
}

function generatedFrom() {
  return {
    publication_manifest_id: 'obs:publication:fixture-v1',
    registry_revision_id: 'obs:registry-revision:fixture-v1',
    index_generation: 'obs:index-generation:fixture-v1',
    coverage_snapshot_id: 'obs:coverage-snapshot:fixture-v1',
    candidate_snapshot_id: DIGEST_A,
    source_manifest_ids: ['obs:source-manifest:fixture-v1'],
    normalized_request_hash: DIGEST_B,
    canonical_as_of: '2026-08-30T00:00:00Z',
    claim_manifest_id: 'obs:claim-manifest:research-plan:v1.0.0',
    planner_fingerprint: {
      planner_fingerprint_id: ZERO_DIGEST,
      compiler_version: 'observatory-planner.v1.0.0',
      policy_version: 'obs:policy:planner:v1',
      contract_version: 'observatory-research-plan.v1.0.0',
      algorithm_ids: ['obs:algorithm:bounded-set-cover:v1', 'obs:algorithm:bytewise-tiebreak:v1'],
      configuration_digest: DIGEST_C,
      code_digest: DIGEST_A,
      claim_manifest_digest: ZERO_DIGEST,
      canonicalization_algorithm: 'ushso-canonical-json.v1.0.0'
    }
  };
}

function role(role_id = 'role:finance', role_kind = 'finance', description = 'Hospital finance metadata and release coverage.') {
  return { role_id, role_kind, essential: true, description, evidence_reference_ids: ['ev-main'] };
}

function intended(analysis_id = 'analysis:finance-description', description = 'Assess the suitability of source inputs for hospital finance research.') {
  return { analysis_id, description, evidence_reference_ids: ['ev-main'] };
}

function noClarifications() {
  const questions = [];
  return {
    state: 'not_required',
    question_set_hash: clarificationQuestionSetDigest(questions),
    questions,
    answers: [],
    prior_plan_id: null,
    evidence_reference_ids: ['ev-main']
  };
}

function publicContribution({
  contribution_id = 'contribution:finance',
  role_id = 'role:finance',
  role_kind = 'finance',
  asset = 'finance',
  period_kind = 'calendar',
  start = '2020-01-01',
  end = '2024-12-31',
  recommendation_state = 'essential'
} = {}) {
  return {
    contribution_id,
    role_id,
    role_kind,
    essential: true,
    recommendation_state,
    selection_level: 'exact_distribution',
    asset_id: `obs:asset:${asset}`,
    release_id: `obs:release:${asset}-2024`,
    distribution_id: `obs:distribution:${asset}-2024-csv`,
    access_route_id: `obs:access-route:${asset}-public`,
    source_id: `obs:source:${asset}-authority`,
    coverage: coverage({ start, end, period_kind }),
    fitness: [`Provides ${role_kind} metadata for the requested research role.`],
    limitations: [],
    access: {
      access_class: 'public',
      visibility_state: 'visible',
      payload_access_state: 'publicly_accessible',
      authorization_state: 'not_applicable',
      requirements: [],
      human_gates: [],
      evidence_reference_ids: ['ev-main']
    },
    identity_context: {
      identity_snapshot_id: 'obs:identity-snapshot:fixture-v1',
      valid_at: '2024-12-31',
      resolution_state: 'accepted',
      evidence_reference_ids: ['ev-main']
    },
    evidence_reference_ids: ['ev-main']
  };
}

function acquisitionStep(contribution, sequence, depends_on = []) {
  return {
    step_id: `acquire:${contribution.contribution_id}`,
    sequence,
    action_kind: 'retrieve_from_source',
    asset_id: contribution.asset_id,
    release_id: contribution.release_id,
    distribution_id: contribution.distribution_id,
    access_route_id: contribution.access_route_id,
    depends_on,
    performed_by: 'researcher',
    human_gate_ids: [],
    instructions: 'The researcher may retrieve this exact distribution from the authoritative source after independently confirming current terms.',
    stop_conditions: ['Stop if the authoritative route, release identifier, access terms, or file identity differs from this plan.'],
    execution_state: 'not_executed',
    evidence_reference_ids: ['ev-main']
  };
}

function claim(claim_id, code, severity, text, affected_ids = []) {
  return { claim_id, code, severity, text, affected_ids, evidence_reference_ids: ['ev-main'] };
}

function response() {
  return {
    lead: 'Use the exact source selections and follow the non-executed acquisition instructions.',
    summary: 'This evidence-bound plan describes source fitness, compatibility, access, and remaining limits without acquiring data or performing analysis.',
    recommendation_confidence: 'none',
    critical_claim_projection: {
      plan_status: 'unsupported',
      plan_status_reason_codes: ['PLACEHOLDER'],
      essential_role_ids: [],
      exact_contribution_ids: [],
      limitation_ids: [],
      gap_ids: [],
      truth_boundary: { ...truthBoundary }
    },
    critical_claim_digest: ZERO_DIGEST,
    evidence_reference_ids: ['ev-main']
  };
}

function emptyBundle(requested = null) {
  return {
    requested_coverage: requested,
    source_supported_coverage: [],
    common_supported_coverage: null,
    common_coverage_method: 'intersection',
    compatibility: 'unknown',
    essential_contribution_ids: [],
    constraints: [],
    evidence_reference_ids: ['ev-main']
  };
}

function basePlan() {
  const contribution = publicContribution();
  const supportedCoverage = coverage();
  return {
    contract_version: 'observatory-research-plan.v1.0.0',
    plan_id: ZERO_DIGEST,
    plan_status: 'ready',
    plan_status_reason_codes: ['MINIMAL_DEFENSIBLE_BUNDLE_READY'],
    generated_from: generatedFrom(),
    interpreted_need: {
      boundary_state: 'in_scope',
      summary: 'Identify an exact public hospital finance source and prepare a non-executed acquisition handoff.',
      geographies: ['geo:us-pa'],
      requested_period: period(),
      requested_grain: 'facility',
      required_roles: [role()],
      intended_analyses: [intended()],
      evidence_reference_ids: ['ev-main']
    },
    clarifications: noClarifications(),
    response: response(),
    asset_contributions: [contribution],
    bundle_assessment: {
      requested_coverage: supportedCoverage,
      source_supported_coverage: [{ contribution_id: contribution.contribution_id, coverage: supportedCoverage, evidence_reference_ids: ['ev-main'] }],
      common_supported_coverage: supportedCoverage,
      common_coverage_method: 'intersection',
      compatibility: 'compatible',
      essential_contribution_ids: [contribution.contribution_id],
      constraints: [],
      evidence_reference_ids: ['ev-main']
    },
    operations: [],
    acquisition_plan: { steps: [acquisitionStep(contribution, 1)], complete: true, evidence_reference_ids: ['ev-main'] },
    downstream_handoff: {
      analysis_decisions: [{
        analysis_id: 'analysis:finance-description',
        label: 'Hospital finance source-input assessment',
        classification: 'supported',
        source_support_state: 'supported',
        required_operation_ids: [],
        limitations: [],
        evidence_reference_ids: ['ev-main']
      }],
      handoff_format: 'machine_readable_plan',
      execution_location: 'outside_ushso',
      evidence_reference_ids: ['ev-main']
    },
    important_limitations: [],
    unresolved_gaps: [],
    conditions_not_recommend: [],
    evidence_references: evidence(),
    truth_boundary: { ...truthBoundary }
  };
}

function unsupportedPlan() {
  const plan = basePlan();
  plan.plan_status = 'unsupported';
  plan.interpreted_need = {
    boundary_state: 'outside_product_boundary',
    summary: 'The request asks USHSO to calculate market share, which is outside the source-planning boundary.',
    geographies: ['geo:us-pa'],
    requested_period: period(),
    requested_grain: 'system',
    required_roles: [],
    intended_analyses: [intended('analysis:market-share', 'Calculate hospital market share from source data.')],
    evidence_reference_ids: ['ev-main']
  };
  plan.asset_contributions = [];
  plan.bundle_assessment = emptyBundle(coverage({ grain: 'system' }));
  plan.operations = [];
  plan.acquisition_plan = { steps: [], complete: false, evidence_reference_ids: ['ev-main'] };
  plan.downstream_handoff.analysis_decisions = [{
    analysis_id: 'analysis:market-share',
    label: 'Hospital market-share calculation',
    classification: 'unsupported',
    source_support_state: 'unsupported',
    required_operation_ids: [],
    limitations: ['USHSO does not calculate market share or return source-data results.'],
    evidence_reference_ids: ['ev-main']
  }];
  plan.conditions_not_recommend = [claim('condition:no-analysis', 'PRODUCT_BOUNDARY', 'blocking', 'Do not use the planner as an analytics execution service.')];
  return plan;
}

function clarificationPlan() {
  const plan = basePlan();
  const question = {
    question_id: 'clarify:grain',
    prompt: 'Should the source bundle preserve facility grain or include a separate facility-to-system aggregation instruction?',
    answer_kind: 'single_choice',
    required: true,
    options: [{ value: 'facility', label: 'Preserve facility grain' }, { value: 'system', label: 'Plan a separate aggregation' }],
    material_effects: ['essential_roles', 'bundle', 'grain', 'safety'],
    answered: false,
    evidence_reference_ids: ['ev-main']
  };
  plan.plan_status = 'clarification_required';
  plan.interpreted_need.required_roles = [role('role:finance'), role('role:identity', 'organization_identity', 'Organization identity and grain alignment.')];
  plan.interpreted_need.requested_grain = null;
  plan.clarifications = {
    state: 'open',
    question_set_hash: clarificationQuestionSetDigest([question]),
    questions: [question],
    answers: [],
    prior_plan_id: null,
    evidence_reference_ids: ['ev-main']
  };
  plan.asset_contributions = [];
  plan.bundle_assessment = emptyBundle(coverage());
  plan.acquisition_plan = { steps: [], complete: false, evidence_reference_ids: ['ev-main'] };
  plan.downstream_handoff.analysis_decisions[0].classification = 'blocked';
  plan.downstream_handoff.analysis_decisions[0].source_support_state = 'unknown';
  plan.downstream_handoff.analysis_decisions[0].limitations = ['The requested grain must be clarified before a confident recommendation.'];
  return plan;
}

function incompletePlan() {
  const plan = basePlan();
  plan.plan_status = 'incomplete';
  plan.interpreted_need.required_roles = [role('role:finance'), role('role:utilization', 'utilization', 'Hospital utilization metadata and exact release.')];
  plan.asset_contributions = [plan.asset_contributions[0]];
  plan.bundle_assessment.essential_contribution_ids = ['contribution:finance'];
  plan.acquisition_plan = { steps: [acquisitionStep(plan.asset_contributions[0], 1)], complete: false, evidence_reference_ids: ['ev-main'] };
  plan.unresolved_gaps = [claim('gap:utilization-release', 'ESSENTIAL_ROLE_MISSING', 'blocking', 'No admissible exact utilization release and access route resolves in the pinned generation.', ['role:utilization'])];
  plan.downstream_handoff.analysis_decisions[0].classification = 'blocked';
  plan.downstream_handoff.analysis_decisions[0].source_support_state = 'blocked';
  plan.downstream_handoff.analysis_decisions[0].limitations = ['The utilization role remains unresolved.'];
  return plan;
}

function operation({
  operation_id,
  operation_kind,
  essential = false,
  input_ids,
  output_id,
  depends_on = [],
  source_grain = 'facility',
  target_grain = 'facility',
  period_kind = 'mixed',
  evidence_state = 'documented',
  basis_evidence_state = evidence_state,
  compatibility = 'compatible',
  join_route_id = null,
  identifier_namespace_id = null,
  measure_additivity = 'not_applicable',
  resolution_state = 'accepted',
  requirements = [],
  blockers = []
}) {
  return {
    operation_id,
    operation_kind,
    essential,
    input_ids,
    output_id,
    depends_on,
    source_grain,
    target_grain,
    period_kind,
    evidence_state,
    basis_evidence_state,
    compatibility,
    join_route_id,
    identifier_namespace_id,
    measure_additivity,
    identity_context: {
      identity_snapshot_id: 'obs:identity-snapshot:pa-history-v1',
      valid_from: '2019-01-01',
      valid_to: '2026-12-31',
      resolution_state,
      evidence_reference_ids: ['ev-main']
    },
    requirements,
    blockers,
    executed: false,
    evidence_reference_ids: ['ev-main']
  };
}

function paPlan() {
  const finance = publicContribution({ contribution_id: 'contribution:pa-finance', role_id: 'role:finance', role_kind: 'finance', asset: 'cms-hcris', period_kind: 'fiscal' });
  const utilization = publicContribution({ contribution_id: 'contribution:pa-utilization', role_id: 'role:utilization', role_kind: 'utilization', asset: 'phc4-utilization', period_kind: 'calendar' });
  const identity = publicContribution({ contribution_id: 'contribution:pa-identity', role_id: 'role:identity', role_kind: 'organization_identity', asset: 'cms-provider-identity', period_kind: 'calendar' });
  const requestedCoverage = coverage({ start: '2020-01-01', end: '2025-12-31', period_kind: 'mixed', coverage_state: 'partial', grain: 'system' });
  const commonCoverage = coverage({ start: '2020-01-01', end: '2024-12-31', period_kind: 'mixed', coverage_state: 'partial' });
  const crosswalkRequirement = {
    requirement_id: 'requirement:phc4-label-ccn-crosswalk',
    kind: 'crosswalk',
    state: 'unsatisfied',
    description: 'A reviewed PHC4 facility-label-to-CCN crosswalk is required for row-level linkage.',
    satisfied_by_operation_id: null,
    evidence_reference_ids: ['ev-main']
  };
  const candidateBlocker = {
    blocker_id: 'blocker:phc4-crosswalk',
    kind: 'missing_crosswalk',
    state: 'open',
    fatal: false,
    description: 'The PHC4 label-to-CCN relationship remains candidate and cannot be upgraded.',
    evidence_reference_ids: ['ev-main']
  };
  const operations = [
    operation({
      operation_id: 'operation:temporal-alignment', operation_kind: 'temporal_alignment', essential: true,
      input_ids: [finance.contribution_id, utilization.contribution_id], output_id: 'handoff:aligned-periods'
    }),
    operation({
      operation_id: 'operation:candidate-ccn-join', operation_kind: 'join', input_ids: [utilization.contribution_id, identity.contribution_id], output_id: 'handoff:candidate-linked-facilities', depends_on: ['operation:temporal-alignment'], evidence_state: 'candidate', basis_evidence_state: 'candidate', compatibility: 'conditional', join_route_id: 'obs:join-route:phc4-label-to-ccn', identifier_namespace_id: 'obs:namespace:ccn', resolution_state: 'candidate', requirements: [crosswalkRequirement], blockers: [candidateBlocker]
    }),
    operation({
      operation_id: 'operation:facility-to-system-aggregation', operation_kind: 'aggregate', input_ids: ['handoff:candidate-linked-facilities'], output_id: 'handoff:system-grain', depends_on: ['operation:candidate-ccn-join'], source_grain: 'facility', target_grain: 'system', compatibility: 'conditional', measure_additivity: 'semi_additive'
    })
  ];
  const plan = basePlan();
  plan.plan_status = 'ready_with_constraints';
  plan.interpreted_need = {
    boundary_state: 'in_scope',
    summary: 'Identify exact Pennsylvania hospital finance, utilization, and identity inputs and describe non-executed alignment, linkage, and aggregation work.',
    geographies: ['geo:us-pa'],
    requested_period: period('2020-01-01', '2025-12-31', 'mixed'),
    requested_grain: 'system',
    required_roles: [role('role:finance'), role('role:utilization', 'utilization', 'Pennsylvania hospital utilization metadata.'), role('role:identity', 'organization_identity', 'Time-appropriate facility and organization identity metadata.')],
    intended_analyses: [intended('analysis:pa-finance-utilization', 'Prepare inputs for external Pennsylvania hospital finance and utilization research.')],
    evidence_reference_ids: ['ev-main']
  };
  plan.asset_contributions = [finance, utilization, identity];
  plan.bundle_assessment = {
    requested_coverage: requestedCoverage,
    source_supported_coverage: [finance, utilization, identity].map(contribution => ({ contribution_id: contribution.contribution_id, coverage: contribution.coverage, evidence_reference_ids: ['ev-main'] })),
    common_supported_coverage: commonCoverage,
    common_coverage_method: 'intersection',
    compatibility: 'conditional',
    essential_contribution_ids: [finance.contribution_id, utilization.contribution_id, identity.contribution_id],
    constraints: [claim('constraint:coverage-through-2024', 'BOUNDED_COVERAGE', 'warning', 'Evidenced common coverage stops at 2024; 2025 remains unreconciled.')],
    evidence_reference_ids: ['ev-main']
  };
  plan.operations = operations;
  plan.acquisition_plan = {
    steps: [acquisitionStep(finance, 1), acquisitionStep(utilization, 2), acquisitionStep(identity, 3)],
    complete: true,
    evidence_reference_ids: ['ev-main']
  };
  plan.downstream_handoff.analysis_decisions = [{
    analysis_id: 'analysis:pa-finance-utilization',
    label: 'Pennsylvania hospital finance/utilization research handoff',
    classification: 'conditional',
    source_support_state: 'conditional',
    required_operation_ids: operations.map(item => item.operation_id),
    limitations: ['Do not present candidate CCN linkage as documented.', 'Facility-to-system aggregation is separate and not executed.', 'Common evidenced coverage stops at 2024.'],
    evidence_reference_ids: ['ev-main']
  }];
  plan.important_limitations = [claim('limitation:pa-candidate-identity', 'CANDIDATE_IDENTITY', 'warning', 'CCN linkage remains candidate for the affected PHC4 labels.', ['operation:candidate-ccn-join'])];
  plan.unresolved_gaps = [claim('gap:pa-label-crosswalk', 'CROSSWALK_REQUIRED', 'warning', 'A reviewed PHC4 label-to-CCN crosswalk is not present.', ['operation:candidate-ccn-join'])];
  plan.conditions_not_recommend = [claim('condition:no-row-linkage', 'DO_NOT_LINK_WITHOUT_CROSSWALK', 'warning', 'Do not perform row-level PHC4 linkage without the reviewed crosswalk.', ['operation:candidate-ccn-join'])];
  return plan;
}

export function planTemplates() {
  return [unsupportedPlan(), clarificationPlan(), incompletePlan(), paPlan(), basePlan()];
}
