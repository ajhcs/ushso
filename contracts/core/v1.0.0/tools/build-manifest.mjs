import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, publishImmutable, sha256File, walkFiles } from './common.mjs';
import { loadSchemas, schemaError } from './schema.mjs';

export const EXCLUDES = ['manifests/package-manifest.json', 'validation/validation-receipt.json'];

export async function buildManifest() {
  const paths = (await walkFiles(ROOT)).filter(file => !EXCLUDES.includes(file));
  const prohibited = paths.filter(file => file.includes('.partial-') || file.split('/').some(part => ['node_modules', '.git'].includes(part)));
  if (prohibited.length) throw new Error(`UNPUBLISHABLE_PATHS: ${prohibited.join(',')}`);
  const files = [];
  let payloadBytes = 0;
  for (const relative of paths) {
    const file = path.join(ROOT, relative);
    const stat = await fs.stat(file);
    files.push({ path: relative, bytes: stat.size, sha256: await sha256File(file) });
    payloadBytes += stat.size;
  }
  const manifest = { manifest_version: 'observatory-core-package-manifest.v1', package_version: '1.0.0', offline: true, excludes: EXCLUDES, file_count: files.length, payload_bytes: payloadBytes, files, immutable: true };
  const { ajv } = await loadSchemas();
  const schema = JSON.parse(await fs.readFile(path.join(ROOT, 'schemas', 'package-manifest.schema.json')));
  const validate = ajv.getSchema(schema.$id);
  if (!validate(manifest)) throw new Error(`PACKAGE_MANIFEST_INVALID: ${schemaError(validate)}`);
  await publishImmutable(path.join(ROOT, 'manifests', 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1]?.endsWith('build-manifest.mjs')) {
  try { const value = await buildManifest(); process.stdout.write(`${JSON.stringify({ file_count: value.file_count, payload_bytes: value.payload_bytes }, null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; }
}
