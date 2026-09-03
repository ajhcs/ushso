import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { benchmarkCaseDigest, buildBenchmarkCases } from "../src/cases.mjs";
import { assertReviewerCasesAreBlind, blindReviewCaseDigest, buildBlindReviewCases } from "../src/adjudication-packet.mjs";
import { MAX_SUBMISSION_BYTES, validateAdjudicationSubmission } from "../src/adjudication-import.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../../..");
const inputArgument = process.argv[2];

function assertJsonBounds(root) {
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > 250_000) throw new Error("ADJUDICATION_INPUT_NODE_LIMIT_EXCEEDED");
    if (depth > 20) throw new Error("ADJUDICATION_INPUT_DEPTH_LIMIT_EXCEEDED");
    if (typeof value === "string" && value.length > 20_000) throw new Error("ADJUDICATION_INPUT_STRING_LIMIT_EXCEEDED");
    if (Array.isArray(value)) value.forEach((child) => stack.push({ value: child, depth: depth + 1 }));
    else if (value && typeof value === "object") Object.values(value).forEach((child) => stack.push({ value: child, depth: depth + 1 }));
  }
}

if (!inputArgument || inputArgument === "-") {
  process.stderr.write("Usage: node tools/validate-adjudication-import.mjs /absolute/path/to/submission.json\n");
  process.exitCode = 64;
} else {
  const inputPath = path.resolve(inputArgument);
  const stat = await fs.lstat(inputPath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("ADJUDICATION_INPUT_MUST_BE_REGULAR_FILE");
  if (stat.size > MAX_SUBMISSION_BYTES) throw new Error(`ADJUDICATION_INPUT_TOO_LARGE:${stat.size}`);
  const inputBytes = await fs.readFile(inputPath);
  if (inputBytes.byteLength !== stat.size) throw new Error("ADJUDICATION_INPUT_CHANGED_DURING_READ");
  const submission = JSON.parse(inputBytes.toString("utf8"));
  assertJsonBounds(submission);
  const packetBytes = await fs.readFile(path.join(packageRoot, "adjudication/reviewer-packet.json"));
  const packet = JSON.parse(packetBytes);
  const benchmarkManifest = JSON.parse(await fs.readFile(path.join(packageRoot, "benchmark/manifest.json"), "utf8"));
  const cases = buildBenchmarkCases(benchmarkManifest);
  const reviewerCases = buildBlindReviewCases(cases);
  if (benchmarkCaseDigest(cases) !== packet.benchmark.case_sha256 || blindReviewCaseDigest(reviewerCases) !== packet.reviewer_case_contract.case_sha256) throw new Error("ADJUDICATION_PACKET_CASE_SEAL_INVALID");
  assertReviewerCasesAreBlind(reviewerCases);
  for (const binding of packet.artifact_bindings ?? []) {
    const bindingBytes = await fs.readFile(path.join(packageRoot, binding.path));
    if (createHash("sha256").update(bindingBytes).digest("hex") !== binding.byte_sha256) throw new Error(`ADJUDICATION_PACKET_ARTIFACT_DRIFT:${binding.path}`);
  }
  if ((packet.artifact_bindings ?? []).length !== 10) throw new Error("ADJUDICATION_PACKET_ARTIFACT_SET_INVALID");
  const registerBytes = await fs.readFile(path.join(repositoryRoot, "verification/external-authorization/v1.0.0/register.json"));
  if (createHash("sha256").update(registerBytes).digest("hex") !== packet.authorization_boundary.register_byte_sha256) throw new Error("ADJUDICATION_AUTHORIZATION_REGISTER_DRIFT");
  const register = JSON.parse(registerBytes);
  const authorizationEntry = register.entries.find((entry) => entry.id === "AUTH-14");
  const result = validateAdjudicationSubmission({
    submission,
    cases,
    packet,
    packetByteSha256: createHash("sha256").update(packetBytes).digest("hex"),
    authorizationEntry,
  });
  process.stdout.write(`${JSON.stringify({
    ...result,
    input: {
      byte_length: inputBytes.byteLength,
      byte_sha256: createHash("sha256").update(inputBytes).digest("hex"),
    },
  }, null, 2)}\n`);
  if (!result.ready_for_import) process.exitCode = result.status === "pending_external_authorization" ? 3 : 2;
}
