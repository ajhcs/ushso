import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function compareCodePoints(left, right) {
  const a = Array.from(left, character => character.codePointAt(0));
  const b = Array.from(right, character => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('CANONICAL_JSON_NONFINITE_NUMBER');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort(compareCodePoints);
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError(`CANONICAL_JSON_UNSUPPORTED_TYPE:${typeof value}`);
}

export function canonicalDigest(domainSeparator, value) {
  return crypto.createHash('sha256').update(domainSeparator, 'utf8').update(canonicalJson(value), 'utf8').digest('hex');
}

export function membershipManifestDigest(manifest) {
  return canonicalDigest('ushso:coverage-membership-manifest:v1\n', manifest);
}

export function snapshotDigest(snapshot) {
  const payload = structuredClone(snapshot);
  delete payload.immutability.canonical_digest;
  return canonicalDigest('ushso:coverage-snapshot:v1\n', payload);
}

export function stableEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export async function sha256File(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

export async function walkFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await walkFiles(path.join(directory, entry.name), relative));
    if (entry.isFile()) files.push(relative.split(path.sep).join('/'));
  }
  return files.sort(compareCodePoints);
}

export function matrixMembershipPayload(matrix) {
  return {
    matrix_id: matrix.matrix_id,
    coverage_snapshot_id: matrix.coverage_snapshot_id,
    as_of: matrix.as_of,
    revision_pins: matrix.revision_pins,
    cells: matrix.cells.map(cell => ({
      cell_id: cell.cell_id,
      jurisdiction_id: cell.jurisdiction_id,
      source_class_id: cell.source_class_id,
      coverage_cell_state: cell.coverage_cell_state
    }))
  };
}

function pointerParts(pointer) {
  if (!pointer.startsWith('/')) throw new Error(`INVALID_JSON_POINTER:${pointer}`);
  return pointer.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

export function applyMutations(value, mutations) {
  const clone = structuredClone(value);
  for (const mutation of mutations) {
    const parts = pointerParts(mutation.path);
    let cursor = clone;
    for (const part of parts.slice(0, -1)) cursor = cursor[Array.isArray(cursor) ? Number(part) : part];
    const key = parts.at(-1);
    const resolved = Array.isArray(cursor) ? Number(key) : key;
    if (mutation.operation === 'set') cursor[resolved] = structuredClone(mutation.value);
    else if (mutation.operation === 'delete') delete cursor[resolved];
    else if (mutation.operation === 'append') cursor[resolved].push(structuredClone(mutation.value));
    else throw new Error(`UNKNOWN_MUTATION_OPERATION:${mutation.operation}`);
  }
  return clone;
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
