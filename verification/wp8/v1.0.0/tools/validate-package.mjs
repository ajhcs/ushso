import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalizeJson } from '../../../../contracts/tooling/v1.0.0/src/canonical-json.mjs';
import { byteSha256 } from '../../../../contracts/tooling/v1.0.0/src/digests.mjs';
import {
  createPackageManifest,
  verifyPackageManifest,
  writeJsonAtomic,
} from '../../../../contracts/tooling/v1.0.0/src/manifest.mjs';
import { readStrictJson } from '../../../../contracts/tooling/v1.0.0/src/strict-json.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, '../../..');
const WRITE = process.argv.includes('--write-receipts');
const MANIFEST_PATH = path.join(PACKAGE_ROOT, 'manifests/package-manifest.json');
const VALIDATION_PATH = path.join(PACKAGE_ROOT, 'validation/validation-receipt.json');
const EXPECTED_TEST_COUNT = 35;

function repositoryPath(relative) {
  return path.join(REPOSITORY_ROOT, relative);
}

async function sha256File(relative) {
  return createHash('sha256').update(await fs.readFile(repositoryPath(relative))).digest('hex');
}

function check(condition, code, detail = null) {
  if (!condition) {
    const error = new Error(`${code}${detail ? `:${detail}` : ''}`);
    error.code = code;
    throw error;
  }
}

