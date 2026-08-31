import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBenchmarkArtifacts, packagePaths } from './benchmark-definition.mjs';
import { canonicalJson, prettyJson, sha256, sha256Id } from './common.mjs';

const excludedFromPackageManifest = new Set(['manifests/package-manifest.json']);

async function walk(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await walk(path.join(directory, entry.name), relative));
    else if (!excludedFromPackageManifest.has(relative)) result.push(relative);
  }
  return result.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

export async function buildPackage({ write = true } = {}) {
  const { artifacts, manifest: benchmarkManifest } = await buildBenchmarkArtifacts();
  if (write) {
    for (const [relativePath, bytes] of artifacts) {
      const absolutePath = path.join(packagePaths.packageRoot, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, bytes);
    }
  }
  const files = await walk(packagePaths.packageRoot);
  const packageArtifacts = [];
  for (const relativePath of files) {
    const generated = artifacts.get(relativePath);
    const bytes = generated ?? await fs.readFile(path.join(packagePaths.packageRoot, relativePath));
    packageArtifacts.push({ path: relativePath, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) });
  }
  const packageManifest = {
    package_manifest_version: 'observatory-planner-benchmark-package-manifest.v1.0.0',
    package_id: 'observatory-planner-benchmark.v1.0.0',
    benchmark_manifest_digest: benchmarkManifest.manifest_digest,
    canonicalization: 'ushso-canonical-json.v1.0.0',
    artifacts: packageArtifacts
  };
  packageManifest.manifest_digest = sha256Id(canonicalJson(packageManifest));
  const packageManifestBytes = prettyJson(packageManifest);
  if (write) await fs.writeFile(path.join(packagePaths.packageRoot, 'manifests/package-manifest.json'), packageManifestBytes);
  return { benchmarkManifest, packageManifest, artifacts };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await buildPackage({ write: true });
  process.stdout.write(`${JSON.stringify({
    package_id: result.packageManifest.package_id,
    benchmark_manifest_digest: result.benchmarkManifest.manifest_digest,
    package_manifest_digest: result.packageManifest.manifest_digest,
    artifact_count: result.packageManifest.artifacts.length
  })}\n`);
}
