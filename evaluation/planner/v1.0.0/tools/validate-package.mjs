import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBenchmarkArtifacts, COMPONENTS, packagePaths, SAFETY_STRATA, SPLITS } from './benchmark-definition.mjs';
import { buildPackage } from './build-package.mjs';
import { canonicalJson, deepEqual, sha256 } from './common.mjs';

const codeExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const skipSegments = new Set(['node_modules', '.git', 'tests', 'fixtures', 'evaluation', 'verification']);

async function walkCode(directory, relativeRoot) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    if (skipSegments.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = `${relativeRoot}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await walkCode(absolute, relative));
    else if (codeExtensions.has(path.extname(entry.name))) result.push(relative);
  }
  return result;
}

async function verifyRuntimeLeakage(policy, benchmarkManifest) {
  const markers = [...policy.forbidden_runtime_markers, benchmarkManifest.manifest_digest];
  const violations = [];
  for (const root of policy.runtime_roots) {
    const files = await walkCode(path.join(packagePaths.repoRoot, root), root);
    for (const file of files) {
      const bytes = await fs.readFile(path.join(packagePaths.repoRoot, file), 'utf8');
      for (const marker of markers) if (bytes.includes(marker)) violations.push({ file, marker });
    }
  }
  assert.deepEqual(violations, [], `Production runtime benchmark leakage: ${JSON.stringify(violations)}`);
  return markers.length;
}

async function verifyPinnedInputs(provenance) {
  let checks = 0;
  for (const input of provenance.inputs.filter(item => ['migrated_synthetic_fixture', 'normative_contract_pin'].includes(item.disposition))) {
    for (const artifact of input.artifacts) {
      const bytes = await fs.readFile(path.join(packagePaths.repoRoot, artifact.path));
      assert.equal(sha256(bytes), artifact.sha256, `Pinned provenance drift: ${artifact.path}`);
      checks += 1;
    }
  }
  return checks;
}

export async function validatePackage() {
  const { benchmarkManifest, packageManifest, artifacts } = await buildPackage({ write: false });
  const actualBenchmarkManifest = JSON.parse(await fs.readFile(path.join(packagePaths.packageRoot, 'manifests/benchmark-manifest.json'), 'utf8'));
  const actualPackageManifest = JSON.parse(await fs.readFile(path.join(packagePaths.packageRoot, 'manifests/package-manifest.json'), 'utf8'));
  assert(deepEqual(actualBenchmarkManifest, benchmarkManifest), 'Benchmark manifest differs from deterministic build');
  assert(deepEqual(actualPackageManifest, packageManifest), 'Package manifest differs from deterministic build');
  let checks = 2;

  const { splitData, inputs } = await buildBenchmarkArtifacts();
  const allIds = new Set();
  const allTopics = new Set();
  const allQuestions = new Set();
  for (const split of SPLITS) {
    const data = splitData[split];
    assert.equal(data.questions.length, 50, `${split} case count`);
    assert.equal(benchmarkManifest.splits[split].case_count, 50, `${split} manifest count`);
    assert.equal(benchmarkManifest.splits[split].legacy_migration_count, 20, `${split} migration count`);
    assert.equal(benchmarkManifest.splits[split].synthetic_augmentation_count, 30, `${split} augmentation count`);
    assert(benchmarkManifest.splits[split].clarification_gold_denominator >= 10, `${split} clarification denominator floor`);
    checks += 5;
    for (const component of COMPONENTS) {
      const info = benchmarkManifest.splits[split].components[component];
      assert(info, `${split}.${component} manifest component missing`);
      assert.equal(info.records, 50, `${split}.${component} records`);
      const actualBytes = await fs.readFile(path.join(packagePaths.packageRoot, info.path), 'utf8');
      assert.equal(actualBytes, artifacts.get(info.path), `${info.path} differs from deterministic build`);
      assert.equal(sha256(actualBytes), info.sha256, `${info.path} digest mismatch`);
      checks += 4;
    }
    for (const stratum of SAFETY_STRATA) {
      const count = benchmarkManifest.splits[split].safety_stratum_counts[stratum];
      assert(count >= 10, `${split}.${stratum} has ${count}; expected at least 10`);
      checks += 1;
    }
    for (const question of data.questions) {
      assert.equal(question.synthetic_only, true, `${question.question_id} must be synthetic`);
      assert(!('raw_question' in question) && !('user_id' in question) && !('request_id' in question), `${question.question_id} contains privacy-forbidden fields`);
      assert(!allIds.has(question.question_id), `Duplicate question ID ${question.question_id}`);
      assert(!allTopics.has(question.topic_cluster), `Cross-split topic leakage ${question.topic_cluster}`);
      assert(!allQuestions.has(question.synthetic_question), `Exact cross-split question leakage ${question.synthetic_question}`);
      allIds.add(question.question_id);
      allTopics.add(question.topic_cluster);
      allQuestions.add(question.synthetic_question);
      checks += 5;
    }
  }
  assert.equal(allIds.size, 150);
  assert.equal(benchmarkManifest.splits.held_out.case_count >= benchmarkManifest.held_out_controls.minimum_case_count, true);
  assert.equal(benchmarkManifest.held_out_controls.tuning_permitted, false);
  assert.equal(benchmarkManifest.held_out_controls.ordinary_ci_scoring_permitted, false);
  assert.equal(benchmarkManifest.held_out_controls.item_level_report_permitted, false);
  checks += 5;

  assert.equal(inputs.evaluatorContract.usefulness_metrics.length, 12, 'All twelve usefulness targets must be frozen');
  assert(inputs.evaluatorContract.usefulness_metrics.every(metric => metric.formula && metric.numerator_unit && metric.denominator_unit && metric.partial_credit && metric.overall_denominator_floor && Number.isInteger(metric.per_stratum_denominator_floor)), 'Metric formula contract incomplete');
  assert.equal(inputs.evaluatorContract.safety_metrics.filter(metric => metric.target === 0).length, 9, 'Nine zero-tolerance semantic hazards expected');
  assert(inputs.evaluatorContract.safety_metrics.every(metric => metric.formula && metric.numerator_unit && metric.denominator_unit && Number.isInteger(metric.denominator_floor)), 'Safety metric formula contract incomplete');
  assert(inputs.evaluatorContract.required_question_strata.every(stratum => stratum.safety_critical && stratum.held_out_case_floor >= 10 && stratum.safety_floor === 1), 'Safety stratum floors incomplete');
  checks += 5;

  assert.deepEqual(inputs.ratification.owners.map(owner => owner.role), ['product', 'research_methods', 'engineering']);
  assert(inputs.ratification.owners.every(owner => owner.status === 'pending' && owner.ratified_by === null), 'WP10A must not fabricate owner ratification');
  assert.equal(inputs.ratification.wp10b_authorized, false, 'WP10B cannot be authorized before owner ratification');
  checks += 3;

  const ownerPacketBytes = artifacts.get('governance/owner-review-packet.json');
  const ownerPacket = JSON.parse(ownerPacketBytes);
  assert.equal(ownerPacket.external_authorization_id, 'AUTH-12');
  assert.deepEqual(Object.keys(ownerPacket.approval_digests), ['benchmark_manifest_digest', 'evaluator_contract_digest', 'review_subject_digest']);
  assert.equal(ownerPacket.approval_digests.benchmark_manifest_digest, benchmarkManifest.manifest_digest);
  assert.equal(ownerPacket.approval_digests.evaluator_contract_digest, `sha256:${benchmarkManifest.contract_pins.evaluator_contract_sha256}`);
  assert.equal(ownerPacket.approval_digests.review_subject_digest, `sha256:${sha256(canonicalJson(ownerPacket.review_subject))}`);
  assert.equal(ownerPacket.review_subject.usefulness_metrics.length, 12);
  assert.equal(ownerPacket.review_subject.safety_metrics.length, 14);
  assert.equal(ownerPacket.review_subject.required_question_strata.length, 9);
  assert.equal(ownerPacket.required_approvals.length, 3);
  assert(ownerPacket.required_approvals.every(item => item.exact_attestation.includes('three exact approval digests') && item.exact_attestation.includes('did not inspect or use item-level held-out')));
  assert.equal(ownerPacket.held_out_boundary.item_level_held_out_gold_in_packet, false);
  assert.equal(ownerPacket.held_out_boundary.applicator_reads_held_out_gold, false);
  assert.equal(ownerPacket.current_state.wp10b_authorized, false);
  assert(!ownerPacketBytes.includes('PLAN-V1-H') && !ownerPacketBytes.includes('benchmark/held_out/'), 'Owner packet exposes item-level held-out identifiers or paths');
  checks += 14;

  checks += await verifyPinnedInputs(inputs.provenance);
  checks += await verifyRuntimeLeakage(inputs.leakagePolicy, benchmarkManifest);

  const packageManifestWithoutDigest = { ...packageManifest };
  delete packageManifestWithoutDigest.manifest_digest;
  assert.equal(packageManifest.manifest_digest, `sha256:${sha256(canonicalJson(packageManifestWithoutDigest))}`, 'Package manifest digest mismatch');
  const benchmarkManifestWithoutDigest = { ...benchmarkManifest };
  delete benchmarkManifestWithoutDigest.manifest_digest;
  assert.equal(benchmarkManifest.manifest_digest, `sha256:${sha256(canonicalJson(benchmarkManifestWithoutDigest))}`, 'Benchmark manifest digest mismatch');
  checks += 2;

  return {
    status: 'PASS',
    package_id: packageManifest.package_id,
    benchmark_manifest_digest: benchmarkManifest.manifest_digest,
    package_manifest_digest: packageManifest.manifest_digest,
    split_counts: Object.fromEntries(SPLITS.map(split => [split, benchmarkManifest.splits[split].case_count])),
    held_out_minimum_stratum_count: Math.min(...Object.values(benchmarkManifest.splits.held_out.safety_stratum_counts)),
    check_count: checks,
    external_requests: 0,
    held_out_scoring_performed: false,
    wp10b_authorized: false
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.stdout.write(`${JSON.stringify(await validatePackage())}\n`);
}
