import { readFile, writeFile } from "node:fs/promises";
import {
  digest,
  ACTIONS,
} from "../../packages/source-selection-approval/index.mjs";
const ledger = JSON.parse(
  await readFile("data/source-selection/candidate-ledger.json", "utf8"),
);
const evidence = JSON.parse(
  await readFile("docs/source-selection-evidence/review-packet.json", "utf8"),
);
ledger.captures.push(
  ...evidence.captures.filter((c) =>
    ["asset_hcris", "asset_phc4"].includes(c.asset_id),
  ),
);
const packet = {
  schema_version: "ushso.approval-packet.v1",
  base_ledger_sha256: digest(ledger),
  scope_asset_ids: ["asset_hcris", "asset_phc4"],
  proposals: evidence.proposals.map((p) => ({
    ...p,
    evidence_refs: p.evidence_refs.map((r) => ({
      ...r,
      ...(p.private_review_evidence
        ? {
            private_byte_locator: p.private_review_evidence.locator,
            quote_hash: p.private_review_evidence.quote_hash,
          }
        : {}),
    })),
    proposer: "Codex draft; human author unassigned",
  })),
  observations: evidence.observations.filter((o) =>
    ["capture_20261114_hcris", "capture_20261114_phc4"].includes(o.capture_id),
  ),
  rights_reviews: ["asset_hcris", "asset_phc4"].map((asset_id) => {
    const c = ledger.captures.find((c) => c.asset_id === asset_id);
    const terms = evidence.terms_evidence.filter(
      (t) => t.asset_id === asset_id,
    );
    return {
      asset_id,
      source_rights_id: c.rights_id,
      terms_url: terms[0].url,
      terms_evidence: terms.map((t) => ({
        ...t,
        status: t.status === "substantive" ? "observed" : t.status,
      })),
      scope:
        "Publisher documentation metadata and citations in public HTML, APIs and user exports only; no dataset payload access or reuse",
      expires_at: "2026-12-14T00:00:00Z",
      actions: Object.fromEntries(ACTIONS.map((a) => [a, "unresolved"])),
    };
  }),
  deferred_assets: ledger.assets
    .filter((a) => !["asset_hcris", "asset_phc4"].includes(a.asset_id))
    .map((a) => ({
      asset_id: a.asset_id,
      disposition: "defer",
      reason:
        "Outside first limited publication; requires separate substantive evidence and rights review. This is scope disposition, not a human decision.",
    })),
  protocol: "docs/source-selection-approval/review-protocol.md",
};
const records = {
  packet_digest: digest(packet),
  operating_roles: [],
  rights_decisions: [],
  claim_decisions: [],
};
await writeFile(
  "docs/source-selection-approval/base-ledger.json",
  JSON.stringify(ledger, null, 2) + "\n",
);
await writeFile(
  "docs/source-selection-approval/packet.json",
  JSON.stringify(packet, null, 2) + "\n",
);
await writeFile(
  "docs/source-selection-approval/records.blank.json",
  JSON.stringify(records, null, 2) + "\n",
);
