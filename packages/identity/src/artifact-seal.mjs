import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./common.mjs";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function walk(root, relative = "") {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const child = path.posix.join(relative.replaceAll(path.sep, "/"), entry.name);
    if (entry.isSymbolicLink()) throw new Error(`ARTIFACT_SEAL_SYMLINK_FORBIDDEN:${child}`);
    if (entry.isDirectory()) files.push(...await walk(root, child));
    if (entry.isFile()) files.push(child);
  }
  return files;
}

export async function computeArtifactSeal(root, manifestExcludes) {
  const excluded = new Set(manifestExcludes);
  const paths = (await walk(root)).filter((relative) => !excluded.has(relative)).sort((left, right) => left.localeCompare(right));
  const forbidden = paths.filter((relative) => relative.includes(".partial-") || relative.includes(".tmp-"));
  if (forbidden.length > 0) throw new Error(`ARTIFACT_SEAL_FORBIDDEN_PATH:${forbidden.join(",")}`);
  const files = [];
  let payloadBytes = 0;
  for (const relative of paths) {
    const bytes = await fs.readFile(path.join(root, relative));
    files.push({ path: relative, bytes: bytes.byteLength, byte_sha256: digest(bytes) });
    payloadBytes += bytes.byteLength;
  }
  return {
    file_count: files.length,
    payload_bytes: payloadBytes,
    package_payload_digest_sha256: digest(canonicalJson(files)),
    files,
  };
}

export async function validateStoredArtifactSeal(root, expectedPackageName) {
  const manifestPath = path.join(root, "manifests/package-manifest.json");
  const receiptPath = path.join(root, "validation/validation-receipt.json");
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  if (manifest.package_name !== expectedPackageName || manifest.immutable !== true || manifest.offline !== true) throw new Error("ARTIFACT_MANIFEST_BOUNDARY_INVALID");
  if (!Array.isArray(manifest.manifest_excludes) || !manifest.manifest_excludes.includes("manifests/package-manifest.json") || !manifest.manifest_excludes.includes("validation/validation-receipt.json")) throw new Error("ARTIFACT_MANIFEST_EXCLUSIONS_INVALID");
  const computed = await computeArtifactSeal(root, manifest.manifest_excludes);
  for (const key of ["file_count", "payload_bytes", "package_payload_digest_sha256"]) {
    if (manifest[key] !== computed[key]) throw new Error(`ARTIFACT_MANIFEST_MISMATCH:${key}:expected=${manifest[key]}:actual=${computed[key]}`);
  }
  const manifestByteSha256 = digest(manifestBytes);
  if (receipt.valid !== true || receipt.manifest_verified !== true || receipt.immutable !== true || receipt.offline !== true) throw new Error("ARTIFACT_VALIDATION_RECEIPT_INVALID");
  if (receipt.manifest_byte_sha256 !== manifestByteSha256 || receipt.package_payload_digest_sha256 !== computed.package_payload_digest_sha256) throw new Error("ARTIFACT_VALIDATION_RECEIPT_DIGEST_MISMATCH");
  if (receipt.external_requests !== 0 || receipt.source_payload_downloads !== 0 || receipt.production_auto_resolution_authorized !== false) throw new Error("ARTIFACT_VALIDATION_RECEIPT_BOUNDARY_INVALID");
  return { manifest, receipt, manifest_byte_sha256: manifestByteSha256, computed };
}
