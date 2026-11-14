// Entirely synthetic local exercise. These identities and decisions are not publisher approvals.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "../../tests/source-selection/fixture.mjs";
import { canonical, sha256 } from "../../packages/source-selection/index.mjs";
import {
  commitLedger,
  setRightsPolicy,
  publishCandidate,
  readPublished,
} from "../../packages/source-selection/ledger.mjs";
import { currentSchemaHashes } from "./publication-evidence.mjs";
import { stagePublication } from "./stage-publication.mjs";
import { workspacePath } from "./restore-release.mjs";
export async function prepareSyntheticPublication({
  destination,
  assetsDirectory,
  rightsExpiresAt,
}) {
  const root = await workspacePath(destination);
  await mkdir(root);
  const ledgerRoot = join(root, "ledger");
  await mkdir(join(ledgerRoot, "captures"), { recursive: true });
  const ledger = fixture();
  if (rightsExpiresAt) ledger.rights[0].expires_at = rightsExpiresAt;
  const bytes = Buffer.from(
    "SYNTHETIC source metadata. Not publisher evidence.",
  );
  ledger.rights[0].actions.store_bytes = "allowed";
  Object.assign(ledger.captures[0], {
    retention_mode: "bytes",
    artifact_ref: "synthetic.txt",
    sha256: sha256(bytes),
  });
  delete ledger.captures[0].retention_reason;
  for (const a of ledger.assertions)
    a.evidence_refs = [
      {
        capture_id: "ev_1",
        locator: { start: 0, end: bytes.length },
        quote_hash: sha256(bytes),
      },
    ];
  await writeFile(join(ledgerRoot, "captures/synthetic.txt"), bytes, {
    flag: "wx",
  });
  const { revision } = await commitLedger(ledgerRoot, null, ledger),
    policy = {
      revoked_rights: [],
      checked_at: new Date().toISOString(),
      review_valid_until: new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString(),
    };
  const { hash } = await setRightsPolicy(ledgerRoot, policy);
  await publishCandidate(ledgerRoot, {
    expectedRevision: revision,
    expectedRightsHash: hash,
    rightsPolicy: policy,
    schemaHashes: await currentSchemaHashes(),
  });
  const publication = await readPublished(ledgerRoot);
  const { bundle, status, ...pointer } = publication;
  const currentRightsPolicyPath = join(root, "current-rights.json"),
    currentPublicationPath = join(root, "current-publication.json");
  await writeFile(currentRightsPolicyPath, canonical(policy), { flag: "wx" });
  await writeFile(currentPublicationPath, canonical(pointer), { flag: "wx" });
  if (assetsDirectory) await stagePublication({ ledgerRoot, assetsDirectory });
  const authority = {
    ledgerRoot,
    currentRightsPolicyPath,
    currentPublicationPath,
    expectedRightsHash: hash,
  };
  await writeFile(join(root, "authority.json"), canonical(authority), {
    flag: "wx",
  });
  return {
    status: "PASS",
    synthetic: true,
    publisher_approval: false,
    deployment_authorized: false,
    ...authority,
    generation_id: publication.generation_id,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [destination, assetsDirectory] = process.argv.slice(2);
  console.log(
    JSON.stringify(
      await prepareSyntheticPublication({ destination, assetsDirectory }),
      null,
      2,
    ),
  );
}
