import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { attestationEvidenceSha256 } from "../../../../../infra/terraform/modules/neon-foundation/attestation-material.mjs";
import { queueControlEnvelopeFields } from "../../../../../packages/ingestion/src/message-contract.mjs";
import { workflowInstanceId } from "../../../../../packages/ingestion/src/scheduler.mjs";
import { checkRendered, expectedRenderedFiles } from "./render-wrangler.mjs";
import { readJson } from "./paths.mjs";

const ENVIRONMENTS = ["staging", "production"];
const EXPECTED_ROLES = ["public", "scheduler", "harvest", "normalize", "projector", "ops"];
const EXPECTED_QUEUES = [
  ["harvest_page", "harvest-page", "harvest-page-dlq", 6, 5],
  ["normalize_record", "normalize-record", "normalize-record-dlq", 5, 4],
  ["schema_enrichment", "enrich-schema", "enrich-schema-dlq", 4, 3],
  ["access_check", "access-check", "access-check-dlq", 4, 3],
  ["index_projection", "project-index", "project-index-dlq", 5, 4]
];
const EXPECTED_DLQS = EXPECTED_QUEUES.map(([, , dlq]) => dlq);
const EXPECTED_DLQ_RETRY_DELAYS = [30, 60, 120, 240, 300];
const EXPECTED_EVENT_FIELDS = [
  "trace_id", "run_id", "workflow_instance_id", "event_id", "source_id", "endpoint_id",
  "connector_version", "stage", "attempt", "outcome", "duration_ms", "rows_or_bytes",
  "error_class", "worker_version"
];
const EXPECTED_ALERTS = [
  "scheduler_heartbeat_missing", "due_source_overdue", "queue_oldest_message_age", "dlq_nonempty",
  "outbox_oldest_pending", "workflow_errored_or_terminated", "connector_auth_or_schema_pause",
  "catalog_count_collapse", "canonical_index_lag_or_generation_age",
  "postgresql_connectivity_storage_backup_pitr", "r2_checksum_or_write_failure",
  "coverage_snapshot_reconciliation_failure", "excluded_or_quarantined_result_leak"
];
const EXPECTED_SLOS = [
  "discovery_availability", "record_search_latency", "bundle_plan_latency", "canonical_to_index_lag",
  "scheduler_timeliness", "normalization_timeliness", "coverage_snapshot_timeliness",
  "index_consistency", "visibility_safety", "generation_rollback", "coverage_reconciliation"
];
const EXPECTED_RECOVERY_CONTROLS = [
  "global_scheduler_toggle", "per_source_pause", "per_stage_queue_pause",
  "connector_version_denylist", "index_publication_freeze", "explicit_replay_with_lineage",
  "immediate_pointer_rollback", "static_corpus_public_fallback"
];
const EXPECTED_RECEIPTS = [
  "provider-capability-review.json",
  "environment-isolation.json",
  "cloudflare-config-validation.json",
  "capacity-and-connection-budget.json",
  "observability-and-alerts.json",
  "security-privacy-foundation.json",
  "recovery-drills.json"
];

function sameMembers(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}

function duplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

export function validateResourceManifest(resource) {
  assert.match(resource.schema_version, /^ushso-cloudflare-resource-manifest\.v1\.0\.0$/);
  assert.ok(ENVIRONMENTS.includes(resource.environment));
  assert.equal(resource.resource_prefix, `ushso-${resource.environment}`);
  assert.equal(resource.deployment_mode, "zero_traffic_foundation");
  assert.equal(resource.workers_dev, false);
  assert.deepEqual(resource.routes, []);
  assert.equal(resource.neon.region, "aws-us-east-1");
  assert.equal(resource.neon.project_name, `ushso-${resource.environment}`);
  assert.equal(resource.neon.pg_version, 16);
  assert.equal(resource.neon.default_branch, "main");
  assert.equal(resource.neon.database_name, "ushso");
  assert.equal(resource.neon.endpoint_type, "default_read_write");
  assert.equal(resource.neon.endpoint, "direct_non_pooled_tls");
  assert.equal(resource.neon.pitr_days, 30);
  assert.equal(resource.neon.history_retention_seconds, 2592000);
  assert.equal(resource.neon.bootstrap_owner, `ushso_${resource.environment}_bootstrap`);
  assert.equal(resource.neon.bootstrap_worker_binding, false);
  sameMembers(resource.neon.worker_login_roles, EXPECTED_ROLES, "SQL-created Worker login roles");
  assert.equal(resource.neon.worker_login_creation, "audited_direct_sql_only");
  assert.equal(resource.neon.neon_api_worker_role_creation, false);
  assert.equal(resource.neon.attestation_max_validity_seconds, 900);
  assert.equal(resource.neon.compute_units.status, "selected_zero_traffic_configuration");
  sameMembers(resource.neon.hyperdrive_prebinding_attestation, [
    "environment_exact", "neon_project_id_exact", "neon_branch_id_exact", "neon_endpoint_id_exact", "direct_tls_host_exact",
    "verified_at_not_future_at_apply", "expires_at_not_past_at_apply", "validity_window_max_900_seconds",
    "template_sha256_exact", "evidence_sha256_recomputed_exact",
    "rolsuper_false", "rolbypassrls_false", "rolreplication_false", "rolcreatedb_false", "rolcreaterole_false",
    "capability_member_true", "neon_superuser_member_false", "unexpected_membership_false"
  ], "prebinding privilege assertions");
  if (resource.environment === "production") {
    assert.equal(resource.neon.scale_to_zero, "disabled");
    assert.equal(resource.neon.compute_units.minimum, 1);
    assert.equal(resource.neon.compute_units.maximum, 4);
    assert.equal(resource.neon.suspend_timeout_seconds, -1);
  } else {
    assert.equal(resource.neon.scale_to_zero, "enabled_after_300_seconds");
    assert.equal(resource.neon.compute_units.minimum, 0.25);
    assert.equal(resource.neon.compute_units.maximum, 2);
    assert.equal(resource.neon.suspend_timeout_seconds, 300);
  }

  assert.equal(resource.hyperdrive_semantic_profiles.length, 2);
  const correctnessProfile = resource.hyperdrive_semantic_profiles.find((item) => item.id === "correctness");
  const immutableProfile = resource.hyperdrive_semantic_profiles.find((item) => item.id === "immutable_read");
  assert.equal(correctnessProfile?.cache.disabled, true);
  assert.equal(immutableProfile?.cache.disabled, false);
  assert.equal(resource.hyperdrive_configs.length, 8);
  assert.deepEqual(duplicates(resource.hyperdrive_configs.map((item) => item.name)), []);
  assert.deepEqual(duplicates(resource.hyperdrive_configs.map((item) => item.id_placeholder)), []);
  const correctnessConfigs = resource.hyperdrive_configs.filter((item) => item.semantic_profile === "correctness");
  const immutableConfigs = resource.hyperdrive_configs.filter((item) => item.semantic_profile === "immutable_read");
  sameMembers(correctnessConfigs.map((item) => item.worker_role), EXPECTED_ROLES, "role-scoped correctness configs");
  sameMembers(immutableConfigs.map((item) => item.worker_role), ["public", "projector"], "immutable configs");
  for (const config of resource.hyperdrive_configs) {
    assert.equal(config.database_role, `ushso_${config.worker_role}`);
    assert.ok(config.name.startsWith(`${resource.resource_prefix}-${config.worker_role}-`));
    assert.equal(config.binding, config.semantic_profile === "correctness" ? "HD_CORRECTNESS" : "HD_IMMUTABLE_READ");
    assert.ok(Number.isInteger(config.candidate_origin_connection_limit));
    assert.ok(config.candidate_origin_connection_limit > 0);
  }
  const publicConfigs = resource.hyperdrive_configs.filter((item) => item.worker_role === "public");
  assert.ok(publicConfigs.every((item) => item.database_role === "ushso_public"));
  assert.ok(publicConfigs.flatMap((item) => item.allowed_operations).every((operation) =>
    !["write", "lease", "active_pointer_change", "canonical_proposal_write", "audited_control_write"].includes(operation)
  ));
  assert.equal(
    correctnessConfigs.reduce((sum, item) => sum + item.candidate_origin_connection_limit, 0),
    8,
    "correctness profile origin budget"
  );
  assert.equal(
    immutableConfigs.reduce((sum, item) => sum + item.candidate_origin_connection_limit, 0),
    12,
    "immutable-read profile origin budget"
  );

  assert.equal(resource.r2_buckets.length, 2);
  sameMembers(resource.r2_buckets.map((bucket) => bucket.purpose), ["capture", "archive"], "R2 purposes");
  for (const bucket of resource.r2_buckets) {
    assert.equal(bucket.public_access, false);
    assert.equal(bucket.custom_domain, null);
    assert.equal(bucket.content_addressed, true);
    assert.equal(bucket.automatic_lifecycle_deletion, false);
    assert.ok(bucket.name.startsWith(`${resource.resource_prefix}-`));
  }

  assert.equal(resource.queues.length, 5);
  for (const [stage, queueName, dlq, attempts, retries] of EXPECTED_QUEUES) {
    const queue = resource.queues.find((item) => item.stage === stage);
    assert.ok(queue, `missing ${stage}`);
    assert.equal(queue.name, queueName);
    assert.equal(queue.dead_letter_queue, dlq);
    assert.equal(queue.maximum_delivery_attempts, attempts);
    assert.equal(queue.transport_max_retries, retries);
    assert.equal(queue.transport_max_retries, queue.maximum_delivery_attempts - 1);
  }
  assert.equal(resource.dlq_sink.consumer_worker_role, "ops");
  sameMembers(resource.dlq_sink.applies_to, EXPECTED_DLQS, "DLQ sink queues");
  assert.equal(resource.dlq_sink.maximum_delivery_attempts, 6);
  assert.equal(resource.dlq_sink.transport_max_retries, 5);
  assert.deepEqual(resource.dlq_sink.retry_delays_seconds_by_retry, EXPECTED_DLQ_RETRY_DELAYS);
  assert.equal(resource.dlq_sink.wrangler_default_retry_delay_seconds, 30);
  assert.equal(resource.dlq_sink.max_batch_size, 1);
  assert.equal(resource.dlq_sink.max_batch_timeout_seconds, 5);
  assert.equal(resource.dlq_sink.max_concurrency, 1);
  assert.equal(resource.dlq_sink.acknowledgement, "ack_only_after_postgresql_durable_dead_letter_incident_transaction_commits");
  assert.equal(resource.dlq_sink.second_dead_letter_queue, null);
  assert.match(resource.dlq_sink.terminal_failure, /permanently_deletes/);
  assert.match(resource.dlq_sink.terminal_control, /postgresql_control_plane_ledger_and_evidence/);
  sameMembers(resource.dlq_sink.durability_contract_refs, [
    "contracts/ingestion/v1.0.0/schemas/event-ledger.schema.json",
    "db/migrations/0003_ops_outbox_processed_events_dead_letters.sql"
  ], "DLQ durability contracts");
  assert.equal(resource.workflow.binding, "HARVEST_WORKFLOW");
  assert.equal(resource.workflow.class_name, "HarvestWorkflow");
  for (const field of ["success_retention", "error_retention"]) {
    assert.match(resource.workflow[field], /^(?:[1-9]|[12][0-9]|30) days$/, `${field} must be an explicit 1-30 day duration`);
    assert.ok(Number.parseInt(resource.workflow[field], 10) <= 30, `${field} exceeds Cloudflare Workflows' paid-plan maximum`);
    assert.equal(resource.workflow[field], "30 days", `${field} must preserve the reviewed 30-day correctness fence`);
  }
  assert.equal(resource.cron.schedule_utc, "*/5 * * * *");
  assert.equal(resource.cron.database_slot_idempotency, true);
}

