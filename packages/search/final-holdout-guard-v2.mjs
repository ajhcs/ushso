import { canonicalSha256, assertTypedDigest } from '../../contracts/tooling/v1.0.0/src/digests.mjs';

export const FINAL_HOLDOUT_GUARD_VERSION = 'ushso-final-holdout-guard.v2.0.0';
export const FINAL_HOLDOUT_ITEM_COUNT = 20;
export const FINAL_HOLDOUT_QUALITY_STATE = 'FAIL_PRE_TUNING';
export const CONSUME_FINAL_HOLDOUT_LEASE_SQL = `
select * from ushso_search.consume_final_holdout_lease($1::jsonb)
`;
export const COMPLETE_FINAL_HOLDOUT_LEASE_SQL = `
select * from ushso_search.complete_final_holdout_lease($1::text, $2::text, $3::jsonb)
`;

const ID = /^[a-z][a-z0-9_.:-]{2,191}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u;
const METRIC_NAME = /^[a-z][a-z0-9_.:-]{1,95}$/u;
const TERMINAL_STATUSES = new Set(['PASS', 'FAIL', 'ERROR']);

export class FinalHoldoutGuardError extends Error {
  constructor(code, detail) {
    super(`${code}${detail ? `:${detail}` : ''}`);
    this.name = 'FinalHoldoutGuardError';
    this.code = code;
    this.detail = detail ?? null;
  }
}

function fail(code, detail) {
  throw new FinalHoldoutGuardError(code, detail);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('FINAL_HOLDOUT_OBJECT_REQUIRED', label);
  }
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(plainObject(value, label)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('FINAL_HOLDOUT_FIELDS_INVALID', label);
  }
}

function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail('FINAL_HOLDOUT_ID_INVALID', label);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !UTC.test(value) || Number.isNaN(Date.parse(value))) {
    fail('FINAL_HOLDOUT_TIMESTAMP_INVALID', label);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('FINAL_HOLDOUT_SHA256_INVALID', label);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function validatePostgresAcceptance(response, expectedDigests) {
  if (!response || !Array.isArray(response.rows) || response.rows.length !== 1) {
    fail('FINAL_HOLDOUT_POSTGRES_ACCEPTANCE_INVALID', 'row_count');
  }
  const row = response.rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    fail('FINAL_HOLDOUT_POSTGRES_ACCEPTANCE_INVALID', 'row_shape');
  }
  const expectedKeys = ['accepted', ...Object.keys(expectedDigests)].sort();
  const actualKeys = Object.keys(row).sort();
  if (actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, index) => key !== expectedKeys[index])
      || row.accepted !== true) {
    fail('FINAL_HOLDOUT_POSTGRES_ACCEPTANCE_INVALID', 'row_fields');
  }
  for (const [field, expected] of Object.entries(expectedDigests)) {
    if (typeof row[field] !== 'string' || !SHA256.test(row[field]) || row[field] !== expected) {
      fail('FINAL_HOLDOUT_POSTGRES_ACCEPTANCE_INVALID', field);
    }
  }
  return row;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validatePackageMetadata(metadata) {
  exactKeys(metadata, [
    'metadata_version', 'package_id', 'package_content_digest', 'item_count', 'custodian_actor_id',
    'custodian_independent_from_evaluator', 'sealed_at', 'provenance_ref', 'prior_exposure',
    'ordinary_test_access', 'aggregate_only_output', 'single_use',
  ], 'package_metadata');
  if (metadata.metadata_version !== 'ushso-final-holdout-package-metadata.v1') fail('FINAL_HOLDOUT_METADATA_VERSION_INVALID');
  id(metadata.package_id, 'package_id');
  id(metadata.custodian_actor_id, 'custodian_actor_id');
  id(metadata.provenance_ref, 'provenance_ref');
  timestamp(metadata.sealed_at, 'sealed_at');
  try {
    assertTypedDigest(metadata.package_content_digest, 'package_sha256');
  } catch {
    fail('FINAL_HOLDOUT_PACKAGE_DIGEST_INVALID');
  }
  if (metadata.item_count !== FINAL_HOLDOUT_ITEM_COUNT) fail('FINAL_HOLDOUT_ITEM_COUNT_INVALID');
  if (metadata.custodian_independent_from_evaluator !== true) fail('FINAL_HOLDOUT_CUSTODIAN_NOT_INDEPENDENT');
  if (metadata.prior_exposure !== 'never_published_never_evaluated') fail('FINAL_HOLDOUT_PREVIOUSLY_EXPOSED');
  if (metadata.ordinary_test_access !== false) fail('FINAL_HOLDOUT_ORDINARY_TEST_ACCESS_FORBIDDEN');
  if (metadata.aggregate_only_output !== true || metadata.single_use !== true) fail('FINAL_HOLDOUT_USE_POLICY_INVALID');
  return metadata;
}

