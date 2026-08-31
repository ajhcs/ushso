with candidates as (
  select job_id
  from ingest.jobs
  where job_type = :'job_type'
    and state in ('pending', 'retry_wait')
    and attempt_count < maximum_delivery_attempts
    and coalesce(next_eligible_at, '-infinity'::timestamptz) <= clock_timestamp()
  order by coalesce(next_eligible_at, '-infinity'::timestamptz), created_at, job_id
  for update skip locked
  limit :'lease_limit'
)
update ingest.jobs j
set state = 'leased',
    lease_owner = :'lease_owner',
    lease_epoch = j.lease_epoch + 1,
    lease_expires_at = clock_timestamp() + (:'lease_seconds' || ' seconds')::interval,
    first_attempt_at = coalesce(j.first_attempt_at, clock_timestamp()),
    attempt_count = j.attempt_count + 1
from candidates c
where j.job_id = c.job_id
returning j.*;
