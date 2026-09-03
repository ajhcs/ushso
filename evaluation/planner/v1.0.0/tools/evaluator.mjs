import fs from 'node:fs/promises';
import path from 'node:path';
import { packagePaths, SAFETY_STRATA } from './benchmark-definition.mjs';
import { canonicalJson, deepEqual, sha256Id, uniqueSorted } from './common.mjs';

const AUDIT_KEYS = new Set([
  'audit_record_version', 'question_id', 'plan_status', 'reason_codes', 'dominant_reason_code',
  'precedence_valid', 'essential_role_ids', 'exact_selections', 'measure_bindings', 'coverage',
  'operations', 'requirement_ids', 'blocker_ids', 'acquisition_steps', 'clarification_question_ids',
  'schema_valid', 'auditable_claims', 'repeat_payload_equal', 'repeat_digest_equal',
  'critical_claim_parity', 'operation_graph_acyclic', 'acquisition_graph_acyclic', 'safety_violations'
]);

const atom = value => canonicalJson(value);
const setOf = values => new Set(values.map(atom));
const intersectionCount = (left, right) => [...left].filter(value => right.has(value)).length;
const unionCount = (left, right) => new Set([...left, ...right]).size;
const rate = ({ numerator, denominator }) => denominator === 0 ? null : numerator / denominator;

const selectionProjection = selection => ({
  asset_id: selection.asset_id,
  release_id: selection.release_id,
  distribution_id: selection.distribution_id,
  access_route_id: selection.access_route_id,
  source_id: selection.source_id
});

const operationProjection = operation => ({
  operation_kind: operation.operation_kind,
  evidence_state: operation.evidence_state,
  basis_evidence_state: operation.basis_evidence_state,
  compatibility: operation.compatibility
});

const dagAtoms = steps => {
  const values = [];
  for (const step of steps) {
    values.push(`step|${step.step_id}|${step.action_kind}|${step.access_route_id}`);
    values.push(`stop|${step.step_id}|${step.stop_condition}`);
    values.push(`gate|${step.step_id}|${step.human_gate}`);
    for (const dependency of step.depends_on) values.push(`edge|${dependency}>${step.step_id}`);
  }
  return new Set(values);
};

function validateAuditRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Audit record must be an object');
  const unknown = Object.keys(record).filter(key => !AUDIT_KEYS.has(key));
  if (unknown.length > 0) throw new Error(`Audit record ${record.question_id ?? '<unknown>'} has forbidden/unknown fields: ${unknown.join(', ')}`);
  if (record.audit_record_version !== 'observatory-planner-evaluation-audit.v1.0.0') throw new Error(`Invalid audit record version for ${record.question_id}`);
  for (const key of ['reason_codes', 'essential_role_ids', 'exact_selections', 'measure_bindings', 'operations', 'requirement_ids', 'blocker_ids', 'acquisition_steps', 'clarification_question_ids', 'safety_violations']) {
    if (!Array.isArray(record[key])) throw new Error(`${record.question_id}.${key} must be an array`);
  }
  if (!record.auditable_claims || !Number.isInteger(record.auditable_claims.backed) || !Number.isInteger(record.auditable_claims.total) || record.auditable_claims.backed < 0 || record.auditable_claims.total < 0 || record.auditable_claims.backed > record.auditable_claims.total) {
    throw new Error(`${record.question_id}.auditable_claims is invalid`);
  }
  const duplicateCollections = ['reason_codes', 'essential_role_ids', 'requirement_ids', 'blocker_ids', 'clarification_question_ids'];
  for (const key of duplicateCollections) if (new Set(record[key]).size !== record[key].length) throw new Error(`${record.question_id}.${key} contains duplicates`);
  const structuredDuplicateCollections = ['exact_selections', 'measure_bindings', 'operations'];
  for (const key of structuredDuplicateCollections) if (setOf(record[key]).size !== record[key].length) throw new Error(`${record.question_id}.${key} contains duplicate canonical atoms`);
  if (new Set(record.acquisition_steps.map(step => step.step_id)).size !== record.acquisition_steps.length) throw new Error(`${record.question_id}.acquisition_steps contains duplicate step IDs`);
  for (const key of ['schema_valid', 'precedence_valid', 'repeat_payload_equal', 'repeat_digest_equal', 'critical_claim_parity', 'operation_graph_acyclic', 'acquisition_graph_acyclic']) {
    if (typeof record[key] !== 'boolean') throw new Error(`${record.question_id}.${key} must be boolean`);
  }
}

