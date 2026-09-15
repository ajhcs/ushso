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
  payloadSampleCountsFromReceipts,
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
  const product = cohort.products.find((row) => row.product_key === 'cms-hcris-hospital-provider-cost-report');
  const productKey = product.product_key;
  const receipt = validateReceipt({
    format: 'ushso.evidence-receipt.v1',
    receipt_id: 'core-cell-publisher-access-fixture',
    kind: 'core_cell',
    generation: GEN,
    candidate_head: '31631bc18808e67b5f63472585707787a29e933b',
    recorded_at: '2026-09-15T12:00:00Z',
    evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-fixture.json',
    evidence_sha256: '9c0755ab1d44e9902eac9c8103d9bb3017b7d00cad50eadeea5f13012887143c',
    payload: {
      product_key: productKey,
      field: 'publisher_access',
      supported: true,
      unknown: false,
      status: 'bounded_sample',
      bounded_sample: true,
      payload_success: true,
      native_product_id: product.anchor.representative.native_id,
      record_id: product.anchor.representative.record_id,
      release_id: 'CostReport_2023_Final',
      result_format: 'json_array',
      row_count: 2,
      identity_checks: { required_fields: { PROVNUM: 'string' } },
      execution: {
        kind: 'bounded_file_sample',
        started_at: '2026-09-15T12:00:00Z',
        ended_at: '2026-09-15T12:00:01Z',
      },
      recipe: 'fixture-only bounded sample; not live HTTP',
      live_http: false,
    },
  }, { repoRoot: ROOT });
  assert.equal(receipt.payload._derived_payload_sample, true);
  const derivedCounts = payloadSampleCountsFromReceipts([receipt], cohort.products);
  assert.equal(derivedCounts.public_sample_complete, 0);
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

