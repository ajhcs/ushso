import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number.parseInt(process.env.USHSO_RELEASE_GATE_PORT ?? '18787', 10);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('RELEASE_GATE_E2E_PORT_INVALID');
const base = `http://127.0.0.1:${port}`;

async function assertPortFree() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', error => reject(new Error(`RELEASE_GATE_E2E_PORT_UNAVAILABLE:${port}:${error.code ?? error.message}`)));
    probe.listen({ host: '127.0.0.1', port }, () => probe.close(resolve));
  });
}

function waitForExit(child) {
  return new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
}

async function waitForHealth(child, diagnostics) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`RELEASE_GATE_E2E_SERVER_EXITED:${child.exitCode}:${diagnostics.value.slice(-4000)}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.status === 200) return;
    } catch {
      // The local server has not accepted connections yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`RELEASE_GATE_E2E_SERVER_TIMEOUT:${diagnostics.value.slice(-4000)}`);
}

async function stop(child) {
  const signalGroup = signal => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  signalGroup('SIGTERM');
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await assertPortFree();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  signalGroup('SIGKILL');
  await assertPortFree();
}

await assertPortFree();
const diagnostics = { value: '' };
const server = spawn(process.execPath, ['scripts/run-wrangler.mjs', 'dev', '--local', '--port', String(port)], {
  cwd: repositoryRoot,
  detached: true,
  env: { ...process.env, BROWSER: 'none' },
  stdio: ['ignore', 'pipe', 'pipe']
});
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    diagnostics.value = `${diagnostics.value}${chunk}`.slice(-32_000);
  });
}

let result;
try {
  await waitForHealth(server, diagnostics);
  const test = spawn(process.execPath, ['tests/e2e-smoke.mjs', '--base', base], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit'
  });
  result = await waitForExit(test);
  if (result.code !== 0) throw new Error(`RELEASE_GATE_E2E_FAILED:${result.code ?? result.signal}`);
} finally {
  await stop(server);
}

process.stdout.write(`${JSON.stringify({ status: 'PASS', base, server: 'local_wrangler_dev', production_actions: 0 })}\n`);
