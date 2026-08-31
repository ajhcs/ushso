import { createHash } from 'node:crypto';
import { readFile, readdir, rename, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, contentFingerprint } from '../src/canonical.mjs';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXCLUDED_MANIFEST_PATHS = Object.freeze(['manifests/package-manifest.json', 'validation/validation-receipt.json']);

export async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function writeAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.partial-${process.pid}`;
  await writeFile(partial, value, { flag: 'wx' });
  await rename(partial, file);
}

export async function walk(relative = '') {
  const directory = path.join(PACKAGE_ROOT, relative);
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await walk(child));
    else result.push(child);
  }
  return result;
}

export async function fileDescriptor(relative) {
  const file = path.join(PACKAGE_ROOT, relative);
  const bytes = (await stat(file)).size;
  const json = relative.endsWith('.json') ? JSON.parse(await readFile(file, 'utf8')) : null;
  return {
    path: relative,
    bytes,
    file_sha256: await sha256File(file),
    content_fingerprint: json === null ? null : contentFingerprint(json)
  };
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function canonicalEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
