import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runBoundedUpdate } from "../scripts/research/update-cycle.mjs";
const scratch = [process.env.TMPDIR, process.env.RUNNER_TEMP].find((v) => typeof v === "string" && path.isAbsolute(v) && path.resolve(v) !== "/");
assert.ok(scratch, "TMPDIR or RUNNER_TEMP scratch required");
test("historical update resume preserves newer latest proposal and does not guess lost state", async () => {
  const { record } = JSON.parse(await fs.readFile(new URL("./fixtures/direct-base-input.json", import.meta.url)));
  const id = record.identity.match_fields.source_id;
  const directory = await fs.mkdtemp(path.join(scratch, "ushso-update-historical-"));
  try {
    const plan = { format: "ushso.bounded-update.v1", sources: [{ record, generation: "generation-1", public_metadata_only: true,
      locators: { metadata: `https://data.cdc.gov/api/views/${id}.json` } }] };
    let definition = "Original publisher definition", calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response(JSON.stringify({ id, columns: [{ fieldName: "cases", name: "Cases", description: definition, dataTypeName: "number" }] }),
        { headers: { "content-type": "application/json" } });
    };
    const args = { plan, directory, fetchImpl, storageRoot: scratch };
    const a = await runBoundedUpdate({ ...args, runId: "runA" });
    const checkpoint = path.join(directory, "runs", "runA", a.sources[0].source_key + ".json");
    const originalCheckpoint = await fs.readFile(checkpoint);
    definition = "Changed publisher definition";
    const b = await runBoundedUpdate({ ...args, runId: "runB" });
    assert.notEqual(a.sources[0].proposal_sha256, b.sources[0].proposal_sha256);
    assert.equal(b.sources[0].changes[0].before[0].description, "Original publisher definition");
    assert.equal(b.sources[0].changes[0].after[0].description, definition);
    const stateFile = path.join(directory, "state.json"), stateB = await fs.readFile(stateFile), fetchCount = calls;
    const resumed = await runBoundedUpdate({ ...args, runId: "runA" });
    assert.deepEqual(await fs.readFile(stateFile), stateB);
    assert.equal(resumed.sources[0].resume_state, "historical_checkpoint_current_preserved");
    assert.equal(resumed.sources[0].current_proposal_sha256, b.sources[0].proposal_sha256);
    assert.equal(resumed.sources[0].proposal_sha256, a.sources[0].proposal_sha256);
    assert.equal(resumed.sources[0].approval, null);
    assert.equal(resumed.sources[0].publication_authorized, false);
    assert.equal(calls, fetchCount);
    assert.deepEqual(await fs.readFile(stateFile), stateB);
    assert.deepEqual(await fs.readFile(checkpoint), originalCheckpoint);
    await fs.unlink(stateFile);
    const missing = await runBoundedUpdate({ ...args, runId: "runA" });
    assert.equal(missing.sources[0].resume_state, "latest_state_missing_not_restored");
    assert.equal(missing.sources[0].current_proposal_sha256, null);
    await assert.rejects(fs.stat(stateFile), { code: "ENOENT" });
    assert.equal(calls, fetchCount);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("existing CDC extractor and semantic verifier run in the update cycle", async () => {
  const { record } = JSON.parse(await fs.readFile(new URL("./fixtures/direct-base-input.json", import.meta.url))), id = record.identity.match_fields.source_id, directory = await fs.mkdtemp(path.join(scratch, "ushso-update-real-"));
  try {
    const plan = { format: "ushso.bounded-update.v1", sources: [{ record, generation: "generation-1", public_metadata_only: true, locators: { metadata: `https://data.cdc.gov/api/views/${id}.json` } }] };
    const result = await runBoundedUpdate({ plan, directory, runId: "real", storageRoot: scratch, fetchImpl: async () => new Response(JSON.stringify({ id, columns: [{ fieldName: "cases", name: "Cases", description: "Publisher literal definition", dataTypeName: "number" }] }), { headers: { "content-type": "application/json" } }) });
    assert.equal(result.summary.changed, 1);
    assert.equal(result.sources[0].changes[0].field, "variable_documentation");
    assert.equal(result.sources[0].changes[0].after[0].description, "Publisher literal definition");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("bounded updates preserve unchanged evidence, invalidate changed definition and isolate peers", async () => {
  const directory = await fs.mkdtemp(path.join(scratch, "ushso-update-"));
  try {
    const source = (id) => ({ record: { record_id: id, title: "Public aggregate metadata", access: { status: "public_catalog" } }, generation: "generation-1", public_metadata_only: true, locators: { metadata: `https://data.cms.gov/${id}.json` } }), plan = { format: "ushso.bounded-update.v1", sources: [source("healthy"), source("peer")] };
    let definition = "Original definition", failPeer = false, calls = 0;
    const fetchImpl = async (url) => {
      calls++;
      if (failPeer && url.endsWith("/peer.json")) throw Error("temporary");
      return new Response(JSON.stringify({ definition }), { headers: { "content-type": "application/json" } });
    };
    const extract = (record, captures) => ({ claims: [{ field: "dictionary", value: captures.metadata.data.definition, evidence: { url: captures.metadata.url, capture_sha256: captures.metadata.sha256, observed_at: captures.metadata.captured_at }, scope: "publisher_metadata" }] }), verify = () => true;
    const args = { plan, directory, fetchImpl, extract, verify, storageRoot: scratch, sleep: async () => {
    } };
    const a = await runBoundedUpdate({ ...args, runId: "one" });
    assert.equal(a.summary.changed, 2);
    const b = await runBoundedUpdate({ ...args, runId: "two" });
    assert.equal(b.summary.unchanged, 2);
    assert.deepEqual(b.sources.map((s) => s.changes), [[], []]);
    const count = calls;
    const resumed = await runBoundedUpdate({ ...args, runId: "two" });
    assert.equal(calls, count);
    assert.deepEqual(resumed.sources, b.sources);
    definition = "Changed definition at the same filename";
    failPeer = true;
    const c = await runBoundedUpdate({ ...args, runId: "three" });
    assert.equal(c.summary.changed, 1);
    assert.equal(c.summary.failed, 1);
    assert.equal(c.sources[0].approval_binding_changed, true);
    assert.equal(c.sources[0].changes[0].before, "Original definition");
    assert.equal(c.sources[0].changes[0].after, definition);
    assert.equal(c.sources[0].approval, null);
    assert.equal(c.sources[1].previous_proposal_sha256, b.sources[1].proposal_sha256);
    assert.ok(await fs.stat(path.join(directory, "proposals", a.sources[0].proposal_sha256 + ".json")));
    assert.equal(c.model_review.status, "pending_external_review");
    const checkpoint = path.join(directory, "runs", "two", b.sources[0].source_key + ".json"), originalCheckpoint = await fs.readFile(checkpoint);
    const tampered = JSON.parse(originalCheckpoint);
    tampered.proposal_sha256 = "../../private";
    await fs.writeFile(checkpoint, JSON.stringify(tampered));
    await assert.rejects(runBoundedUpdate({ ...args, runId: "two" }), /UPDATE_REFERENCE_HASH_INVALID/);
    await fs.writeFile(checkpoint, originalCheckpoint);
    tampered.proposal_sha256 = b.sources[0].proposal_sha256;
    tampered.parser_hashes = [];
    await fs.writeFile(checkpoint, JSON.stringify(tampered));
    await assert.rejects(runBoundedUpdate({ ...args, runId: "two" }), /UPDATE_CHECKPOINT_IDENTITY/);
    await fs.writeFile(checkpoint, originalCheckpoint);
    const bodyPath = path.join(directory, "captures", b.sources[0].captures[0].sha256 + ".body"), originalBody = await fs.readFile(bodyPath);
    await fs.writeFile(bodyPath, "tampered");
    await assert.rejects(runBoundedUpdate({ ...args, runId: "two" }), /UPDATE_REFERENCE_TAMPERED/);
    await fs.writeFile(bodyPath, originalBody);
    await assert.rejects(runBoundedUpdate({ ...args, plan: { ...plan, sources: [source("changed")] }, runId: "two" }), /UPDATE_RESUME_PLAN_MISMATCH/);
    const d = await runBoundedUpdate({ ...args, plan: { ...plan, sources: [{ ...source("restricted"), record: { record_id: "restricted", title: "Restricted data" } }, source("healthy")] }, runId: "four" });
    assert.equal(d.sources[0].status, "blocked_scope");
    assert.equal(d.sources[1].status, "unchanged");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
