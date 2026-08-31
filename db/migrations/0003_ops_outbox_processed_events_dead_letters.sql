-- 0003: transactional outbox, global idempotency guards, durable DLQ,
-- correctness-ledger lifecycle metadata, and operations audit state.

set local timezone = 'UTC';
set local role ushso_ops_owner;

insert into ops.state_transitions (machine, from_state, to_state, transition_class) values
  ('outbox', 'pending', 'leased', 'normal'),
  ('outbox', 'leased', 'published', 'terminal'),
  ('outbox', 'leased', 'retry_wait', 'normal'),
  ('outbox', 'leased', 'dead', 'terminal'),
  ('outbox', 'retry_wait', 'pending', 'recovery'),
  ('outbox', 'leased', 'pending', 'recovery');

create function ops.safe_reference_payload(payload jsonb)
returns boolean
language sql
immutable
strict
as $function$
  select jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 16384
    and payload::text !~* 'authorization|cookie|set-cookie|password|secret_value|response_body|question_text|signed_url|presigned';
$function$;

create function ops.safe_failure_payload(payload jsonb)
returns boolean
language sql
immutable
strict
as $function$
  select jsonb_typeof(payload) = 'object'
    and payload ?& array['failure_type','retry_class','target_class','safe_detail_code','observed_at']
    and not exists (
      select 1 from jsonb_object_keys(payload) key
      where key not in ('failure_type','retry_class','target_class','safe_detail_code','http_status','observed_at')
    )
    and payload->>'failure_type' in (
      'rate_limited','upstream_5xx','timeout','dns_failure','tls_failure','catalog_auth_misconfigured',
      'expected_access_restriction','not_found','gone','redirect_unapproved','schema_drift','parse_failure',
      'unexpected_content_type','response_too_large','policy_blocked','canonical_invariant_failure',
      'internal_failure','cursor_expired'
    )
    and payload->>'retry_class' in ('transient','terminal_observation','quarantine','pause_source','enumeration_terminal')
    and payload->>'target_class' in ('catalog_root','collection','pagination_cursor','exact_item','exact_distribution','documentation')
    and payload->>'safe_detail_code' ~ '^[A-Z][A-Z0-9_]{2,63}$'
    and payload->>'observed_at' is not null;
$function$;

create function ops.safe_ingestion_references(payload jsonb)
returns boolean
language sql
immutable
strict
as $function$
  select jsonb_typeof(payload) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(payload) key
      where key not in ('run_id','job_id','capture_ref_id','checkpoint_id','canonical_id','canonical_revision_id','r2_key','cursor_ref_id')
    )
    and payload ?& array['run_id','job_id','capture_ref_id','checkpoint_id','canonical_id','canonical_revision_id','r2_key','cursor_ref_id']
    and payload::text !~* 'authorization|cookie|password|secret|response_body|question_text|signed_url|presigned|healthcare|financial|market_share';
$function$;

create function ops.text_array_is_unique(values_to_check text[])
returns boolean
language sql
immutable
strict
as $function$
  select cardinality(values_to_check) = (select count(distinct value) from unnest(values_to_check) value);
$function$;

