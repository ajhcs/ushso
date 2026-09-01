import { canonicalJson, invariant, iso, parseTimestamp, sha256Hex } from './common.mjs';
import { assertControlStore, withFreshDatabaseClient } from './ports.mjs';
import { createNullLogger } from './redaction.mjs';

const ZERO_DEPENDENCIES = Object.freeze([
  'active_run_count', 'active_lease_count', 'pending_outbox_count', 'nonterminal_workflow_count',
  'open_dead_letter_count', 'active_replay_count', 'unexpired_idempotency_key_count',
  'retained_publication_reference_count', 'rollback_reference_count', 'evidence_lineage_reference_count',
  'pending_review_reference_count', 'audit_dependency_count'
]);

export async function buildGcProof({ partition, dependencies, evaluatedAt }) {
  const blockers = [];
  for (const field of ZERO_DEPENDENCIES) {
    if (!Number.isInteger(dependencies[field]) || dependencies[field] !== 0) blockers.push(`${field}:${dependencies[field] ?? 'missing'}`);
  }
  for (const field of ['archive_checksum_verified', 'archive_access_controlled', 'archive_restore_tested', 'backup_pitr_compatible', 'legal_policy_approved', 'replay_horizon_expired', 'workflow_retention_grace_expired', 'rollback_window_expired']) {
    if (dependencies[field] !== true) blockers.push(`${field}:false`);
  }
  const onlineDays = dependencies.online_retention_days;
  const maximumHorizonDays = dependencies.maximum_recovery_horizon_days;
  const receiptDays = dependencies.publication_security_receipt_retention_days;
  if (!Number.isInteger(onlineDays) || onlineDays < 90) blockers.push(`online_retention_days:${onlineDays ?? 'missing'}`);
  if (!Number.isInteger(maximumHorizonDays) || maximumHorizonDays < 0 || !Number.isInteger(onlineDays) || onlineDays < maximumHorizonDays) {
    blockers.push(`maximum_recovery_horizon_days:${maximumHorizonDays ?? 'missing'}`);
  }
  if (!Number.isInteger(receiptDays) || receiptDays < 365) blockers.push(`publication_security_receipt_retention_days:${receiptDays ?? 'missing'}`);
  if (typeof dependencies.retention_policy_version !== 'string' || !/^[a-z0-9._-]{3,64}$/.test(dependencies.retention_policy_version)) {
    blockers.push('retention_policy_version:missing_or_invalid');
  }
  const base = {
    proof_version: 'wp4-gc-dependency-proof.v1',
    partition_id: partition.partition_id,
    lower_watermark: partition.lower_watermark,
    upper_watermark: partition.upper_watermark,
    evaluated_at: iso(parseTimestamp(evaluatedAt)),
    row_count: partition.row_count,
    archive_locator: partition.archive_locator,
    archive_sha256: partition.archive_sha256,
    retention_policy_version: dependencies.retention_policy_version ?? null,
    dependencies: structuredClone(dependencies),
    blockers: blockers.sort(),
    eligible: blockers.length === 0
  };
  return Object.freeze({ ...base, proof_digest: await sha256Hex(canonicalJson(base)) });
}

export function createRetentionGcService({ openDatabase, faults = { hit() {} }, logger = createNullLogger() }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  async function evaluate({ partitionId, now }) {
    const { partition, dependencies } = await withFreshDatabaseClient(openDatabase, async database => {
      assertControlStore(database);
      return database.listGcDependencies({ partitionId, now: iso(parseTimestamp(now)) });
    });
    return buildGcProof({ partition, dependencies, evaluatedAt: now });
  }

  return Object.freeze({
    evaluate,
    async collect({ partitionId, auditEventId, operatorId, now, execute = false }) {
      const evaluatedAt = iso(parseTimestamp(now));
      if (!execute) {
        const proof = await evaluate({ partitionId, now: evaluatedAt });
        invariant(proof.eligible, 'GC_DEPENDENCY_PROOF_BLOCKED', proof.blockers.join(','));
        return Object.freeze({ executed: false, proof });
      }
      const result = await withFreshDatabaseClient(openDatabase, database => database.transaction('gc-proof-and-delete', async transaction => {
        // Re-read every dependency inside the deletion transaction so a proof can
        // never become stale between evaluation and the destructive operation.
        const { partition, dependencies } = await transaction.listGcDependencies({ partitionId, now: evaluatedAt, lockForUpdate: true });
        const proof = await buildGcProof({ partition, dependencies, evaluatedAt });
        invariant(proof.eligible, 'GC_DEPENDENCY_PROOF_BLOCKED', proof.blockers.join(','));
        await transaction.appendAudit({
          auditEventId, action: 'correctness_ledger_gc', operatorId, partitionId,
          lowerWatermark: proof.lower_watermark, upperWatermark: proof.upper_watermark,
          rowCount: proof.row_count, archiveLocator: proof.archive_locator, archiveSha256: proof.archive_sha256,
          retentionPolicyVersion: proof.retention_policy_version,
          reasonCode: 'DEPENDENCY_PROOF_PASSED', recordedAt: proof.evaluated_at, proofDigest: proof.proof_digest
        });
        await transaction.recordGcProof(proof);
        faults.hit('gc.after_proof_before_delete');
        const deleted = await transaction.deleteGcPartition({ partitionId, proofDigest: proof.proof_digest, deletedAt: proof.evaluated_at });
        return { deleted, proof };
      }));
      logger.emit({ level: 'warn', event: 'gc.partition_deleted', timestamp: result.proof.evaluated_at, partition_id: partitionId, proof_digest: result.proof.proof_digest, count: result.deleted.deleted_count, outcome: 'deleted' });
      return Object.freeze({ executed: true, proof: result.proof, deletedCount: result.deleted.deleted_count });
    }
  });
}