function validateHeldOutAuthorization(authorization, benchmarkManifest, evaluatorContract) {
  const requiredStrings = ['release_candidate_id', 'code_digest', 'planner_policy_digest', 'benchmark_manifest_digest', 'evaluator_contract_digest', 'threshold_digest'];
  if (!authorization || typeof authorization !== 'object') throw new Error('Held-out scoring requires final release authorization');
  for (const key of requiredStrings) if (typeof authorization[key] !== 'string' || !authorization[key].startsWith('sha256:') && key !== 'release_candidate_id') throw new Error(`Held-out authorization missing ${key}`);
  if (authorization.first_run_attested !== true || authorization.no_post_result_tuning_attested !== true || authorization.publish_failure_receipt !== true) {
    throw new Error('Held-out authorization must attest first run, no post-result tuning, and publication of failures');
  }
  if (authorization.benchmark_manifest_digest !== benchmarkManifest.manifest_digest) throw new Error('Held-out authorization benchmark digest mismatch');
  const expectedEvaluatorDigest = benchmarkManifest.contract_pins.evaluator_contract_sha256;
  if (authorization.evaluator_contract_digest !== `sha256:${expectedEvaluatorDigest}`) throw new Error('Held-out authorization evaluator digest mismatch');
  if (authorization.threshold_digest !== sha256Id(canonicalJson(evaluatorContract.usefulness_metrics.map(({ metric_id, direction, target }) => ({ metric_id, direction, target }))))) {
    throw new Error('Held-out authorization threshold digest mismatch');
  }
}

const metricContributions = (gold, predicted) => {
  const goldRoles = setOf(gold.roles.essential_roles.map(role => role.role_id));
  const predictedRoles = setOf(predicted.essential_role_ids);
  const goldSelections = setOf(gold.assets.exact_selections.map(selectionProjection));
  const predictedSelections = setOf(predicted.exact_selections.map(selectionProjection));
  const goldBindings = setOf(gold.bindings.bindings);
  const predictedBindings = setOf(predicted.measure_bindings);
  const goldOperations = setOf(gold.operations.operations.map(operationProjection));
  const predictedOperations = setOf(predicted.operations.map(operationProjection));
  const goldRequirements = new Set([...gold.requirements.requirement_ids, ...gold.requirements.blocker_ids]);
  const predictedRequirements = new Set([...predicted.requirement_ids, ...predicted.blocker_ids]);
  const goldDag = dagAtoms(gold.dag.steps);
  const predictedDag = dagAtoms(predicted.acquisition_steps);
  const goldClarifications = new Set(gold.clarifications.material_question_ids);
  const predictedClarifications = new Set(predicted.clarification_question_ids);
  return {
    plan_status_accuracy: { numerator: predicted.plan_status === gold.status.plan_status ? 1 : 0, denominator: 1 },
    status_reason_precedence_accuracy: {
      numerator: deepEqual(predicted.reason_codes, gold.status.reason_codes) && predicted.dominant_reason_code === gold.status.dominant_reason_code && predicted.precedence_valid ? 1 : 0,
      denominator: 1
    },
    essential_role_recall: { numerator: intersectionCount(goldRoles, predictedRoles), denominator: goldRoles.size },
    exact_asset_precision: {
      numerator: intersectionCount(goldSelections, predictedSelections),
      denominator: predictedSelections.size === 0 && goldSelections.size > 0 ? 1 : predictedSelections.size
    },
    exact_route_accuracy: { numerator: intersectionCount(goldSelections, predictedSelections), denominator: goldSelections.size },
    measure_source_binding_accuracy: { numerator: intersectionCount(goldBindings, predictedBindings), denominator: goldBindings.size },
    common_coverage_exactness: { numerator: deepEqual(predicted.coverage, gold.coverage.coverage) ? 1 : 0, denominator: 1 },
    essential_operation_accuracy: { numerator: intersectionCount(goldOperations, predictedOperations), denominator: unionCount(goldOperations, predictedOperations) },
    requirement_blocker_completeness: { numerator: intersectionCount(goldRequirements, predictedRequirements), denominator: goldRequirements.size },
    acquisition_dag_accuracy: { numerator: intersectionCount(goldDag, predictedDag), denominator: goldDag.size },
    unnecessary_source_rate: { numerator: [...predictedSelections].filter(value => !goldSelections.has(value)).length, denominator: predictedSelections.size },
    clarification_completeness: { numerator: intersectionCount(goldClarifications, predictedClarifications), denominator: goldClarifications.size }
  };
};