export function validateWorkerBindings(contract, secrets) {
  assert.equal(contract.global_rules.workers_dev, false);
  assert.deepEqual(contract.global_rules.routes, []);
  assert.equal(contract.global_rules.entrypoint_status, "inert_foundation_placeholder_not_live_wp4_composition");
  assert.equal(contract.global_rules.deployable_candidate, false);
  sameMembers(contract.global_rules.known_factories_not_entrypoints, [
    "services/scheduler-worker/index.mjs#createSchedulerWorker",
    "services/harvest-worker/index.mjs#createHarvestWorker",
    "services/harvest-worker/index.mjs#createCloudflareWorkflowPlatform",
    "services/harvest-worker/index.mjs#createHarvestWorkflowEntrypoint"
  ], "known WP4 factories");
  sameMembers(contract.global_rules.blocking_wp4_composition_artifacts, [
    "scheduler_default_handler_with_postgresql_control_store", "concrete_harvest_workflow_class",
    "harvest_queue_composition_root", "normalize_queue_composition_root",
    "projector_queue_composition_root", "ops_dlq_sink_composition_root"
  ], "missing WP4 composition roots");
  assert.equal(contract.global_rules.node_client, "pg");
  sameMembers(contract.global_rules.required_compatibility_flags, ["nodejs_compat_v2"], "pg compatibility flags");
  assert.equal(contract.global_rules.workflow_connection_rule, "fresh_client_inside_each_step_do");
  assert.equal(contract.global_rules.dlq_sink_rule, "ops_ack_only_after_postgresql_incident_commit_initial_plus_five_deliveries_no_recursive_dlq");
  sameMembers(contract.workers.map((worker) => worker.role), EXPECTED_ROLES, "Worker roles");
  assert.deepEqual(duplicates(contract.workers.map((worker) => worker.role)), []);

  const byRole = Object.fromEntries(contract.workers.map((worker) => [worker.role, worker]));
  const expectedBindings = {
    public: {
      hyperdrive: ["HD_CORRECTNESS", "HD_IMMUTABLE_READ"], r2: [], producers: [], consumers: [], workflows: [], cron: [], secrets: []
    },
    scheduler: {
      hyperdrive: ["HD_CORRECTNESS"], r2: [], producers: ["HARVEST_PAGE_QUEUE"], consumers: [], workflows: ["HARVEST_WORKFLOW"], cron: ["*/5 * * * *"], secrets: []
    },
    harvest: {
      hyperdrive: ["HD_CORRECTNESS"], r2: ["R2_CAPTURE"], producers: ["NORMALIZE_RECORD_QUEUE"], consumers: ["harvest-page"], workflows: [], cron: [], secrets: ["SOURCE_AUTH_BROKER_TOKEN"]
    },
    normalize: {
      hyperdrive: ["HD_CORRECTNESS"], r2: ["R2_CAPTURE"], producers: ["ENRICH_SCHEMA_QUEUE", "ACCESS_CHECK_QUEUE", "PROJECT_INDEX_QUEUE"], consumers: ["normalize-record", "enrich-schema", "access-check"], workflows: [], cron: [], secrets: []
    },
    projector: {
      hyperdrive: ["HD_CORRECTNESS", "HD_IMMUTABLE_READ"], r2: [], producers: [], consumers: ["project-index"], workflows: [], cron: [], secrets: []
    },
    ops: {
      hyperdrive: ["HD_CORRECTNESS"], r2: ["R2_ARCHIVE"], producers: ["HARVEST_PAGE_QUEUE", "NORMALIZE_RECORD_QUEUE", "ENRICH_SCHEMA_QUEUE", "ACCESS_CHECK_QUEUE", "PROJECT_INDEX_QUEUE"], consumers: ["harvest-page-dlq", "normalize-record-dlq", "enrich-schema-dlq", "access-check-dlq", "project-index-dlq"], workflows: ["HARVEST_WORKFLOW"], cron: [], secrets: ["OPS_AUDIT_HMAC_KEY", "OPS_ACCESS_AUD"]
    }
  };
  for (const [role, expected] of Object.entries(expectedBindings)) {
    const worker = byRole[role];
    sameMembers(worker.hyperdrive, expected.hyperdrive, `${role} Hyperdrive bindings`);
    sameMembers(worker.r2, expected.r2, `${role} R2 bindings`);
    sameMembers(worker.queue_producers, expected.producers, `${role} Queue producers`);
    sameMembers(worker.queue_consumers, expected.consumers, `${role} Queue consumers`);
    sameMembers(worker.workflows, expected.workflows, `${role} Workflow bindings`);
    sameMembers(worker.cron, expected.cron, `${role} Cron bindings`);
    sameMembers(worker.secret_names, expected.secrets, `${role} Worker secrets`);
  }
  assert.ok(byRole.public.denied.includes("connector_credentials"));
  assert.ok(byRole.public.denied.includes("canonical_write"));
  assert.ok(byRole.ops.denied.includes("unauthenticated_access"));

  assert.equal(secrets.contains_secret_values, false);
  assert.equal(secrets.terraform_generated_sensitive_values.length, 1);
  assert.match(secrets.terraform_generated_sensitive_values[0].path, /neon_project\.this\.database_password/);
  assert.doesNotMatch(JSON.stringify(secrets.terraform_generated_sensitive_values), /neon_role/);
  assert.equal(secrets.sql_created_worker_credentials.count_per_environment, 6);
  assert.equal(secrets.sql_created_worker_credentials.input_name, "TF_VAR_database_origins");
  assert.equal(secrets.sql_created_worker_credentials.api_role_creation, "prohibited_neon_superuser_membership_risk");
  assert.equal(secrets.sql_created_worker_credentials.raw_password_worker_binding, false);
  assert.ok(secrets.deployment_environment_names.some((item) => item.name === "TF_VAR_database_origins"));
  assert.ok(secrets.deployment_environment_names.some((item) => item.name === "TF_VAR_database_origin_attestation"));
  const declaredWorkerSecrets = new Set(secrets.worker_secret_names.map((item) => `${item.worker}:${item.name}`));
  for (const worker of contract.workers) {
    for (const name of worker.secret_names) {
      assert.ok(declaredWorkerSecrets.has(`${worker.role}:${name}`), `undeclared Worker secret ${worker.role}:${name}`);
    }
    for (const forbidden of secrets.forbidden_worker_bindings) {
      assert.ok(!worker.secret_names.includes(forbidden), `forbidden Worker secret ${forbidden}`);
    }
  }
}