function validateCandidate(candidate) {
  exactKeys(candidate, [
    'candidate_id', 'ranking_fingerprint_sha256', 'ranking_frozen_at', 'ranking_tuned',
    'ranking_frozen', 'release_candidate', 'evaluator_freeze_receipt_sha256',
    'metric_contract_sha256', 'benchmark_pin_sha256',
  ], 'candidate');
  id(candidate.candidate_id, 'candidate_id');
  timestamp(candidate.ranking_frozen_at, 'ranking_frozen_at');
  sha256(candidate.ranking_fingerprint_sha256, 'ranking_fingerprint_sha256');
  sha256(candidate.evaluator_freeze_receipt_sha256, 'evaluator_freeze_receipt_sha256');
  sha256(candidate.metric_contract_sha256, 'metric_contract_sha256');
  sha256(candidate.benchmark_pin_sha256, 'benchmark_pin_sha256');
  if (candidate.ranking_tuned !== true || candidate.ranking_frozen !== true || candidate.release_candidate !== true) {
    fail('FINAL_HOLDOUT_CANDIDATE_NOT_FROZEN');
  }
  return candidate;
}

function validateAuthorization(authorization, metadata, candidate, observedAt) {
  exactKeys(authorization, [
    'authorization_version', 'authorization_id', 'scope', 'authorized_by_actor_id',
    'authorized_evaluator_id', 'package_id', 'package_content_digest', 'candidate_id',
    'ranking_fingerprint_sha256', 'evaluator_freeze_receipt_sha256',
    'metric_contract_sha256', 'benchmark_pin_sha256',
    'granted_at', 'expires_at', 'external_authorized',
  ], 'authorization');
  if (authorization.authorization_version !== 'ushso-final-holdout-authorization.v1') fail('FINAL_HOLDOUT_AUTHORIZATION_VERSION_INVALID');
  id(authorization.authorization_id, 'authorization_id');
  id(authorization.authorized_by_actor_id, 'authorized_by_actor_id');
  id(authorization.authorized_evaluator_id, 'authorized_evaluator_id');
  timestamp(authorization.granted_at, 'granted_at');
  timestamp(authorization.expires_at, 'expires_at');
  if (authorization.scope !== 'final_retrieval_gate_once' || authorization.external_authorized !== true) {
    fail('FINAL_HOLDOUT_AUTHORIZATION_SCOPE_INVALID');
  }
  if (authorization.authorized_by_actor_id === authorization.authorized_evaluator_id
      || authorization.authorized_by_actor_id !== metadata.custodian_actor_id) {
    fail('FINAL_HOLDOUT_AUTHORIZATION_NOT_INDEPENDENT');
  }
  if (authorization.package_id !== metadata.package_id
      || authorization.package_content_digest?.value !== metadata.package_content_digest.value
      || authorization.package_content_digest?.digest_type !== 'package_sha256'
      || authorization.package_content_digest?.algorithm !== 'sha256') {
    fail('FINAL_HOLDOUT_AUTHORIZATION_PACKAGE_MISMATCH');
  }
  if (authorization.candidate_id !== candidate.candidate_id
      || authorization.ranking_fingerprint_sha256 !== candidate.ranking_fingerprint_sha256) {
    fail('FINAL_HOLDOUT_AUTHORIZATION_CANDIDATE_MISMATCH');
  }
  for (const field of ['evaluator_freeze_receipt_sha256', 'metric_contract_sha256', 'benchmark_pin_sha256']) {
    if (authorization[field] !== candidate[field]) fail('FINAL_HOLDOUT_AUTHORIZATION_CANDIDATE_MISMATCH', field);
  }
  const observedMs = Date.parse(observedAt);
  if (Date.parse(metadata.sealed_at) > Date.parse(authorization.granted_at)
      || Date.parse(authorization.granted_at) > observedMs
      || Date.parse(authorization.expires_at) <= observedMs
      || Date.parse(authorization.expires_at) <= Date.parse(authorization.granted_at)) {
    fail('FINAL_HOLDOUT_AUTHORIZATION_EXPIRED');
  }
  return authorization;
}

