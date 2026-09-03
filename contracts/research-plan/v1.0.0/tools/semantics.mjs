import { canonicalDigest, canonicalJson, clarificationQuestionSetDigest, criticalClaimDigest, criticalClaimProjection, getPointer, planDigest } from './common.mjs';

const STATUS_ORDER = ['unsupported', 'clarification_required', 'incomplete', 'ready_with_constraints', 'ready'];
const RESTRICTED_ACCESS = new Set(['registration', 'application', 'dua', 'licensed', 'paid']);
const EVIDENCE_STRENGTH = new Map(['unknown', 'candidate', 'ambiguous', 'documented', 'observed', 'executed', 'proven'].map((value, index) => [value, index]));
const RECOMMENDATION_ROOTS = ['/asset_contributions', '/bundle_assessment', '/operations', '/acquisition_plan', '/downstream_handoff'];
const PROHIBITED_FIELD_PATTERNS = [
  /^(?:dataset|healthcare|source_data)_?rows?$/i,
  /^(?:payload|source_payload)_?(?:body|contents?|data)$/i,
  /^(?:analysis|analytic)_?(?:results?|outputs?|values?)$/i,
  /^computed_?(?:results?|values?|measures?|metrics?)$/i,
  /^(?:market_share|financial_benchmark|rankings?)$/i,
  /^executed_?(?:sql|analysis|query|code)$/i
];
const PROHIBITED_ANALYSIS = /\b(?:calculate|compute|produce|execute)\b.{0,40}\b(?:market share|financial benchmark|ranking|forecast|trend|analysis|join|aggregation)\b/i;

function add(errors, code, path, message = code) {
  errors.push({ code, path, message });
}

