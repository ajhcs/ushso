import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'packages/retrieval');
const targetRoot = path.join(root, 'apps/web/public');
const files = [
  ['corpus/records.jsonl', 'corpus/records.jsonl'],
  ['corpus/search-documents.jsonl', 'corpus/search-documents.jsonl'],
  ['corpus/join-routes.jsonl', 'corpus/join-routes.jsonl'],
  ['corpus/corpus.json', 'corpus/corpus.json'],
  ['fixtures/controlled-vocabulary.json', 'corpus/controlled-vocabulary.json'],
  ['schemas/discovery-query.schema.json', 'corpus/discovery-query.schema.json'],
  ['schemas/discovery-result.schema.json', 'corpus/discovery-result.schema.json'],
  ['contracts/webmcp-tool.json', 'corpus/webmcp-tool.json'],
  ['versions/v1.1.0/corpus/records.jsonl', 'corpus-v1.1.0/records.jsonl'],
  ['versions/v1.1.0/corpus/search-documents.jsonl', 'corpus-v1.1.0/search-documents.jsonl'],
  ['versions/v1.1.0/corpus/join-routes.jsonl', 'corpus-v1.1.0/join-routes.jsonl'],
  ['versions/v1.1.0/corpus/corpus.json', 'corpus-v1.1.0/corpus.json'],
  ['versions/v1.1.0/fixtures/controlled-vocabulary.json', 'corpus-v1.1.0/controlled-vocabulary.json'],
  ['schemas/discovery-query.schema.json', 'corpus-v1.1.0/discovery-query.schema.json'],
  ['schemas/discovery-result.schema.json', 'corpus-v1.1.0/discovery-result.schema.json'],
  ['contracts/webmcp-tool.json', 'corpus-v1.1.0/webmcp-tool.json'],
  ['readiness/v0.1.0/state-readiness.json', 'state-readiness-v0.1.0.json']
];

await fs.mkdir(targetRoot, { recursive: true });
for (const [source, target] of files) {
  const sourcePath = path.join(sourceRoot, source);
  const targetPath = path.join(targetRoot, target);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
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