function validateAuthorizationVerificationReceipt(receipt, metadata, candidate, authorization) {
  exactKeys(receipt, [
    'verification_version', 'verification_kind', 'verified', 'authorization_id',
    'package_content_digest', 'custodian_actor_id', 'authorized_evaluator_id',
    'candidate_id', 'ranking_fingerprint_sha256', 'evaluator_freeze_receipt_sha256',
    'metric_contract_sha256', 'benchmark_pin_sha256', 'authorization_expires_at',
    'independent_custody_attested', 'never_exposed_attested',
    'ordinary_test_access_forbidden_attested', 'aggregate_only_terminal_contract_attested',
    'verification_receipt_digest',
  ], 'authorization_verification_receipt');
  const { verification_receipt_digest: suppliedDigest, ...material } = receipt;
  try {
    assertTypedDigest(suppliedDigest, 'canonical_json_sha256');
  } catch {
    fail('FINAL_HOLDOUT_AUTHORIZATION_VERIFICATION_DIGEST_INVALID');
  }
  if (canonicalSha256(material).value !== suppliedDigest.value) fail('FINAL_HOLDOUT_AUTHORIZATION_VERIFICATION_DIGEST_MISMATCH');
  if (receipt.verification_version !== 'ushso-final-holdout-authorization-verification.v1'
      || receipt.verification_kind !== 'authorization_and_custody'
      || receipt.verified !== true
      || receipt.independent_custody_attested !== true
      || receipt.never_exposed_attested !== true
      || receipt.ordinary_test_access_forbidden_attested !== true
      || receipt.aggregate_only_terminal_contract_attested !== true) {
    fail('FINAL_HOLDOUT_AUTHORIZATION_VERIFICATION_FAILED');
  }
  if (receipt.authorization_id !== authorization.authorization_id
      || receipt.custodian_actor_id !== metadata.custodian_actor_id
      || receipt.authorized_evaluator_id !== authorization.authorized_evaluator_id
      || receipt.candidate_id !== candidate.candidate_id
      || receipt.authorization_expires_at !== authorization.expires_at
      || receipt.package_content_digest?.digest_type !== metadata.package_content_digest.digest_type
      || receipt.package_content_digest?.algorithm !== metadata.package_content_digest.algorithm
      || receipt.package_content_digest?.value !== metadata.package_content_digest.value) {
    fail('FINAL_HOLDOUT_AUTHORIZATION_VERIFICATION_BINDING_MISMATCH');
  }
  for (const field of [
    'ranking_fingerprint_sha256', 'evaluator_freeze_receipt_sha256',
    'metric_contract_sha256', 'benchmark_pin_sha256',
  ]) if (receipt[field] !== candidate[field]) fail('FINAL_HOLDOUT_AUTHORIZATION_VERIFICATION_BINDING_MISMATCH', field);
  return receipt;
}

function validateTerminalVerificationReceipt(receipt, lease, evaluatorActorId, terminalMaterial) {
  exactKeys(receipt, [
    'verification_version', 'verification_kind', 'verified', 'lease_digest',
    'authenticated_evaluator_id', 'terminal_material_digest',
    'aggregate_only_execution_attested', 'verification_receipt_digest',
  ], 'terminal_verification_receipt');
  const { verification_receipt_digest: suppliedDigest, ...material } = receipt;
  try {
    assertTypedDigest(suppliedDigest, 'canonical_json_sha256');
    assertTypedDigest(receipt.lease_digest, 'canonical_json_sha256');
    assertTypedDigest(receipt.terminal_material_digest, 'canonical_json_sha256');
  } catch {
    fail('FINAL_HOLDOUT_TERMINAL_VERIFICATION_DIGEST_INVALID');
  }
  if (canonicalSha256(material).value !== suppliedDigest.value) fail('FINAL_HOLDOUT_TERMINAL_VERIFICATION_DIGEST_MISMATCH');
  if (receipt.verification_version !== 'ushso-final-holdout-terminal-verification.v1'
      || receipt.verification_kind !== 'authenticated_terminal_receipt'
      || receipt.verified !== true || receipt.aggregate_only_execution_attested !== true
      || receipt.authenticated_evaluator_id !== evaluatorActorId
      || receipt.authenticated_evaluator_id !== lease.authorized_evaluator_id
      || receipt.lease_digest.value !== lease.lease_digest.value
      || receipt.terminal_material_digest.value !== canonicalSha256(terminalMaterial).value) {
    fail('FINAL_HOLDOUT_TERMINAL_VERIFICATION_BINDING_MISMATCH');
  }
  return receipt;
}

