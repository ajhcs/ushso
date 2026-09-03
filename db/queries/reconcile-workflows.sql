select run_id, attempt, workflow_instance_id, workflow_version, platform_state,
  created_at, retention_expires_at, last_reconciled_at, next_status_check_at
from ingest.workflow_attempt_mappings
where is_active
  and platform_state not in ('complete', 'errored')
  and coalesce(next_status_check_at, '-infinity'::timestamptz) <= :'reconcile_before'::timestamptz
order by coalesce(last_reconciled_at, '-infinity'::timestamptz), retention_expires_at, run_id
for update skip locked
limit :'reconcile_limit';
