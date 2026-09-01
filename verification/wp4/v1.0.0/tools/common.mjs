import crypto from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repositoryRoot = path.resolve(packageRoot, '../../..');

export function repositoryPath(relativePath) {
  return path.resolve(repositoryRoot, relativePath);
}

export async function exists(relativePath) {
  try {
    await access(repositoryPath(relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function readRepositoryText(relativePath) {
  return readFile(repositoryPath(relativePath), 'utf8');
}

export async function readVerificationJson(relativePath) {
  return JSON.parse(await readFile(path.resolve(packageRoot, relativePath), 'utf8'));
}

async function walk(relativeDirectory) {
  const absoluteDirectory = repositoryPath(relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

export async function wp4ImplementationInventory() {
  const discovered = [
    ...await walk('packages/ingestion/src'),
    ...await walk('packages/ingestion/tests'),
    ...await walk('services/scheduler-worker'),
    ...await walk('services/harvest-worker'),
  ];
  const fixed = [
    'packages/ingestion/package.json',
    'db/migrations/0002_ingest_runs_jobs_captures.sql',
    'db/migrations/0003_ops_outbox_processed_events_dead_letters.sql',
    'db/queries/lease-due-sources.sql',
    'db/queries/lease-jobs.sql',
    'db/queries/lease-outbox.sql',
    'db/queries/reconcile-workflows.sql',
    'db/queries/recover-expired-leases.sql',
    'db/queries/recover-expired-outbox-leases.sql',
  ];
  return [...new Set([...discovered, ...fixed])].sort();
}

async function fingerprintFiles(files) {
  const sealedFiles = [];
  for (const file of files) {
    const bytes = await readFile(repositoryPath(file));
    sealedFiles.push(Object.freeze({
      file,
      byte_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }));
  }
  const material = sealedFiles.map(({ file, byte_sha256 }) => `${file}\0${byte_sha256}\n`).join('');
  return Object.freeze({
    algorithm: 'sha256(path\\0sha256\\n)',
    fingerprint: crypto.createHash('sha256').update(material).digest('hex'),
    files: Object.freeze(sealedFiles),
  });
}

export async function implementationFingerprint() {
  return fingerprintFiles(await wp4ImplementationInventory());
}

export async function verificationPackageFingerprint() {
  const files = (await walk('verification/wp4/v1.0.0'))
    .filter(file => !file.startsWith('verification/wp4/v1.0.0/receipts/'))
    .sort();
  return fingerprintFiles(files);
}