async function testInventory() {
  const names = (await fs.readdir(path.join(PACKAGE_ROOT, 'tests')))
    .filter(name => name.endsWith('.test.mjs'))
    .sort();
  let count = 0;
  for (const name of names) {
    const source = await fs.readFile(path.join(PACKAGE_ROOT, 'tests', name), 'utf8');
    count += [...source.matchAll(/^test\(['"`]/gmu)].length;
  }
  return { files: names, count };
}

async function verifyWp1Pins() {
  const receipt = await readStrictJson(repositoryPath('verification/wp1/v1.0.0/receipts/repository-adapter-contract.json'));
  check(receipt.status === 'PASS', 'WP1_RECEIPT_NOT_PASS');
  check(receipt.source_files.length === 15, 'WP1_PIN_COUNT_CHANGED');
  for (const source of receipt.source_files) {
    check(await sha256File(source.path) === source.sha256, 'WP1_SOURCE_PIN_CHANGED', source.path);
  }
  return receipt.source_files.length;
}

async function verifyWp2Freeze() {
  const pins = {
    'evaluation/harness/v2.0.0/validation/validation-receipt.json': '864b234a65de2358d888368cbdae9009c7aaeb0f2749693f2ebe6974b73d8e8b',
    'evaluation/bridge/v1.0.0/receipts/bridge-receipt.json': '9f42e7a26555cb6ce1465a15ac9afa1913869039e01557778c768ee1120251b5',
    'evaluation/harness/v2.0.0/metric-contract.json': '32c826571c7e9d44dc567664030eed67c49ae60a3574850d9bd0209fa6498cda',
    'evaluation/harness/v2.0.0/benchmark-pin.json': '89804a56123cb19fff40468e5fcdc05a2753ff0b4b38541386bda239cd2de398',
  };
  for (const [file, expected] of Object.entries(pins)) check(await sha256File(file) === expected, 'WP2_FREEZE_PIN_CHANGED', file);
  const aggregate = await readStrictJson(repositoryPath('verification/wp2/v1.0.0/validation/validation-receipt.json'));
  check(aggregate.wp2_gate_pass === true, 'WP2_GATE_NOT_PASS');
  check(aggregate.evaluator_freeze.tuning_started === false, 'WP2_TUNING_BOUNDARY_CHANGED');
  check(aggregate.evaluator_freeze.ranking_optimization_performed === false, 'WP2_RANKING_WAS_OPTIMIZED');
  check(aggregate.evaluator_freeze.release_gate_status === 'FAIL_PRE_TUNING', 'WP2_RELEASE_STATUS_CHANGED');
  return Object.keys(pins).length;
}

async function verifyAuthorization() {
  const register = await readStrictJson(repositoryPath('verification/external-authorization/v1.0.0/register.json'));
  const authorization = register.entries.find(entry => entry.id === 'AUTH-13');
  check(Boolean(authorization), 'AUTH_13_MISSING');
  check(authorization.authorized === false && authorization.status === 'not_requested', 'AUTH_13_STATE_INVALID');
  check(authorization.action.includes('fresh independently owned 20-item retrieval holdout'), 'AUTH_13_SCOPE_INVALID');
  check(authorization.action.includes('one-time aggregate-only final-gate evaluation'), 'AUTH_13_SCOPE_INVALID');
  return authorization;
}

async function verifySearchPackage() {
  const searchRoot = repositoryPath('packages/search');
  const manifest = await readStrictJson(path.join(searchRoot, 'manifests/package-manifest.json'));
  const result = await verifyPackageManifest({ root: searchRoot, manifest });
  check(result.ok, 'WP8_SEARCH_PACKAGE_MANIFEST_MISMATCH');
  check(manifest.package_name === '@ushso/search-generation' && manifest.package_version === '2.0.0-untuned', 'WP8_SEARCH_PACKAGE_ID_INVALID');
  return manifest;
}

async function verifyEvidence() {
  const receiptNames = [
    'database-migration-readiness.json',
    'final-holdout-prerequisite.json',
    'query-plan-gate.json',
    'retrieval-quality.json',
    'wp8-scaffolding.json',
  ];
  const receipts = Object.fromEntries(await Promise.all(receiptNames.map(async name => [name, await readStrictJson(path.join(PACKAGE_ROOT, 'receipts', name))])));
  const ledger = await readStrictJson(path.join(PACKAGE_ROOT, 'evidence-ledger.json'));
  check(ledger.quality_status === 'FAIL_PRE_TUNING' && ledger.release_ready === false, 'WP8_LEDGER_RELEASE_BOUNDARY_INVALID');
  check(receipts['retrieval-quality.json'].status === 'FAIL_PRE_TUNING', 'WP8_QUALITY_STATUS_INVALID');
  check(receipts['retrieval-quality.json'].release_gate_pass === false, 'WP8_QUALITY_GATE_FABRICATED');
  check(receipts['query-plan-gate.json'].production_like_gate_pass === false, 'WP8_PERFORMANCE_GATE_FABRICATED');
  check(receipts['database-migration-readiness.json'].migration_applied === false, 'WP8_MIGRATION_CLAIM_INVALID');
  check(receipts['final-holdout-prerequisite.json'].external_authorization_id === 'AUTH-13', 'WP8_AUTH_13_LINK_MISSING');
  check(receipts['final-holdout-prerequisite.json'].package_supplied === false, 'WP8_HOLDOUT_PACKAGE_CLAIM_INVALID');
  check(receipts['final-holdout-prerequisite.json'].final_run_performed === false, 'WP8_HOLDOUT_RUN_CLAIM_INVALID');
  check(receipts['final-holdout-prerequisite.json'].guard.production_authorization_and_custody_verifier_required === true, 'WP8_HOLDOUT_AUTH_VERIFIER_BOUNDARY_INVALID');
  check(receipts['final-holdout-prerequisite.json'].guard.production_terminal_execution_verifier_required === true, 'WP8_HOLDOUT_TERMINAL_VERIFIER_BOUNDARY_INVALID');
  check(receipts['final-holdout-prerequisite.json'].guard.guard_proves_external_per_item_side_outputs_absent === false, 'WP8_HOLDOUT_SIDE_OUTPUT_CLAIM_INVALID');
  check(receipts['wp8-scaffolding.json'].execution_boundary.source_requests === 0, 'WP8_SOURCE_REQUEST_BOUNDARY_INVALID');
  check(receipts['wp8-scaffolding.json'].verification.test_count === EXPECTED_TEST_COUNT, 'WP8_RECEIPT_TEST_COUNT_INVALID');
  check(ledger.external_gates.some(gate => gate.reason.includes('AUTH-13')), 'WP8_LEDGER_AUTH_13_LINK_MISSING');
  return { ledger, receiptNames };
}

function validationReceipt({ manifest, testInventoryResult, wp1PinCount, wp2PinCount, evidence, authorization, searchManifest }) {
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    receipt_version: 'ushso-wp8-validation-receipt.v1.0.0',
    package_id: '@ushso/verification-wp8@1.0.0',
    generated_at: '2026-08-30T00:00:00.000Z',
    status: 'PASS_UNTUNED_SCAFFOLDING',
    quality_status: 'FAIL_PRE_TUNING',
    release_gate_pass: false,
    release_ready: false,
    package_manifest_byte_digest: byteSha256(manifestBytes),
    package_content_digest: manifest.package_content_digest,
    checks: [
      { check_id: 'offline-test-inventory', status: 'PASS', detail: `${testInventoryResult.files.length} files and ${testInventoryResult.count} tests discovered.` },
      { check_id: 'wp1-source-pins', status: 'PASS', detail: `${wp1PinCount} WP1 receipt sources match their sealed byte hashes.` },
      { check_id: 'wp2-freeze-pins', status: 'PASS', detail: `${wp2PinCount} evaluator/metric/benchmark receipts remain byte-pinned; tuning remains false.` },
      { check_id: 'projection-publication-sql-shape', status: 'PASS', detail: 'All offline and static-shape receipts are present and fail closed at external gates.' },
      { check_id: 'final-holdout-boundary', status: 'PASS', detail: `${authorization.id} is linked and not authorized; no replacement package or final run is claimed.` },
      { check_id: 'search-production-package', status: 'PASS', detail: `${searchManifest.file_count} files sealed as ${searchManifest.package_content_digest.value}.` },
      { check_id: 'evidence-ledger', status: 'PASS', detail: `${evidence.ledger.requirements.length} requirements and ${evidence.ledger.external_gates.length} external gates are explicitly tracked.` },
    ],
    execution_boundary: {
      network_requests: 0,
      source_payloads_accessed: 0,
      held_out_items_accessed: 0,
      ranking_optimization_performed: false,
      database_migrations_applied: 0,
      production_actions: 0,
    },
    open_gates: evidence.ledger.external_gates.map(gate => ({ gate_id: gate.gate_id, status: gate.status })),
  };
}

const packageJson = await readStrictJson(path.join(PACKAGE_ROOT, 'package.json'));
check(packageJson.dependencies?.['@ushso/contract-tooling'] === '1.0.0', 'WP8_TOOLING_DEPENDENCY_NOT_PINNED');
check(packageJson.dependencies?.['@ushso/publication-contract'] === '1.0.0', 'WP8_PUBLICATION_DEPENDENCY_NOT_PINNED');
check(packageJson.dependencies?.['@ushso/search-generation'] === '2.0.0-untuned', 'WP8_SEARCH_DEPENDENCY_NOT_PINNED');
const manifest = await createPackageManifest({
  root: PACKAGE_ROOT,
  packageName: packageJson.name,
  packageVersion: packageJson.version,
});
const [inventory, wp1PinCount, wp2PinCount, evidence, authorization, searchManifest] = await Promise.all([
  testInventory(),
  verifyWp1Pins(),
  verifyWp2Freeze(),
  verifyEvidence(),
  verifyAuthorization(),
  verifySearchPackage(),
]);
check(inventory.files.length === 7, 'WP8_TEST_FILE_COUNT_INVALID', inventory.files.length);
check(inventory.count === EXPECTED_TEST_COUNT, 'WP8_TEST_COUNT_INVALID', inventory.count);
const receipt = validationReceipt({ manifest, testInventoryResult: inventory, wp1PinCount, wp2PinCount, evidence, authorization, searchManifest });

if (WRITE) {
  await writeJsonAtomic(MANIFEST_PATH, manifest);
  await writeJsonAtomic(VALIDATION_PATH, receipt);
} else {
  const [storedManifest, storedReceipt] = await Promise.all([
    readStrictJson(MANIFEST_PATH),
    readStrictJson(VALIDATION_PATH),
  ]);
  const manifestCheck = await verifyPackageManifest({ root: PACKAGE_ROOT, manifest: storedManifest });
  check(manifestCheck.ok, 'WP8_PACKAGE_MANIFEST_MISMATCH');
  check(canonicalizeJson(storedReceipt) === canonicalizeJson(receipt), 'WP8_VALIDATION_RECEIPT_MISMATCH');
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  status: receipt.status,
  quality_status: receipt.quality_status,
  release_gate_pass: false,
  test_files: inventory.files.length,
  test_count: inventory.count,
  package_content_digest: manifest.package_content_digest,
  receipts: evidence.receiptNames.length,
  external_authorization: authorization.id,
})}\n`);
