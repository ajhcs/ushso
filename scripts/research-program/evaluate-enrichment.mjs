import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runPairedEvaluation, selectPolicy } from '../../evaluation/enrichment/harness.mjs';

export function runCli(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    return { ok: true, usage: 'evaluate-enrichment (offline recorded outputs; --live is forbidden)' };
  }
  if (argv.includes('--live')) {
    try {
      runPairedEvaluation({ live: true });
    } catch (error) {
      return { ok: false, error: error.code ?? 'LIVE_EVAL_FORBIDDEN', message: error.message };
    }
  }
  const result = runPairedEvaluation();
  const policy = selectPolicy(result);
  return { ok: true, result, policy };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const out = runCli();
  process.stdout.write(`${JSON.stringify(out)}${String.fromCharCode(10)}`);
  if (out.ok !== true) process.exitCode = 2;
}
