import { compareCanonical, unique } from './common.mjs';

const REQUIRED_REBUILD_TARGETS = [
  'aliases',
  'identity_clusters',
  'join_views',
  'plan_fixtures',
  'search_projections'
];

const FUZZY_FEATURES = new Set([
  'locator_similarity',
  'title_similarity',
  'publisher_similarity',
  'description_similarity',
  'url_similarity',
  'embedding_similarity',
  'semantic_similarity'
]);

const DOCUMENTED_EVIDENCE = new Set(['source_documentation', 'schema_snapshot', 'authoritative_crosswalk']);
const EXECUTION_EVIDENCE = new Set(['controlled_test', 'external_execution']);

function add(errors, code, detail) {
  errors.push({ code, detail });
}

function mapBy(records, field, errors, label) {
  const map = new Map();
  for (const record of records) {
    const value = record[field];
    if (map.has(value)) add(errors, 'DUPLICATE_ID', `${label}:${value}`);
    else map.set(value, record);
  }
  return map;
}

function validCompleteInterval(interval) {
  return interval?.completeness === 'complete' && interval.start !== null && interval.end !== null && interval.start < interval.end;
}

function intervalsOverlap(left, right) {
  if (!validCompleteInterval(left) || !validCompleteInterval(right)) return false;
  return left.start < right.end && right.start < left.end;
}

function intervalContains(interval, date) {
  if (!interval || interval.start === null || interval.end === null) return false;
  const afterStart = interval.bounds.startsWith('[') ? date >= interval.start : date > interval.start;
  const beforeEnd = interval.bounds.endsWith(']') ? date <= interval.end : date < interval.end;
  return afterStart && beforeEnd;
}

function validateInterval(interval, label, errors) {
  if (interval.completeness === 'complete' && (interval.start === null || interval.end === null)) add(errors, 'COMPLETE_INTERVAL_MISSING_BOUND', label);
  if (interval.completeness === 'open_start' && (interval.start !== null || interval.end === null)) add(errors, 'OPEN_START_INTERVAL_INVALID', label);
  if (interval.completeness === 'open_end' && (interval.start === null || interval.end !== null)) add(errors, 'OPEN_END_INTERVAL_INVALID', label);
  if (interval.completeness === 'unknown' && (interval.start !== null || interval.end !== null)) add(errors, 'UNKNOWN_INTERVAL_HAS_BOUND', label);
  if (interval.start !== null && interval.end !== null && interval.start >= interval.end) add(errors, 'INTERVAL_NOT_FORWARD', label);
}

function detectSupersessionCycles(records, idField, nextField, label, errors) {
  const byId = new Map(records.map(record => [record[idField], record]));
  for (const record of records) {
    const seen = new Set();
    let cursor = record;
    while (cursor?.[nextField]) {
      if (seen.has(cursor[idField])) {
        add(errors, 'SUPERSESSION_CYCLE', `${label}:${record[idField]}`);
        break;
      }
      seen.add(cursor[idField]);
      cursor = byId.get(cursor[nextField]);
    }
  }
}

function validateSupersessionPair(records, idField, olderField, newerField, stateField, _currentState, supersededState, label, errors, requireSuccessor = true) {
  const byId = new Map(records.map(record => [record[idField], record]));
  for (const record of records) {
    const older = record[olderField];
    const newer = record[newerField];
    if (record[stateField] !== supersededState && newer !== null) add(errors, 'CURRENT_RECORD_HAS_SUCCESSOR', `${label}:${record[idField]}`);
    if (requireSuccessor && record[stateField] === supersededState && newer === null) add(errors, 'SUPERSEDED_RECORD_MISSING_SUCCESSOR', `${label}:${record[idField]}`);
    if (older !== null) {
      const prior = byId.get(older);
      if (!prior) add(errors, 'UNKNOWN_SUPERSEDED_REFERENCE', `${label}:${record[idField]}:${older}`);
      else if (prior[newerField] !== record[idField]) add(errors, 'SUPERSESSION_LINK_NOT_RECIPROCAL', `${label}:${record[idField]}:${older}`);
    }
    if (newer !== null) {
      const next = byId.get(newer);
      if (!next) add(errors, 'UNKNOWN_SUCCESSOR_REFERENCE', `${label}:${record[idField]}:${newer}`);
      else if (next[olderField] !== record[idField]) add(errors, 'SUPERSESSION_LINK_NOT_RECIPROCAL', `${label}:${record[idField]}:${newer}`);
    }
  }
  detectSupersessionCycles(records, idField, olderField, label, errors);
}

