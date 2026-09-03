import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBenchmark } from './benchmark-loader.mjs';
import { evaluateRun, loadMetricContract, metricContractSha256 } from './evaluator.mjs';
import { PROJECT_ROOT, sha256 } from './integrity.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`MISSING_ARGUMENT:${name}`);
  return path.resolve(process.argv[index + 1]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const inputPath = argument('--input');
    const cohortPath = argument('--cohort');
    const [inputBytes, cohortBytes, benchmark, metricContract] = await Promise.all([
      fs.readFile(inputPath),
      fs.readFile(cohortPath),
      loadBenchmark(),
      loadMetricContract()
    ]);
    const algorithmPins = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'evaluation/bridge/v1.0.0/manifests/algorithm-pins.json'), 'utf8'));
    const input = JSON.parse(inputBytes.toString('utf8'));
    const cohort = JSON.parse(cohortBytes.toString('utf8'));
    const algorithmKey = input.lane_id.endsWith('_legacy') ? 'legacy' : input.lane_id.endsWith('_production_worker') ? 'production_worker' : null;
    if (!algorithmKey) throw new Error(`ALGORITHM_LANE_UNRECOGNIZED:${input.lane_id}`);
    const cohortManifestSha256 = sha256(cohortBytes);
    if (cohortManifestSha256 !== '4ae553d0f6c1f06462fd523b368098d2d85502291cb8718f7c503f430b5205b8') throw new Error(`COHORT_PIN_MISMATCH:${cohortManifestSha256}`);
    const report = await evaluateRun(input, {
      benchmark,
      cohort,
      metricContract,
      expectedPins: {
        benchmark_pin_sha256: benchmark.pin_sha256,
        cohort_manifest_sha256: cohortManifestSha256,
        metric_contract_sha256: await metricContractSha256(),
        algorithm_fingerprint_sha256: algorithmPins.algorithms[algorithmKey].algorithm_fingerprint_sha256
      },
      requireCompleteBenchmark: true
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
