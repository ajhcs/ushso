import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PACKAGE_ROOT,
  canonicalJsonSha256,
  pathExists,
  publishImmutable,
  readJson,
  sha256File,
  walkFiles
} from './common.mjs';
import { validationMessage, validatorFor } from './schema.mjs';

export const MANIFEST_EXCLUDES = ['manifests/package-manifest.json', 'validation/validation-receipt.json'];

function artifactKind(relative) {
  if (relative.startsWith('schemas/')) return 'schema';
  if (relative.startsWith('fixtures/')) return 'fixture';
  if (relative.startsWith('tests/')) return 'test';
  if (relative.startsWith('tools/')) return 'tool';
  if (relative.endsWith('.md')) return 'documentation';
  return 'package_metadata';
}

function mediaType(relative) {
  if (relative.endsWith('.json')) return 'application/json';
  if (relative.endsWith('.mjs')) return 'text/javascript';
  if (relative.endsWith('.md')) return 'text/markdown';
  throw new Error(`UNSUPPORTED_MANIFEST_MEDIA_TYPE:${relative}`);
}

export async function computeManifest() {
  const paths = (await walkFiles(PACKAGE_ROOT)).filter(relative => !MANIFEST_EXCLUDES.includes(relative));
  const forbidden = paths.filter(relative => relative.includes('.partial-') || relative.split('/').some(part => ['.git', 'node_modules'].includes(part)));
  if (forbidden.length > 0) throw new Error(`UNPUBLISHABLE_PATHS:${forbidden.join(',')}`);
  const files = [];
  let payloadBytes = 0;
  for (const relative of paths) {
    const file = path.join(PACKAGE_ROOT, relative);
    const bytes = (await fs.stat(file)).size;
    const isJson = relative.endsWith('.json');
    files.push({
      path: relative,
      artifact_kind: artifactKind(relative),
      media_type: mediaType(relative),
      bytes,
      byte_sha256: await sha256File(file),
      canonical_json_sha256: isJson ? canonicalJsonSha256(await readJson(file)) : null
    });
    payloadBytes += bytes;
  }
  const packagePayloadDigest = canonicalJsonSha256(files.map(file => ({
    path: file.path,
    bytes: file.bytes,
    byte_sha256: file.byte_sha256,
    canonical_json_sha256: file.canonical_json_sha256
  })));
  return {
    manifest_version: 'identity.package-manifest.v1',
    package_name: 'ushso/identity-contract',
    package_version: '1.0.0',
    mode: 'fixture_offline',
    offline: true,
    manifest_excludes: MANIFEST_EXCLUDES,
    canonicalization: {
      algorithm_id: 'ushso.canonical-json.sorted-keys.v1',
      object_keys: 'unicode-code-point-ascending',
      array_order: 'preserved',
      encoding: 'utf-8',
      terminal_newline: false
    },
    digest_taxonomy: [
      { digest_id: 'byte_sha256', algorithm: 'sha256', applies_to: 'exact stored bytes' },
      { digest_id: 'canonical_json_sha256', algorithm: 'sha256', applies_to: 'parsed JSON under ushso.canonical-json.sorted-keys.v1' }
    ],
    file_count: files.length,
    payload_bytes: payloadBytes,
    package_payload_digest_sha256: packagePayloadDigest,
    files,
    immutable: true
  };
}

export async function buildManifest() {
  const manifest = await computeManifest();
  const validate = await validatorFor('package-manifest.schema.json');
  if (!validate(manifest)) throw new Error(`PACKAGE_MANIFEST_INVALID:${validationMessage(validate)}`);
  const target = path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json');
  if (await pathExists(target)) throw new Error('PACKAGE_MANIFEST_ALREADY_EXISTS:immutable package artifacts require a new version');
  await publishImmutable(target, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1]?.endsWith('build-manifest.mjs')) {
  buildManifest()
    .then(manifest => process.stdout.write(`${JSON.stringify({
      file_count: manifest.file_count,
      payload_bytes: manifest.payload_bytes,
      package_payload_digest_sha256: manifest.package_payload_digest_sha256
    }, null, 2)}\n`))
    .catch(error => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
