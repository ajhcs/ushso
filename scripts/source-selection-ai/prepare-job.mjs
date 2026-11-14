// Prepare exact bindings for a human; this never approves or dispatches a job.
import { createHash } from "node:crypto";
import { writeFile, realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  dryRun,
  readWorkspaceJson,
} from "../../packages/source-selection-ai/index.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export async function prepareJobApproval(input) {
  const check = await dryRun(input);
  if (check.status !== "ready") return check;
  if (
    typeof input.jobId !== "string" ||
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(input.jobId)
  )
    return { status: "blocked", reason: "job_id" };
  const directory = await realpath(input.dir);
  if (directory !== resolve(input.dir) || !directory.startsWith("/workspace/"))
    throw Error("invalid_ledger_directory");
  return {
    status: "awaiting_human_approval",
    approval: {
      action: "execute_paid_draft",
      job_id: input.jobId,
      ledger_directory: directory,
      ledger_id: input.config.ledger_id,
      budget_scope_id: input.config.budget_scope_id,
      config_sha256: hash(JSON.stringify(input.config)),
      rights_sha256: input.input.rights_sha256,
      capture_sha256: input.input.sha256,
      reserved_micro_usd: check.reserved_micro_usd,
      approver: null,
      role: null,
      issued_at: null,
      expires_at: null,
      attestation: null,
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath)
    throw Error(
      "usage: prepare-job.mjs execution-input.json unsigned-approval.json",
    );
  const output = resolve(outputPath),
    parent = await realpath(dirname(output));
  if (parent !== dirname(output) || !parent.startsWith("/workspace/"))
    throw Error("workspace_output_required");
  const result = await prepareJobApproval(await readWorkspaceJson(inputPath));
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify({ status: result.status, output }));
  if (result.status !== "awaiting_human_approval") process.exitCode = 2;
}