function validateAggregateResult(result) {
  exactKeys(result, [
    'aggregate_result_version', 'total_items', 'pass_count', 'fail_count', 'metrics',
    'threshold_status', 'no_per_item_output',
  ], 'aggregate_result');
  if (result.aggregate_result_version !== 'ushso-final-holdout-aggregate.v1') fail('FINAL_HOLDOUT_AGGREGATE_VERSION_INVALID');
  if (result.total_items !== FINAL_HOLDOUT_ITEM_COUNT
      || !Number.isSafeInteger(result.pass_count) || result.pass_count < 0
      || !Number.isSafeInteger(result.fail_count) || result.fail_count < 0
      || result.pass_count + result.fail_count !== result.total_items) {
    fail('FINAL_HOLDOUT_AGGREGATE_COUNTS_INVALID');
  }
  if (result.no_per_item_output !== true || !TERMINAL_STATUSES.has(result.threshold_status)
      || result.threshold_status === 'ERROR') {
    fail('FINAL_HOLDOUT_AGGREGATE_POLICY_INVALID');
  }
  const metrics = plainObject(result.metrics, 'aggregate_result/metrics');
  if (Object.keys(metrics).length < 1 || Object.keys(metrics).length > 64) fail('FINAL_HOLDOUT_METRICS_INVALID');
  for (const [name, value] of Object.entries(metrics)) {
    if (!METRIC_NAME.test(name) || typeof value !== 'number' || !Number.isFinite(value)) {
      fail('FINAL_HOLDOUT_METRIC_INVALID', name);
    }
  }
  return result;
}

function validateLease(lease, completedAt, completionObservedAt) {
  exactKeys(lease, [
    'lease_version', 'package_id', 'package_content_digest', 'candidate_id',
    'ranking_fingerprint_sha256', 'authorization_id', 'authorized_evaluator_id',
    'evaluator_freeze_receipt_sha256', 'metric_contract_sha256', 'benchmark_pin_sha256',
    'authorization_expires_at', 'authorization_verification_receipt_digest',
    'verification_state', 'item_count', 'issued_at', 'aggregate_only_output', 'ordinary_test_access', 'single_use',
    'package_contents_included', 'lease_digest', 'terminal_receipt',
  ], 'lease');
  if (lease.lease_version !== 'ushso-final-holdout-lease.v1' || lease.aggregate_only_output !== true
      || lease.ordinary_test_access !== false || lease.single_use !== true
      || lease.package_contents_included !== false || lease.item_count !== FINAL_HOLDOUT_ITEM_COUNT
      || lease.terminal_receipt !== null || Date.parse(completedAt) < Date.parse(timestamp(lease.issued_at, 'issued_at'))
      || Date.parse(completedAt) > Date.parse(timestamp(completionObservedAt, 'completion_observed_at'))
      || Date.parse(completedAt) >= Date.parse(timestamp(lease.authorization_expires_at, 'authorization_expires_at'))
      || Date.parse(completionObservedAt) >= Date.parse(lease.authorization_expires_at)) {
    fail('FINAL_HOLDOUT_LEASE_INVALID');
  }
  if (!['verified_production', 'offline_rehearsal_unverified'].includes(lease.verification_state)) fail('FINAL_HOLDOUT_LEASE_VERIFICATION_STATE_INVALID');
  if (lease.verification_state === 'verified_production') {
    try {
      assertTypedDigest(lease.authorization_verification_receipt_digest, 'canonical_json_sha256');
    } catch {
      fail('FINAL_HOLDOUT_AUTHORIZATION_VERIFICATION_DIGEST_INVALID');
    }
  } else if (lease.authorization_verification_receipt_digest !== null) {
    fail('FINAL_HOLDOUT_OFFLINE_VERIFICATION_RECEIPT_UNEXPECTED');
  }
  const { lease_digest: suppliedDigest, terminal_receipt: _terminal, ...material } = lease;
  try {
    assertTypedDigest(suppliedDigest, 'canonical_json_sha256');
  } catch {
    fail('FINAL_HOLDOUT_LEASE_DIGEST_INVALID');
  }
  if (canonicalSha256(material).value !== suppliedDigest.value) fail('FINAL_HOLDOUT_LEASE_DIGEST_MISMATCH');
  return lease;
}

