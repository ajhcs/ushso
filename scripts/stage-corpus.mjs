import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'packages/retrieval');
const targetRoot = path.join(root, 'apps/web/public/corpus');
const files = [
  ['corpus/records.jsonl', 'records.jsonl'],
  ['corpus/search-documents.jsonl', 'search-documents.jsonl'],
  ['corpus/join-routes.jsonl', 'join-routes.jsonl'],
  ['corpus/corpus.json', 'corpus.json'],
  ['fixtures/controlled-vocabulary.json', 'controlled-vocabulary.json'],
  ['schemas/discovery-query.schema.json', 'discovery-query.schema.json'],
  ['schemas/discovery-result.schema.json', 'discovery-result.schema.json'],
  ['contracts/webmcp-tool.json', 'webmcp-tool.json']
];

await fs.mkdir(targetRoot, { recursive: true });
for (const [source, target] of files) {
  const sourcePath = path.join(sourceRoot, source);
  const targetPath = path.join(targetRoot, target);
  const content = await fs.readFile(sourcePath);
  try {
    const existing = await fs.readFile(targetPath);
    if (existing.equals(content)) continue;
    throw new Error(`CORPUS_STAGE_DRIFT:${target}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${targetPath}.partial-${process.pid}`;
  await fs.writeFile(temporary, content, { flag: 'wx' });
  await fs.rename(temporary, targetPath);
}
process.stdout.write(`${JSON.stringify({ status: 'PASS', staged_files: files.length })}\n`);
