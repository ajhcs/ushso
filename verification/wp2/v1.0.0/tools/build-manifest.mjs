import fs from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_ROOT, sha256Bytes, walkFiles, writeJson } from './common.mjs';

const excluded = new Set(['manifests/package-manifest.json', 'validation/validation-receipt.json']);
const files = [];
for (const relative of (await walkFiles(PACKAGE_ROOT)).filter(file => !excluded.has(file))) {
  const bytes = await fs.readFile(path.join(PACKAGE_ROOT, relative));
  files.push({ path: relative, bytes: bytes.length, sha256: sha256Bytes(bytes) });
}
await writeJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'), {
  manifest_version: 'ushso-wp2-verification-package-manifest.v1.0.0',
  package_name: '@ushso/wp2-verification',
  package_version: '1.0.0',
  digest_taxonomy: {
    file_sha256: 'SHA-256 over exact stored file bytes',
    aggregate_receipt_pins: 'Exact file SHA-256 and canonical content receipts remain distinct'
  },
  excludes: [...excluded],
  file_count: files.length,
  payload_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  files
});
process.stdout.write(`Wrote WP2 verification manifest for ${files.length} files.\n`);