export class InMemoryFinalHoldoutUseLedger {
  constructor({ mode = 'offline_rehearsal' } = {}) {
    if (mode !== 'offline_rehearsal') fail('FINAL_HOLDOUT_DURABLE_LEDGER_REQUIRED');
    this.mode = mode;
    this.uses = new Map();
  }

  consume(record) {
    const key = record.package_content_digest.value;
    if (this.uses.has(key)) fail('FINAL_HOLDOUT_ALREADY_CONSUMED', record.package_id);
    this.uses.set(key, clone(record));
    return clone(record);
  }

  complete(packageDigest, leaseDigest, terminalReceipt) {
    const record = this.uses.get(packageDigest);
    if (!record) fail('FINAL_HOLDOUT_LEASE_UNKNOWN');
    if (record.lease_digest.value !== leaseDigest) fail('FINAL_HOLDOUT_LEASE_DIGEST_MISMATCH');
    if (record.terminal_receipt !== null) fail('FINAL_HOLDOUT_TERMINAL_RECEIPT_ALREADY_RECORDED');
    record.terminal_receipt = clone(terminalReceipt);
    return clone(record);
  }

  snapshot() {
    return deepFreeze([...this.uses.values()].map(clone));
  }
}

export class PostgresFinalHoldoutUseLedger {
  constructor({ query }) {
    if (typeof query !== 'function' && typeof query?.query !== 'function') fail('FINAL_HOLDOUT_POSTGRES_EXECUTOR_REQUIRED');
    this.query = typeof query === 'function' ? query : query.query.bind(query);
  }

  async consume(record) {
    let response;
    try {
      response = await this.query({
        name: 'ushso_consume_final_holdout_lease_v1',
        text: CONSUME_FINAL_HOLDOUT_LEASE_SQL,
        values: [JSON.stringify(record)],
      });
    } catch (error) {
      if (error?.code === '23505' || String(error?.message).includes('already consumed')) {
        fail('FINAL_HOLDOUT_ALREADY_CONSUMED', record.package_id);
      }
      throw error;
    }
    validatePostgresAcceptance(response, {
      package_content_sha256: record.package_content_digest.value,
      lease_sha256: record.lease_digest.value,
    });
    return clone(record);
  }

  async complete(packageDigest, leaseDigest, terminalReceipt) {
    let response;
    try {
      response = await this.query({
        name: 'ushso_complete_final_holdout_lease_v1',
        text: COMPLETE_FINAL_HOLDOUT_LEASE_SQL,
        values: [packageDigest, leaseDigest, JSON.stringify(terminalReceipt)],
      });
    } catch (error) {
      if (error?.code === '23505' || String(error?.message).includes('terminal receipt already')) {
        fail('FINAL_HOLDOUT_TERMINAL_RECEIPT_ALREADY_RECORDED');
      }
      throw error;
    }
    validatePostgresAcceptance(response, {
      package_content_sha256: packageDigest,
      lease_sha256: leaseDigest,
      terminal_receipt_sha256: terminalReceipt.receipt_digest.value,
    });
    return clone(terminalReceipt);
  }
}