function unique(values) {
  return new Set(values).size === values.length;
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function pointerCovers(claimPointer, target) {
  return claimPointer === target || target.startsWith(`${claimPointer}/`) || claimPointer.startsWith(`${target}/`);
}

function scanForbidden(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbidden(item, `${path}/${index}`, errors));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${key}`;
    if (PROHIBITED_FIELD_PATTERNS.some(pattern => pattern.test(key))) add(errors, 'PRODUCT_BOUNDARY_FIELD_FORBIDDEN', childPath, `forbidden field ${key}`);
    scanForbidden(child, childPath, errors);
  }
}

function graphErrors(nodes, idField, dependencyField, root, errors) {
  const byId = new Map();
  nodes.forEach((node, index) => {
    if (byId.has(node[idField])) add(errors, 'DUPLICATE_GRAPH_NODE', `${root}/${index}/${idField}`);
    byId.set(node[idField], { node, index });
  });
  const state = new Map();
  function visit(id, stack) {
    if (state.get(id) === 'visiting') {
      add(errors, 'GRAPH_CYCLE', root, `${stack.join(' -> ')} -> ${id}`);
      return;
    }
    if (state.get(id) === 'visited') return;
    const row = byId.get(id);
    if (!row) return;
    state.set(id, 'visiting');
    for (const dependency of row.node[dependencyField]) {
      if (!byId.has(dependency)) add(errors, 'GRAPH_DEPENDENCY_UNKNOWN', `${root}/${row.index}/${dependencyField}`, dependency);
      else visit(dependency, [...stack, id]);
    }
    state.set(id, 'visited');
  }
  for (const id of byId.keys()) visit(id, []);
  return byId;
}

function validatePeriods(plan, errors) {
  const requested = plan.interpreted_need.requested_period;
  const requestedCoverage = plan.bundle_assessment.requested_coverage;
  const common = plan.bundle_assessment.common_supported_coverage;
  const selected = plan.asset_contributions.filter(contribution => contribution.essential && contribution.selection_level === 'exact_distribution' && !['rejected', 'unavailable'].includes(contribution.recommendation_state));
  const periods = selected.map(contribution => contribution.coverage.period);

  for (const [label, period] of [['requested', requested], ['common', common?.period], ...periods.map((period, index) => [`source-${index}`, period])]) {
    if (period && period.start > period.end) add(errors, 'TIME_PERIOD_REVERSED', `/bundle_assessment/${label}`);
  }
  if (requested && requestedCoverage && !same(requested, requestedCoverage.period)) add(errors, 'REQUESTED_COVERAGE_PERIOD_DRIFT', '/bundle_assessment/requested_coverage/period');
  if (plan.interpreted_need.requested_grain && requestedCoverage && requestedCoverage.grain !== plan.interpreted_need.requested_grain) add(errors, 'REQUESTED_COVERAGE_GRAIN_DRIFT', '/bundle_assessment/requested_coverage/grain');
  if (requestedCoverage) {
    const interpretedGeographies = new Set(plan.interpreted_need.geographies);
    if (requestedCoverage.geographies.some(geography => !interpretedGeographies.has(geography)) || plan.interpreted_need.geographies.some(geography => !requestedCoverage.geographies.includes(geography))) add(errors, 'REQUESTED_COVERAGE_GEOGRAPHY_DRIFT', '/bundle_assessment/requested_coverage/geographies');
  }
  const selectedById = new Map(plan.asset_contributions.filter(contribution => contribution.selection_level === 'exact_distribution' && !['rejected', 'unavailable'].includes(contribution.recommendation_state)).map(contribution => [contribution.contribution_id, contribution]));
  const sourceCoverageIds = plan.bundle_assessment.source_supported_coverage.map(item => item.contribution_id);
  if (!unique(sourceCoverageIds)) add(errors, 'SOURCE_COVERAGE_CONTRIBUTION_DUPLICATE', '/bundle_assessment/source_supported_coverage');
  for (const [contributionId, contribution] of selectedById) {
    const sourceCoverage = plan.bundle_assessment.source_supported_coverage.find(item => item.contribution_id === contributionId);
    if (!sourceCoverage) add(errors, 'SOURCE_COVERAGE_CONTRIBUTION_MISSING', '/bundle_assessment/source_supported_coverage', contributionId);
    else if (!same(sourceCoverage.coverage, contribution.coverage)) add(errors, 'SOURCE_COVERAGE_CONTRIBUTION_DRIFT', '/bundle_assessment/source_supported_coverage', contributionId);
  }
  for (const contributionId of sourceCoverageIds) if (!selectedById.has(contributionId)) add(errors, 'SOURCE_COVERAGE_CONTRIBUTION_UNKNOWN', '/bundle_assessment/source_supported_coverage', contributionId);
  const expectedEssential = [...selectedById.values()].filter(contribution => contribution.essential).map(contribution => contribution.contribution_id);
  if (!same(plan.bundle_assessment.essential_contribution_ids, expectedEssential)) add(errors, 'ESSENTIAL_CONTRIBUTION_SET_DRIFT', '/bundle_assessment/essential_contribution_ids');
  if (!common || periods.length === 0) return;
  const intersectionStart = periods.map(period => period.start).sort().at(-1);
  const intersectionEnd = periods.map(period => period.end).sort()[0];
  if (common.period.start < intersectionStart || common.period.end > intersectionEnd) {
    add(errors, 'COMMON_COVERAGE_EXCEEDS_INTERSECTION', '/bundle_assessment/common_supported_coverage/period');
  }
  const geographyIntersection = selected
    .map(contribution => new Set(contribution.coverage.geographies))
    .reduce((intersection, values) => new Set([...intersection].filter(value => values.has(value))));
  for (const geography of common.geographies) {
    if (!geographyIntersection.has(geography)) add(errors, 'COMMON_GEOGRAPHY_EXCEEDS_INTERSECTION', '/bundle_assessment/common_supported_coverage/geographies', geography);
  }
  const kinds = new Set(periods.map(period => period.period_kind).filter(kind => kind !== 'unknown'));
  if (kinds.size > 1 && common.period.period_kind !== 'mixed') add(errors, 'FISCAL_CALENDAR_COLLAPSE', '/bundle_assessment/common_supported_coverage/period/period_kind');
  if (kinds.size === 1 && !kinds.has(common.period.period_kind)) add(errors, 'PERIOD_KIND_MISMATCH', '/bundle_assessment/common_supported_coverage/period/period_kind');
  if (requested && common.period.start < requested.start) add(errors, 'COMMON_COVERAGE_BEFORE_REQUEST', '/bundle_assessment/common_supported_coverage/period/start');
}

function validateExactSelections(plan, errors) {
  const roleIds = plan.interpreted_need.required_roles.filter(role => role.essential).map(role => role.role_id);
  const contributionsByRole = new Map();
  plan.asset_contributions.forEach((contribution, index) => {
    if (!contributionsByRole.has(contribution.role_id)) contributionsByRole.set(contribution.role_id, []);
    contributionsByRole.get(contribution.role_id).push({ contribution, index });
    if (['ready', 'ready_with_constraints'].includes(plan.plan_status) && contribution.selection_level === 'family_placeholder') add(errors, 'FAMILY_PLACEHOLDER_NOT_EXECUTABLE', `/asset_contributions/${index}/selection_level`);
    if (['ready', 'ready_with_constraints'].includes(plan.plan_status) && contribution.selection_level === 'source_placeholder') add(errors, 'SOURCE_PLACEHOLDER_NOT_EXECUTABLE', `/asset_contributions/${index}/selection_level`);
    if (contribution.selection_level === 'exact_distribution' && [contribution.asset_id, contribution.release_id, contribution.distribution_id, contribution.access_route_id].some(value => value === null)) {
      add(errors, 'EXACT_SELECTION_ID_MISSING', `/asset_contributions/${index}`);
    }
  });
  if (['ready', 'ready_with_constraints'].includes(plan.plan_status)) {
    for (const roleId of roleIds) {
      const eligible = (contributionsByRole.get(roleId) ?? []).filter(({ contribution }) => contribution.selection_level === 'exact_distribution' && !['rejected', 'unavailable'].includes(contribution.recommendation_state));
      if (eligible.length === 0) add(errors, 'ESSENTIAL_ROLE_UNRESOLVED', '/asset_contributions', roleId);
    }
  }
}

function validateOperations(plan, errors) {
  const byId = graphErrors(plan.operations, 'operation_id', 'depends_on', '/operations', errors);
  const requested = plan.interpreted_need.requested_period;
  plan.operations.forEach((operation, index) => {
    const root = `/operations/${index}`;
    if ((EVIDENCE_STRENGTH.get(operation.evidence_state) ?? 0) > (EVIDENCE_STRENGTH.get(operation.basis_evidence_state) ?? 0)) {
      add(errors, 'CANDIDATE_JOIN_UPGRADED', `${root}/evidence_state`);
    }
    if (operation.source_grain !== operation.target_grain && operation.operation_kind !== 'aggregate') add(errors, 'GRAIN_CHANGE_WITHOUT_AGGREGATION', root);
    if (['join', 'crosswalk'].includes(operation.operation_kind) && operation.identifier_namespace_id === null) add(errors, 'IDENTIFIER_NAMESPACE_MISSING', `${root}/identifier_namespace_id`);
    if (operation.operation_kind === 'join' && operation.join_route_id === null) add(errors, 'JOIN_ROUTE_MISSING', `${root}/join_route_id`);
    if (operation.operation_kind === 'aggregate' && ['non_additive', 'unknown'].includes(operation.measure_additivity)) {
      add(errors, 'UNSAFE_AGGREGATION', `${root}/measure_additivity`);
    }
    if (requested && (operation.identity_context.valid_from > requested.start || operation.identity_context.valid_to < requested.end)) {
      add(errors, 'CURRENT_IDENTITY_USED_HISTORICALLY', `${root}/identity_context`);
    }
    if (operation.identity_context.resolution_state === 'candidate' && ['documented', 'observed', 'executed', 'proven'].includes(operation.evidence_state)) {
      add(errors, 'IDENTITY_CANDIDATE_PRESENTED_AS_EQUALITY', `${root}/identity_context/resolution_state`);
    }
    if (operation.compatibility === 'incompatible' && !operation.blockers.some(blocker => blocker.state === 'open')) add(errors, 'INCOMPATIBLE_OPERATION_MISSING_BLOCKER', `${root}/blockers`);
    operation.requirements.forEach((requirement, requirementIndex) => {
      const requirementRoot = `${root}/requirements/${requirementIndex}`;
      if (requirement.state === 'satisfied' && requirement.satisfied_by_operation_id === null) add(errors, 'SATISFIED_REQUIREMENT_OPERATION_MISSING', requirementRoot);
      if (requirement.state !== 'satisfied' && requirement.satisfied_by_operation_id !== null) add(errors, 'UNSATISFIED_REQUIREMENT_HAS_OPERATION', requirementRoot);
      if (requirement.satisfied_by_operation_id !== null) {
        const satisfying = byId.get(requirement.satisfied_by_operation_id)?.node;
        if (!satisfying) add(errors, 'REQUIREMENT_OPERATION_UNKNOWN', requirementRoot);
        const expectedKind = requirement.kind === 'crosswalk' ? 'crosswalk' : requirement.kind === 'aggregation' ? 'aggregate' : null;
        if (expectedKind && satisfying && satisfying.operation_kind !== expectedKind) {
          add(errors, requirement.kind === 'crosswalk' && satisfying.operation_kind === 'aggregate' ? 'CROSSWALK_SATISFIED_BY_AGGREGATION' : 'REQUIREMENT_OPERATION_KIND_MISMATCH', requirementRoot);
        }
      }
    });
  });
}

function validateAcquisition(plan, errors) {
  const byId = graphErrors(plan.acquisition_plan.steps, 'step_id', 'depends_on', '/acquisition_plan/steps', errors);
  const contributionByRoute = new Map(plan.asset_contributions.filter(contribution => contribution.access_route_id !== null).map(contribution => [contribution.access_route_id, contribution]));
  const gateIds = new Set(plan.asset_contributions.flatMap(contribution => contribution.access.human_gates.map(gate => gate.gate_id)));
  const stepRoutes = new Set();
  const sequences = plan.acquisition_plan.steps.map(step => step.sequence).sort((left, right) => left - right);
  if (!same(sequences, sequences.map((_, index) => index + 1))) add(errors, 'ACQUISITION_SEQUENCE_NOT_CONTIGUOUS', '/acquisition_plan/steps');
  plan.acquisition_plan.steps.forEach((step, index) => {
    const root = `/acquisition_plan/steps/${index}`;
    stepRoutes.add(step.access_route_id);
    const contribution = contributionByRoute.get(step.access_route_id);
    if (!contribution) add(errors, 'ACQUISITION_ROUTE_NOT_SELECTED', `${root}/access_route_id`);
    else if (step.asset_id !== contribution.asset_id || step.release_id !== contribution.release_id || step.distribution_id !== contribution.distribution_id) add(errors, 'ACQUISITION_EXACT_ID_MISMATCH', root);
    for (const gateId of step.human_gate_ids) if (!gateIds.has(gateId)) add(errors, 'ACQUISITION_HUMAN_GATE_UNKNOWN', `${root}/human_gate_ids`, gateId);
    for (const dependency of step.depends_on) {
      const prior = byId.get(dependency)?.node;
      if (prior && prior.sequence >= step.sequence) add(errors, 'ACQUISITION_SEQUENCE_NOT_TOPOLOGICAL', `${root}/sequence`);
    }
  });
  plan.asset_contributions.forEach((contribution, index) => {
    if (contribution.selection_level === 'exact_distribution' && !['rejected', 'unavailable'].includes(contribution.recommendation_state) && !stepRoutes.has(contribution.access_route_id)) {
      add(errors, 'ACQUISITION_STEP_MISSING', `/asset_contributions/${index}/access_route_id`);
    }
    if (RESTRICTED_ACCESS.has(contribution.access.access_class)) {
      const requiredGates = contribution.access.human_gates.filter(gate => gate.required);
      if (requiredGates.length === 0) add(errors, 'HUMAN_AUTHORIZATION_GATE_MISSING', `/asset_contributions/${index}/access/human_gates`);
      if (['not_applicable', 'unknown'].includes(contribution.access.authorization_state)) add(errors, 'RESTRICTED_ACCESS_AUTHORIZATION_OVERCLAIM', `/asset_contributions/${index}/access/authorization_state`);
      for (const gate of requiredGates) {
        const gateStep = plan.acquisition_plan.steps.find(step => step.human_gate_ids.includes(gate.gate_id));
        if (!gateStep) add(errors, 'HUMAN_AUTHORIZATION_GATE_NOT_IN_DAG', `/asset_contributions/${index}/access/human_gates`);
        else {
          const expectedActions = {
            registration: ['registration'], application: ['application'], dua: ['dua'], fee: ['fee'],
            eligibility_review: ['application'], login: ['registration'], institutional_approval: ['institutional_approval'],
            manual_source_action: ['prepare_inputs', 'application']
          }[gate.kind];
          if (!expectedActions.includes(gateStep.action_kind)) add(errors, 'HUMAN_GATE_ACTION_KIND_MISMATCH', `/acquisition_plan/steps/${plan.acquisition_plan.steps.indexOf(gateStep)}/action_kind`);
        }
      }
    }
  });
}

function validateDownstream(plan, errors) {
  const intended = new Map(plan.interpreted_need.intended_analyses.map(item => [item.analysis_id, item]));
  plan.downstream_handoff.analysis_decisions.forEach((decision, index) => {
    const root = `/downstream_handoff/analysis_decisions/${index}`;
    if (!intended.has(decision.analysis_id)) add(errors, 'DOWNSTREAM_ANALYSIS_NOT_REQUESTED', `${root}/analysis_id`);
    if (decision.classification === 'supported' && decision.source_support_state !== 'supported') add(errors, 'UNSUPPORTED_ANALYSIS_LABELED_SUPPORTED', root);
    const description = intended.get(decision.analysis_id)?.description ?? decision.label;
    if (PROHIBITED_ANALYSIS.test(description) && ['supported', 'conditional'].includes(decision.classification)) add(errors, 'PRODUCT_BOUNDARY_ANALYSIS_OVERCLAIM', root);
  });
}

function validateEvidence(plan, claimManifest, errors) {
  const byId = new Map();
  plan.evidence_references.forEach((reference, index) => {
    if (byId.has(reference.evidence_reference_id)) add(errors, 'DUPLICATE_EVIDENCE_REFERENCE', `/evidence_references/${index}/evidence_reference_id`);
    byId.set(reference.evidence_reference_id, reference);
    for (const pointer of reference.claim_pointers) if (getPointer(plan, pointer) === undefined) add(errors, 'EVIDENCE_CLAIM_POINTER_UNRESOLVED', `/evidence_references/${index}/claim_pointers`, pointer);
    if (reference.observed_at > plan.generated_from.canonical_as_of) add(errors, 'EVIDENCE_OBSERVED_AFTER_PLAN_AS_OF', `/evidence_references/${index}/observed_at`);
  });

  function walk(value, pointer) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${pointer}/${index}`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.evidence_reference_ids)) {
      for (const id of value.evidence_reference_ids) if (!byId.has(id)) add(errors, 'EVIDENCE_REFERENCE_UNRESOLVED', `${pointer}/evidence_reference_ids`, id);
    }
    for (const [key, child] of Object.entries(value)) if (key !== 'evidence_references') walk(child, `${pointer}/${key}`);
  }
  walk(plan, '');

  for (const root of claimManifest.auditable_roots) {
    const covering = plan.evidence_references.filter(reference => reference.claim_pointers.some(pointer => pointerCovers(pointer, root)));
    if (covering.length === 0) add(errors, 'AUDITABLE_CLAIM_EVIDENCE_MISSING', root);
  }
  if (['ready', 'ready_with_constraints'].includes(plan.plan_status)) {
    let releaseAdmissibilityFailed = false;
    plan.evidence_references.forEach((reference, index) => {
      const recommendationEvidence = reference.claim_pointers.some(pointer => RECOMMENDATION_ROOTS.some(root => pointerCovers(pointer, root)));
      if (!recommendationEvidence) return;
      if (reference.admissibility_state !== 'admissible') {
        releaseAdmissibilityFailed = true;
        add(errors, 'EVIDENCE_INADMISSIBLE', `/evidence_references/${index}/admissibility_state`);
      }
      if (reference.staleness_state !== 'current') {
        releaseAdmissibilityFailed = true;
        add(errors, 'EVIDENCE_STALE_OR_UNKNOWN', `/evidence_references/${index}/staleness_state`);
      }
      if (!['human_reviewed', 'review_not_required'].includes(reference.review_state)) {
        releaseAdmissibilityFailed = true;
        add(errors, 'EVIDENCE_REVIEW_REQUIRED', `/evidence_references/${index}/review_state`);
      }
    });
    if (releaseAdmissibilityFailed) add(errors, 'EVIDENCE_NOT_RELEASE_ADMISSIBLE', '/evidence_references');
  }
}

