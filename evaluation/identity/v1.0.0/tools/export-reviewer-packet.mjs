import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { benchmarkCaseDigest, buildBenchmarkCases } from "../src/cases.mjs";
import { assertReviewerCasesAreBlind, blindReviewCaseDigest, buildBlindReviewCases, REVIEW_PACKET_SCHEMA_VERSION } from "../src/adjudication-packet.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../../..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const packetBytes = await fs.readFile(path.join(packageRoot, "adjudication/reviewer-packet.json"));
const packet = JSON.parse(packetBytes);
const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "benchmark/manifest.json"), "utf8"));
const authorizationRegisterBytes = await fs.readFile(path.join(repositoryRoot, "verification/external-authorization/v1.0.0/register.json"));
const authorizationRegister = JSON.parse(authorizationRegisterBytes);
const auth14 = authorizationRegister.entries.find((entry) => entry.id === "AUTH-14");
const cases = buildBenchmarkCases(manifest);
const reviewerCases = buildBlindReviewCases(cases);

if (packet.schema_version !== REVIEW_PACKET_SCHEMA_VERSION || packet.packet_id !== "identity-review-packet:wp7.v1") throw new Error("REVIEW_PACKET_METADATA_INVALID");
if (benchmarkCaseDigest(cases) !== packet.benchmark.case_sha256 || blindReviewCaseDigest(reviewerCases) !== packet.reviewer_case_contract.case_sha256) throw new Error("REVIEW_PACKET_CASE_DIGEST_INVALID");
if (cases.length !== packet.benchmark.case_count || reviewerCases.length !== packet.reviewer_case_contract.case_count) throw new Error("REVIEW_PACKET_CASE_COUNT_INVALID");
assertReviewerCasesAreBlind(reviewerCases);
for (const binding of packet.artifact_bindings ?? []) {
  if (sha256(await fs.readFile(path.join(packageRoot, binding.path))) !== binding.byte_sha256) throw new Error(`REVIEW_PACKET_ARTIFACT_DRIFT:${binding.path}`);
}
if ((packet.artifact_bindings ?? []).length !== 10 || sha256(authorizationRegisterBytes) !== packet.authorization_boundary.register_byte_sha256) throw new Error("REVIEW_PACKET_CONTROL_BINDING_INVALID");
if (auth14?.status !== packet.authorization_boundary.register_status || auth14?.authorized !== packet.authorization_boundary.authorized || auth14?.environment !== packet.authorization_boundary.environment) throw new Error("REVIEW_PACKET_AUTHORIZATION_STATE_DRIFT");
const permissionGranted = auth14.authorized === true
  && auth14.status === "authorized"
  && typeof auth14.authorization_receipt_id === "string"
  && packet.authorization_boundary.authorization_receipt_id === auth14.authorization_receipt_id
  && packet.authorization_boundary.permission_granted === true;

process.stdout.write(`${JSON.stringify({
  schema_version: "identity.blind-review-packet-export.v1.0.0",
  status: packet.status,
  authorization: {
    reference: "AUTH-14",
    register_status: auth14.status,
    authorized: auth14.authorized,
    permission_granted: permissionGranted,
  },
  packet_id: packet.packet_id,
  reviewer_packet_byte_sha256: sha256(packetBytes),
  benchmark_case_sha256: packet.benchmark.case_sha256,
  reviewer_case_sha256: packet.reviewer_case_contract.case_sha256,
  cases: reviewerCases,
}, null, 2)}\n`);
