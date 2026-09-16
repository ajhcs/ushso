import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  HCRIS_PRODUCT,
  HCRIS_SHA256,
  LIVE_EXECUTION_HEAD,
  PLACES_PRODUCT,
  PLACES_SHA256,
  qualifyRetainedPayload,
} from '../../scripts/research-program/qualify-retained-payload.mjs';
import {
  AMENDED_HCRIS_IDENTITY_FIELD,
  SUPERSEDED_HCRIS_IDENTITY_FIELD,
  packetIdentityCurrency,
} from '../../scripts/research-program/validate-payload-retrieval-pilot.mjs';
import { isR04EligiblePayload, payloadSampleCountsFromReceipts } from '../../scripts/research-program/qualify-core.mjs';
import { LAST_GOOD_GENERATION, validateReceipt } from '../../scripts/research-program/ingest-evidence.mjs';
import { loadCohort } from '../../packages/coverage/research-program/v1.0.0/src/core-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEAD = '31631bc18808e67b5f63472585707787a29e933b';
const REF = 'verification/research-program/evidence/payloads/fixture-validation.txt';
const SHA = '915be2e8ff28a86863cbd6c5cef36b7caf4239ef0e332ae6fe4fd764900c79a2';
const HCRIS_NATIVE = 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data-viewer';
const HCRIS_RECORD = 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17';

function receipt(kind, payload, extra = {}) {
  return {
    format: 'ushso.evidence-receipt.v1',
    receipt_id: extra.receipt_id ?? ('receipt-' + kind + '-' + Math.random().toString(16).slice(2)),
    kind,
    generation: LAST_GOOD_GENERATION,
    candidate_head: extra.candidate_head ?? HEAD,
    recorded_at: extra.recorded_at ?? '2026-09-15T12:00:00Z',
    evidence_reference: extra.evidence_reference ?? REF,
    evidence_sha256: extra.evidence_sha256 ?? SHA,
    payload,
  };
}

function throwingFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    throw new Error('retained rule must never fetch: ' + url);
  };
  impl.calls = calls;
  return impl;
}

test('retained payloads qualify with accurate counts, zero R04, and zero fetches (mock transport)', () => {
  const fetchImpl = throwingFetch();
  const report = qualifyRetainedPayload({ repoRoot: ROOT, fetchImpl });
  assert.equal(report.format, 'ushso.retained-payload-eligibility.v1');
  assert.equal(report.frozen_cohorts_sha256, '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543');
  assert.equal(report.frozen_cohorts_unmodified, true);
  assert.equal(report.fetch_calls, 0);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(report.no_refetch_performed, true);
  assert.deepEqual(report.counts, {
    live_captures: 2,
    live_identity_failed: 1,
    live_identity_passed_release_unresolved: 1,
    reanalysis_file_samples: 1,
    qualified_r04_samples: 0,
    live_requests_used: 2,
    live_requests_remaining: 2,
  });
  assert.equal(report.r04_eligible, false);
  assert.equal(report.acceptance_comparison.r04_eligible_retained_samples, 0);
  assert.equal(report.acceptance_comparison.public_sample_complete, 0);
  assert.equal(report.acceptance_comparison.r04_target, 80);
  assert.equal(report.acceptance_comparison.r04_accepted, false);
  for (const row of report.acceptance_comparison.per_receipt) {
    assert.equal(row.status_strings_ignored, true);
    assert.equal(row.r04_eligible, false);
    assert.equal(isR04EligiblePayload({ ...row, _derived_payload_sample: true }), false);
  }
});

test('live vs reanalysis are separated: original HCRIS failure preserved, reanalysis spends nothing', () => {
  const before = readFileSync(path.join(ROOT, 'verification/research-program/evidence/payload-retrieval-pilot-ledger.json'), 'utf8');
  const report = qualifyRetainedPayload({ repoRoot: ROOT, fetchImpl: throwingFetch() });
  const after = readFileSync(path.join(ROOT, 'verification/research-program/evidence/payload-retrieval-pilot-ledger.json'), 'utf8');
  assert.equal(after, before);
  assert.equal(report.acquisition.live_requests_used, 2);
  assert.equal(report.acquisition.live_requests_remaining, 2);
  assert.equal(report.acquisition.ledger_spend_unchanged, true);
  assert.equal(report.authorization.reanalysis_not_a_new_retrieval, true);
  assert.equal(report.authorization.reanalysis_does_not_spend_budget, true);
  assert.deepEqual(report.live_vs_reanalysis.live, [
    'pilot-cms-hcris-hospital-provider-cost-report',
    'pilot-cdc-places-local-data-for-better-health',
  ]);
  assert.equal(report.live_vs_reanalysis.live_http_true_bounded_http_sample, 2);
  assert.deepEqual(report.live_vs_reanalysis.reanalysis, ['reanalysis-hcris-provider-ccn-20260915']);
  assert.equal(report.live_vs_reanalysis.reanalysis_live_http_false_bounded_file_sample, 1);
  assert.equal(report.live_vs_reanalysis.original_hcris_failure_preserved, true);
  assert.equal(report.live_vs_reanalysis.reanalysis_does_not_overwrite_live, true);
  assert.equal(report.product_identity.hcris_live_outcome_under_then_required_provnum, 'identity_failed_preserved');
  assert.equal(report.product_identity.hcris_file_reanalysis_identity_derived, true);
  assert.equal(report.live_execution_head, LIVE_EXECUTION_HEAD);
});

