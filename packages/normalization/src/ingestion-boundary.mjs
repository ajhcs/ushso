const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const ACTIVE_JOB_STATES = new Set(['pending', 'retry_wait', 'leased']);
const REQUIREMENT_SATISFACTIONS = new Set(['created', 'replay_created', 'existing_pending', 'already_succeeded']);

export class NormalizationWorksetError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'NormalizationWorksetError';
    this.code = code;
    this.details = Object.freeze(structuredClone(details));
  }
}

function fail(code, details) {
  throw new NormalizationWorksetError(code, details);
}

function requiredCaptureSha(row, label) {
  const value = row?.capture_sha256;
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('NORMALIZATION_CAPTURE_SHA256_INVALID', { label, value: value ?? null });
  }
  return value;
}

/**
 * Fail-closed consumer boundary between a sealed ingestion capture manifest and
 * normalization work. One exact contract-shaped job must exist for every
 * capture and no aggregate, missing, duplicate, or unsealed work is accepted.
 */
export function reconcileNormalizationWorkset({ captureManifest, jobs, normalizerVersion }) {
  if (!Array.isArray(captureManifest) || !Array.isArray(jobs)) {
    fail('NORMALIZATION_WORKSET_ARRAYS_REQUIRED');
  }
  if (typeof normalizerVersion !== 'string' || !VERSION.test(normalizerVersion)) {
    fail('NORMALIZATION_NORMALIZER_VERSION_INVALID', { normalizer_version: normalizerVersion ?? null });
  }

  const captures = new Map();
  for (const [index, capture] of captureManifest.entries()) {
    const captureSha256 = requiredCaptureSha(capture, `capture_manifest[${index}]`);
    if (capture.sealed !== true) {
      fail('NORMALIZATION_CAPTURE_NOT_SEALED', { capture_sha256: captureSha256 });
    }
    if (captures.has(captureSha256)) {
      fail('NORMALIZATION_CAPTURE_MANIFEST_DUPLICATE', { capture_sha256: captureSha256 });
    }
    captures.set(captureSha256, structuredClone(capture));
  }

  const accepted = new Map();
  for (const [index, job] of jobs.entries()) {
    if (job?.job_type !== 'normalize_record') {
      fail('NORMALIZATION_JOB_TYPE_INVALID', { index, job_type: job?.job_type ?? null });
    }
    const identity = job.identity;
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
      fail('NORMALIZATION_JOB_IDENTITY_REQUIRED', { index });
    }
    const captureSha256 = requiredCaptureSha(identity, `jobs[${index}].identity`);
    const expectedKey = `normalize:${captureSha256}:${normalizerVersion}`;
    if (job.idempotency_key !== expectedKey) {
      const aggregate = typeof job.idempotency_key === 'string'
        && job.idempotency_key.startsWith('normalize:')
        && !job.idempotency_key.includes(captureSha256);
      fail(aggregate ? 'NORMALIZATION_AGGREGATE_JOB_REJECTED' : 'NORMALIZATION_JOB_IDEMPOTENCY_KEY_MISMATCH', {
        index, expected: expectedKey, actual: job.idempotency_key ?? null
      });
    }
    if (identity.normalizer_version !== normalizerVersion) {
      fail('NORMALIZATION_JOB_VERSION_MISMATCH', {
        index, expected: normalizerVersion, actual: identity.normalizer_version ?? null
      });
    }
    if (!captures.has(captureSha256)) {
      fail('NORMALIZATION_JOB_CAPTURE_NOT_IN_SEAL', { capture_sha256: captureSha256 });
    }
    if (accepted.has(captureSha256)) {
      fail('NORMALIZATION_JOB_DUPLICATE_CAPTURE', { capture_sha256: captureSha256 });
    }
    accepted.set(captureSha256, structuredClone(job));
  }

  const missingCaptureSha256 = [...captures.keys()].filter(captureSha256 => !accepted.has(captureSha256)).sort();
  if (missingCaptureSha256.length) {
    fail('NORMALIZATION_JOB_MISSING_CAPTURE', { missing_capture_sha256: missingCaptureSha256 });
  }
  if (accepted.size !== captures.size) {
    fail('NORMALIZATION_JOB_COUNT_MISMATCH', { expected: captures.size, actual: accepted.size });
  }

  return Object.freeze({
    status: 'reconciled',
    normalizer_version: normalizerVersion,
    sealed_capture_count: captures.size,
    normalize_job_count: accepted.size,
    capture_sha256: Object.freeze([...captures.keys()].sort())
  });
}

