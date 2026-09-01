import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { normalizedSubmissionFromGold, packagePaths, SAFETY_STRATA } from '../tools/benchmark-definition.mjs';
import { evaluatePlannerSubmission, loadFrozenSplit } from '../tools/evaluator.mjs';
import { validateOwnerEvidence } from '../tools/apply-owner-ratification.mjs';
import { validatePackage } from '../tools/validate-package.mjs';

test('package, component seals, provenance pins, strata and runtime boundary validate', async () => {
  const receipt = await validatePackage();
  assert.equal(receipt.status, 'PASS');
  assert.deepEqual(receipt.split_counts, { development: 50, validation: 50, held_out: 50 });
  assert(receipt.held_out_minimum_stratum_count >= 10);
  assert.equal(receipt.held_out_scoring_performed, false);
  assert.equal(receipt.wp10b_authorized, false);
});

for (const split of ['development', 'validation']) {
  test(`${split} perfect normalized audit records pass every frozen metric`, async () => {
    const splitData = await loadFrozenSplit(split);
    const report = await evaluatePlannerSubmission({ split, records: normalizedSubmissionFromGold(splitData) });
    assert.equal(report.result, 'PASS');
    assert.equal(report.aggregate_only, true);
    assert.equal(report.item_level_judgments_included, false);
    assert.equal(report.raw_question_text_included, false);
    assert.equal(report.raw_user_queries_persisted, 0);
    assert(Object.values(report.usefulness).every(metric => metric.pass));
    assert(Object.values(report.safety.strata).every(stratum => stratum.pass));
  });
}

test('one semantic safety violation is release-blocking overall and in its stratum', async () => {
  const splitData = await loadFrozenSplit('validation');
  const records = normalizedSubmissionFromGold(splitData);
  const target = records.find(record => splitData.questions.find(question => question.question_id === record.question_id).safety_strata.includes('join_evidence'));
  target.safety_violations.push('candidate_join_upgraded');
  const report = await evaluatePlannerSubmission({ split: 'validation', records });
  assert.equal(report.result, 'FAIL');
  assert.equal(report.safety.metrics.candidate_join_upgrade.numerator, 1);
  assert.equal(report.safety.metrics.candidate_join_upgrade.pass, false);
  assert.equal(report.safety.strata.join_evidence.pass, false);
});

test('deterministic atomic formulas expose exact numerators and denominator failures', async () => {
  const splitData = await loadFrozenSplit('development');
  const records = normalizedSubmissionFromGold(splitData);
  const target = records.find(record => record.essential_role_ids.length > 0 && record.exact_selections.length > 0);
  const removedRole = target.essential_role_ids.pop();
  target.exact_selections.push({
    asset_id: 'bench:asset:unnecessary',
    release_id: 'bench:release:unnecessary:v1',
    distribution_id: 'bench:distribution:unnecessary:v1',
    access_route_id: 'bench:access-route:unnecessary:public',
    source_id: 'bench:source:unnecessary'
  });
  const report = await evaluatePlannerSubmission({ split: 'development', records });
  assert.equal(report.usefulness.essential_role_recall.denominator - report.usefulness.essential_role_recall.numerator >= 1, true, removedRole);
  assert.equal(report.usefulness.unnecessary_source_rate.numerator, 1);
  assert.equal(report.usefulness.exact_asset_precision.denominator - report.usefulness.exact_asset_precision.numerator, 1);
  assert.equal(report.result, 'FAIL');
});

test('held-out gold cannot be scored by ordinary tests or without final-gate authorization', async () => {
  await assert.rejects(
    () => evaluatePlannerSubmission({ split: 'held_out', records: [] }),
    /requires final release authorization/u
  );
});

test('audit records reject raw-question and other undeclared persistence fields', async () => {
  const splitData = await loadFrozenSplit('development');
  const records = normalizedSubmissionFromGold(splitData);
  records[0].raw_question = 'must never enter an evaluator report';
  await assert.rejects(
    () => evaluatePlannerSubmission({ split: 'development', records }),
    /forbidden\/unknown fields: raw_question/u
  );
});

test('held-out manifest alone proves every safety-critical denominator floor', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packagePaths.packageRoot, 'manifests/benchmark-manifest.json'), 'utf8'));
  assert.equal(manifest.splits.held_out.case_count, 50);
  for (const stratum of SAFETY_STRATA) assert(manifest.splits.held_out.safety_stratum_counts[stratum] >= 10, stratum);
  assert.equal(manifest.held_out_controls.final_release_candidate_run_only, true);
});

test('AUTH-12 owner packet is complete, digest-only, and cannot itself authorize WP10B', async () => {
  const packetBytes = await fs.readFile(path.join(packagePaths.packageRoot, 'governance/owner-review-packet.json'), 'utf8');
  const packet = JSON.parse(packetBytes);
  assert.deepEqual(Object.keys(packet.approval_digests), ['benchmark_manifest_digest', 'evaluator_contract_digest', 'review_subject_digest']);
  assert.equal(packet.review_subject.usefulness_metrics.length, 12);
  assert.equal(packet.review_subject.safety_metrics.length, 14);
  assert.equal(packet.review_subject.required_question_strata.length, 9);
  assert.equal(packet.current_state.wp10b_authorized, false);
  assert.equal(packet.held_out_boundary.item_level_held_out_gold_in_packet, false);
  assert(!packetBytes.includes('PLAN-V1-H'));
  assert(!packetBytes.includes('benchmark/held_out/'));
});

test('owner applicator rejects incomplete evidence without reading held-out gold', async () => {
  const packet = JSON.parse(await fs.readFile(path.join(packagePaths.packageRoot, 'governance/owner-review-packet.json'), 'utf8'));
  assert.throws(() => validateOwnerEvidence({
    packet,
    evidence: {
      evidence_version: 'observatory-planner-owner-approval-evidence.v1.0.0',
      external_authorization_id: 'AUTH-12',
      approval_digests: packet.approval_digests,
      approvals: []
    },
    rawEvidenceBytes: Buffer.from('{}')
  }), /Exactly three approvals are required/u);
});
