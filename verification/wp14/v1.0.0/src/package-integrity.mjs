import { readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { packageRoot, repoRoot, sha256File, withCanonicalDigest } from "./common.mjs";

const excluded = new Set([
  "verification/wp14/v1.0.0/receipts/implementation-file-manifest.json",
  "verification/wp14/v1.0.0/receipts/wp14-verification.json",
]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

export function buildImplementationManifest() {
  const paths = [...walk(packageRoot), resolve(repoRoot, "docs/WP14_CUTOVER_RETIREMENT_RUNBOOK.md")]
    .map((path) => ({ absolute: path, relative: relative(repoRoot, path).replaceAll("\\", "/") }))
    .filter(({ relative: path }) => !excluded.has(path))
    .sort((left, right) => left.relative.localeCompare(right.relative));
  const files = paths.map(({ absolute, relative: path }) => ({
    path,
    bytes: statSync(absolute).size,
    sha256: `sha256:${sha256File(absolute)}`,
  }));
  return withCanonicalDigest({
    schema_version: "ushso-wp14-implementation-file-manifest.v1.0.0",
    generated_at: "2026-08-30T00:00:00.000Z",
    exclusions: [...excluded].sort(),
    file_count: files.length,
    files,
  }, "manifest_sha256");
}
