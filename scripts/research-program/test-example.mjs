import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createExampleReceipt,
  executeBoundedSample,
  generateCopyableExamples,
} from '../../packages/connectors/src/testing/example-runner.mjs';

export function runCli(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    return { ok: true, usage: 'test-example --help (fixture-only; live example execution is forbidden)' };
  }
  return {
    ok: false,
    error: 'EXAMPLE_CLI_FIXTURE_ONLY',
    message: 'Live example execution is forbidden; use tests/research-program/example-runner.test.mjs',
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = runCli();
  process.stdout.write(`${JSON.stringify(result)}${String.fromCharCode(10)}`);
  if (result.ok !== true) process.exitCode = 2;
}

export { createExampleReceipt, executeBoundedSample, generateCopyableExamples };
