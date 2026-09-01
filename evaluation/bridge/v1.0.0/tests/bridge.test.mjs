import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../../../harness/v2.0.0/tools/integrity.mjs';
import { runBridge } from '../tools/run-bridge.mjs';

const bridge = runBridge({ write: false });

function lane(result, laneId) {
  return result.lanes.find(candidate => candidate.laneId === laneId);
}

function metric(result, laneId, cohort, k) {
  return lane(result, laneId).report.metrics[cohort].top_k.find(item => item.k === k);
}

test('the bridge pins the exact 143 and 157 corpus generations', async () => {
  const result = await bridge;
  assert.equal(result.corpusPins.c143.record_count, 143);
  assert.equal(result.corpusPins.c143.corpus_manifest_sha256, '5622272ded52b0cbf039da47114142f8cb35ba634e8a6bbb9ee55b0ecd70511c');
  assert.equal(result.corpusPins.c143.content_fingerprint_sha256, '0e676ada3d601275083615a3f7804781eef1c183cb1b7efcf7ec8044fce33b3d');
  assert.equal(result.corpusPins.c157.record_count, 157);
  assert.equal(result.corpusPins.c157.corpus_manifest_sha256, '23f704ce3e421a6eb26c2b3677d616a1ae6b4f45226233257b9a1ff676caba2b');
  assert.equal(result.corpusPins.c157.content_fingerprint_sha256, 'adcfb56babc981a4c7dfc787af86d56f5fb2a31e84de02f9db8c93f0548b5d03');
  assert.equal(result.corpusPins.c143.join_route_count, 14);
  assert.equal(result.corpusPins.c157.join_route_count, 14);
});

test('the corpus delta distinguishes records, projections, vocabulary, and routes', async () => {
  const { corpusDelta } = await bridge;
  assert.equal(corpusDelta.records.added, 14);
  assert.equal(corpusDelta.records.changed_existing, 0);
  assert.equal(corpusDelta.records.removed, 0);
  assert.equal(corpusDelta.search_documents.changed_existing, 37);
  assert.deepEqual([...new Set(corpusDelta.search_documents.changes.flatMap(change => change.changed_top_level_fields))], ['search_text']);
  assert.deepEqual(corpusDelta.vocabulary.added_subject_ids, ['geography_access']);
  assert.deepEqual(corpusDelta.vocabulary.removed_subject_ids, []);
  assert.equal(corpusDelta.join_routes.bytes_identical, true);
});

test('the reviewed present-source cohort is exhaustive and preserves missing gold', async () => {
  const { cohort } = await bridge;
  assert.deepEqual(cohort.counts.sources, { total: 36, present_search_eligible: 18, present_but_excluded: 0, missing: 18 });
  assert.deepEqual(cohort.counts.requirements, { total: 115, present_search_eligible: 79, present_but_excluded: 0, missing: 36 });
  assert.deepEqual(cohort.counts.essential_requirements, { total: 78, present_search_eligible: 48, present_but_excluded: 0, missing: 30 });
  assert.equal(cohort.counts.asset_bindings, 27);
  assert.equal(cohort.source_classifications.length, 36);
  assert.equal(cohort.requirements.length, 115);
});

test('same-algorithm corpus lanes are directly comparable and historical recall remains 0.50', async () => {
  const result = await bridge;
  assert.deepEqual(result.lanes.map(item => item.laneId), [
    'c143_legacy',
    'c157_legacy',
    'c143_production_worker',
    'c157_production_worker'
  ]);
  assert.equal(lane(result, 'c143_legacy').input.pins.algorithm_fingerprint_sha256, lane(result, 'c157_legacy').input.pins.algorithm_fingerprint_sha256);
  assert.deepEqual(result.receipt.primary_same_algorithm_bridge, {
    from_lane: 'c143_legacy',
    to_lane: 'c157_legacy',
    algorithm_fingerprint_sha256: result.algorithmPins.legacy.algorithm_fingerprint_sha256
  });
  assert.equal(metric(result, 'c143_legacy', 'full_benchmark', 10).essential_recall.macro.score, 0.5);
  assert.deepEqual(metric(result, 'c143_legacy', 'full_benchmark', 10).essential_recall.macro, { numerator: 21, denominator: 42, score: 0.5 });
  for (const item of result.lanes) {
    assert.equal(item.report.question_count, 60);
    assert.deepEqual(item.report.split_counts, { development: 20, validation: 20, held_out: 20 });
    assert.equal(item.report.execution_boundary.ranking_optimization_performed, false);
  }
  assert.deepEqual(result.lanes.map(item => item.report.safety.prohibited_by_access_recommendations), [6, 4, 4, 3]);
  assert.ok(result.lanes.every(item => item.report.safety.zero_tolerance_pass === false));
});

test('the observed Worker lane is pinned but never presented as a consolidated v2 algorithm', async () => {
  const result = await bridge;
  assert.notEqual(result.algorithmPins.legacy.algorithm_fingerprint_sha256, result.algorithmPins.production_worker.algorithm_fingerprint_sha256);
  assert.equal(result.algorithmPins.legacy.consolidated_v2_algorithm, false);
  assert.equal(result.algorithmPins.production_worker.consolidated_v2_algorithm, false);
  assert.equal(result.matrix.interpretation.consolidated_v2_algorithm_available, false);
  assert.equal(result.matrix.unavailable_lanes.length, 2);
  assert.ok(result.matrix.unavailable_lanes.every(item => item.status === 'unavailable'));
  assert.equal(result.receipt.consolidated_v2_algorithm_available, false);
  assert.equal(result.receipt.execution_boundary.ranking_optimization_performed, false);
});

test('current pre-tuning quality is receipted without converting failed release targets into PASS', async () => {
  const result = await bridge;
  assert.equal(metric(result, 'c157_production_worker', 'full_benchmark', 3).essential_recall.macro.score, 0.371032);
  assert.equal(metric(result, 'c157_production_worker', 'full_benchmark', 10).essential_recall.macro.score, 0.515873);
  assert.equal(metric(result, 'c157_production_worker', 'present_source', 5).essential_recall.macro.score, 0.705556);
  assert.equal(metric(result, 'c157_production_worker', 'present_source', 10).essential_recall.macro.score, 0.827778);
  assert.equal(metric(result, 'c157_production_worker', 'present_source', 5).graded_acceptable_precision.score, 0.136111);
  const gates = result.matrix.gate_receipts.current_production_observation;
  assert.equal(gates.full_recall_at_3.pass, false);
  assert.equal(gates.present_recall_at_5.pass, false);
  assert.equal(gates.present_recall_at_10.pass, false);
  assert.equal(gates.present_graded_precision_at_5.pass, false);
  assert.equal(gates.safety_zero_tolerance.pass, false);
  assert.equal(result.matrix.release_gate_status, 'FAIL_PRE_TUNING');
  assert.equal(result.matrix.release_gate_pass, false);
  assert.equal(result.receipt.status, 'PASS');
  assert.equal(result.receipt.status_scope, 'Artifact generation and digest verification only.');
  assert.equal(result.receipt.release_gate_pass, false);
});

test('every generated bridge artifact matches its receipt digest', async () => {
  const result = await bridge;
  assert.equal(result.receipt.output_count, 14);
  const expected = new Map(result.receipt.outputs.map(item => [item.path, item]));
  assert.equal(expected.size, result.generated.size);
  for (const [relative, bytes] of result.generated) {
    assert.deepEqual(expected.get(relative), { path: relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
});
