-- 0002: durable run/job/capture/checkpoint control state.

set local timezone = 'UTC';
set local role ushso_ops_owner;

insert into ops.state_transitions (machine, from_state, to_state, transition_class) values
  ('run', 'scheduled', 'starting', 'normal'),
  ('run', 'starting', 'enumerating', 'normal'),
  ('run', 'enumerating', 'enumerated', 'normal'),
  ('run', 'enumerated', 'normalizing', 'normal'),
  ('run', 'normalizing', 'projecting', 'normal'),
  ('run', 'projecting', 'published', 'normal'),
  ('run', 'published', 'succeeded', 'terminal'),
  ('run', 'published', 'succeeded_with_optional_degradation', 'terminal'),
  ('run', 'scheduled', 'partial_unpublished', 'terminal'),
  ('run', 'starting', 'partial_unpublished', 'terminal'),
  ('run', 'enumerating', 'partial_unpublished', 'terminal'),
  ('run', 'enumerated', 'partial_unpublished', 'terminal'),
  ('run', 'normalizing', 'partial_unpublished', 'terminal'),
  ('run', 'projecting', 'partial_unpublished', 'terminal'),
  ('run', 'scheduled', 'failed', 'terminal'),
  ('run', 'starting', 'failed', 'terminal'),
  ('run', 'enumerating', 'failed', 'terminal'),
  ('run', 'enumerated', 'failed', 'terminal'),
  ('run', 'normalizing', 'failed', 'terminal'),
  ('run', 'projecting', 'failed', 'terminal'),
  ('run', 'published', 'failed', 'terminal'),
  ('run', 'scheduled', 'cancelled', 'terminal'),
  ('run', 'starting', 'cancelled', 'terminal'),
  ('run', 'enumerating', 'cancelled', 'terminal'),
  ('run', 'enumerated', 'cancelled', 'terminal'),
  ('run', 'normalizing', 'cancelled', 'terminal'),
  ('run', 'projecting', 'cancelled', 'terminal'),
  ('job', 'pending', 'leased', 'normal'),
  ('job', 'leased', 'succeeded', 'terminal'),
  ('job', 'leased', 'retry_wait', 'normal'),
  ('job', 'leased', 'quarantined', 'terminal'),
  ('job', 'leased', 'dead', 'terminal'),
  ('job', 'pending', 'succeeded', 'recovery'),
  ('job', 'pending', 'quarantined', 'recovery'),
  ('job', 'pending', 'dead', 'terminal'),
  ('job', 'retry_wait', 'succeeded', 'recovery'),
  ('job', 'retry_wait', 'quarantined', 'recovery'),
  ('job', 'retry_wait', 'dead', 'terminal'),
  ('job', 'retry_wait', 'pending', 'recovery'),
  ('job', 'leased', 'pending', 'recovery'),
  ('source', 'active', 'pause_requested', 'normal'),
  ('source', 'pause_requested', 'draining', 'normal'),
  ('source', 'draining', 'paused', 'normal'),
  ('source', 'paused', 'active', 'recovery'),
  ('source', 'auth_blocked', 'pause_requested', 'recovery'),
  ('source', 'schema_drift', 'pause_requested', 'recovery'),
  ('source', 'auth_blocked', 'active', 'recovery'),
  ('source', 'schema_drift', 'active', 'recovery'),
  ('source', 'active', 'auth_blocked', 'normal'),
  ('source', 'active', 'schema_drift', 'normal'),
  ('source', 'active', 'retired', 'terminal'),
  ('source', 'paused', 'retired', 'terminal'),
  ('source', 'auth_blocked', 'retired', 'terminal'),
  ('source', 'schema_drift', 'retired', 'terminal');

create function ops.assert_transition(machine_name text, old_state text, new_state text)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, ops
as $function$
begin
  if old_state = new_state then
    return;
  end if;
  if not exists (
    select 1 from ops.state_transitions
    where machine = machine_name
      and from_state = old_state
      and to_state = new_state
  ) then
    raise exception using
      errcode = '23514',
      message = format('invalid %s transition: %s -> %s', machine_name, old_state, new_state);
  end if;
end
$function$;

revoke all on function ops.assert_transition(text, text, text) from public;
grant execute on function ops.assert_transition(text, text, text)
  to ushso_registry_owner, ushso_ingest_owner, ushso_scheduler, ushso_harvest,
     ushso_normalize, ushso_projector, ushso_ops;

reset role;
set local role ushso_ingest_owner;