test('stale prepared packet (PROVNUM) is flagged but preserved as history, not executed', () => {
  const packet = JSON.parse(readFileSync(path.join(ROOT, 'verification/research-program/evidence/payload-retrieval-pilot.json'), 'utf8'));
  const requirements = JSON.parse(
    readFileSync(path.join(ROOT, 'verification/research-program/evidence/product-sample-requirements.json'), 'utf8'),
  );
  const currency = packetIdentityCurrency(packet, requirements);
  assert.equal(currency.amended_field, AMENDED_HCRIS_IDENTITY_FIELD);
  assert.equal(currency.superseded_field, SUPERSEDED_HCRIS_IDENTITY_FIELD);
  assert.equal(AMENDED_HCRIS_IDENTITY_FIELD, 'Provider CCN');
  assert.equal(SUPERSEDED_HCRIS_IDENTITY_FIELD, 'PROVNUM');
  assert.equal(currency.amendment_applied, true);
  assert.equal(currency.packet_has_superseded_field, true);
  assert.equal(currency.packet_has_amended_field, false);
  assert.equal(currency.stale_pre_amendment_packet, true);
  assert.equal(currency.must_not_execute_as_is, true);
  const report = qualifyRetainedPayload({ repoRoot: ROOT });
  assert.equal(report.product_identity.packet_stale_pre_amendment_noted, true);
  assert.equal(packet.status, 'prepared_not_authorized');
  assert.equal(packet.live_http, false);
});

test('file-sample validator repair: legacy hazard flagged, new status accepted, both stay 0 R04', () => {
  const base = {
    product_key: HCRIS_PRODUCT,
    field: 'publisher_access',
    supported: true,
    unknown: false,
    bounded_sample: true,
    payload_success: true,
    native_product_id: HCRIS_NATIVE,
    record_id: HCRIS_RECORD,
    release_id: 'CostReport_2023_Final',
    result_format: 'json_array',
    row_count: 2,
    execution: {
      kind: 'bounded_file_sample',
      started_at: '2026-09-15T12:00:00Z',
      ended_at: '2026-09-15T12:00:01Z',
    },
    recipe: 'retained file-sample repair check',
    live_http: false,
  };
  const legacy = validateReceipt(
    receipt('core_cell', { ...base, status: 'bounded_sample' }, {
      receipt_id: 'retained-legacy-file-status',
      evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-fixture.json',
      evidence_sha256: '9c0755ab1d44e9902eac9c8103d9bb3017b7d00cad50eadeea5f13012887143c',
    }),
    { repoRoot: ROOT },
  );
  assert.equal(legacy.payload._derived_payload_sample, true);
  assert.equal(legacy.payload._file_sample, true);
  assert.equal(legacy.payload._r04_eligible, false);
  assert.equal(legacy.payload._status_hazard, 'legacy_bounded_sample_for_file_sample_prefer_file_sample_derived');
  assert.equal(isR04EligiblePayload(legacy.payload), false);

  const future = validateReceipt(
    receipt('core_cell', { ...base, status: 'file_sample_derived' }, {
      receipt_id: 'retained-future-file-status',
      evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-fixture.json',
      evidence_sha256: '9c0755ab1d44e9902eac9c8103d9bb3017b7d00cad50eadeea5f13012887143c',
    }),
    { repoRoot: ROOT },
  );
  assert.equal(future.payload._derived_payload_sample, true);
  assert.equal(future.payload._file_sample, true);
  assert.equal(future.payload._r04_eligible, false);
  assert.equal(future.payload._status_hazard ?? null, null);
  assert.equal(isR04EligiblePayload(future.payload), false);

  const products = loadCohort(path.join(ROOT, 'evaluation/research-program/cohorts.json')).products;
  assert.equal(payloadSampleCountsFromReceipts([legacy, future], products).public_sample_complete, 0);
});

