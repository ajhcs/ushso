import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRIDGE_ROOT } from './build-cohort.mjs';
import { runBridge } from './run-bridge.mjs';
import { listFiles, prettyJson, readJson, sha256 } from '../../../harness/v2.0.0/tools/integrity.mjs';

async function validatePackageManifest() {
  const manifestPath = path.join(BRIDGE_ROOT, 'manifests/package-manifest.json');
  const manifest = await readJson(manifestPath);
  if (manifest.manifest_version !== 'ushso-retrieval-bridge-package-manifest.v1') throw new Error('BRIDGE_PACKAGE_MANIFEST_VERSION_INVALID');
  const relativeFiles = await listFiles(BRIDGE_ROOT, new Set(['manifests/package-manifest.json']));
  if (relativeFiles.length !== manifest.file_count) throw new Error(`BRIDGE_PACKAGE_FILE_COUNT_MISMATCH:${relativeFiles.length}:${manifest.file_count}`);
  const expectedByPath = new Map(manifest.files.map(item => [item.path, item]));
  let payloadBytes = 0;
  for (const relative of relativeFiles) {
    const bytes = await fs.readFile(path.join(BRIDGE_ROOT, relative));
    payloadBytes += bytes.length;
    const expected = expectedByPath.get(relative);
    if (!expected || expected.bytes !== bytes.length || expected.sha256 !== sha256(bytes)) throw new Error(`BRIDGE_PACKAGE_FILE_MISMATCH:${relative}`);
  }
  if (payloadBytes !== manifest.payload_bytes) throw new Error('BRIDGE_PACKAGE_PAYLOAD_BYTES_MISMATCH');
  if (manifest.external_requests !== 0 || manifest.ranking_optimization_performed !== false || manifest.source_payloads_accessed !== 0 || manifest.analyses_executed !== 0) {
    throw new Error('BRIDGE_PACKAGE_BOUNDARY_INVALID');
  }
  return manifest;
}

export async function validateBridge() {
  const recomputed = await runBridge({ write: false });
  for (const [relative, expectedBytes] of recomputed.generated) {
    const actual = await fs.readFile(path.join(BRIDGE_ROOT, relative));
    if (!actual.equals(expectedBytes)) throw new Error(`BRIDGE_GENERATED_OUTPUT_DRIFT:${relative}`);
  }
  const storedReceiptBytes = await fs.readFile(path.join(BRIDGE_ROOT, 'receipts/bridge-receipt.json'));
  if (!storedReceiptBytes.equals(Buffer.from(prettyJson(recomputed.receipt)))) throw new Error('BRIDGE_RECEIPT_DRIFT');
  const storedReceipt = JSON.parse(storedReceiptBytes.toString('utf8'));
  if (storedReceipt.status !== 'PASS' || storedReceipt.output_count !== recomputed.generated.size) throw new Error('BRIDGE_RECEIPT_STATUS_INVALID');
  if (storedReceipt.release_gate_status !== 'FAIL_PRE_TUNING' || storedReceipt.release_gate_pass !== false) throw new Error('BRIDGE_RELEASE_GATE_STATUS_INVALID');
  if (storedReceipt.consolidated_v2_algorithm_available !== false || storedReceipt.execution_boundary.ranking_optimization_performed !== false) throw new Error('BRIDGE_ALGORITHM_BOUNDARY_INVALID');
  const manifest = await validatePackageManifest();
  const historical = recomputed.matrix.lanes.find(item => item.lane_id === 'c143_legacy');
  const sameAlgorithmCurrent = recomputed.matrix.lanes.find(item => item.lane_id === 'c157_legacy');
  const current = recomputed.matrix.lanes.find(item => item.lane_id === 'c157_production_worker');
  if (historical.metrics['10'].full_essential_recall_macro !== 0.5) throw new Error('BRIDGE_HISTORICAL_RECALL_DRIFT');
  if (recomputed.cohort.counts.sources.total !== 36 || recomputed.cohort.counts.requirements.total !== 115) throw new Error('BRIDGE_COHORT_COVERAGE_INVALID');
  return {
    status: 'PASS',
    package_id: manifest.package_id,
    package_files: manifest.file_count,
    output_count: storedReceipt.output_count,
    corpus_manifest_sha256: storedReceipt.corpus_pins,
    algorithm_fingerprint_sha256: storedReceipt.algorithm_pins,
    cohort_manifest_sha256: storedReceipt.cohort_manifest_sha256,
    historical_full_recall_at_10: historical.metrics['10'].full_essential_recall_macro,
    current_same_algorithm_pre_tuning: {
      full_recall_at_3: sameAlgorithmCurrent.metrics['3'].full_essential_recall_macro,
      full_recall_at_10: sameAlgorithmCurrent.metrics['10'].full_essential_recall_macro,
      present_recall_at_5: sameAlgorithmCurrent.metrics['5'].present_essential_recall_macro,
      present_recall_at_10: sameAlgorithmCurrent.metrics['10'].present_essential_recall_macro,
      present_graded_precision_at_5: sameAlgorithmCurrent.metrics['5'].present_graded_acceptable_precision
    },
    current_observed_worker_pre_tuning: {
      full_recall_at_3: current.metrics['3'].full_essential_recall_macro,
      full_recall_at_10: current.metrics['10'].full_essential_recall_macro,
      present_recall_at_5: current.metrics['5'].present_essential_recall_macro,
      present_recall_at_10: current.metrics['10'].present_essential_recall_macro,
      present_graded_precision_at_5: current.metrics['5'].present_graded_acceptable_precision
    },
    corpus_delta: recomputed.matrix.corpus_delta_summary,
    consolidated_v2_algorithm_available: false,
    external_requests: 0
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(prettyJson(await validateBridge()));
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
