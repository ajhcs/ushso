// Playwright owns Worker readiness, bounded startup, and teardown, including failures.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const tmp = process.env.TMPDIR ?? process.env.RUNNER_TEMP ?? '/workspace/build/builderbob/ushso-implementation/tmp';
await mkdir(tmp, { recursive: true });
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url)), 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TMPDIR: tmp, USHSO_BROWSER_RESULTS: process.env.USHSO_BROWSER_RESULTS ?? path.join(tmp, 'ushso-browser-results') },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
