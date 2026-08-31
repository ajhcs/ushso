import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '..', '..', '..');

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function sha256File(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

export async function pathExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export async function walkFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...await walkFiles(path.join(dir, entry.name), relative));
    else if (entry.isFile()) out.push(relative.split(path.sep).join('/'));
  }
  return out.sort();
}

export async function publishImmutable(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.partial-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  await fs.writeFile(temp, content, { flag: 'wx' });
  try {
    await fs.link(temp, file);
    await fs.rm(temp, { force: true });
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
