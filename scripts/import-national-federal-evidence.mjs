import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(repositoryRoot, '../..');
const backboneRoot = path.join(workspaceRoot, 'observatory/state-expansion/national-backbone/v0.1.0');
const validationRoot = path.join(workspaceRoot, 'observatory/state-expansion/national-validation/v0.1.0');
const targetRoot = path.join(repositoryRoot, 'packages/retrieval/fixtures/national-federal-v0.1.0');

const sources = [
  ['records.jsonl', path.join(backboneRoot, 'records.jsonl')],
  ['backbone-manifest.json', path.join(backboneRoot, 'manifest.json')],
  ['access-observations.jsonl', path.join(validationRoot, 'access-observations.jsonl')],
  ['validation-report.json', path.join(validationRoot, 'validation-report.json')],
  ['validation-manifest.json', path.join(validationRoot, 'manifest.json')]
];

const imported = [];
await fs.mkdir(targetRoot, { recursive: true });
for (const [name, sourcePath] of sources) {
  const content = await fs.readFile(sourcePath);
  const targetPath = path.join(targetRoot, name);
  try {
    const existing = await fs.readFile(targetPath);
    if (!existing.equals(content)) throw new Error(`IMMUTABLE_IMPORT_CONFLICT:${name}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const temporary = `${targetPath}.partial-${process.pid}`;
    await fs.writeFile(temporary, content, { flag: 'wx' });
    await fs.rename(temporary, targetPath);
  }
  imported.push({
    path: name,
    bytes: content.byteLength,
    sha256: crypto.createHash('sha256').update(content).digest('hex')
  });
}

const receipt = {
  schema_version: 'ushso-national-federal-import-receipt.v0.1.0',
  source_namespaces: [
    'observatory/state-expansion/national-backbone/v0.1.0',
    'observatory/state-expansion/national-validation/v0.1.0'
  ],
  import_mode: 'immutable_evidence_copy',
  identity_merge_performed: false,
  underlying_datasets_downloaded: 0,
  files: imported.sort((a, b) => a.path.localeCompare(b.path))
};
const receiptContent = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
const receiptPath = path.join(targetRoot, 'import-receipt.json');
try {
  const existing = await fs.readFile(receiptPath);
  if (!existing.equals(receiptContent)) throw new Error('IMMUTABLE_IMPORT_CONFLICT:import-receipt.json');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const temporary = `${receiptPath}.partial-${process.pid}`;
  await fs.writeFile(temporary, receiptContent, { flag: 'wx' });
  await fs.rename(temporary, receiptPath);
}

process.stdout.write(`${JSON.stringify({ status: 'PASS', imported_files: imported.length, target: path.relative(repositoryRoot, targetRoot).replaceAll('\\', '/') })}\n`);
