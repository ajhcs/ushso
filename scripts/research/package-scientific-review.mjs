import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { claimHash } from "./claim-selector.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function packageScientificReview({ draftFile, packetFile, output }) {
  const draftBytes = await fs.readFile(draftFile), packetBytes = await fs.readFile(packetFile);
  if (draftBytes.length > 256 * 1024 || packetBytes.length > 4 * 1024 * 1024) throw Error("SCIENTIFIC_INPUT_BOUND");
  const draft = JSON.parse(draftBytes), packet = JSON.parse(packetBytes);
  if (draft.source_packet_sha256 !== sha(packetBytes) || draft.owner_decision !== null || draft.publication_authorized !== false || draft.generation !== packet.generation) throw Error("SCIENTIFIC_PACKET_BINDING");
  const claims = draft.claims.filter((c) => ["SCI-04", "SCI-05"].includes(c.card_id)).map((claim) => {
    if (claim.proposal_sha256 !== claimHash(claim) || claim.owner_decision !== null || claim.generation !== draft.generation) throw Error("SCIENTIFIC_CLAIM_BINDING");
    const card = packet.conflicts.find((c) => c.id === claim.card_id);
    if (!card) throw Error("SCIENTIFIC_CARD_REQUIRED");
    const passages = [...card.new_evidence ?? [], ...card.competing_statements ?? []].filter((p) => typeof p.literal === "string" && claim.sources.some((s) => s.url === p.url && s.source_sha256 === p.pdf_sha256)).map((p) => ({ url: p.url, source_sha256: p.pdf_sha256, page: p.page, literal: p.literal }));
    if (!passages.length || passages.length > 12 || passages.some((p) => p.literal.length > 6e3 || !Number.isSafeInteger(p.page))) throw Error("SCIENTIFIC_PASSAGE_BOUND");
    return { claim, passages };
  });
  if (claims.length !== 4) throw Error("SCIENTIFIC_SCOPE_REQUIRED");
  const manifest = { schema: "ushso.scientific-review-assets.v1", generation: draft.generation, draft_sha256: sha(draftBytes), source_packet_sha256: sha(packetBytes), owner_decision: null, publication_authorized: false, claims };
  const bytes = Buffer.from(JSON.stringify(manifest));
  if (bytes.length > 64 * 1024) throw Error("SCIENTIFIC_MANIFEST_BOUND");
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, "manifest.json"), bytes, { flag: "wx" });
  return { manifest_sha256: sha(bytes), bytes: bytes.length, claims: claims.length, generation: draft.generation };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [draftFile, packetFile, output] = process.argv.slice(2);
  console.log(JSON.stringify(await packageScientificReview({ draftFile, packetFile, output })));
}
export {
  packageScientificReview
};
