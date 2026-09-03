import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPackage } from '../tools/build-package.mjs';
import { validatePackage } from '../tools/validate-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '../../../..');

async function sha256(relative) {
  return crypto.createHash('sha256').update(await fs.readFile(path.join(REPO, relative))).digest('hex');
}

test('three offline builds produce identical snapshot, matrix, and artifact seals', async () => {
  const receipts = [
    await buildPackage(),
    await buildPackage(),
    await buildPackage()
  ];
  assert.equal(new Set(receipts.map(item => item.coverage_snapshot_sha256)).size, 1);
  assert.equal(new Set(receipts.map(item => item.matrix_membership_sha256)).size, 1);
  assert.equal(new Set(receipts.map(item => item.artifact_set_sha256)).size, 1);
  assert.ok(receipts.every(item => item.counts.cells === 306 && item.counts.published_records === 157));
});

test('package validator passes after deterministic rebuild', async () => {
  const receipt = await validatePackage();
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.counts.metrics, 18);
  assert.equal(receipt.product_owner_wording_review, 'pending_product_owner_review');
});

test('WP1 coverage adapters remain byte-for-byte pinned', async () => {
  assert.equal(await sha256('packages/coverage/coverage-repository.mjs'), '619598389eed36f01f06e0292ecd206ce9b0ee7379f9570e7ae71220b49088a6');
  assert.equal(await sha256('packages/coverage/static-coverage-repository.mjs'), '6742ced209743f0f00f5db8a5b04f0cc4462a821e1f60442a94dc30f8e78ecf0');
});

test('reviewed 0011 SQL is additive, append-only, exact-state, and not applied', async () => {
  const sql = await fs.readFile(path.join(ROOT, 'sql/0011_coverage_facts_definitions_snapshots.reviewed.sql'), 'utf8');
  assert.match(sql, /REVIEW STATUS: offline technical review complete for WP9; not applied/);
  assert.match(sql, /SEQUENCE GATE: move into db\/migrations only after 0007 through 0010 are sealed/);
  assert.doesNotMatch(sql, /\bdrop\s+(table|schema|view)\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  assert.match(sql, /unique \(coverage_snapshot_id, jurisdiction_id, source_class_id\)/);
  for (const state of ['integrated', 'candidate', 'navigation_only', 'evidence_gap', 'inaccessible', 'unknown', 'not_assessed']) {
    assert.match(sql, new RegExp(`'${state}'`));
  }
  assert.match(sql, /before update or delete on ops\.coverage_matrix_cells/);
  assert.match(sql, /denominator_status = 'unknown' and denominator_count is null and rate is null/);
  assert.match(sql, /denominator_count is distinct from 0 or rate is null/);
  assert.match(sql, /coverage_cell_state = 'integrated' or not absence_claim_permitted/);
  assert.doesNotMatch(sql, /grant\s+select[\s\S]{0,200}\s+to\s+ushso_public/i);
  const dbMigration = path.join(REPO, 'db/migrations/0011_coverage_facts_definitions_snapshots.sql');
  await assert.rejects(fs.access(dbMigration));
});
