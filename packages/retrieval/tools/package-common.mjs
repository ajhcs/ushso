import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '../..');

export function assertFixtureOnly(argv) {
  if (argv.includes('--full')) throw new Error('FULL_MODE_UNSUPPORTED: retrieval v1.0.0 is offline and fixture-only');
  if (!argv.includes('--fixture')) throw new Error('FIXTURE_FLAG_REQUIRED: pass --fixture explicitly');
  const forbidden = argv.find(value => ['--fetch', '--network', '--refresh-http', '--deploy'].includes(value));
  if (forbidden) throw new Error(`NETWORK_OR_DEPLOYMENT_FORBIDDEN: ${forbidden}`);
}

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function readJsonl(filePath, maxBytes = 32 * 1024 * 1024) {
  const stats = await fs.stat(filePath);
  if (stats.size > maxBytes) throw new Error(`BOUNDED_INPUT_EXCEEDED: ${filePath} is ${stats.size} bytes`);
  const text = await fs.readFile(filePath, 'utf8');
  return text.trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`INVALID_JSONL: ${filePath}:${index + 1}: ${error.message}`);
    }
  });
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function jsonl(values) {
  return `${values.map(stableJson).join('\n')}\n`;
}

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function publishImmutable(relativePath, content) {
  const filePath = path.join(PACKAGE_ROOT, relativePath);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (await pathExists(filePath)) {
    const current = await fs.readFile(filePath);
    if (current.equals(bytes)) return { relative_path: relativePath.replaceAll('\\', '/'), reused: true, bytes: bytes.length, sha256: sha256Bytes(bytes) };
    throw new Error(`IMMUTABLE_OUTPUT_CONFLICT: ${relativePath}`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.partial-${process.pid}`;
  await fs.writeFile(temporary, bytes, { flag: 'wx' });
  await fs.rename(temporary, filePath);
  return { relative_path: relativePath.replaceAll('\\', '/'), reused: false, bytes: bytes.length, sha256: sha256Bytes(bytes) };
}

export function packageRelative(filePath) {
  return path.relative(PACKAGE_ROOT, filePath).replaceAll('\\', '/');
}

export function projectRelative(filePath) {
  return path.relative(PROJECT_ROOT, filePath).replaceAll('\\', '/');
}

export function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`DUPLICATE_${label.toUpperCase().replaceAll(' ', '_')}: ${value}`);
    seen.add(value);
  }
}
