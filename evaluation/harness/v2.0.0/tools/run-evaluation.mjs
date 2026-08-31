import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBenchmark } from './benchmark-loader.mjs';
import { evaluateRun, loadMetricContract, metricContractSha256 } from './evaluator.mjs';
import { sha256 } from './integrity.mjs';

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
    const input = JSON.parse(inputBytes.toString('utf8'));
    const cohort = JSON.parse(cohortBytes.toString('utf8'));
    const report = await evaluateRun(input, {
      benchmark,
      cohort,
      metricContract,
      expectedPins: {
        benchmark_pin_sha256: benchmark.pin_sha256,
        cohort_manifest_sha256: sha256(cohortBytes),
        metric_contract_sha256: await metricContractSha256()
      }
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