create table ops.outbox (
  event_id text primary key check (event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  event_type text not null check (event_type in ('workflow_start_requested', 'harvest_page_requested', 'normalize_requested', 'schema_enrichment_requested', 'access_check_requested', 'projection_requested', 'delayed_redelivery_requested')),
  producer text not null check (producer in ('scheduler', 'workflow', 'harvest', 'normalize', 'projector', 'ops')),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 700),
  state text not null check (state in ('pending', 'leased', 'published', 'retry_wait', 'dead')),
  references_payload jsonb not null check (ops.safe_reference_payload(references_payload)),
  trace_id text not null check (trace_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  maximum_delivery_attempts integer not null check (maximum_delivery_attempts between 1 and 20),
  lease_owner text,
  lease_epoch bigint not null default 0 check (lease_epoch >= 0),
  lease_expires_at timestamptz,
  first_attempt_at timestamptz,
  next_eligible_at timestamptz,
  transport_retention_expires_at timestamptz,
  send_outcome text not null default 'not_started'
    check (send_outcome in ('not_started','send_started','published_confirmed','published_outcome_unknown','pre_send_failed')),
  safe_detail_code text check (safe_detail_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  published_at timestamptz,
  workflow_instance_id text,
  workflow_attempt integer check (workflow_attempt is null or workflow_attempt > 0),
  workflow_version text check (workflow_version is null or workflow_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  workflow_retention_expires_at timestamptz,
  run_deadline_at timestamptz,
  check ((state = 'leased') = (lease_owner is not null and lease_expires_at is not null)),
  check (attempt_count <= maximum_delivery_attempts),
  check ((state = 'published') = (published_at is not null)),
  check (send_outcome <> 'published_outcome_unknown' or (state = 'published' and transport_retention_expires_at is not null)),
  check (
    (event_type = 'workflow_start_requested') =
    (workflow_instance_id is not null and workflow_attempt is not null and workflow_version is not null
      and workflow_retention_expires_at is not null and run_deadline_at is not null)
  ),
  check (workflow_instance_id is null or (
    length(workflow_instance_id) <= 100
    and workflow_instance_id ~ '^[A-Za-z0-9_][A-Za-z0-9_-]*$'
    and workflow_instance_id ~ '^harvest-[A-Za-z0-9_][A-Za-z0-9_-]*-[1-9][0-9]*$'
  )),
  check (workflow_retention_expires_at is null or workflow_retention_expires_at > created_at),
  check (run_deadline_at is null or run_deadline_at > created_at),
  check (updated_at >= created_at)
) with (fillfactor = 75, autovacuum_vacuum_scale_factor = 0.02,
        autovacuum_vacuum_threshold = 200, autovacuum_analyze_scale_factor = 0.01,
        autovacuum_analyze_threshold = 100);

create index outbox_lease_due_idx on ops.outbox
  ((coalesce(next_eligible_at, '-infinity'::timestamptz)), created_at, event_id)
  include (event_type, attempt_count, maximum_delivery_attempts)
  where state in ('pending', 'retry_wait');
create index outbox_expired_lease_idx on ops.outbox (lease_expires_at, event_id)
  where state = 'leased';
create index outbox_oldest_pending_idx on ops.outbox (created_at, event_id)
  where state in ('pending', 'retry_wait', 'leased');
create index outbox_transport_retention_idx on ops.outbox (transport_retention_expires_at, event_id)
  where transport_retention_expires_at is not null;

create table ops.outbox_attempt_events (
  outbox_attempt_event_id bigint generated always as identity,
  event_id text not null,
  state text not null,
  attempt integer not null check (attempt between 0 and 20),
  outcome text not null check (outcome in ('created', 'leased', 'published', 'retry_scheduled', 'lease_expired', 'dead')),
  error_class text,
  recorded_at timestamptz not null,
  trace_id text not null check (trace_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  primary key (outbox_attempt_event_id, recorded_at)
) partition by range (recorded_at);

create index outbox_attempt_events_event_idx on ops.outbox_attempt_events (event_id, recorded_at desc);

create table ops.processed_event_keys (
  consumer_name text not null check (consumer_name in ('workflow_start_dispatcher', 'harvest_page_consumer', 'normalize_record_consumer', 'enrich_schema_consumer', 'access_check_consumer', 'project_index_consumer', 'dlq_sink')),
  event_id text not null,
  effect_idempotency_key text not null,
  source_id text not null references registry.sources(source_id) on delete restrict,
  run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  job_id text not null references ingest.jobs(job_id) on delete restrict,
  event_type text not null check (event_type in ('harvest_page_requested','normalize_requested','schema_enrichment_requested','access_check_requested','projection_requested')),
  message_idempotency_key text not null,
  run_attempt integer not null check (run_attempt > 0),
  lease_epoch bigint not null check (lease_epoch >= 0),
  origin_id text not null,
  target_class text not null check (target_class in ('catalog_root','collection','pagination_cursor','exact_item','exact_distribution','documentation')),
  retry_policy_version text not null,
  business_effect_sha256 text not null check (business_effect_sha256 ~ '^[a-f0-9]{64}$'),
  transaction_committed_at timestamptz not null,
  retain_until timestamptz not null,
  primary key (consumer_name, event_id),
  unique (consumer_name, effect_idempotency_key),
  check (retain_until >= transaction_committed_at + interval '90 days')
) with (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.05,
        autovacuum_analyze_scale_factor = 0.02);

create index processed_event_keys_retention_idx on ops.processed_event_keys (retain_until, consumer_name, event_id);

create table ops.processed_event_history (
  consumer_name text not null,
  event_id text not null,
  effect_idempotency_key text not null,
  source_id text not null,
  run_id text not null,
  job_id text not null,
  event_type text not null,
  message_idempotency_key text not null,
  run_attempt integer not null check (run_attempt > 0),
  lease_epoch bigint not null check (lease_epoch >= 0),
  origin_id text not null,
  target_class text not null,
  retry_policy_version text not null,
  business_effect_sha256 text not null check (business_effect_sha256 ~ '^[a-f0-9]{64}$'),
  downstream_outbox_event_ids text[] not null,
  transaction_committed_at timestamptz not null,
  trace_id text not null check (trace_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  primary key (consumer_name, event_id, transaction_committed_at)
) partition by range (transaction_committed_at);

create index processed_event_history_event_idx
  on ops.processed_event_history (event_id, transaction_committed_at desc);

create function ops.validate_processed_event_lineage()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, ops, ingest
as $function$
declare
  event_row ops.outbox%rowtype;
  job_row ingest.jobs%rowtype;
  run_row ingest.harvest_runs%rowtype;
  expected_event_type text;
begin
  select * into event_row from ops.outbox where event_id = new.event_id;
  select * into job_row from ingest.jobs where job_id = new.job_id;
  select * into run_row from ingest.harvest_runs where run_id = new.run_id;
  expected_event_type := case job_row.job_type
    when 'harvest_page' then 'harvest_page_requested'
    when 'normalize_record' then 'normalize_requested'
    when 'enrich_schema' then 'schema_enrichment_requested'
    when 'access_check' then 'access_check_requested'
    when 'project_index' then 'projection_requested'
  end;
  if event_row.event_id is null or job_row.job_id is null or run_row.run_id is null
     or event_row.event_type <> new.event_type
     or expected_event_type <> new.event_type
     or event_row.idempotency_key <> new.message_idempotency_key
     or event_row.state <> 'published'
     or event_row.references_payload->>'run_id' is distinct from new.run_id
     or event_row.references_payload->>'job_id' is distinct from new.job_id
     or job_row.run_id <> new.run_id or job_row.source_id <> new.source_id
     or run_row.source_id <> new.source_id
     or run_row.active_attempt <> new.run_attempt
     or run_row.terminal_at is not null
     or job_row.active_run_attempt <> new.run_attempt
     or job_row.lease_epoch <> new.lease_epoch
     or job_row.state <> 'leased'
     or job_row.lease_owner is null
     or job_row.lease_expires_at is null
     or job_row.lease_expires_at <= new.transaction_committed_at
     or job_row.attempt_count < 1
     or job_row.origin_id <> new.origin_id
     or job_row.target_class <> new.target_class
     or job_row.retry_policy_version <> new.retry_policy_version
     or not exists (
       select 1 from ingest.job_attempts attempt
       where attempt.job_id = job_row.job_id
         and attempt.delivery_attempt = job_row.attempt_count
         and attempt.run_attempt = new.run_attempt
         and attempt.lease_epoch = new.lease_epoch
         and attempt.original_event_id = new.event_id
         and attempt.outcome = 'started'
     ) then
    raise exception using errcode = '23514', message = 'processed-event envelope lineage fence rejected';
  end if;
  if (session_user = 'ushso_harvest' and new.consumer_name <> 'harvest_page_consumer')
     or (session_user = 'ushso_normalize' and new.consumer_name not in ('normalize_record_consumer','enrich_schema_consumer','access_check_consumer'))
     or (session_user = 'ushso_projector' and new.consumer_name <> 'project_index_consumer') then
    raise exception using errcode = '42501', message = 'processed-event stage-role fence rejected';
  end if;
  return new;
end
$function$;

create trigger processed_event_keys_validate_lineage
before insert on ops.processed_event_keys
for each row execute function ops.validate_processed_event_lineage();
create trigger processed_event_history_validate_lineage
before insert on ops.processed_event_history
for each row execute function ops.validate_processed_event_lineage();
create trigger processed_event_keys_immutable
before update or delete on ops.processed_event_keys
for each statement execute function ops.reject_history_mutation();

create table ops.dlq_transport_exhaustion_observations (
  original_event_id text primary key references ops.outbox(event_id) on delete restrict,
  queue_name text not null check (queue_name in ('harvest-page-dlq','normalize-record-dlq','enrich-schema-dlq','access-check-dlq','project-index-dlq')),
  source_id text not null references registry.sources(source_id) on delete restrict,
  run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  job_id text not null references ingest.jobs(job_id) on delete restrict,
  transport_delivery_attempts integer not null check (transport_delivery_attempts = 6),
  observed_at timestamptz not null,
  evidence_reference_id text not null check (evidence_reference_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  audit_event_id text not null check (audit_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  admitted_by text not null,
  admitted_at timestamptz not null check (admitted_at >= observed_at),
  reconstructed_dead_letter_id text,
  reconstructed_at timestamptz,
  check ((reconstructed_dead_letter_id is null) = (reconstructed_at is null))
);

create index dlq_transport_exhaustion_pending_idx
  on ops.dlq_transport_exhaustion_observations (observed_at, original_event_id)
  where reconstructed_dead_letter_id is null;

create function ops.validate_dlq_transport_exhaustion_observation()
returns trigger language plpgsql as $function$
declare
  event_row ops.outbox%rowtype;
  job_row ingest.jobs%rowtype;
  expected_queue text;
begin
  select * into event_row from ops.outbox where event_id = new.original_event_id;
  select * into job_row from ingest.jobs where job_id = new.job_id;
  expected_queue := case job_row.job_type
    when 'harvest_page' then 'harvest-page-dlq'
    when 'normalize_record' then 'normalize-record-dlq'
    when 'enrich_schema' then 'enrich-schema-dlq'
    when 'access_check' then 'access-check-dlq'
    when 'project_index' then 'project-index-dlq'
  end;
  if event_row.event_id is null or job_row.job_id is null
     or expected_queue <> new.queue_name
     or event_row.references_payload->>'run_id' is distinct from new.run_id
     or event_row.references_payload->>'job_id' is distinct from new.job_id
     or job_row.run_id <> new.run_id or job_row.source_id <> new.source_id
     or event_row.state <> 'published' then
    raise exception using errcode = '23514', message = 'DLQ transport-exhaustion lineage fence rejected';
  end if;
  return new;
end
$function$;

create trigger dlq_transport_exhaustion_validate
before insert on ops.dlq_transport_exhaustion_observations
for each row execute function ops.validate_dlq_transport_exhaustion_observation();

create function ops.validate_dlq_transport_exhaustion_update()
returns trigger language plpgsql as $function$
begin
  if row(old.original_event_id, old.queue_name, old.source_id, old.run_id, old.job_id,
         old.transport_delivery_attempts, old.observed_at, old.evidence_reference_id,
         old.audit_event_id, old.admitted_by, old.admitted_at)
     is distinct from
     row(new.original_event_id, new.queue_name, new.source_id, new.run_id, new.job_id,
         new.transport_delivery_attempts, new.observed_at, new.evidence_reference_id,
         new.audit_event_id, new.admitted_by, new.admitted_at) then
    raise exception using errcode = '55000', message = 'DLQ transport-exhaustion evidence is immutable';
  end if;
  if old.reconstructed_dead_letter_id is not null
     or new.reconstructed_dead_letter_id is null or new.reconstructed_at is null then
    raise exception using errcode = '23514', message = 'invalid DLQ transport-exhaustion reconstruction transition';
  end if;
  if not exists (
    select 1 from ops.durable_dead_letters dead
    where dead.dead_letter_id = new.reconstructed_dead_letter_id
      and dead.original_event_id = new.original_event_id
      and dead.queue_name = new.queue_name
      and dead.source_id = new.source_id
      and dead.run_id = new.run_id
      and dead.job_id = new.job_id
  ) then
    raise exception using errcode = '23514', message = 'DLQ transport-exhaustion reconstruction lineage fence rejected';
  end if;
  return new;
end
$function$;

create trigger dlq_transport_exhaustion_validate_update
before update on ops.dlq_transport_exhaustion_observations
for each row execute function ops.validate_dlq_transport_exhaustion_update();
create trigger dlq_transport_exhaustion_no_delete
before delete on ops.dlq_transport_exhaustion_observations
for each statement execute function ops.reject_history_mutation();

create table ops.durable_dead_letters (
  contract_version text not null check (contract_version = 'ingestion.v1.0.0'),
  record_kind text not null check (record_kind = 'durable_dead_letter'),
  dead_letter_id text primary key check (dead_letter_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  queue_name text not null check (queue_name in ('harvest-page-dlq', 'normalize-record-dlq', 'enrich-schema-dlq', 'access-check-dlq', 'project-index-dlq')),
  original_event_id text not null,
  source_id text not null references registry.sources(source_id) on delete restrict,
  run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  job_id text not null references ingest.jobs(job_id) on delete restrict,
  failure_payload jsonb not null check (ops.safe_failure_payload(failure_payload)),
  transport_delivery_attempts integer not null check (transport_delivery_attempts between 1 and 20),
  database_attempts integer not null check (database_attempts between 1 and 20),
  retry_policy_version text not null,
  message_references jsonb not null check (ops.safe_reference_payload(message_references) and ops.safe_ingestion_references(message_references)),
  attempt_ids text[] not null check (cardinality(attempt_ids) > 0 and ops.text_array_is_unique(attempt_ids)),
  replay_state text not null check (replay_state in ('not_requested', 'requested', 'replayed', 'closed_without_replay')),
  persisted_at timestamptz not null,
  sink_transaction_committed boolean not null check (sink_transaction_committed),
  retain_until timestamptz not null,
  unique (queue_name, original_event_id),
  check (retain_until >= persisted_at + interval '90 days')
);

create index durable_dead_letters_open_idx on ops.durable_dead_letters (persisted_at, dead_letter_id)
  where replay_state in ('not_requested', 'requested');
create index durable_dead_letters_source_idx on ops.durable_dead_letters (source_id, persisted_at desc);
create index durable_dead_letters_run_idx on ops.durable_dead_letters (run_id, persisted_at desc);
create index durable_dead_letters_job_idx on ops.durable_dead_letters (job_id);

alter table ops.dlq_transport_exhaustion_observations
  add constraint dlq_transport_exhaustion_reconstructed_fk
  foreign key (reconstructed_dead_letter_id)
  references ops.durable_dead_letters(dead_letter_id) on delete restrict;

create function ops.validate_durable_dead_letter_lineage()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, ops, ingest
as $function$
declare
  event_row ops.outbox%rowtype;
  job_row ingest.jobs%rowtype;
  expected_queue text;
  owned_attempt_count integer;
  minimum_delivery_attempt integer;
  maximum_delivery_attempt integer;
  expected_job_state text;
begin
  select * into event_row from ops.outbox where event_id = new.original_event_id;
  select * into job_row from ingest.jobs where job_id = new.job_id;
  expected_queue := case job_row.job_type
    when 'harvest_page' then 'harvest-page-dlq'
    when 'normalize_record' then 'normalize-record-dlq'
    when 'enrich_schema' then 'enrich-schema-dlq'
    when 'access_check' then 'access-check-dlq'
    when 'project_index' then 'project-index-dlq'
  end;
  expected_job_state := case job_row.job_type
    when 'normalize_record' then 'quarantined'
    when 'enrich_schema' then 'quarantined'
    when 'access_check' then 'succeeded'
    when 'harvest_page' then 'dead'
    when 'project_index' then 'dead'
  end;
  select count(distinct attempt.attempt_id), min(attempt.delivery_attempt), max(attempt.delivery_attempt)
  into owned_attempt_count, minimum_delivery_attempt, maximum_delivery_attempt
  from unnest(new.attempt_ids) requested_attempt_id
  join ingest.job_attempt_keys attempt_key
    on attempt_key.attempt_id = requested_attempt_id
   and attempt_key.job_id = new.job_id
  join ingest.job_attempts attempt
    on attempt.attempt_id = attempt_key.attempt_id
   and attempt.job_id = attempt_key.job_id
  where attempt.run_id = new.run_id and attempt.source_id = new.source_id;
  if event_row.event_id is null or job_row.job_id is null
     or expected_queue is distinct from new.queue_name
     or event_row.references_payload->>'run_id' is distinct from new.run_id
     or event_row.references_payload->>'job_id' is distinct from new.job_id
     or job_row.run_id <> new.run_id or job_row.source_id <> new.source_id
     or job_row.state is distinct from expected_job_state
     or job_row.retry_policy_version <> new.retry_policy_version
     or job_row.attempt_count <> new.database_attempts
     or new.transport_delivery_attempts < new.database_attempts
     or new.message_references->>'run_id' is distinct from new.run_id
     or new.message_references->>'job_id' is distinct from new.job_id
     or owned_attempt_count <> cardinality(new.attempt_ids)
     or cardinality(new.attempt_ids) <> new.database_attempts
     or minimum_delivery_attempt is distinct from 1
     or maximum_delivery_attempt is distinct from new.database_attempts
     or not exists (
       select 1
       from ingest.job_attempts terminal_attempt
       where terminal_attempt.attempt_id = any(new.attempt_ids)
         and terminal_attempt.job_id = new.job_id
         and terminal_attempt.run_id = new.run_id
         and terminal_attempt.source_id = new.source_id
         and terminal_attempt.original_event_id = new.original_event_id
         and terminal_attempt.delivery_attempt = new.database_attempts
         and terminal_attempt.failure_payload = new.failure_payload
         and terminal_attempt.outcome = 'dead_lettered'
         and terminal_attempt.database_transaction_committed
     ) then
    raise exception using errcode = '23514', message = 'durable dead-letter authoritative lineage fence rejected';
  end if;
  return new;
end
$function$;

create trigger durable_dead_letters_validate_lineage
before insert on ops.durable_dead_letters
for each row execute function ops.validate_durable_dead_letter_lineage();

create table ops.dead_letter_events (
  dead_letter_event_id bigint generated always as identity,
  dead_letter_id text not null,
  queue_name text not null,
  action text not null check (action in ('persisted', 'replay_requested', 'replayed', 'closed_without_replay')),
  audit_event_id text,
  recorded_at timestamptz not null,
  trace_id text not null check (trace_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  primary key (dead_letter_event_id, recorded_at)
) partition by range (recorded_at);

create index dead_letter_events_letter_idx on ops.dead_letter_events (dead_letter_id, recorded_at desc);

create table ops.replay_lineage (
  contract_version text not null check (contract_version = 'ingestion.v1.0.0'),
  record_kind text not null check (record_kind = 'replay_lineage'),
  replay_id text primary key check (replay_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  original_dead_letter_id text not null references ops.durable_dead_letters(dead_letter_id) on delete restrict,
  original_event_id text not null,
  original_run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  new_run_id text not null unique references ingest.harvest_runs(run_id) on delete restrict,
  new_event_id text not null unique,
  original_retry_policy_version text not null,
  replay_policy_version text not null,
  requested_by_audit_event_id text not null,
  requested_at timestamptz not null
);

create index replay_lineage_original_run_idx on ops.replay_lineage (original_run_id);

create function ops.validate_durable_dead_letter_update()
returns trigger language plpgsql as $function$
begin
  if row(
    old.contract_version, old.record_kind, old.dead_letter_id, old.queue_name, old.original_event_id,
    old.source_id, old.run_id, old.job_id, old.failure_payload, old.transport_delivery_attempts,
    old.database_attempts, old.retry_policy_version, old.message_references, old.attempt_ids,
    old.persisted_at, old.sink_transaction_committed, old.retain_until
  ) is distinct from row(
    new.contract_version, new.record_kind, new.dead_letter_id, new.queue_name, new.original_event_id,
    new.source_id, new.run_id, new.job_id, new.failure_payload, new.transport_delivery_attempts,
    new.database_attempts, new.retry_policy_version, new.message_references, new.attempt_ids,
    new.persisted_at, new.sink_transaction_committed, new.retain_until
  ) then
    raise exception using errcode = '55000', message = 'durable dead-letter evidence is immutable';
  end if;
  if not (
    old.replay_state = new.replay_state
    or (old.replay_state = 'not_requested' and new.replay_state in ('requested','closed_without_replay'))
    or (old.replay_state = 'requested' and new.replay_state in ('replayed','closed_without_replay'))
  ) then
    raise exception using errcode = '23514', message = 'invalid durable dead-letter replay transition';
  end if;
  return new;
end
$function$;

create trigger durable_dead_letters_validate_update
before update on ops.durable_dead_letters for each row execute function ops.validate_durable_dead_letter_update();

create trigger replay_lineage_reject_mutation
before update or delete on ops.replay_lineage for each statement execute function ops.reject_history_mutation();

create table ops.audit_events (
  audit_event_id text not null check (audit_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  action text not null check (action in (
    'pause', 'resume', 'replay', 'review', 'promote', 'rollback',
    'retention_override', 'archive', 'restore', 'gc_watermark',
    'delete_partition', 'migration', 'environment_fence',
    'origin_circuit_closed', 'source_pause_requested', 'source_resumed',
    'correctness_ledger_gc', 'dead_letter_reconstructed_after_transport_loss',
    'schedule_dispatch_failed', 'workflow_control_failed',
    'workflow_retention_expired', 'workflow_platform_terminal',
    'outbox_send_outcome_unknown', 'outbox_delivery_budget_exhausted',
    'dlq_transport_exhaustion_observed', 'dead_letter_replay_requested',
    'source_pause_effective', 'source_drain_progress',
    'workflow_platform_terminal_reconciled',
    'workflow_start_deadline_rejected', 'workflow_start_budget_exhausted',
    'workflow_platform_terminal_on_create'
  )),
  actor_id text not null,
  actor_type text not null check (actor_type in ('cloudflare_access', 'maintenance_identity', 'system_reconciler')),
  object_type text not null,
  object_id text not null,
  decision text not null check (decision in ('requested', 'allowed', 'denied', 'completed', 'failed')),
  details jsonb not null check (ops.safe_reference_payload(details)),
  trace_id text not null check (trace_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  occurred_at timestamptz not null,
  primary key (audit_event_id, occurred_at)
) partition by range (occurred_at);

create index audit_events_object_idx on ops.audit_events (object_type, object_id, occurred_at desc);
create index audit_events_actor_idx on ops.audit_events (actor_id, occurred_at desc);
create index audit_events_action_idx on ops.audit_events (action, occurred_at desc);

create function ops.validate_replay_lineage_insert()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, ops, ingest
as $function$
declare
  dead_row ops.durable_dead_letters%rowtype;
  original_run ingest.harvest_runs%rowtype;
  replay_run ingest.harvest_runs%rowtype;
  replay_event ops.outbox%rowtype;
begin
  select * into dead_row from ops.durable_dead_letters where dead_letter_id = new.original_dead_letter_id;
  select * into original_run from ingest.harvest_runs where run_id = new.original_run_id;
  select * into replay_run from ingest.harvest_runs where run_id = new.new_run_id;
  select * into replay_event from ops.outbox where event_id = new.new_event_id;
  if dead_row.dead_letter_id is null or original_run.run_id is null
     or replay_run.run_id is null or replay_event.event_id is null
     or dead_row.original_event_id <> new.original_event_id
     or dead_row.run_id <> new.original_run_id
     or dead_row.retry_policy_version <> new.original_retry_policy_version
     or dead_row.replay_state <> 'requested'
     or original_run.terminal_at is null
     or replay_run.mode <> 'operator_replay'
     or replay_run.replay_of_run_id is distinct from new.original_run_id
     or replay_run.source_id <> original_run.source_id
     or replay_run.endpoint_id <> original_run.endpoint_id
     or replay_run.source_configuration_revision <> original_run.source_configuration_revision
     or replay_run.workflow_version <> original_run.workflow_version
     or replay_run.optional_degradation_policy is distinct from original_run.optional_degradation_policy
     or replay_run.barrier_policy is distinct from original_run.barrier_policy
     or replay_run.terminal_at is not null
     or replay_run.scheduled_slot <> new.requested_at
     or replay_event.event_type <> 'workflow_start_requested'
     or replay_event.references_payload->>'run_id' is distinct from new.new_run_id
     or replay_event.workflow_attempt is distinct from replay_run.active_attempt
     or replay_event.workflow_version is distinct from replay_run.workflow_version
     or replay_event.run_deadline_at is distinct from replay_run.deadline_at
     or replay_event.created_at <> new.requested_at
     or not exists (
       select 1 from ops.audit_events audit
       where audit.audit_event_id = new.requested_by_audit_event_id
         and audit.action = 'replay'
         and audit.object_type = 'durable_dead_letter'
         and audit.object_id = new.original_dead_letter_id
         and audit.decision in ('requested', 'allowed')
         and audit.occurred_at <= new.requested_at
     ) then
    raise exception using errcode = '23514', message = 'replay authoritative lineage fence rejected';
  end if;
  return new;
end
$function$;

create trigger replay_lineage_validate_insert
before insert on ops.replay_lineage
for each row execute function ops.validate_replay_lineage_insert();

create table ops.service_heartbeats (
  service_name text primary key check (service_name in ('scheduler', 'workflow_dispatcher', 'harvest', 'normalize', 'projector', 'ops', 'dlq_sink')),
  worker_version text not null,
  outcome text not null check (outcome in ('healthy', 'degraded', 'failed', 'paused')),
  last_heartbeat_at timestamptz not null,
  details jsonb not null check (ops.safe_reference_payload(details)),
  updated_at timestamptz not null
) with (fillfactor = 80);

create table ops.origin_controls (
  origin_id text primary key check (origin_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  capacity double precision not null check (capacity > 0 and capacity <= 10000),
  available_tokens double precision not null check (available_tokens >= 0 and available_tokens <= capacity),
  refill_per_second double precision not null check (refill_per_second > 0 and refill_per_second <= 10000),
  last_refill_at timestamptz not null,
  circuit_state text not null check (circuit_state in ('closed','open','half_open')),
  consecutive_failures integer not null check (consecutive_failures >= 0),
  next_probe_at timestamptz,
  probe_in_flight boolean not null default false,
  last_success_at timestamptz,
  updated_at timestamptz not null,
  check (circuit_state <> 'closed' or (next_probe_at is null and not probe_in_flight)),
  check (not probe_in_flight or circuit_state = 'half_open')
) with (fillfactor = 80);

create table ops.business_effect_receipts (
  consumer_name text not null,
  event_id text not null,
  effect_idempotency_key text not null,
  effect_kind text not null check (effect_kind in ('harvest_metadata','normalization_import','schema_enrichment','access_observation','projection_acknowledgement')),
  effect_sha256 text not null check (effect_sha256 ~ '^[a-f0-9]{64}$'),
  effect_references jsonb not null check (ops.safe_reference_payload(effect_references)),
  recorded_at timestamptz not null,
  primary key (consumer_name, event_id),
  unique (consumer_name, effect_idempotency_key)
);

create trigger business_effect_receipts_append_only
before update or delete on ops.business_effect_receipts
for each statement execute function ops.reject_history_mutation();

create table ops.run_publication_barriers (
  run_id text not null references ingest.harvest_runs(run_id) on delete restrict,
  attempt integer not null check (attempt > 0),
  barrier_payload jsonb not null check (
    ops.safe_reference_payload(barrier_payload)
    and barrier_payload ?& array[
      'contract_version','record_kind','run_id','last_known_good_publication_id',
      'run_outcome','enumerations_complete_and_sealed','membership_checkpoint_committed',
      'normalization_terminal_count','observed_revision_count','w1_revision_manifest_sealed',
      'eligible_projection_count','projection_acknowledgement_count','required_dead_letter_count',
      'references_resolved','checksums_verified','visibility_verified','coverage_reconciled',
      'optional_degradations','candidate_publication_id','active_publication_id','evaluated_at'
    ]
    and barrier_payload->>'contract_version' = 'ingestion.v1.0.0'
    and barrier_payload->>'record_kind' = 'publication_barrier'
  ),
  recorded_at timestamptz not null,
  primary key (run_id, attempt),
  check (barrier_payload->>'run_id' = run_id)
);

create trigger run_publication_barriers_append_only
before update or delete on ops.run_publication_barriers
for each statement execute function ops.reject_history_mutation();

create table ops.recovery_controls (
  control_name text primary key check (control_name in ('global_scheduler', 'source_pause', 'queue_pause', 'connector_version_denylist', 'index_publication_freeze', 'replay_mode', 'publication_pointer_rollback', 'static_public_fallback')),
  state text not null check (state in ('enabled', 'disabled', 'requested', 'active')),
  policy_version text not null,
  requested_by_audit_event_id text not null,
  updated_at timestamptz not null
);

create table ops.retention_policies (
  policy_id text primary key,
  policy_version text not null,
  minimum_online_days integer not null check (minimum_online_days >= 90),
  workflow_retention_days integer not null check (workflow_retention_days > 0),
  reconciliation_grace_days integer not null check (reconciliation_grace_days > 0),
  queue_redelivery_days integer not null check (queue_redelivery_days > 0),
  dlq_replay_days integer not null check (dlq_replay_days > 0),
  operator_replay_days integer not null check (operator_replay_days > 0),
  rollback_days integer not null check (rollback_days > 0),
  audit_days integer not null check (audit_days >= 365),
  active boolean not null,
  created_at timestamptz not null,
  unique (policy_id, policy_version)
);

insert into ops.retention_policies
  (policy_id, policy_version, minimum_online_days, workflow_retention_days,
   reconciliation_grace_days, queue_redelivery_days, dlq_replay_days,
   operator_replay_days, rollback_days, audit_days, active, created_at)
values
  ('correctness-default', '1.0.0', 90, 30, 2, 14, 30, 90, 90, 365, true, clock_timestamp());

create table ops.correctness_ledger_registry (
  ledger_name text primary key,
  head_relation text,
  history_relation text,
  partition_key text,
  source_lookup_key text,
  retention_policy_id text not null references ops.retention_policies(policy_id) on delete restrict,
  archive_required boolean not null,
  implementation_state text not null check (implementation_state in ('active', 'planned_future_migration')),
  minimum_online_days integer not null check (minimum_online_days >= 90),
  unique nulls not distinct (head_relation, history_relation)
);

insert into ops.correctness_ledger_registry
  (ledger_name, head_relation, history_relation, partition_key, source_lookup_key,
   retention_policy_id, archive_required, implementation_state, minimum_online_days)
values
  ('run_job_attempt', 'ingest.harvest_runs,ingest.jobs', 'ingest.run_state_events,ingest.job_attempts', 'recorded_at', 'source_id', 'correctness-default', true, 'active', 90),
  ('outbox', 'ops.outbox', 'ops.outbox_attempt_events', 'recorded_at', null, 'correctness-default', true, 'active', 90),
  ('processed_event', 'ops.processed_event_keys', 'ops.processed_event_history', 'transaction_committed_at', null, 'correctness-default', true, 'active', 90),
  ('workflow_mapping', 'ingest.workflow_attempt_mappings', 'ingest.workflow_reconciliation_events', 'recorded_at', null, 'correctness-default', true, 'active', 90),
  ('durable_dlq', 'ops.durable_dead_letters', 'ops.dead_letter_events', 'recorded_at', 'source_id', 'correctness-default', true, 'active', 90),
  ('publication_history', null, 'search.publication_history', 'published_at', null, 'correctness-default', true, 'planned_future_migration', 90),
  ('audit', null, 'ops.audit_events', 'occurred_at', null, 'correctness-default', true, 'active', 365);

create table ops.partition_registry (
  partition_relation text primary key,
  ledger_name text not null references ops.correctness_ledger_registry(ledger_name) on delete restrict,
  lower_bound timestamptz not null,
  upper_bound timestamptz not null,
  state text not null check (state in ('online', 'archive_requested', 'archived_verified', 'detached', 'deleted')),
  created_at timestamptz not null,
  retention_deadline timestamptz not null,
  replay_horizon_expires_at timestamptz,
  workflow_retention_grace_expires_at timestamptz,
  rollback_window_expires_at timestamptz,
  check (upper_bound > lower_bound),
  check (retention_deadline >= upper_bound + interval '90 days'),
  check (replay_horizon_expires_at is null or replay_horizon_expires_at >= upper_bound),
  check (workflow_retention_grace_expires_at is null or workflow_retention_grace_expires_at >= upper_bound),
  check (rollback_window_expires_at is null or rollback_window_expires_at >= upper_bound)
);

create table ops.archive_manifests (
  archive_manifest_id text primary key,
  partition_relation text not null references ops.partition_registry(partition_relation) on delete restrict,
  lower_bound timestamptz not null,
  upper_bound timestamptz not null,
  row_count bigint not null check (row_count >= 0),
  logical_sha256 text not null check (logical_sha256 ~ '^[a-f0-9]{64}$'),
  archive_object_sha256 text not null check (archive_object_sha256 ~ '^[a-f0-9]{64}$'),
  archive_locator text not null check (archive_locator ~ '^ledger-archives/sha256/[a-f0-9]{2}/[a-f0-9]{64}$'),
  policy_version text not null,
  operator_id text not null,
  archive_state text not null check (archive_state in ('written', 'checksum_verified', 'restore_verified', 'failed')),
  archive_access_controlled boolean not null default false,
  archive_access_evidence_reference_id text,
  backup_pitr_compatible boolean not null default false,
  backup_pitr_evidence_reference_id text,
  legal_policy_approved boolean not null default false,
  legal_policy_evidence_reference_id text,
  archived_at timestamptz not null,
  restore_tested_at timestamptz,
  check (upper_bound > lower_bound),
  check (archive_state <> 'restore_verified' or restore_tested_at is not null),
  check (not archive_access_controlled or archive_access_evidence_reference_id is not null),
  check (not backup_pitr_compatible or backup_pitr_evidence_reference_id is not null),
  check (not legal_policy_approved or legal_policy_evidence_reference_id is not null)
);

create index archive_manifests_partition_idx on ops.archive_manifests (partition_relation, archived_at desc);

create table ops.gc_dependency_proofs (
  dependency_proof_id text primary key,
  proof_digest text unique check (proof_digest is null or proof_digest ~ '^[a-f0-9]{64}$'),
  partition_relation text not null references ops.partition_registry(partition_relation) on delete restrict,
  no_active_work boolean not null,
  no_unexpired_idempotency boolean not null,
  no_workflow_or_replay_dependency boolean not null,
  no_publication_or_rollback_dependency boolean not null,
  no_evidence_or_review_dependency boolean not null,
  archive_checksum_verified boolean not null,
  archive_restore_verified boolean not null,
  backup_pitr_compatible boolean not null,
  legal_policy_approved boolean not null,
  evidence_payload jsonb not null check (ops.safe_reference_payload(evidence_payload)),
  checked_by text not null,
  checked_at timestamptz not null,
  check (no_active_work and no_unexpired_idempotency and no_workflow_or_replay_dependency
    and no_publication_or_rollback_dependency and no_evidence_or_review_dependency
    and archive_checksum_verified and archive_restore_verified and backup_pitr_compatible
    and legal_policy_approved)
);

create table ops.gc_watermarks (
  gc_watermark_id text primary key,
  partition_relation text not null unique references ops.partition_registry(partition_relation) on delete restrict,
  lower_bound timestamptz not null,
  upper_bound timestamptz not null,
  row_count bigint not null check (row_count >= 0),
  logical_sha256 text not null check (logical_sha256 ~ '^[a-f0-9]{64}$'),
  policy_version text not null,
  archive_manifest_id text not null references ops.archive_manifests(archive_manifest_id) on delete restrict,
  dependency_proof_id text not null references ops.gc_dependency_proofs(dependency_proof_id) on delete restrict,
  operator_id text not null,
  audit_event_id text not null,
  approved_at timestamptz not null,
  executed_at timestamptz,
  check (upper_bound > lower_bound)
);

create trigger state_transitions_no_delete
before delete on ops.state_transitions for each statement execute function ops.reject_history_mutation();
create trigger correctness_ledger_registry_append_only
before update or delete on ops.correctness_ledger_registry for each statement execute function ops.reject_history_mutation();
create trigger retention_policies_append_only
before update or delete on ops.retention_policies for each statement execute function ops.reject_history_mutation();
create trigger gc_dependency_proofs_append_only
before update or delete on ops.gc_dependency_proofs for each statement execute function ops.reject_history_mutation();
create trigger gc_watermarks_no_delete
before delete on ops.gc_watermarks for each statement execute function ops.reject_history_mutation();

-- Current month, prior month, and three future months for every ops history.
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
    foreach table_name in array array['outbox_attempt_events', 'dead_letter_events', 'audit_events'] loop
      execute format(
        'create table if not exists ops.%I partition of ops.%I for values from (%L) to (%L)',
        table_name || '_' || suffix, table_name, month_start, month_end
      );
      execute format(
        'alter table ops.%I set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 100)',
        table_name || '_' || suffix
      );
    end loop;
    execute format(
      'create table if not exists ops.%I partition of ops.processed_event_history for values from (%L) to (%L)',
      'processed_event_history_' || suffix, month_start, month_end
    );
  end loop;
end
$partitions$;

-- Register the complete bootstrap horizon, including the ingest partitions
-- created by 0002.  This makes every online correctness-ledger partition
-- visible to retention/archive tooling from the moment 0003 commits.
do $register_partitions$
declare
  month_start date;
  month_end date;
  suffix text;
  parent_name text;
  ledger_name text;
  relation_name text;
begin
  for month_start in
    select (date_trunc('month', current_date) + (n || ' month')::interval)::date
    from generate_series(-1, 3) as n
  loop
    month_end := (month_start + interval '1 month')::date;
    suffix := to_char(month_start, 'YYYY_MM');
    for parent_name, ledger_name in
      select * from (values
        ('ingest.run_state_events', 'run_job_attempt'),
        ('ingest.job_attempts', 'run_job_attempt'),
        ('ingest.workflow_reconciliation_events', 'workflow_mapping'),
        ('ops.outbox_attempt_events', 'outbox'),
        ('ops.processed_event_history', 'processed_event'),
        ('ops.dead_letter_events', 'durable_dlq'),
        ('ops.audit_events', 'audit')
      ) as parents(parent_name, ledger_name)
    loop
      relation_name := parent_name || '_' || suffix;
      if to_regclass(relation_name) is null then
        raise exception 'bootstrap partition is missing: %', relation_name;
      end if;
      insert into ops.partition_registry
        (partition_relation, ledger_name, lower_bound, upper_bound, state,
         created_at, retention_deadline)
      values
        (relation_name, ledger_name, month_start::timestamptz,
         month_end::timestamptz, 'online', clock_timestamp(),
         month_end::timestamptz + interval '90 days');
    end loop;
  end loop;
end
$register_partitions$;

create function ops.validate_outbox_transition()
returns trigger language plpgsql as $function$
begin
  if old.state in ('published', 'dead') then
    raise exception using errcode = '55000', message = 'terminal outbox event is immutable';
  end if;
  perform ops.assert_transition('outbox', old.state, new.state);
  new.updated_at := clock_timestamp();
  if new.state = 'published' then
    new.published_at := coalesce(new.published_at, clock_timestamp());
  end if;
  return new;
end
$function$;

create function ops.record_outbox_event()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, ops
as $function$
begin
  if tg_op = 'INSERT' or old.state <> new.state then
    insert into ops.outbox_attempt_events
      (event_id, state, attempt, outcome, recorded_at, trace_id)
    values
      (new.event_id, new.state, new.attempt_count,
       case when tg_op = 'INSERT' then 'created'
            when new.state = 'leased' then 'leased'
            when new.state = 'published' then 'published'
            when new.state = 'retry_wait' then 'retry_scheduled'
            when new.state = 'dead' then 'dead'
            else 'lease_expired' end,
       clock_timestamp(), new.trace_id);
  end if;
  return new;
end
$function$;

create trigger outbox_validate_transition
before update on ops.outbox for each row execute function ops.validate_outbox_transition();
create trigger outbox_record_event
after insert or update on ops.outbox for each row execute function ops.record_outbox_event();

reset role;
set local role ushso_registry_owner;

alter table registry.source_schedules
  add column optional_degradation_policy jsonb not null default '[]'::jsonb
    check (jsonb_typeof(optional_degradation_policy) = 'array'),
  add column lease_owner text,
  add column lease_epoch bigint not null default 0 check (lease_epoch >= 0),
  add column lease_expires_at timestamptz,
  add constraint source_schedules_lease_shape_check
    check ((lease_owner is null) = (lease_expires_at is null));

create function registry.lease_due_source_schedules(
  p_scheduled_slot timestamptz,
  p_lease_acquired_at timestamptz,
  p_lease_owner text,
  p_lease_expires_at timestamptz,
  p_limit integer
)
returns table (
  schedule_id text, source_id text, endpoint_id text, scope_id text,
  cadence_seconds integer, next_due_at timestamptz, mode text,
  configuration_revision integer, optional_degradation_policy jsonb,
  lease_owner text, lease_epoch bigint, lease_expires_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, registry
as $function$
  with schedule_groups as (
    select schedule.source_id, scope.endpoint_id, schedule.mode,
           schedule.configuration_revision, schedule.optional_degradation_policy,
           min(schedule.next_due_at) as first_due_at,
           array_agg(schedule.schedule_id order by schedule.schedule_id) as schedule_ids,
           bool_and(schedule.next_due_at <= p_scheduled_slot) as all_due,
           bool_and(schedule.lease_owner is null or schedule.lease_expires_at <= p_lease_acquired_at) as all_available
    from registry.source_schedules schedule
    join registry.sources source on source.source_id = schedule.source_id
    join registry.scopes scope on scope.scope_id = schedule.scope_id
    where schedule.state = 'active' and source.state = 'active' and scope.state = 'active'
    group by schedule.source_id, scope.endpoint_id, schedule.mode,
             schedule.configuration_revision, schedule.optional_degradation_policy
  ), candidate_groups as (
    select schedule_ids
    from schedule_groups
    where all_due and all_available and p_limit between 1 and 1000
    order by first_due_at, source_id, endpoint_id, mode,
             configuration_revision, optional_degradation_policy::text
    limit p_limit
  ), candidates as (
    select unnest(candidate_groups.schedule_ids) as schedule_id
    from candidate_groups
  ), leased as (
    update registry.source_schedules schedule
    set lease_owner = p_lease_owner, lease_epoch = schedule.lease_epoch + 1,
        lease_expires_at = p_lease_expires_at, updated_at = p_lease_acquired_at
    from candidates
    where schedule.schedule_id = candidates.schedule_id
      and schedule.state = 'active'
      and schedule.next_due_at <= p_scheduled_slot
      and (schedule.lease_owner is null or schedule.lease_expires_at <= p_lease_acquired_at)
    returning schedule.*
  )
  select leased.schedule_id, leased.source_id, scope.endpoint_id,
         leased.scope_id, leased.cadence_seconds, leased.next_due_at,
         leased.mode, leased.configuration_revision,
         leased.optional_degradation_policy, leased.lease_owner,
         leased.lease_epoch, leased.lease_expires_at
  from leased join registry.scopes scope on scope.scope_id = leased.scope_id
  order by leased.next_due_at, leased.schedule_id;
$function$;

create function registry.release_source_schedule_leases(
  p_schedule_leases jsonb,
  p_lease_owner text,
  p_released_at timestamptz,
  p_quarantine boolean
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, registry
as $function$
declare
  released_count integer;
begin
  if jsonb_typeof(p_schedule_leases) <> 'array' or jsonb_array_length(p_schedule_leases) = 0 then
    raise exception using errcode = '22023', message = 'schedule lease set must be non-empty';
  end if;
  update registry.source_schedules schedule
  set lease_owner = null, lease_expires_at = null,
      state = case when p_quarantine then 'paused' else schedule.state end,
      updated_at = p_released_at
  from jsonb_to_recordset(p_schedule_leases) lease(schedule_id text, lease_epoch bigint)
  where schedule.schedule_id = lease.schedule_id
    and schedule.lease_owner = p_lease_owner
    and schedule.lease_epoch = lease.lease_epoch;
  get diagnostics released_count = row_count;
  if released_count <> jsonb_array_length(p_schedule_leases) then
    raise exception using errcode = '40001', message = 'schedule lease release fence rejected';
  end if;
  return released_count;
end
$function$;

create function registry.request_source_pause(
  p_source_id text,
  p_requested_at timestamptz
)
returns registry.sources
language plpgsql
security definer
set search_path = pg_catalog, registry
as $function$
declare
  source_row registry.sources%rowtype;
begin
  select * into source_row from registry.sources where source_id = p_source_id for update;
  if not found or source_row.state = 'retired' then
    raise exception using errcode = '23514', message = 'source is missing or not pausable';
  end if;
  if source_row.state in ('active','auth_blocked','schema_drift') then
    update registry.sources set state = 'pause_requested', updated_at = p_requested_at
    where source_id = p_source_id returning * into source_row;
  end if;
  return source_row;
end
$function$;

create function registry.set_source_drain_state(
  p_source_id text,
  p_target_state text,
  p_recorded_at timestamptz
)
returns registry.sources
language plpgsql
security definer
set search_path = pg_catalog, registry
as $function$
declare
  source_row registry.sources%rowtype;
begin
  if p_target_state not in ('draining','paused') then
    raise exception using errcode = '22023', message = 'invalid source drain target state';
  end if;
  select * into source_row from registry.sources where source_id = p_source_id for update;
  if not found then raise exception using errcode = '23503', message = 'source missing'; end if;
  if source_row.state = p_target_state or (p_target_state = 'draining' and source_row.state = 'paused') then
    return source_row;
  end if;
  if (p_target_state = 'draining' and source_row.state <> 'pause_requested')
     or (p_target_state = 'paused' and source_row.state <> 'draining') then
    raise exception using errcode = '23514', message = 'source drain transition fence rejected';
  end if;
  update registry.sources set state = p_target_state, updated_at = p_recorded_at
  where source_id = p_source_id returning * into source_row;
  return source_row;
end
$function$;

create function registry.resume_source(
  p_source_id text,
  p_configuration_revision integer,
  p_resumed_at timestamptz
)
returns registry.sources
language plpgsql
security definer
set search_path = pg_catalog, registry
as $function$
declare
  source_row registry.sources%rowtype;
begin
  select * into source_row from registry.sources where source_id = p_source_id for update;
  if not found or source_row.state not in ('paused','auth_blocked','schema_drift')
     or source_row.current_revision_number <> p_configuration_revision then
    raise exception using errcode = '23514', message = 'source resume state/configuration fence rejected';
  end if;
  update registry.sources set state = 'active', updated_at = p_resumed_at
  where source_id = p_source_id returning * into source_row;
  return source_row;
end
$function$;

create function registry.can_source_fetch(p_source_id text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, registry
as $function$
  select coalesce((select state = 'active' from registry.sources where source_id = p_source_id), false);
$function$;

grant select, update on registry.source_schedules to ushso_ingest_owner;
revoke all on function registry.lease_due_source_schedules(timestamptz,timestamptz,text,timestamptz,integer) from public;
revoke all on function registry.release_source_schedule_leases(jsonb,text,timestamptz,boolean) from public;
revoke all on function registry.request_source_pause(text,timestamptz),
  registry.set_source_drain_state(text,text,timestamptz),
  registry.resume_source(text,integer,timestamptz),
  registry.can_source_fetch(text) from public;
grant execute on function registry.lease_due_source_schedules(timestamptz,timestamptz,text,timestamptz,integer),
  registry.release_source_schedule_leases(jsonb,text,timestamptz,boolean) to ushso_scheduler;
grant execute on function registry.request_source_pause(text,timestamptz),
  registry.can_source_fetch(text) to ushso_harvest, ushso_normalize, ushso_projector, ushso_ops;
grant execute on function registry.set_source_drain_state(text,text,timestamptz),
  registry.resume_source(text,integer,timestamptz) to ushso_ops;

reset role;
set local role ushso_ops_owner;

create table ops.scheduler_source_failures (
  failure_id text primary key,
  source_id text not null references registry.sources(source_id) on delete restrict,
  schedule_ids text[] not null check (cardinality(schedule_ids) > 0 and ops.text_array_is_unique(schedule_ids)),
  scheduled_slot timestamptz not null,
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
  outcome text not null check (outcome in ('quarantined','released_for_retry')),
  trace_id text not null check (trace_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  recorded_at timestamptz not null
);

create trigger scheduler_source_failures_append_only
before update or delete on ops.scheduler_source_failures
for each statement execute function ops.reject_history_mutation();

grant select, insert on ops.scheduler_source_failures to ushso_scheduler;

reset role;
set local role ushso_ingest_owner;

create function ingest.ensure_scheduled_run_and_workflow_start(
  p_schedule_leases jsonb,
  p_lease_owner text,
  p_plan_id text,
  p_run_id text,
  p_run_idempotency_key text,
  p_scheduled_slot timestamptz,
  p_trace_id text,
  p_workflow_instance_id text,
  p_workflow_version text,
  p_workflow_retention_expires_at timestamptz,
  p_deadline_at timestamptz,
  p_optional_degradation_policy jsonb,
  p_barrier_policy jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ingest, registry, ops
as $function$
declare
  plan_row ingest.harvest_plans%rowtype;
  existing_run ingest.harvest_runs%rowtype;
  schedule_count integer;
  expected_scope_count integer;
  inserted_count integer;
  workflow_event_id text := 'event_workflow_' || p_run_id;
begin
  if jsonb_typeof(p_schedule_leases) <> 'array' or jsonb_array_length(p_schedule_leases) = 0 then
    raise exception using errcode = '22023', message = 'schedule lease set must be non-empty';
  end if;
  select * into plan_row from ingest.harvest_plans where plan_id = p_plan_id;
  if not found then raise exception using errcode = '23503', message = 'harvest plan missing'; end if;
  select * into existing_run from ingest.harvest_runs where run_idempotency_key = p_run_idempotency_key;
  if found then
    if row(existing_run.run_id, existing_run.plan_id, existing_run.scheduled_slot,
           existing_run.trace_id, existing_run.workflow_version, existing_run.deadline_at,
           existing_run.optional_degradation_policy, existing_run.barrier_policy)
       is distinct from
       row(p_run_id, p_plan_id, p_scheduled_slot, p_trace_id, p_workflow_version,
           p_deadline_at, p_optional_degradation_policy, p_barrier_policy) then
      raise exception using errcode = '23505', message = 'scheduled run idempotency collision';
    end if;
    return jsonb_build_object('created', false, 'run_id', existing_run.run_id, 'event_id', workflow_event_id);
  end if;
  select count(*) into schedule_count
  from registry.source_schedules schedule
  join jsonb_to_recordset(p_schedule_leases) lease(schedule_id text, lease_epoch bigint)
    on lease.schedule_id = schedule.schedule_id and lease.lease_epoch = schedule.lease_epoch
  where schedule.lease_owner = p_lease_owner and schedule.state = 'active'
    and schedule.next_due_at <= p_scheduled_slot
    and schedule.source_id = plan_row.source_id
    and schedule.configuration_revision = plan_row.source_configuration_revision;
  select count(*) into expected_scope_count from ingest.harvest_plan_scopes
  where plan_id = p_plan_id and required_for_publication;
  if schedule_count <> jsonb_array_length(p_schedule_leases)
     or schedule_count <> expected_scope_count
     or exists (
       (select scope_id from ingest.harvest_plan_scopes where plan_id = p_plan_id and required_for_publication)
       except
       (select schedule.scope_id from registry.source_schedules schedule
        join jsonb_to_recordset(p_schedule_leases) lease(schedule_id text, lease_epoch bigint)
          on lease.schedule_id = schedule.schedule_id and lease.lease_epoch = schedule.lease_epoch)
     ) then
    raise exception using errcode = '40001', message = 'scheduled run exact scope/lease fence rejected';
  end if;
  if exists (
    select 1 from registry.source_schedules schedule
    join jsonb_to_recordset(p_schedule_leases) lease(schedule_id text, lease_epoch bigint)
      on lease.schedule_id = schedule.schedule_id and lease.lease_epoch = schedule.lease_epoch
    where schedule.mode <> (select mode from registry.source_schedules first_schedule where first_schedule.schedule_id = (p_schedule_leases->0->>'schedule_id'))
       or schedule.optional_degradation_policy <> p_optional_degradation_policy
  ) then
    raise exception using errcode = '23514', message = 'scheduled run mode/policy group mismatch';
  end if;
  insert into ingest.harvest_runs
    (run_id, plan_id, source_id, endpoint_id, source_configuration_revision,
     scheduled_slot, mode, run_idempotency_key, trace_id, state, active_attempt,
     workflow_version, deadline_at, optional_degradation_policy, barrier_policy,
     replay_of_run_id, enumeration_seal_id, candidate_publication_id,
     last_known_good_publication_id, state_changed_at, terminal_at, created_at, updated_at)
  values
    (p_run_id, p_plan_id, plan_row.source_id, plan_row.endpoint_id,
     plan_row.source_configuration_revision, p_scheduled_slot,
     (select mode from registry.source_schedules where schedule_id = (p_schedule_leases->0->>'schedule_id')),
     p_run_idempotency_key, p_trace_id, 'scheduled', 1, p_workflow_version,
     p_deadline_at, p_optional_degradation_policy, p_barrier_policy, null, null,
     null, 'publication_last_known_good', p_scheduled_slot, null,
     p_scheduled_slot, p_scheduled_slot);
  insert into ops.outbox
    (event_id, event_type, producer, idempotency_key, state, references_payload,
     trace_id, attempt_count, maximum_delivery_attempts, lease_owner,
     lease_epoch, lease_expires_at, first_attempt_at, next_eligible_at,
     transport_retention_expires_at, send_outcome, safe_detail_code,
     created_at, updated_at, published_at, workflow_instance_id,
     workflow_attempt, workflow_version, workflow_retention_expires_at,
     run_deadline_at)
  values
    (workflow_event_id, 'workflow_start_requested', 'scheduler',
     'event:workflow_start_requested:' || p_run_id, 'pending',
     jsonb_build_object('run_id', p_run_id), p_trace_id, 0, 6, null, 0,
     null, null, null, null, 'not_started', null, p_scheduled_slot,
     p_scheduled_slot, null, p_workflow_instance_id, 1,
     p_workflow_version, p_workflow_retention_expires_at, p_deadline_at);
  update registry.source_schedules schedule
  set last_scheduled_slot = p_scheduled_slot,
      next_due_at = p_scheduled_slot + make_interval(secs => schedule.cadence_seconds),
      lease_owner = null, lease_expires_at = null, updated_at = p_scheduled_slot
  from jsonb_to_recordset(p_schedule_leases) lease(schedule_id text, lease_epoch bigint)
  where schedule.schedule_id = lease.schedule_id
    and schedule.lease_owner = p_lease_owner and schedule.lease_epoch = lease.lease_epoch;
  get diagnostics inserted_count = row_count;
  if inserted_count <> schedule_count then
    raise exception using errcode = '40001', message = 'scheduled run advance CAS rejected';
  end if;
  return jsonb_build_object('created', true, 'run_id', p_run_id, 'event_id', workflow_event_id);
end
$function$;

revoke all on function ingest.ensure_scheduled_run_and_workflow_start(jsonb,text,text,text,text,timestamptz,text,text,text,timestamptz,timestamptz,jsonb,jsonb) from public;
grant execute on function ingest.ensure_scheduled_run_and_workflow_start(jsonb,text,text,text,text,timestamptz,text,text,text,timestamptz,timestamptz,jsonb,jsonb) to ushso_scheduler;

reset role;
set local role ushso_ops_owner;

create function ops.persist_terminal_job_dead_letter(
  p_job_id text,
  p_original_event_id text,
  p_failure_payload jsonb,
  p_transport_delivery_attempts integer,
  p_recorded_at timestamptz,
  p_trace_id text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, ops, ingest
as $function$
declare
  job_row ingest.jobs%rowtype;
  run_row ingest.harvest_runs%rowtype;
  event_row ops.outbox%rowtype;
  attempt_key_id text;
  attempt_ids text[];
  queue_name text;
  dead_letter_id text;
  terminal_job_state text;
  safe_references jsonb;
begin
  if not ops.safe_failure_payload(p_failure_payload) then
    raise exception using errcode = '23514', message = 'terminal job failure payload is unsafe or untyped';
  end if;
  select * into job_row from ingest.jobs where job_id = p_job_id for update;
  select * into event_row from ops.outbox where event_id = p_original_event_id for update;
  select * into run_row from ingest.harvest_runs where run_id = job_row.run_id for update;
  if job_row.job_id is null or event_row.event_id is null or run_row.run_id is null
     or job_row.attempt_count < 1
     or event_row.state <> 'published'
     or event_row.references_payload->>'run_id' is distinct from job_row.run_id
     or event_row.references_payload->>'job_id' is distinct from job_row.job_id then
    raise exception using errcode = '23514', message = 'terminal job/outbox/run lineage fence rejected';
  end if;
  queue_name := case job_row.job_type
    when 'harvest_page' then 'harvest-page-dlq'
    when 'normalize_record' then 'normalize-record-dlq'
    when 'enrich_schema' then 'enrich-schema-dlq'
    when 'access_check' then 'access-check-dlq'
    when 'project_index' then 'project-index-dlq'
  end;
  if queue_name is null then
    raise exception using errcode = '23514', message = 'terminal job has no DLQ mapping';
  end if;
  terminal_job_state := case job_row.job_type
    when 'normalize_record' then 'quarantined'
    when 'enrich_schema' then 'quarantined'
    when 'access_check' then 'succeeded'
    when 'harvest_page' then 'dead'
    when 'project_index' then 'dead'
  end;
  if p_transport_delivery_attempts < job_row.attempt_count or p_transport_delivery_attempts > 20 then
    raise exception using errcode = '23514', message = 'terminal transport/database attempt accounting fence rejected';
  end if;
  dead_letter_id := 'deadletter_' || encode(sha256(convert_to(queue_name || ':' || p_original_event_id, 'UTF8')), 'hex');
  if exists (
    select 1 from ops.durable_dead_letters dead
    where dead.dead_letter_id = dead_letter_id
      and dead.queue_name = queue_name
      and dead.original_event_id = p_original_event_id
      and dead.job_id = job_row.job_id
  ) then
    return dead_letter_id;
  end if;
  select attempt_key.attempt_id into attempt_key_id
  from ingest.job_attempt_keys attempt_key
  where attempt_key.job_id = job_row.job_id
    and attempt_key.delivery_attempt = job_row.attempt_count;
  if attempt_key_id is null or not exists (
    select 1 from ingest.job_attempts attempt
    where attempt.attempt_id = attempt_key_id
      and attempt.job_id = job_row.job_id
      and attempt.run_id = job_row.run_id
      and attempt.source_id = job_row.source_id
      and attempt.delivery_attempt = job_row.attempt_count
      and attempt.run_attempt = job_row.active_run_attempt
      and attempt.lease_epoch = job_row.lease_epoch
      and attempt.original_event_id = p_original_event_id
      and attempt.outcome = 'started'
  ) then
    raise exception using errcode = '23514', message = 'terminal job current-attempt evidence missing';
  end if;
  update ingest.jobs
  set state = terminal_job_state, lease_owner = null, lease_expires_at = null,
      next_eligible_at = null, last_transport_event_id = p_original_event_id,
      transport_retention_expires_at = greatest(
        coalesce(job_row.transport_retention_expires_at,
                 event_row.transport_retention_expires_at,
                 p_recorded_at),
        p_recorded_at
      ),
      updated_at = p_recorded_at
  where job_id = job_row.job_id;
  insert into ingest.job_attempts
    (attempt_id, job_id, run_id, source_id, delivery_attempt,
     maximum_delivery_attempts, retry_policy_version, first_attempt_at,
     started_at, finished_at, run_attempt, lease_epoch, original_event_id,
     failure_payload, retry_after_seconds, computed_delay_seconds,
     next_eligible_at, outcome, error_class,
     database_transaction_committed, transport_action,
     durable_dead_letter_id, recorded_at, trace_id)
  values
    (attempt_key_id, job_row.job_id, job_row.run_id, job_row.source_id,
     job_row.attempt_count, job_row.maximum_delivery_attempts,
     job_row.retry_policy_version, coalesce(job_row.first_attempt_at, p_recorded_at),
     p_recorded_at, p_recorded_at, job_row.active_run_attempt,
     job_row.lease_epoch, p_original_event_id, p_failure_payload,
     null, null, null, 'dead_lettered', p_failure_payload->>'safe_detail_code',
     true, 'ack_after_commit', dead_letter_id, p_recorded_at, p_trace_id);
  if job_row.job_type = 'harvest_page' and run_row.terminal_at is null then
    update ingest.harvest_runs
    set state = 'partial_unpublished',
        terminal_at = p_recorded_at, updated_at = p_recorded_at
    where run_id = run_row.run_id;
    update ingest.workflow_attempt_mappings
    set platform_state = 'complete', is_active = false, terminal_at = p_recorded_at
    where run_id = run_row.run_id and attempt = job_row.active_run_attempt and is_active;
  end if;
  select array_agg(attempt_key.attempt_id order by attempt_key.delivery_attempt)
  into attempt_ids
  from ingest.job_attempt_keys attempt_key
  where attempt_key.job_id = job_row.job_id
    and exists (select 1 from ingest.job_attempts attempt where attempt.attempt_id = attempt_key.attempt_id and attempt.job_id = attempt_key.job_id);
  safe_references := jsonb_build_object(
    'run_id', job_row.run_id, 'job_id', job_row.job_id,
    'capture_ref_id', event_row.references_payload->'capture_ref_id',
    'checkpoint_id', event_row.references_payload->'checkpoint_id',
    'canonical_id', event_row.references_payload->'canonical_id',
    'canonical_revision_id', event_row.references_payload->'canonical_revision_id',
    'r2_key', event_row.references_payload->'r2_key',
    'cursor_ref_id', event_row.references_payload->'cursor_ref_id'
  );
  insert into ops.durable_dead_letters
    (contract_version, record_kind, dead_letter_id, queue_name,
     original_event_id, source_id, run_id, job_id, failure_payload,
     transport_delivery_attempts, database_attempts, retry_policy_version,
     message_references, attempt_ids, replay_state, persisted_at,
     sink_transaction_committed, retain_until)
  values
    ('ingestion.v1.0.0', 'durable_dead_letter', dead_letter_id,
     queue_name, p_original_event_id, job_row.source_id, job_row.run_id,
     job_row.job_id, p_failure_payload, p_transport_delivery_attempts,
     job_row.attempt_count, job_row.retry_policy_version, safe_references,
     attempt_ids, 'not_requested', p_recorded_at, true,
     p_recorded_at + interval '90 days')
  on conflict (queue_name, original_event_id) do nothing;
  insert into ops.dead_letter_events
    (dead_letter_id, queue_name, action, audit_event_id, recorded_at, trace_id)
  values
    (dead_letter_id, queue_name, 'persisted',
     'audit_' || encode(sha256(convert_to('deadletter:' || dead_letter_id, 'UTF8')), 'hex'),
     p_recorded_at, p_trace_id);
  insert into ops.audit_events
    (audit_event_id, action, actor_id, actor_type, object_type,
     object_id, decision, details, trace_id, occurred_at)
  values
    ('audit_' || encode(sha256(convert_to('deadletter:' || dead_letter_id, 'UTF8')), 'hex'),
     'dead_letter_reconstructed_after_transport_loss', session_user,
     'system_reconciler', 'durable_dead_letter', dead_letter_id, 'completed',
     jsonb_build_object('run_id', job_row.run_id, 'job_id', job_row.job_id,
                        'event_id', p_original_event_id),
     p_trace_id, p_recorded_at);
  return dead_letter_id;
end
$function$;

create function ops.terminalize_expired_job_leases(
  p_reconciled_at timestamptz,
  p_limit integer,
  p_trace_id text
)
returns table(job_id text, dead_letter_id text)
language plpgsql
security definer
set search_path = pg_catalog, ops, ingest
as $function$
declare
  candidate record;
  failure_payload jsonb;
begin
  for candidate in
    select job.job_id, coalesce(job.last_transport_event_id, job.outbox_event_id) original_event_id,
           job.target_class, job.attempt_count
    from ingest.jobs job
    where job.state = 'leased' and job.lease_expires_at <= p_reconciled_at
      and job.attempt_count >= job.maximum_delivery_attempts
    order by job.lease_expires_at, job.job_id
    for update skip locked limit p_limit
  loop
    failure_payload := jsonb_build_object(
      'failure_type', 'internal_failure', 'retry_class', 'transient',
      'target_class', candidate.target_class,
      'safe_detail_code', 'JOB_LEASE_EXPIRED_AT_RETRY_BUDGET',
      'observed_at', p_reconciled_at
    );
    job_id := candidate.job_id;
    dead_letter_id := ops.persist_terminal_job_dead_letter(
      candidate.job_id, candidate.original_event_id, failure_payload,
      candidate.attempt_count, p_reconciled_at, p_trace_id
    );
    return next;
  end loop;
end
$function$;

create function ops.admit_dlq_transport_exhaustion(
  p_original_event_id text,
  p_queue_name text,
  p_source_id text,
  p_run_id text,
  p_job_id text,
  p_observed_at timestamptz,
  p_evidence_reference_id text,
  p_audit_event_id text,
  p_admitted_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, ops
as $function$
begin
  insert into ops.dlq_transport_exhaustion_observations
    (original_event_id, queue_name, source_id, run_id, job_id,
     transport_delivery_attempts, observed_at, evidence_reference_id,
     audit_event_id, admitted_by, admitted_at)
  values
    (p_original_event_id, p_queue_name, p_source_id, p_run_id, p_job_id,
     6, p_observed_at, p_evidence_reference_id, p_audit_event_id,
     session_user, p_admitted_at)
  on conflict (original_event_id) do nothing;
  if found then return true; end if;
  if not exists (
    select 1 from ops.dlq_transport_exhaustion_observations observation
    where observation.original_event_id = p_original_event_id
      and observation.queue_name = p_queue_name
      and observation.source_id = p_source_id
      and observation.run_id = p_run_id
      and observation.job_id = p_job_id
      and observation.transport_delivery_attempts = 6
      and observation.observed_at = p_observed_at
      and observation.evidence_reference_id = p_evidence_reference_id
      and observation.audit_event_id = p_audit_event_id
  ) then
    raise exception using errcode = '23505', message = 'DLQ transport-exhaustion observation idempotency collision';
  end if;
  return false;
end
$function$;

create function ops.reconstruct_dlq_transport_exhaustion(
  p_original_event_id text,
  p_recovered_at timestamptz,
  p_trace_id text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, ops, ingest
as $function$
declare
  observation ops.dlq_transport_exhaustion_observations%rowtype;
  job_row ingest.jobs%rowtype;
  failure_payload jsonb;
  reconstructed_id text;
begin
  select * into observation
  from ops.dlq_transport_exhaustion_observations
  where original_event_id = p_original_event_id for update;
  if not found then raise exception using errcode = '23503', message = 'audited DLQ transport exhaustion observation missing'; end if;
  if observation.reconstructed_dead_letter_id is not null then return observation.reconstructed_dead_letter_id; end if;
  select * into job_row from ingest.jobs where job_id = observation.job_id;
  failure_payload := jsonb_build_object(
    'failure_type', 'internal_failure', 'retry_class', 'transient',
    'target_class', job_row.target_class,
    'safe_detail_code', 'DLQ_SINK_TRANSPORT_EXHAUSTED',
    'observed_at', observation.observed_at
  );
  reconstructed_id := ops.persist_terminal_job_dead_letter(
    observation.job_id, observation.original_event_id, failure_payload,
    observation.transport_delivery_attempts, p_recovered_at, p_trace_id
  );
  update ops.dlq_transport_exhaustion_observations
  set reconstructed_dead_letter_id = reconstructed_id,
      reconstructed_at = p_recovered_at
  where original_event_id = p_original_event_id;
  return reconstructed_id;
end
$function$;

revoke all on function ops.persist_terminal_job_dead_letter(text,text,jsonb,integer,timestamptz,text) from public;
revoke all on function ops.terminalize_expired_job_leases(timestamptz,integer,text) from public;
revoke all on function ops.admit_dlq_transport_exhaustion(text,text,text,text,text,timestamptz,text,text,timestamptz) from public;
revoke all on function ops.reconstruct_dlq_transport_exhaustion(text,timestamptz,text) from public;
grant execute on function ops.terminalize_expired_job_leases(timestamptz,integer,text),
  ops.reconstruct_dlq_transport_exhaustion(text,timestamptz,text) to ushso_scheduler;
grant execute on function ops.admit_dlq_transport_exhaustion(text,text,text,text,text,timestamptz,text,text,timestamptz),
  ops.reconstruct_dlq_transport_exhaustion(text,timestamptz,text) to ushso_ops;

-- Physical correctness-ledger deletion remains a direct-maintenance
-- capability. Worker roles can record/evaluate evidence but cannot call these
-- DDL functions. The authorization and DDL execute in one transaction, so a
-- failed detach/drop rolls back the proof/audit/watermark receipt too.
create function ops.authorize_gc_partition_deletion(
  p_partition_relation text,
  p_proof_digest text,
  p_deleted_at timestamptz
)
returns table(parent_relation text, archived_row_count bigint)
language plpgsql
security definer
set search_path = pg_catalog, ops
as $function$
declare
  partition_row ops.partition_registry%rowtype;
  proof_row ops.gc_dependency_proofs%rowtype;
  archive_row ops.archive_manifests%rowtype;
  watermark_row ops.gc_watermarks%rowtype;
begin
  if p_partition_relation !~ '^(ingest|ops)\.[a-z][a-z0-9_]{2,127}$'
     or p_proof_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'GC partition/proof identifier invalid';
  end if;
  select * into partition_row from ops.partition_registry
  where partition_relation = p_partition_relation for update;
  select * into proof_row from ops.gc_dependency_proofs
  where partition_relation = p_partition_relation and proof_digest = p_proof_digest;
  select * into archive_row from ops.archive_manifests
  where partition_relation = p_partition_relation
  order by archived_at desc limit 1;
  select * into watermark_row from ops.gc_watermarks
  where partition_relation = p_partition_relation for update;
  if partition_row.partition_relation is null or partition_row.state <> 'archived_verified'
     or partition_row.retention_deadline > p_deleted_at
     or partition_row.replay_horizon_expires_at is null
     or partition_row.replay_horizon_expires_at > p_deleted_at
     or partition_row.workflow_retention_grace_expires_at is null
     or partition_row.workflow_retention_grace_expires_at > p_deleted_at
     or partition_row.rollback_window_expires_at is null
     or partition_row.rollback_window_expires_at > p_deleted_at
     or proof_row.dependency_proof_id is null
     or proof_row.evidence_payload->>'proof_digest' is distinct from p_proof_digest
     or proof_row.evidence_payload->>'partition_id' is distinct from p_partition_relation
     or proof_row.evidence_payload->>'archive_sha256' is distinct from archive_row.archive_object_sha256
     or (proof_row.evidence_payload->>'row_count')::bigint is distinct from archive_row.row_count
     or proof_row.evidence_payload->>'eligible' is distinct from 'true'
     or jsonb_typeof(proof_row.evidence_payload->'blockers') <> 'array'
     or jsonb_array_length(proof_row.evidence_payload->'blockers') <> 0
     or proof_row.evidence_payload->'dependencies'->>'archive_access_controlled' is distinct from 'true'
     or proof_row.evidence_payload->'dependencies'->>'replay_horizon_expired' is distinct from 'true'
     or proof_row.evidence_payload->'dependencies'->>'workflow_retention_grace_expired' is distinct from 'true'
     or proof_row.evidence_payload->'dependencies'->>'rollback_window_expired' is distinct from 'true'
     or archive_row.archive_manifest_id is null
     or archive_row.archive_state <> 'restore_verified'
     or archive_row.restore_tested_at is null
     or not archive_row.archive_access_controlled
     or not archive_row.backup_pitr_compatible
     or not archive_row.legal_policy_approved
     or watermark_row.gc_watermark_id is null
     or watermark_row.dependency_proof_id <> proof_row.dependency_proof_id
     or watermark_row.archive_manifest_id <> archive_row.archive_manifest_id
     or watermark_row.row_count <> archive_row.row_count
     or watermark_row.executed_at is not null
     or not exists (
       select 1 from ops.audit_events audit
       where audit.audit_event_id = watermark_row.audit_event_id
         and audit.action = 'correctness_ledger_gc'
         and audit.object_type = 'partition'
         and audit.object_id = p_partition_relation
         and audit.decision in ('allowed','completed')
         and audit.details->>'proof_digest' is not distinct from p_proof_digest
         and audit.occurred_at <= p_deleted_at
     ) then
    raise exception using errcode = '23514', message = 'GC maintenance evidence fence rejected';
  end if;
  select parent.oid::regclass::text into parent_relation
  from pg_catalog.pg_inherits inheritance
  join pg_catalog.pg_class parent on parent.oid = inheritance.inhparent
  where inheritance.inhrelid = to_regclass(p_partition_relation);
  if parent_relation is null then
    raise exception using errcode = '23514', message = 'GC target is not an attached partition';
  end if;
  archived_row_count := archive_row.row_count;
  return next;
end
$function$;

create function ops.complete_gc_partition_deletion(
  p_partition_relation text,
  p_proof_digest text,
  p_deleted_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, ops
as $function$
begin
  if to_regclass(p_partition_relation) is not null then
    raise exception using errcode = '23514', message = 'GC partition still exists at completion';
  end if;
  update ops.partition_registry set state = 'deleted'
  where partition_relation = p_partition_relation and state = 'archived_verified';
  if not found then raise exception using errcode = '40001', message = 'GC partition completion CAS rejected'; end if;
  update ops.gc_watermarks watermark set executed_at = p_deleted_at
  from ops.gc_dependency_proofs proof
  where watermark.partition_relation = p_partition_relation
    and proof.dependency_proof_id = watermark.dependency_proof_id
    and proof.proof_digest = p_proof_digest
    and watermark.executed_at is null;
  if not found then raise exception using errcode = '40001', message = 'GC watermark completion CAS rejected'; end if;
end
$function$;

create function ops.delete_verified_ops_partition(
  p_partition_relation text,
  p_proof_digest text,
  p_deleted_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, ops
as $function$
declare
  gc_authorization record;
  actual_row_count bigint;
begin
  select * into gc_authorization from ops.authorize_gc_partition_deletion(
    p_partition_relation, p_proof_digest, p_deleted_at
  );
  if gc_authorization.parent_relation not in (
    'ops.outbox_attempt_events','ops.processed_event_history',
    'ops.dead_letter_events','ops.audit_events'
  ) then
    raise exception using errcode = '42501', message = 'GC ops partition parent is not allowlisted';
  end if;
  execute format('select count(*) from %s', to_regclass(p_partition_relation)) into actual_row_count;
  if actual_row_count <> gc_authorization.archived_row_count then
    raise exception using errcode = '23514', message = 'GC archive/live row count mismatch';
  end if;
  execute format('alter table %s detach partition %s', to_regclass(gc_authorization.parent_relation), to_regclass(p_partition_relation));
  execute format('drop table %s', to_regclass(p_partition_relation));
  perform ops.complete_gc_partition_deletion(p_partition_relation, p_proof_digest, p_deleted_at);
  return actual_row_count;
end
$function$;

revoke all on function ops.authorize_gc_partition_deletion(text,text,timestamptz),
  ops.complete_gc_partition_deletion(text,text,timestamptz),
  ops.delete_verified_ops_partition(text,text,timestamptz) from public;
grant execute on function ops.authorize_gc_partition_deletion(text,text,timestamptz),
  ops.complete_gc_partition_deletion(text,text,timestamptz) to ushso_ingest_owner;
grant execute on function ops.delete_verified_ops_partition(text,text,timestamptz) to ushso_maintenance;

reset role;
set local role ushso_ingest_owner;

create function ingest.delete_verified_ingest_partition(
  p_partition_relation text,
  p_proof_digest text,
  p_deleted_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, ingest, ops
as $function$
declare
  gc_authorization record;
  actual_row_count bigint;
begin
  select * into gc_authorization from ops.authorize_gc_partition_deletion(
    p_partition_relation, p_proof_digest, p_deleted_at
  );
  if gc_authorization.parent_relation not in (
    'ingest.run_state_events','ingest.job_attempts',
    'ingest.workflow_reconciliation_events'
  ) then
    raise exception using errcode = '42501', message = 'GC ingest partition parent is not allowlisted';
  end if;
  execute format('select count(*) from %s', to_regclass(p_partition_relation)) into actual_row_count;
  if actual_row_count <> gc_authorization.archived_row_count then
    raise exception using errcode = '23514', message = 'GC archive/live row count mismatch';
  end if;
  execute format('alter table %s detach partition %s', to_regclass(gc_authorization.parent_relation), to_regclass(p_partition_relation));
  execute format('drop table %s', to_regclass(p_partition_relation));
  perform ops.complete_gc_partition_deletion(p_partition_relation, p_proof_digest, p_deleted_at);
  return actual_row_count;
end
$function$;

revoke all on function ingest.delete_verified_ingest_partition(text,text,timestamptz) from public;
grant execute on function ingest.delete_verified_ingest_partition(text,text,timestamptz) to ushso_maintenance;

reset role;
set local role ushso_search_owner;

create view search.published_runtime_status as
select
  null::text as publication_id,
  null::text as index_generation_id,
  null::timestamptz as canonical_as_of,
  null::text as coverage_snapshot_id
where false;

-- Empty foundation interface for immutable, generation-pinned reads. WP8
-- replaces the projection behind this stable view; it must continue to filter
-- only by the caller-supplied generation and must never dereference the mutable
-- publication pointer internally.
create view search.published_generation_records as
select
  null::text as index_generation_id,
  null::text as record_type,
  null::text as record_id,
  null::jsonb as published_document
where false;

reset role;

grant usage on schema ops, ingest to ushso_maintenance;

grant usage on schema registry to ushso_normalize, ushso_projector;

grant select on search.published_runtime_status, search.published_generation_records
  to ushso_public;

grant select, update on ops.outbox to ushso_scheduler;
grant select, insert, update on ops.service_heartbeats to ushso_scheduler;
grant select, insert on ops.outbox_attempt_events to ushso_scheduler;
grant select on ops.dlq_transport_exhaustion_observations to ushso_scheduler;

-- The only cross-schema capability granted to the non-login ingest owner is
-- the exact outbox relation used by the SECURITY DEFINER all-scope commit.
-- It receives no ops audit, DLQ, recovery-control, or retention privileges.
grant select, insert on ops.outbox, ops.outbox_attempt_events to ushso_ingest_owner;

grant select, insert, update on ops.outbox to ushso_harvest, ushso_normalize, ushso_projector;
grant select, insert on ops.outbox_attempt_events to ushso_harvest, ushso_normalize, ushso_projector;
grant select, insert on ops.processed_event_keys, ops.processed_event_history
  to ushso_harvest, ushso_normalize, ushso_projector;
grant select, insert on ops.business_effect_receipts
  to ushso_harvest, ushso_normalize, ushso_projector;
grant select, insert, update on ops.origin_controls
  to ushso_harvest, ushso_normalize, ushso_projector;
grant select on ops.run_publication_barriers to ushso_harvest, ushso_normalize;
grant select, insert on ops.run_publication_barriers to ushso_projector;

grant select, insert, update on ops.outbox, ops.durable_dead_letters,
  ops.service_heartbeats, ops.recovery_controls, ops.archive_manifests,
  ops.partition_registry, ops.gc_watermarks, ops.origin_controls to ushso_ops;
grant select, insert on ops.business_effect_receipts,
  ops.run_publication_barriers to ushso_ops;
grant select on ops.dlq_transport_exhaustion_observations to ushso_ops;
grant select, insert on ops.outbox_attempt_events, ops.processed_event_keys,
  ops.processed_event_history, ops.dead_letter_events, ops.replay_lineage,
  ops.audit_events, ops.gc_dependency_proofs to ushso_ops;
grant select on ops.retention_policies, ops.correctness_ledger_registry to ushso_ops;

grant usage, select on all sequences in schema ops to ushso_scheduler, ushso_harvest,
  ushso_normalize, ushso_projector, ushso_ops;

revoke all on all tables in schema registry, ingest, catalog, identity, ops from ushso_public;
revoke all on all sequences in schema registry, ingest, catalog, identity, ops from ushso_public;

reset role;
