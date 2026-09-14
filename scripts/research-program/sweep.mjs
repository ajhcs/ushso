import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runFixtureSweep } from '../../packages/coverage/research-program/v1.0.0/src/sweep.mjs';

export function runCli(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    return { ok: true, usage: 'sweep --help (fixture-only; live scripts/research/sweep.mjs is forbidden)' };
  }
  if (argv.includes('--live')) {
    return { ok: false, error: 'SWEEP_LIVE_NETWORK_FORBIDDEN', message: 'Live source sweep is forbidden in PR-020' };
  }
  return {
    ok: false,
    error: 'SWEEP_CLI_FIXTURE_ONLY',
    message: 'Use tests/research-program/sweep-accounting.test.mjs; do not invoke scripts/research/sweep.mjs',
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = runCli();
  process.stdout.write(`${JSON.stringify(result)}${String.fromCharCode(10)}`);
  if (result.ok !== true) process.exitCode = 2;
}

export { runFixtureSweep };