export class FinalHoldoutGuardV2 {
  constructor({
    ledger,
    mode = 'production',
    verifyAuthorizationAndCustody = null,
    verifyTerminalExecution = null,
    clock = () => new Date().toISOString(),
  }) {
    if (!ledger || typeof ledger.consume !== 'function' || typeof ledger.complete !== 'function') {
      fail('FINAL_HOLDOUT_LEDGER_REQUIRED');
    }
    if (!['production', 'offline_rehearsal'].includes(mode)) fail('FINAL_HOLDOUT_MODE_INVALID');
    if (mode === 'production' && !(ledger instanceof PostgresFinalHoldoutUseLedger)) {
      fail('FINAL_HOLDOUT_DURABLE_LEDGER_REQUIRED');
    }
    if (mode === 'production' && typeof verifyAuthorizationAndCustody !== 'function') {
      fail('FINAL_HOLDOUT_AUTHORIZATION_VERIFIER_REQUIRED');
    }
    if (mode === 'production' && typeof verifyTerminalExecution !== 'function') {
      fail('FINAL_HOLDOUT_TERMINAL_VERIFIER_REQUIRED');
    }
    if (typeof clock !== 'function') fail('FINAL_HOLDOUT_CLOCK_REQUIRED');
    this.ledger = ledger;
    this.mode = mode;
    this.verifyAuthorizationAndCustody = verifyAuthorizationAndCustody;
    this.verifyTerminalExecution = verifyTerminalExecution;
    this.clock = clock;
  }

  async issueSingleUseLease({ packageMetadata, candidate, authorization, observedAt }) {
    timestamp(observedAt, 'observed_at');
    const effectiveObservedAt = this.mode === 'production'
      ? timestamp(this.clock(), 'guard_observed_at')
      : observedAt;
    validatePackageMetadata(packageMetadata);
    validateCandidate(candidate);
    validateAuthorization(authorization, packageMetadata, candidate, effectiveObservedAt);
    if (Date.parse(candidate.ranking_frozen_at) > Date.parse(authorization.granted_at)) {
      fail('FINAL_HOLDOUT_AUTHORIZATION_PRECEDES_RANKING_FREEZE');
    }
    let authorizationVerificationReceipt = null;
    if (this.mode === 'production') {
      authorizationVerificationReceipt = await this.verifyAuthorizationAndCustody({
        packageMetadata: deepFreeze(clone(packageMetadata)),
        candidate: deepFreeze(clone(candidate)),
        authorization: deepFreeze(clone(authorization)),
        observedAt: effectiveObservedAt,
      });
      validateAuthorizationVerificationReceipt(authorizationVerificationReceipt, packageMetadata, candidate, authorization);
    }
    const material = {
      lease_version: 'ushso-final-holdout-lease.v1',
      package_id: packageMetadata.package_id,
      package_content_digest: clone(packageMetadata.package_content_digest),
      candidate_id: candidate.candidate_id,
      ranking_fingerprint_sha256: candidate.ranking_fingerprint_sha256,
      authorization_id: authorization.authorization_id,
      authorized_evaluator_id: authorization.authorized_evaluator_id,
      evaluator_freeze_receipt_sha256: candidate.evaluator_freeze_receipt_sha256,
      metric_contract_sha256: candidate.metric_contract_sha256,
      benchmark_pin_sha256: candidate.benchmark_pin_sha256,
      authorization_expires_at: authorization.expires_at,
      authorization_verification_receipt_digest: authorizationVerificationReceipt
        ? clone(authorizationVerificationReceipt.verification_receipt_digest)
        : null,
      verification_state: this.mode === 'production' ? 'verified_production' : 'offline_rehearsal_unverified',
      item_count: FINAL_HOLDOUT_ITEM_COUNT,
      issued_at: effectiveObservedAt,
      aggregate_only_output: true,
      ordinary_test_access: false,
      single_use: true,
      package_contents_included: false,
    };
    const lease = {
      ...material,
      lease_digest: canonicalSha256(material),
      terminal_receipt: null,
    };
    await this.ledger.consume(lease);
    return deepFreeze(clone(lease));
  }

