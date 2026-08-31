import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { run } from "node:test";
import { validateVerificationPackage } from "./validate.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const testDirectories = [
  "packages/identity/tests",
  "evaluation/identity/v1.0.0/tests",
  "verification/wp7/v1.0.0/tests",
  "contracts/core/v2.0.0/tests",
  "contracts/identity/v1.0.0/tests",
  "contracts/use-access/v1.0.0/tests",
  "contracts/research-plan/v1.0.0/tests",
];
const files = [];
for (const directory of testDirectories) {
  const absolute = path.join(repositoryRoot, directory);
  for (const name of (await fs.readdir(absolute)).filter((item) => item.endsWith(".test.mjs")).sort()) files.push(path.join(absolute, name));
}
const events = [];
for await (const event of run({ files, isolation: "none", concurrency: 1 })) {
  if (["test:pass", "test:fail"].includes(event.type)) events.push({ type: event.type, name: event.data.name, file: event.data.file ?? null });
}
const failed = events.filter((event) => event.type === "test:fail");
const eventSha256 = createHash("sha256").update(JSON.stringify(events)).digest("hex");
const ledgerPath = path.join(repositoryRoot, "verification/wp7/v1.0.0/evidence-ledger.json");
const ledger = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
const evidenceLedgerSha256 = createHash("sha256").update(JSON.stringify(ledger)).digest("hex");
const storedAggregate = JSON.parse(await fs.readFile(path.join(repositoryRoot, "verification/wp7/v1.0.0/receipts/wp7-verification.json"), "utf8"));
const report = {
  schema_version: "verification.wp7.v1.0.0",
  status: failed.length === 0 ? "passed_local_short_of_external_authorization" : "failed",
  runner: { isolation: "none", concurrency: 1, files: files.length, passed_events: events.length - failed.length, failed_events: failed.length },
  event_sha256: eventSha256,
  failures: failed,
  evidence_ledger_sha256: evidenceLedgerSha256,
  external_gates: ledger.external_gates,
};
if (storedAggregate.runner.test_files !== files.length || storedAggregate.runner.passed_events !== report.runner.passed_events || storedAggregate.runner.failed_events !== report.runner.failed_events || storedAggregate.runner.event_sha256 !== eventSha256 || storedAggregate.evidence_ledger_sha256 !== evidenceLedgerSha256) {
  report.failures.push({ code: "STORED_AGGREGATE_RECEIPT_DRIFT" });
  report.status = "failed";
}
if (report.status !== "failed") report.artifact_validation = await validateVerificationPackage();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status === "failed") process.exitCode = 1;
