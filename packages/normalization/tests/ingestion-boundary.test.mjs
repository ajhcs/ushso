import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileNormalizationDatabaseWorkset, reconcileNormalizationWorkset } from '../src/ingestion-boundary.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const VERSION = '1.0.0';
const captures = Object.freeze([
  { capture_sha256: A, sealed: true, capture_reference_id: 'capture-a', discovery_revision_id: 'revision-a' },
  { capture_sha256: B, sealed: true, capture_reference_id: 'capture-b', discovery_revision_id: 'revision-b' }
]);

function job(captureSha256, overrides = {}) {
  return {
    job_id: `job-${captureSha256[0]}`,
    job_type: 'normalize_record',
    idempotency_key: `normalize:${captureSha256}:${VERSION}`,
    identity: { capture_sha256: captureSha256, normalizer_version: VERSION },
    ...overrides
  };
}

test('sealed capture manifest reconciles one exact normalization job per capture', () => {
  assert.deepEqual(reconcileNormalizationWorkset({
    captureManifest: captures, jobs: [job(B), job(A)], normalizerVersion: VERSION
  }), {
    status: 'reconciled', normalizer_version: VERSION,
    sealed_capture_count: 2, normalize_job_count: 2, capture_sha256: [A, B]
  });
});

test('aggregate, missing, duplicate, unsealed, and unexpected capture work fail closed', () => {
  assert.throws(() => reconcileNormalizationWorkset({
    captureManifest: captures,
    jobs: [job(A, { idempotency_key: 'normalize:run-1:scope-set-1' }), job(B)],
    normalizerVersion: VERSION
  }), error => error.code === 'NORMALIZATION_AGGREGATE_JOB_REJECTED');
  assert.throws(() => reconcileNormalizationWorkset({
    captureManifest: captures, jobs: [job(A)], normalizerVersion: VERSION
  }), error => error.code === 'NORMALIZATION_JOB_MISSING_CAPTURE'
    && error.details.missing_capture_sha256[0] === B);
  assert.throws(() => reconcileNormalizationWorkset({
    captureManifest: captures, jobs: [job(A), job(A), job(B)], normalizerVersion: VERSION
  }), error => error.code === 'NORMALIZATION_JOB_DUPLICATE_CAPTURE');
  assert.throws(() => reconcileNormalizationWorkset({
    captureManifest: [{ ...captures[0], sealed: false }], jobs: [job(A)], normalizerVersion: VERSION
  }), error => error.code === 'NORMALIZATION_CAPTURE_NOT_SEALED');
  assert.throws(() => reconcileNormalizationWorkset({
    captureManifest: [captures[0]], jobs: [job(B)], normalizerVersion: VERSION
  }), error => error.code === 'NORMALIZATION_JOB_CAPTURE_NOT_IN_SEAL');
});

test('manifest and job duplicates cannot be laundered through count equality', () => {
  assert.throws(() => reconcileNormalizationWorkset({
    captureManifest: [captures[0], captures[0]], jobs: [job(A), job(B)], normalizerVersion: VERSION
  }), error => error.code === 'NORMALIZATION_CAPTURE_MANIFEST_DUPLICATE');
  assert.throws(() => reconcileNormalizationWorkset({
    captureManifest: [captures[0]],
    jobs: [job(A, { identity: { capture_sha256: A, normalizer_version: '1.0.1' } })],
    normalizerVersion: VERSION
  }), error => error.code === 'NORMALIZATION_JOB_VERSION_MISMATCH');
});

function databaseWorkset() {
  const runId = 'run:wp6:boundary';
  const manifestItems = captures.map((capture, index) => ({
    run_id: runId,
    capture_reference_id: capture.capture_reference_id,
    capture_sha256: capture.capture_sha256,
    normalizer_version: VERSION,
    ordinal: index + 1
  }));
  const jobs = manifestItems.map(item => ({
    job_id: `job_normalize_${item.capture_sha256}_${VERSION.replaceAll('.', '_')}`,
    run_id: runId,
    job_type: 'normalize_record',
    state: 'pending',
    idempotency_key: `normalize:${item.capture_sha256}:${VERSION}`,
    identity_payload: { capture_sha256: item.capture_sha256, normalizer_version: VERSION },
    outbox_event_id: `event_normalize_${item.capture_sha256}_${VERSION.replaceAll('.', '_')}`
  }));
  const requirements = manifestItems.map((item, index) => ({
    run_id: runId,
    capture_reference_id: item.capture_reference_id,
    job_id: jobs[index].job_id,
    outbox_event_id: jobs[index].outbox_event_id,
    satisfaction: 'created'
  }));
  const outbox = requirements.map(requirement => ({
    event_id: requirement.outbox_event_id,
    event_type: 'normalize_requested',
    idempotency_key: `event:normalize_requested:${requirement.job_id}`,
    references_payload: {
      run_id: runId,
      job_id: requirement.job_id,
      capture_ref_id: requirement.capture_reference_id
    }
  }));
  return {
    manifest: {
      run_id: runId,
      contract_version: 'normalization-manifest.v1',
      normalizer_version: VERSION,
      required_capture_count: 2,
      manifest_sha256: 'c'.repeat(64),
      state: 'sealed'
    },
    manifestItems,
    requirements,
    jobs,
    outbox,
    manifestDigestVerified: true
  };
}