function uniqueBy(rows, key, duplicateCode) {
  const values = new Map();
  for (const row of rows) {
    const value = row?.[key];
    if (typeof value !== 'string' || value.length === 0) fail('NORMALIZATION_DATABASE_KEY_MISSING', { key });
    if (values.has(value)) fail(duplicateCode, { [key]: value });
    values.set(value, row);
  }
  return values;
}

/**
 * Reconcile the exact relational WP4 seal, requirement, job, and outbox
 * projection consumed in production. No synthesized `sealed` or `identity`
 * aliases are accepted here: field names intentionally match migrations 0002
 * and 0003 (`state`, `identity_payload`, and requirement/outbox links).
 */
export function reconcileNormalizationDatabaseWorkset({
  manifest,
  manifestItems,
  requirements,
  jobs,
  outbox,
  manifestDigestVerified
}) {
  if (!manifest || manifest.state !== 'sealed' || manifest.contract_version !== 'normalization-manifest.v1') {
    fail('NORMALIZATION_DATABASE_MANIFEST_NOT_SEALED');
  }
  if (!VERSION.test(manifest.normalizer_version ?? '')) fail('NORMALIZATION_NORMALIZER_VERSION_INVALID');
  if (!Array.isArray(manifestItems) || !Array.isArray(requirements)
      || !Array.isArray(jobs) || !Array.isArray(outbox)) {
    fail('NORMALIZATION_DATABASE_WORKSET_ARRAYS_REQUIRED');
  }
  if (manifestDigestVerified !== true) fail('NORMALIZATION_DATABASE_MANIFEST_DIGEST_MISMATCH');
  if (!Number.isInteger(manifest.required_capture_count) || manifest.required_capture_count < 0) {
    fail('NORMALIZATION_DATABASE_REQUIRED_COUNT_INVALID');
  }

  const itemsByReference = uniqueBy(manifestItems, 'capture_reference_id', 'NORMALIZATION_CAPTURE_MANIFEST_DUPLICATE');
  const captures = new Set();
  const ordinals = new Set();
  for (const item of manifestItems) {
    const captureSha256 = requiredCaptureSha(item, 'normalization_manifest_items');
    if (item.run_id !== manifest.run_id || item.normalizer_version !== manifest.normalizer_version) {
      fail('NORMALIZATION_DATABASE_MANIFEST_ITEM_FENCE_MISMATCH', { capture_reference_id: item.capture_reference_id });
    }
    if (captures.has(captureSha256)) fail('NORMALIZATION_CAPTURE_MANIFEST_DUPLICATE', { capture_sha256: captureSha256 });
    captures.add(captureSha256);
    if (!Number.isInteger(item.ordinal) || item.ordinal <= 0 || ordinals.has(item.ordinal)) {
      fail('NORMALIZATION_DATABASE_MANIFEST_ORDINAL_DRIFT', { ordinal: item.ordinal ?? null });
    }
    ordinals.add(item.ordinal);
  }
  if ([...ordinals].sort((a, b) => a - b).some((ordinal, index) => ordinal !== index + 1)) {
    fail('NORMALIZATION_DATABASE_MANIFEST_ORDINAL_DRIFT');
  }
  if (manifestItems.length !== manifest.required_capture_count) {
    fail('NORMALIZATION_JOB_COUNT_MISMATCH', { expected: manifest.required_capture_count, actual: manifestItems.length });
  }

  const requirementsByReference = uniqueBy(requirements, 'capture_reference_id', 'NORMALIZATION_JOB_DUPLICATE_CAPTURE');
  const jobsById = uniqueBy(jobs, 'job_id', 'NORMALIZATION_DATABASE_JOB_ID_DUPLICATE');
  const outboxById = uniqueBy(outbox, 'event_id', 'NORMALIZATION_DATABASE_OUTBOX_ID_DUPLICATE');
  const acceptedCaptures = new Set();
  for (const [captureReferenceId, item] of itemsByReference) {
    const requirement = requirementsByReference.get(captureReferenceId);
    if (!requirement) fail('NORMALIZATION_JOB_MISSING_CAPTURE', { capture_reference_id: captureReferenceId });
    if (requirement.run_id !== manifest.run_id || !REQUIREMENT_SATISFACTIONS.has(requirement.satisfaction)) {
      fail('NORMALIZATION_DATABASE_REQUIREMENT_FENCE_MISMATCH', { capture_reference_id: captureReferenceId });
    }
    const job = jobsById.get(requirement.job_id);
    if (!job || job.job_type !== 'normalize_record' || typeof job.run_id !== 'string') {
      fail('NORMALIZATION_JOB_TYPE_INVALID', { capture_reference_id: captureReferenceId });
    }
    const identity = job.identity_payload;
    const captureSha256 = requiredCaptureSha(identity, 'jobs.identity_payload');
    const logicalKey = `normalize:${item.capture_sha256}:${manifest.normalizer_version}`;
    const replayKey = `${logicalKey}:replay:${job.run_id}`;
    const expectedKeys = requirement.satisfaction === 'replay_created'
      ? [replayKey]
      : [logicalKey, ...(requirement.satisfaction === 'already_succeeded' ? [replayKey] : [])];
    const expectedKey = expectedKeys[0];
    if (captureSha256 !== item.capture_sha256
        || identity.normalizer_version !== manifest.normalizer_version
        || !expectedKeys.includes(job.idempotency_key)) {
      const aggregate = typeof job.idempotency_key === 'string'
        && job.idempotency_key.startsWith('normalize:')
        && !job.idempotency_key.includes(item.capture_sha256);
      fail(aggregate ? 'NORMALIZATION_AGGREGATE_JOB_REJECTED' : 'NORMALIZATION_JOB_IDEMPOTENCY_KEY_MISMATCH', {
        capture_reference_id: captureReferenceId, expected: expectedKey, actual: job.idempotency_key ?? null
      });
    }
    const jobIsReplay = job.idempotency_key === replayKey;
    if (requirement.satisfaction === 'replay_created' && !jobIsReplay) {
      fail('NORMALIZATION_DATABASE_REQUIREMENT_FENCE_MISMATCH', { capture_reference_id: captureReferenceId });
    }
    if (requirement.satisfaction === 'existing_pending' && jobIsReplay) {
      fail('NORMALIZATION_DATABASE_REQUIREMENT_FENCE_MISMATCH', { capture_reference_id: captureReferenceId });
    }
    if ((requirement.satisfaction === 'created' || requirement.satisfaction === 'replay_created')
        && job.run_id !== manifest.run_id) {
      fail('NORMALIZATION_DATABASE_REQUIREMENT_FENCE_MISMATCH', { capture_reference_id: captureReferenceId });
    }
    if (requirement.satisfaction === 'already_succeeded') {
      if (job.state !== 'succeeded') fail('NORMALIZATION_DATABASE_REQUIREMENT_FENCE_MISMATCH', { capture_reference_id: captureReferenceId });
    } else if (!ACTIVE_JOB_STATES.has(job.state)) {
      fail('NORMALIZATION_DATABASE_REQUIREMENT_FENCE_MISMATCH', { capture_reference_id: captureReferenceId });
    }
    if (jobIsReplay && (identity.logical_idempotency_key !== logicalKey
      || typeof identity.replay_of_job_id !== 'string' || identity.replay_of_job_id.length === 0)) {
      fail('NORMALIZATION_DATABASE_REQUIREMENT_FENCE_MISMATCH', { capture_reference_id: captureReferenceId });
    }
    if (acceptedCaptures.has(captureSha256)) fail('NORMALIZATION_JOB_DUPLICATE_CAPTURE', { capture_sha256: captureSha256 });
    acceptedCaptures.add(captureSha256);
    const event = outboxById.get(requirement.outbox_event_id);
    if (!event || job.outbox_event_id !== event.event_id
        || event.event_type !== 'normalize_requested'
        || event.idempotency_key !== `event:normalize_requested:${job.job_id}`
        || event.references_payload?.run_id !== job.run_id
        || event.references_payload?.job_id !== job.job_id
        || event.references_payload?.capture_ref_id !== captureReferenceId) {
      fail('NORMALIZATION_DATABASE_OUTBOX_LINEAGE_MISMATCH', { capture_reference_id: captureReferenceId });
    }
  }
  if (requirements.length !== manifest.required_capture_count
      || jobs.length !== manifest.required_capture_count
      || outbox.length !== manifest.required_capture_count) {
    fail('NORMALIZATION_JOB_COUNT_MISMATCH', {
      expected: manifest.required_capture_count,
      requirements: requirements.length,
      jobs: jobs.length,
      outbox: outbox.length
    });
  }

  return Object.freeze({
    status: 'reconciled_database_workset',
    run_id: manifest.run_id,
    manifest_sha256: manifest.manifest_sha256,
    normalizer_version: manifest.normalizer_version,
    sealed_capture_count: manifest.required_capture_count,
    normalize_job_count: jobs.length,
    normalization_requirement_count: requirements.length,
    normalization_outbox_count: outbox.length,
    capture_sha256: Object.freeze([...captures].sort())
  });
}
