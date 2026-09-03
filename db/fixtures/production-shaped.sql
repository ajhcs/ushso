-- Synthetic, metadata-only, production-shaped control-plane data.

insert into registry.sources
  (source_id, source_key, display_name, state, current_revision_number, created_at, updated_at)
select
  'src-' || n,
  'source-' || n,
  'Synthetic metadata source ' || n,
  'active', 1, clock_timestamp() - interval '30 days', clock_timestamp() - interval '30 days'
from generate_series(1, 64) n;

insert into registry.source_revisions
  (source_id, revision_number, contract_version, descriptor, descriptor_sha256, recorded_at, recorded_by)
select
  'src-' || n, 1, '1.0.0',
  jsonb_build_object('fixture', true, 'source_id', 'src-' || n, 'metadata_only', true),
  lpad(to_hex(n), 64, '0'), clock_timestamp() - interval '30 days', 'wp3-fixture'
from generate_series(1, 64) n;

insert into registry.endpoints
  (endpoint_id, source_id, endpoint_key, state, current_revision_number, created_at, updated_at)
select
  'endpoint-' || n, 'src-' || n, 'catalog-' || n, 'active', 1,
  clock_timestamp() - interval '30 days', clock_timestamp() - interval '30 days'
from generate_series(1, 64) n;

insert into registry.endpoint_revisions
  (endpoint_id, revision_number, source_revision_id, base_origin, host_allowlist,
   redirect_host_allowlist, route_templates, secret_reference_id, descriptor_sha256, recorded_at)
select
  'endpoint-' || n, 1, sr.source_revision_id,
  'https://fixture-' || n || '.invalid', array['fixture-' || n || '.invalid'], array[]::text[],
  jsonb_build_array(jsonb_build_object('template_id', 'catalog', 'target_class', 'catalog_root')),
  null, lpad(to_hex(10000 + n), 64, '0'), clock_timestamp() - interval '30 days'
from generate_series(1, 64) n
join registry.source_revisions sr on sr.source_id = 'src-' || n;

insert into registry.scopes
  (scope_id, endpoint_id, scope_key, unit, jurisdiction_code, inclusion_policy,
   exclusion_policy, denominator_definition, state, configuration_revision, created_at, updated_at)
select
  'scope-' || n, 'endpoint-' || n, 'scope-' || n, 'catalog', null,
  '{"metadata_only":true}'::jsonb, '{"payloads":true}'::jsonb,
  jsonb_build_object('unit', 'catalog', 'scope_id', 'scope-' || n),
  'active', 1, clock_timestamp() - interval '30 days', clock_timestamp() - interval '30 days'
from generate_series(1, 64) n;

insert into registry.source_schedules
  (schedule_id, source_id, scope_id, cadence_seconds, next_due_at, last_scheduled_slot,
   mode, state, configuration_revision, updated_at)
select
  'schedule-' || n, 'src-' || n, 'scope-' || n, 3600,
  clock_timestamp() - (n || ' minutes')::interval, null,
  case when n % 8 = 0 then 'full_membership' else 'incremental' end,
  'active', 1, clock_timestamp()
from generate_series(1, 64) n;

insert into ingest.harvest_plans
  (plan_id, source_id, endpoint_id, scope_id, source_configuration_revision,
   contract_version, plan_sha256, plan_payload, created_at)
select
  'plan-' || n, 'src-' || n, 'endpoint-' || n, 'scope-' || n, 1,
  '1.0.0', lpad(to_hex(20000 + n), 64, '0'),
  jsonb_build_object('fixture', true, 'source_id', 'src-' || n), clock_timestamp() - interval '7 days'
from generate_series(1, 64) n;

insert into ingest.harvest_runs
  (run_id, plan_id, source_id, endpoint_id, source_configuration_revision,
   scheduled_slot, mode, run_idempotency_key, state, active_attempt, replay_of_run_id,
   deadline_at,
   enumeration_seal_id, candidate_publication_id, last_known_good_publication_id,
   state_changed_at, terminal_at, created_at, updated_at)
