import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserRecordErrors, validateCatalogRecords } from './catalog-contract.mjs';
import { prettyJson } from './package-common.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv[2] ?? 'versions/v1.2.0/corpus/corpus.json';
const inputPath = path.resolve(packageRoot, requested);
if (!inputPath.startsWith(`${packageRoot}${path.sep}`)) throw new Error('CATALOG_PATH_OUTSIDE_PACKAGE');

const issues = [];
const records = [];
let declaredRecordCount = null;
let inputFiles = [inputPath];
if (inputPath.endsWith('.json')) {
  const manifest = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  if (!Array.isArray(manifest.record_files) || !manifest.record_files.every(file => typeof file === 'string')) throw new Error('CATALOG_MANIFEST_RECORD_FILES_INVALID');
  declaredRecordCount = manifest.record_count;
  inputFiles = manifest.record_files.map(file => path.resolve(path.dirname(inputPath), file));
  if (inputFiles.some(file => !file.startsWith(`${path.dirname(inputPath)}${path.sep}`))) throw new Error('CATALOG_MANIFEST_PATH_OUTSIDE_CORPUS');
}
let sourceLine = 0;
for (const filePath of inputFiles) {
  for (const line of (await fs.readFile(filePath, 'utf8')).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const index = sourceLine;
    sourceLine += 1;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      issues.push({ index, record_id: null, code: 'invalid_json', errors: [error.message] });
    }
  }
}
const validation = validateCatalogRecords(records);
issues.push(...validation.invalid);
if (declaredRecordCount !== null && declaredRecordCount !== sourceLine) issues.push({ index: null, record_id: null, code: 'manifest_count_mismatch', errors: [`manifest declares ${declaredRecordCount} records but ${sourceLine} JSONL rows were observed`] });
const report = {
  contract_version: 'observatory-catalog-publication-validation.v1.0.0',
  input: path.relative(packageRoot, inputPath).replaceAll('\\', '/'),
  input_files: inputFiles.map(file => path.relative(packageRoot, file).replaceAll('\\', '/')),
  declared_record_count: declaredRecordCount,
  validation_contract: 'browser observatory-record.v1.0.0 minimum contract plus semantic references',
  record_count: records.length,
  valid_record_count: validation.valid.length,
  invalid_record_count: issues.length,
  valid: issues.length === 0,
  issues
};
process.stdout.write(prettyJson(report));
if (issues.length) process.exitCode = 1;

export { browserRecordErrors };
