#!/usr/bin/env node
import {
  dryRun,
  executeDraft,
  evaluate,
  status,
  shutdown,
  initializeLedger,
  recoverLock,
  reconcile,
  readWorkspaceJson,
} from "../../packages/source-selection-ai/index.mjs";
const [command, path] = process.argv.slice(2);
try {
  if (
    !path ||
    ![
      "dry-run",
      "execute",
      "evaluate",
      "status",
      "shutdown",
      "init",
      "recover-lock",
      "reconcile",
    ].includes(command)
  )
    throw Error(
      "usage: cli.mjs <dry-run|execute|evaluate|status|shutdown|init|recover-lock|reconcile> <json-input>",
    );
  const args = await readWorkspaceJson(path);
  const fn = {
    "dry-run": dryRun,
    execute: executeDraft,
    evaluate,
    status,
    shutdown,
    init: initializeLedger,
    "recover-lock": recoverLock,
    reconcile,
  }[command];
  const result = await fn(args);
  console.log(JSON.stringify(result));
  if (
    ![
      "ready",
      "draft",
      "evaluated",
      "ok",
      "shutdown",
      "disabled",
      "initialized",
      "recovered",
      "reconciled",
    ].includes(result.status)
  )
    process.exitCode = 1;
} catch {
  console.error(
    JSON.stringify({ status: "failed", reason: "invalid_input_or_command" }),
  );
  process.exitCode = 1;
}