function validateNamespace(namespace, errors) {
  const orders = namespace.normalization_steps.map(step => step.order);
  if (!compareCanonical(orders, orders.map((_, index) => index + 1))) add(errors, 'NAMESPACE_NORMALIZATION_ORDER_INVALID', namespace.namespace_id);
  if (namespace.scope.kind === 'source_local' && namespace.scope.source_id === null) add(errors, 'SOURCE_LOCAL_NAMESPACE_MISSING_SOURCE', namespace.namespace_id);
  if (namespace.scope.kind === 'cross_source_authoritative' && namespace.scope.source_id !== null) add(errors, 'CROSS_SOURCE_NAMESPACE_HAS_SOURCE_SCOPE', namespace.namespace_id);
  if (namespace.check_rule.kind === 'none' && namespace.check_rule.expression !== null) add(errors, 'NONE_CHECK_RULE_HAS_EXPRESSION', namespace.namespace_id);
  if (namespace.check_rule.kind !== 'none' && namespace.check_rule.expression === null) add(errors, 'CHECK_RULE_EXPRESSION_MISSING', namespace.namespace_id);
  const gate = namespace.benchmark_gate;
  if (gate.state === 'enabled') {
    if (gate.sealed_benchmark_id === null || gate.enablement_receipt_id === null) add(errors, 'AUTO_RULE_ENABLEMENT_RECEIPT_MISSING', namespace.namespace_id);
    if (gate.adjudicated_positive_pairs < 50) add(errors, 'AUTO_RULE_POSITIVE_FLOOR_NOT_MET', namespace.namespace_id);
    if (gate.hard_negative_pairs < 50) add(errors, 'AUTO_RULE_NEGATIVE_FLOOR_NOT_MET', namespace.namespace_id);
    if (gate.temporal_reuse_conflict_cases < 20) add(errors, 'AUTO_RULE_TEMPORAL_FLOOR_NOT_MET', namespace.namespace_id);
    if (gate.false_automatic_merges !== 0) add(errors, 'AUTO_RULE_FALSE_MERGE_GATE_FAILED', namespace.namespace_id);
    if (gate.candidate_recall === null || gate.candidate_recall < 0.95) add(errors, 'AUTO_RULE_RECALL_GATE_FAILED', namespace.namespace_id);
    if (namespace.uniqueness_policy !== 'unique_within_effective_period') add(errors, 'AUTO_RULE_NAMESPACE_NOT_UNIQUE', namespace.namespace_id);
    if (namespace.reuse_policy === 'unknown') add(errors, 'AUTO_RULE_REUSE_POLICY_UNKNOWN', namespace.namespace_id);
  } else if (gate.enablement_receipt_id !== null) {
    add(errors, 'DISABLED_RULE_HAS_ENABLEMENT_RECEIPT', namespace.namespace_id);
  }
}

function validateAssertion(assertion, namespaces, errors) {
  const namespace = namespaces.get(assertion.namespace_id);
  if (!namespace) {
    add(errors, 'UNKNOWN_NAMESPACE', assertion.assertion_id);
    return;
  }
  if (!namespace.entity_types.includes(assertion.entity_type)) add(errors, 'ASSERTION_ENTITY_OUTSIDE_NAMESPACE', assertion.assertion_id);
  if (!namespace.grains.includes(assertion.grain)) add(errors, 'ASSERTION_GRAIN_OUTSIDE_NAMESPACE', assertion.assertion_id);
  if (namespace.scope.kind === 'source_local' && assertion.source_id !== namespace.scope.source_id) add(errors, 'ASSERTION_SOURCE_OUTSIDE_NAMESPACE', assertion.assertion_id);
  validateInterval(assertion.effective_interval, assertion.assertion_id, errors);
  if (assertion.observed_at > assertion.recorded_at) add(errors, 'ASSERTION_RECORDED_BEFORE_OBSERVED', assertion.assertion_id);
}

