import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { qualifyDeterministic } from '../../packages/coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';

export function runCli(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    return { ok: true, usage: 'qualify-deterministic --help (fixture-only; does not publish or change last-good generation)' };
  }
  if (argv.includes('--live') || argv.includes('--publish')) {
    return { ok: false, error: 'DETERMINISTIC_PUBLICATION_FORBIDDEN', message: 'Last-good public generation remains unchanged; live qualification is forbidden' };
  }
  return {
    ok: false,
    error: 'DETERMINISTIC_CLI_FIXTURE_ONLY',
    message: 'Use tests/research-program/qualify-deterministic.test.mjs',
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = runCli();
  process.stdout.write(`${JSON.stringify(result)}${String.fromCharCode(10)}`);
  if (result.ok !== true) process.exitCode = 2;
}

export { qualifyDeterministic };
