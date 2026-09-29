import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateProductionBaseline } from '../../v1.0.0/tools/validate-production-baseline.mjs';
import { buildAggregateReceipt } from '../../v1.0.0/tools/validate-wp0-aggregate.mjs';
import { buildProductBoundaryReceipt } from '../../v1.0.0/tools/build-product-boundary-receipt.mjs';
import { buildMetricSuccessorValidation } from '../../../wp8/v1.2.0/tools/development-validation.mjs';
import { validateCatalogRecords } from '../../../../packages/retrieval/tools/catalog-contract.mjs';
import { pinFiles, listFiles, sha256, runSuccessorCli } from '../../../successor-support.mjs';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const repoRoot = path.resolve(packageRoot, '../../..');
export const packageId = '@ushso/wp0-verification-v1.2.0@1.2.0';
const execute = promisify(execFile);
const oldRoot = 'verification/wp0/v1.0.0/receipts';
const expectedPredecessors = {
  [`${oldRoot}/adr-documentation-audit.json`]: '4effbfb71c3ad969786ec0f94763e9285f4089eba5e5d21a0885a5790e8b4576',
  [`${oldRoot}/legacy-evaluation-freeze.json`]: 'c424390dd068e6d6f5b19aee05f1b5148e269df7e8d0f9bdfb57060d45d31764',
  [`${oldRoot}/product-boundary.json`]: '2e684e576dedbcb39d083aa8e5dde0ea5b4b01f9f01388446b1e16b268f364d8',
  [`${oldRoot}/production-baseline.json`]: '3a2982cf6282f03024416ea94e6160ee7d5fd8ff8409132d9512c8a740babc45',
  [`${oldRoot}/v1-contract-freeze.json`]: '8c72c6165e9b28d4fd5b2bb2f056d33efc3ad0d991f1e37aa41cc563201607ff',
  [`${oldRoot}/wp0-aggregate.json`]: 'b675ff5d41ac1bd3029b23a7b00ddfd4032f4b832bf430dc24353e85f79665fd',
  'verification/wp0/v1.1.0/receipts/product-boundary.json': '38b7e91c1b0cd78bf2eecbcaae8702efb42bbc97c343650fe13c4a076ccee1d4',
  'verification/wp0/v1.1.0/receipts/wp0-successor-aggregate.json': '703ee6668c9513992a86b273fa44e38c8c41b36994eb309b2df05f1d95b2ce59'
};
export const historicalMapping = {
  'packages/retrieval/tools/query-schema.mjs': 'verification/wp0/v1.2.0/historical-algorithms/query-schema.mjs',
  'packages/retrieval/tools/webmcp.mjs': 'verification/wp0/v1.2.0/historical-algorithms/webmcp.mjs'
};
const readJson = async relative => JSON.parse(await fs.readFile(path.join(repoRoot, relative), 'utf8'));
export async function validateHistoricalLanes({ mapping = historicalMapping } = {}) {
  assert.deepEqual(mapping, historicalMapping, 'WP0_HISTORICAL_MAPPING_CHANGED');
  const receipt = await readJson(`${oldRoot}/production-baseline.json`);
  assert.equal(sha256(await fs.readFile(path.join(repoRoot, `${oldRoot}/production-baseline.json`))), expectedPredecessors[`${oldRoot}/production-baseline.json`], 'WP0_BASELINE_RECEIPT_CHANGED');
  const temporaryBase = await fs.realpath(process.env.TMPDIR ?? '/mnt/d/tmp/plumbob');
  assert.ok(temporaryBase.startsWith('/mnt/d/'), 'WP0_TEMP_STORAGE_MUST_BE_ON_MOUNTED_DATA_DISK');
  const shadow = await fs.mkdtemp(path.join(temporaryBase, 'ushso-historical-validation-'));
  const artifacts = new Map();
  const add = item => artifacts.set(item.path, item);
  try {
    for (const [key, base] of [['production_migration_seed', 'packages/retrieval/versions/v1.1.0'], ['historical_evaluation_baseline', 'packages/retrieval']]) {
      const lane = receipt[key];
      add(lane.manifest);
      const manifest = await readJson(lane.manifest.path);
      for (const group of ['algorithm_files', 'files']) for (const entry of manifest[group] ?? []) {
        assert.ok(!entry.path.split(/[\\/]/).includes('..'), 'WP0_MANIFEST_PATH_TRAVERSAL');
        add({ path: `${base}/${entry.path}`, bytes: entry.bytes, file_sha256: entry.sha256 });
      }
      for (const entry of Object.values(lane.artifacts)) add(entry);
      if (lane.evaluation) { add(lane.evaluation.report); add(lane.evaluation.validation); }
    }
    for (const item of artifacts.values()) {
      assert.ok(!path.isAbsolute(item.path) && !item.path.split(/[\\/]/).includes('..'), 'WP0_ARTIFACT_PATH_TRAVERSAL');
      const bytes = await fs.readFile(path.join(repoRoot, mapping[item.path] ?? item.path));
      assert.equal(bytes.length, item.bytes, `WP0_HISTORICAL_BYTES:${item.path}`);
      assert.equal(sha256(bytes), item.file_sha256, `WP0_HISTORICAL_HASH:${item.path}`);
      await fs.mkdir(path.dirname(path.join(shadow, item.path)), { recursive: true });
      await fs.writeFile(path.join(shadow, item.path), bytes, { flag: 'wx' });
    }
    const result = await validateProductionBaseline({ repositoryRoot: shadow, receipt });
    return { ...result, algorithm_path_mapping: mapping, pinned_artifact_count: artifacts.size, predecessor_interpretation: 'historical evidence only; not current production metrics' };
  } finally { await fs.rm(shadow, { recursive: true, force: true }); }
}
export async function validateActiveLane() {
  const base = 'packages/retrieval/versions/v1.2.0';
  const manifest = await readJson(`${base}/manifests/corpus-manifest.json`);
  const pins = await pinFiles(repoRoot, manifest.files.map(file => `${base}/${file.path}`));
  for (const entry of manifest.files) {
    const actual = pins.find(pin => pin.path === `${base}/${entry.path}`);
    assert.equal(actual.bytes, entry.bytes, `WP0_ACTIVE_BYTES:${entry.path}`);
    assert.equal(actual.sha256, entry.sha256, `WP0_ACTIVE_HASH:${entry.path}`);
  }
  const corpus = await readJson(`${base}/corpus/corpus.json`);
  assert.equal(corpus.record_count, 3434, 'WP0_ACTIVE_COUNT');
  assert.deepEqual(corpus.source_slices, { 'cms-data-catalog': 159, 'cdc-socrata': 1472, 'census-api': 1803 });
  const records = [];
  for (const file of corpus.record_files) {
    for (const line of (await fs.readFile(path.join(repoRoot, base, 'corpus', file), 'utf8')).split(/\r?\n/).filter(Boolean)) records.push(JSON.parse(line));
  }
  assert.equal(records.length, corpus.record_count);
  assert.equal(new Set(records.map(record => record.record_id)).size, 3434, 'WP0_ACTIVE_DUPLICATE_IDS');
  const validation = validateCatalogRecords(records);
  assert.equal(validation.valid.length, 3430, 'WP0_ACTIVE_SEARCHABLE_COUNT');
  assert.equal(validation.invalid.length, 4, 'WP0_ACTIVE_ISOLATED_COUNT');
  return { status: 'PASS', corpus, manifest: (await pinFiles(repoRoot, [`${base}/manifests/corpus-manifest.json`]))[0], publication_files: pins,
    searchable_records: validation.valid.length, isolated_records: validation.invalid.map(item => ({ record_id: item.record_id, code: item.code })), projection: 'current runtime on-demand; historical algorithm pin is not its identity' };
}
export async function buildTechnicalEvidence() {
  const predecessors = await pinFiles(repoRoot, Object.keys(expectedPredecessors));
  for (const pin of predecessors) assert.equal(pin.sha256, expectedPredecessors[pin.path], `WP0_PREDECESSOR_CHANGED:${pin.path}`);
  const historical = await validateHistoricalLanes();
  const active = await validateActiveLane();
  const predecessor = await buildAggregateReceipt();
  assert.deepEqual(predecessor.blockers.map(item => item.check_id).sort(), ['product-boundary-and-non-goals', 'production-and-evaluation-baselines'], 'WP0_UNEXPECTED_PREDECESSOR_BLOCKER');
  const unaffected = predecessor.checks.filter(check => !['production-and-evaluation-baselines', 'product-boundary-and-non-goals'].includes(check.check_id));
  assert.equal(unaffected.length, 8);
  assert.ok(unaffected.every(check => check.status === 'PASS'), 'WP0_UNAFFECTED_PREREQUISITE_FAILED');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const { stdout } = await execute(process.execPath, ['--test', '--test-reporter=tap', 'tests/product-boundary.test.mjs'], { cwd: repoRoot, env, maxBuffer: 8 * 1024 * 1024 });
  const count = Number(stdout.match(/^# tests (\d+)$/m)?.[1]);
  assert.ok(count > 0 && stdout.includes(`# pass ${count}`) && stdout.includes('# fail 0') && stdout.includes('# skipped 0'), 'WP0_BOUNDARY_TEST_SUMMARY');
  const boundary = await buildProductBoundaryReceipt({ verifiedTestSummary: { success: true, counts: { tests: count, passed: count, failed: 0, skipped: 0 } } });
  const wp8 = await buildMetricSuccessorValidation();
  assert.ok(wp8.quality_gate_pass && wp8.safety_gate_pass && !wp8.release_ready && !wp8.production_eligibility, 'WP0_WP8_BOUNDARY_DRIFT');
  // Seal verification logic as well as product logic, including transitive
  // predecessor/WP8/evaluator implementations. Receipts are separate inputs.
  const verificationLogic = (await Promise.all(['verification', 'evaluation', 'packages', 'scripts'].map(root => listFiles(repoRoot, root))))
    .flat().filter(name => /\.(?:mjs|cjs|js|ts|tsx)$/.test(name));
  const names = ['verification/successor-support.mjs', 'package.json', 'package-lock.json', 'tests/product-boundary.test.mjs',
    ...verificationLogic, ...await listFiles(repoRoot, 'verification/wp0/v1.2.0'), ...await listFiles(repoRoot, 'packages/retrieval/tools'), ...await listFiles(repoRoot, 'worker')];
  return { status: 'PASS', predecessors, historical, active, unaffected_prerequisites: unaffected, product_boundary: boundary,
    wp8_development_gates: { quality_gate_pass: wp8.quality_gate_pass, safety_gate_pass: wp8.safety_gate_pass, release_ready: false },
    implementation_files: await pinFiles(repoRoot, names), open_gates: ['successor_authorized_review', 'AUTH-13', 'production_authorization'], release_ready: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSuccessorCli({ packageId, packageRoot, buildTechnicalEvidence }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
