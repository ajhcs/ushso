import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserRecordErrors, validateCatalogRecords } from './catalog-contract.mjs';
import { prettyJson } from './package-common.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv[2] ?? 'corpus/records.jsonl';
const inputPath = path.resolve(packageRoot, requested);
if (!inputPath.startsWith(`${packageRoot}${path.sep}`)) throw new Error('CATALOG_PATH_OUTSIDE_PACKAGE');

const issues = [];
const records = [];
for (const [index, line] of (await fs.readFile(inputPath, 'utf8')).split(/\r?\n/).entries()) {
  if (!line.trim()) continue;
  try {
    records.push(JSON.parse(line));
  } catch (error) {
    issues.push({ index, record_id: null, code: 'invalid_json', errors: [error.message] });
  }
}
const validation = validateCatalogRecords(records);
issues.push(...validation.invalid);
const report = {
  contract_version: 'observatory-catalog-publication-validation.v1.0.0',
  input: path.relative(packageRoot, inputPath).replaceAll('\\', '/'),
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