function validateAutomaticCandidate(candidate, assertions, namespaces, allAssertions, errors) {
  if (candidate.candidate_type !== 'same_identity') add(errors, 'AUTOMATIC_NON_IDENTITY', candidate.candidate_id);
  if (candidate.state !== 'accepted') add(errors, 'AUTOMATIC_CANDIDATE_NOT_ACCEPTED', candidate.candidate_id);
  const featureKinds = candidate.features.map(feature => feature.feature_kind);
  if (!featureKinds.includes('exact_identifier')) add(errors, 'AUTOMATIC_WITHOUT_EXACT_IDENTIFIER', candidate.candidate_id);
  if (featureKinds.some(kind => FUZZY_FEATURES.has(kind))) add(errors, 'AUTOMATIC_FUZZY_EVIDENCE', candidate.candidate_id);
  if (candidate.conflicting_assertion_ids.length > 0) add(errors, 'AUTOMATIC_CONFLICTING_ASSERTION', candidate.candidate_id);
  if (candidate.supporting_assertion_ids.length !== 2) {
    add(errors, 'AUTOMATIC_ASSERTION_PAIR_REQUIRED', candidate.candidate_id);
    return;
  }
  const pair = candidate.supporting_assertion_ids.map(id => assertions.get(id));
  if (pair.some(assertion => !assertion)) {
    add(errors, 'AUTOMATIC_ASSERTION_UNKNOWN', candidate.candidate_id);
    return;
  }
  const [left, right] = pair;
  const candidateObjects = [candidate.object_a_id, candidate.object_b_id].sort();
  if (!compareCanonical([left.object_id, right.object_id].sort(), candidateObjects)) add(errors, 'AUTOMATIC_ASSERTION_OBJECT_MISMATCH', candidate.candidate_id);
  if (left.namespace_id !== right.namespace_id) add(errors, 'EXACT_NAMESPACE_MISMATCH', candidate.candidate_id);
  if (left.normalized_value !== right.normalized_value) add(errors, 'EXACT_VALUE_MISMATCH', candidate.candidate_id);
  if (!left.check_passed || !right.check_passed) add(errors, 'EXACT_CHECK_FAILED', candidate.candidate_id);
  if (left.authority_class !== 'authoritative' || right.authority_class !== 'authoritative') add(errors, 'EXACT_ASSERTION_NOT_AUTHORITATIVE', candidate.candidate_id);
  if (left.entity_type !== right.entity_type) add(errors, 'EXACT_ENTITY_CONFLICT', candidate.candidate_id);
  if (left.grain !== right.grain) add(errors, 'EXACT_GRAIN_CONFLICT', candidate.candidate_id);
  if (!validCompleteInterval(left.effective_interval) || !validCompleteInterval(right.effective_interval)) add(errors, 'EXACT_EFFECTIVE_PERIOD_INCOMPLETE', candidate.candidate_id);
  else if (!intervalsOverlap(left.effective_interval, right.effective_interval)) add(errors, 'EXACT_PERIODS_DO_NOT_OVERLAP', candidate.candidate_id);
  const namespace = namespaces.get(left.namespace_id);
  if (!namespace || namespace.benchmark_gate.state !== 'enabled') add(errors, 'AUTO_RULE_NOT_ENABLED', candidate.candidate_id);
  if (namespace?.scope.kind === 'source_local' && left.source_id !== right.source_id) add(errors, 'SOURCE_NATIVE_ID_CROSS_SOURCE', candidate.candidate_id);
  if (namespace && (!namespace.entity_types.includes(left.entity_type) || !namespace.grains.includes(left.grain))) add(errors, 'EXACT_SCOPE_INCOMPATIBLE', candidate.candidate_id);
  const objectIds = new Set([left.object_id, right.object_id]);
  const conflicting = allAssertions.filter(assertion =>
    objectIds.has(assertion.object_id)
      && assertion.assertion_id !== left.assertion_id
      && assertion.assertion_id !== right.assertion_id
      && assertion.namespace_id === left.namespace_id
      && assertion.authority_class === 'authoritative'
      && assertion.state === 'active'
      && assertion.normalized_value !== left.normalized_value
      && (intervalsOverlap(assertion.effective_interval, left.effective_interval) || intervalsOverlap(assertion.effective_interval, right.effective_interval))
  );
  if (conflicting.length > 0) add(errors, 'CONFLICTING_AUTHORITATIVE_IDENTIFIER', `${candidate.candidate_id}:${conflicting.map(item => item.assertion_id).join(',')}`);
}

