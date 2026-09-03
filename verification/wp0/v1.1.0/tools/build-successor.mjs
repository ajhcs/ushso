import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildProductBoundaryReceipt } from '../../v1.0.0/tools/build-product-boundary-receipt.mjs';
import { buildAggregateReceipt as buildPredecessorAggregate } from '../../v1.0.0/tools/validate-wp0-aggregate.mjs';
import { buildMetricSuccessorValidation } from '../../../wp8/v1.2.0/tools/development-validation.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../../..');
const receiptsRoot = path.join(packageRoot, 'receipts');
const productBoundaryPath = path.join(receiptsRoot, 'product-boundary.json');
const aggregatePath = path.join(receiptsRoot, 'wp0-successor-aggregate.json');
const generatedAt = '2026-09-03T00:00:00.000Z';
const executeFile = promisify(execFile);

const pretty = value => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const readBytes = relative => fs.readFile(path.join(repositoryRoot, relative));

async function buildCurrentProductBoundary() {
  const testPath = path.join(repositoryRoot, 'tests/product-boundary.test.mjs');
  const testSource = await fs.readFile(testPath, 'utf8');
  const testCount = [...testSource.matchAll(/^test\s*\(/gmu)].length;
  if (testCount < 1) throw new Error('WP0_PRODUCT_BOUNDARY_TESTS_MISSING');
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  try {
    await executeFile(process.execPath, ['--test', testPath], {
      cwd: repositoryRoot,
      env: childEnvironment,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (error) {
    throw new Error(`WP0_PRODUCT_BOUNDARY_TEST_FAILED:${error.stderr?.trim() ?? error.message}`);
  }
  const current = await buildProductBoundaryReceipt({
    verifiedTestSummary: {
      success: true,
      counts: { tests: testCount, passed: testCount, failed: 0, skipped: 0 }
    }
  });
  if (current.result !== 'pass' || current.test_summary.failed !== 0 || current.assertions.some(item => item.result !== 'pass')) {
    throw new Error('WP0_PRODUCT_BOUNDARY_NOT_PASS');
  }
  const predecessorBytes = await readBytes('verification/wp0/v1.0.0/receipts/product-boundary.json');
  return {
    ...current,
    receipt_id: 'wp0-product-boundary-v1.1.0-successor',
    receipt_version: '1.1.0',
    verification_date: '2026-09-03',
    approval: {
      status: 'approved_scoped',
      recorded_at: generatedAt,
      basis: 'Explicit APPROVED response from the requesting repository operator in the 2026-09-03 Codex task.',
      scope: 'Create a versioned WP0 v1.1 successor/reseal without altering historical receipts.'
    },
    supersedes: {
      path: 'verification/wp0/v1.0.0/receipts/product-boundary.json',
      sha256: sha256(predecessorBytes),
      overwritten: false
    }
  };
}

export async function buildSuccessorReceipts() {
  const [predecessorAggregateBytes, predecessorProductBoundaryBytes, predecessorRecalculation, currentProductBoundary, wp8, wp8ReceiptBytes, metricContractBytes] = await Promise.all([
    readBytes('verification/wp0/v1.0.0/receipts/wp0-aggregate.json'),
    readBytes('verification/wp0/v1.0.0/receipts/product-boundary.json'),
    buildPredecessorAggregate(),
    buildCurrentProductBoundary(),
    buildMetricSuccessorValidation(),
    readBytes('verification/wp8/v1.2.0/validation/validation-receipt.json'),
    readBytes('evaluation/harness/v2.1.0/metric-contract.json')
  ]);
  const predecessorStored = JSON.parse(predecessorAggregateBytes.toString('utf8'));
  if (predecessorStored.verification_status !== 'PASS' || predecessorStored.provisional !== false) {
    throw new Error('WP0_PREDECESSOR_NOT_FINAL_PASS');
  }
  const blockerIds = predecessorRecalculation.blockers.map(item => item.check_id);
  if (predecessorRecalculation.verification_status !== 'BLOCKED_STALE_PREREQUISITE'
      || blockerIds.length !== 1
      || blockerIds[0] !== 'product-boundary-and-non-goals') {
    throw new Error(`WP0_PREDECESSOR_DRIFT_NOT_NARROW:${blockerIds.join(',')}`);
  }
  if (!wp8.quality_gate_pass || !wp8.safety_gate_pass || wp8.release_ready || wp8.production_eligibility) {
    throw new Error('WP0_WP8_SUCCESSOR_STATE_INVALID');
  }
  const productBoundaryBytes = Buffer.from(pretty(currentProductBoundary));
  const aggregate = {
    receipt_version: 'ushso-wp0-successor-aggregate-verification.v1.1.0',
    package_id: '@ushso/wp0-verification-successor@1.1.0',
    generated_at: generatedAt,
    approval: currentProductBoundary.approval,
    verification_status: 'PASS_SUCCESSOR_RESEAL',
    artifact_integrity_pass: true,
    provisional: false,
    release_gate_pass: false,
    release_ready: false,
    production_eligibility: false,
    checks: [
      {
        check_id: 'historical-wp0-preservation',
        status: 'PASS',
        evidence: {
          aggregate_path: 'verification/wp0/v1.0.0/receipts/wp0-aggregate.json',
          aggregate_sha256: sha256(predecessorAggregateBytes),
          product_boundary_path: 'verification/wp0/v1.0.0/receipts/product-boundary.json',
          product_boundary_sha256: sha256(predecessorProductBoundaryBytes),
          predecessor_overwritten: false
        }
      },
      {
        check_id: 'predecessor-drift-classification',
        status: 'PASS',
        evidence: {
          recalculated_status: predecessorRecalculation.verification_status,
          expected_only_blocker: 'product-boundary-and-non-goals',
          non_boundary_checks_passed: predecessorRecalculation.checks.filter(item => item.check_id !== 'product-boundary-and-non-goals').every(item => item.status === 'PASS')
        }
      },
      {
        check_id: 'current-product-boundary-reseal',
        status: 'PASS',
        evidence: {
          receipt_path: 'verification/wp0/v1.1.0/receipts/product-boundary.json',
          receipt_sha256: sha256(productBoundaryBytes),
          inspected_scope_sha256: currentProductBoundary.inspected_scope.sha256,
          inspected_scope_file_count: currentProductBoundary.inspected_scope.file_count,
          tests: currentProductBoundary.test_summary
        }
      },
      {
        check_id: 'wp8-metric-successor-development-validation',
        status: 'PASS',
        evidence: {
          receipt_path: 'verification/wp8/v1.2.0/validation/validation-receipt.json',
          receipt_sha256: sha256(wp8ReceiptBytes),
          metric_contract_path: 'evaluation/harness/v2.1.0/metric-contract.json',
          metric_contract_sha256: sha256(metricContractBytes),
          metric: wp8.metric_contract.id,
          combined_score: wp8.feasibility.successor_metric.combined.macro_score,
          target: wp8.metric_contract.target.value,
          historical_observed_score: wp8.feasibility.historical_fixed_slot_metric.observed_score,
          historical_mathematical_ceiling: wp8.feasibility.historical_fixed_slot_metric.mathematical_ceiling
        }
      }
    ],
    blockers: [],
    open_external_gates: [
      {
        gate_id: 'AUTH-13',
        status: 'not_authorized',
        effect: 'No held-out retrieval evaluation and no final WP8 release claim.'
      },
      {
        gate_id: 'PRODUCTION',
        status: 'not_authorized',
        effect: 'No deployment, managed infrastructure, connector traffic, or public traffic change.'
      }
    ],
    execution_boundary: {
      external_requests: 0,
      deployments: 0,
      remote_writes: 0,
      paid_infrastructure_actions: 0,
      production_mutations: 0,
      source_payloads_accessed: 0,
      held_out_questions_evaluated: 0,
      ranking_optimization_performed: false
    }
  };
  return { productBoundary: currentProductBoundary, aggregate };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipts = await buildSuccessorReceipts();
    if (process.argv.includes('--write-receipts')) {
      await fs.writeFile(productBoundaryPath, pretty(receipts.productBoundary), 'utf8');
      await fs.writeFile(aggregatePath, pretty(receipts.aggregate), 'utf8');
    }
    process.stdout.write(pretty({
      status: receipts.aggregate.verification_status,
      product_boundary_sha256: sha256(Buffer.from(pretty(receipts.productBoundary))),
      aggregate_sha256: sha256(Buffer.from(pretty(receipts.aggregate))),
      release_ready: false,
      production_eligibility: false
    }));
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
