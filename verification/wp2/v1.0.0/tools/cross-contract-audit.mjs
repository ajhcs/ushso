import path from 'node:path';
import {
  PROJECT_ROOT,
  canonicalJson,
  canonicalSha256,
  readJson,
  sha256File,
  stableEqual,
  walkFiles
} from './common.mjs';

const EVIDENCE_LADDER = ['unknown', 'candidate', 'ambiguous', 'documented', 'observed', 'executed', 'proven'];
const CORE_ACCESS_CLASSES = ['public', 'registration', 'application', 'dua', 'licensed', 'paid', 'unknown'];
const PLAN_ACCESS_CLASSES = ['public', 'registration', 'application', 'dua', 'licensed', 'paid', 'report_only', 'unknown'];
const COVERAGE_CELL_STATES = ['integrated', 'candidate', 'navigation_only', 'evidence_gap', 'inaccessible', 'unknown', 'not_assessed'];
const PLAN_STATUSES = ['unsupported', 'clarification_required', 'incomplete', 'ready_with_constraints', 'ready'];
const TRUTH_FIELDS = [
  'source_requests_made',
  'execution_authorized_by_ushso',
  'retrieval_executed',
  'payloads_acquired',
  'analysis_executed',
  'identity_merges_performed'
];

function collectPropertyNodes(value, propertyName, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (value.properties?.[propertyName]) output.push(value.properties[propertyName]);
  for (const item of Array.isArray(value) ? value : Object.values(value)) collectPropertyNodes(item, propertyName, output);
  return output;
}

async function readSchema(relative) {
  return readJson(path.join(PROJECT_ROOT, relative));
}

async function packageSchemas(relativeRoot) {
  const root = path.join(PROJECT_ROOT, relativeRoot);
  const schemas = [];
  for (const relative of (await walkFiles(root)).filter(file => file.endsWith('.schema.json'))) schemas.push(await readJson(path.join(root, relative)));
  return schemas;
}

function hasExactEnum(schemas, propertyName, expected) {
  return schemas.some(schema => collectPropertyNodes(schema, propertyName).some(node => Array.isArray(node.enum) && stableEqual(node.enum, expected)));
}

function collectRefs(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (typeof value.$ref === 'string') output.push(value.$ref);
  for (const item of Array.isArray(value) ? value : Object.values(value)) collectRefs(item, output);
  return output;
}

function hasNamedEnumContract(schemas, definitionName, expected, usePredicate) {
  const definitionPresent = schemas.some(schema => {
    const candidate = schema.$defs?.[definitionName]?.enum;
    return Array.isArray(candidate) && stableEqual(candidate, expected);
  });
  return definitionPresent && schemas.some(schema => collectRefs(schema).some(usePredicate));
}

function constrainedEvidenceIdNodes(schemas) {
  return schemas.flatMap(schema => collectPropertyNodes(schema, 'evidence_id'));
}

