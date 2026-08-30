import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(repositoryRoot, '../..');
const sourceRoot = path.join(workspaceRoot, 'observatory/state-expansion/national-readiness/v0.1.0');
const targetRoot = path.join(repositoryRoot, 'packages/retrieval/readiness/v0.1.0');
const files = ['state-readiness.json', 'manifest.json'];

await fs.mkdir(targetRoot, { recursive: true });
for (const name of files) {
  const content = await fs.readFile(path.join(sourceRoot, name));
  const target = path.join(targetRoot, name);
  try {
    const existing = await fs.readFile(target);
    if (existing.equals(content)) continue;
    throw new Error(`IMMUTABLE_IMPORT_CONFLICT:${name}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${target}.partial-${process.pid}`;
  await fs.writeFile(temporary, content, { flag: 'wx' });
  await fs.rename(temporary, target);
}
process.stdout.write(`${JSON.stringify({ status: 'PASS', imported_files: files.length, namespace: 'packages/retrieval/readiness/v0.1.0' })}\n`);