function validateCandidate(candidate, assertions, namespaces, allAssertions, errors) {
  if (candidate.object_a_id >= candidate.object_b_id) add(errors, 'CANDIDATE_PAIR_NOT_CANONICALLY_ORDERED', candidate.candidate_id);
  if (!unique(candidate.features.map(feature => feature.feature_kind))) add(errors, 'DUPLICATE_CANDIDATE_FEATURE', candidate.candidate_id);
  for (const id of [...candidate.supporting_assertion_ids, ...candidate.conflicting_assertion_ids]) if (!assertions.has(id)) add(errors, 'UNKNOWN_CANDIDATE_ASSERTION', `${candidate.candidate_id}:${id}`);
  if (['accepted', 'rejected', 'deferred', 'superseded'].includes(candidate.state) && candidate.reviewed_at === null) add(errors, 'RESOLVED_CANDIDATE_MISSING_REVIEW_TIME', candidate.candidate_id);
  if (candidate.reviewed_at !== null && candidate.reviewed_at < candidate.created_at) add(errors, 'CANDIDATE_REVIEW_BEFORE_CREATION', candidate.candidate_id);
  if (candidate.resolution_mode === 'automatic_exact_policy') validateAutomaticCandidate(candidate, assertions, namespaces, allAssertions, errors);
  if (candidate.resolution_mode !== 'automatic_exact_policy' && candidate.features.some(feature => FUZZY_FEATURES.has(feature.feature_kind)) && candidate.resolution_mode === 'candidate_only') {
    // This is the intended conservative state; it remains a review candidate.
  }
}

function expectedCandidateState(decision) {
  if (['same_identity', 'family_member', 'mirror_of', 'successor_of'].includes(decision)) return 'accepted';
  if (decision === 'not_same_identity') return 'rejected';
  if (decision === 'defer') return 'deferred';
  return 'open';
}

function validateDecision(decision, candidates, decisions, errors) {
  const candidate = candidates.get(decision.candidate_id);
  if (!candidate) {
    add(errors, 'UNKNOWN_DECISION_CANDIDATE', decision.decision_id);
    return;
  }
  if (decision.decided_at > decision.recorded_at) add(errors, 'DECISION_RECORDED_BEFORE_DECIDED', decision.decision_id);
  if (decision.state === 'current') {
    const expected = expectedCandidateState(decision.decision);
    if (candidate.state !== expected) add(errors, 'DECISION_CANDIDATE_STATE_MISMATCH', `${decision.decision_id}:${candidate.state}:${expected}`);
  }
  if (decision.decision === 'same_identity' && candidate.candidate_type !== 'same_identity') add(errors, 'IDENTITY_DECISION_ON_FAMILY_CANDIDATE', decision.decision_id);
  if (['family_member', 'mirror_of', 'successor_of'].includes(decision.decision) && candidate.candidate_type === 'same_identity') add(errors, 'FAMILY_DECISION_ON_IDENTITY_CANDIDATE', decision.decision_id);
  if (decision.supersedes_decision_id !== null) {
    const prior = decisions.get(decision.supersedes_decision_id);
    if (prior && prior.candidate_id !== decision.candidate_id) add(errors, 'DECISION_SUPERSEDES_OTHER_CANDIDATE', decision.decision_id);
    if (prior && prior.recorded_at >= decision.recorded_at) add(errors, 'DECISION_SUPERSESSION_TIME_INVALID', decision.decision_id);
  }
}

function decisionRelationship(decision) {
  if (decision === 'same_identity') return 'same_identity';
  if (decision === 'family_member') return 'family_member';
  if (decision === 'mirror_of') return 'mirror_of';
  if (decision === 'successor_of') return 'successor_of';
  return null;
}

function validateProjection(projection, decisions, candidates, errors) {
  if (projection.object_a_id >= projection.object_b_id) add(errors, 'PROJECTION_PAIR_NOT_CANONICALLY_ORDERED', projection.projection_id);
  if (projection.graph_kind === 'identity' && projection.relationship_type !== 'same_identity') add(errors, 'NON_IDENTITY_EDGE_IN_IDENTITY_GRAPH', projection.projection_id);
  if (projection.graph_kind === 'family' && projection.relationship_type === 'same_identity') add(errors, 'IDENTITY_EDGE_IN_FAMILY_GRAPH', projection.projection_id);
  validateInterval(projection.effective_interval, projection.projection_id, errors);
  if (projection.basis.kind === 'review_decision') {
    const decision = decisions.get(projection.basis.reference_id);
    if (!decision) add(errors, 'UNKNOWN_PROJECTION_DECISION', projection.projection_id);
    else {
      if (decisionRelationship(decision.decision) !== projection.relationship_type) add(errors, 'PROJECTION_DECISION_TYPE_MISMATCH', projection.projection_id);
      if (projection.state === 'active' && decision.state !== 'current') add(errors, 'ACTIVE_PROJECTION_FROM_SUPERSEDED_DECISION', projection.projection_id);
      const candidate = candidates.get(decision.candidate_id);
      if (candidate && !compareCanonical([projection.object_a_id, projection.object_b_id].sort(), [candidate.object_a_id, candidate.object_b_id].sort())) add(errors, 'PROJECTION_CANDIDATE_PAIR_MISMATCH', projection.projection_id);
    }
  } else {
    const candidate = candidates.get(projection.basis.reference_id);
    if (!candidate) add(errors, 'UNKNOWN_PROJECTION_EXACT_POLICY', projection.projection_id);
    else {
      if (candidate.resolution_mode !== 'automatic_exact_policy' || candidate.state !== 'accepted' || projection.relationship_type !== 'same_identity') add(errors, 'PROJECTION_EXACT_POLICY_NOT_ACCEPTED', projection.projection_id);
      if (!compareCanonical([projection.object_a_id, projection.object_b_id].sort(), [candidate.object_a_id, candidate.object_b_id].sort())) add(errors, 'PROJECTION_CANDIDATE_PAIR_MISMATCH', projection.projection_id);
    }
  }
}

