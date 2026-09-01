import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, semanticContentFingerprint, sha256File, walkFiles, writeAtomic } from './common.mjs';
import { loadSchemas, schemaErrors } from './schema.mjs';

export const EXCLUDED_PATHS = Object.freeze([
  'manifests/package-manifest.json',
  'validation/validation-receipt.json'
]);

export async function buildManifest() {
  const paths = (await walkFiles(ROOT)).filter(relative => !EXCLUDED_PATHS.includes(relative));
  const prohibited = paths.filter(relative => relative.includes('.partial-') || relative.split('/').some(segment => ['node_modules', '.git'].includes(segment)));
  if (prohibited.length) throw new Error(`UNPUBLISHABLE_PATHS:${prohibited.join(',')}`);
  const files = [];
  let payloadBytes = 0;
  for (const relative of paths) {
    const absolute = path.join(ROOT, relative);
    const stat = await fs.stat(absolute);
    files.push({
      path: relative,
      bytes: stat.size,
      file_sha256: await sha256File(absolute),
      content_fingerprint: await semanticContentFingerprint(absolute)
    });
    payloadBytes += stat.size;
  }
  const manifest = {
    manifest_version: 'observatory-core-package-manifest.v2.0.0',
    package_version: '2.0.0',
    immutable: true,
    digest_contract: {
      file_sha256: 'SHA-256 of the exact bytes stored at path',
      content_fingerprint: 'SHA-256 of canonical JSON value bytes, independent of JSON whitespace and object-key order',
      canonical_json_algorithm: 'ushso-canonical-json-v1',
      array_order: 'preserved'
    },
    excluded_paths: [...EXCLUDED_PATHS],
    file_count: files.length,
    payload_bytes: payloadBytes,
    files
  };
  const { ajv } = await loadSchemas();
  const validate = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/package-manifest.schema.json');
  if (!validate(manifest)) throw new Error(`PACKAGE_MANIFEST_INVALID:${JSON.stringify(schemaErrors(validate))}`);
  await writeAtomic(path.join(ROOT, 'manifests', 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1]?.endsWith('build-manifest.mjs')) {
  try {
    const manifest = await buildManifest();
    process.stdout.write(`${JSON.stringify({ valid: true, file_count: manifest.file_count, payload_bytes: manifest.payload_bytes }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
