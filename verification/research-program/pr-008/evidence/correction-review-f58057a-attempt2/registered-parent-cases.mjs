import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, out] = process.argv.slice(2);
assert(root && out);
const { ImmutableSchemaCatalog } = await import(pathToFileURL(path.join(root, "packages/identity/src/index.mjs")));
const { schemaFixture } = await import(pathToFileURL(path.join(root, "packages/identity/fixtures/production-shaped.mjs")));
const released = schemaFixture("parent-consistency");
const child = {
  release_id: released.snapshot.release_id,
  distribution_id: released.snapshot.distribution_id,
  schema_snapshot_id: released.snapshot.schema_snapshot_id,
  schema_field_id: released.fields[0].schema_field_id,
  field_revision_id: released.fields[0].revision_id,
};
const alpha = { source_id: "urn:ushso:source:alpha", asset_id: "urn:ushso:asset:alpha" };
const beta = { source_id: "urn:ushso:source:beta", asset_id: "urn:ushso:asset:beta" };
const bindingFor = (parents) => ({
  binding_state: "exact",
  ...parents,
  release_identity: { ...parents, release_id: child.release_id },
  releases: [child.release_id],
  distributions: [{ distribution_id: child.distribution_id, release_id: child.release_id, identity_state: "exact" }],
});
const contextFor = (parents) => ({ ...parents, ...child });
const cases = [];
function check(id, fn) {
  try {
    fn();
    cases.push({ id, status: "passed" });
  } catch (error) {
    cases.push({ id, status: "failed", error: { name: error.name, code: error.code ?? null, message: error.message } });
  }
}
check("registered-alpha-foreign-beta-rejected", () => {
  const catalog = new ImmutableSchemaCatalog();
  catalog.registerSnapshot({ ...released.snapshot, ...alpha }, released.fields);
  assert.throws(() => catalog.resolveVariableContext(contextFor(beta), bindingFor(beta)), { code: "variable_context_source_mismatch" });
});
check("registered-alpha-matching-alpha-accepted", () => {
  const catalog = new ImmutableSchemaCatalog();
  catalog.registerSnapshot({ ...released.snapshot, ...alpha }, released.fields);
  assert.equal(catalog.resolveVariableContext(contextFor(alpha), bindingFor(alpha)).field.revision_id, child.field_revision_id);
});
const receipt = {
  format: "ushso.pr008.controller-registered-parent-probes.v1",
  author: "Astra/root",
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim(),
  recorded_at: new Date().toISOString(),
  script_sha256: createHash("sha256").update(await fs.readFile(new URL(import.meta.url))).digest("hex"),
  scope: "Offline immutable registered parent consistency cases using the production-shaped identity fixture. No publisher access or scientific qualification.",
  passed: cases.filter((entry) => entry.status === "passed").length,
  failed: cases.filter((entry) => entry.status === "failed").length,
  cases,
};
await fs.writeFile(out, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
process.exitCode = receipt.failed ? 1 : 0;