function validateQueueWorkflowContract(contract, resource) {
  const envelopeFields = queueControlEnvelopeFields();
  assert.equal(contract.schema_version, "ushso-queue-workflow-contract.v1.1.0");
  assert.equal(contract.delivery_semantics, "at_least_once");
  assert.equal(contract.retry_rule, "transport_max_retries_equals_maximum_delivery_attempts_minus_one");
  assert.equal(contract.message_body.contract_version, "ingestion.v1.0.0");
  assert.deepEqual(contract.message_body.top_level_allowed, envelopeFields.topLevel);
  assert.deepEqual(contract.message_body.references_allowed, envelopeFields.references);
  assert.deepEqual(contract.message_body.delivery_fence_allowed, ["lease_epoch", "run_attempt"]);
  for (const forbidden of ["payload", "body", "row", "query", "healthcare", "market_share", "authorization", "secret", "token", "credential"]) {
    assert.ok(contract.message_body.forbidden.includes(forbidden));
  }
  assert.ok(contract.message_body.forbidden.includes("public_question"));
  assert.deepEqual(contract.dlq_sink, resource.dlq_sink);
  assert.equal(contract.dlq_sink.maximum_delivery_attempts, contract.dlq_sink.transport_max_retries + 1);
  assert.deepEqual(contract.dlq_sink.retry_delays_seconds_by_retry, EXPECTED_DLQ_RETRY_DELAYS);
  assert.equal(contract.dlq_sink.second_dead_letter_queue, null);
  assert.match(contract.dlq_sink.acknowledgement, /after_postgresql.*commits/);
  assert.match(contract.dlq_sink.terminal_failure, /permanently_deletes/);
  assert.match(contract.dlq_sink.terminal_control, /postgresql_control_plane_ledger_and_evidence/);
  assert.equal(contract.queues.length, 5);
  for (const [stage, queueName, dlq, attempts, retries] of EXPECTED_QUEUES) {
    const item = contract.queues.find((queue) => queue.stage === stage);
    assert.ok(item);
    assert.equal(item.queue, queueName);
    assert.equal(item.dlq, dlq);
    assert.equal(item.maximum_delivery_attempts, attempts);
    assert.equal(item.transport_max_retries, retries);
    const resourceQueue = resource.queues.find((queue) => queue.stage === stage);
    assert.equal(resourceQueue.name, item.queue);
    assert.equal(resourceQueue.dead_letter_queue, item.dlq);
    assert.equal(resourceQueue.transport_max_retries, item.transport_max_retries);
  }
  assert.deepEqual(contract.workflow.deterministic_instance_id, {
    format: "harvest-{run_id}-{positive_attempt}",
    run_id_pattern: "^run_[a-f0-9]{32}$",
    provider_pattern: "^[A-Za-z0-9_][A-Za-z0-9_-]*$",
    maximum_length: 100,
    example: "harvest-run_0123456789abcdef0123456789abcdef-1"
  });
  assert.equal(workflowInstanceId("run_0123456789abcdef0123456789abcdef", 1), contract.workflow.deterministic_instance_id.example);
  assert.equal(contract.workflow.database_client_lifetime, "one_fresh_pg_client_per_step_do");
  assert.equal(contract.cron.schedule, "*/5 * * * *");
  assert.equal(contract.cron.timezone, "UTC");
  assert.match(contract.cron.deduplication, /database_dispatch_slot/);
}

