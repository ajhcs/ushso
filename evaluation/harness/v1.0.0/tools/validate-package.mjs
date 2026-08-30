import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPublishedBenchmark } from './benchmark-loader.mjs';
import { evaluateRun } from './evaluator.mjs';
import { validateRecord } from './schema-validator.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDES = new Set(['manifests/package-manifest.json', 'validation/validation-receipt.json']);

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function json(relative) { return JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, relative), 'utf8')); }
async function jsonl(relative) { return (await fs.readFile(path.join(PACKAGE_ROOT, relative), 'utf8')).split(/\r?\n/).filter(line => line.trim()).map(JSON.parse); }

async function listFiles(directory = PACKAGE_ROOT, prefix = '') {
  const files = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (!EXCLUDES.has(relative)) files.push(relative);
  }
  return files;
}

async function fixtureBenchmark() {
  const root = 'fixtures/benchmark';
  const { assembleBenchmark } = await import('./benchmark-loader.mjs');
  return assembleBenchmark({
    questions: await jsonl(`${root}/questions.jsonl`),
    positiveJudgments: await jsonl(`${root}/relevance_judgments.jsonl`),
    negativeJudgments: await jsonl(`${root}/negative_judgments.jsonl`),
    answerPlans: await jsonl(`${root}/answer_plans.jsonl`),
    bundles: await jsonl(`${root}/bundle_gold.jsonl`),
    sourceReferenceIndex: await json(`${root}/source_reference_index.json`)
  }, { mode: 'test_fixture', source: 'fixtures/benchmark (validation only)' });
}

async function validate() {
  const checks = [];
  const add = (id, passed, detail = '') => checks.push({ id, passed, detail });
  const schemas = {};
  for (const name of ['runner-input', 'question-evaluation', 'run-report', 'package-manifest', 'validation-receipt']) {
    schemas[name] = await json(`schemas/${name}.schema.json`);
    add(`schema_loaded:${name}`, schemas[name]?.additionalProperties === false);
  }

  const published = await loadPublishedBenchmark();
  add('published_benchmark_bound', published.mode === 'published' && published.questions.length === 60 && published.positiveJudgments.length === 115 && published.negativeJudgments.length === 82);
  const validInput = await json('fixtures/runner-input.valid.json');
  const zeroInput = await json('fixtures/runner-input.zero-result.json');
  const invalidInput = await json('fixtures/runner-input.invalid-extra-property.json');
  add('valid_input_schema', validateRecord(validInput, schemas['runner-input']).length === 0);
  add('zero_input_schema', validateRecord(zeroInput, schemas['runner-input']).length === 0);
  add('invalid_input_rejected', validateRecord(invalidInput, schemas['runner-input']).length > 0);

  const benchmark = await fixtureBenchmark();
  const report = await evaluateRun(validInput, { benchmark });
  const zeroReport = await evaluateRun(zeroInput, { benchmark });
  add('report_schema', validateRecord(report, schemas['run-report']).length === 0);
  add('question_output_schema', report.question_evaluations.every(item => validateRecord(item, schemas['question-evaluation']).length === 0));
  add('deterministic_runner', JSON.stringify(report) === JSON.stringify(await evaluateRun(validInput, { benchmark })));
  add('top_k_metrics', report.question_evaluations[0].top_k[0].must_not_miss_recall === 0.5 && report.question_evaluations[0].top_k[1].must_not_miss_recall === 1);
  add('access_provenance_restriction_metrics', report.question_evaluations[0].access_state_correctness.score === 1 && report.question_evaluations[0].provenance_completeness.score === 1 && report.question_evaluations[0].important_restriction_coverage.score === 1);
  add('join_route_metrics', report.question_evaluations[0].join_route_correctness.proposal_score === 1 && report.question_evaluations[0].join_route_correctness.crosswalk_coverage === 1);
  add('zero_result_not_absence', zeroReport.question_evaluations[0].zero_result_not_absence.valid === true && zeroReport.question_evaluations[0].top_k.every(item => item.must_not_miss_recall === 0));

  const productionTools = ['tools/benchmark-loader.mjs', 'tools/evaluator.mjs', 'tools/run-evaluation.mjs', 'tools/schema-validator.mjs'];
  const prohibited = [/\bfetch\s*\(/i, /node:https?/i, /\baxios\b/i, /\bchild_process\b/i, /\bopenai\b/i, /\banthropic\b/i, /pipeline_guard/i];
  const matches = [];
  for (const relative of productionTools) {
    const source = await fs.readFile(path.join(PACKAGE_ROOT, relative), 'utf8');
    if (prohibited.some(pattern => pattern.test(source))) matches.push(relative);
  }
  add('offline_no_llm_no_lock_capability', matches.length === 0, matches.join(','));
  const loaderSource = await fs.readFile(path.join(PACKAGE_ROOT, 'tools/benchmark-loader.mjs'), 'utf8');
  add('fixture_fallback_absent_from_production_loader', !loaderSource.includes('fixtures/benchmark'));

  const manifestBytes = await fs.readFile(path.join(PACKAGE_ROOT, 'manifests/package-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  add('manifest_schema', validateRecord(manifest, schemas['package-manifest']).length === 0);
  const actualFiles = await listFiles();
  const recordedFiles = manifest.files.map(item => item.path).sort((left, right) => left.localeCompare(right));
  add('manifest_file_set', JSON.stringify(actualFiles) === JSON.stringify(recordedFiles));
  const fileErrors = [];
  let payloadBytes = 0;
  for (const entry of manifest.files) {
    const bytes = await fs.readFile(path.join(PACKAGE_ROOT, entry.path));
    payloadBytes += bytes.length;
    if (entry.bytes !== bytes.length || entry.sha256 !== sha256(bytes)) fileErrors.push(entry.path);
  }
  add('manifest_hashes', fileErrors.length === 0, fileErrors.join(','));
  add('manifest_counts', manifest.file_count === manifest.files.length && manifest.payload_bytes === payloadBytes);
  add('prohibited_actions_closed', manifest.external_requests === 0 && manifest.ranking_optimization_performed === false && manifest.llm_used === false && manifest.identity_work_performed === false && manifest.coverage_execution_performed === false && manifest.heavy_analysis_lock_touched === false);

  const receipt = await json('validation/validation-receipt.json');
  add('receipt_schema', validateRecord(receipt, schemas['validation-receipt']).length === 0);
  add('receipt_manifest_binding', receipt.package_manifest_sha256 === sha256(manifestBytes));
  add('receipt_benchmark_binding', receipt.benchmark_binding?.package_manifest_sha256 === (await json('benchmark-pin.json')).files.find(item => item.path === 'package_manifest.json').sha256);

  const failures = checks.filter(check => !check.passed);
  return { ok: failures.length === 0, check_count: checks.length, failure_count: failures.length, external_requests: 0, errors: failures, package_manifest_sha256: sha256(manifestBytes) };
}

const result = await validate();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