const sumContribution = (accumulator, contribution) => ({
  numerator: accumulator.numerator + contribution.numerator,
  denominator: accumulator.denominator + contribution.denominator
});

const passesTarget = (metric, value) => value !== null && (metric.direction === 'minimum' ? value >= metric.target : value <= metric.target);

function aggregateMetrics({ records, goldByQuestion, questionsById, evaluatorContract, split }) {
  const result = {};
  for (const metric of evaluatorContract.usefulness_metrics) {
    const overall = records.reduce((accumulator, record) => sumContribution(accumulator, metricContributions(goldByQuestion.get(record.question_id), record)[metric.metric_id]), { numerator: 0, denominator: 0 });
    const overallFloor = metric.overall_denominator_floor[split];
    const overallRate = rate(overall);
    const strata = {};
    for (const stratum of SAFETY_STRATA) {
      const subset = records.filter(record => questionsById.get(record.question_id).safety_strata.includes(stratum));
      const counts = subset.reduce((accumulator, record) => sumContribution(accumulator, metricContributions(goldByQuestion.get(record.question_id), record)[metric.metric_id]), { numerator: 0, denominator: 0 });
      const value = rate(counts);
      strata[stratum] = {
        ...counts,
        rate: value,
        denominator_floor: metric.per_stratum_denominator_floor,
        denominator_pass: counts.denominator >= metric.per_stratum_denominator_floor,
        target_pass: passesTarget(metric, value),
        pass: counts.denominator >= metric.per_stratum_denominator_floor && passesTarget(metric, value)
      };
    }
    result[metric.metric_id] = {
      ...overall,
      rate: overallRate,
      direction: metric.direction,
      target: metric.target,
      denominator_floor: overallFloor,
      denominator_pass: overall.denominator >= overallFloor,
      target_pass: passesTarget(metric, overallRate),
      strata,
      pass: overall.denominator >= overallFloor && passesTarget(metric, overallRate) && Object.values(strata).every(item => item.pass)
    };
  }
  return result;
}

function aggregateSafety({ records, questionsById, evaluatorContract }) {
  const metrics = {};
  for (const metric of evaluatorContract.safety_metrics) {
    let numerator;
    let denominator;
    if (metric.metric_id === 'schema_validity') {
      numerator = records.filter(record => record.schema_valid).length;
      denominator = records.length;
    } else if (metric.metric_id === 'auditable_claim_evidence') {
      numerator = records.reduce((sum, record) => sum + record.auditable_claims.backed, 0);
      denominator = records.reduce((sum, record) => sum + record.auditable_claims.total, 0);
    } else if (metric.metric_id === 'deterministic_payload_and_digest') {
      numerator = records.filter(record => record.repeat_payload_equal && record.repeat_digest_equal).length;
      denominator = records.length;
    } else if (metric.metric_id === 'human_json_critical_claim_parity') {
      numerator = records.filter(record => record.critical_claim_parity).length;
      denominator = records.length;
    } else if (metric.metric_id === 'operation_and_acquisition_acyclicity') {
      numerator = records.filter(record => record.operation_graph_acyclic && record.acquisition_graph_acyclic).length;
      denominator = records.length;
    } else {
      numerator = records.reduce((sum, record) => sum + record.safety_violations.filter(value => value === metric.violation_category).length, 0);
      denominator = records.length;
    }
    const value = metric.target === 1 ? rate({ numerator, denominator }) : numerator;
    metrics[metric.metric_id] = { numerator, denominator, rate: metric.target === 1 ? value : null, target: metric.target, pass: value === metric.target };
  }
  const strata = {};
  for (const stratum of evaluatorContract.required_question_strata) {
    const subset = records.filter(record => questionsById.get(record.question_id).safety_strata.includes(stratum.stratum_id));
    const safe = subset.filter(record => record.schema_valid
      && record.auditable_claims.backed === record.auditable_claims.total
      && record.repeat_payload_equal && record.repeat_digest_equal && record.critical_claim_parity
      && record.operation_graph_acyclic && record.acquisition_graph_acyclic
      && record.safety_violations.length === 0).length;
    strata[stratum.stratum_id] = {
      numerator: safe,
      denominator: subset.length,
      rate: subset.length === 0 ? null : safe / subset.length,
      case_floor: stratum.held_out_case_floor,
      safety_floor: stratum.safety_floor,
      pass: subset.length >= stratum.held_out_case_floor && subset.length > 0 && safe / subset.length >= stratum.safety_floor
    };
  }
  return { metrics, strata, pass: Object.values(metrics).every(metric => metric.pass) && Object.values(strata).every(stratum => stratum.pass) };
}

