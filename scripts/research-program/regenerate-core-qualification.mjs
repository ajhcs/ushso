#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueCoreQualificationReceipt, loadCohort } from './qualify-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const receipt = issueCoreQualificationReceipt(loadCohort(), { recordedAt: '2026-09-15T14:45:00Z' });
writeFileSync(
  path.join(ROOT, 'evaluation/research-program/review/core-qualification-receipt.json'),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
writeFileSync(
  path.join(ROOT, 'evaluation/research-program/review/core-matrix.json'),
  `${JSON.stringify(receipt.matrix, null, 2)}\n`,
);
const cells = receipt.matrix.rows.flatMap((row) => Object.values(row.cells));
process.stdout.write(`${JSON.stringify({
  r04_accepted: receipt.r04_accepted,
  scientific_completeness_pass: receipt.scientific_completeness_pass,
  unknown: cells.filter((cell) => cell.unknown).length,
  supported: cells.filter((cell) => cell.supported).length,
  known_unsupported: cells.filter((cell) => cell.supported === false && cell.unknown === false).length,
  product_count: receipt.product_count,
}, null, 2)}\n`);
