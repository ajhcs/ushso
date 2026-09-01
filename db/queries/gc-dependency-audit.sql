select
  p.partition_relation,
  p.state,
  p.retention_deadline,
  a.archive_state,
  a.restore_tested_at,
  d.no_active_work,
  d.no_unexpired_idempotency,
  d.no_workflow_or_replay_dependency,
  d.no_publication_or_rollback_dependency,
  d.no_evidence_or_review_dependency,
  d.archive_checksum_verified,
  d.archive_restore_verified,
  d.backup_pitr_compatible,
  d.legal_policy_approved
from ops.partition_registry p
left join lateral (
  select * from ops.archive_manifests a
  where a.partition_relation = p.partition_relation
  order by a.archived_at desc limit 1
) a on true
left join lateral (
  select * from ops.gc_dependency_proofs d
  where d.partition_relation = p.partition_relation
  order by d.checked_at desc limit 1
) d on true
where p.partition_relation = :'partition_relation';