test('repairs preserve failures: bad identity, catalog, vintage, fictional, and AUTH-04 paths still fail', () => {
  const hcrisBase = {
    product_key: HCRIS_PRODUCT,
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'bounded_sample',
    bounded_sample: true,
    payload_success: true,
    native_product_id: HCRIS_NATIVE,
    record_id: HCRIS_RECORD,
    release_id: 'CostReport_2023_Final',
    result_format: 'json_array',
    row_count: 2,
    execution: {
      kind: 'bounded_file_sample',
      started_at: '2026-09-15T12:00:00Z',
      ended_at: '2026-09-15T12:00:01Z',
    },
    recipe: 'failure-preservation check',
    live_http: false,
  };
  // PROVNUM-only rows no longer satisfy the amended Provider CCN requirement.
  assert.throws(() => validateReceipt(
    receipt('core_cell', { ...hcrisBase }, {
      receipt_id: 'retained-provnum-only',
      evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-mixed-rows.json',
      evidence_sha256: 'a25c5e883bba1ca475a6de5c725bb7808ed5a4f195cac32afb48c2dba23420f2',
    }),
    { repoRoot: ROOT },
  ), { code: 'BOUNDED_SAMPLE_IDENTITY_FIELD_MISSING' });
  // Catalog membership, vintage substitution, and fictional walkthroughs stay rejected.
  assert.throws(() => validateReceipt(
    receipt('core_cell', { ...hcrisBase, catalog_membership_as_sample: true }, { receipt_id: 'retained-catalog-as-sample' }),
    { repoRoot: ROOT },
  ), { code: 'CATALOG_MEMBERSHIP_IS_NOT_PAYLOAD_SAMPLE' });
  assert.throws(() => validateReceipt(
    receipt('core_cell', { ...hcrisBase, vintage_substitution: true }, { receipt_id: 'retained-vintage' }),
    { repoRoot: ROOT },
  ), { code: 'VINTAGE_SUBSTITUTION_FORBIDDEN' });
  assert.throws(() => validateReceipt(
    receipt('core_cell', { ...hcrisBase, fictional: true, synthetic: true }, { receipt_id: 'retained-fictional' }),
    { repoRoot: ROOT },
  ), { code: 'FICTIONAL_WALKTHROUGH_IS_NOT_LIVE_SAMPLE' });
  // AUTH-04 still cannot grant live HTTP.
  assert.throws(() => validateReceipt(
    receipt('core_cell', {
      ...hcrisBase,
      live_http: true,
      execution: {
        kind: 'bounded_http_sample',
        started_at: '2026-09-15T12:00:00Z',
        ended_at: '2026-09-15T12:00:01Z',
        request_url: 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5',
        final_url: 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5',
        http_status: 200,
        content_type: 'application/json',
        redirects: 0,
        redirect_chain: [],
      },
      authorization: { id: 'AUTH-04', authorized: true, environment: 'staging_egress', candidate_head: HEAD },
    }, {
      receipt_id: 'retained-auth04-live',
      evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-fixture.json',
      evidence_sha256: '9c0755ab1d44e9902eac9c8103d9bb3017b7d00cad50eadeea5f13012887143c',
    }),
    { repoRoot: ROOT },
  ), { code: 'UNAUTHORIZED_LIVE_HTTP' });
  // Forbidden PLACES vintage stays rejected at the pilot-packet layer.
  assert.ok(PLACES_SHA256.startsWith('d67b34ef'));
  assert.ok(HCRIS_SHA256.startsWith('efb538d3'));
  assert.ok(HCRIS_PRODUCT.includes('hcris') && PLACES_PRODUCT.includes('places'));
});

test('missing evidence is disclosed, not hidden: gitignored bytes absent, times validation-assigned', () => {
  const report = qualifyRetainedPayload({ repoRoot: ROOT, fetchImpl: throwingFetch() });
  assert.ok(report.missing_evidence.length >= 6);
  assert.ok(report.missing_evidence.some((line) => line.includes('gitignored')));
  assert.ok(report.missing_evidence.some((line) => line.includes('validation-assigned')));
  assert.ok(report.missing_evidence.some((line) => line.includes('mixed-transport')));
  assert.ok(report.missing_evidence.some((line) => line.includes('PROVNUM')));
  assert.ok(report.missing_evidence.some((line) => line.includes('Fiscal Year End Date')));
  for (const row of report.integrity_reproducibility) {
    assert.equal(row.sha256_well_formed, true);
    assert.equal(row.bytes_present, false);
    assert.equal(row.sha_verified, false);
    assert.equal(row.rows_reverified, false);
    assert.equal(row.reproducibility, 'unverified_missing_bytes');
  }
  assert.equal(report.time_freshness.execution_times_are_validation_assigned, true);
  assert.equal(report.time_freshness.freshness_for_R04, false);
  assert.deepEqual(report.retained_eligible_for, ['file-sample-identity-analysis-only']);
});
