import fs from 'node:fs/promises';
import path from 'node:path';
import { byteSha256, canonicalSha256, jsonlSetSha256, packageContentSha256 } from './digests.mjs';
import { canonicalizeJson } from './canonical-json.mjs';
import { parseStrictJson } from './strict-json.mjs';

export const MANIFEST_EXCLUDES = Object.freeze([
  'manifests/package-manifest.json',
  'validation/validation-receipt.json'
]);

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function safeRelative(value) {
  return typeof value === 'string'
    && value.length > 0
    && !path.posix.isAbsolute(value)
    && !value.split('/').includes('..')
    && !value.includes('\\');
}

async function walk(root, relative = '') {
  const directory = path.join(root, relative);
  const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) => compareUtf8(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isSymbolicLink()) throw new Error(`PACKAGE_SYMLINK_FORBIDDEN:${child}`);
    if (entry.isDirectory()) files.push(...await walk(root, child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`PACKAGE_SPECIAL_FILE_FORBIDDEN:${child}`);
  }
  return files;
}

function mediaType(file) {
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.jsonl')) return 'application/x-ndjson';
  if (file.endsWith('.mjs')) return 'text/javascript';
  if (file.endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}

function artifactKind(file) {
  if (file.startsWith('schemas/')) return 'schema';
  if (file.startsWith('fixtures/')) return 'fixture';
  if (file.startsWith('tests/')) return 'test';
  if (file.startsWith('src/') || file.startsWith('tools/')) return 'tool';
  if (file.endsWith('.md')) return 'documentation';
  if (file === 'package.json' || file.startsWith('contracts/')) return 'package_metadata';
  return 'other';
}

export async function inventoryPackageFiles(root, { excludes = MANIFEST_EXCLUDES } = {}) {
  for (const exclusion of excludes) if (!safeRelative(exclusion)) throw new Error(`MANIFEST_EXCLUSION_UNSAFE:${exclusion}`);
  const excluded = new Set(excludes);
  const names = (await walk(root)).filter(name => !excluded.has(name)).sort(compareUtf8);
  const files = [];
  for (const name of names) {
    if (!safeRelative(name)) throw new Error(`MANIFEST_PATH_UNSAFE:${name}`);
    const content = await fs.readFile(path.join(root, name));
    const entry = {
      path: name,
      artifact_kind: artifactKind(name),
      media_type: mediaType(name),
      bytes: content.byteLength,
      byte_digest: byteSha256(content),
      semantic_kind: 'none',
      semantic_digest: null
    };
    if (entry.media_type === 'application/json') {
      entry.semantic_kind = 'canonical_json';
      entry.semantic_digest = canonicalSha256(parseStrictJson(content.toString('utf8')));
    } else if (entry.media_type === 'application/x-ndjson') {
      entry.semantic_kind = 'jsonl_set';
      entry.semantic_digest = jsonlSetSha256(content.toString('utf8'));
    }
    files.push(entry);
  }
  return files;
}

export async function createPackageManifest({ root, packageName, packageVersion, excludes = MANIFEST_EXCLUDES }) {
  const files = await inventoryPackageFiles(root, { excludes });
  if (files.length === 0) throw new Error('PACKAGE_MANIFEST_EMPTY');
  return {
    manifest_version: 'ushso.package-manifest.v1',
    package_name: packageName,
    package_version: packageVersion,
    canonicalization: 'rfc8785-jcs',
    digest_taxonomy_version: 'ushso.digest-taxonomy.v1',
    excludes: [...excludes],
    file_count: files.length,
    payload_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
    package_content_digest: packageContentSha256(files),
    immutable: true
  };
}

export async function verifyPackageManifest({ root, manifest }) {
  const packageJson = parseStrictJson(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const expected = await createPackageManifest({
    root,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    excludes: manifest.excludes
  });
  const actualText = canonicalizeJson(manifest);
  const expectedText = canonicalizeJson(expected);
  return { ok: actualText === expectedText, expected, actual: manifest };
}

export async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.partial-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(temporary, file);
}
