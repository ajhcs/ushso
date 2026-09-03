select *
from registry.lease_due_source_schedules(
  :'scheduled_slot'::timestamptz, :'lease_acquired_at'::timestamptz, :'lease_owner',
  :'lease_expires_at'::timestamptz,
  :'lease_limit'
);
