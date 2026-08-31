with candidates as (
  select event_id
  from ops.outbox
  where state in ('pending', 'retry_wait')
    and event_type <> 'workflow_start_requested'
    and attempt_count < maximum_delivery_attempts
    and coalesce(next_eligible_at, '-infinity'::timestamptz) <= clock_timestamp()
  order by coalesce(next_eligible_at, '-infinity'::timestamptz), created_at, event_id
  for update skip locked
  limit :'lease_limit'
)
update ops.outbox o
set state = 'leased',
    lease_owner = :'lease_owner',
    lease_epoch = o.lease_epoch + 1,
    lease_expires_at = clock_timestamp() + (:'lease_seconds' || ' seconds')::interval,
    first_attempt_at = coalesce(o.first_attempt_at, clock_timestamp()),
    attempt_count = o.attempt_count + 1,
    send_outcome = 'send_started',
    transport_retention_expires_at = clock_timestamp() + interval '4 days'
from candidates c
where o.event_id = c.event_id
returning o.*;