test('frozen catalog-metadata receipts make 86 resolved and 14 named-intake products known-unsupported; named-intake catalog_record is known missing, not unknown; R04 stays unaccepted', () => {
  const receipt = issueCoreQualificationReceipt(cohort);
  const resolved = receipt.matrix.rows.filter((row) => row.source_context.anchor_status === 'resolved_catalog_record');
  const intake = receipt.matrix.rows.filter((row) => row.source_context.anchor_status === 'named_intake');
  assert.equal(resolved.length, 86);
  assert.equal(intake.length, 14);
  for (const row of resolved) {
    for (const field of ['publisher_access', 'schema_qualification', 'join_route', 'unit_grain_date_denominator']) {
      assert.equal(row.cells[field].supported, false, row.product_key);
      assert.equal(row.cells[field].unknown, false, row.product_key);
      assert.ok(row.cells[field].receipt_id, field);
    }
  }
  for (const row of intake) {
    assert.equal(row.cells.catalog_record.supported, false, row.product_key);
    assert.equal(row.cells.catalog_record.unknown, false, row.product_key);
    assert.equal(row.cells.catalog_record.status, 'named_intake', row.product_key);
    for (const field of ['publisher_access', 'schema_qualification', 'join_route', 'unit_grain_date_denominator']) {
      assert.equal(row.cells[field].supported, false, row.product_key);
      assert.equal(row.cells[field].unknown, false, row.product_key);
      assert.ok(row.cells[field].receipt_id, field);
    }
    assert.ok([
      'named_intake_unverified_locator',
      'documented_family_workflow_not_verified_route',
      'synthetic_mrf_walkthrough_not_live_sample',
    ].includes(row.cells.publisher_access.status), row.product_key);
    assert.ok(
      row.cells.publisher_access.limitation.includes('not a verified restricted/manual route')
        || row.cells.publisher_access.limitation.includes('verified_route remains false')
        || row.cells.publisher_access.limitation.includes('not bounded samples of frozen hospital/payer locators'),
      row.product_key,
    );
  }
  const unknownSupported = receipt.matrix.rows.flatMap((row) => Object.values(row.cells)).filter((cell) => cell.unknown && cell.supported);
  assert.equal(unknownSupported.length, 0);
  assert.equal(receipt.r04_accepted, false);
  assert.equal(receipt.scientific_completeness_pass, false);
  assert.ok(receipt.remaining_limits.some((item) => item.includes('Catalog-metadata receipts are not bounded payload samples')));
  assert.equal(receipt.engineering_readiness.catalog_membership_is_not_payload_sample, true);
  assert.equal(receipt.engineering_readiness.public_sample_complete, 0);
  assert.equal(receipt.engineering_readiness.r04_engineering_target_met, false);
  const counts = payloadSampleCountsFromReceipts([], cohort.products);
  assert.equal(counts.public_sample_complete, 0);
  assert.equal(counts.catalog_membership_is_not_payload_sample, true);
  const hcris = receipt.matrix.rows.find((row) => row.product_key === 'cms-hcris-hospital-provider-cost-report');
  assert.equal(hcris.cells.publisher_access.status, 'catalog_distribution_locators_not_payload');
  assert.equal(hcris.cells.publisher_access.supported, false);
  assert.ok(hcris.cells.publisher_access.limitation.includes('payload_success=false'));
  const places = receipt.matrix.rows.find((row) => row.product_key === 'cdc-places-local-data-for-better-health');
  assert.equal(places.cells.publisher_access.status, 'catalog_view_index_not_payload');
  assert.equal(places.cells.publisher_access.supported, false);
  assert.ok(places.cells.publisher_access.limitation.includes('payload retrieval were not executed'));
  assert.equal(places.cells.schema_qualification.status, 'catalog_named_column_count_not_dictionary');
  assert.equal(places.cells.schema_qualification.supported, false);
  assert.ok(places.cells.schema_qualification.limitation.includes('not schema qualification'));
  const acs = receipt.matrix.rows.find((row) => row.product_key === 'census-acs-5year-data-profiles');
  assert.equal(acs.cells.publisher_access.status, 'census_catalog_native_id_not_payload');
  assert.equal(acs.cells.publisher_access.supported, false);
  assert.ok(acs.cells.publisher_access.limitation.includes('Vintage-mismatched catalog-slim'));
  assert.equal(acs.cells.join_route.status, 'documented_join_fixture_not_qualified');
  assert.equal(acs.cells.join_route.supported, false);
  assert.ok(acs.cells.join_route.limitation.includes('Independently qualified routes remain 0'));
  assert.equal(hcris.cells.join_route.status, 'documented_join_fixture_not_qualified');
  assert.equal(hcris.cells.join_route.supported, false);
  assert.equal(hcris.cells.schema_qualification.status, 'cost_grid_dictionary_geometry_not_payload');
  assert.equal(hcris.cells.schema_qualification.supported, false);
  assert.ok(hcris.cells.schema_qualification.limitation.includes('not bounded payload samples'));
  assert.equal(hcris.cells.unit_grain_date_denominator.status, 'example_grain_docs_not_payload_denominator');
  const hha = receipt.matrix.rows.find((row) => row.product_key === 'cms-hha-cost-report');
  assert.equal(hha.cells.schema_qualification.status, 'cost_grid_dictionary_geometry_not_payload');
  assert.equal(hha.cells.schema_qualification.supported, false);
  const hcup = intake.find((row) => row.product_key === 'ahrq-hcup');
  assert.equal(hcup.cells.publisher_access.status, 'documented_family_workflow_not_verified_route');
  assert.equal(hcup.cells.publisher_access.supported, false);
  assert.equal(receipt.engineering_readiness.r05_restricted_routes_verified, false);
  const hospitalMrf = intake.find((row) => row.product_key === 'hospital-price-transparency-mrfs');
  assert.equal(hospitalMrf.cells.publisher_access.status, 'synthetic_mrf_walkthrough_not_live_sample');
  assert.equal(hospitalMrf.cells.schema_qualification.status, 'synthetic_mrf_schema_walkthrough_not_live');
  assert.equal(hospitalMrf.cells.publisher_access.supported, false);
});

