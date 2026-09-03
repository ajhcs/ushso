import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { assertRedactedPlanSafe, redactTerraformPlan } from "../tools/redact-plan.mjs";
import { readJson, repositoryRoot } from "../tools/paths.mjs";

const root = repositoryRoot(import.meta.url);
const policy = readJson(path.join(root, "infra", "policy", "plan-redaction.v1.0.0.json"));

test("Terraform review-plan redaction removes nested provider and origin secrets", () => {
  const source = {
    format_version: "1.2",
    variables: {
      cloudflare_account_id: { value: "account-real-value" },
      database_origins: { value: { public: { login_user: "public-login", password: "origin-secret" } } },
      benign_capacity: { value: 45 }
    },
    planned_values: {
      root_module: {
        resources: [{
          address: "cloudflare_hyperdrive_config.correctness",
          values: {
            origin: {
              host: "private.example.invalid",
              user: "app_user",
              password: "super-secret-value"
            },
            note: "safe review text"
          }
        }]
      }
    },
    connection_string: "postgresql://user:secret@private.example.invalid/db"
  };
  const clone = structuredClone(source);
  const redacted = redactTerraformPlan(source, policy);
  assert.deepEqual(source, clone, "redaction must not mutate the apply artifact");
  assert.equal(redacted.variables.cloudflare_account_id, "[REDACTED]");
  assert.equal(redacted.variables.database_origins, "[REDACTED]");
  assert.equal(redacted.planned_values.root_module.resources[0].values.origin.host, "[REDACTED]");
  assert.equal(redacted.planned_values.root_module.resources[0].values.origin.password, "[REDACTED]");
  assert.equal(redacted.connection_string, "[REDACTED]");
  assert.equal(redacted.variables.benign_capacity.value, 45);
  assert.equal(redacted.planned_values.root_module.resources[0].values.note, "safe review text");
  assert.doesNotThrow(() => assertRedactedPlanSafe(redacted));
});

test("redaction safety scanner rejects credential URIs under unknown keys", () => {
  assert.throws(
    () => assertRedactedPlanSafe({ opaque: "postgres://user:password@host.invalid/db" }),
    /URI credentials/
  );
});