function validateProviderToolchain(root, toolchain, capabilityReview) {
  assert.equal(toolchain.terraform_cli.constraint, "= 1.16.0");
  assert.equal(toolchain.terraform_cli.release_date, "2026-08-26");
  const providerPins = Object.fromEntries(toolchain.providers.map((provider) => [provider.name, provider]));
  assert.equal(providerPins.cloudflare.source, "cloudflare/cloudflare");
  assert.equal(providerPins.cloudflare.constraint, "= 5.24.0");
  assert.equal(providerPins.cloudflare.release_date, "2026-08-24");
  assert.equal(providerPins.neon.source, "kislerdm/neon");
  assert.equal(providerPins.neon.constraint, "= 0.15.0");
  assert.equal(providerPins.neon.release_date, "2026-08-01");
  assert.ok(toolchain.providers.every((provider) => provider.registry_resolution === "backend_false_local_schema_pass"));
  assert.deepEqual(toolchain.terraform_provider_schema_validation.roots, [
    "infra/terraform/environments/staging",
    "infra/terraform/environments/production"
  ]);
  assert.equal(toolchain.terraform_provider_schema_validation.init.backend, false);
  assert.equal(toolchain.terraform_provider_schema_validation.init.credentials_used, false);
  assert.equal(toolchain.terraform_provider_schema_validation.init.state_created, false);
  assert.deepEqual(toolchain.terraform_provider_schema_validation.validate_json, {
    valid: true,
    error_count: 0,
    warning_count: 0
  });
  assert.equal(toolchain.terraform_provider_schema_validation.plan_run, false);
  assert.equal(toolchain.terraform_provider_schema_validation.apply_run, false);
  assert.equal(toolchain.terraform_provider_schema_validation.resources_created, false);
  assert.equal(toolchain.terraform_locks.status, "generated_by_successful_backend_false_init");
  assert.equal(toolchain.terraform_locks.identical, true);
  assert.equal(toolchain.terraform_locks.sha256, "0a46170a37dbe106fedb46435dcd9a6ed132ab69cc64ac8eb34a121e7da8700a");
  assert.deepEqual(toolchain.terraform_locks.paths, [
    "infra/terraform/environments/staging/.terraform.lock.hcl",
    "infra/terraform/environments/production/.terraform.lock.hcl"
  ]);
  for (const relativeLock of toolchain.terraform_locks.paths) {
    const lock = path.join(root, relativeLock);
    assert.equal(digest(lock), toolchain.terraform_locks.sha256);
    const contents = fs.readFileSync(lock, "utf8");
    assert.match(contents, /provider "registry\.terraform\.io\/cloudflare\/cloudflare"/);
    assert.match(contents, /version\s*=\s*"5\.24\.0"/);
    assert.match(contents, /provider "registry\.terraform\.io\/kislerdm\/neon"/);
    assert.match(contents, /version\s*=\s*"0\.15\.0"/);
    assert.match(contents, /h1:[A-Za-z0-9+/=]+/);
    assert.match(contents, /zh:[a-f0-9]{64}/);
    assert.doesNotMatch(contents, /registry\.terraform\.io\/hashicorp\/(?:cloudflare|neon)/);
  }
  const wranglerPackage = path.join(root, "node_modules", "wrangler", "package.json");
  const wranglerSchema = path.join(root, "node_modules", "wrangler", "config-schema.json");
  assert.equal(readJson(wranglerPackage).version, toolchain.wrangler.version);
  assert.equal(digest(wranglerPackage), toolchain.wrangler.package_manifest_sha256);
  assert.equal(digest(wranglerSchema), toolchain.wrangler.config_schema_sha256);
  assert.equal(capabilityReview.status, "pending_external_authorization");
  assert.equal(capabilityReview.authorization, "AUTH-01");
  assert.equal(capabilityReview.selected_architecture.hyperdrive_origin, "direct non-pooled PostgreSQL endpoint over TLS");
  assert.equal(capabilityReview.selected_architecture.production_scale_to_zero, false);
  assert.equal(capabilityReview.selected_architecture.target_pitr_days, 30);
  assert.equal(capabilityReview.pinned_configuration.provider_init_validate, "local_backend_false_schema_pass_no_credentials_state_plan_apply_or_resources");
  assert.equal(capabilityReview.selected_architecture.worker_login_creation, "audited_direct_sql_only_never_neon_api_console_cli_or_neon_role");
  assert.match(capabilityReview.selected_architecture.prebinding_catalog_gate, /zero_neon_superuser/);
  assert.match(capabilityReview.selected_architecture.prebinding_catalog_gate, /apply_time/);
  assert.match(capabilityReview.selected_architecture.prebinding_catalog_gate, /endpoint_direct_host/);
  assert.match(capabilityReview.selected_architecture.prebinding_catalog_gate, /recomputed_evidence/);
  assert.match(capabilityReview.selected_architecture.attestation_connection_source, /terraform_outputs_without_cli_overrides/);
  assert.equal(capabilityReview.security_deviation_2026_08_30.primary_source, "https://neon.com/docs/reference/compatibility");
  assert.equal(capabilityReview.security_deviation_2026_08_30.endpoint_primary_source, "https://neon.com/docs/manage/endpoints/");
  assert.equal(capabilityReview.workflow_limits_review_2026_08_30.primary_source, "https://developers.cloudflare.com/workflows/reference/limits/");
  assert.equal(capabilityReview.workflow_limits_review_2026_08_30.source_updated_at, "2026-06-15");
  assert.equal(capabilityReview.workflow_limits_review_2026_08_30.completed_state_retention_max_days_paid, 30);
  assert.equal(capabilityReview.workflow_limits_review_2026_08_30.selected_success_retention_days, 30);
  assert.equal(capabilityReview.workflow_limits_review_2026_08_30.selected_error_retention_days, 30);
  assert.match(capabilityReview.security_deviation_2026_08_30.rejected_design, /neon_role/);
  const adr = fs.readFileSync(path.join(root, "docs", "adr", "0004-postgresql-cloudflare-and-immutable-publication.md"), "utf8");
  assert.match(adr, /2026-08-30 security addendum: Worker-login creation/);
  assert.match(adr, /neon\.com\/docs\/reference\/compatibility/);
  assert.match(adr, /six-`neon_role` design is[\s\S]*rejected/);
  assert.match(adr, /No Worker credential is bindable to Hyperdrive until/);
}

function validateDatabaseRoleAlignment(root, ...resources) {
  const matrix = readJson(path.join(root, "db", "bootstrap", "role-matrix.v1.json"));
  const workerDatabaseRoles = EXPECTED_ROLES.map((role) => `ushso_${role}`);
  for (const role of [...workerDatabaseRoles, "ushso_maintenance"]) {
    assert.ok(matrix.roles[role], `database role matrix missing ${role}`);
  }
  assert.ok(matrix.roles.ushso_public.deny.includes("publication_write"));
  assert.ok(matrix.roles.ushso_maintenance.deny.includes("worker_binding"));
  for (const resource of resources) {
    sameMembers(
      new Set(resource.hyperdrive_configs.map((config) => config.database_role)),
      workerDatabaseRoles,
      `${resource.environment} Hyperdrive/database roles`
    );
    assert.ok(resource.hyperdrive_configs.every((config) => config.database_role !== "ushso_maintenance"));
  }
}

export function validateDatabaseOriginAttestation(attestation, environment, binding) {
  assert.ok(ENVIRONMENTS.includes(environment));
  assert.equal(attestation.environment, environment);
  assert.equal(attestation.neon_project_id, binding.projectId);
  assert.equal(attestation.neon_branch_id, binding.branchId);
  assert.equal(attestation.neon_endpoint_id, binding.endpointId);
  assert.equal(attestation.direct_host, binding.directHost);
  assert.doesNotMatch(attestation.direct_host, /(^|[.-])pooler([.-]|$)/);
  assert.match(attestation.verified_at_utc, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/);
  assert.match(attestation.expires_at_utc, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/);
  const verifiedAt = Date.parse(attestation.verified_at_utc);
  const expiresAt = Date.parse(attestation.expires_at_utc);
  const applyAt = Date.parse(binding.applyTimestamp);
  assert.ok(Number.isFinite(verifiedAt));
  assert.ok(Number.isFinite(expiresAt));
  assert.ok(Number.isFinite(applyAt));
  assert.ok(expiresAt > verifiedAt);
  assert.ok(expiresAt - verifiedAt <= 15 * 60 * 1000);
  assert.ok(applyAt >= verifiedAt, "future attestation at apply time");
  assert.ok(applyAt <= expiresAt, "expired attestation at apply time");
  assert.match(attestation.template_sha256, /^[a-f0-9]{64}$/);
  assert.match(attestation.evidence_sha256, /^[a-f0-9]{64}$/);
  sameMembers(Object.keys(attestation.roles), EXPECTED_ROLES, "attested database logins");
  for (const role of EXPECTED_ROLES) {
    const value = attestation.roles[role];
    assert.equal(value.database_role, `ushso_${role}`);
    assert.equal(value.login_user, `ushso_${environment}_${role}_login`);
    assert.equal(value.rolsuper, false);
    assert.equal(value.rolbypassrls, false);
    assert.equal(value.rolreplication, false);
    assert.equal(value.rolcreatedb, false);
    assert.equal(value.rolcreaterole, false);
    assert.equal(value.capability_member, true);
    assert.equal(value.neon_superuser_member, false);
    assert.equal(value.unexpected_membership, false);
  }
  assert.equal(attestation.evidence_sha256, attestationEvidenceSha256(attestation), "attestation evidence digest mismatch");
}

function validateAuthorizationRegister(root) {
  const register = readJson(path.join(root, "verification", "external-authorization", "v1.0.0", "register.json"));
  const byId = Object.fromEntries(register.entries.map((entry) => [entry.id, entry]));
  for (const id of ["AUTH-01", "AUTH-02", "AUTH-03", "AUTH-05", "AUTH-11"]) {
    assert.ok(byId[id], `authorization register missing ${id}`);
    assert.equal(byId[id].authorized, false, `${id} unexpectedly authorized`);
    assert.equal(byId[id].status, "not_requested", `${id} status changed; receipts require review`);
  }
  assert.equal(byId["AUTH-11"].environment, "production_foundation_no_traffic");
  assert.match(byId["AUTH-11"].action, /zero-traffic production foundation/);
}

