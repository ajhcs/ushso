import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalJsonSha256, PACKAGE_ROOT, readJson, sha256File, walkFiles, writeDeterministicJson } from './common.mjs';

const EXCLUDED = new Set(['manifests/package-manifest.json', 'validation/validation-receipt.json']);

function mediaType(relative) {
  if (relative.endsWith('.json')) return 'application/json';
  if (relative.endsWith('.md')) return 'text/markdown';
  return 'text/javascript';
}

export async function buildManifest() {
  const relatives = (await walkFiles(PACKAGE_ROOT)).filter(relative => !EXCLUDED.has(relative));
  const files = [];
  let payloadBytes = 0;
  for (const relative of relatives) {
    const absolute = path.join(PACKAGE_ROOT, relative);
    const stats = await fs.stat(absolute);
    const isJson = relative.endsWith('.json');
    files.push({
      path: relative,
      media_type: mediaType(relative),
      bytes: stats.size,
      raw_file_sha256: await sha256File(absolute),
      canonical_json_sha256: isJson ? canonicalJsonSha256(await readJson(absolute)) : null
    });
    payloadBytes += stats.size;
  }
  const manifest = {
    manifest_version: 'ingestion-package-manifest.v1',
    package: { name: '@ushso/ingestion-contract', version: '1.0.0', immutable: true },
    schema_dialect: 'https://json-schema.org/draft/2020-12/schema',
    canonicalization: {
      algorithm: 'ushso-canonical-json', version: '1', encoding: 'UTF-8',
      object_key_order: 'Unicode-code-point-lexicographic', array_order: 'preserved', transport_exclusions: []
    },
    digest_taxonomy: [
      { digest_type: 'raw_file_sha256', algorithm: 'SHA-256', scope: 'exact stored file bytes' },
      { digest_type: 'canonical_json_sha256', algorithm: 'SHA-256 over ushso-canonical-json v1 UTF-8 bytes', scope: 'parsed JSON value; not a file-byte digest' }
    ],
    compatibility: { predecessor: null, unexpected_properties: 'reject', enum_extension: 'breaking_without_version_change', deprecation_state: 'current' },
    file_count: files.length,
    payload_bytes: payloadBytes,
    files
  };
  await writeDeterministicJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'), manifest);
  return manifest;
}

if (process.argv[1]?.endsWith('build-manifest.mjs')) {
  buildManifest().then(manifest => process.stdout.write(`${JSON.stringify({ valid: true, file_count: manifest.file_count, payload_bytes: manifest.payload_bytes }, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
