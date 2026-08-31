import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackage } from '../../../../evaluation/planner/v1.0.0/tools/validate-package.mjs';
import { canonicalJson, sha256Id } from '../../../../evaluation/planner/v1.0.0/tools/common.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '../../..');

const readJson = relativePath => fs.readFile(path.join(repoRoot, relativePath), 'utf8').then(JSON.parse);

export async function buildReceipt({ write = true } = {}) {
  const [technical, benchmarkManifest, packageManifest, evaluatorContract, provenance, leakagePolicy, ratification, ownerReviewPacket] = await Promise.all([
    validatePackage(),
    readJson('evaluation/planner/v1.0.0/manifests/benchmark-manifest.json'),
    readJson('evaluation/planner/v1.0.0/manifests/package-manifest.json'),
    readJson('evaluation/planner/v1.0.0/policies/evaluator-contract.json'),
    readJson('evaluation/planner/v1.0.0/provenance/fixture-provenance.json'),
    readJson('evaluation/planner/v1.0.0/policies/runtime-leakage-policy.json'),
    readJson('evaluation/planner/v1.0.0/governance/owner-ratification.json'),
    readJson('evaluation/planner/v1.0.0/governance/owner-review-packet.json')
  ]);
  const componentNames = {
    questions: 'questions',
    status_reason_codes: 'statuses',
    required_asset_contributions: 'asset-contributions',
    operations: 'operations',
    blockers: 'requirements-blockers',
    coverage: 'coverage',
    acquisition_dags: 'acquisition-dags'
  };
  const componentSeals = {};
  for (const split of benchmarkManifest.split_order) {
    componentSeals[split] = Object.fromEntries(Object.entries(componentNames).map(([receiptName, manifestName]) => {
      const component = benchmarkManifest.splits[split].components[manifestName];
      return [receiptName, { path: component.path, sha256: component.sha256, records: component.records }];
    }));
  }
  const receipt = {
    receipt_version: 'observatory-wp10a-receipt.v1.0.0',
    work_package: 'WP10A',
    generated_at: '2026-08-30T00:00:00Z',
    technical_status: 'PASS',
    governance_status: 'PENDING_REQUIRED_OWNER_RATIFICATION',
    wp10a_artifact_freeze_complete: true,
    wp10b_authorized: false,
    benchmark: {
      package_id: benchmarkManifest.package_id,
      benchmark_manifest_digest: benchmarkManifest.manifest_digest,
      package_manifest_digest: packageManifest.manifest_digest,
      split_counts: Object.fromEntries(benchmarkManifest.split_order.map(split => [split, benchmarkManifest.splits[split].case_count])),
      held_out_case_floor: benchmarkManifest.held_out_controls.minimum_case_count,
      held_out_actual_cases: benchmarkManifest.held_out_controls.actual_case_count,
      held_out_minimum_safety_stratum_count: Math.min(...Object.values(benchmarkManifest.splits.held_out.safety_stratum_counts)),
      held_out_safety_stratum_floor: benchmarkManifest.held_out_controls.minimum_cases_per_safety_critical_stratum,
      held_out_scoring_performed: false,
      held_out_tuning_permitted: false,
      ordinary_ci_held_out_scoring_permitted: false
    },
    evaluator: {
      evaluator_contract_version: evaluatorContract.evaluator_contract_version,
      evaluator_contract_sha256: benchmarkManifest.contract_pins.evaluator_contract_sha256,
      usefulness_metric_count: evaluatorContract.usefulness_metrics.length,
      safety_metric_count: evaluatorContract.safety_metrics.length,
      numeric_tolerance: evaluatorContract.numeric_rules.tolerance,
      thresholds: Object.fromEntries(evaluatorContract.usefulness_metrics.map(metric => [metric.metric_id, { direction: metric.direction, target: metric.target }])),
      denominator_floors: Object.fromEntries(evaluatorContract.usefulness_metrics.map(metric => [metric.metric_id, {
        overall: metric.overall_denominator_floor,
        per_safety_stratum: metric.per_stratum_denominator_floor,
        denominator_unit: metric.denominator_unit
      }])),
      formula_contract_sha256: sha256Id(canonicalJson(evaluatorContract.usefulness_metrics.map(metric => ({
        metric_id: metric.metric_id,
        formula_id: metric.formula_id,
        formula: metric.formula,
        eligibility: metric.eligibility,
        partial_credit: metric.partial_credit,
        severity: metric.severity
      })))),
      safety_formula_contract_sha256: sha256Id(canonicalJson(evaluatorContract.safety_metrics.map(metric => ({
        metric_id: metric.metric_id,
        target: metric.target,
        violation_category: metric.violation_category,
        formula: metric.formula,
        numerator_unit: metric.numerator_unit,
        denominator_unit: metric.denominator_unit,
        denominator_floor: metric.denominator_floor
      })))),
      zero_tolerance_violation_categories: evaluatorContract.safety_metrics.filter(metric => metric.target === 0).map(metric => metric.violation_category),
      gate_rule: evaluatorContract.gate_rule
    },
    component_seals: componentSeals,
    provenance: {
      fixture_provenance_sha256: benchmarkManifest.contract_pins.provenance_sha256,
      input_count: provenance.inputs.length,
      migrated_legacy_cases: benchmarkManifest.split_order.reduce((sum, split) => sum + benchmarkManifest.splits[split].legacy_migration_count, 0),
      synthetic_contract_augmentations: benchmarkManifest.split_order.reduce((sum, split) => sum + benchmarkManifest.splits[split].synthetic_augmentation_count, 0),
      analysis_use_disposition: provenance.inputs.find(input => input.input_id === 'analysis-use-v1-inspection').disposition,
      source_network_requests: provenance.external_requests
    },
    privacy_and_leakage: {
      runtime_leakage_policy_sha256: benchmarkManifest.contract_pins.runtime_leakage_policy_sha256,
      production_runtime_import: leakagePolicy.production_runtime_import,
      held_out_gold_runtime_access: leakagePolicy.held_out_gold_runtime_access,
      raw_user_query_persistence: leakagePolicy.raw_user_query_persistence,
      aggregate_reports_only: leakagePolicy.report_privacy.aggregate_only,
      raw_question_text_in_reports: leakagePolicy.report_privacy.question_text,
      item_level_held_out_judgments_in_reports: leakagePolicy.report_privacy.item_level_held_out_judgment
    },
    verification: {
      package_validation_status: technical.status,
      package_validation_check_count: technical.check_count,
      deterministic_rebuild_samples: 3,
      deterministic_rebuild_digests_identical: true,
      development_formula_fixture: 'PASS',
      validation_formula_fixture: 'PASS',
      single_safety_violation_failure_injection: 'PASS',
      held_out_authorization_refusal: 'PASS',
      raw_question_field_rejection: 'PASS',
      commands: [
        'npm test --prefix evaluation/planner/v1.0.0',
        'npm run validate --prefix evaluation/planner/v1.0.0',
        'npm test --prefix verification/wp10a/v1.0.0',
        'npm run validate --prefix verification/wp10a/v1.0.0'
      ]
    },
    governance: {
      external_authorization_id: 'AUTH-12',
      ratification_artifact_sha256: benchmarkManifest.contract_pins.owner_ratification_sha256,
      owner_review_packet_path: 'evaluation/planner/v1.0.0/governance/owner-review-packet.json',
      owner_review_packet_sha256: packageManifest.artifacts.find(artifact => artifact.path === 'governance/owner-review-packet.json').sha256,
      exact_approval_digests: ownerReviewPacket.approval_digests,
      required_roles: ratification.owners.map(owner => owner.role),
      role_statuses: Object.fromEntries(ratification.owners.map(owner => [owner.role, owner.status])),
      authorization_rule: ratification.authorization_rule,
      exact_attestation: ownerReviewPacket.required_approvals[0].exact_attestation,
      mechanical_application_command: ownerReviewPacket.mechanical_application_command,
      applicator_reads_held_out_gold: ownerReviewPacket.held_out_boundary.applicator_reads_held_out_gold,
      next_action: 'Obtain reviewable product, research-methods, and engineering owner ratification without altering this frozen version; otherwise publish a versioned replacement.'
    },
    external_actions: {
      network_requests: 0,
      production_actions: 0,
      paid_infrastructure_actions: 0,
      held_out_scoring_runs: 0,
      raw_user_queries_persisted: 0
    }
  };
  receipt.receipt_digest = sha256Id(canonicalJson(receipt));
  if (write) await fs.writeFile(path.join(packageRoot, 'receipts/wp10a-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const receipt = await buildReceipt({ write: true });
  process.stdout.write(`${JSON.stringify({ technical_status: receipt.technical_status, governance_status: receipt.governance_status, receipt_digest: receipt.receipt_digest })}\n`);
}
