import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../../..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export async function loadEffectiveAuthorizationRegister() {
  const successor = JSON.parse(await fs.readFile(path.join(packageRoot, 'register.json'), 'utf8'));
  const parentBytes = await fs.readFile(path.join(repositoryRoot, successor.parent.path));
  if (sha256(parentBytes) !== successor.parent.sha256 || successor.parent.preserved !== true) {
    throw new Error('AUTHORIZATION_PARENT_REGISTER_DRIFT');
  }
  const parent = JSON.parse(parentBytes.toString('utf8'));
  const deltas = new Map(successor.authorization_deltas.map(entry => [entry.id, entry]));
  const entries = parent.entries.map(entry => deltas.has(entry.id) ? { ...entry, ...deltas.get(entry.id) } : entry);
  if (deltas.size !== successor.authorization_deltas.length || [...deltas.keys()].some(id => !parent.entries.some(entry => entry.id === id))) {
    throw new Error('AUTHORIZATION_DELTA_INVALID');
  }
  return { ...successor, entries };
}
