import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const image = 'postgres:16-alpine';

function command(commandName, args, options = {}) {
  return spawnSync(commandName, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
}

export async function startLocalPostgres() {
  const listeners = command('ss', ['-tlnp']);
  if (listeners.status !== 0) throw new Error(`listener preflight failed: ${listeners.stderr.trim()}`);

  const imageCheck = command('docker', ['image', 'inspect', image]);
  if (imageCheck.status !== 0) {
    throw new Error(`${image} is not installed locally; network pulls are forbidden for this suite`);
  }

  const container = `ushso-wp3-${process.pid}-${randomBytes(4).toString('hex')}`;
  const run = command('docker', [
    'run', '--pull', 'never', '--detach', '--rm',
    '--name', container,
    '--label', 'org.ushso.owner=wp3-local-test',
    '--label', `org.ushso.run=${container}`,
    '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=768m',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '-e', 'POSTGRES_DB=ushso',
    image,
    '-c', 'listen_addresses=',
    '-c', 'autovacuum_naptime=1s',
    '-c', 'log_min_messages=warning',
  ]);
  if (run.status !== 0) throw new Error(`failed to start isolated PostgreSQL: ${run.stderr.trim()}`);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    command('docker', ['rm', '--force', container]);
  };
  const onSignal = () => {
    stop();
    process.exitCode = 130;
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      // pg_isready can report success against the temporary bootstrap server
      // before POSTGRES_DB has been created and before the entrypoint performs
      // its final restart.  Wait for that restart marker, then prove the exact
      // target database accepts a real query.
      const logs = command('docker', ['logs', container]);
      const initComplete = `${logs.stdout}\n${logs.stderr}`.includes('PostgreSQL init process complete; ready for start up.');
      const ready = initComplete
        ? command('docker', ['exec', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'ushso', '-Atqc', 'select current_database();'])
        : { status: 1, stdout: '' };
      if (ready.status === 0 && ready.stdout.trim() === 'ushso') {
        return {
          container,
          image,
          listener_preflight_sha256_source: listeners.stdout,
          stop: () => {
            process.removeListener('SIGINT', onSignal);
            process.removeListener('SIGTERM', onSignal);
            stop();
          },
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
