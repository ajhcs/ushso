import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '../../..');

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

export function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filePath) {
  return sha256(await fs.readFile(filePath));
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`INVALID_JSONL:${filePath}:${index + 1}:${error.message}`);
    }
  });
}

export async function writeAtomic(filePath, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.partial-${process.pid}`;
  await fs.writeFile(temporary, bytes, { flag: 'wx' });
  await fs.rename(temporary, filePath);
}

export async function listFiles(root, excludes = new Set(), directory = root, prefix = '') {
  const output = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (excludes.has(relative)) continue;
    if (entry.isDirectory()) output.push(...await listFiles(root, excludes, path.join(directory, entry.name), relative));
    else output.push(relative);
  }
  return output;
}