function validateMembership(membership, families, decisions, candidates, errors) {
  if (!families.has(membership.family_id)) add(errors, 'UNKNOWN_MEMBERSHIP_FAMILY', membership.membership_id);
  if (membership.basis.kind === 'review_decision') {
    const decision = decisions.get(membership.basis.reference_id);
    if (!decision) add(errors, 'UNKNOWN_MEMBERSHIP_DECISION', membership.membership_id);
    else {
      const projected = decisionRelationship(decision.decision);
      const genericFamilyMembership = decision.decision === 'family_member' && ['family_member', 'version_of', 'format_variant_of', 'collection_member'].includes(membership.relationship_type);
      if (projected !== membership.relationship_type && !genericFamilyMembership) add(errors, 'MEMBERSHIP_DECISION_TYPE_MISMATCH', membership.membership_id);
    }
  } else if (membership.basis.kind === 'candidate') {
    const candidate = candidates.get(membership.basis.reference_id);
    if (!candidate) add(errors, 'UNKNOWN_MEMBERSHIP_CANDIDATE', membership.membership_id);
    if (membership.resolution_state === 'accepted') add(errors, 'ACCEPTED_MEMBERSHIP_FROM_CANDIDATE', membership.membership_id);
  }
  validateInterval(membership.effective_interval, membership.membership_id, errors);
}

function expectedReadiness(step) {
  if (step.blockers.some(blocker => blocker.state === 'open')) return 'blocked';
  const requirementsReady = step.requirements.every(requirement => ['satisfied', 'not_applicable'].includes(requirement.state));
  const evidenceReady = ['documented', 'observed', 'executed', 'proven'].includes(step.evidence_state);
  if (step.compatibility === 'compatible' && requirementsReady && evidenceReady) return 'ready';
  return 'unknown';
}

function validateStep(step, errors) {
  const evidenceClasses = new Set(step.evidence.map(item => item.evidence_class));
  if (!unique(step.evidence.map(item => item.evidence_id))) add(errors, 'DUPLICATE_STEP_EVIDENCE', step.step_id);
  if (!unique(step.requirements.map(item => item.requirement_id))) add(errors, 'DUPLICATE_STEP_REQUIREMENT', step.step_id);
  if (!unique(step.blockers.map(item => item.blocker_id))) add(errors, 'DUPLICATE_STEP_BLOCKER', step.step_id);
  if (step.evidence_state === 'unknown' && step.evidence.length > 0) add(errors, 'UNKNOWN_STATE_HAS_EVIDENCE', step.step_id);
  if (step.evidence_state === 'candidate' && step.evidence.length === 0) add(errors, 'CANDIDATE_STATE_MISSING_EVIDENCE', step.step_id);
  if (step.evidence_state === 'ambiguous' && step.evidence.length < 2) add(errors, 'AMBIGUOUS_STATE_NEEDS_CONFLICTING_EVIDENCE', step.step_id);
  if (step.evidence_state === 'documented' && ![...evidenceClasses].some(kind => DOCUMENTED_EVIDENCE.has(kind))) add(errors, 'DOCUMENTED_ROUTE_EVIDENCE_INSUFFICIENT', step.step_id);
  if (step.evidence_state === 'observed' && !evidenceClasses.has('observation')) add(errors, 'OBSERVED_ROUTE_EVIDENCE_INSUFFICIENT', step.step_id);
  if (['executed', 'proven'].includes(step.evidence_state)) {
    if (![...evidenceClasses].some(kind => EXECUTION_EVIDENCE.has(kind))) add(errors, 'EXECUTION_EVIDENCE_INSUFFICIENT', step.step_id);
    if (step.execution_context === null) add(errors, 'EXECUTION_CONTEXT_MISSING', step.step_id);
    else if (!evidenceClasses.has(step.execution_context.kind === 'controlled_test' ? 'controlled_test' : 'external_execution')) add(errors, 'EXECUTION_CONTEXT_EVIDENCE_MISMATCH', step.step_id);
  } else if (step.execution_context !== null) add(errors, 'NON_EXECUTED_STEP_HAS_EXECUTION_CONTEXT', step.step_id);
  if (['join', 'crosswalk'].includes(step.operation_kind) && step.identifier_namespace_id === null) add(errors, 'IDENTIFIER_OPERATION_NAMESPACE_MISSING', step.step_id);
  for (const requirement of step.requirements) {
    if (requirement.state === 'satisfied' && requirement.satisfied_by_step_id === null) add(errors, 'SATISFIED_REQUIREMENT_MISSING_STEP', requirement.requirement_id);
    if (requirement.state !== 'satisfied' && requirement.satisfied_by_step_id !== null) add(errors, 'UNSATISFIED_REQUIREMENT_HAS_STEP', requirement.requirement_id);
  }
  if (step.requirements.some(requirement => ['unsatisfied', 'unknown'].includes(requirement.state)) && !step.blockers.some(blocker => blocker.state === 'open')) add(errors, 'UNRESOLVED_REQUIREMENT_MISSING_BLOCKER', step.step_id);
  if (step.compatibility === 'incompatible' && !step.blockers.some(blocker => blocker.state === 'open')) add(errors, 'INCOMPATIBLE_STEP_MISSING_BLOCKER', step.step_id);
  const derived = expectedReadiness(step);
  if (step.derived_readiness !== derived) add(errors, 'DERIVED_READINESS_MISMATCH', `${step.step_id}:${step.derived_readiness}:${derived}`);
}

