update ingest.jobs
set state = 'pending',
    lease_owner = null,
    lease_expires_at = null,
    next_eligible_at = clock_timestamp()
where state = 'leased'
  and lease_expires_at <= clock_timestamp()
  and attempt_count < maximum_delivery_attempts
returning job_id, run_id, lease_epoch;
