import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ZERO_SHA256 = `sha256:${'0'.repeat(64)}`;

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function assertJsonString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('CANONICAL_JSON_LONE_SURROGATE');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('CANONICAL_JSON_LONE_SURROGATE');
    }
  }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    assertJsonString(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError('CANONICAL_JSON_NUMBER_MUST_BE_SAFE_INTEGER');
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort(compareUtf8);
    return `{${keys.map(key => `${canonicalJson(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError(`CANONICAL_JSON_UNSUPPORTED_TYPE:${typeof value}`);
}

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function contentFingerprint(value) {
  return `sha256:${sha256Bytes(Buffer.from(canonicalJson(value), 'utf8'))}`;
}

export function fingerprintTruthRevision(row) {
  const copy = structuredClone(row);
  delete copy.canonical_content_fingerprint;
  return contentFingerprint(copy);
}

export function hydrateFingerprints(bundle) {
  const copy = structuredClone(bundle);
  for (const [collection, rows] of Object.entries(copy)) {
    if (collection === 'bundle_version') continue;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) row.canonical_content_fingerprint = fingerprintTruthRevision(row);
  }
  return copy;
}

export function recordRevisionId(row) {
  return row.revision_id;
}

export async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.partial-${process.pid}`;
  await fs.writeFile(partial, content, { flag: 'wx' });
  await fs.rename(partial, file);
}

export async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export async function walkFiles(root, relative = '') {
  const rows = [];
  for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => compareUtf8(a.name, b.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) rows.push(...await walkFiles(root, child));
    else rows.push(child);
  }
  return rows;
}

export async function semanticContentFingerprint(file) {
  if (file.endsWith('.json')) return contentFingerprint(await readJson(file));
  if (file.endsWith('.jsonl')) {
    const text = await fs.readFile(file, 'utf8');
    const rows = text.split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    return contentFingerprint(rows);
  }
  return null;
}