function nodeIsConstrainedId(node) {
  if (typeof node.$ref === 'string' && (/common\.schema\.json/.test(node.$ref) || /#\/\$defs\//.test(node.$ref))) return true;
  return node.type === 'string' && (typeof node.pattern === 'string' || (Number.isInteger(node.minLength) && Number.isInteger(node.maxLength)));
}

function pushCheck(checks, errors, checkId, passed, detail) {
  const rendered = typeof detail === 'string' ? detail : canonicalJson(detail);
  checks.push({ check_id: checkId, passed, detail: rendered, detail_sha256: canonicalSha256(detail) });
  if (!passed) errors.push(`CROSS_CONTRACT_CHECK_FAILED:${checkId}:${rendered}`);
}

export async function auditCrossContractSemantics() {
  const checks = [];
  const errors = [];
  const [core, identity, research, machine, publication, coverage] = await Promise.all([
    packageSchemas('contracts/core/v2.0.0/schemas'),
    packageSchemas('contracts/identity/v1.0.0/schemas'),
    packageSchemas('contracts/research-plan/v1.0.0/schemas'),
    packageSchemas('contracts/machine-toolkit/v1.0.0/schemas'),
    packageSchemas('contracts/publication/v1.0.0/schemas'),
    packageSchemas('contracts/coverage/v1.0.0/schemas')
  ]);

  for (const [id, schemas] of [['core', core], ['identity', identity], ['research-plan', research], ['machine-toolkit', machine]]) {
    pushCheck(checks, errors, `evidence-ladder-${id}`, hasExactEnum(schemas, 'evidence_state', EVIDENCE_LADDER), EVIDENCE_LADDER.join('|'));
  }

  const coreAccess = collectPropertyNodes(core, 'access_class').some(node => stableEqual(node.enum, CORE_ACCESS_CLASSES));
  const researchAccess = collectPropertyNodes(research, 'access_class').some(node => stableEqual(node.enum, PLAN_ACCESS_CLASSES));
  const machineAccess = machine.some(schema => collectPropertyNodes(schema, 'access_classes').some(node => stableEqual(node.items?.enum, PLAN_ACCESS_CLASSES)));
  pushCheck(checks, errors, 'access-class-compatible-extension', coreAccess && researchAccess && machineAccess, {
    core: CORE_ACCESS_CLASSES,
    planning_and_machine: PLAN_ACCESS_CLASSES,
    allowed_extension: 'report_only'
  });

  const coverageCommon = await readSchema('contracts/coverage/v1.0.0/schemas/common.schema.json');
  const coverageEnum = coverageCommon.$defs?.CoverageCellState?.enum;
  const machineCoverage = hasExactEnum(machine, 'coverage_cell_state', COVERAGE_CELL_STATES)
    || hasNamedEnumContract(machine, 'coverage_cell_state', COVERAGE_CELL_STATES, reference => reference === 'common.schema.json#/$defs/coverage_cell_state' || reference === '#/$defs/coverage_cell_state');
  pushCheck(checks, errors, 'coverage-cell-state-parity', stableEqual(coverageEnum, COVERAGE_CELL_STATES) && machineCoverage, COVERAGE_CELL_STATES);

  const researchPlan = await readSchema('contracts/research-plan/v1.0.0/schemas/research-plan.schema.json');
  const machinePlanStatus = hasExactEnum(machine, 'plan_status', PLAN_STATUSES)
    || hasNamedEnumContract(machine, 'plan_status', PLAN_STATUSES, reference => reference === 'https://ushso.org/contracts/research-plan/v1.0.0/schemas/research-plan.schema.json');
  pushCheck(checks, errors, 'plan-status-parity', stableEqual(researchPlan.properties?.plan_status?.enum, PLAN_STATUSES) && machinePlanStatus, PLAN_STATUSES);

  const researchCommon = await readSchema('contracts/research-plan/v1.0.0/schemas/common.schema.json');
  const machineCommon = await readSchema('contracts/machine-toolkit/v1.0.0/schemas/common.schema.json');
  const researchTruth = researchCommon.$defs?.truthBoundary;
  const machineTruth = machineCommon.$defs?.truthBoundary;
  const expectedTruth = {
    type: 'object',
    additionalProperties: false,
    required: TRUTH_FIELDS,
    properties: Object.fromEntries(TRUTH_FIELDS.map(field => [field, { const: false }]))
  };
  pushCheck(checks, errors, 'truth-boundary-exact-parity', stableEqual(researchTruth, expectedTruth) && stableEqual(machineTruth, expectedTruth), TRUTH_FIELDS);

  const generatedFromRequired = researchPlan.properties?.generated_from?.required ?? [];
  const machineEnvelope = machineCommon.$defs?.responseEnvelope;
  const machineRequired = machineEnvelope?.required ?? [];
  const planningPins = ['publication_manifest_id', 'registry_revision_id', 'index_generation', 'coverage_snapshot_id', 'candidate_snapshot_id', 'canonical_as_of'];
  const machinePins = ['publication_manifest_id', 'registry_revision', 'index_generation', 'coverage_snapshot_id', 'candidate_snapshot_id', 'canonical_as_of'];
  const coveragePins = coverageCommon.$defs?.RevisionPins?.required ?? [];
  const publicationGenerationSchema = await readSchema('contracts/publication/v1.0.0/schemas/component-generation-manifest.schema.json');
  const pinsPresent = planningPins.every(key => generatedFromRequired.includes(key))
    && machinePins.every(key => machineRequired.includes(key))
    && ['registry_revision', 'canonical_revision', 'index_generation'].every(key => coveragePins.includes(key))
    && publicationGenerationSchema.required?.includes('generation_id')
    && (machineEnvelope?.additionalProperties === false || machineEnvelope?.unevaluatedProperties === false);
  pushCheck(checks, errors, 'generation-and-snapshot-pin-parity', pinsPresent, {
    planner: planningPins,
    machine: machinePins,
    coverage: ['registry_revision', 'canonical_revision', 'index_generation'],
    publication: 'generation_id'
  });

  for (const [id, schemas] of [['core', core], ['identity', identity], ['research-plan', research], ['machine-toolkit', machine]]) {
    const idNodes = constrainedEvidenceIdNodes(schemas);
    const referenceCount = schemas.reduce((count, schema) => count
      + collectPropertyNodes(schema, 'evidence_refs').length
      + collectPropertyNodes(schema, 'evidence_ids').length
      + collectPropertyNodes(schema, 'evidence_reference_ids').length
      + collectPropertyNodes(schema, 'evidence_references').length, 0);
    pushCheck(checks, errors, `evidence-identifier-contract-${id}`, idNodes.length > 0 && idNodes.every(nodeIsConstrainedId) && referenceCount > 0, {
      evidence_id_nodes: idNodes.length,
      evidence_reference_nodes: referenceCount
    });
  }

  return { checks, errors, passed: errors.length === 0 };
}

export async function auditEvaluatorFreeze() {
  const errors = [];
  const metricPath = path.join(PROJECT_ROOT, 'evaluation/harness/v2.0.0/metric-contract.json');
  const benchmarkPath = path.join(PROJECT_ROOT, 'evaluation/harness/v2.0.0/benchmark-pin.json');
  const policyPath = path.join(PROJECT_ROOT, 'evaluation/bridge/v1.0.0/policies/present-source-policy.json');
  const cohortPath = path.join(PROJECT_ROOT, 'evaluation/bridge/v1.0.0/cohorts/present-source-v1.json');
  const algorithmPath = path.join(PROJECT_ROOT, 'evaluation/bridge/v1.0.0/manifests/algorithm-pins.json');
  const receiptPath = path.join(PROJECT_ROOT, 'evaluation/bridge/v1.0.0/receipts/bridge-receipt.json');
  const [metric, benchmark, policy, cohort, algorithms, receipt] = await Promise.all([
    readJson(metricPath), readJson(benchmarkPath), readJson(policyPath), readJson(cohortPath), readJson(algorithmPath), readJson(receiptPath)
  ]);
  const hashes = {
    metric_contract_sha256: await sha256File(metricPath),
    benchmark_pin_sha256: await sha256File(benchmarkPath),
    policy_sha256: await sha256File(policyPath),
    cohort_manifest_sha256: await sha256File(cohortPath),
    algorithm_pins_sha256: await sha256File(algorithmPath),
    bridge_receipt_sha256: await sha256File(receiptPath)
  };
  if (receipt.metric_contract_sha256 !== hashes.metric_contract_sha256) errors.push('EVALUATOR_METRIC_CONTRACT_PIN_MISMATCH');
  if (receipt.benchmark_pin_sha256 !== hashes.benchmark_pin_sha256 || cohort.current_generation?.benchmark_pin_sha256 !== hashes.benchmark_pin_sha256) errors.push('EVALUATOR_BENCHMARK_PIN_MISMATCH');
  if (receipt.cohort_manifest_sha256 !== hashes.cohort_manifest_sha256) errors.push('EVALUATOR_COHORT_PIN_MISMATCH');
  if (cohort.current_generation?.policy_sha256 !== hashes.policy_sha256) errors.push('EVALUATOR_POLICY_PIN_MISMATCH');
  if (policy.review?.tuning_started !== false) errors.push('EVALUATOR_POLICY_NOT_PRE_TUNING');
  if (receipt.release_gate_status !== 'FAIL_PRE_TUNING' || receipt.release_gate_pass !== false) errors.push('EVALUATOR_BRIDGE_NOT_PRE_TUNING_GATE');
  if (receipt.consolidated_v2_algorithm_available !== false) errors.push('EVALUATOR_CONSOLIDATED_ALGORITHM_INVENTED');
  if (receipt.execution_boundary?.ranking_optimization_performed !== false || metric.prohibited_actions?.ranking_optimization !== false) errors.push('EVALUATOR_OPTIMIZATION_BOUNDARY_INVALID');
  if (benchmark.benchmark_mutation_allowed !== false) errors.push('EVALUATOR_BENCHMARK_NOT_FROZEN');
  const algorithmEntries = Object.values(algorithms.algorithms ?? {});
  if (algorithmEntries.length === 0 || algorithmEntries.some(item => item.tuning_performed_by_bridge !== false || item.consolidated_v2_algorithm !== false)) errors.push('EVALUATOR_ALGORITHM_PIN_NOT_PRE_TUNING');
  for (const [key, expected] of Object.entries(receipt.algorithm_pins ?? {})) if (algorithms.algorithms?.[key]?.algorithm_fingerprint_sha256 !== expected) errors.push(`EVALUATOR_ALGORITHM_FINGERPRINT_MISMATCH:${key}`);
  const metricFrozen = Date.parse(metric.frozen_at);
  const policyReviewed = Date.parse(policy.review?.reviewed_at);
  const cohortGenerated = Date.parse(cohort.generated_at);
  if (![metricFrozen, policyReviewed, cohortGenerated].every(Number.isFinite) || metricFrozen > policyReviewed || policyReviewed > cohortGenerated) errors.push('EVALUATOR_FREEZE_ORDER_INVALID');
  return {
    passed: errors.length === 0,
    metric_contract_frozen_at: metric.frozen_at,
    policy_reviewed_at: policy.review?.reviewed_at,
    cohort_generated_at: cohort.generated_at,
    tuning_started: policy.review?.tuning_started,
    release_gate_status: receipt.release_gate_status,
    ranking_optimization_performed: receipt.execution_boundary?.ranking_optimization_performed,
    consolidated_v2_algorithm_available: receipt.consolidated_v2_algorithm_available,
    benchmark_mutation_allowed: benchmark.benchmark_mutation_allowed,
    hashes,
    errors
  };
}
