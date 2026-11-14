import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { prepareJobApproval } from "../../scripts/source-selection-ai/prepare-job.mjs";
import { executeDraft } from "../../packages/source-selection-ai/index.mjs";
const sha = (value) => createHash("sha256").update(value).digest("hex");
test("job packet binds reviewed inputs and leaves actual approval empty; execution stays blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-approval-packet-"));
  const input = JSON.parse(
    await readFile(
      new URL(
        "../../docs/source-selection/ai-templates/execution.template.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  input.dir = join(root, "budget");
  await mkdir(input.dir);
  input.jobId = "synthetic-packet-test";
  input.config.enabled = true;
  input.config.ledger_id = "synthetic-ledger";
  input.config.provider.vetted = true;
  const bytes = Buffer.from("Synthetic private qualification fixture only.");
  input.input = {
    capture_id: "synthetic",
    path: join(root, "capture.txt"),
    sha256: sha(bytes),
    rights_path: join(root, "rights.json"),
  };
  await writeFile(input.input.path, bytes);
  const rights = JSON.stringify({
    capture_sha256: sha(bytes),
    scope: "synthetic",
    actions: { send_to_provider: "allowed" },
    reviewer: "synthetic",
    terms_url: "https://example.org/fixture",
    checked_at: "2026-01-01T00:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
  });
  await writeFile(input.input.rights_path, rights);
  input.input.rights_sha256 = sha(rights);
  const result = await prepareJobApproval(input);
  assert.equal(result.status, "awaiting_human_approval");
  assert.equal(
    result.approval.config_sha256,
    sha(JSON.stringify(input.config)),
  );
  assert.equal(result.approval.ledger_directory, input.dir);
  for (const key of [
    "approver",
    "role",
    "issued_at",
    "expires_at",
    "attestation",
  ])
    assert.equal(result.approval[key], null);
  let calls = 0;
  const execution = await executeDraft({
    ...input,
    approval: result.approval,
    fetchImpl: async () => {
      calls++;
      throw Error("must never dispatch");
    },
  });
  assert.equal(execution.reason, "approval_required");
  assert.equal(calls, 0);
});
test("disabled packet preparation cannot manufacture ready status", async () => {
  assert.equal(
    (await prepareJobApproval({ config: { enabled: false }, input: {} }))
      .status,
    "disabled",
  );
});
