import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('CANONICAL_JSON_UNSUPPORTED_VALUE');
  return encoded;
}

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonicalJsonSha256(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), 'utf8'));
}

export async function sha256File(file) {
  return sha256Bytes(await fs.readFile(file));
}

export async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export async function walkFiles(root, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await walkFiles(path.join(root, entry.name), relative));
    else if (entry.isFile()) files.push(relative.split(path.sep).join('/'));
  }
  return files.sort();
}

export async function writeDeterministicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.partial-${process.pid}`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, file);
}

export function deepClone(value) {
  return structuredClone(value);
}

function decodePointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function applyMutations(value, mutations) {
  const copy = deepClone(value);
  for (const mutation of mutations) {
    const parts = mutation.path.split('/').slice(1).map(decodePointerToken);
    let target = copy;
    for (const part of parts.slice(0, -1)) {
      if (target === null || typeof target !== 'object' || !(part in target)) throw new Error(`MUTATION_PATH_NOT_FOUND:${mutation.path}`);
      target = target[part];
    }
    const key = parts.at(-1);
    if (mutation.op === 'delete') delete target[key];
    else target[key] = deepClone(mutation.value);
  }
  return copy;
}