export function validateObservability(contract) {
  assert.equal(contract.event_fields.length, 14);
  sameMembers(contract.event_fields.map((field) => field.name), EXPECTED_EVENT_FIELDS, "event fields");
  assert.equal(contract.alerts.length, 13);
  sameMembers(contract.alerts.map((alert) => alert.id), EXPECTED_ALERTS, "alerts");
  assert.equal(contract.slos.length, 11);
  sameMembers(contract.slos.map((slo) => slo.id), EXPECTED_SLOS, "SLOs");
  for (const alert of contract.alerts) {
    assert.equal(alert.managed_status, "pending_external_authorization");
    assert.match(alert.runbook, /^ALERT-\d{2}$/);
  }
  const dlqAlert = contract.alerts.find((alert) => alert.id === "dlq_nonempty");
  assert.match(dlqAlert.signal, /sink_final_failed_delivery/);
  assert.match(dlqAlert.terminal_sink_failure_control, /postgresql_control_plane_ledger_and_evidence/);
  assert.ok(contract.privacy.forbidden.includes("public_question_text"));
  assert.ok(contract.privacy.forbidden.includes("credential"));
}

export function validateRecovery(controls, drills) {
  assert.equal(controls.controls.length, 8);
  sameMembers(controls.controls.map((control) => control.id), EXPECTED_RECOVERY_CONTROLS, "recovery controls");
  for (const control of controls.controls) {
    assert.equal(control.audit_required, true);
    assert.match(control.runbook, /^REC-\d{2}$/);
  }
  assert.ok(controls.invariants.includes("no_destructive_down_migration"));
  assert.equal(drills.local_configuration_status, "pass");
  assert.equal(drills.managed_rehearsal_status, "pending_external_authorization");
  assert.equal(drills.authorization, "AUTH-05");
  assert.equal(drills.objectives.rpo_seconds_max, 300);
  assert.equal(drills.objectives.rto_seconds_max, 1800);
  assert.ok(drills.drills.every((drill) => drill.status === "pending_external_authorization"));
}

function validateJsonSchemas(root, candidate) {
  const schemaDir = path.join(root, "infra", "capacity", "schemas");
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const sections = [
    ["workload.schema.json", candidate.workload],
    ["connection-budget.schema.json", candidate.connection_budget],
    ["storage-io.schema.json", candidate.storage_io],
    ["queue-capacity.schema.json", candidate.queue_capacity]
  ];
  for (const [schemaFile, value] of sections) {
    const validate = ajv.compile(readJson(path.join(schemaDir, schemaFile)));
    assert.ok(validate(value), `${schemaFile}: ${ajv.errorsText(validate.errors)}`);
  }
}

export function validateCapacity(root, candidate) {
  validateJsonSchemas(root, candidate);
  const mixTotal = Object.values(candidate.workload.public.route_mix).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(mixTotal - 1) < 1e-9, `route mix must total 1, got ${mixTotal}`);
  const allocationTotal = candidate.connection_budget.allocations.reduce(
    (sum, item) => sum + item.maximum_origin_connections,
    0
  );
  assert.equal(allocationTotal, candidate.connection_budget.totals.allocated_origin_connections);
  const headroom =
    (candidate.connection_budget.totals.required_provider_cap - allocationTotal) /
    candidate.connection_budget.totals.required_provider_cap;
  assert.ok(headroom >= candidate.connection_budget.totals.minimum_headroom_ratio);
  for (const stage of candidate.queue_capacity.stages) {
    assert.equal(stage.two_x_messages_per_minute, stage.candidate_messages_per_minute * 2);
  }
  assert.deepEqual(duplicates(candidate.queue_capacity.stages.map((stage) => stage.stage)), []);
  assert.equal(candidate.workload.source.contains_raw_questions, false);
  assert.equal(candidate.workload.source.contains_user_identifiers, false);
  assert.equal(candidate.workload.load_test.status, "pending_external_authorization");
}

function validateResourceCapacityAlignment(resource, candidate) {
  const allocations = Object.fromEntries(
    candidate.connection_budget.allocations.map((item) => [item.consumer, item.maximum_origin_connections])
  );
  const correctness = resource.hyperdrive_configs
    .filter((item) => item.semantic_profile === "correctness")
    .reduce((sum, item) => sum + item.candidate_origin_connection_limit, 0);
  const immutable = resource.hyperdrive_configs
    .filter((item) => item.semantic_profile === "immutable_read")
    .reduce((sum, item) => sum + item.candidate_origin_connection_limit, 0);
  assert.equal(correctness, allocations.hyperdrive_correctness);
  assert.equal(immutable, allocations.hyperdrive_immutable_read);
  for (const queue of resource.queues) {
    const stage = candidate.queue_capacity.stages.find((item) => item.stage === queue.stage);
    assert.ok(stage, `capacity candidate missing ${queue.stage}`);
    assert.equal(queue.max_batch_size, stage.max_batch_size);
    assert.equal(queue.max_concurrency, stage.max_concurrency);
  }
}

function stripHclCommentsAndStrings(source) {
  let output = "";
  let string = false;
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") { lineComment = false; output += "\n"; }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (string) {
      if (escape) { escape = false; continue; }
      if (char === "\\") { escape = true; continue; }
      if (char === '"') { string = false; }
      continue;
    }
    if (char === "#" || (char === "/" && next === "/")) { lineComment = true; index += char === "/" ? 1 : 0; continue; }
    if (char === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (char === '"') { string = true; continue; }
    output += char;
  }
  assert.equal(string, false, "unterminated HCL string");
  assert.equal(blockComment, false, "unterminated HCL block comment");
  return output;
}

function validateBalancedHcl(source, file) {
  const stripped = stripHclCommentsAndStrings(source);
  const pairs = { "{": "}", "[": "]", "(": ")" };
  const closers = new Set(Object.values(pairs));
  const stack = [];
  for (const char of stripped) {
    if (pairs[char]) stack.push(pairs[char]);
    else if (closers.has(char)) assert.equal(stack.pop(), char, `${file}: mismatched delimiter`);
  }
  assert.deepEqual(stack, [], `${file}: unterminated delimiter`);
}

function walkFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(target));
    else result.push(target);
  }
  return result;
}

