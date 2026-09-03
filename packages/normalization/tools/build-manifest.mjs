#!/usr/bin/env node
import path from 'node:path';
import { EXCLUDED_MANIFEST_PATHS, PACKAGE_ROOT, fileDescriptor, stableJson, walk, writeAtomic } from './common.mjs';

const files = (await walk()).filter(relative => !EXCLUDED_MANIFEST_PATHS.includes(relative));
const manifest = {
  manifest_version: 'ushso-normalization-package-manifest.v1.0.0',
  package: '@ushso/normalization',
  version: '1.0.0',
  digest_taxonomy: {
    file_sha256: 'SHA-256 over exact file bytes',
    content_fingerprint: 'SHA-256 over canonical JSON for JSON artifacts; null for non-JSON'
  },
  files: await Promise.all(files.map(fileDescriptor))
};
await writeAtomic(path.join(PACKAGE_ROOT, 'manifests/package-manifest.json'), stableJson(manifest));
process.stdout.write(`${JSON.stringify({ status: 'pass', files: files.length })}\n`);
