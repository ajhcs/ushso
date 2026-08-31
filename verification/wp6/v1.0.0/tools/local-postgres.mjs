import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const IMAGE = 'postgres:16-alpine';

export function dockerCommand(args, options = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options });
}

export async function startLocalPostgres() {
  const listeners = spawnSync('ss', ['-tlnp'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (listeners.status !== 0) throw new Error(`listener preflight failed: ${listeners.stderr.trim()}`);
  const image = dockerCommand(['image', 'inspect', IMAGE]);
  if (image.status !== 0) throw new Error(`${IMAGE} is not installed locally; network pulls are forbidden`);

  const container = `ushso-wp6-${process.pid}-${randomBytes(4).toString('hex')}`;
  const run = dockerCommand([
    'run', '--pull', 'never', '--detach', '--rm', '--name', container,
    '--label', 'org.ushso.owner=wp6-local-test', '--label', `org.ushso.run=${container}`,
    '--network', 'none', '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1024m',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=ushso', IMAGE,
    '-c', 'listen_addresses=', '-c', 'log_min_messages=warning'
  ]);
  if (run.status !== 0) throw new Error(`failed to start isolated PostgreSQL: ${run.stderr.trim()}`);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    dockerCommand(['rm', '--force', container]);
    const remaining = dockerCommand([
      'ps', '--all', '--filter', `label=org.ushso.run=${container}`,
      '--format', '{{.Names}}'
    ]);
    if (remaining.status !== 0 || remaining.stdout.trim()) {
      throw new Error(`isolated PostgreSQL cleanup failed: ${(remaining.stderr || remaining.stdout).trim()}`);
    }
  };
  const onSignal = () => {
    try { stop(); } finally { process.exitCode = 130; }
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const ready = dockerCommand(['exec', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'ushso', '-Atqc', 'select current_database();']);
      if (ready.status === 0 && ready.stdout.trim() === 'ushso') {
        return {
          container,
          listener_preflight: listeners.stdout,
          stop: () => {
            process.removeListener('SIGINT', onSignal);
            process.removeListener('SIGTERM', onSignal);
            stop();
          }
        };
      }
      await delay(250);
    }
    throw new Error('isolated PostgreSQL did not become ready');
  } catch (error) {
    stop();
    throw error;
  }
}