function validateRoute(route, steps, assertions, errors) {
  validateInterval(route.applicability, route.route_id, errors);
  if (!intervalContains(route.applicability, route.identity_context.valid_at)) add(errors, 'CURRENT_IDENTITY_USED_HISTORICALLY', route.route_id);
  for (const assertionId of route.identity_context.assertion_ids) {
    const assertion = assertions.get(assertionId);
    if (!assertion) add(errors, 'UNKNOWN_ROUTE_IDENTITY_ASSERTION', `${route.route_id}:${assertionId}`);
    else {
      if (assertion.state !== 'active') add(errors, 'ROUTE_IDENTITY_ASSERTION_NOT_ACTIVE', `${route.route_id}:${assertionId}`);
      if (!intervalContains(assertion.effective_interval, route.identity_context.valid_at)) add(errors, 'ROUTE_IDENTITY_ASSERTION_OUTSIDE_VALID_TIME', `${route.route_id}:${assertionId}`);
    }
  }
  const routeSteps = route.step_ids.map(id => steps.get(id));
  for (let index = 0; index < routeSteps.length; index += 1) {
    const step = routeSteps[index];
    if (!step) {
      add(errors, 'UNKNOWN_ROUTE_STEP', `${route.route_id}:${route.step_ids[index]}`);
      continue;
    }
    if (step.route_id !== route.route_id) add(errors, 'STEP_ROUTE_MISMATCH', `${route.route_id}:${step.step_id}`);
    if (step.sequence !== index + 1) add(errors, 'ROUTE_STEP_SEQUENCE_INVALID', `${route.route_id}:${step.step_id}`);
  }
  if (routeSteps[0] && !routeSteps[0].source_field_ids.includes(route.source_endpoint.schema_field_id)) add(errors, 'ROUTE_SOURCE_FIELD_NOT_BOUND', route.route_id);
  if (routeSteps.at(-1) && !routeSteps.at(-1).target_field_ids.includes(route.target_endpoint.schema_field_id)) add(errors, 'ROUTE_TARGET_FIELD_NOT_BOUND', route.route_id);
}

