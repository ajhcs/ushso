import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function sha256Bytes(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
export async function sha256File(file) { const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
export async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
export async function publishImmutable(file, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (await exists(file)) {
    if ((await fs.readFile(file)).equals(bytes)) return { reused: true };
    throw new Error(`IMMUTABLE_OUTPUT_CONFLICT: ${path.relative(ROOT, file)}`);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.partial-${process.pid}`;
  await fs.writeFile(partial, bytes, { flag: 'wx' });
  await fs.rename(partial, file);
  return { reused: false };
}
export async function walkFiles(root, relative = '') {
  const result = [];
  for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(root, child)); else result.push(child);
  }
  return result;
}
export function requireFixture(argv) {
  if (argv.includes('--full')) throw new Error('FULL_MODE_UNSUPPORTED');
  if (!argv.includes('--fixture')) throw new Error('FIXTURE_FLAG_REQUIRED');
  const prohibited = argv.find(value => ['--network', '--fetch', '--refresh-http', '--execute-coverage'].includes(value));
  if (prohibited) throw new Error(`PROHIBITED_MODE: ${prohibited}`);
}
export function recordId(row) {
  return row.assertion_id ?? row.observation_id ?? row.evidence_id ?? row.relationship_id ?? row.object_id;
}