function statusSignals(plan) {
  const reasons = [];
  if (plan.interpreted_need.boundary_state === 'outside_product_boundary') return { status: 'unsupported', reasonCodes: ['OUTSIDE_PRODUCT_BOUNDARY'] };

  const materialQuestions = plan.clarifications.questions.filter(question => question.required && !question.answered);
  if (plan.clarifications.state === 'open' || materialQuestions.length > 0) return { status: 'clarification_required', reasonCodes: ['MATERIAL_CLARIFICATION_REQUIRED'] };

  const essentialRoles = plan.interpreted_need.required_roles.filter(role => role.essential);
  const exactRoles = new Set(plan.asset_contributions.filter(contribution => contribution.selection_level === 'exact_distribution' && !['rejected', 'unavailable'].includes(contribution.recommendation_state)).map(contribution => contribution.role_id));
  if (plan.interpreted_need.boundary_state === 'unknown' || plan.interpreted_need.requested_period === null || plan.interpreted_need.requested_grain === null || plan.interpreted_need.geographies.length === 0) reasons.push('INTERPRETED_NEED_INCOMPLETE');
  if (essentialRoles.length === 0) reasons.push('ESSENTIAL_ROLE_UNRESOLVED');
  if (essentialRoles.some(role => !exactRoles.has(role.role_id))) reasons.push('ESSENTIAL_ROLE_UNRESOLVED');
  if (plan.asset_contributions.some(contribution => contribution.essential && contribution.selection_level !== 'exact_distribution')) reasons.push('EXACT_SELECTION_MISSING');
  if (plan.asset_contributions.some(contribution => contribution.essential && (['unknown', 'blocked', 'failed', 'not_assessed'].includes(contribution.access.payload_access_state) || contribution.access.access_class === 'unknown' || ['unknown', 'ambiguous'].includes(contribution.identity_context.resolution_state) || ['unknown', 'blocked'].includes(contribution.coverage.coverage_state)))) reasons.push('ESSENTIAL_CONTRIBUTION_UNRESOLVED');
  if (plan.operations.some(operation => operation.essential && (['incompatible', 'unknown'].includes(operation.compatibility) || operation.evidence_state === 'unknown' || operation.blockers.some(blocker => blocker.state === 'open' && blocker.fatal)))) reasons.push('ESSENTIAL_OPERATION_BLOCKED');
  if (plan.unresolved_gaps.some(gap => gap.severity === 'blocking') || plan.conditions_not_recommend.some(condition => condition.severity === 'blocking')) reasons.push('BLOCKING_GAP_UNRESOLVED');
  if (exactRoles.size > 0 && !plan.acquisition_plan.complete) reasons.push('ACQUISITION_DAG_INCOMPLETE');
  if (['ready', 'ready_with_constraints'].includes(plan.plan_status)) {
    const recommendationEvidence = plan.evidence_references.filter(reference => reference.claim_pointers.some(pointer => RECOMMENDATION_ROOTS.some(root => pointerCovers(pointer, root))));
    if (recommendationEvidence.some(reference => reference.admissibility_state !== 'admissible' || reference.staleness_state !== 'current' || !['human_reviewed', 'review_not_required'].includes(reference.review_state))) reasons.push('EVIDENCE_NOT_RELEASE_ADMISSIBLE');
  }
  if (reasons.length > 0) return { status: 'incomplete', reasonCodes: reasons };

  const constraints = [];
  if (plan.asset_contributions.some(contribution => contribution.access.human_gates.some(gate => gate.required && gate.state !== 'not_applicable'))) constraints.push('EXTERNAL_HUMAN_GATE_REQUIRED');
  if (plan.bundle_assessment.compatibility === 'conditional' || plan.asset_contributions.some(contribution => contribution.recommendation_state === 'conditional' || contribution.identity_context.resolution_state === 'candidate') || plan.operations.some(operation => operation.compatibility === 'conditional' || operation.evidence_state === 'candidate' || operation.identity_context.resolution_state === 'candidate')) constraints.push('CONDITIONAL_COMPATIBILITY');
  if (plan.bundle_assessment.common_supported_coverage?.coverage_state !== 'supported' || plan.asset_contributions.some(contribution => ['partial', 'conditional'].includes(contribution.coverage.coverage_state)) || plan.bundle_assessment.constraints.some(constraint => constraint.code === 'BOUNDED_COVERAGE')) constraints.push('BOUNDED_COVERAGE_LIMITATION');
  if (plan.operations.some(operation => operation.requirements.some(requirement => !['satisfied', 'not_applicable'].includes(requirement.state)) || operation.blockers.some(blocker => blocker.state === 'open' && !blocker.fatal)) || plan.important_limitations.some(limitation => limitation.severity === 'warning')) constraints.push('NON_FATAL_PREREQUISITE');
  if (constraints.length > 0) return { status: 'ready_with_constraints', reasonCodes: [...new Set(constraints)] };
  return { status: 'ready', reasonCodes: ['MINIMAL_DEFENSIBLE_BUNDLE_READY'] };
}