  async #verifyTerminal({ lease, terminalMaterial, evaluatorActorId }) {
    id(evaluatorActorId, 'evaluator_actor_id');
    if (evaluatorActorId !== lease.authorized_evaluator_id) fail('FINAL_HOLDOUT_EVALUATOR_ACTOR_MISMATCH');
    if (this.mode !== 'production') return null;
    const verificationReceipt = await this.verifyTerminalExecution({
      lease: deepFreeze(clone(lease)),
      terminalMaterial: deepFreeze(clone(terminalMaterial)),
      evaluatorActorId,
    });
    validateTerminalVerificationReceipt(verificationReceipt, lease, evaluatorActorId, terminalMaterial);
    return verificationReceipt;
  }

  async recordAggregateResult({ lease, aggregateResult, completedAt, evaluatorActorId }) {
    timestamp(completedAt, 'completed_at');
    const completionObservedAt = timestamp(this.clock(), 'completion_observed_at');
    validateLease(lease, completedAt, completionObservedAt);
    validateAggregateResult(aggregateResult);
    const terminalMaterial = {
      lease_digest: clone(lease.lease_digest),
      evaluator_actor_id: evaluatorActorId,
      aggregate_result: clone(aggregateResult),
      completed_at: completedAt,
      completion_observed_at: completionObservedAt,
    };
    const terminalVerificationReceipt = await this.#verifyTerminal({ lease, terminalMaterial, evaluatorActorId });
    const material = {
      receipt_version: 'ushso-final-holdout-single-use-receipt.v1',
      lease_digest: clone(lease.lease_digest),
      package_id: lease.package_id,
      package_content_digest: clone(lease.package_content_digest),
      candidate_id: lease.candidate_id,
      ranking_fingerprint_sha256: lease.ranking_fingerprint_sha256,
      aggregate_result: clone(aggregateResult),
      completed_at: completedAt,
      completion_observed_at: completionObservedAt,
      evaluator_actor_id: evaluatorActorId,
      aggregate_only_output_contract: true,
      package_contents_accessed_by_guard: false,
      guard_receipt_contains_per_item_data: false,
      external_per_item_side_outputs_proven_absent: false,
      authorization_verification_receipt_digest: clone(lease.authorization_verification_receipt_digest),
      terminal_verification_receipt_digest: terminalVerificationReceipt
        ? clone(terminalVerificationReceipt.verification_receipt_digest)
        : null,
      verification_state: this.mode === 'production' ? 'verified_production_receipts' : 'offline_rehearsal_unverified',
      single_use_consumed: true,
    };
    const receipt = { ...material, receipt_digest: canonicalSha256(material) };
    await this.ledger.complete(lease.package_content_digest.value, lease.lease_digest.value, receipt);
    return deepFreeze(receipt);
  }

  async recordTerminalFailure({ lease, failureCode, completedAt, evaluatorActorId }) {
    timestamp(completedAt, 'completed_at');
    const completionObservedAt = timestamp(this.clock(), 'completion_observed_at');
    validateLease(lease, completedAt, completionObservedAt);
    if (typeof failureCode !== 'string' || !/^[A-Z][A-Z0-9_]{2,95}$/u.test(failureCode)) {
      fail('FINAL_HOLDOUT_FAILURE_CODE_INVALID');
    }
    const aggregateResult = {
      aggregate_result_version: 'ushso-final-holdout-aggregate.v1',
      total_items: FINAL_HOLDOUT_ITEM_COUNT,
      threshold_status: 'ERROR',
      failure_code: failureCode,
      no_per_item_output: true,
    };
    const terminalMaterial = {
      lease_digest: clone(lease.lease_digest),
      evaluator_actor_id: evaluatorActorId,
      aggregate_result: aggregateResult,
      completed_at: completedAt,
      completion_observed_at: completionObservedAt,
    };
    const terminalVerificationReceipt = await this.#verifyTerminal({ lease, terminalMaterial, evaluatorActorId });
    const material = {
      receipt_version: 'ushso-final-holdout-single-use-receipt.v1',
      lease_digest: clone(lease.lease_digest),
      package_id: lease.package_id,
      package_content_digest: clone(lease.package_content_digest),
      candidate_id: lease.candidate_id,
      ranking_fingerprint_sha256: lease.ranking_fingerprint_sha256,
      aggregate_result: aggregateResult,
      completed_at: completedAt,
      completion_observed_at: completionObservedAt,
      evaluator_actor_id: evaluatorActorId,
      aggregate_only_output_contract: true,
      package_contents_accessed_by_guard: false,
      guard_receipt_contains_per_item_data: false,
      external_per_item_side_outputs_proven_absent: false,
      authorization_verification_receipt_digest: clone(lease.authorization_verification_receipt_digest),
      terminal_verification_receipt_digest: terminalVerificationReceipt
        ? clone(terminalVerificationReceipt.verification_receipt_digest)
        : null,
      verification_state: this.mode === 'production' ? 'verified_production_receipts' : 'offline_rehearsal_unverified',
      single_use_consumed: true,
    };
    const receipt = { ...material, receipt_digest: canonicalSha256(material) };
    await this.ledger.complete(lease.package_content_digest.value, lease.lease_digest.value, receipt);
    return deepFreeze(receipt);
  }
}
