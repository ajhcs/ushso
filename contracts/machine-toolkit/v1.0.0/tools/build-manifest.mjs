import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, contentDigest, semanticContentDigest, sha256File, walkFiles, writeAtomic } from './common.mjs';

export const MANIFEST_EXCLUSIONS = Object.freeze([
  'contracts/package-manifest.json',
  'receipts/validation.json'
]);

function mediaType(file) {
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.md')) return 'text/markdown';
  return 'text/javascript';
}

export async function packageFileRows() {
  const files = (await walkFiles(ROOT))
    .filter(file => !MANIFEST_EXCLUSIONS.includes(file))
    .filter(file => !file.includes('.partial-'))
    .sort();
  const rows = [];
  for (const relative of files) {
    const absolute = path.join(ROOT, relative);
    const stat = await fs.stat(absolute);
    rows.push({
      path: relative,
      media_type: mediaType(relative),
      bytes: stat.size,
      file_sha256: await sha256File(absolute),
      canonical_json_sha256: await semanticContentDigest(absolute)
    });
  }
  return rows;
}

export function packageDigest(files) {
  return contentDigest({
    contract_version: 'observatory-machine-toolkit-package-content.v1.0.0',
    files
  });
}

export async function buildManifest() {
  const files = await packageFileRows();
  const manifest = {
    contract_version: 'observatory-machine-toolkit-package-manifest.v1.0.0',
    package: '@ushso/machine-toolkit-contract',
    version: '1.0.0',
    digest_taxonomy: 'contracts/digest-taxonomy.json',
    excluded_paths: [...MANIFEST_EXCLUSIONS],
    files,
    package_content_digest: packageDigest(files)
  };
  await writeAtomic(path.join(ROOT, 'contracts', 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = await buildManifest();
  process.stdout.write(`${JSON.stringify({ status: 'built', files: manifest.files.length, package_content_digest: manifest.package_content_digest })}\n`);
}
