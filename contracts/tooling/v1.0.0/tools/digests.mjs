import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { canonicalJsonBytes, canonicalizeJson } from './canonical-json.mjs';
import { parseStrictJson } from './strict-json.mjs';

export const DIGEST_TAXONOMY = Object.freeze({
  taxonomy_version: 'ushso.digest-taxonomy.v1',
  algorithm: 'sha256',
  value_encoding: 'lowercase-hex',
  digest_types: Object.freeze({
    byte_sha256: 'SHA-256 over exact stored bytes',
    canonical_json_sha256: 'SHA-256 over RFC 8785 canonical UTF-8 JSON bytes',
    jsonl_set_sha256: 'SHA-256 over a count-and-length-framed, sorted set of RFC 8785 JSON rows',
    package_sha256: 'SHA-256 over the RFC 8785 canonical package inventory projection'
  })
});

function bytes(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new TypeError('DIGEST_BYTES_REQUIRED');
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function typed(digestType, value) {
  return Object.freeze({ digest_type: digestType, algorithm: 'sha256', value });
}

export function byteDigest(value) {
  return typed('byte_sha256', hash(bytes(value)));
}

export async function byteDigestFile(file) {
  return byteDigest(await fs.readFile(file));
}

export function canonicalJsonDigest(value, options = {}) {
  return typed('canonical_json_sha256', hash(canonicalJsonBytes(value, options)));
}

export function canonicalJsonDigestFromText(text, options = {}) {
  return canonicalJsonDigest(parseStrictJson(text, options), options);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function parseJsonlRows(text, options = {}) {
  if (typeof text !== 'string') throw new TypeError('JSONL_TEXT_REQUIRED');
  if (text.includes('\r') && !text.includes('\r\n')) throw new TypeError('JSONL_BARE_CR_NOT_ALLOWED');
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0) throw new TypeError('JSONL_EMPTY');
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].length === 0) throw new TypeError(`JSONL_BLANK_LINE:${index + 1}`);
    rows.push(parseStrictJson(lines[index], options));
  }
  return rows;
}

export function canonicalJsonlSetBytes(input, options = {}) {
  const rows = typeof input === 'string' ? parseJsonlRows(input, options) : input;
  if (!Array.isArray(rows) || rows.length === 0) throw new TypeError('JSONL_ROWS_REQUIRED');
  const canonicalRows = rows.map(row => canonicalizeJson(row, options)).sort(compareUtf8);
  for (let index = 1; index < canonicalRows.length; index += 1) {
    if (canonicalRows[index] === canonicalRows[index - 1]) throw new TypeError('JSONL_SET_DUPLICATE_ROW');
  }
  const framed = canonicalRows.map(row => `${Buffer.byteLength(row, 'utf8')}:${row}\n`).join('');
  return Buffer.from(`ushso-jsonl-set-v1\n${canonicalRows.length}\n${framed}`, 'utf8');
}

export function jsonlSetDigest(input, options = {}) {
  return typed('jsonl_set_sha256', hash(canonicalJsonlSetBytes(input, options)));
}

export function packageDigest(fileEntries) {
  if (!Array.isArray(fileEntries) || fileEntries.length === 0) throw new TypeError('PACKAGE_ENTRIES_REQUIRED');
  const paths = new Set();
  const projection = fileEntries.map(entry => {
    if (!entry || typeof entry.path !== 'string' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new TypeError('PACKAGE_ENTRY_INVALID');
    }
    if (paths.has(entry.path)) throw new TypeError(`PACKAGE_DUPLICATE_PATH:${entry.path}`);
    paths.add(entry.path);
    assertTypedDigest(entry.byte_digest, 'byte_sha256');
    if (entry.semantic_kind === 'none') {
      if (entry.semantic_digest !== null && entry.semantic_digest !== undefined) throw new TypeError(`PACKAGE_SEMANTIC_DIGEST_UNEXPECTED:${entry.path}`);
    } else if (entry.semantic_kind === 'canonical_json') {
      assertTypedDigest(entry.semantic_digest, 'canonical_json_sha256');
    } else if (entry.semantic_kind === 'jsonl_set') {
      assertTypedDigest(entry.semantic_digest, 'jsonl_set_sha256');
    } else {
      throw new TypeError(`PACKAGE_SEMANTIC_KIND_INVALID:${entry.path}`);
    }
    return {
      path: entry.path,
      bytes: entry.bytes,
      byte_digest: entry.byte_digest,
      semantic_digest: entry.semantic_digest ?? null,
      semantic_kind: entry.semantic_kind ?? 'none'
    };
  }).sort((left, right) => compareUtf8(left.path, right.path));
  return typed('package_sha256', hash(canonicalJsonBytes({ package_inventory_version: 1, files: projection })));
}

export function assertTypedDigest(value, expectedType) {
  if (!value || value.digest_type !== expectedType || value.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/u.test(value.value)) {
    throw new TypeError(`INVALID_TYPED_DIGEST:${expectedType}`);
  }
  return value;
}

export function digestEquals(left, right) {
  return left?.digest_type === right?.digest_type
    && left?.algorithm === right?.algorithm
    && left?.value === right?.value;
}

// Stable public names. The type remains part of every returned digest envelope.
export const byteSha256 = byteDigest;
export const canonicalSha256 = canonicalJsonDigest;
export const jsonlSetSha256 = jsonlSetDigest;
export const packageContentSha256 = packageDigest;
