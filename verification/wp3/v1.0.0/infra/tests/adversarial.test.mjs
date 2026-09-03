import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  validateCapacity,
  validateEnvironmentFence,
  validateObservability,
  validateRecovery,
  validateResourceManifest,
  validateWorkerBindings
} from "../tools/foundation-validation.mjs";
import { readJson, repositoryRoot } from "../tools/paths.mjs";

const root = repositoryRoot(import.meta.url);
const manifestDir = path.join(root, "infra", "cloudflare", "manifests");
const staging = readJson(path.join(manifestDir, "resources.staging.json"));
const production = readJson(path.join(manifestDir, "resources.production.json"));
const workerBindings = readJson(path.join(manifestDir, "worker-bindings.json"));
const secretNames = readJson(path.join(manifestDir, "secrets-names.json"));
const observability = readJson(path.join(root, "infra", "observability", "contract.v1.0.0.json"));
const recovery = readJson(path.join(root, "infra", "recovery", "controls.v1.0.0.json"));
const drills = readJson(path.join(root, "infra", "recovery", "drill-matrix.v1.0.0.json"));
const capacity = readJson(path.join(root, "infra", "capacity", "candidate.v1.0.0.json"));

test("production route or workers.dev exposure is rejected", () => {
  const candidate = structuredClone(production);
  candidate.routes = [{ pattern: "example.invalid/*" }];
  candidate.workers_dev = true;
  assert.throws(() => validateResourceManifest(candidate));
});

test("cache-enabled correctness binding is rejected", () => {
  const candidate = structuredClone(production);
  candidate.hyperdrive_semantic_profiles.find((item) => item.id === "correctness").cache.disabled = false;
  assert.throws(() => validateResourceManifest(candidate));
});

test("public binding to another role's Hyperdrive config is rejected", () => {
  const candidate = structuredClone(production);
  candidate.hyperdrive_configs.find((item) => item.worker_role === "public").database_role = "ushso_ops";
  assert.throws(() => validateResourceManifest(candidate));
});

test("Neon API-created Worker role policy is rejected", () => {
  const candidate = structuredClone(production);
  candidate.neon.neon_api_worker_role_creation = true;
  candidate.neon.worker_login_creation = "neon_role";
  assert.throws(() => validateResourceManifest(candidate));
});

test("Queue retry drift and missing DLQ are rejected", () => {
  const candidate = structuredClone(staging);
  candidate.queues[0].transport_max_retries = 6;
  candidate.queues[1].dead_letter_queue = "shared-dlq";
  assert.throws(() => validateResourceManifest(candidate));
});

test("Workflow retention above Cloudflare's 30-day maximum is rejected", () => {
  for (const field of ["success_retention", "error_retention"]) {
    const candidate = structuredClone(production);
    candidate.workflow[field] = "31 days";
    assert.throws(() => validateResourceManifest(candidate));
  }
});

test("DLQ sink zero retry, recursive DLQ, early ACK, or Queue-retention recovery is rejected", () => {
  for (const mutate of [
    (value) => { value.dlq_sink.transport_max_retries = 0; },
    (value) => { value.dlq_sink.second_dead_letter_queue = "recursive-dlq"; },
    (value) => { value.dlq_sink.acknowledgement = "ack_before_commit"; },
    (value) => { value.dlq_sink.terminal_control = "recover_from_queue_retention"; }
  ]) {
    const candidate = structuredClone(staging);
    mutate(candidate);
    assert.throws(() => validateResourceManifest(candidate));
  }
});

test("public credential or mutation binding is rejected", () => {
  const candidate = structuredClone(workerBindings);
  const publicWorker = candidate.workers.find((worker) => worker.role === "public");
  publicWorker.secret_names.push("CLOUDFLARE_API_TOKEN");
  assert.throws(() => validateWorkerBindings(candidate, secretNames));
});

test("foundation placeholder cannot be promoted to a deployable candidate", () => {
  const candidate = structuredClone(workerBindings);
  candidate.global_rules.deployable_candidate = true;
  assert.throws(() => validateWorkerBindings(candidate, secretNames));
});

test("missing event field, alert, or SLO is rejected", () => {
  const candidate = structuredClone(observability);
  candidate.event_fields.pop();
  candidate.alerts.pop();
  candidate.slos.pop();
  assert.throws(() => validateObservability(candidate));
});

test("strict event schema accepts 14 fields and rejects privacy-bearing extras", () => {
  const schema = readJson(path.join(root, "infra", "observability", "event.schema.json"));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  const valid = readJson(path.join(root, "verification", "wp3", "v1.0.0", "infra", "fixtures", "event.valid.json"));
  const adversarial = readJson(path.join(root, "verification", "wp3", "v1.0.0", "infra", "fixtures", "event.adversarial-extra-field.json"));
  assert.equal(Object.keys(valid).length, 14);
  assert.equal(validate(valid), true);
  assert.equal(validate(adversarial), false);
  assert.ok(validate.errors.some((error) => error.keyword === "additionalProperties"));
});

test("unaudited or missing recovery control is rejected", () => {
  const candidate = structuredClone(recovery);
  candidate.controls[0].audit_required = false;
  candidate.controls.pop();
  assert.throws(() => validateRecovery(candidate, drills));
});

test("capacity arithmetic and 2x target drift are rejected", () => {
  const candidate = structuredClone(capacity);
  candidate.connection_budget.totals.allocated_origin_connections += 1;
  candidate.queue_capacity.stages[0].two_x_messages_per_minute += 1;
  assert.throws(() => validateCapacity(root, candidate));
});

test("cross-environment resource-name collision is rejected", () => {
  const candidate = structuredClone(production);
  candidate.r2_buckets[0].name = staging.r2_buckets[0].name;
  assert.throws(() => validateEnvironmentFence(root, staging, candidate));
});
