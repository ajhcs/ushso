import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = resolve(packageRoot, "../../..");

export function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortDeep(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortDeep(value));
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value) {
  return sha256Bytes(canonicalJson(value));
}

export function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function repoPath(relativePath) {
  if (relativePath.startsWith("/") || relativePath.includes("..")) {
    throw new Error(`unsafe repository-relative path: ${relativePath}`);
  }
  return resolve(repoRoot, relativePath);
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function clone(value) {
  return structuredClone(value);
}

export function withCanonicalDigest(value, field = "digest_sha256") {
  const copy = clone(value);
  delete copy[field];
  return { ...copy, [field]: `sha256:${sha256Json(copy)}` };
}

export function verifyCanonicalDigest(value, field = "digest_sha256") {
  const copy = clone(value);
  const actual = copy[field];
  delete copy[field];
  const expected = `sha256:${sha256Json(copy)}`;
  return { ok: actual === expected, actual, expected };
}

export function isSha256(value) {
  return typeof value === "string" && /^(?:sha256:)?[a-f0-9]{64}$/.test(value);
}
