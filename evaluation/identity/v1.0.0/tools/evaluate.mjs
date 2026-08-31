import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { benchmarkCaseDigest, buildBenchmarkCases } from "../src/cases.mjs";
import { evaluateIdentityBenchmark } from "../src/evaluate.mjs";
import { runConformancePredictions } from "../src/predict.mjs";
import { validateEvaluationPackage } from "./validate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fs.readFile(path.join(root, "benchmark/manifest.json"), "utf8"));
const cases = buildBenchmarkCases(manifest);
const digest = benchmarkCaseDigest(cases);
if (cases.length !== manifest.expected_case_count || digest !== manifest.expected_case_sha256) {
  throw new Error(`BENCHMARK_SEAL_MISMATCH expected=${manifest.expected_case_sha256} actual=${digest}`);
}
const evaluation = evaluateIdentityBenchmark({
  cases,
  predictions: runConformancePredictions(cases),
  adjudications: [],
  reversalChecks: [],
});
const artifactValidation = await validateEvaluationPackage();
process.stdout.write(`${JSON.stringify({ manifest, case_digest: digest, evaluation, artifact_validation: artifactValidation }, null, 2)}\n`);
