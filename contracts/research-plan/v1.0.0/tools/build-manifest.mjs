import fs from 'node:fs/promises';
import path from 'node:path';

import { canonicalDigest, PACKAGE_ROOT, sha256File, walkFiles, writeAtomic } from './common.mjs';

const EXCLUDED = new Set([
  'manifests/package-manifest.json',
  'validation/validation-receipt.json'
]);

function mediaType(file) {
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.md')) return 'text/markdown';
  return 'text/javascript';
}

const paths = (await walkFiles(PACKAGE_ROOT))
  .filter(file => !EXCLUDED.has(file))
  .sort();
const artifacts = [];
for (const relative of paths) {
  const absolute = path.join(PACKAGE_ROOT, relative);
  const stat = await fs.stat(absolute);
  artifacts.push({
    path: relative,
    sha256: await sha256File(absolute),
    bytes: stat.size,
    media_type: mediaType(relative)
  });
}

const manifest = {
  contract_version: 'observatory-research-plan-package-manifest.v1.0.0',
  package_name: '@ushso/research-plan-contract',
  package_version: '1.0.0',
  schema_dialect: 'https://json-schema.org/draft/2020-12/schema',
  canonicalization_algorithm: 'ushso-canonical-json.v1.0.0',
  compatibility: {
    stability: 'immutable',
    supersedes: null,
    deprecated: false,
    unexpected_properties: 'reject'
  },
  artifact_hash_kind: 'raw_file_bytes',
  artifacts,
  manifest_digest: ''
};
const body = structuredClone(manifest);
delete body.manifest_digest;
manifest.manifest_digest = canonicalDigest(body);

await writeAtomic(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`wrote manifest for ${artifacts.length} artifacts\n`);