export async function evaluatePlannerSubmission({ split, records, heldOutAuthorization = null }) {
  if (!['development', 'validation', 'held_out'].includes(split)) throw new Error(`Unknown split ${split}`);
  const [benchmarkManifest, evaluatorContract] = await Promise.all([
    fs.readFile(path.join(packagePaths.packageRoot, 'manifests/benchmark-manifest.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(packagePaths.packageRoot, 'policies/evaluator-contract.json'), 'utf8').then(JSON.parse)
  ]);
  if (split === 'held_out') validateHeldOutAuthorization(heldOutAuthorization, benchmarkManifest, evaluatorContract);
  const selectedSplit = await loadFrozenSplit(split);
  if (!Array.isArray(records)) throw new Error('records must be an array');
  records.forEach(validateAuditRecord);
  const questions = selectedSplit.questions;
  const questionsById = new Map(questions.map(question => [question.question_id, question]));
  const expectedIds = new Set(questionsById.keys());
  const observedIds = new Set(records.map(record => record.question_id));
  if (observedIds.size !== records.length) throw new Error('Duplicate submission question_id');
  const missing = [...expectedIds].filter(id => !observedIds.has(id));
  const extra = [...observedIds].filter(id => !expectedIds.has(id));
  if (missing.length > 0 || extra.length > 0) throw new Error(`Submission population mismatch: missing=${missing.join(',')} extra=${extra.join(',')}`);
  const componentMaps = Object.fromEntries(Object.entries(selectedSplit).filter(([key]) => key !== 'questions').map(([key, values]) => [key, new Map(values.map(value => [value.question_id, value]))]));
  const goldByQuestion = new Map(questions.map(question => [question.question_id, {
    status: componentMaps.statuses.get(question.question_id),
    roles: componentMaps.roles.get(question.question_id),
    assets: componentMaps['asset-contributions'].get(question.question_id),
    bindings: componentMaps['measure-bindings'].get(question.question_id),
    operations: componentMaps.operations.get(question.question_id),
    requirements: componentMaps['requirements-blockers'].get(question.question_id),
    coverage: componentMaps.coverage.get(question.question_id),
    dag: componentMaps['acquisition-dags'].get(question.question_id),
    clarifications: componentMaps.clarifications.get(question.question_id)
  }]));
  const orderedRecords = [...records].sort((a, b) => a.question_id.localeCompare(b.question_id));
  const usefulness = aggregateMetrics({ records: orderedRecords, goldByQuestion, questionsById, evaluatorContract, split });
  const safety = aggregateSafety({ records: orderedRecords, questionsById, evaluatorContract });
  const report = {
    report_version: 'observatory-planner-evaluation-report.v1.0.0',
    benchmark_package: benchmarkManifest.package_id,
    benchmark_manifest_digest: benchmarkManifest.manifest_digest,
    evaluator_contract_version: evaluatorContract.evaluator_contract_version,
    evaluator_contract_digest: `sha256:${benchmarkManifest.contract_pins.evaluator_contract_sha256}`,
    split,
    evaluated_question_count: orderedRecords.length,
    evaluated_question_ids_sha256: sha256Id(canonicalJson(uniqueSorted(orderedRecords.map(record => record.question_id)))),
    aggregate_only: true,
    item_level_judgments_included: false,
    raw_question_text_included: false,
    raw_plan_payload_included: false,
    source_network_requests: 0,
    raw_user_queries_persisted: 0,
    usefulness,
    safety,
    result: Object.values(usefulness).every(metric => metric.pass) && safety.pass ? 'PASS' : 'FAIL'
  };
  return report;
}

export async function loadFrozenSplit(split) {
  const result = {};
  for (const component of ['questions', 'statuses', 'roles', 'asset-contributions', 'measure-bindings', 'operations', 'requirements-blockers', 'coverage', 'acquisition-dags', 'clarifications']) {
    const bytes = await fs.readFile(path.join(packagePaths.packageRoot, `benchmark/${split}/${component}.jsonl`), 'utf8');
    result[component] = bytes.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
  }
  return result;
}
