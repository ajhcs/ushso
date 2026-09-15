import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LAST_GOOD_GENERATION,
  PRODUCT_DENOMINATOR,
  assembleCoreMatrix,
  coreCellEvidenceFromReceipts,
  independentSemanticReview,
  issueCoreQualificationReceipt,
  loadCohort,
  refuseSelfApproval,
  refuseUnknownCellAsSupported,
} from '../../scripts/research-program/qualify-core.mjs';
import { LAST_GOOD_GENERATION as GEN, validateReceipt } from '../../scripts/research-program/ingest-evidence.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cohort = loadCohort();

test('all 100 products reconcile to their source contexts and acceptance requirements; no unknown cell counts as supported', () => {
  const matrix = assembleCoreMatrix(cohort);
  assert.equal(matrix.product_count, PRODUCT_DENOMINATOR);
  assert.equal(matrix.rows.length, 100);
  assert.equal(new Set(matrix.rows.map((row) => row.product_key)).size, 100);
  assert.equal(matrix.unknown_cells_counted_as_supported, false);
  for (const row of matrix.rows) {
    assert.ok(row.source_context.anchor_status === 'resolved_catalog_record' || row.source_context.anchor_status === 'named_intake');
    for (const cell of Object.values(row.cells)) {
      if (cell.unknown) assert.equal(cell.supported, false);
    }
  }
  assert.throws(() => refuseUnknownCellAsSupported({ unknown: true, supported: true }), { code: 'UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED' });
  assert.ok(matrix.domain_totals.length >= 10);
  assert.equal(matrix.generation, LAST_GOOD_GENERATION);
});

test('an implementer or model cannot approve its own scientific output; failed cases remain visible and receive bounded follow-up PRs', () => {
  assert.throws(() => refuseSelfApproval({ actor: 'implementer', role: 'implementer', approved: true }), { code: 'IMPLEMENTER_CANNOT_APPROVE_OWN_SCIENTIFIC_OUTPUT' });
  assert.throws(() => refuseSelfApproval({ actor: 'model', role: 'model', approved: true }), { code: 'IMPLEMENTER_CANNOT_APPROVE_OWN_SCIENTIFIC_OUTPUT' });
  const matrix = assembleCoreMatrix(cohort);
  assert.throws(() => independentSemanticReview(matrix, { approved: true }), { code: 'IMPLEMENTER_CANNOT_APPROVE_OWN_SCIENTIFIC_OUTPUT' });
  const review = independentSemanticReview(matrix);
  assert.equal(review.implementer_self_approved, false);
  assert.equal(review.scientific_output_approved, false);
  assert.ok(review.failed_visible >= 1);
  assert.equal(review.failed_visible, review.bounded_follow_up_prs.length);
  assert.ok(review.unresolved_domain_judgments.every((row) => row.routed_to === 'named-human-research-reviewer'));
  assert.equal(review.exact_accepted_values.length, 0);
});

test('only issue a pass when R04/R05/R07/R08 actually hold; otherwise retain the failed matrix and continue remediation', () => {
  assert.throws(() => issueCoreQualificationReceipt(cohort, { forcePass: true }), { code: 'FAILED_MATRIX_CANNOT_BE_FORCED_PASS' });
  const receipt = issueCoreQualificationReceipt(cohort);
  assert.equal(receipt.r04_accepted, false);
  assert.equal(receipt.r05_accepted, false);
  assert.equal(receipt.r07_accepted, false);
  assert.equal(receipt.r08_accepted, false);
  assert.equal(receipt.scientific_completeness_pass, false);
  assert.equal(receipt.failed_matrix_retained, true);
  assert.equal(receipt.unknown_cells_counted_as_supported, false);
  assert.equal(receipt.product_count, 100);
  assert.ok(receipt.remaining_limits.length >= 4);
  assert.equal(receipt.last_good_generation_changed, false);
});

test('validated core-cell receipts can fill unknown cells; unknown remains unsupported; R04 stays unaccepted', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const productKey = cohort.products[0].product_key;
  const receipt = validateReceipt({
    format: 'ushso.evidence-receipt.v1',
    receipt_id: 'core-cell-publisher-access-fixture',
    kind: 'core_cell',
    generation: GEN,
    candidate_head: '31631bc18808e67b5f63472585707787a29e933b',
    recorded_at: '2026-09-15T12:00:00Z',
    evidence_reference: 'verification/research-program/evidence/payloads/fixture-validation.txt',
    evidence_sha256: '915be2e8ff28a86863cbd6c5cef36b7caf4239ef0e332ae6fe4fd764900c79a2',
    payload: {
      product_key: productKey,
      field: 'publisher_access',
      supported: true,
      unknown: false,
      status: 'bounded_sample',
      bounded_sample: true,
      recipe: 'fixture-only bounded sample; not live HTTP',
      live_http: false,
    },
  }, { repoRoot: ROOT });
  assert.throws(() => validateReceipt({
    ...receipt,
    receipt_id: 'core-cell-unknown-supported',
    payload: { ...receipt.payload, unknown: true, supported: true },
  }, { repoRoot: ROOT }), { code: 'UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED' });
  const evidence = coreCellEvidenceFromReceipts([receipt]);
  const matrix = assembleCoreMatrix(cohort, { cellEvidenceByProduct: evidence });
  const row = matrix.rows.find((item) => item.product_key === productKey);
  assert.equal(row.cells.publisher_access.supported, true);
  assert.equal(row.cells.publisher_access.unknown, false);
  assert.equal(row.cells.schema_qualification.supported, false);
  assert.equal(row.cells.schema_qualification.unknown, true);
  const issued = issueCoreQualificationReceipt(cohort, { cellEvidenceByProduct: evidence });
  assert.equal(issued.r04_accepted, false);
  assert.equal(issued.scientific_completeness_pass, false);
  assert.equal(issued.failed_matrix_retained, true);
});