select
  'run-' || n,
  'plan-' || (((n - 1) % 64) + 1),
  'src-' || (((n - 1) % 64) + 1),
  'endpoint-' || (((n - 1) % 64) + 1),
  1,
  date_trunc('minute', clock_timestamp()) - (n || ' minutes')::interval,
  'incremental', 'run-idempotency-' || n, 'scheduled', 1, null,
  date_trunc('minute', clock_timestamp()) - (n || ' minutes')::interval + interval '24 hours',
  null, null,
  'publication-static-v1', clock_timestamp(), null, clock_timestamp(), clock_timestamp()
from generate_series(1, 512) n;

insert into ingest.workflow_attempt_mappings
  (run_id, attempt, workflow_instance_id, workflow_version, platform_state,
   is_active, created_at, retention_expires_at, terminal_at)
select
  'run-' || n, 1, 'harvest-run-' || n || '-1', '1.0.0', 'requested', true,
  clock_timestamp(), clock_timestamp() + interval '30 days', null
from generate_series(1, 512) n;

insert into ingest.jobs
  (job_id, run_id, source_id, job_type, state, idempotency_key, identity_payload,
   active_run_attempt, attempt_count, maximum_delivery_attempts, lease_owner,
   lease_epoch, lease_expires_at, retry_policy_version, first_attempt_at,
   next_eligible_at, outbox_event_id, created_at, updated_at)
select
  'job-' || n,
  'run-' || (((n - 1) % 512) + 1),
  'src-' || (((n - 1) % 64) + 1),
  (array['harvest_page','normalize_record','enrich_schema','access_check','project_index'])[((n - 1) % 5) + 1],
  'leased', 'job-idempotency-' || n,
  jsonb_build_object('fixture', true, 'cursor_ref', 'cursor-' || n),
  1, 1,
  (array[6,5,4,4,5])[((n - 1) % 5) + 1],
  'fixture-worker', 1, clock_timestamp() + interval '1 hour', 'retry-v1', clock_timestamp(),
  clock_timestamp() - ((n % 600) || ' seconds')::interval,
  'event-' || n, clock_timestamp() - ((n % 3600) || ' seconds')::interval, clock_timestamp()
from generate_series(1, 8192) n;

insert into ingest.job_attempt_keys (attempt_id, job_id, delivery_attempt, first_recorded_at)
select 'attempt-' || n, 'job-' || n, 1, clock_timestamp()
from generate_series(1, 8192) n;

insert into ingest.job_attempts
  (attempt_id, job_id, run_id, source_id, delivery_attempt,
   maximum_delivery_attempts, retry_policy_version, first_attempt_at,
   started_at, run_attempt, lease_epoch, original_event_id, outcome,
   error_class, database_transaction_committed, transport_action, recorded_at, trace_id)
select
  'attempt-' || n, 'job-' || n, 'run-' || (((n - 1) % 512) + 1),
  'src-' || (((n - 1) % 64) + 1), 1,
  (array[6,5,4,4,5])[((n - 1) % 5) + 1], 'retry-v1',
  clock_timestamp(), clock_timestamp(), 1, 1, 'event-' || n,
  'started', null, true, 'none_pending', clock_timestamp(),
  'fixture-trace-attempt-' || n
from generate_series(1, 8192) n;

insert into ops.outbox
  (event_id, event_type, producer, idempotency_key, state, references_payload,
   trace_id, attempt_count, maximum_delivery_attempts, lease_owner, lease_epoch,
   lease_expires_at, first_attempt_at, next_eligible_at, send_outcome,
   created_at, updated_at, published_at)
select
  'event-' || n,
  (array['harvest_page_requested','normalize_requested','schema_enrichment_requested','access_check_requested','projection_requested'])[((n - 1) % 5) + 1],
  (array['scheduler','harvest','normalize','normalize','projector'])[((n - 1) % 5) + 1],
  'event-idempotency-' || n, 'published',
  jsonb_build_object('job_id', 'job-' || n, 'run_id', 'run-' || (((n - 1) % 512) + 1)),
  'fixture-trace-outbox-' || n, 0,
  (array[6,5,4,4,5])[((n - 1) % 5) + 1],
  null, 0, null, null, clock_timestamp(), 'published_confirmed',
  clock_timestamp(), clock_timestamp(), clock_timestamp()