export function validateTerraformStatic(root) {
  const terraformRoot = path.join(root, "infra", "terraform");
  const tfFiles = walkFiles(terraformRoot).filter((file) => file.endsWith(".tf"));
  assert.ok(tfFiles.length >= 9);
  for (const file of tfFiles) validateBalancedHcl(fs.readFileSync(file, "utf8"), path.relative(root, file));

  for (const environment of ENVIRONMENTS) {
    const versions = fs.readFileSync(path.join(terraformRoot, "environments", environment, "versions.tf"), "utf8");
    assert.match(versions, /required_version\s*=\s*"= 1\.16\.0"/);
    assert.match(versions, /source\s*=\s*"cloudflare\/cloudflare"[\s\S]*version\s*=\s*"= 5\.24\.0"/);
    assert.match(versions, /source\s*=\s*"kislerdm\/neon"[\s\S]*version\s*=\s*"= 0\.15\.0"/);
    assert.match(versions, /backend\s+"s3"\s*\{\}/);
  }

  const foundationVersions = fs.readFileSync(path.join(terraformRoot, "modules", "foundation", "versions.tf"), "utf8");
  const neonVersions = fs.readFileSync(path.join(terraformRoot, "modules", "neon-foundation", "versions.tf"), "utf8");
  assert.match(foundationVersions, /required_version\s*=\s*"= 1\.16\.0"/);
  assert.match(foundationVersions, /source\s*=\s*"cloudflare\/cloudflare"[\s\S]*version\s*=\s*"= 5\.24\.0"/);
  assert.doesNotMatch(foundationVersions, /hashicorp\/cloudflare/);
  assert.match(neonVersions, /required_version\s*=\s*"= 1\.16\.0"/);
  assert.match(neonVersions, /source\s*=\s*"kislerdm\/neon"[\s\S]*version\s*=\s*"= 0\.15\.0"/);
  assert.doesNotMatch(neonVersions, /hashicorp\/neon/);

  const stagingBackend = fs.readFileSync(path.join(terraformRoot, "environments", "staging", "backend.hcl.example"), "utf8");
  const productionBackend = fs.readFileSync(path.join(terraformRoot, "environments", "production", "backend.hcl.example"), "utf8");
  assert.match(stagingBackend, /ushso\/staging\/wp3-foundation\.tfstate/);
  assert.match(productionBackend, /ushso\/production\/wp3-foundation\.tfstate/);
  assert.notEqual(stagingBackend, productionBackend);
  const stagingExample = fs.readFileSync(path.join(terraformRoot, "environments", "staging", "terraform.tfvars.example"), "utf8");
  const productionExample = fs.readFileSync(path.join(terraformRoot, "environments", "production", "terraform.tfvars.example"), "utf8");
  assert.match(stagingExample, new RegExp(digest(path.join(root, "infra", "cloudflare", "manifests", "resources.staging.json"))));
  assert.match(productionExample, new RegExp(digest(path.join(root, "infra", "cloudflare", "manifests", "resources.production.json"))));
  const activeHcl = tfFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(activeHcl, /hashicorp\/(?:cloudflare|neon)/);
  assert.doesNotMatch(activeHcl, /resource\s+"cloudflare_(?:dns_record|workers_route|workers_custom_domain)"/);
  assert.match(activeHcl, /caching\s*=\s*merge\(/);
  assert.match(activeHcl, /hyperdrive_profiles\[each\.value\.semantic_profile\]\.cache\.disabled/);
  assert.match(activeHcl, /origin_connection_limit\s*=\s*each\.value\.candidate_origin_connection_limit/);
  assert.match(activeHcl, /resource\s+"cloudflare_queue"\s+"stage"[\s\S]*queue_name\s*=\s*"\$\{local\.prefix\}-\$\{each\.value\}"/);
  assert.match(activeHcl, /prevent_destroy\s*=\s*true/);
  assert.match(activeHcl, /filesha256\(var\.resource_manifest_path\)/);
  assert.match(activeHcl, /database_origins/);
  assert.match(activeHcl, /origin\.database_role\s*==\s*"ushso_\$\{role\}"/);
  assert.match(activeHcl, /length\(distinct\(\[for origin in values\(var\.database_origins\)/);
  assert.match(activeHcl, /resource\s+"neon_project"\s+"this"/);
  assert.doesNotMatch(activeHcl, /resource\s+"neon_role"/);
  assert.match(activeHcl, /store_password\s*=\s*"yes"/);
  assert.match(activeHcl, /history_retention_seconds\s*=\s*var\.history_retention_seconds/);
  assert.match(activeHcl, /default_endpoint_settings\s*\{/);
  assert.match(activeHcl, /suspend_timeout_seconds\s*=\s*var\.endpoint_policy\.suspend_timeout_seconds/);
  assert.match(activeHcl, /default_branch_protected\s*=\s*true/);
  assert.match(activeHcl, /database_origin_attestation/);
  assert.match(activeHcl, /neon_superuser_member/);
  assert.match(activeHcl, /rolbypassrls/);
  assert.match(activeHcl, /attestation_template_sha256/);
  assert.match(activeHcl, /timecmp\(timestamp\(\), var\.database_origin_attestation\.verified_at_utc\)/);
  assert.match(activeHcl, /timecmp\(timestamp\(\), var\.database_origin_attestation\.expires_at_utc\)/);
  assert.doesNotMatch(activeHcl, /plantimestamp\(\)/);
  assert.match(activeHcl, /timeadd\(var\.database_origin_attestation\.verified_at_utc, "15m"\)/);
  assert.match(activeHcl, /database_origin_attestation\.evidence_sha256\s*==\s*local\.attestation_evidence_sha256/);
  assert.match(activeHcl, /database_origin_attestation\.neon_project_id\s*==\s*var\.neon_project_id/);
  assert.match(activeHcl, /database_origin_attestation\.neon_branch_id\s*==\s*var\.neon_branch_id/);
  assert.match(activeHcl, /database_origin_attestation\.neon_endpoint_id\s*==\s*var\.neon_endpoint_id/);
  assert.match(activeHcl, /database_origin_attestation\.direct_host\s*==\s*var\.neon_direct_host/);
  assert.doesNotMatch(activeHcl, /worker_database_origins/);

  const neonModule = path.join(terraformRoot, "modules", "neon-foundation");
  const grants = fs.readFileSync(path.join(neonModule, "bootstrap-role-grants.sql.tftpl"), "utf8");
  const attestation = fs.readFileSync(path.join(neonModule, "prebinding-attestation.sql.tftpl"), "utf8");
  const attestationRunner = fs.readFileSync(path.join(neonModule, "run-prebinding-attestation.mjs"), "utf8");
  assert.equal((grants.match(/CREATE ROLE %I LOGIN/g) ?? []).length, 6);
  assert.equal((grants.match(/REVOKE neon_superuser FROM/g) ?? []).length, 6);
  assert.equal((grants.match(/GRANT ushso_(?:public|scheduler|harvest|normalize|projector|ops) TO/g) ?? []).length, 6);
  assert.doesNotMatch(grants, /PASSWORD\s+'[^']+'/i);
  for (const attribute of ["rolsuper", "rolbypassrls", "rolreplication", "rolcreatedb", "rolcreaterole"]) {
    assert.match(attestation, new RegExp(attribute));
  }
  assert.match(attestation, /neon_superuser/);
  assert.match(attestation, /unexpected_membership/);
  assert.match(attestation, /bootstrap_maintenance_member/);
  assert.match(attestation, /temporal_attestation_pass/);
  assert.match(attestation, /USHSO_ATTESTATION_ENVELOPE/);
  assert.match(attestation, /jsonb_object_agg\(/);
  assert.match(attestation, /expected\(role_key, login_user, database_role\)/);
  assert.doesNotMatch(attestation, /jsonb_agg\(to_jsonb\(role_state\)/);
  assert.match(attestation, /ushso-database-origin-attestation\.v1/);
  assert.match(attestation, /USHSO_ATTESTATION_MATERIAL_BASE64/);
  assert.match(attestation, /neon_endpoint_id/);
  assert.match(attestation, /direct_host/);
  assert.match(attestation, /neon_project_id/);
  assert.match(attestation, /neon_branch_id/);
  assert.match(attestation, /pg_stat_ssl/);
  assert.match(attestation, /\\quit 3/);
  assert.match(attestation, /\\quit 4/);
  assert.match(attestation, /\\quit 5/);
  assert.match(attestationRunner, /terraformOutput\(environmentRoot, 'neon_bootstrap_maintenance_connection'\)/);
  assert.match(attestationRunner, /terraformOutput\(environmentRoot, 'neon_bootstrap_contract'\)/);
  assert.match(attestationRunner, /PGSSLMODE: 'verify-full'/);
  assert.match(attestationRunner, /--host=\$\{connection\.direct_host\}/);
  assert.match(attestationRunner, /attestationEvidenceSha256\(envelope\)/);
  assert.doesNotMatch(attestationRunner, /--host[^\n]*argv|--project[^\n]*argv|--branch[^\n]*argv|--endpoint[^\n]*argv/);
}

export function validateEnvironmentFence(root, staging, production) {
  const stagedNames = new Set([
    ...staging.r2_buckets.map((item) => item.name),
    ...staging.hyperdrive_configs.map((item) => item.name),
    ...staging.queues.flatMap((item) => [item.name, item.dead_letter_queue]).map((name) => `${staging.resource_prefix}-${name}`),
    staging.workflow.name
  ]);
  const productionNames = new Set([
    ...production.r2_buckets.map((item) => item.name),
    ...production.hyperdrive_configs.map((item) => item.name),
    ...production.queues.flatMap((item) => [item.name, item.dead_letter_queue]).map((name) => `${production.resource_prefix}-${name}`),
    production.workflow.name
  ]);
  assert.deepEqual([...stagedNames].filter((name) => productionNames.has(name)), []);
  assert.ok([...stagedNames].every((name) => name.startsWith("ushso-staging-")));
  assert.ok([...productionNames].every((name) => name.startsWith("ushso-production-")));

  const stagingFiles = walkFiles(path.join(root, "infra", "terraform", "environments", "staging"));
  const productionFiles = walkFiles(path.join(root, "infra", "terraform", "environments", "production"));
  const stagingText = stagingFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const productionText = productionFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(stagingText, /ushso-production|REPLACE_PRODUCTION|ushso\/production\//);
  assert.doesNotMatch(productionText, /ushso-staging|REPLACE_STAGING|ushso\/staging\//);
}

function validateNoSecrets(root) {
  const infraFiles = walkFiles(path.join(root, "infra")).filter((file) => !file.endsWith(".md"));
  for (const file of infraFiles) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
    assert.doesNotMatch(text, /\b(?:postgres(?:ql)?|mysql):\/\/[^\s/@:]+:[^\s/@]+@/i);
    assert.doesNotMatch(text, /\b(?:sk_live|sk_test|ghp|xox[baprs])-[-A-Za-z0-9_]{16,}\b/);
  }
  const forbiddenArtifacts = walkFiles(path.join(root, "infra", "terraform")).filter((file) =>
    /(?:\.tfstate(?:\.|$)|\.tfplan$|\.plan\.json$|\/terraform\.tfvars$|\/backend\.hcl$)/.test(file)
  );
  assert.deepEqual(forbiddenArtifacts, [], "unredacted Terraform artifact committed under infra");
}

function validateJsonSyntax(root) {
  const scopedDirectories = [
    path.join(root, "infra"),
    path.join(root, "verification", "wp3", "v1.0.0", "infra")
  ];
  for (const directory of scopedDirectories) {
    for (const file of walkFiles(directory).filter((candidate) => candidate.endsWith(".json"))) {
      assert.doesNotThrow(() => readJson(file), `${path.relative(root, file)} is not valid JSON`);
    }
  }
  for (const receipt of EXPECTED_RECEIPTS) {
    const file = path.join(root, "verification", "wp3", "v1.0.0", "receipts", receipt);
    assert.doesNotThrow(() => readJson(file), `${receipt} is not valid JSON`);
  }
}

function validateWrangler(root, workerContract) {
  assert.deepEqual(checkRendered(root), []);
  const wranglerSchema = readJson(path.join(root, "node_modules", "wrangler", "config-schema.json"));
  const validate = new Ajv({ strict: false, allErrors: true, validateFormats: false }).compile(wranglerSchema);
  const expected = expectedRenderedFiles(root);
  assert.equal(expected.size, 12);
  for (const [file] of expected) {
    const config = readJson(file);
    assert.ok(validate(config), `${path.relative(root, file)}: ${JSON.stringify(validate.errors)}`);
    assert.equal(config.workers_dev, false);
    assert.deepEqual(config.routes, []);
    assert.equal(config.vars.FOUNDATION_INERT, "true");
    sameMembers(config.compatibility_flags, workerContract.global_rules.required_compatibility_flags, "Wrangler compatibility flags");
    assert.doesNotMatch(JSON.stringify(config), /CLOUDFLARE_API_TOKEN|NEON_API_KEY|NEON_[A-Z_]+_PASSWORD|TF_VAR_database_origins/);
    const role = config.vars.USHSO_WORKER_ROLE;
    for (const binding of config.hyperdrive ?? []) {
      assert.match(binding.id, new RegExp(`_${role.toUpperCase()}_HD_`), `${path.relative(root, file)} crosses its role-scoped Hyperdrive ID`);
    }
    if (role === "ops") {
      const dlqConsumers = config.queues?.consumers ?? [];
      assert.equal(dlqConsumers.length, 5, `${path.relative(root, file)} must consume all five DLQs`);
      for (const consumer of dlqConsumers) {
        assert.match(consumer.queue, /-dlq$/);
        assert.equal(consumer.max_batch_size, 1);
        assert.equal(consumer.max_retries, 5);
        assert.equal(consumer.retry_delay, 30);
        assert.equal(consumer.max_concurrency, 1);
        assert.equal("dead_letter_queue" in consumer, false, "recursive DLQ is prohibited");
      }
    }
    if (role === "scheduler") {
      const workflow = config.workflows?.find((item) => item.binding === "HARVEST_WORKFLOW");
      assert.ok(workflow, `${path.relative(root, file)} is missing the harvest Workflow binding`);
      assert.equal(workflow.default_retention?.success_retention, "30 days");
      assert.equal(workflow.default_retention?.error_retention, "30 days");
    }
    const main = path.resolve(path.dirname(file), config.main);
    assert.ok(fs.existsSync(main), `${path.relative(root, file)} main is missing`);
  }
  assert.equal(workerContract.workers.length * ENVIRONMENTS.length, expected.size);
}

function validatePolicyAndAccess(root) {
  const fence = readJson(path.join(root, "infra", "policy", "environment-fence.v1.0.0.json"));
  assert.equal(fence.environments.staging.traffic, "none");
  assert.equal(fence.environments.production.traffic, "none");
  assert.equal(fence.environments.production.apply_authorization, "AUTH-11");
  assert.notEqual(fence.environments.staging.state_key, fence.environments.production.state_key);
  assert.ok(fence.required_distinct_dimensions.includes("database_credentials_and_roles"));
  assert.ok(fence.required_distinct_dimensions.includes("database_privilege_attestation_receipts"));
  assert.ok(fence.required_distinct_dimensions.includes("neon_endpoint_and_direct_tls_host"));
  assert.ok(fence.static_negative_checks.includes("production_workers_dev_false_and_routes_empty"));
  assert.ok(fence.static_negative_checks.includes("no_neon_api_created_worker_role"));
  assert.ok(fence.static_negative_checks.includes("hyperdrive_requires_exact_environment_catalog_attestation"));
  assert.ok(fence.static_negative_checks.includes("attestation_runner_rejects_host_project_branch_or_endpoint_overrides"));
  assert.ok(fence.static_negative_checks.includes("hyperdrive_attestation_digest_recomputed_and_expiry_checked_at_apply"));

  const redaction = readJson(path.join(root, "infra", "policy", "plan-redaction.v1.0.0.json"));
  assert.ok(redaction.sensitive_key_patterns.includes("database_origins"));
  assert.ok(redaction.sensitive_terraform_paths.includes("variables.database_origins.value"));
  assert.ok(redaction.sensitive_terraform_paths.includes("variables.database_origin_attestation.value"));
  assert.ok(redaction.review_rules.includes("do_not_use_redacted_plan_as_apply_artifact"));

  const access = readJson(path.join(root, "infra", "cloudflare", "manifests", "ops-access.template.json"));
  assert.equal(access.status, "pending_external_authorization");
  assert.equal(access.authorization, "AUTH-02");
  assert.equal(access.application.worker_routes_created, false);
  assert.equal(access.application.dns_records_created, false);
  assert.equal(access.policy_order.at(-1).decision, "deny");
  assert.equal(access.policy_order.at(-1).include, "everyone");
  assert.equal(access.policy_order[0].require, "mfa");
  sameMembers(access.required_audit_actions, ["pause", "replay", "review", "promotion", "rollback", "retention_override", "deletion"], "ops audit actions");

  const privacy = readJson(path.join(root, "infra", "security", "privacy-foundation.v1.0.0.json"));
  const questions = privacy.data_classes.find((item) => item.id === "public_question_or_user_identifier");
  assert.equal(questions.default_collection, "prohibited");
  assert.equal(questions.loggable, false);
  assert.ok(privacy.controls.includes("plan_redaction_before_persistence"));
  assert.ok(privacy.controls.includes("maintenance_credentials_never_bound_to_workers"));
  assert.ok(privacy.controls.includes("worker_logins_created_only_by_audited_direct_sql_never_neon_api_console_cli_or_neon_role"));
  assert.ok(privacy.controls.includes("hyperdrive_prebinding_catalog_attestation_rejects_elevated_attributes_neon_superuser_or_unexpected_membership"));
  assert.ok(privacy.controls.includes("hyperdrive_prebinding_attestation_expires_at_apply_within_15_minutes_and_binds_environment_project_branch_endpoint_direct_tls_host_template_recomputed_evidence_and_all_login_fields"));
  assert.ok(privacy.controls.includes("attestation_runner_resolves_connection_only_from_exact_environment_terraform_outputs_and_uses_tls_verify_full"));
  sameMembers(privacy.managed_pending.map((item) => item.authorization), ["AUTH-02", "AUTH-03", "AUTH-11", "AUTH-02"], "security auth gates");
}

function validateReceipts(root) {
  const receiptDir = path.join(root, "verification", "wp3", "v1.0.0", "receipts");
  const actual = fs.readdirSync(receiptDir).filter((name) => name.endsWith(".json"));
  for (const expected of EXPECTED_RECEIPTS) {
    assert.ok(actual.includes(expected), `missing WP3 infrastructure receipt ${expected}`);
  }
  const schema = readJson(path.join(root, "verification", "wp3", "v1.0.0", "infra", "schemas", "receipt.schema.json"));
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
  for (const name of EXPECTED_RECEIPTS) {
    const receipt = readJson(path.join(receiptDir, name));
    assert.ok(validate(receipt), `${name}: ${JSON.stringify(validate.errors)}`);
    assert.ok(Number.isFinite(Date.parse(receipt.generated_at)), `${name}: invalid generated_at`);
    assert.equal(receipt.local_configuration.status, "pass");
    assert.equal(receipt.managed_rehearsal.status, "pending_external_authorization");
    assert.equal(receipt.overall_status, "pending_external_authorization");
    for (const [relativeFile, expectedDigest] of Object.entries(receipt.local_configuration.input_sha256)) {
      const inputFile = path.join(root, relativeFile);
      assert.ok(fs.existsSync(inputFile), `${name}: missing receipted input ${relativeFile}`);
      assert.equal(digest(inputFile), expectedDigest, `${name}: stale digest for ${relativeFile}`);
    }
  }
  const environment = readJson(path.join(receiptDir, "environment-isolation.json"));
  assert.ok(environment.managed_rehearsal.authorization_gates.includes("AUTH-11"));
  assert.match(environment.authorization_boundaries["AUTH-11"], /zero-traffic production foundation/);
  assert.ok(environment.non_claims.some((claim) => claim.includes("AUTH-11")));
  const provider = readJson(path.join(receiptDir, "provider-capability-review.json"));
  sameMembers(provider.managed_rehearsal.authorization_gates, ["AUTH-01", "AUTH-02", "AUTH-03", "AUTH-11"], "provider managed gates");
  assert.ok(provider.local_configuration.commands.some((command) => command.includes("init -backend=false")));
  assert.ok(provider.local_configuration.commands.filter((command) => command.endsWith("validate -json")).length === 2);
  assert.ok(provider.local_configuration.evidence.some((item) => item.includes("valid=true, error_count=0, warning_count=0")));
  assert.ok(provider.non_claims.includes("No Terraform plan or apply was run"));
  assert.ok(provider.non_claims.includes("No provider API was called and no resource was created or changed"));
  const cloudflare = readJson(path.join(receiptDir, "cloudflare-config-validation.json"));
  assert.ok(cloudflare.local_configuration.evidence.some((item) => item.includes("deployable_candidate=false")));
  assert.ok(cloudflare.managed_rehearsal.required_evidence.some((item) => item.includes("Concrete scheduler default handler")));
  assert.ok(cloudflare.managed_rehearsal.required_evidence.some((item) => item.includes("Concrete harvest, normalize, projector, and ops")));
  assert.ok(cloudflare.non_claims.includes("No deployable Worker candidate is accepted while any main targets the foundation placeholder"));
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function validateFoundation(root) {
  validateJsonSyntax(root);
  const manifestDir = path.join(root, "infra", "cloudflare", "manifests");
  const staging = readJson(path.join(manifestDir, "resources.staging.json"));
  const production = readJson(path.join(manifestDir, "resources.production.json"));
  const workers = readJson(path.join(manifestDir, "worker-bindings.json"));
  const secrets = readJson(path.join(manifestDir, "secrets-names.json"));
  const queueWorkflow = readJson(path.join(manifestDir, "queue-workflow-contract.json"));
  const observability = readJson(path.join(root, "infra", "observability", "contract.v1.0.0.json"));
  const recovery = readJson(path.join(root, "infra", "recovery", "controls.v1.0.0.json"));
  const drills = readJson(path.join(root, "infra", "recovery", "drill-matrix.v1.0.0.json"));
  const capacity = readJson(path.join(root, "infra", "capacity", "candidate.v1.0.0.json"));
  const toolchain = readJson(path.join(root, "infra", "provider", "toolchain.v1.0.0.json"));
  const capabilityReview = readJson(path.join(root, "infra", "provider", "capability-review-template.v1.0.0.json"));

  validateResourceManifest(staging);
  validateResourceManifest(production);
  validateWorkerBindings(workers, secrets);
  validateQueueWorkflowContract(queueWorkflow, staging);
  validateQueueWorkflowContract(queueWorkflow, production);
  validateProviderToolchain(root, toolchain, capabilityReview);
  validateDatabaseRoleAlignment(root, staging, production);
  validateAuthorizationRegister(root);
  validateObservability(observability);
  validateRecovery(recovery, drills);
  validateCapacity(root, capacity);
  validateResourceCapacityAlignment(staging, capacity);
  validateResourceCapacityAlignment(production, capacity);
  validateTerraformStatic(root);
  validateEnvironmentFence(root, staging, production);
  validateNoSecrets(root);
  validateWrangler(root, workers);
  validatePolicyAndAccess(root);
  validateReceipts(root);

  return {
    schema_version: "ushso-wp3-local-validation.v1.0.0",
    status: "pass",
    scope: "local_configuration_only",
    checks: [
      "terraform_exact_pins_and_structural_hcl",
      "provider_backed_schema_validation_two_roots_zero_errors_warnings_and_identical_locks",
      "active_neon_project_endpoint_retention_and_two_phase_bootstrap",
      "sql_created_worker_logins_with_prebinding_privilege_attestation",
      "separate_environment_roots_state_keys_and_names",
      "zero_traffic_no_routes_or_dns",
      "dual_hyperdrive_cache_semantics",
      "private_content_addressed_r2",
      "five_queue_dlq_retry_contracts",
      "five_bounded_dlq_sink_consumers_ack_after_commit_no_recursive_dlq",
      "workflow_and_utc_cron_contract",
      "six_worker_least_binding_manifests",
      "secret_names_without_values",
      "wrangler_4_127_1_schema_validation_12_of_12",
      "capacity_four_json_schemas_and_conservative_candidate",
      "structured_event_fields_14",
      "required_alerts_13",
      "recovery_controls_8",
      "service_objectives_11",
      "ops_access_default_deny_template",
      "privacy_and_plan_redaction_policy",
      "seven_status_separated_receipts"
    ],
    counts: { environments: 2, neon_projects: 2, workers: 6, sql_created_worker_logins_per_environment: 6, rendered_wrangler_configs: 12, queues: 5, dlqs: 5, dlq_sink_consumers_per_environment: 5, hyperdrive_semantic_profiles_per_environment: 2, hyperdrive_configs_per_environment: 8, r2_buckets_per_environment: 2, event_fields: 14, alerts: 13, recovery_controls: 8, slos: 11 },
    managed_rehearsal_status: "pending_external_authorization",
    authorization_gates: ["AUTH-01", "AUTH-02", "AUTH-03", "AUTH-05", "AUTH-11"],
    input_digests: {
      staging_resources_sha256: digest(path.join(manifestDir, "resources.staging.json")),
      production_resources_sha256: digest(path.join(manifestDir, "resources.production.json")),
      worker_bindings_sha256: digest(path.join(manifestDir, "worker-bindings.json")),
      capacity_candidate_sha256: digest(path.join(root, "infra", "capacity", "candidate.v1.0.0.json"))
    }
  };
}
