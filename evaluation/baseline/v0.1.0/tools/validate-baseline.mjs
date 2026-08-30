import fs from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_ROOT } from './baseline-adapter.mjs';

const validation = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'validation', 'validation-report.json'), 'utf8'));
const receipt = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'receipts', 'build-receipt.json'), 'utf8'));
if (validation.status !== 'PASS') throw new Error('BASELINE_VALIDATION_FAILED');
if (Object.values(validation.checks).some(value => value !== true)) throw new Error('BASELINE_CHECK_FAILED');
if (receipt.validation_status !== 'PASS') throw new Error('BASELINE_RECEIPT_FAILED');
if (receipt.external_requests !== 0 || receipt.coverage_cells_executed !== 0 || receipt.identity_index_queries !== 0 || receipt.heavy_analysis_lock_touched !== false) {
  throw new Error('BASELINE_BOUNDARY_VIOLATION');
}
process.stdout.write(`${JSON.stringify({ status: 'PASS', checks: Object.keys(validation.checks).length, question_count: 60 }, null, 2)}\n`);
