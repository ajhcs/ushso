import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPublishedEvaluation } from './evaluator.mjs';

function inputPath(argv) {
  const index = argv.indexOf('--input');
  if (index === -1 || !argv[index + 1]) throw new Error('Usage: node tools/run-evaluation.mjs --input <runner-input.json>');
  return path.resolve(argv[index + 1]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = JSON.parse(await fs.readFile(inputPath(process.argv.slice(2)), 'utf8'));
    process.stdout.write(`${JSON.stringify(await runPublishedEvaluation(input), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
