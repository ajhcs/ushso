import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalDigest, sha256File } from '../../../../contracts/coverage/v1.0.0/tools/common.mjs';
import { validatePackage } from '../../../../packages/coverage/accounting/v1.0.0/tools/validate-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '../../..');

async function read(relative) {
  return JSON.parse(await fs.readFile(path.join(ROOT, relative), 'utf8'));
}

test('WP9 implementation package remains valid against frozen contracts', async () => {
  const receipt = await validatePackage();
  assert.equal(receipt.status, 'pass');
  assert.deepEqual(receipt.counts, {
    metrics: 18,
    source_scopes: 14,
    jurisdictions: 51,
    source_classes: 6,
    cells: 306,
    published_records: 157
  });
});

test('verification receipt is self-consistent and accurately blocked on wording review', async () => {
  const receipt = await read('receipts/wp9-verification.json');
  const payload = structuredClone(receipt);
  delete payload.receipt_sha256;
  assert.equal(receipt.receipt_sha256, canonicalDigest('ushso:wp9-verification-receipt:v1\n', payload));
  assert.equal(receipt.technical_status, 'pass');
  assert.equal(receipt.release_gate_status, 'blocked_external_product_owner_wording_review');
  assert.equal(receipt.network_access, false);
  assert.equal(receipt.production_actions, false);
  assert.equal(receipt.database_actions, false);
  assert.equal(receipt.public_route_changes, false);
  assert.equal(receipt.raw_user_queries_persisted, false);
  assert.equal(receipt.counts.production_matrix_state_distribution.not_assessed, 306);
});

test('implementation file manifest hashes every scoped deliverable', async () => {
  const manifest = await read('receipts/implementation-file-manifest.json');
  for (const entry of manifest.files) {
    assert.equal(await sha256File(path.join(REPO, entry.path)), entry.sha256, entry.path);
    assert.equal((await fs.stat(path.join(REPO, entry.path))).size, entry.bytes, entry.path);
  }
  assert.equal(manifest.file_set_sha256, canonicalDigest('ushso:wp9-implementation-file-set:v1\n', manifest.files));
  assert.ok(manifest.files.some(entry => entry.path.endsWith('coverage-accounting-service.mjs')));
  assert.ok(manifest.files.some(entry => entry.path.endsWith('coverage-matrix.json')));
  assert.ok(manifest.files.some(entry => entry.path.endsWith('0011_coverage_facts_definitions_snapshots.reviewed.sql')));
});

test('requirement ledger has no silent omissions and names every external gap', async () => {
  const ledger = await read('requirements/evidence-ledger.json');
  const ids = new Set(ledger.entries.map(entry => entry.requirement_id));
  for (const id of ['TST-COV-01', 'TST-COV-02', 'TST-TRUST-01', 'G23.4-PRODUCT-OWNER', 'WP9-SQL-0011', 'WP9-WP1-PRESERVATION']) {
    assert.ok(ids.has(id), id);
  }
  assert.equal(new Set(ledger.entries.map(entry => entry.requirement_id)).size, ledger.entries.length);
  assert.ok(ledger.entries.every(entry => entry.implementation.length > 0 && entry.verification.length > 0));
  assert.equal(ledger.entries.find(entry => entry.requirement_id === 'G23.4-PRODUCT-OWNER').status, 'pending_external_review');
});

test('product-owner packet pins exact copy artifacts and no approval receipt exists', async () => {
  const packet = await read('governance/product-owner-wording-review.json');
  assert.equal(packet.status, 'pending_external_review');
  assert.equal(packet.publication_authorized, false);
  assert.equal(packet.artifacts_to_review.length, 3);
  for (const artifact of packet.artifacts_to_review) {
    assert.equal(await sha256File(path.join(REPO, artifact.path)), artifact.sha256, artifact.path);
  }
  await assert.rejects(fs.access(path.join(ROOT, 'governance/product-owner-wording-review.receipt.json')));
});

test('WP1 adapters are preserved and reviewed SQL remains outside db', async () => {
  assert.equal(await sha256File(path.join(REPO, 'packages/coverage/coverage-repository.mjs')), '619598389eed36f01f06e0292ecd206ce9b0ee7379f9570e7ae71220b49088a6');
  assert.equal(await sha256File(path.join(REPO, 'packages/coverage/static-coverage-repository.mjs')), '6742ced209743f0f00f5db8a5b04f0cc4462a821e1f60442a94dc30f8e78ecf0');
  await assert.rejects(fs.access(path.join(REPO, 'db/migrations/0011_coverage_facts_definitions_snapshots.sql')));
});