export function derivePlanStatus(plan) {
  return statusSignals(plan);
}

function validateStatusAndParity(plan, errors) {
  const derived = statusSignals(plan);
  if (plan.plan_status !== derived.status) add(errors, 'PLAN_STATUS_PRECEDENCE_MISMATCH', '/plan_status', `expected ${derived.status}`);
  if (!same(plan.plan_status_reason_codes, derived.reasonCodes)) add(errors, 'PLAN_STATUS_REASON_CODES_MISMATCH', '/plan_status_reason_codes', `expected ${derived.reasonCodes.join(',')}`);
  const confidenceByStatus = {
    unsupported: 'none',
    clarification_required: 'none',
    incomplete: 'partial',
    ready_with_constraints: 'constrained',
    ready: 'confident'
  };
  if (plan.response.recommendation_confidence !== confidenceByStatus[plan.plan_status]) add(errors, 'RECOMMENDATION_CONFIDENCE_OVERCLAIM', '/response/recommendation_confidence');
  if (['unsupported', 'clarification_required'].includes(plan.plan_status) && plan.asset_contributions.some(contribution => ['essential', 'supporting'].includes(contribution.recommendation_state))) add(errors, 'CONFIDENT_RECOMMENDATION_FORBIDDEN', '/asset_contributions');
  const projection = criticalClaimProjection(plan);
  if (!same(plan.response.critical_claim_projection, projection)) add(errors, 'HUMAN_JSON_CRITICAL_CLAIM_DRIFT', '/response/critical_claim_projection');
  if (plan.response.critical_claim_digest !== criticalClaimDigest(plan)) add(errors, 'CRITICAL_CLAIM_DIGEST_MISMATCH', '/response/critical_claim_digest');
  if (!same(plan.response.critical_claim_projection.truth_boundary, plan.truth_boundary)) add(errors, 'TRUTH_BOUNDARY_PARITY_MISMATCH', '/response/critical_claim_projection/truth_boundary');
}

