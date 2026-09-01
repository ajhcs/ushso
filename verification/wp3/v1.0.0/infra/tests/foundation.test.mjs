import assert from "node:assert/strict";
import test from "node:test";
import { validateFoundation } from "../tools/foundation-validation.mjs";
import { checkRendered } from "../tools/render-wrangler.mjs";
import { repositoryRoot } from "../tools/paths.mjs";

const root = repositoryRoot(import.meta.url);

test("WP3 local foundation satisfies every offline invariant", () => {
  const receipt = validateFoundation(root);
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.scope, "local_configuration_only");
  assert.equal(receipt.managed_rehearsal_status, "pending_external_authorization");
  assert.deepEqual(receipt.authorization_gates, ["AUTH-01", "AUTH-02", "AUTH-03", "AUTH-05", "AUTH-11"]);
  assert.deepEqual(receipt.counts, {
    environments: 2,
    neon_projects: 2,
    workers: 6,
    sql_created_worker_logins_per_environment: 6,
    rendered_wrangler_configs: 12,
    queues: 5,
    dlqs: 5,
    dlq_sink_consumers_per_environment: 5,
    hyperdrive_semantic_profiles_per_environment: 2,
    hyperdrive_configs_per_environment: 8,
    r2_buckets_per_environment: 2,
    event_fields: 14,
    alerts: 13,
    recovery_controls: 8,
    slos: 11
  });
});

test("rendered Wrangler files are deterministic", () => {
  assert.deepEqual(checkRendered(root), []);
});
