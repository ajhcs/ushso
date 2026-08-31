import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const verificationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repositoryRoot = path.resolve(verificationRoot, '../../..');
export const connectorRoot = path.join(repositoryRoot, 'packages/connectors');

export async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(absolute));
    else result.push(absolute);
  }
  return result;
}

export async function connectorFingerprint() {
  const included = (await filesBelow(connectorRoot))
    .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`))
    .filter((file) => !file.endsWith('manifests/package-manifest.json'))
    .sort();
  const fingerprint = createHash('sha256');
  for (const file of included) {
    const relative = path.relative(connectorRoot, file).replaceAll(path.sep, '/');
    fingerprint.update(relative);
    fingerprint.update('\0');
    fingerprint.update(await readFile(file));
    fingerprint.update('\0');
  }
  return fingerprint.digest('hex');
}

export async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(verificationRoot, relativePath), 'utf8'));
}
