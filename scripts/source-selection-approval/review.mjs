import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  digest,
  importReviewRecords,
  readiness,
  validatePacket,
} from "../../packages/source-selection-approval/index.mjs";
import {
  verifyPrivateEvidence,
  stageApprovedBytes,
} from "../../packages/source-selection-approval/artifacts.mjs";
import { commitLedger } from "../../packages/source-selection/ledger.mjs";
const [command, packetPath, ledgerPath, recordsPath, output, expectedRevision] =
  process.argv.slice(2);
const read = async (p) => JSON.parse(await readFile(p, "utf8"));
if (
  !["digest", "preview", "import"].includes(command) ||
  !packetPath ||
  !ledgerPath
)
  throw new Error(
    "usage: review.mjs digest|preview|import packet.json ledger.json [records.json] [ledger-root] [expected-revision|null]",
  );
const packet = await read(packetPath),
  ledger = await read(ledgerPath);
validatePacket(packet, ledger);
if (command === "digest")
  console.log(
    JSON.stringify(
      {
        packet_digest: digest(packet),
        proposals: packet.proposals.map((p) => ({
          proposal_id: p.proposal_id,
          proposal_digest: digest(p),
        })),
        rights: packet.rights_reviews.map((r) => ({
          asset_id: r.asset_id,
          rights_digest: digest(r),
        })),
      },
      null,
      2,
    ),
  );
else {
  const records = await read(recordsPath);
  await verifyPrivateEvidence(packet);
  const report = readiness(packet, ledger, records);
  if (command === "preview") {
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "blocked") process.exitCode = 2;
  } else {
    if (!output || !expectedRevision)
      throw new Error("explicit ledger root and expected revision required");
    const root = resolve(output);
    if (!root.startsWith("/workspace/") || root.includes("/production/"))
      throw new Error("local workspace ledger root required");
    const next = importReviewRecords(packet, ledger, records);
    if (!records.claim_decisions.length && !records.rights_decisions.length)
      throw new Error("no_actual_records");
    await stageApprovedBytes(root, next, packet);
    const receipt = await commitLedger(
      root,
      expectedRevision === "null" ? null : expectedRevision,
      next,
    );
    await writeFile(
      `${root}/approval-${digest(records)}.json`,
      JSON.stringify({ packet, records, receipt }, null, 2),
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      JSON.stringify(
        {
          status: "imported_local_only",
          ...receipt,
          readiness: report,
          production_authorized: false,
        },
        null,
        2,
      ),
    );
  }
}
