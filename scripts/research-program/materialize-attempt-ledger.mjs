#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTEMPT_AXES,
  LAST_GOOD_GENERATION,
  calculateAttemptLedger,
  ingestEvidence,
  loadBaselineIds,
} from './ingest-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function materializeAttemptLedger({ repoRoot = ROOT } = {}) {
  const ids = loadBaselineIds(repoRoot);
  const report = ingestEvidence({ repoRoot, baselineIds: ids, receipts: [] });
  const ledger = report.attempts;
  const rows = [];
  for (const recordId of ids) {
    for (const axis of ATTEMPT_AXES) {
      rows.push({
        record_id: recordId,
        axis,
        eligibility: 'unknown',
        attempt_state: 'not_attempted',
        stop_reason: 'attempt ledger seeded; not_attempted is not success',
        attempted_at: null,
      });
    }
  }
  if (rows.length !== ledger.combinations) {
    throw new Error(`ledger row count ${rows.length} != ${ledger.combinations}`);
  }
  return { ids, ledger, rows, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ledger, rows } = materializeAttemptLedger();
  const dir = path.join(ROOT, 'verification/research-program/evidence');
  mkdirSync(dir, { recursive: true });
  const summary = {
    ...ledger,
    rows_path: 'verification/research-program/evidence/attempt-ledger.jsonl',
    row_count: rows.length,
    note: 'Seeded from frozen baseline identities. not_attempted is not success. This file is not R03 acceptance.',
  };
  writeFileSync(path.join(dir, 'attempt-ledger-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(dir, 'attempt-ledger.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  process.stdout.write(`${JSON.stringify({ generation: LAST_GOOD_GENERATION, combinations: ledger.combinations, not_attempted: ledger.source_run_dispositions.not_attempted, accepted: false }, null, 2)}\n`);
}