function validateRequirements(steps, errors) {
  const expectedKinds = {
    crosswalk: new Set(['crosswalk']),
    aggregation: new Set(['aggregate']),
    normalization: new Set(['filter', 'measure_harmonization']),
    temporal_alignment: new Set(['temporal_alignment']),
    measure_harmonization: new Set(['measure_harmonization'])
  };
  for (const step of steps.values()) {
    for (const requirement of step.requirements) {
      if (requirement.state !== 'satisfied' || requirement.satisfied_by_step_id === null) continue;
      const satisfying = steps.get(requirement.satisfied_by_step_id);
      if (!satisfying) {
        add(errors, 'REQUIREMENT_SATISFYING_STEP_UNKNOWN', requirement.requirement_id);
        continue;
      }
      if (satisfying.route_id !== step.route_id) add(errors, 'REQUIREMENT_SATISFIED_BY_OTHER_ROUTE', requirement.requirement_id);
      const allowed = expectedKinds[requirement.requirement_kind];
      if (allowed && !allowed.has(satisfying.operation_kind)) {
        if (requirement.requirement_kind === 'crosswalk' && satisfying.operation_kind === 'aggregate') add(errors, 'CROSSWALK_SATISFIED_BY_AGGREGATION', requirement.requirement_id);
        else add(errors, 'REQUIREMENT_OPERATION_KIND_MISMATCH', requirement.requirement_id);
      }
    }
  }
}

function validateReversal(plan, decisions, candidates, projections, errors) {
  const newer = decisions.get(plan.superseding_decision_id);
  const older = decisions.get(plan.superseded_decision_id);
  const candidate = candidates.get(plan.candidate_id);
  if (!newer || !older || !candidate) {
    add(errors, 'REVERSAL_REFERENCE_UNKNOWN', plan.reversal_plan_id);
    return;
  }
  if (newer.supersedes_decision_id !== older.decision_id || older.superseded_by_decision_id !== newer.decision_id) add(errors, 'REVERSAL_DECISION_CHAIN_INVALID', plan.reversal_plan_id);
  if (newer.candidate_id !== plan.candidate_id || older.candidate_id !== plan.candidate_id) add(errors, 'REVERSAL_CANDIDATE_MISMATCH', plan.reversal_plan_id);
  if (!compareCanonical([...plan.rebuild_targets].sort(), REQUIRED_REBUILD_TARGETS)) add(errors, 'REVERSAL_REBUILD_TARGETS_INCOMPLETE', plan.reversal_plan_id);
  if (!compareCanonical([...plan.expected_retained_object_ids].sort(), [candidate.object_a_id, candidate.object_b_id].sort())) add(errors, 'REVERSAL_OBJECT_RETENTION_INCOMPLETE', plan.reversal_plan_id);
  if (plan.input_graph_revision_id === plan.output_graph_revision_id) add(errors, 'REVERSAL_GRAPH_REVISION_NOT_ADVANCED', plan.reversal_plan_id);
  for (const projectionId of plan.expected_removed_projection_ids) {
    const projection = projections.get(projectionId);
    if (!projection) add(errors, 'REVERSAL_REMOVED_PROJECTION_UNKNOWN', `${plan.reversal_plan_id}:${projectionId}`);
    else if (projection.basis.kind !== 'review_decision' || projection.basis.reference_id !== older.decision_id || projection.state !== 'superseded') add(errors, 'REVERSAL_REMOVED_PROJECTION_LINEAGE_INVALID', `${plan.reversal_plan_id}:${projectionId}`);
  }
}