test('catalog membership, vintage substitution, fiction, and family workflows cannot count toward R04/R05 engineering totals', () => {
  const products = cohort.products;
  const catalogAsSample = [{
    kind: 'core_cell',
    payload: {
      field: 'publisher_access',
      product_key: 'cms-hcris-hospital-provider-cost-report',
      supported: true,
      bounded_sample: true,
      payload_success: true,
      catalog_membership_as_sample: true,
    },
  }];
  assert.throws(() => payloadSampleCountsFromReceipts(catalogAsSample, products), { code: 'CATALOG_MEMBERSHIP_IS_NOT_PAYLOAD_SAMPLE' });
  const vintage = [{
    kind: 'core_cell',
    payload: {
      field: 'publisher_access',
      product_key: 'census-acs-5year-data-profiles',
      supported: true,
      bounded_sample: true,
      payload_success: true,
      vintage_substitution: true,
    },
  }];
  assert.throws(() => payloadSampleCountsFromReceipts(vintage, products), { code: 'VINTAGE_SUBSTITUTION_FORBIDDEN' });
  const fiction = [{
    kind: 'core_cell',
    payload: {
      field: 'publisher_access',
      product_key: 'hospital-price-transparency-mrfs',
      supported: true,
      bounded_sample: true,
      payload_success: true,
      fictional: true,
      synthetic: true,
    },
  }];
  assert.throws(() => payloadSampleCountsFromReceipts(fiction, products), { code: 'FICTIONAL_WALKTHROUGH_IS_NOT_LIVE_SAMPLE' });
  const workflow = [{
    kind: 'core_cell',
    payload: {
      field: 'publisher_access',
      product_key: 'ahrq-hcup',
      supported: true,
      verified_route: true,
      family_workflow_as_verified_route: true,
    },
  }];
  assert.throws(() => payloadSampleCountsFromReceipts(workflow, products), { code: 'FAMILY_WORKFLOW_IS_NOT_VERIFIED_ROUTE' });
  const live = [{
    kind: 'core_cell',
    payload: {
      field: 'publisher_access',
      product_key: 'cms-hcris-hospital-provider-cost-report',
      supported: true,
      bounded_sample: true,
      payload_success: true,
      live_http: true,
    },
  }];
  const liveCounts = payloadSampleCountsFromReceipts(live, products);
  assert.equal(liveCounts.public_sample_complete, 0);
  const ignored = [{
    kind: 'core_cell',
    payload: {
      field: 'publisher_access',
      product_key: 'cms-hcris-hospital-provider-cost-report',
      supported: true,
      bounded_sample: true,
      payload_success: true,
      native_product_id: 'arbitrary-native-id',
      release_id: 'arbitrary-release-id',
    },
  }];
  const counts = payloadSampleCountsFromReceipts(ignored, products);
  assert.equal(counts.public_sample_complete, 0);
  assert.equal(counts.r04_engineering_target_met, false);
  assert.equal(counts.r05_restricted_routes_verified, false);
});

test('catalog-locator bytes cannot count as a payload sample when misleading flags are absent', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const product = cohort.products.find((row) => row.product_key === 'cms-hcris-hospital-provider-cost-report');
  assert.throws(() => validateReceipt({
    format: 'ushso.evidence-receipt.v1',
    receipt_id: 'catalog-locator-as-sample-arbitrary-ids',
    kind: 'core_cell',
    generation: GEN,
    candidate_head: '31631bc18808e67b5f63472585707787a29e933b',
    recorded_at: '2026-09-15T12:00:00Z',
    evidence_reference: 'verification/research-program/pr-013/fixtures/cms-catalog-slim.json.gz',
    evidence_sha256: 'e36c53352e0781a16dac658ff4e227ed430fef88aba89d38fc70aa652df2c722',
    payload: {
      product_key: product.product_key,
      field: 'publisher_access',
      supported: true,
      unknown: false,
      status: 'catalog_locator_as_sample',
      bounded_sample: true,
      payload_success: true,
      native_product_id: 'arbitrary-native-id',
      release_id: 'arbitrary-release-id',
      recipe: 'reuse catalog-slim bytes as if they were payload rows',
      live_http: false,
    },
  }, { repoRoot: ROOT }), { code: 'BOUNDED_SAMPLE_RECORD_ID_REQUIRED' });
  assert.throws(() => validateReceipt({
    format: 'ushso.evidence-receipt.v1',
    receipt_id: 'catalog-locator-as-sample-matching-ids',
    kind: 'core_cell',
    generation: GEN,
    candidate_head: '31631bc18808e67b5f63472585707787a29e933b',
    recorded_at: '2026-09-15T12:00:00Z',
    evidence_reference: 'verification/research-program/pr-013/fixtures/cms-catalog-slim.json.gz',
    evidence_sha256: 'e36c53352e0781a16dac658ff4e227ed430fef88aba89d38fc70aa652df2c722',
    payload: {
      product_key: product.product_key,
      field: 'publisher_access',
      supported: true,
      unknown: false,
      status: 'catalog_locator_as_sample',
      bounded_sample: true,
      payload_success: true,
      native_product_id: product.anchor.representative.native_id,
      record_id: product.anchor.representative.record_id,
      release_id: 'CostReport_2023_Final',
      result_format: 'json_array',
      row_count: 1,
      identity_checks: { required_fields: { PROVNUM: 'string' } },
      execution: {
        kind: 'bounded_file_sample',
        started_at: '2026-09-15T12:00:00Z',
        ended_at: '2026-09-15T12:00:01Z',
      },
      recipe: 'reuse catalog-slim bytes as if they were payload rows',
      live_http: false,
    },
  }, { repoRoot: ROOT }), { code: 'CATALOG_METADATA_IS_NOT_PAYLOAD_SAMPLE' });
});
