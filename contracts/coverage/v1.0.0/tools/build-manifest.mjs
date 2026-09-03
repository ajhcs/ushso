import fs from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_ROOT, sha256File, walkFiles, writeJson } from './common.mjs';

const excluded = new Set(['manifests/package-manifest.json', 'validation/validation-receipt.json']);
const files = [];
for (const relative of (await walkFiles(PACKAGE_ROOT)).filter(file => !excluded.has(file))) {
  const file = path.join(PACKAGE_ROOT, relative);
  files.push({
    path: relative,
    bytes: (await fs.stat(file)).size,
    sha256: await sha256File(file)
  });
}
const manifest = {
  package: '@ushso/coverage-contract',
  version: '1.0.0',
  digest_algorithm: 'package_file_bytes_sha256/v1',
  files
};
await writeJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'), manifest);
process.stdout.write(`Wrote coverage package manifest for ${files.length} files.\n`);
