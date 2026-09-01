import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageManifest, writeJsonAtomic } from '../src/manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = await createPackageManifest({
  root: ROOT,
  packageName: '@ushso/contract-tooling',
  packageVersion: '1.0.0'
});
await writeJsonAtomic(path.join(ROOT, 'manifests', 'package-manifest.json'), manifest);
console.log(JSON.stringify({ ok: true, file_count: manifest.file_count, payload_bytes: manifest.payload_bytes, package_content_digest: manifest.package_content_digest }));
