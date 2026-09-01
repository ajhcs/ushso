import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '..', '..', '..');

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function codePointCompare(left, right) {
  const a = Array.from(left, character => character.codePointAt(0));
  const b = Array.from(right, character => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('NONFINITE_CANONICAL_NUMBER');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(codePointCompare).map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError(`UNSUPPORTED_CANONICAL_TYPE:${typeof value}`);
}

export function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function canonicalSha256(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), 'utf8'));
}

export async function sha256File(file) {
  return sha256Bytes(await fs.readFile(file));
}

export async function pathExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export async function walkFiles(directory, prefix = '') {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) output.push(...await walkFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) output.push(relative.split(path.sep).join('/'));
  }
  return output.sort(codePointCompare);
}

export async function treeReceipt(directory) {
  const files = [];
  for (const relative of await walkFiles(directory)) {
    const absolute = path.join(directory, relative);
    const bytes = await fs.readFile(absolute);
    files.push({ path: relative, bytes: bytes.length, sha256: sha256Bytes(bytes) });
  }
  return { file_count: files.length, files, tree_sha256: canonicalSha256(files) };
}

export async function selectedFileReceipt(directory, predicate) {
  const files = [];
  for (const relative of (await walkFiles(directory)).filter(predicate)) {
    const absolute = path.join(directory, relative);
    const bytes = await fs.readFile(absolute);
    files.push({ path: relative, bytes: bytes.length, sha256: sha256Bytes(bytes) });
  }
  return { file_count: files.length, files, tree_sha256: canonicalSha256(files) };
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.partial-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(temporary, file);
}

export function stableEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
