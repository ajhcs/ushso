import fs from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_ROOT, sha256File, walkFiles, writeJson } from './common.mjs';
import { loadSchemas, validationMessage, validatorFor } from './schema.mjs';

export const MANIFEST_EXCLUDES = Object.freeze([
  'manifests/package-manifest.json',
  'validation/validation-receipt.json'
]);

export async function buildManifest() {
  const paths = (await walkFiles(PACKAGE_ROOT)).filter(relative => !MANIFEST_EXCLUDES.includes(relative));
  const invalid = paths.filter(relative => relative.endsWith('.partial') || relative.includes('.partial-'));
  if (invalid.length) throw new Error(`UNPUBLISHABLE_PARTIAL_FILE:${invalid.join(',')}`);
  const files = [];
  let payloadBytes = 0;
  for (const relative of paths) {
    const absolute = path.join(PACKAGE_ROOT, relative);
    const stat = await fs.stat(absolute);
    payloadBytes += stat.size;
    files.push({ path: relative, bytes: stat.size, sha256: await sha256File(absolute) });
  }
  const manifest = {
    manifest_version: 'publication-package-manifest.v1',
    package_name: 'ushso/publication-contract',
    package_version: '1.0.0',
    canonicalization: 'exact-file-bytes',
    manifest_excludes: [...MANIFEST_EXCLUDES],
    file_count: files.length,
    payload_bytes: payloadBytes,
    files,
    immutable: true
  };
  const { ajv } = await loadSchemas();
  const validate = validatorFor(ajv, 'package-manifest.schema.json');
  if (!validate(manifest)) throw new Error(`PACKAGE_MANIFEST_SCHEMA_INVALID:${validationMessage(validate)}`);
  await writeJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'), manifest);
  return manifest;
}

if (process.argv[1]?.endsWith('build-manifest.mjs')) {
  buildManifest()
    .then(manifest => process.stdout.write(`${JSON.stringify({ file_count: manifest.file_count, payload_bytes: manifest.payload_bytes }, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
