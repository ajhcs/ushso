import { createPublishedEngine } from './load-corpus.mjs';

const question = process.argv.slice(2).join(' ').trim();
if (!question) {
  console.error('Usage: node tools/run-query.mjs "research question"');
  process.exitCode = 2;
} else {
  try {
    const engine = await createPublishedEngine();
    console.log(JSON.stringify(engine.retrieve({ question, limit: 15 }), null, 2));
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