create table ingest.harvest_plans (
  plan_id text primary key check (plan_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  source_id text not null references registry.sources(source_id) on delete restrict,
  endpoint_id text not null references registry.endpoints(endpoint_id) on delete restrict,
  scope_id text not null references registry.scopes(scope_id) on delete restrict,
  scope_set_contract_version text not null default 'harvest-plan-scope-set.v1'
    check (scope_set_contract_version = 'harvest-plan-scope-set.v1'),
  source_configuration_revision integer not null check (source_configuration_revision > 0),
  contract_version text not null check (contract_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  plan_sha256 text not null check (plan_sha256 ~ '^[a-f0-9]{64}$'),
  plan_payload jsonb not null check (jsonb_typeof(plan_payload) = 'object'),
  created_at timestamptz not null,
  unique (source_id, endpoint_id, scope_id, source_configuration_revision, plan_sha256)
);

create index harvest_plans_endpoint_idx on ingest.harvest_plans (endpoint_id);
create index harvest_plans_scope_idx on ingest.harvest_plans (scope_id);

comment on column ingest.harvest_plans.scope_id is
  'Legacy primary scope retained for ingestion.v1.0.0 compatibility; ingest.harvest_plan_scopes is authoritative for complete scope membership.';

create table ingest.harvest_plan_scopes (
  plan_id text not null references ingest.harvest_plans(plan_id) on delete restrict,
  scope_id text not null references registry.scopes(scope_id) on delete restrict,
  ordinal integer not null check (ordinal > 0),
  required_for_publication boolean not null default true check (required_for_publication),
  scope_set_contract_version text not null default 'harvest-plan-scope-set.v1'
    check (scope_set_contract_version = 'harvest-plan-scope-set.v1'),
  primary key (plan_id, scope_id),
  unique (plan_id, ordinal)
);

create function ingest.seed_legacy_plan_scope()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, ingest
as $function$
begin
  insert into ingest.harvest_plan_scopes(plan_id, scope_id, ordinal, required_for_publication)
  values (new.plan_id, new.scope_id, 1, true);
  return new;
end
$function$;

create trigger harvest_plans_seed_legacy_scope
after insert on ingest.harvest_plans for each row execute function ingest.seed_legacy_plan_scope();

create table ingest.harvest_runs (
  run_id text primary key check (run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  plan_id text not null references ingest.harvest_plans(plan_id) on delete restrict,
  source_id text not null references registry.sources(source_id) on delete restrict,
  endpoint_id text not null references registry.endpoints(endpoint_id) on delete restrict,
  source_configuration_revision integer not null check (source_configuration_revision > 0),
  scheduled_slot timestamptz not null,
  mode text not null check (mode in ('incremental', 'full_membership', 'operator_replay')),
  run_idempotency_key text not null unique check (length(run_idempotency_key) between 10 and 400),
  trace_id text not null default 'database-state-event'
    check (trace_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  state text not null check (state in ('scheduled', 'starting', 'enumerating', 'enumerated', 'normalizing', 'projecting', 'published', 'succeeded', 'succeeded_with_optional_degradation', 'partial_unpublished', 'failed', 'cancelled')),
  active_attempt integer not null default 1 check (active_attempt > 0),
  workflow_version text not null default '1.0.0'
    check (workflow_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  deadline_at timestamptz not null,
  optional_degradation_policy jsonb not null default '[]'::jsonb
    check (jsonb_typeof(optional_degradation_policy) = 'array'),
  barrier_policy jsonb not null default '{"policyVersion":"barrier.v1","pollDelayMs":60000,"maximumChecks":1600,"workflowStepBudget":10000}'::jsonb
    check (
      jsonb_typeof(barrier_policy) = 'object'
      and barrier_policy ?& array['policyVersion','pollDelayMs','maximumChecks','workflowStepBudget']
      and barrier_policy - array['policyVersion','pollDelayMs','maximumChecks','workflowStepBudget'] = '{}'::jsonb
      and (barrier_policy->>'policyVersion') ~ '^[A-Za-z0-9._-]{3,64}$'
      and (barrier_policy->>'pollDelayMs') ~ '^[0-9]+$'
      and (barrier_policy->>'maximumChecks') ~ '^[0-9]+$'
      and (barrier_policy->>'workflowStepBudget') ~ '^[0-9]+$'
      and (barrier_policy->>'pollDelayMs')::integer >= 1000
      and (barrier_policy->>'maximumChecks')::integer >= 1
      and (barrier_policy->>'workflowStepBudget')::integer >= 1024
      and (barrier_policy->>'maximumChecks')::integer * 6 + 8 <= (barrier_policy->>'workflowStepBudget')::integer
    ),
  replay_of_run_id text references ingest.harvest_runs(run_id) on delete restrict,
  scope_set_id text not null unique,
  scope_set_contract_version text not null default 'harvest-run-scope-set.v1'
    check (scope_set_contract_version = 'harvest-run-scope-set.v1'),
  enumeration_seal_id text,
  candidate_publication_id text,
  last_known_good_publication_id text not null,
  state_changed_at timestamptz not null,
  terminal_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (run_id, source_id),
  unique (endpoint_id, scheduled_slot, mode, source_configuration_revision),
  check (updated_at >= created_at),
  check (deadline_at > scheduled_slot),
  check (
    (state in ('succeeded', 'succeeded_with_optional_degradation', 'partial_unpublished', 'failed', 'cancelled'))
      = (terminal_at is not null)
  ),
  check ((mode = 'operator_replay') = (replay_of_run_id is not null))
) with (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.02,
        autovacuum_vacuum_threshold = 200, autovacuum_analyze_scale_factor = 0.01,
        autovacuum_analyze_threshold = 100);

create index harvest_runs_source_state_idx on ingest.harvest_runs (source_id, state, state_changed_at);
create index harvest_runs_endpoint_state_idx on ingest.harvest_runs (endpoint_id, state, state_changed_at);
create index harvest_runs_replay_idx on ingest.harvest_runs (replay_of_run_id) where replay_of_run_id is not null;
create index harvest_runs_active_idx on ingest.harvest_runs (state_changed_at, run_id)
  where state not in ('succeeded', 'succeeded_with_optional_degradation', 'partial_unpublished', 'failed', 'cancelled');

comment on column ingest.harvest_runs.enumeration_seal_id is
  'Legacy single-scope ingestion.v1.0.0 field only; never proves all-scope completeness. ingest.harvest_run_scope_sets plus ingest.harvest_run_scopes are authoritative.';

create function ingest.assign_run_scope_set_id()
returns trigger language plpgsql as $function$
begin
  new.scope_set_id := coalesce(new.scope_set_id, 'scope-set:' || new.run_id);
  return new;
end
$function$;

create trigger harvest_runs_assign_scope_set_id
before insert on ingest.harvest_runs for each row execute function ingest.assign_run_scope_set_id();

create table ingest.harvest_run_scope_sets (
  scope_set_id text primary key,
  run_id text not null unique references ingest.harvest_runs(run_id) on delete restrict,
  contract_version text not null check (contract_version = 'harvest-run-scope-set.v1'),
  expected_scope_count integer not null check (expected_scope_count > 0),
  state text not null check (state in ('open', 'sealed', 'checkpoint_committed', 'failed')),
  sealed_scope_count integer not null default 0 check (sealed_scope_count >= 0),
  checkpoint_committed_scope_count integer not null default 0 check (checkpoint_committed_scope_count >= 0),
  recorded_at timestamptz not null,
  sealed_at timestamptz,
  checkpoint_committed_at timestamptz,
  check (sealed_scope_count <= expected_scope_count),
  check (checkpoint_committed_scope_count <= expected_scope_count),
  check (state <> 'sealed' or sealed_scope_count = expected_scope_count),
  check (state <> 'checkpoint_committed' or checkpoint_committed_scope_count = expected_scope_count)
);

create table ingest.harvest_run_scopes (
  run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  scope_set_id text not null references ingest.harvest_run_scope_sets(scope_set_id) on delete restrict,
  source_id text not null references registry.sources(source_id) on delete restrict,
  scope_id text not null references registry.scopes(scope_id) on delete restrict,
  ordinal integer not null check (ordinal > 0),
  required_for_publication boolean not null check (required_for_publication),
  expected_prior_checkpoint_id text,
  expected_prior_checkpoint_sha256 text check (expected_prior_checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
  enumeration_seal_id text,
  committed_checkpoint_id text,
  state text not null check (state in ('planned', 'enumerating', 'sealed', 'checkpoint_committed', 'failed')),
  updated_at timestamptz not null,
  primary key (run_id, scope_id),
  unique (scope_set_id, scope_id),
  unique (run_id, ordinal)
);

create index harvest_run_scopes_barrier_idx
  on ingest.harvest_run_scopes (run_id, state, ordinal);

alter table ingest.harvest_runs
  add constraint harvest_runs_scope_set_fk
  foreign key (scope_set_id) references ingest.harvest_run_scope_sets(scope_set_id)
  deferrable initially deferred;

create function ingest.seed_run_scope_set()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, ingest
as $function$
declare
  expected_count integer;
begin
  select count(*) into expected_count
  from ingest.harvest_plan_scopes where plan_id = new.plan_id and required_for_publication;
  if expected_count = 0 then
    raise exception using errcode = '23514', message = 'harvest run requires at least one authoritative plan scope';
  end if;
  insert into ingest.harvest_run_scope_sets
    (scope_set_id, run_id, contract_version, expected_scope_count, state, recorded_at)
  values (new.scope_set_id, new.run_id, 'harvest-run-scope-set.v1', expected_count, 'open', new.created_at);
  insert into ingest.harvest_run_scopes
    (run_id, scope_set_id, source_id, scope_id, ordinal, required_for_publication,
     expected_prior_checkpoint_id, expected_prior_checkpoint_sha256, state, updated_at)
  select new.run_id, new.scope_set_id, new.source_id, plan_scope.scope_id, plan_scope.ordinal,
         plan_scope.required_for_publication, prior.checkpoint_id, prior.checkpoint_sha256,
         'planned', new.created_at
  from ingest.harvest_plan_scopes plan_scope
  left join lateral (
    select checkpoint_id, checkpoint_sha256
    from ingest.checkpoints
    where source_id = new.source_id and scope_id = plan_scope.scope_id and state = 'committed'
  ) prior on true
  where plan_scope.plan_id = new.plan_id and plan_scope.required_for_publication
  order by plan_scope.ordinal;
  return new;
end
$function$;

create trigger harvest_runs_seed_scope_set
after insert on ingest.harvest_runs for each row execute function ingest.seed_run_scope_set();

create table ingest.workflow_attempt_mappings (
  run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  attempt integer not null check (attempt > 0),
  workflow_instance_id text not null unique check (
    length(workflow_instance_id) <= 100 and
    workflow_instance_id ~ '^[A-Za-z0-9_][A-Za-z0-9_-]*$' and
    workflow_instance_id ~ '^harvest-[A-Za-z0-9_-]+-[1-9][0-9]*$'
  ),
  workflow_version text not null check (workflow_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  platform_state text not null check (platform_state in ('requested', 'running', 'waiting', 'complete', 'errored', 'unknown')),
  is_active boolean not null,
  created_at timestamptz not null,
  retention_expires_at timestamptz not null,
  last_reconciled_at timestamptz,
  next_status_check_at timestamptz,
  terminal_at timestamptz,
  primary key (run_id, attempt),
  check (retention_expires_at > created_at),
  check (next_status_check_at is null or next_status_check_at >= coalesce(last_reconciled_at, created_at)),
  check ((platform_state in ('complete', 'errored')) = (terminal_at is not null)),
  check (is_active = (terminal_at is null))
);

create unique index workflow_one_active_attempt_per_run_idx
  on ingest.workflow_attempt_mappings (run_id) where is_active;
create index workflow_reconcile_idx
  on ingest.workflow_attempt_mappings (coalesce(next_status_check_at, created_at), coalesce(last_reconciled_at, created_at), run_id)
  where platform_state not in ('complete', 'errored');

create table ingest.run_state_events (
  event_id bigint generated always as identity,
  run_id text not null,
  source_id text not null,
  from_state text,
  to_state text not null,
  attempt integer not null check (attempt > 0),
  reason_code text not null,
  trace_id text not null check (trace_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  recorded_at timestamptz not null,
  primary key (event_id, recorded_at)
) partition by range (recorded_at);

create index run_state_events_run_recorded_idx on ingest.run_state_events (run_id, recorded_at desc);
create index run_state_events_source_recorded_idx on ingest.run_state_events (source_id, recorded_at desc);

create table ingest.jobs (
  job_id text primary key check (job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  source_id text not null references registry.sources(source_id) on delete restrict,
  job_type text not null check (job_type in ('harvest_page', 'normalize_record', 'enrich_schema', 'access_check', 'project_index')),
  origin_id text not null default 'origin_registry_pending'
    check (origin_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  target_class text not null default 'exact_item'
    check (target_class in ('catalog_root','collection','pagination_cursor','exact_item','exact_distribution','documentation')),
  state text not null check (state in ('pending', 'leased', 'succeeded', 'retry_wait', 'quarantined', 'dead')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 700),
  identity_payload jsonb not null check (jsonb_typeof(identity_payload) = 'object'),
  active_run_attempt integer not null check (active_run_attempt > 0),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  maximum_delivery_attempts integer not null check (maximum_delivery_attempts between 1 and 10),
  lease_owner text,
  lease_epoch bigint not null default 0 check (lease_epoch >= 0),
  lease_expires_at timestamptz,
  retry_policy_version text not null,
  first_attempt_at timestamptz,
  next_eligible_at timestamptz,
  outbox_event_id text not null,
  last_transport_event_id text,
  transport_retention_expires_at timestamptz,
  transport_generation integer not null default 1 check (transport_generation > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (job_type, idempotency_key),
  check ((state = 'leased') = (lease_owner is not null and lease_expires_at is not null)),
  check (attempt_count <= maximum_delivery_attempts),
  check ((last_transport_event_id is null) = (transport_retention_expires_at is null)),
  check (updated_at >= created_at)
) with (fillfactor = 75, autovacuum_vacuum_scale_factor = 0.02,
        autovacuum_vacuum_threshold = 200, autovacuum_analyze_scale_factor = 0.01,
        autovacuum_analyze_threshold = 100);

create index jobs_lease_due_idx on ingest.jobs
  (job_type, (coalesce(next_eligible_at, '-infinity'::timestamptz)), created_at, job_id)
  include (run_id, source_id, active_run_attempt, attempt_count, maximum_delivery_attempts)
  where state in ('pending', 'retry_wait');
create index jobs_expired_lease_idx on ingest.jobs (lease_expires_at, job_id)
  where state = 'leased';
create index jobs_run_barrier_idx on ingest.jobs (run_id, state, job_type);
create index jobs_source_state_idx on ingest.jobs (source_id, state, updated_at);
create index jobs_outbox_event_idx on ingest.jobs (outbox_event_id);
create index jobs_transport_retention_idx on ingest.jobs (transport_retention_expires_at, job_id)
  where transport_retention_expires_at is not null and state in ('pending', 'retry_wait', 'leased');

create table ingest.job_attempt_keys (
  attempt_id text primary key check (attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  job_id text not null references ingest.jobs(job_id) on delete restrict,
  delivery_attempt integer not null check (delivery_attempt between 1 and 20),
  first_recorded_at timestamptz not null,
  unique (job_id, delivery_attempt)
);

create index job_attempt_keys_job_idx on ingest.job_attempt_keys (job_id);

create table ingest.job_attempts (
  attempt_id text not null,
  job_id text not null,
  run_id text not null,
  source_id text not null,
  delivery_attempt integer not null check (delivery_attempt between 1 and 10),
  maximum_delivery_attempts integer not null default 6 check (maximum_delivery_attempts between 1 and 10),
  retry_policy_version text not null default 'retry.v1' check (retry_policy_version ~ '^[a-z0-9._-]{3,64}$'),
  first_attempt_at timestamptz not null default clock_timestamp(),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  run_attempt integer not null default 1 check (run_attempt > 0),
  lease_epoch bigint not null default 0 check (lease_epoch >= 0),
  original_event_id text not null default 'event-ledger-pending',
  failure_payload jsonb check (failure_payload is null or jsonb_typeof(failure_payload) = 'object'),
  retry_after_seconds integer check (retry_after_seconds between 0 and 86400),
  computed_delay_seconds integer check (computed_delay_seconds between 0 and 86400),
  next_eligible_at timestamptz,
  outcome text not null check (outcome in ('started', 'committed', 'rolled_back', 'retry_scheduled', 'dead_lettered')),
  error_class text,
  database_transaction_committed boolean not null,
  transport_action text not null check (transport_action in ('ack_after_commit', 'retry_after_rollback', 'ack_reledgered_after_commit', 'none_pending')),
  durable_dead_letter_id text,
  recorded_at timestamptz not null,
  trace_id text not null check (trace_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  primary key (attempt_id, recorded_at),
  check (delivery_attempt <= maximum_delivery_attempts),
  check (finished_at is null or finished_at >= started_at),
  check ((transport_action = 'retry_after_rollback') = (not database_transaction_committed)),
  check (transport_action <> 'none_pending' or (finished_at is null and failure_payload is null))
) partition by range (recorded_at);

alter table ingest.job_attempts
  add constraint job_attempts_attempt_key_fk
    foreign key (attempt_id) references ingest.job_attempt_keys(attempt_id) on delete restrict,
  add constraint job_attempts_job_fk
    foreign key (job_id) references ingest.jobs(job_id) on delete restrict,
  add constraint job_attempts_run_fk
    foreign key (run_id) references ingest.harvest_runs(run_id) on delete restrict,
  add constraint job_attempts_source_fk
    foreign key (source_id) references registry.sources(source_id) on delete restrict;

create index job_attempts_job_recorded_idx on ingest.job_attempts (job_id, recorded_at desc);
create index job_attempts_run_recorded_idx on ingest.job_attempts (run_id, recorded_at desc);
create index job_attempts_source_recorded_idx on ingest.job_attempts (source_id, recorded_at desc);

create table ingest.workflow_reconciliation_events (
  reconciliation_event_id bigint generated always as identity,
  run_id text not null,
  workflow_instance_id text not null,
  observed_state text not null,
  outcome text not null check (outcome in ('resumed', 'still_running', 'failed_after_retention', 'terminal_confirmed', 'unknown_create_reconciled')),
  recorded_at timestamptz not null,
  trace_id text not null check (trace_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  primary key (reconciliation_event_id, recorded_at)
) partition by range (recorded_at);

create index workflow_reconciliation_run_idx
  on ingest.workflow_reconciliation_events (run_id, recorded_at desc);

create table ingest.run_cursors (
  cursor_id text primary key check (cursor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  source_id text not null references registry.sources(source_id) on delete restrict,
  cursor_sha256 text not null check (cursor_sha256 ~ '^[a-f0-9]{64}$'),
  encrypted_cursor_reference text,
  page_sequence bigint not null check (page_sequence >= 0),
  state text not null check (state in ('active', 'consumed', 'expired', 'terminal')),
  recorded_at timestamptz not null,
  unique (run_id, cursor_sha256)
);

create index run_cursors_run_sequence_idx on ingest.run_cursors (run_id, page_sequence);

create table ingest.enumeration_seals (
  enumeration_seal_id text primary key check (enumeration_seal_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  scope_set_id text not null references ingest.harvest_run_scope_sets(scope_set_id) on delete restrict,
  source_id text not null references registry.sources(source_id) on delete restrict,
  scope_id text not null references registry.scopes(scope_id) on delete restrict,
  status text not null check (status in ('open', 'sealed', 'failed', 'cursor_expired')),
  pages_discovered bigint not null check (pages_discovered >= 0),
  pages_committed bigint not null check (pages_committed >= 0),
  items_discovered bigint not null check (items_discovered >= 0),
  discoveries_committed bigint not null check (discoveries_committed >= 0),
  page_dead_letter_count bigint not null check (page_dead_letter_count >= 0),
  cursor_expired boolean not null,
  population_sha256 text check (population_sha256 ~ '^[a-f0-9]{64}$'),
  completeness_evidence_reference_id text,
  sealed_at timestamptz,
  check (pages_committed <= pages_discovered),
  check (discoveries_committed <= items_discovered),
  check ((status = 'sealed') = (sealed_at is not null)),
  check (status <> 'sealed' or (pages_committed = pages_discovered and discoveries_committed = items_discovered and page_dead_letter_count = 0 and not cursor_expired and population_sha256 is not null and completeness_evidence_reference_id is not null))
  , unique (run_id, scope_id)
);

create index enumeration_seals_source_status_idx on ingest.enumeration_seals (source_id, status);
create index enumeration_seals_scope_set_idx on ingest.enumeration_seals (scope_set_id, status);

alter table ingest.enumeration_seals
  add constraint enumeration_seals_run_scope_fk
  foreign key (run_id, scope_id) references ingest.harvest_run_scopes(run_id, scope_id)
  on delete restrict;

create function ingest.record_scope_enumeration_seal()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, ingest
as $function$
declare
  expected_set_id text;
  expected_source_id text;
  expected_count integer;
  sealed_count integer;
  failed_count integer;
begin
  select scope_set_id, source_id into expected_set_id, expected_source_id
  from ingest.harvest_run_scopes where run_id = new.run_id and scope_id = new.scope_id for update;
  if expected_set_id is null or new.scope_set_id <> expected_set_id or new.source_id <> expected_source_id then
    raise exception using errcode = '23514', message = 'enumeration seal run/scope/source fence rejected';
  end if;
  update ingest.harvest_run_scopes
  set enumeration_seal_id = new.enumeration_seal_id,
      state = case when new.status = 'sealed' then 'sealed'
                   when new.status in ('failed', 'cursor_expired') then 'failed'
                   else 'enumerating' end,
      updated_at = coalesce(new.sealed_at, clock_timestamp())
  where run_id = new.run_id and scope_id = new.scope_id;
  select expected_scope_count into expected_count
  from ingest.harvest_run_scope_sets where scope_set_id = new.scope_set_id for update;
  select count(*) filter (where state = 'sealed'), count(*) filter (where state = 'failed')
    into sealed_count, failed_count
  from ingest.harvest_run_scopes where scope_set_id = new.scope_set_id and required_for_publication;
  update ingest.harvest_run_scope_sets
  set sealed_scope_count = sealed_count,
      state = case when failed_count > 0 then 'failed' when sealed_count = expected_count then 'sealed' else 'open' end,
      sealed_at = case when sealed_count = expected_count then coalesce(new.sealed_at, clock_timestamp()) else null end
  where scope_set_id = new.scope_set_id;
  return new;
end
$function$;

create trigger enumeration_seals_record_scope
after insert or update of status on ingest.enumeration_seals
for each row execute function ingest.record_scope_enumeration_seal();

create table ingest.checkpoints (
  checkpoint_id text primary key check (checkpoint_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  source_id text not null references registry.sources(source_id) on delete restrict,
  scope_id text not null references registry.scopes(scope_id) on delete restrict,
  configuration_revision integer not null check (configuration_revision > 0),
  strategy text not null check (strategy in ('modified_at_native_id', 'opaque_cursor', 'full_snapshot')),
  position_payload jsonb not null check (jsonb_typeof(position_payload) = 'object'),
  state text not null check (state in ('proposed', 'committed', 'superseded')),
  prior_checkpoint_id text references ingest.checkpoints(checkpoint_id) on delete restrict,
  prior_checkpoint_sha256 text check (prior_checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
  checkpoint_sha256 text not null check (checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
  proposed_by_run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  scope_set_id text not null references ingest.harvest_run_scope_sets(scope_set_id) on delete restrict,
  enumeration_seal_id text not null references ingest.enumeration_seals(enumeration_seal_id) on delete restrict,
  downstream_outbox_committed boolean not null,
  committed_at timestamptz,
  superseded_at timestamptz,
  unique (source_id, scope_id, checkpoint_sha256),
  check (state <> 'committed' or (committed_at is not null and downstream_outbox_committed)),
  check (state <> 'superseded' or superseded_at is not null)
);

create unique index checkpoints_one_committed_idx on ingest.checkpoints (source_id, scope_id)
  where state = 'committed';
create index checkpoints_prior_idx on ingest.checkpoints (prior_checkpoint_id)
  where prior_checkpoint_id is not null;
create index checkpoints_run_idx on ingest.checkpoints (proposed_by_run_id);
create index checkpoints_seal_idx on ingest.checkpoints (enumeration_seal_id);

alter table ingest.checkpoints
  add constraint checkpoints_run_scope_fk
  foreign key (proposed_by_run_id, scope_id) references ingest.harvest_run_scopes(run_id, scope_id)
  on delete restrict;

alter table ingest.harvest_run_scopes
  add constraint harvest_run_scopes_expected_prior_checkpoint_fk
  foreign key (expected_prior_checkpoint_id) references ingest.checkpoints(checkpoint_id) on delete restrict,
  add constraint harvest_run_scopes_committed_checkpoint_fk
  foreign key (committed_checkpoint_id) references ingest.checkpoints(checkpoint_id) on delete restrict,
  add constraint harvest_run_scopes_enumeration_seal_fk
  foreign key (enumeration_seal_id) references ingest.enumeration_seals(enumeration_seal_id) on delete restrict;

create function ingest.commit_scope_checkpoint(
  p_run_id text,
  p_scope_id text,
  p_checkpoint_id text,
  p_expected_prior_checkpoint_id text,
  p_expected_prior_checkpoint_sha256 text,
  p_configuration_revision integer,
  p_strategy text,
  p_position_payload jsonb,
  p_checkpoint_sha256 text,
  p_enumeration_seal_id text,
  p_committed_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, ingest
as $function$
begin
  raise exception using errcode = '0A000',
    message = 'per-scope checkpoint mutation is disabled; use commit_all_scope_checkpoints_and_normalization_outbox';
end
$function$;

create function ingest.finalize_scope_checkpoints_and_normalization_outbox(
  p_run_id text,
  p_job_id text,
  p_outbox_event_id text,
  p_trace_id text,
  p_committed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, ingest, ops
as $function$
begin
  raise exception using errcode = '0A000',
    message = 'split checkpoint finalization is disabled; use commit_all_scope_checkpoints_and_normalization_outbox';
end
$function$;

create function ingest.assert_all_scope_checkpoints_committed(p_run_id text)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, ingest
as $function$
declare
  scope_set ingest.harvest_run_scope_sets%rowtype;
begin
  select * into scope_set from ingest.harvest_run_scope_sets where run_id = p_run_id;
  if not found or scope_set.state <> 'checkpoint_committed'
     or scope_set.expected_scope_count <> scope_set.sealed_scope_count
     or scope_set.expected_scope_count <> scope_set.checkpoint_committed_scope_count
     or exists (
       select 1 from ingest.harvest_run_scopes
       where run_id = p_run_id and required_for_publication and state <> 'checkpoint_committed'
     ) then
    raise exception using errcode = '23514', message = 'all-scope checkpoint barrier incomplete';
  end if;
end
$function$;

revoke all on function ingest.commit_scope_checkpoint(text,text,text,text,text,integer,text,jsonb,text,text,timestamptz) from public;
revoke all on function ingest.finalize_scope_checkpoints_and_normalization_outbox(text,text,text,text,timestamptz) from public;
revoke all on function ingest.assert_all_scope_checkpoints_committed(text) from public;

create table ingest.capture_references (
  capture_reference_id text primary key check (capture_reference_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  source_id text not null references registry.sources(source_id) on delete restrict,
  run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  foreign key (run_id, source_id) references ingest.harvest_runs(run_id, source_id) on delete restrict,
  classification text not null check (classification in ('catalog_metadata', 'documentation', 'schema_description', 'access_observation_metadata')),
  endpoint_id text not null references registry.endpoints(endpoint_id) on delete restrict,
  redacted_locator text not null check (redacted_locator ~ '^https://' and redacted_locator !~ '[?&](token|key|secret|signature|auth)='),
  final_host text not null,
  safe_response_headers jsonb not null check (jsonb_typeof(safe_response_headers) = 'object'),
  media_type text not null,
  compressed_bytes bigint not null check (compressed_bytes between 1 and 52428800),
  decompressed_bytes bigint not null check (decompressed_bytes between 1 and 104857600),
  raw_sha256 text not null unique check (raw_sha256 ~ '^[a-f0-9]{64}$'),
  semantic_sha256 text not null check (semantic_sha256 ~ '^[a-f0-9]{64}$'),
  r2_key text not null unique check (r2_key ~ '^captures/sha256/[a-f0-9]{2}/[a-f0-9]{64}$'),
  r2_conditional_write_confirmed boolean not null check (r2_conditional_write_confirmed),
  connector_version text not null check (connector_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  evidence_reference_id text not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null,
  captured_at timestamptz not null,
  check (recorded_at >= observed_at),
  check (captured_at >= observed_at),
  unique (run_id, capture_reference_id),
  unique (run_id, source_id, capture_reference_id)
);

create index capture_references_run_idx on ingest.capture_references (run_id, captured_at);
create index capture_references_source_idx on ingest.capture_references (source_id, captured_at desc);
create index capture_references_endpoint_idx on ingest.capture_references (endpoint_id);

create table ingest.discoveries (
  discovery_id text primary key check (discovery_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  source_id text not null references registry.sources(source_id) on delete restrict,
  source_native_namespace text not null,
  source_native_id text not null,
  source_revision text not null,
  capture_reference_id text not null references ingest.capture_references(capture_reference_id) on delete restrict,
  discovered_at timestamptz not null,
  foreign key (run_id, source_id, capture_reference_id)
    references ingest.capture_references(run_id, source_id, capture_reference_id) on delete restrict,
  unique (source_id, source_native_namespace, source_native_id, source_revision)
);

create index discoveries_run_idx on ingest.discoveries (run_id, discovered_at);
create index discoveries_capture_idx on ingest.discoveries (capture_reference_id);

create function ingest.reject_late_normalization_denominator_mutation()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, ingest
as $function$
declare
  affected_run_id text;
begin
  affected_run_id := case when tg_op = 'DELETE' then old.run_id else new.run_id end;
  if exists (select 1 from ingest.normalization_manifests where run_id = affected_run_id) then
    raise exception using errcode = '55000', message = 'sealed normalization denominator rejects late capture/discovery mutation';
  end if;
  if tg_op = 'UPDATE' and old.run_id is distinct from new.run_id
     and exists (select 1 from ingest.normalization_manifests where run_id = old.run_id) then
    raise exception using errcode = '55000', message = 'sealed normalization denominator rejects capture/discovery reassignment';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create trigger capture_references_denominator_fence
before insert or update or delete on ingest.capture_references
for each row execute function ingest.reject_late_normalization_denominator_mutation();
create trigger discoveries_denominator_fence
before insert or update or delete on ingest.discoveries
for each row execute function ingest.reject_late_normalization_denominator_mutation();

-- Internal additive successor to the singular ingestion.v1.0.0 run fields.
-- A sealed manifest is the authoritative denominator for downstream
-- normalization work. It is derived only from durable discovery/capture rows;
-- response bodies and source rows never enter the control plane.
create table ingest.normalization_manifests (
  run_id text primary key references ingest.harvest_runs(run_id) on delete restrict,
  scope_set_id text not null unique references ingest.harvest_run_scope_sets(scope_set_id) on delete restrict,
  contract_version text not null default 'normalization-manifest.v1'
    check (contract_version = 'normalization-manifest.v1'),
  normalizer_version text not null check (normalizer_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  required_capture_count integer not null check (required_capture_count >= 0),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check (state = 'sealed'),
  sealed_at timestamptz not null
);

create table ingest.normalization_manifest_items (
  run_id text not null references ingest.normalization_manifests(run_id) on delete restrict,
  capture_reference_id text not null references ingest.capture_references(capture_reference_id) on delete restrict,
  capture_sha256 text not null check (capture_sha256 ~ '^[a-f0-9]{64}$'),
  normalizer_version text not null check (normalizer_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  ordinal integer not null check (ordinal > 0),
  primary key (run_id, capture_reference_id),
  unique (run_id, ordinal),
  unique (run_id, capture_sha256, normalizer_version),
  foreign key (run_id, capture_reference_id)
    references ingest.capture_references(run_id, capture_reference_id) on delete restrict
);

create table ingest.normalization_job_requirements (
  run_id text not null references ingest.normalization_manifests(run_id) on delete restrict,
  capture_reference_id text not null,
  job_id text not null references ingest.jobs(job_id) on delete restrict,
  outbox_event_id text not null,
  satisfaction text not null check (satisfaction in ('created', 'replay_created', 'existing_pending', 'already_succeeded')),
  linked_at timestamptz not null,
  primary key (run_id, capture_reference_id),
  unique (run_id, job_id),
  foreign key (run_id, capture_reference_id)
    references ingest.normalization_manifest_items(run_id, capture_reference_id) on delete restrict
);

create index normalization_requirements_job_idx
  on ingest.normalization_job_requirements (job_id, run_id);

-- Cross-run normalization reuse is authorized only by an immutable committed
-- result artifact. A terminal job row by itself is never success evidence.
create table ingest.normalization_success_artifacts (
  capture_sha256 text not null check (capture_sha256 ~ '^[a-f0-9]{64}$'),
  normalizer_version text not null check (normalizer_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  job_id text not null unique references ingest.jobs(job_id) on delete restrict,
  result_sha256 text not null check (result_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null,
  primary key (capture_sha256, normalizer_version)
);

-- A success artifact is a cross-run authorization capability. Bind it to the
-- exact normalize job and require the job to have reached the terminal success
-- state before the artifact can be written. The application completes the job
-- in the same transaction immediately before inserting this row, so a failed
-- artifact insert rolls the completion back with the business effect.
create function ingest.assert_normalization_success_artifact_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ingest
as $function$
declare
  job_row ingest.jobs%rowtype;
begin
  select * into job_row from ingest.jobs where job_id = new.job_id;
  if not found
     or job_row.job_type <> 'normalize_record'
     or job_row.state <> 'succeeded'
     or job_row.identity_payload->>'capture_sha256' is distinct from new.capture_sha256
     or job_row.identity_payload->>'normalizer_version' is distinct from new.normalizer_version then
    raise exception using errcode = '23514', message = 'normalization success artifact job binding rejected';
  end if;
  return new;
end
$function$;

create trigger normalization_success_artifacts_bind_job
before insert or update on ingest.normalization_success_artifacts
for each row execute function ingest.assert_normalization_success_artifact_job();

create trigger normalization_success_artifacts_append_only
before update or delete on ingest.normalization_success_artifacts
for each statement execute function ops.reject_history_mutation();

create function ingest.reject_normalization_manifest_mutation()
returns trigger language plpgsql as $function$
begin
  raise exception using errcode = '55000', message = 'sealed normalization manifest is immutable';
end
$function$;

create trigger normalization_manifests_append_only
before update or delete on ingest.normalization_manifests
for each statement execute function ingest.reject_normalization_manifest_mutation();
create trigger normalization_manifest_items_append_only
before update or delete on ingest.normalization_manifest_items
for each statement execute function ingest.reject_normalization_manifest_mutation();
create trigger normalization_job_requirements_append_only
before update or delete on ingest.normalization_job_requirements
for each statement execute function ingest.reject_normalization_manifest_mutation();

create function ingest.seal_run_normalization_manifest(
  p_run_id text,
  p_normalizer_version text,
  p_manifest_sha256 text,
  p_sealed_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, ingest
as $function$
declare
  scope_set ingest.harvest_run_scope_sets%rowtype;
  capture_count integer;
  manifest_material jsonb;
  computed_manifest_sha256 text;
begin
  select * into scope_set from ingest.harvest_run_scope_sets
  where run_id = p_run_id for update;
  if not found or scope_set.state <> 'sealed'
     or scope_set.expected_scope_count <> scope_set.sealed_scope_count then
    raise exception using errcode = '23514', message = 'normalization manifest requires the exact all-scope enumeration seal';
  end if;
  if exists (select 1 from ingest.normalization_manifests where run_id = p_run_id) then
    select required_capture_count into capture_count
    from ingest.normalization_manifests
    where run_id = p_run_id and normalizer_version = p_normalizer_version
      and manifest_sha256 = p_manifest_sha256;
    if not found then
      raise exception using errcode = '23505', message = 'normalization manifest idempotency conflict';
    end if;
    return capture_count;
  end if;
  select coalesce(jsonb_agg(
      jsonb_build_object(
        'capture_reference_id', required.capture_reference_id,
        'capture_sha256', required.raw_sha256,
        'normalizer_version', p_normalizer_version
      ) order by required.raw_sha256, required.capture_reference_id
    ), '[]'::jsonb)
  into manifest_material
  from (
    select distinct capture.capture_reference_id, capture.raw_sha256
    from ingest.discoveries discovery
    join ingest.capture_references capture
      on capture.capture_reference_id = discovery.capture_reference_id
     and capture.run_id = discovery.run_id
     and capture.source_id = discovery.source_id
    where discovery.run_id = p_run_id
      and capture.r2_conditional_write_confirmed
      and capture.classification in ('catalog_metadata', 'documentation')
  ) required;
  capture_count := jsonb_array_length(manifest_material);
  computed_manifest_sha256 := encode(sha256(convert_to(manifest_material::text, 'UTF8')), 'hex');
  if p_manifest_sha256 is distinct from computed_manifest_sha256 then
    raise exception using errcode = '23514', message = 'normalization manifest digest is not DB-bound to the sealed capture set';
  end if;
  /* Denominator material is recomputed above under the locked all-scope seal. */
  perform count(distinct discovery.capture_reference_id)
  from ingest.discoveries discovery
  join ingest.capture_references capture
    on capture.capture_reference_id = discovery.capture_reference_id
   and capture.run_id = discovery.run_id
   and capture.source_id = discovery.source_id
  where discovery.run_id = p_run_id
    and capture.r2_conditional_write_confirmed
    and capture.classification in ('catalog_metadata', 'documentation');
  insert into ingest.normalization_manifests
    (run_id, scope_set_id, normalizer_version, required_capture_count,
     manifest_sha256, state, sealed_at)
  values
    (p_run_id, scope_set.scope_set_id, p_normalizer_version, capture_count,
     computed_manifest_sha256, 'sealed', p_sealed_at);
  insert into ingest.normalization_manifest_items
    (run_id, capture_reference_id, capture_sha256, normalizer_version, ordinal)
  select p_run_id, capture.capture_reference_id, capture.raw_sha256,
         p_normalizer_version,
         row_number() over (order by capture.raw_sha256, capture.capture_reference_id)::integer
  from (
    select distinct discovery.capture_reference_id
    from ingest.discoveries discovery
    where discovery.run_id = p_run_id
  ) required
  join ingest.capture_references capture
    on capture.capture_reference_id = required.capture_reference_id
   and capture.run_id = p_run_id
  where capture.r2_conditional_write_confirmed
    and capture.classification in ('catalog_metadata', 'documentation')
  order by capture.raw_sha256, capture.capture_reference_id;
  if (select count(*) from ingest.normalization_manifest_items where run_id = p_run_id) <> capture_count then
    raise exception using errcode = '23514', message = 'normalization manifest capture count mismatch';
  end if;
  return capture_count;
end
$function$;

create function ingest.commit_all_scope_checkpoints_and_normalization_outbox(
  p_run_id text,
  p_checkpoint_set jsonb,
  p_trace_id text,
  p_committed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ingest, ops
as $function$
declare
  run_row ingest.harvest_runs%rowtype;
  scope_set ingest.harvest_run_scope_sets%rowtype;
  manifest ingest.normalization_manifests%rowtype;
  run_scope ingest.harvest_run_scopes%rowtype;
  current_checkpoint ingest.checkpoints%rowtype;
  checkpoint_input jsonb;
  manifest_item ingest.normalization_manifest_items%rowtype;
  deterministic_job_id text;
  deterministic_event_id text;
  logical_job_idempotency_key text;
  selected_satisfaction text;
  selected_job ingest.jobs%rowtype;
  requirement_count integer;
  outbox_count integer;
  outbox_event_type text;
  outbox_producer text;
  outbox_idempotency_key text;
  outbox_references jsonb;
  outbox_trace_id text;
  outbox_maximum_attempts integer;
  selected_run_trace_id text;
  selected_scope_set_id text;
begin
  if jsonb_typeof(p_checkpoint_set) <> 'array' then
    raise exception using errcode = '22023', message = 'checkpoint set must be a JSON array';
  end if;
  select * into run_row from ingest.harvest_runs where run_id = p_run_id for update;
  if not found or run_row.terminal_at is not null then
    raise exception using errcode = '23514', message = 'checkpoint run is missing or terminal';
  end if;
  if p_trace_id is distinct from run_row.trace_id then
    raise exception using errcode = '23514', message = 'checkpoint/outbox trace fence rejected';
  end if;
  select * into scope_set from ingest.harvest_run_scope_sets where run_id = p_run_id for update;
  if not found or scope_set.state not in ('sealed', 'checkpoint_committed')
     or scope_set.expected_scope_count <> scope_set.sealed_scope_count then
    raise exception using errcode = '23514', message = 'all-scope enumeration barrier incomplete';
  end if;
  select * into manifest from ingest.normalization_manifests where run_id = p_run_id;
  if not found or manifest.state <> 'sealed' or manifest.scope_set_id <> scope_set.scope_set_id then
    raise exception using errcode = '23514', message = 'sealed normalization manifest missing';
  end if;
  if jsonb_array_length(p_checkpoint_set) <> scope_set.expected_scope_count
     or (select count(distinct item->>'scope_id') from jsonb_array_elements(p_checkpoint_set) item)
        <> scope_set.expected_scope_count then
    raise exception using errcode = '23514', message = 'checkpoint set scope cardinality mismatch';
  end if;

  if scope_set.state = 'checkpoint_committed' then
    for run_scope in
      select * from ingest.harvest_run_scopes
      where run_id = p_run_id and required_for_publication
      order by ordinal
    loop
      select item into checkpoint_input
      from jsonb_array_elements(p_checkpoint_set) item
      where item->>'scope_id' = run_scope.scope_id;
      select * into current_checkpoint from ingest.checkpoints
      where checkpoint_id = run_scope.committed_checkpoint_id;
      if checkpoint_input is null or run_scope.state <> 'checkpoint_committed'
         or current_checkpoint.checkpoint_id is null
         or checkpoint_input->>'checkpoint_id' is distinct from current_checkpoint.checkpoint_id
         or checkpoint_input->>'checkpoint_sha256' is distinct from current_checkpoint.checkpoint_sha256
         or checkpoint_input->>'enumeration_seal_id' is distinct from current_checkpoint.enumeration_seal_id
         or checkpoint_input->>'expected_prior_checkpoint_id' is distinct from current_checkpoint.prior_checkpoint_id
         or checkpoint_input->>'expected_prior_checkpoint_sha256' is distinct from current_checkpoint.prior_checkpoint_sha256
         or checkpoint_input->>'strategy' is distinct from current_checkpoint.strategy
         or checkpoint_input->'position_payload' is distinct from current_checkpoint.position_payload
         or not current_checkpoint.downstream_outbox_committed then
        raise exception using errcode = '23505', message = 'committed checkpoint receipt idempotency conflict';
      end if;
    end loop;
    select count(*) into requirement_count
    from ingest.normalization_job_requirements where run_id = p_run_id;
    execute $sql$
      select count(*) from ops.outbox outbox_event
      join ingest.normalization_job_requirements requirement
        on requirement.outbox_event_id = outbox_event.event_id
      where requirement.run_id = $1
        and outbox_event.event_type = 'normalize_requested'
    $sql$ into outbox_count using p_run_id;
    if requirement_count <> manifest.required_capture_count
       or outbox_count <> manifest.required_capture_count then
      raise exception using errcode = '23514', message = 'committed normalization receipt cardinality drift';
    end if;
    perform ingest.assert_all_scope_checkpoints_committed(p_run_id);
    return jsonb_build_object(
      'committed_scope_count', scope_set.expected_scope_count,
      'required_capture_count', manifest.required_capture_count,
      'normalization_requirement_count', requirement_count,
      'normalization_outbox_count', outbox_count,
      'idempotent_readback', true
    );
  end if;

  for run_scope in
    select * from ingest.harvest_run_scopes
    where run_id = p_run_id and required_for_publication
    order by ordinal for update
  loop
    select item into checkpoint_input
    from jsonb_array_elements(p_checkpoint_set) item
    where item->>'scope_id' = run_scope.scope_id;
    if checkpoint_input is null
       or run_scope.state <> 'sealed'
       or checkpoint_input->>'enumeration_seal_id' is distinct from run_scope.enumeration_seal_id
       or checkpoint_input->>'expected_prior_checkpoint_id' is distinct from run_scope.expected_prior_checkpoint_id
       or checkpoint_input->>'expected_prior_checkpoint_sha256' is distinct from run_scope.expected_prior_checkpoint_sha256 then
      raise exception using errcode = '40001', message = 'checkpoint set expected-prior or enumeration fence rejected';
    end if;
    select * into current_checkpoint from ingest.checkpoints
    where source_id = run_scope.source_id and scope_id = run_scope.scope_id and state = 'committed'
    for update;
    if current_checkpoint.checkpoint_id is distinct from run_scope.expected_prior_checkpoint_id
       or current_checkpoint.checkpoint_sha256 is distinct from run_scope.expected_prior_checkpoint_sha256 then
      raise exception using errcode = '40001', message = 'all-scope checkpoint compare-and-swap rejected stale head';
    end if;
    insert into ingest.checkpoints
      (checkpoint_id, source_id, scope_id, configuration_revision, strategy,
       position_payload, state, prior_checkpoint_id, prior_checkpoint_sha256,
       checkpoint_sha256, proposed_by_run_id, scope_set_id, enumeration_seal_id,
       downstream_outbox_committed, committed_at, superseded_at)
    values
      (checkpoint_input->>'checkpoint_id', run_scope.source_id, run_scope.scope_id,
       run_row.source_configuration_revision, checkpoint_input->>'strategy',
       checkpoint_input->'position_payload', 'proposed',
       run_scope.expected_prior_checkpoint_id, run_scope.expected_prior_checkpoint_sha256,
       checkpoint_input->>'checkpoint_sha256', p_run_id, scope_set.scope_set_id,
       run_scope.enumeration_seal_id, false, null, null);
  end loop;

  for manifest_item in
    select * from ingest.normalization_manifest_items
    where run_id = p_run_id order by ordinal
  loop
    deterministic_job_id := 'job_normalize_' || manifest_item.capture_sha256 || '_' || replace(manifest.normalizer_version, '.', '_');
    deterministic_event_id := 'event_normalize_' || manifest_item.capture_sha256 || '_' || replace(manifest.normalizer_version, '.', '_');
    logical_job_idempotency_key := 'normalize:' || manifest_item.capture_sha256 || ':' || manifest.normalizer_version;
    selected_satisfaction := null;
    insert into ingest.jobs
      (job_id, run_id, source_id, job_type, origin_id, target_class, state, idempotency_key, identity_payload,
       active_run_attempt, attempt_count, maximum_delivery_attempts, lease_owner,
       lease_epoch, lease_expires_at, retry_policy_version, first_attempt_at,
       next_eligible_at, outbox_event_id, created_at, updated_at)
    values
      (deterministic_job_id, p_run_id, run_row.source_id, 'normalize_record',
       'origin:' || run_row.endpoint_id, 'exact_item', 'pending',
       logical_job_idempotency_key,
       jsonb_build_object(
         'cursor_sha256', null, 'capture_sha256', manifest_item.capture_sha256,
         'normalizer_version', manifest.normalizer_version, 'canonical_id', null,
         'canonical_revision_id', null, 'recipe_version', null,
         'distribution_id', null, 'scheduled_slot', null, 'projection_version', null
       ), run_row.active_attempt, 0, 5, null, 1, null, 'retry.v1', null, null,
       deterministic_event_id, p_committed_at, p_committed_at)
    on conflict (job_type, idempotency_key) do nothing;
    select * into selected_job from ingest.jobs
      where job_type = 'normalize_record'
      and idempotency_key = logical_job_idempotency_key;
    if selected_job.job_id <> deterministic_job_id or selected_job.outbox_event_id <> deterministic_event_id
       or selected_job.identity_payload->>'capture_sha256' is distinct from manifest_item.capture_sha256
       or selected_job.identity_payload->>'normalizer_version' is distinct from manifest.normalizer_version then
      raise exception using errcode = '23505', message = 'normalization job deterministic identity conflict';
    end if;
    if selected_job.state = 'succeeded' then
      if not exists (
        select 1 from ingest.normalization_success_artifacts artifact
        where artifact.capture_sha256 = manifest_item.capture_sha256
          and artifact.normalizer_version = manifest.normalizer_version
          and artifact.job_id = selected_job.job_id
      ) then
        raise exception using errcode = '23514', message = 'normalization success reuse artifact missing';
      end if;
      selected_satisfaction := 'already_succeeded';
    elsif selected_job.state in ('pending','retry_wait','leased')
      and exists (
        select 1 from ingest.harvest_runs owning_run
        where owning_run.run_id = selected_job.run_id and owning_run.terminal_at is null
      ) then
      selected_satisfaction := case when selected_job.run_id = p_run_id then 'created' else 'existing_pending' end;
    else
      -- A dead/quarantined job, or pending work whose owning run is terminal,
      -- cannot satisfy a later run. Allocate immutable run-scoped replay
      -- lineage while retaining the canonical capture/version logical key.
      deterministic_job_id := 'job_normalize_replay_' || manifest_item.capture_sha256 || '_'
        || replace(manifest.normalizer_version, '.', '_') || '_'
        || substr(encode(sha256(convert_to(p_run_id, 'UTF8')), 'hex'), 1, 16);
      deterministic_event_id := 'event_normalize_replay_' || manifest_item.capture_sha256 || '_'
        || replace(manifest.normalizer_version, '.', '_') || '_'
        || substr(encode(sha256(convert_to(p_run_id, 'UTF8')), 'hex'), 1, 16);
      insert into ingest.jobs
        (job_id, run_id, source_id, job_type, origin_id, target_class, state,
         idempotency_key, identity_payload, active_run_attempt, attempt_count,
         maximum_delivery_attempts, lease_owner, lease_epoch, lease_expires_at,
         retry_policy_version, first_attempt_at, next_eligible_at,
         outbox_event_id, created_at, updated_at)
      values
        (deterministic_job_id, p_run_id, run_row.source_id, 'normalize_record',
         'origin:' || run_row.endpoint_id, 'exact_item', 'pending',
         logical_job_idempotency_key || ':replay:' || p_run_id,
         jsonb_build_object(
           'cursor_sha256', null, 'capture_sha256', manifest_item.capture_sha256,
           'normalizer_version', manifest.normalizer_version, 'canonical_id', null,
           'canonical_revision_id', null, 'recipe_version', null,
           'distribution_id', null, 'scheduled_slot', null, 'projection_version', null,
           'logical_idempotency_key', logical_job_idempotency_key,
           'replay_of_job_id', selected_job.job_id
         ), run_row.active_attempt, 0, 5, null, 1, null, 'retry.v1', null,
         null, deterministic_event_id, p_committed_at, p_committed_at)
      on conflict (job_type, idempotency_key) do nothing;
      select * into selected_job from ingest.jobs
      where job_type = 'normalize_record'
        and idempotency_key = logical_job_idempotency_key || ':replay:' || p_run_id;
      if selected_job.job_id <> deterministic_job_id
         or selected_job.outbox_event_id <> deterministic_event_id
         or selected_job.run_id <> p_run_id
         or selected_job.state not in ('pending','retry_wait','leased','succeeded')
         or selected_job.identity_payload->>'logical_idempotency_key' is distinct from logical_job_idempotency_key then
        raise exception using errcode = '23505', message = 'normalization replay lineage conflict';
      end if;
      if selected_job.state = 'succeeded' and not exists (
        select 1 from ingest.normalization_success_artifacts artifact
        where artifact.capture_sha256 = manifest_item.capture_sha256
          and artifact.normalizer_version = manifest.normalizer_version
          and artifact.job_id = selected_job.job_id
      ) then
        raise exception using errcode = '23514', message = 'normalization replay success artifact missing';
      end if;
      selected_satisfaction := case when selected_job.state = 'succeeded' then 'already_succeeded' else 'replay_created' end;
    end if;
    execute $sql$
      insert into ops.outbox
        (event_id, event_type, producer, idempotency_key, state, references_payload,
         trace_id, attempt_count, maximum_delivery_attempts, lease_owner,
         lease_epoch, lease_expires_at, first_attempt_at, next_eligible_at,
         created_at, updated_at, published_at)
      values ($1, 'normalize_requested', 'workflow', $2, 'pending', $3, $4,
              0, 5, null, 0, null, null, null, $5, $5, null)
      on conflict (event_id) do nothing
    $sql$ using deterministic_event_id,
      'event:normalize_requested:' || deterministic_job_id,
      jsonb_build_object(
        'run_id', p_run_id, 'job_id', deterministic_job_id,
        'capture_ref_id', manifest_item.capture_reference_id,
        'checkpoint_id', scope_set.scope_set_id, 'canonical_id', null,
        'canonical_revision_id', null, 'r2_key', null, 'cursor_ref_id', null
      ), p_trace_id, p_committed_at;
    execute $sql$
      select outbox_event.event_type, outbox_event.producer,
             outbox_event.idempotency_key, outbox_event.references_payload,
             outbox_event.trace_id, outbox_event.maximum_delivery_attempts
      from ops.outbox outbox_event where outbox_event.event_id = $1
    $sql$ into outbox_event_type, outbox_producer, outbox_idempotency_key,
      outbox_references, outbox_trace_id, outbox_maximum_attempts
      using deterministic_event_id;
    select trace_id, scope_set_id into selected_run_trace_id, selected_scope_set_id
    from ingest.harvest_runs where run_id = selected_job.run_id;
    if outbox_event_type is distinct from 'normalize_requested'
       or outbox_producer is distinct from 'workflow'
       or outbox_idempotency_key is distinct from 'event:normalize_requested:' || deterministic_job_id
       or outbox_trace_id is distinct from selected_run_trace_id
       or outbox_maximum_attempts is distinct from 5
       or outbox_references is distinct from jsonb_build_object(
         'run_id', selected_job.run_id, 'job_id', deterministic_job_id,
         'capture_ref_id', manifest_item.capture_reference_id,
         'checkpoint_id', selected_scope_set_id, 'canonical_id', null,
         'canonical_revision_id', null, 'r2_key', null, 'cursor_ref_id', null
       ) then
      raise exception using errcode = '23514', message = 'normalization outbox exact-envelope lineage conflict';
    end if;
    insert into ingest.normalization_job_requirements
      (run_id, capture_reference_id, job_id, outbox_event_id, satisfaction, linked_at)
    values
      (p_run_id, manifest_item.capture_reference_id, deterministic_job_id,
       deterministic_event_id,
       selected_satisfaction,
       p_committed_at);
  end loop;

  select count(*) into requirement_count
  from ingest.normalization_job_requirements where run_id = p_run_id;
  execute $sql$
    select count(*) from ops.outbox outbox_event
    join ingest.normalization_job_requirements requirement
      on requirement.outbox_event_id = outbox_event.event_id
    where requirement.run_id = $1
      and outbox_event.event_type = 'normalize_requested'
  $sql$ into outbox_count using p_run_id;
  if requirement_count <> manifest.required_capture_count
     or outbox_count <> manifest.required_capture_count then
    raise exception using errcode = '23514', message = 'normalization requirement/outbox count mismatch';
  end if;

  update ingest.checkpoints old_head
  set state = 'superseded', superseded_at = p_committed_at
  from ingest.harvest_run_scopes run_scope
  where run_scope.run_id = p_run_id and run_scope.required_for_publication
    and old_head.checkpoint_id = run_scope.expected_prior_checkpoint_id
    and old_head.state = 'committed';
  update ingest.checkpoints
  set state = 'committed', downstream_outbox_committed = true,
      committed_at = p_committed_at
  where proposed_by_run_id = p_run_id and state = 'proposed';
  update ingest.harvest_run_scopes run_scope
  set committed_checkpoint_id = checkpoint.checkpoint_id,
      state = 'checkpoint_committed', updated_at = p_committed_at
  from ingest.checkpoints checkpoint
  where run_scope.run_id = p_run_id and run_scope.required_for_publication
    and checkpoint.proposed_by_run_id = p_run_id
    and checkpoint.scope_id = run_scope.scope_id and checkpoint.state = 'committed';
  update ingest.harvest_run_scope_sets
  set state = 'checkpoint_committed',
      checkpoint_committed_scope_count = expected_scope_count,
      checkpoint_committed_at = p_committed_at
  where scope_set_id = scope_set.scope_set_id;
  perform ingest.assert_all_scope_checkpoints_committed(p_run_id);
  return jsonb_build_object(
    'committed_scope_count', scope_set.expected_scope_count,
    'required_capture_count', manifest.required_capture_count,
    'normalization_requirement_count', requirement_count,
    'normalization_outbox_count', outbox_count
  );
end
$function$;

revoke all on function ingest.seal_run_normalization_manifest(text,text,text,timestamptz) from public;
revoke all on function ingest.commit_all_scope_checkpoints_and_normalization_outbox(text,jsonb,text,timestamptz) from public;

-- Current month, prior month, and three future months. The direct maintenance
-- tool extends this horizon and refuses unknown parents.
do $partitions$
declare
  month_start date;
  month_end date;
  suffix text;
  table_name text;
begin
  for month_start in
    select (date_trunc('month', current_date) + (n || ' month')::interval)::date
    from generate_series(-1, 3) as n
  loop
    month_end := (month_start + interval '1 month')::date;
    suffix := to_char(month_start, 'YYYY_MM');
    foreach table_name in array array['run_state_events', 'job_attempts', 'workflow_reconciliation_events'] loop
      execute format(
        'create table if not exists ingest.%I partition of ingest.%I for values from (%L) to (%L)',
        table_name || '_' || suffix, table_name, month_start, month_end
      );
      execute format(
        'alter table ingest.%I set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 100)',
        table_name || '_' || suffix
      );
    end loop;
  end loop;
end
$partitions$;

create function ingest.validate_run_transition()
returns trigger language plpgsql as $function$
begin
  if old.state in ('succeeded', 'succeeded_with_optional_degradation', 'partial_unpublished', 'failed', 'cancelled') then
    raise exception using errcode = '55000', message = 'terminal harvest run is immutable';
  end if;
  perform ops.assert_transition('run', old.state, new.state);
  if row(old.plan_id, old.source_id, old.endpoint_id, old.source_configuration_revision,
         old.scheduled_slot, old.mode, old.run_idempotency_key, old.active_attempt,
         old.workflow_version, old.deadline_at, old.optional_degradation_policy,
         old.barrier_policy, old.scope_set_id, old.scope_set_contract_version,
         old.replay_of_run_id, old.last_known_good_publication_id, old.trace_id)
     is distinct from
     row(new.plan_id, new.source_id, new.endpoint_id, new.source_configuration_revision,
         new.scheduled_slot, new.mode, new.run_idempotency_key, new.active_attempt,
         new.workflow_version, new.deadline_at, new.optional_degradation_policy,
         new.barrier_policy, new.scope_set_id, new.scope_set_contract_version,
         new.replay_of_run_id, new.last_known_good_publication_id, new.trace_id) then
    raise exception using errcode = '55000', message = 'harvest run identity and admission policy are immutable';
  end if;
  if old.state <> new.state then
    new.state_changed_at := clock_timestamp();
    if new.state in ('succeeded', 'succeeded_with_optional_degradation', 'partial_unpublished', 'failed', 'cancelled') then
      new.terminal_at := coalesce(new.terminal_at, clock_timestamp());
    end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$function$;

create function ingest.record_run_state_event()
returns trigger language plpgsql as $function$
begin
  if tg_op = 'INSERT' or old.state <> new.state then
    insert into ingest.run_state_events
      (run_id, source_id, from_state, to_state, attempt, reason_code, trace_id, recorded_at)
    values
      (new.run_id, new.source_id, case when tg_op = 'INSERT' then null else old.state end,
       new.state, new.active_attempt, case when tg_op = 'INSERT' then 'run_created' else 'state_transition' end,
       new.trace_id, clock_timestamp());
  end if;
  return new;
end
$function$;

create trigger harvest_runs_validate_transition
before update on ingest.harvest_runs for each row execute function ingest.validate_run_transition();
create trigger harvest_runs_record_state
after insert or update on ingest.harvest_runs for each row execute function ingest.record_run_state_event();

create function ingest.validate_workflow_mapping_transition()
returns trigger language plpgsql as $function$
begin
  if row(old.run_id, old.attempt, old.workflow_instance_id, old.workflow_version,
         old.created_at, old.retention_expires_at)
     is distinct from
     row(new.run_id, new.attempt, new.workflow_instance_id, new.workflow_version,
         new.created_at, new.retention_expires_at) then
    raise exception using errcode = '55000', message = 'workflow attempt mapping identity is immutable';
  end if;
  if old.terminal_at is not null then
    raise exception using errcode = '55000', message = 'terminal workflow attempt mapping is immutable';
  end if;
  if old.platform_state = 'complete' or old.platform_state = 'errored' then
    raise exception using errcode = '55000', message = 'terminal workflow platform state is immutable';
  end if;
  return new;
end
$function$;

create trigger workflow_attempt_mappings_validate_transition
before update on ingest.workflow_attempt_mappings
for each row execute function ingest.validate_workflow_mapping_transition();

create function ingest.validate_job_attempt_lineage()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, ingest
as $function$
declare
  attempt_key ingest.job_attempt_keys%rowtype;
  job_row ingest.jobs%rowtype;
  run_row ingest.harvest_runs%rowtype;
  effect_committed_at timestamptz;
begin
  select * into attempt_key from ingest.job_attempt_keys where attempt_id = new.attempt_id;
  select * into job_row from ingest.jobs where job_id = new.job_id;
  select * into run_row from ingest.harvest_runs where run_id = new.run_id;
  effect_committed_at := coalesce(new.finished_at, new.recorded_at);
  if attempt_key.attempt_id is null or job_row.job_id is null
     or run_row.run_id is null
     or attempt_key.job_id <> new.job_id
     or attempt_key.delivery_attempt <> new.delivery_attempt
     or job_row.run_id <> new.run_id
     or job_row.source_id <> new.source_id
     or run_row.source_id <> new.source_id
     or run_row.active_attempt <> new.run_attempt
     or job_row.active_run_attempt <> new.run_attempt
     or job_row.attempt_count <> new.delivery_attempt
     or job_row.lease_epoch <> new.lease_epoch
     or job_row.maximum_delivery_attempts <> new.maximum_delivery_attempts
     or job_row.retry_policy_version <> new.retry_policy_version
     or new.original_event_id is distinct from job_row.last_transport_event_id
        and new.original_event_id is distinct from job_row.outbox_event_id
     or (
       new.outcome <> 'dead_lettered'
       and (
         run_row.terminal_at is not null
         or job_row.state <> 'leased'
         or job_row.lease_owner is null
         or job_row.lease_expires_at is null
         or job_row.lease_expires_at <= effect_committed_at
       )
     )
     or (
       new.outcome = 'dead_lettered'
     and job_row.state not in ('succeeded', 'quarantined', 'dead')
     ) then
    raise exception using errcode = '23514', message = 'job-attempt authoritative lineage fence rejected';
  end if;
  if (session_user = 'ushso_harvest' and job_row.job_type <> 'harvest_page')
     or (session_user = 'ushso_normalize' and job_row.job_type not in ('normalize_record','enrich_schema','access_check'))
     or (session_user = 'ushso_projector' and job_row.job_type <> 'project_index') then
    raise exception using errcode = '42501', message = 'job-attempt stage-role fence rejected';
  end if;
  return new;
end
$function$;

create trigger job_attempts_validate_lineage
before insert on ingest.job_attempts
for each row execute function ingest.validate_job_attempt_lineage();

create function ingest.validate_job_transition()
returns trigger language plpgsql as $function$
begin
  if old.state in ('succeeded', 'quarantined', 'dead') then
    raise exception using errcode = '55000', message = 'terminal ingestion job is immutable';
  end if;
  if (session_user = 'ushso_harvest' and old.job_type <> 'harvest_page')
     or (session_user = 'ushso_normalize' and old.job_type not in ('normalize_record','enrich_schema','access_check'))
     or (session_user = 'ushso_projector' and old.job_type <> 'project_index') then
    raise exception using errcode = '42501', message = 'ingestion job stage-role fence rejected';
  end if;
  perform ops.assert_transition('job', old.state, new.state);
  if row(old.run_id, old.source_id, old.job_type, old.origin_id, old.target_class,
         old.idempotency_key, old.identity_payload, old.active_run_attempt,
         old.maximum_delivery_attempts, old.retry_policy_version, old.outbox_event_id)
     is distinct from
     row(new.run_id, new.source_id, new.job_type, new.origin_id, new.target_class,
         new.idempotency_key, new.identity_payload, new.active_run_attempt,
         new.maximum_delivery_attempts, new.retry_policy_version, new.outbox_event_id) then
    raise exception using errcode = '55000', message = 'ingestion job identity and retry policy are immutable';
  end if;
  if new.transport_generation < old.transport_generation
     or new.lease_epoch < old.lease_epoch or new.attempt_count < old.attempt_count then
    raise exception using errcode = '23514', message = 'ingestion job fence counters are monotonic';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$function$;

create trigger jobs_validate_transition
before update on ingest.jobs for each row execute function ingest.validate_job_transition();

reset role;
set local role ushso_registry_owner;

create function registry.validate_source_transition()
returns trigger language plpgsql as $function$
begin
  perform ops.assert_transition('source', old.state, new.state);
  if old.state = 'retired' then
    raise exception using errcode = '55000', message = 'retired source is immutable';
  end if;
  return new;
end
$function$;

create trigger sources_validate_transition
before update of state on registry.sources for each row execute function registry.validate_source_transition();

reset role;

-- The operations owner records durable dead-letter and replay lineage with
-- restrictive foreign keys into ingest, without receiving read access.
grant usage on schema ingest to ushso_ops_owner;
grant references on ingest.harvest_runs, ingest.jobs to ushso_ops_owner;
grant select, update on ingest.harvest_runs, ingest.jobs,
  ingest.workflow_attempt_mappings to ushso_ops_owner;
grant select, insert on ingest.job_attempt_keys, ingest.job_attempts,
  ingest.run_state_events, ingest.workflow_reconciliation_events to ushso_ops_owner;

grant select on ingest.harvest_plans, ingest.harvest_plan_scopes to ushso_scheduler;
grant select, update on ingest.harvest_runs to ushso_scheduler;
grant select on ingest.harvest_run_scope_sets, ingest.harvest_run_scopes to ushso_scheduler;
grant select, insert, update on ingest.workflow_attempt_mappings to ushso_scheduler;
grant select, insert on ingest.run_state_events to ushso_scheduler;

grant select, insert, update on ingest.harvest_runs, ingest.workflow_attempt_mappings,
  ingest.jobs, ingest.job_attempt_keys, ingest.run_cursors, ingest.enumeration_seals,
  ingest.capture_references, ingest.discoveries to ushso_harvest;
grant select on ingest.checkpoints, ingest.harvest_run_scope_sets,
  ingest.harvest_run_scopes, ingest.normalization_manifests,
  ingest.normalization_manifest_items, ingest.normalization_job_requirements,
  ingest.normalization_success_artifacts
  to ushso_harvest;
grant select, insert on ingest.run_state_events, ingest.job_attempts,
  ingest.workflow_reconciliation_events to ushso_harvest;

grant select on ingest.capture_references, ingest.discoveries, ingest.harvest_runs,
  ingest.normalization_manifests, ingest.normalization_manifest_items,
  ingest.normalization_job_requirements, ingest.normalization_success_artifacts to ushso_normalize;
grant select, insert, update on ingest.jobs, ingest.job_attempt_keys to ushso_normalize;
grant select, insert on ingest.job_attempts, ingest.normalization_success_artifacts to ushso_normalize;

grant usage on schema ingest to ushso_projector;
grant select on ingest.harvest_runs, ingest.jobs, ingest.job_attempt_keys,
  ingest.job_attempts to ushso_projector;
grant update on ingest.jobs to ushso_projector;
grant insert on ingest.job_attempt_keys, ingest.job_attempts to ushso_projector;

grant select on all tables in schema ingest to ushso_ops;
grant insert, update on ingest.harvest_runs, ingest.workflow_attempt_mappings,
  ingest.jobs to ushso_ops;

grant execute on function ingest.seal_run_normalization_manifest(text,text,text,timestamptz),
  ingest.commit_all_scope_checkpoints_and_normalization_outbox(text,jsonb,text,timestamptz),
  ingest.assert_all_scope_checkpoints_committed(text)
  to ushso_harvest, ushso_ops;

grant usage, select on all sequences in schema ingest to ushso_scheduler, ushso_harvest,
  ushso_normalize, ushso_ops;

reset role;
