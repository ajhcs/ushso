import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackageArtifacts } from './build-package.mjs';
import { PACKAGE_ROOT, prettyJson } from './integrity.mjs';

export async function validatePackage() {
  const expected = await buildPackageArtifacts();
  const [manifestBytes, receiptBytes] = await Promise.all([
    fs.readFile(path.join(PACKAGE_ROOT, 'manifests/package-manifest.json')),
    fs.readFile(path.join(PACKAGE_ROOT, 'validation/validation-receipt.json'))
  ]);
  if (!manifestBytes.equals(expected.manifestBytes)) throw new Error('EVALUATOR_PACKAGE_MANIFEST_DRIFT');
  if (!receiptBytes.equals(expected.receiptBytes)) throw new Error('EVALUATOR_VALIDATION_RECEIPT_DRIFT');
  return {
    status: 'PASS',
    package_id: expected.manifest.package_id,
    files: expected.manifest.file_count,
    package_manifest_sha256: expected.receipt.package_manifest_sha256,
    benchmark_pin_sha256: expected.receipt.benchmark_pin_sha256,
    metric_contract_sha256: expected.receipt.metric_contract_sha256,
    external_requests: 0
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(prettyJson(await validatePackage()));
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
