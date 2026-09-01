import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filePath) {
  return sha256Bytes(await readFile(filePath));
}

export function parseArgs(argv = process.argv.slice(2)) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

function directPgEnvironment(database) {
  const rawUrl = process.env.USHSO_MAINTENANCE_DATABASE_URL;
  if (!rawUrl) throw new Error('USHSO_MAINTENANCE_DATABASE_URL is required for a direct database operation');
  const url = new URL(rawUrl);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('maintenance database URL must use postgres');
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: database || url.pathname.slice(1),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode') || 'verify-full',
    PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'ushso-direct-maintenance',
  };
}

export function runPsql({ container, database = 'ushso', user = 'postgres', sql, tuplesOnly = false, variables = {}, expectFailure = false }) {
  const common = ['-X', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', database];
  if (tuplesOnly) common.push('-q', '-A', '-t');
  for (const [key, value] of Object.entries(variables)) common.push('-v', `${key}=${value}`);

  let command;
  let args;
  let env = process.env;
  if (container) {
    command = 'docker';
    args = ['exec', '-i', container, 'psql', ...common];
  } else {
    command = 'psql';
    args = common.slice(0, 3);
    if (tuplesOnly) args.push('-q', '-A', '-t');
    for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${value}`);
    env = directPgEnvironment(database);
  }

  const result = spawnSync(command, args, {
    input: sql,
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const failed = result.status !== 0;
  if (failed !== expectFailure) {
    const stderr = (result.stderr || '').replace(/password=[^\s]+/gi, 'password=[REDACTED]');
    throw new Error(`psql ${failed ? 'failed' : 'unexpectedly succeeded'}: ${stderr.trim()}`);
  }
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

export function requireEnvironmentFence(args) {
  const environment = args.environment;
  const fingerprint = args['deployment-fingerprint'];
  if (!['local', 'staging', 'production'].includes(environment)) {
    throw new Error('--environment must be local, staging, or production');
  }
  if (!fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error('--deployment-fingerprint must be a 64-character lowercase SHA-256');
  }
  if (environment !== 'local') {
    const receiptPath = args['authorization-receipt'];
    if (!receiptPath) throw new Error('managed database operation is pending_external_authorization');
    return { environment, fingerprint, receiptPath };
  }
  return { environment, fingerprint, receiptPath: null };
}

export async function verifyManagedAuthorization(fence) {
  if (fence.environment === 'local') return;
  const receipt = JSON.parse(await readFile(path.resolve(fence.receiptPath), 'utf8'));
  if (receipt.authorized !== true || receipt.environment !== fence.environment || receipt.action !== 'database_foundation_apply') {
    throw new Error('authorization receipt does not authorize this exact managed database foundation apply');
  }
}
