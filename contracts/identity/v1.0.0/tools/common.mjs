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
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonicalJsonSha256(value) {
  return sha256Bytes(canonicalJson(value));
}

export async function sha256File(file) {
  return sha256Bytes(await fs.readFile(file));
}

export async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function walkFiles(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walkFiles(path.join(dir, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

export async function publishImmutable(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.partial-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  await fs.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
  try {
    await fs.link(temporary, file);
    await fs.unlink(temporary);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

export function unique(values) {
  return new Set(values).size === values.length;
}

export function compareCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