function validateClaimManifest(claimManifest, errors) {
  const expectedRoots = ['/interpreted_need', '/asset_contributions', '/bundle_assessment', '/operations', '/acquisition_plan', '/downstream_handoff', '/important_limitations', '/unresolved_gaps', '/conditions_not_recommend'];
  for (const root of expectedRoots) if (!claimManifest.auditable_roots.includes(root)) add(errors, 'CLAIM_MANIFEST_AUDITABLE_ROOT_MISSING', '/claim-manifest/auditable_roots', root);
  const critical = new Set(claimManifest.critical_claims.map(claim => claim.json_pointer));
  for (const pointer of ['/plan_status', '/plan_status_reason_codes', '/interpreted_need/required_roles', '/asset_contributions', '/bundle_assessment/requested_coverage', '/bundle_assessment/source_supported_coverage', '/bundle_assessment/common_supported_coverage', '/operations', '/downstream_handoff', '/truth_boundary']) {
    if (!critical.has(pointer)) add(errors, 'CLAIM_MANIFEST_CRITICAL_POINTER_MISSING', '/claim-manifest/critical_claims', pointer);
  }
  if (!unique(claimManifest.critical_claims.map(claim => claim.claim_id))) add(errors, 'CLAIM_MANIFEST_DUPLICATE_ID', '/claim-manifest/critical_claims');
}