from generate_series(1, 8192) n;

insert into ops.processed_event_keys
  (consumer_name, event_id, effect_idempotency_key, source_id, run_id, job_id,
   event_type, message_idempotency_key, run_attempt, lease_epoch, origin_id,
   target_class, retry_policy_version, business_effect_sha256,
   transaction_committed_at, retain_until)
select
  (array['harvest_page_consumer','normalize_record_consumer','enrich_schema_consumer','access_check_consumer','project_index_consumer'])[((n - 1) % 5) + 1],
  'event-' || n, 'effect-' || n,
  'src-' || (((n - 1) % 64) + 1), 'run-' || (((n - 1) % 512) + 1), 'job-' || n,
  (array['harvest_page_requested','normalize_requested','schema_enrichment_requested','access_check_requested','projection_requested'])[((n - 1) % 5) + 1],
  'event-idempotency-' || n, 1, 1, 'origin_registry_pending', 'exact_item', 'retry-v1',
  lpad(to_hex(30000 + n), 64, '0'), clock_timestamp(), clock_timestamp() + interval '90 days'
from generate_series(1, 8192) n;

insert into ops.processed_event_history
  (consumer_name, event_id, effect_idempotency_key, source_id, run_id, job_id,
   event_type, message_idempotency_key, run_attempt, lease_epoch, origin_id,
   target_class, retry_policy_version, business_effect_sha256,
   downstream_outbox_event_ids, transaction_committed_at, trace_id)
select
  (array['harvest_page_consumer','normalize_record_consumer','enrich_schema_consumer','access_check_consumer','project_index_consumer'])[((n - 1) % 5) + 1],
  'event-' || n, 'effect-' || n,
  'src-' || (((n - 1) % 64) + 1), 'run-' || (((n - 1) % 512) + 1), 'job-' || n,
  (array['harvest_page_requested','normalize_requested','schema_enrichment_requested','access_check_requested','projection_requested'])[((n - 1) % 5) + 1],
  'event-idempotency-' || n, 1, 1, 'origin_registry_pending', 'exact_item', 'retry-v1',
  lpad(to_hex(30000 + n), 64, '0'), array['event-' || n], clock_timestamp(),
  'fixture-trace-processed-' || n
from generate_series(1, 8192) n;

update ingest.jobs
set state = 'pending', lease_owner = null, lease_expires_at = null,
    next_eligible_at = clock_timestamp();

insert into ingest.capture_references
  (capture_reference_id, source_id, run_id, classification, endpoint_id,
   redacted_locator, final_host, safe_response_headers, media_type,
   compressed_bytes, decompressed_bytes, raw_sha256, semantic_sha256, r2_key,
   r2_conditional_write_confirmed, connector_version, evidence_reference_id,
   observed_at, recorded_at, captured_at)
select
  'capture-' || n,
  'src-' || (((n - 1) % 64) + 1), 'run-' || n, 'catalog_metadata',
  'endpoint-' || (((n - 1) % 64) + 1),
  'https://fixture-' || (((n - 1) % 64) + 1) || '.invalid/catalog',
  'fixture-' || (((n - 1) % 64) + 1) || '.invalid',
  '{"content_type":"application/json"}'::jsonb, 'application/json', 1024, 2048,
  lpad(to_hex(40000 + n), 64, '0'), lpad(to_hex(50000 + n), 64, '0'),
  'captures/sha256/00/' || lpad(to_hex(40000 + n), 64, '0'), true,
  '1.0.0', 'evidence-' || n, clock_timestamp(), clock_timestamp(), clock_timestamp()
from generate_series(1, 512) n;

analyze registry.source_schedules;
analyze ingest.harvest_runs;
analyze ingest.jobs;
analyze ops.outbox;
analyze ops.processed_event_keys;