function databaseWorksetForSatisfaction(satisfaction) {
  const workset = databaseWorkset();
  const oldRunId = 'run:wp6:owner';
  const item = workset.manifestItems[0];
  const requirement = workset.requirements[0];
  const job = workset.jobs[0];
  if (satisfaction === 'existing_pending' || satisfaction === 'already_succeeded') {
    job.run_id = oldRunId;
    requirement.satisfaction = satisfaction;
    if (satisfaction === 'already_succeeded') job.state = 'succeeded';
    workset.outbox[0].references_payload.run_id = oldRunId;
  } else if (satisfaction === 'replay_created') {
    const replayJobId = `${job.job_id}_replay`;
    const replayEventId = `${job.outbox_event_id}_replay`;
    job.job_id = replayJobId;
    job.idempotency_key = `${job.idempotency_key}:replay:${workset.manifest.run_id}`;
    job.outbox_event_id = replayEventId;
    job.identity_payload.logical_idempotency_key = `normalize:${item.capture_sha256}:${VERSION}`;
    job.identity_payload.replay_of_job_id = `job_normalize_${item.capture_sha256}_${VERSION.replaceAll('.', '_')}`;
    requirement.job_id = replayJobId;
    requirement.outbox_event_id = replayEventId;
    requirement.satisfaction = satisfaction;
    workset.outbox[0].event_id = replayEventId;
    workset.outbox[0].idempotency_key = `event:normalize_requested:${replayJobId}`;
    workset.outbox[0].references_payload.job_id = replayJobId;
  }
  return workset;
}

test('database reconciliation accepts each explicit same-run or cross-run satisfaction state', () => {
  for (const satisfaction of ['created', 'replay_created', 'existing_pending', 'already_succeeded']) {
    const workset = satisfaction === 'created' ? databaseWorkset() : databaseWorksetForSatisfaction(satisfaction);
    assert.equal(reconcileNormalizationDatabaseWorkset(workset).status, 'reconciled_database_workset', satisfaction);
  }
});

test('database reconciliation binds reused jobs and events to their owning run', () => {
  for (const satisfaction of ['existing_pending', 'already_succeeded']) {
    const workset = databaseWorksetForSatisfaction(satisfaction);
    workset.outbox[0].references_payload.run_id = workset.manifest.run_id;
    assert.throws(() => reconcileNormalizationDatabaseWorkset(workset), error => error.code === 'NORMALIZATION_DATABASE_OUTBOX_LINEAGE_MISMATCH');
  }
});

test('created satisfaction cannot claim a job owned by another run', () => {
  const workset = databaseWorkset();
  workset.jobs[0].run_id = 'run:wp6:other';
  workset.outbox[0].references_payload.run_id = 'run:wp6:other';
  assert.throws(
    () => reconcileNormalizationDatabaseWorkset(workset),
    error => error.code === 'NORMALIZATION_DATABASE_REQUIREMENT_FENCE_MISMATCH'
  );
});

test('actual WP4 relational field shapes reconcile manifest, requirements, jobs, and outbox', () => {
  const workset = databaseWorkset();
  const receipt = reconcileNormalizationDatabaseWorkset(workset);
  assert.equal(receipt.status, 'reconciled_database_workset');
  assert.equal(receipt.sealed_capture_count, 2);
  assert.equal(receipt.normalization_requirement_count, 2);
  assert.equal(receipt.normalization_outbox_count, 2);

  const attacks = [
    value => { value.manifest.state = 'open'; },
    value => { value.manifestDigestVerified = false; },
    value => { value.jobs[0].identity_payload.capture_sha256 = B; },
    value => { value.jobs[0].idempotency_key = 'normalize:run:aggregate'; },
    value => { value.requirements.pop(); },
    value => { value.requirements.push(structuredClone(value.requirements[0])); },
    value => { value.requirements[0].satisfaction = 'replay_created'; },
    value => { value.jobs[0].state = 'succeeded'; },
    value => { value.outbox[0].references_payload.capture_ref_id = 'wrong-capture'; },
    value => { value.manifestItems[1].ordinal = 1; }
  ];
  for (const mutate of attacks) {
    const adversarial = databaseWorkset();
    mutate(adversarial);
    assert.throws(() => reconcileNormalizationDatabaseWorkset(adversarial), error => error?.name === 'NormalizationWorksetError');
  }
});
