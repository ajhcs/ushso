import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  ATTESTATION_ROLE_FIELDS,
  ATTESTATION_ROLE_ORDER,
  attestationEvidenceSha256,
  canonicalAttestationMaterial
} from "../../../../../infra/terraform/modules/neon-foundation/attestation-material.mjs";
import { runPrebindingAttestation } from "../../../../../infra/terraform/modules/neon-foundation/run-prebinding-attestation.mjs";
import { validateDatabaseOriginAttestation } from "../tools/foundation-validation.mjs";
import { repositoryRoot } from "../tools/paths.mjs";

const roles = ["public", "scheduler", "harvest", "normalize", "projector", "ops"];

function safeAttestation(environment = "staging") {
  const attestation = {
    environment,
    neon_project_id: `project-${environment}`,
    neon_branch_id: `branch-${environment}-main`,
    neon_endpoint_id: `endpoint-${environment}-main`,
    direct_host: `ep-${environment}.example.neon.tech`,
    verified_at_utc: "2026-08-30T23:00:00Z",
    expires_at_utc: "2026-08-30T23:10:00Z",
    template_sha256: "a".repeat(64),
    roles: Object.fromEntries(roles.map((role) => [role, {
      database_role: `ushso_${role}`,
      login_user: `ushso_${environment}_${role}_login`,
      rolsuper: false,
      rolbypassrls: false,
      rolreplication: false,
      rolcreatedb: false,
      rolcreaterole: false,
      capability_member: true,
      neon_superuser_member: false,
      unexpected_membership: false
    }]))
  };
  attestation.evidence_sha256 = attestationEvidenceSha256(attestation);
  return attestation;
}

function binding(environment = "staging", applyTimestamp = "2026-08-30T23:05:00Z") {
  return {
    projectId: `project-${environment}`,
    branchId: `branch-${environment}-main`,
    endpointId: `endpoint-${environment}-main`,
    directHost: `ep-${environment}.example.neon.tech`,
    applyTimestamp
  };
}

test("synthetic SQL-created login catalog attestation satisfies the prebinding policy", () => {
  assert.doesNotThrow(() => validateDatabaseOriginAttestation(safeAttestation(), "staging", binding()));
});

for (const field of ["rolsuper", "rolbypassrls", "rolreplication", "rolcreatedb", "rolcreaterole", "neon_superuser_member", "unexpected_membership"]) {
  test(`prebinding policy rejects ${field}=true`, () => {
    const candidate = safeAttestation();
    candidate.roles.public[field] = true;
    assert.throws(() => validateDatabaseOriginAttestation(candidate, "staging", binding()));
  });
}

test("prebinding policy rejects missing capability membership", () => {
  const candidate = safeAttestation();
  candidate.roles.ops.capability_member = false;
  assert.throws(() => validateDatabaseOriginAttestation(candidate, "staging", binding()));
});

test("prebinding policy rejects cross-role, cross-login, cross-environment, and stale-template shapes", () => {
  for (const mutate of [
    (value) => { value.roles.public.database_role = "ushso_ops"; },
    (value) => { value.roles.public.login_user = "ushso_staging_ops_login"; },
    (value) => { value.environment = "production"; },
    (value) => { value.template_sha256 = "not-a-digest"; }
  ]) {
    const candidate = safeAttestation();
    mutate(candidate);
    assert.throws(() => validateDatabaseOriginAttestation(candidate, "staging", binding()));
  }
});

test("prebinding policy rejects stale and future attestations", () => {
  assert.throws(() => validateDatabaseOriginAttestation(
    safeAttestation(), "staging", binding("staging", "2026-08-30T23:10:01Z")
  ));
  assert.throws(() => validateDatabaseOriginAttestation(
    safeAttestation(), "staging", binding("staging", "2026-08-30T22:59:59Z")
  ));
  const longLived = safeAttestation();
  longLived.expires_at_utc = "2026-08-30T23:15:01Z";
  assert.throws(() => validateDatabaseOriginAttestation(longLived, "staging", binding()));
});

test("saved plan applied after expiry is rejected at apply time", () => {
  assert.throws(() => validateDatabaseOriginAttestation(
    safeAttestation(), "staging", binding("staging", "2026-08-31T02:00:00Z")
  ));
});

test("prebinding policy rejects cross-project, cross-branch, cross-endpoint, and wrong-host attestations", () => {
  assert.throws(() => validateDatabaseOriginAttestation(
    safeAttestation(), "staging", { ...binding(), projectId: "project-other" }
  ));
  assert.throws(() => validateDatabaseOriginAttestation(
    safeAttestation(), "staging", { ...binding(), branchId: "branch-other" }
  ));
  assert.throws(() => validateDatabaseOriginAttestation(
    safeAttestation(), "staging", { ...binding(), endpointId: "endpoint-other" }
  ));
  assert.throws(() => validateDatabaseOriginAttestation(
    safeAttestation(), "staging", { ...binding(), directHost: "ep-other.example.neon.tech" }
  ));
});

test("altered canonical envelope with the same evidence digest is rejected", () => {
  const candidate = safeAttestation();
  candidate.expires_at_utc = "2026-08-30T23:09:00Z";
  assert.throws(() => validateDatabaseOriginAttestation(candidate, "staging", binding()));
});

test("SQL, runner, and Terraform share the exact canonical evidence field order", () => {
  const root = repositoryRoot(import.meta.url);
  const moduleRoot = path.join(root, "infra", "terraform", "modules", "neon-foundation");
  const sql = readFileSync(path.join(moduleRoot, "prebinding-attestation.sql.tftpl"), "utf8");
  const hcl = readFileSync(path.join(root, "infra", "terraform", "modules", "foundation", "main.tf"), "utf8");
  assert.deepEqual([...sql.matchAll(/role_key \|\| '\.([a-z_]+)='/g)].map((match) => match[1]), ATTESTATION_ROLE_FIELDS);
  assert.deepEqual([...hcl.matchAll(/"roles\.\$\{role\}\.([a-z_]+)=/g)].map((match) => match[1]), ATTESTATION_ROLE_FIELDS);
  assert.deepEqual([...sql.matchAll(/WHEN '([a-z]+)' THEN [1-6]/g)].map((match) => match[1]), ATTESTATION_ROLE_ORDER);
  const material = canonicalAttestationMaterial(safeAttestation());
  assert.match(material, /^ushso-database-origin-attestation\.v1\nenvironment=staging\nneon_project_id=project-staging\nneon_branch_id=branch-staging-main\nneon_endpoint_id=endpoint-staging-main\ndirect_host=ep-staging\.example\.neon\.tech\n/);
  assert.equal(material.split("\n").length, 1 + 8 + ATTESTATION_ROLE_ORDER.length * ATTESTATION_ROLE_FIELDS.length);
});

test("attestation runner rejects free-form host, project, branch, and endpoint claims before any command", () => {
  for (const override of ["--host=wrong", "--project=wrong", "--branch=wrong", "--endpoint=wrong"]) {
    assert.throws(() => runPrebindingAttestation([
      "node", "run-prebinding-attestation.mjs", "--environment", "staging", override
    ]));
  }
});