export function validateIdentityBundle(bundle) {
  const errors = [];
  const namespaces = mapBy(bundle.namespaces, 'namespace_id', errors, 'namespace');
  const assertions = mapBy(bundle.identifier_assertions, 'assertion_id', errors, 'assertion');
  const candidates = mapBy(bundle.candidates, 'candidate_id', errors, 'candidate');
  const decisions = mapBy(bundle.review_decisions, 'decision_id', errors, 'decision');
  const projections = mapBy(bundle.relationship_projections, 'projection_id', errors, 'projection');
  const families = mapBy(bundle.families, 'family_id', errors, 'family');
  const memberships = mapBy(bundle.family_memberships, 'membership_id', errors, 'membership');
  const steps = mapBy(bundle.transformation_steps, 'step_id', errors, 'step');
  const routes = mapBy(bundle.join_routes, 'revision_id', errors, 'route-revision');
  const reversals = mapBy(bundle.reversal_plans, 'reversal_plan_id', errors, 'reversal');

  for (const namespace of namespaces.values()) validateNamespace(namespace, errors);
  for (const assertion of assertions.values()) validateAssertion(assertion, namespaces, errors);
  for (const candidate of candidates.values()) validateCandidate(candidate, assertions, namespaces, bundle.identifier_assertions, errors);
  for (const decision of decisions.values()) validateDecision(decision, candidates, decisions, errors);
  for (const projection of projections.values()) validateProjection(projection, decisions, candidates, errors);
  for (const membership of memberships.values()) validateMembership(membership, families, decisions, candidates, errors);
  for (const step of steps.values()) validateStep(step, errors);
  for (const route of routes.values()) validateRoute(route, steps, assertions, errors);
  validateRequirements(steps, errors);
  for (const reversal of reversals.values()) validateReversal(reversal, decisions, candidates, projections, errors);

  validateSupersessionPair(bundle.identifier_assertions, 'assertion_id', 'supersedes_assertion_id', 'superseded_by_assertion_id', 'state', 'active', 'superseded', 'identifier-assertion', errors);
  validateSupersessionPair(bundle.candidates, 'candidate_id', 'supersedes_candidate_id', 'superseded_by_candidate_id', 'state', 'open', 'superseded', 'candidate', errors);
  validateSupersessionPair(bundle.review_decisions, 'decision_id', 'supersedes_decision_id', 'superseded_by_decision_id', 'state', 'current', 'superseded', 'review-decision', errors);
  validateSupersessionPair(bundle.relationship_projections, 'projection_id', 'supersedes_projection_id', 'superseded_by_projection_id', 'state', 'active', 'superseded', 'relationship-projection', errors, false);
  validateSupersessionPair(bundle.family_memberships, 'membership_id', 'supersedes_membership_id', 'superseded_by_membership_id', 'state', 'active', 'superseded', 'family-membership', errors, false);
  validateSupersessionPair(bundle.join_routes, 'revision_id', 'supersedes_revision_id', 'superseded_by_revision_id', 'state', 'active', 'superseded', 'join-route-revision', errors, false);

  const currentDecisionCounts = new Map();
  for (const decision of bundle.review_decisions.filter(item => item.state === 'current')) currentDecisionCounts.set(decision.candidate_id, (currentDecisionCounts.get(decision.candidate_id) ?? 0) + 1);
  for (const [candidateId, count] of currentDecisionCounts) if (count > 1) add(errors, 'MULTIPLE_CURRENT_DECISIONS', candidateId);
  for (const candidate of bundle.candidates) {
    const count = currentDecisionCounts.get(candidate.candidate_id) ?? 0;
    if (candidate.resolution_mode === 'human_review' && candidate.state !== 'superseded' && count !== 1) add(errors, 'HUMAN_REVIEW_CURRENT_DECISION_REQUIRED', candidate.candidate_id);
    if (candidate.resolution_mode === 'human_review' && count === 1 && candidate.reviewed_at === null) add(errors, 'HUMAN_REVIEW_TIMESTAMP_REQUIRED', candidate.candidate_id);
    if (candidate.resolution_mode !== 'human_review' && count !== 0) add(errors, 'DECISION_ON_NON_REVIEW_CANDIDATE', candidate.candidate_id);
    if (candidate.state === 'accepted' && !['human_review', 'automatic_exact_policy'].includes(candidate.resolution_mode)) add(errors, 'ACCEPTED_CANDIDATE_WITHOUT_AUTHORIZED_RESOLUTION', candidate.candidate_id);
  }

  return errors;
}

export function stateCoverage(bundle) {
  const sort = values => [...new Set(values)].sort();
  return {
    candidate_states: sort(bundle.candidates.map(item => item.state)),
    decision_kinds: sort(bundle.review_decisions.map(item => item.decision)),
    family_kinds: sort(bundle.families.map(item => item.family_kind)),
    operation_kinds: sort(bundle.transformation_steps.map(item => item.operation_kind)),
    evidence_states: sort(bundle.transformation_steps.map(item => item.evidence_state)),
    compatibilities: sort(bundle.transformation_steps.map(item => item.compatibility)),
    requirement_states: sort(bundle.transformation_steps.flatMap(item => item.requirements.map(requirement => requirement.state)))
  };
}

export function applyAdversarialMutations(bundle, mutations) {
  const clone = structuredClone(bundle);
  for (const mutation of mutations) {
    const collection = clone[mutation.collection];
    if (!Array.isArray(collection)) throw new Error(`MUTATION_COLLECTION_UNKNOWN:${mutation.collection}`);
    const record = collection.find(item => item[mutation.id_field] === mutation.id);
    if (!record) throw new Error(`MUTATION_RECORD_UNKNOWN:${mutation.collection}:${mutation.id}`);
    const parts = mutation.path.split('.');
    let cursor = record;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = /^\d+$/.test(parts[index]) ? Number(parts[index]) : parts[index];
      cursor = cursor[part];
    }
    const final = /^\d+$/.test(parts.at(-1)) ? Number(parts.at(-1)) : parts.at(-1);
    if (mutation.operation === 'delete') delete cursor[final];
    else cursor[final] = structuredClone(mutation.value);
  }
  return clone;
}
