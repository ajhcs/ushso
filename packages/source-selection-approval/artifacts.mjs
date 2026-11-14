import { readFile, mkdir, realpath, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { sha256 } from "../source-selection/index.mjs";
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
export async function verifyPrivateEvidence(packet) {
  const bytes = new Map();
  for (const o of packet.observations || []) {
    if (!o.body_retained) continue;
    const path = await realpath(o.private_body_path);
    if (!path.startsWith("/workspace/"))
      fail("private_evidence_workspace_required");
    const body = await readFile(path);
    if (sha256(body) !== o.receipt_sha256)
      fail("private_evidence_hash_mismatch");
    bytes.set(o.capture_id, body);
  }
  for (const p of packet.proposals)
    for (const ref of p.evidence_refs)
      if (ref.private_byte_locator) {
        const b = bytes.get(ref.capture_id),
          l = ref.private_byte_locator;
        if (
          !b ||
          !Number.isSafeInteger(l.start) ||
          !Number.isSafeInteger(l.end) ||
          l.start < 0 ||
          l.end <= l.start ||
          l.end > b.length ||
          sha256(b.subarray(l.start, l.end)) !== ref.quote_hash
        )
          fail("private_evidence_span_mismatch");
      }
  return bytes;
}
export async function stageApprovedBytes(root, ledger, packet) {
  const verified = await verifyPrivateEvidence(packet);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootReal = await realpath(root);
  if (!rootReal.startsWith("/workspace/")) fail("workspace_required");
  const dir = join(rootReal, "captures");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await realpath(dir)) !== dir) fail("capture_directory_symlink");
  for (const c of ledger.captures.filter(
    (c) => c.approval_original_capture_id && c.retention_mode === "bytes",
  )) {
    const bytes = verified.get(c.approval_original_capture_id);
    if (
      !bytes ||
      sha256(bytes) !== c.sha256 ||
      c.artifact_ref !== `${c.sha256}.html`
    )
      fail("approved_capture_mismatch");
    const path = resolve(dir, c.artifact_ref);
    if (!path.startsWith(`${dir}/`)) fail("capture_path_invalid");
    let h;
    try {
      h = await open(path, "wx", 0o600);
      await h.writeFile(bytes);
      await h.sync();
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (
        (await realpath(path)) !== path ||
        sha256(await readFile(path)) !== c.sha256
      )
        fail("existing_capture_mismatch");
    } finally {
      await h?.close();
    }
  }
}
