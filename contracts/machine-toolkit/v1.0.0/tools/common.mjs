import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPOSITORY_ROOT = path.resolve(ROOT, '..', '..', '..');
export const CONTRACT_VERSION = 'observatory-machine-toolkit.v1.0.0';

function assertUnicode(value, pointer) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError(`JCS_LONE_SURROGATE:${pointer}`);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError(`JCS_LONE_SURROGATE:${pointer}`);
  }
}

function encode(value, pointer, ancestors) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`JCS_NON_FINITE_NUMBER:${pointer}`);
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    assertUnicode(value, pointer);
    return JSON.stringify(value);
  }
  if (!value || typeof value !== 'object') throw new TypeError(`JCS_UNSUPPORTED_TYPE:${pointer}`);
  if (ancestors.has(value)) throw new TypeError(`JCS_CYCLE:${pointer}`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((child, index) => encode(child, `${pointer}/${index}`, ancestors)).join(',')}]`;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`JCS_NON_JSON_OBJECT:${pointer}`);
    return `{${Object.keys(value).sort().map(key => {
      assertUnicode(key, pointer);
      return `${JSON.stringify(key)}:${encode(value[key], `${pointer}/${key}`, ancestors)}`;
    }).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value) {
  return encode(value, '', new WeakSet());
}

export function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function contentDigest(value) {
  return `sha256:${sha256Bytes(Buffer.from(canonicalJson(value), 'utf8'))}`;
}

export async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.partial-${process.pid}`;
  await fs.writeFile(partial, content, { flag: 'wx' });
  await fs.rename(partial, file);
}

export async function walkFiles(root, relative = '') {
  const result = [];
  for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(root, child));
    else result.push(child);
  }
  return result;
}

export async function semanticContentDigest(file) {
  if (!file.endsWith('.json')) return null;
  return contentDigest(await readJson(file));
}

export const SNAPSHOT_EXCLUDED_POINTERS = Object.freeze([
  '/request_id',
  '/response_generated_at',
  '/transport_adapter',
  '/result_snapshot_id',
  '/candidate_snapshot_id',
  '/rate_limit/remaining',
  '/rate_limit/reset_at',
  '/rate_limit/retry_after_seconds'
]);

export function snapshotBody(response) {
  const copy = structuredClone(response);
  delete copy.request_id;
  delete copy.response_generated_at;
  delete copy.transport_adapter;
  delete copy.result_snapshot_id;
  delete copy.candidate_snapshot_id;
  if (copy.rate_limit) {
    delete copy.rate_limit.remaining;
    delete copy.rate_limit.reset_at;
    delete copy.rate_limit.retry_after_seconds;
  }
  return copy;
}

export function snapshotDigest(response) {
  return contentDigest(snapshotBody(response));
}

export function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
