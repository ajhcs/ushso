import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCandidateSnapshot, RELEASE_GATE_PLAN_FINGERPRINT } from "../src/candidate-snapshot.mjs";
import { packageRoot, readJson, repoPath, sha256File, verifyCanonicalDigest } from "../src/common.mjs";
import { loadAuthorizationRegister, loadPolicy } from "../src/rehearsal.mjs";
import { validateCandidate } from "../src/release-state-machine.mjs";

const runtimePins = {
  "worker/index.mjs": "d24f857243ec12ca75937bfe937962a55964fa2d1b6182f3b8859bf6cfc4783f",
  "apps/web/public/corpus-v1.1.0/records.jsonl": "458c8e7ec15e059e60bc908fc98f6b94f8deafd9bd1862d1dc0b576ac830f046",
  "apps/web/public/corpus-v1.1.0/search-documents.jsonl": "8c7913596353d4ea2c6f5b763d3711aa77d97a457bb91b4cbce990bbf301e633",
  "apps/web/public/corpus-v1.1.0/join-routes.jsonl": "f712c73fdfb78cf95c7ce29c68819c353a2ae2192a6feef78b8e6da38db4a0dc",
  "apps/web/public/corpus-v1.1.0/corpus.json": "4eaeffdcbb3db324f51485f38f915e392724b80c5372358933681c003eb5f864"
};

test("candidate envelope binds every required WP14 semantic artifact role and exact bytes", () => {
  const policy = loadPolicy();
  const candidate = buildCandidateSnapshot();
  assert.equal(validateCandidate(candidate, policy), true);
  assert.equal(verifyCanonicalDigest(candidate, "candidate_digest_sha256").ok, true);
  assert.equal(candidate.release_gate.plan_fingerprint_sha256, `sha256:${RELEASE_GATE_PLAN_FINGERPRINT}`);
  const repositoryPin = readJson(resolve(packageRoot, "policy/repository-base-pin.v1.0.0.json"));
  assert.equal(candidate.git.head_commit, repositoryPin.head_commit);
  assert.equal(candidate.git.head_tree_oid, repositoryPin.head_tree_oid);
  assert.equal(candidate.git.exact_candidate_tree_sealed, false);
  assert.equal(candidate.production_eligibility, false);

  const roles = new Set(candidate.artifact_pins.map((pin) => pin.role));
  for (const role of policy.required_digest_roles) assert.equal(roles.has(role), true, role);
  for (const pin of candidate.artifact_pins) {
    assert.equal(pin.sha256, `sha256:${sha256File(repoPath(pin.path))}`, pin.path);
  }
});

test("runtime Worker and JSONL corpus remain byte-for-byte at the WP14 entry boundary", () => {
  for (const [path, expected] of Object.entries(runtimePins)) assert.equal(sha256File(repoPath(path)), expected, path);
  const worker = readFileSync(repoPath("worker/index.mjs"), "utf8");
  assert.doesNotMatch(worker, /verification\/wp14|cutover-state|retire_runtime_jsonl/);
  assert.equal(readFileSync(repoPath("apps/web/public/corpus-v1.1.0/records.jsonl"), "utf8").trim().split("\n").length, 157);
  assert.equal(readFileSync(repoPath("apps/web/public/corpus-v1.1.0/search-documents.jsonl"), "utf8").trim().split("\n").length, 157);
  assert.equal(readFileSync(repoPath("apps/web/public/corpus-v1.1.0/join-routes.jsonl"), "utf8").trim().split("\n").length, 14);
});

test("all central WP14 authorizations remain false and not requested", () => {
  const register = loadAuthorizationRegister();
  for (const id of ["AUTH-03", "AUTH-05", "AUTH-06", "AUTH-07", "AUTH-08", "AUTH-09", "AUTH-11"]) {
    const entry = register.entries.find((item) => item.id === id);
    assert.ok(entry, id);
    assert.equal(entry.status, "not_requested", id);
    assert.equal(entry.authorized, false, id);
  }
});

test("package is additive and does not make its package root a runtime dependency", () => {
  const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
  assert.equal(packageJson.private, true);
  assert.deepEqual(packageJson.dependencies, { ajv: "8.20.0" });
  assert.equal(Object.keys(packageJson.dependencies).some((name) => name.startsWith("@ushso/")), false);
  assert.equal(packageJson.scripts.validate, "npm run verify");
});