export function validateResearchPlan(plan, { claimManifest }) {
  const errors = [];
  validateClaimManifest(claimManifest, errors);
  scanForbidden(plan, '', errors);
  if (plan.plan_id !== planDigest(plan)) add(errors, 'PLAN_DIGEST_MISMATCH', '/plan_id');
  const fingerprint = structuredClone(plan.generated_from.planner_fingerprint);
  const fingerprintId = fingerprint.planner_fingerprint_id;
  delete fingerprint.planner_fingerprint_id;
  if (fingerprintId !== canonicalDigest(fingerprint)) add(errors, 'PLANNER_FINGERPRINT_MISMATCH', '/generated_from/planner_fingerprint/planner_fingerprint_id');
  if (plan.generated_from.planner_fingerprint.claim_manifest_digest !== canonicalDigest(claimManifest)) add(errors, 'CLAIM_MANIFEST_DIGEST_MISMATCH', '/generated_from/planner_fingerprint/claim_manifest_digest');
  validateExactSelections(plan, errors);
  validatePeriods(plan, errors);
  validateOperations(plan, errors);
  validateAcquisition(plan, errors);
  validateDownstream(plan, errors);
  validateEvidence(plan, claimManifest, errors);
  if (plan.clarifications.question_set_hash !== clarificationQuestionSetDigest(plan.clarifications.questions)) add(errors, 'CLARIFICATION_QUESTION_SET_HASH_MISMATCH', '/clarifications/question_set_hash');
  const questionIdList = plan.clarifications.questions.map(question => question.question_id);
  const questionIds = new Set(questionIdList);
  if (!unique(questionIdList)) add(errors, 'CLARIFICATION_QUESTION_DUPLICATE', '/clarifications/questions');
  const answerIds = plan.clarifications.answers.map(answer => answer.question_id);
  if (!unique(answerIds)) add(errors, 'CLARIFICATION_ANSWER_DUPLICATE', '/clarifications/answers');
  for (const answerId of answerIds) if (!questionIds.has(answerId)) add(errors, 'CLARIFICATION_ANSWER_UNKNOWN_QUESTION', '/clarifications/answers', answerId);
  const answersByQuestion = new Map(plan.clarifications.answers.map(answer => [answer.question_id, answer]));
  plan.clarifications.questions.forEach((question, index) => {
    const root = `/clarifications/questions/${index}`;
    const answer = answersByQuestion.get(question.question_id);
    if (['single_choice', 'multi_choice'].includes(question.answer_kind) && question.options.length < 2) add(errors, 'CLARIFICATION_CHOICE_OPTIONS_INSUFFICIENT', `${root}/options`);
    if (!['single_choice', 'multi_choice'].includes(question.answer_kind) && question.options.length > 0) add(errors, 'CLARIFICATION_NON_CHOICE_HAS_OPTIONS', `${root}/options`);
    if (!answer) return;
    if (question.answer_kind === 'single_choice' && answer.values.length !== 1) add(errors, 'CLARIFICATION_SINGLE_CHOICE_CARDINALITY', '/clarifications/answers');
    if (['single_choice', 'multi_choice'].includes(question.answer_kind)) {
      const allowed = new Set(question.options.map(option => option.value));
      if (answer.values.some(value => !allowed.has(value))) add(errors, 'CLARIFICATION_CHOICE_VALUE_UNKNOWN', '/clarifications/answers');
    }
    if (question.answer_kind === 'boolean' && (answer.values.length !== 1 || !['true', 'false'].includes(answer.values[0]))) add(errors, 'CLARIFICATION_BOOLEAN_INVALID', '/clarifications/answers');
    if (question.answer_kind === 'date' && (answer.values.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(answer.values[0]) || Number.isNaN(Date.parse(`${answer.values[0]}T00:00:00Z`)))) add(errors, 'CLARIFICATION_DATE_INVALID', '/clarifications/answers');
  });
  if (plan.clarifications.state === 'answered' && plan.clarifications.questions.some(question => question.required && (!question.answered || !answerIds.includes(question.question_id)))) add(errors, 'CLARIFICATION_REQUIRED_ANSWER_MISSING', '/clarifications');
  if (plan.clarifications.state === 'answered' && plan.clarifications.prior_plan_id === null) add(errors, 'CLARIFICATION_PRIOR_PLAN_MISSING', '/clarifications/prior_plan_id');
  if (plan.clarifications.state === 'not_required' && (plan.clarifications.questions.length > 0 || plan.clarifications.answers.length > 0)) add(errors, 'CLARIFICATION_NOT_REQUIRED_HAS_CONTENT', '/clarifications');
  validateStatusAndParity(plan, errors);
  return errors;
}

export function finalizePlan(plan, claimManifest) {
  const copy = structuredClone(plan);
  copy.generated_from.planner_fingerprint.claim_manifest_digest = canonicalDigest(claimManifest);
  const fingerprint = structuredClone(copy.generated_from.planner_fingerprint);
  delete fingerprint.planner_fingerprint_id;
  copy.generated_from.planner_fingerprint.planner_fingerprint_id = canonicalDigest(fingerprint);
  const derived = derivePlanStatus(copy);
  copy.plan_status = derived.status;
  copy.plan_status_reason_codes = derived.reasonCodes;
  copy.response.recommendation_confidence = {
    unsupported: 'none', clarification_required: 'none', incomplete: 'partial', ready_with_constraints: 'constrained', ready: 'confident'
  }[copy.plan_status];
  copy.response.critical_claim_projection = criticalClaimProjection(copy);
  copy.response.critical_claim_digest = criticalClaimDigest(copy);
  copy.plan_id = planDigest(copy);
  return copy;
}

export const PLAN_STATUS_PRECEDENCE = Object.freeze([...STATUS_ORDER]);
