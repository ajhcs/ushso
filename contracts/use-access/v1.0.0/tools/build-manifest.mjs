import fs from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_ROOT, publishImmutable, sha256File, walkFiles } from './common.mjs';
import { validationMessage, validatorFor } from './schema.mjs';

const EXCLUDES = ['manifests/package-manifest.json', 'validation/validation-receipt.json'];

export async function buildManifest() {
  const paths = (await walkFiles(PACKAGE_ROOT)).filter(relative => !EXCLUDES.includes(relative));
  const invalid = paths.filter(relative => relative.endsWith('.partial') || relative.includes('.partial-') || relative.split('/').some(part => ['node_modules', '.git'].includes(part)));
  if (invalid.length) throw new Error(`UNPUBLISHABLE_PATHS:${invalid.join(',')}`);
  const files = [];
  let payloadBytes = 0;
  for (const relative of paths) {
    const file = path.join(PACKAGE_ROOT, relative);
    const stat = await fs.stat(file);
    files.push({ path: relative, bytes: stat.size, sha256: await sha256File(file) });
    payloadBytes += stat.size;
  }
  const manifest = {
    manifest_version: 'use-access-package-manifest.v1', package_name: 'observatory/use-access-contract', package_version: '1.0.0',
    mode: 'fixture_offline', offline: true, manifest_excludes: EXCLUDES, file_count: files.length, payload_bytes: payloadBytes, files, immutable: true
  };
  const { validate } = await validatorFor('package-manifest.schema.json');
  if (!validate(manifest)) throw new Error(`PACKAGE_MANIFEST_INVALID:${validationMessage(validate)}`);
  await publishImmutable(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1]?.endsWith('build-manifest.mjs')) buildManifest()
  .then(manifest => process.stdout.write(`${JSON.stringify({ file_count: manifest.file_count, payload_bytes: manifest.payload_bytes }, null, 2)}\n`))
  .catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
