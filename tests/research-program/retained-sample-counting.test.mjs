import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  RETAINED_FRESHNESS_MAX_AGE_DAYS,
  RETAINED_FRESHNESS_RULE,
  RETAINED_RECIPE_RULE,
  RETAINED_SAMPLE_QUALIFICATION_VERSION,
  assessUnifiedRetainedSample,
  payloadSampleCountsFromReceipts,
} from '../../scripts/research-program/qualify-core.mjs';
import { qualifyRetainedPayload } from '../../scripts/research-program/qualify-retained-payload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = '2026-09-16T20:00:00Z';
const LIVE_ENDED = '2026-09-15T18:40:20Z';
const LIVE_STARTED = '2026-09-15T18:40:00Z';
const FILE_STARTED = '2026-09-15T21:30:00Z';
const FILE_ENDED = '2026-09-15T21:30:01Z';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function synthProducts() {
  return [
    {
      product_key: 'synth-alpha',
      access_expectation: 'public_sample_eligible',
      anchor: { representative: { record_id: 'rec-alpha', native_id: 'nat-alpha' } },
    },
    {
      product_key: 'synth-beta',
      access_expectation: 'public_sample_eligible',
      anchor: { representative: { record_id: 'rec-beta', native_id: 'nat-beta' } },
    },
  ];
}

function synthRequirements() {
  return {
    'synth-alpha': {
      required_record_id: 'rec-alpha',
      required_native_id: 'nat-alpha',
      row_fields: { 'Provider CCN': 'string' },
      authorized_hosts: ['data.example.gov'],
      authorized_url_contains: 'alpha',
    },
    'synth-beta': {
      required_record_id: 'rec-beta',
      required_native_id: 'nat-beta',
      row_fields: { stateabbr: 'string' },
      authorized_hosts: ['data.example.gov'],
      authorized_url_contains: 'beta',
    },
  };
}

function verifiedReleases() {
  return {
    'synth-alpha': { status: 'verified', field: 'release', reason: 'mock frozen publisher doc' },
    'synth-beta': { status: 'verified', field: 'release', reason: 'mock frozen publisher doc' },
  };
}

function liveReceipt({ id, productKey, releaseId = 'REL-1', sha = SHA_A, recordedAt = NOW, startedAt = LIVE_STARTED, endedAt = LIVE_ENDED, extraPayload = {}, extraTop = {} }) {
  const rec = productKey === 'synth-beta'
    ? { record_id: 'rec-beta', native_id: 'nat-beta', urlFrag: 'beta' }
    : { record_id: 'rec-alpha', native_id: 'nat-alpha', urlFrag: 'alpha' };
  return {
    receipt_id: id,
    kind: 'core_cell',
    recorded_at: recordedAt,
    evidence_reference: 'verification/mock/' + id + '.json',
    evidence_sha256: sha,
    payload: {
      product_key: productKey,
      field: 'publisher_access',
      supported: true,
      bounded_sample: true,
      payload_success: true,
      live_http: true,
      record_id: rec.record_id,
      native_product_id: rec.native_id,
      release_id: releaseId,
      result_format: 'json_array',
      row_count: 5,
      recipe: 'mock bounded live sample recipe for ' + id,
      authorization: { id: 'AUTH-MOCK', authorized: true },
      execution: {
        kind: 'bounded_http_sample',
        started_at: startedAt,
        ended_at: endedAt,
        request_url: 'https://data.example.gov/' + rec.urlFrag + '?size=5',
        final_url: 'https://data.example.gov/' + rec.urlFrag + '?size=5',
        http_status: 200,
        content_type: 'application/json',
        redirects: 0,
        redirect_chain: [],
      },
      ...extraPayload,
    },
    ...extraTop,
  };
}

function reanalysisReceipt({ id, ofId, productKey, sha = SHA_A, extraPayload = {} }) {
  const rec = productKey === 'synth-beta'
    ? { record_id: 'rec-beta', native_id: 'nat-beta' }
    : { record_id: 'rec-alpha', native_id: 'nat-alpha' };
  return {
    receipt_id: id,
    kind: 'core_cell',
    recorded_at: NOW,
    evidence_reference: 'verification/mock/' + id + '.json',
    evidence_sha256: sha,
    payload: {
      product_key: productKey,
      field: 'publisher_access',
      supported: true,
      bounded_sample: true,
      payload_success: true,
      live_http: false,
      record_id: rec.record_id,
      native_product_id: rec.native_id,
      release_id: 'REL-1',
      result_format: 'json_array',
      row_count: 5,
      recipe: 'mock file reanalysis recipe for ' + id,
      execution: { kind: 'bounded_file_sample', started_at: FILE_STARTED, ended_at: FILE_ENDED },
      reanalysis_of: ofId,
      not_a_new_retrieval: true,
      ...extraPayload,
    },
  };
}

function corpusReceipt({ id, productKey, sha = SHA_A, extraPayload = {} }) {
  const rec = productKey === 'synth-beta'
    ? { record_id: 'rec-beta', native_id: 'nat-beta' }
    : { record_id: 'rec-alpha', native_id: 'nat-alpha' };
  return {
    receipt_id: id,
    kind: 'core_cell',
    recorded_at: NOW,
    evidence_reference: 'verification/mock/' + id + '.json',
    evidence_sha256: sha,
    payload: {
      product_key: productKey,
      field: 'publisher_access',
      supported: true,
      bounded_sample: true,
      payload_success: true,
      live_http: false,
      record_id: rec.record_id,
      native_product_id: rec.native_id,
      release_id: 'REL-1',
      result_format: 'json_array',
      row_count: 5,
      recipe: 'mock frozen corpus recipe for ' + id,
      execution: { kind: 'bounded_file_sample', started_at: FILE_STARTED, ended_at: FILE_ENDED },
      ...extraPayload,
    },
  };
}

function baseOptions(products, overrides = {}) {
  return {
    now: NOW,
    requirementsByProduct: synthRequirements(),
    releaseVerificationByProduct: verifiedReleases(),
    integrityByReceiptId: {},
    acquisitionEvidenceByReceiptId: {},
    ...overrides,
  };
}

test('unified pathway version and documented ambiguity rules are exported', () => {
  assert.equal(RETAINED_SAMPLE_QUALIFICATION_VERSION, 'ushso.retained-sample-qualification.v1');
  assert.equal(RETAINED_FRESHNESS_MAX_AGE_DAYS, 90);
  assert.equal(RETAINED_FRESHNESS_RULE.max_age_days, 90);
  assert.match(RETAINED_FRESHNESS_RULE.ambiguity, /without a numeric threshold/);
  assert.match(RETAINED_FRESHNESS_RULE.follows, /original capture/);
  assert.match(RETAINED_RECIPE_RULE.ambiguity, /re-executability/);
  assert.match(RETAINED_RECIPE_RULE.requires, /non-empty payload.recipe/);
});

test('fully-evidenced live capture counts once without refetch', () => {
  const products = synthProducts();
  const receipts = [liveReceipt({ id: 'live-alpha-1', productKey: 'synth-alpha' })];
  const counts = payloadSampleCountsFromReceipts(receipts, products, baseOptions(products));
  assert.equal(counts.unified_pathway, RETAINED_SAMPLE_QUALIFICATION_VERSION);
  assert.equal(counts.samples_are_distinct_frozen_products, true);
  assert.equal(counts.public_sample_complete, 1);
  assert.equal(counts.assessments.length, 1);
  assert.equal(counts.assessments[0].eligible, true);
  assert.equal(counts.assessments[0].case, 'live_capture');
});

test('fully-evidenced reanalysis counts once without refetch when reference resolves to live original', () => {
  const products = synthProducts();
  const live = liveReceipt({ id: 'live-alpha-1', productKey: 'synth-alpha' });
  const re = reanalysisReceipt({ id: 're-alpha-1', ofId: 'live-alpha-1', productKey: 'synth-alpha' });
  const options = baseOptions(products, {
    integrityByReceiptId: { 're-alpha-1': { bytesPresent: true, shaVerified: true, expectedSha256: SHA_A } },
  });
  const counts = payloadSampleCountsFromReceipts([re], products, options);
  // Reanalysis alone needs its original present for reference resolution, so
  // include the live receipt in a second count and expect dedupe to one.
  assert.equal(counts.public_sample_complete, 0);
  assert.ok(counts.assessments[0].reasons.includes('auth_chain_unresolved_reference'));
  const both = payloadSampleCountsFromReceipts([live, re], products, options);
  assert.equal(both.public_sample_complete, 1);
  const byId = Object.fromEntries(both.assessments.map((a) => [a.receipt_id, a]));
  assert.equal(byId['live-alpha-1'].eligible, true);
  assert.equal(byId['re-alpha-1'].eligible, true);
  assert.equal(byId['re-alpha-1'].case, 'reanalysis_of_retained_bytes');
});

test('fully-evidenced frozen corpus counts once without refetch when manifest binds acquisition', () => {
  const products = synthProducts();
  const corpus = corpusReceipt({ id: 'corpus-alpha-1', productKey: 'synth-alpha' });
  const noManifest = payloadSampleCountsFromReceipts([corpus], products, baseOptions(products, {
    integrityByReceiptId: { 'corpus-alpha-1': { bytesPresent: true, shaVerified: true, expectedSha256: SHA_A } },
  }));
  assert.equal(noManifest.public_sample_complete, 0);
  assert.ok(noManifest.assessments[0].reasons.includes('acquisition_provenance_unevidenced'));
  const withManifest = payloadSampleCountsFromReceipts([corpus], products, baseOptions(products, {
    integrityByReceiptId: { 'corpus-alpha-1': { bytesPresent: true, shaVerified: true, expectedSha256: SHA_A } },
    acquisitionEvidenceByReceiptId: { 'corpus-alpha-1': true },
  }));
  assert.equal(withManifest.public_sample_complete, 1);
  assert.equal(withManifest.assessments[0].case, 'frozen_local_payload_corpus');
});

test('forged derived and eligibility flags count zero when real fields fail', () => {
  const products = synthProducts();
  const forged = liveReceipt({
    id: 'live-alpha-forged',
    productKey: 'synth-alpha',
    extraPayload: {
      recipe: '',
      _derived_payload_sample: true,
      _derived_from_frozen_requirements: true,
      _derived_row_count: 999,
      _release_check: { status: 'verified', field: 'x', reason: 'forged' },
      _r04_eligible: true,
      _file_sample: false,
      _reanalysis_of: 'forged-link',
      _evidence_kind: 'forged',
      _product_sample_requirement: { row_fields: { forged: 'string' } },
      eligible: true,
      r04_eligible: true,
      qualified: true,
      accepted: true,
    },
  });
  // No release verification supplied (missing) + blank recipe: real fields fail.
  // Forged verified release-check and derived flags must not rescue it.
  const counts = payloadSampleCountsFromReceipts([forged], products, baseOptions(products, {
    releaseVerificationByProduct: {},
  }));
  assert.equal(counts.public_sample_complete, 0);
  assert.ok(counts.assessments[0].reasons.includes('recipe_missing'));
  assert.ok(counts.assessments[0].reasons.includes('release_unverified:missing'));
});

test('fully-evidenced receipt still counts once when forged flags claim failure', () => {
  const products = synthProducts();
  const receipts = [liveReceipt({
    id: 'live-alpha-flags-false',
    productKey: 'synth-alpha',
    extraPayload: {
      _derived_payload_sample: false,
      _derived_from_frozen_requirements: false,
      _derived_row_count: 0,
      _release_check: { status: 'unresolved' },
      _r04_eligible: false,
      eligible: false,
      r04_eligible: false,
      qualified: false,
    },
  })];
  const counts = payloadSampleCountsFromReceipts(receipts, products, baseOptions(products));
  assert.equal(counts.public_sample_complete, 1);
});

test('live capture plus its eligible reanalysis count once (not twice)', () => {
  const products = synthProducts();
  const live = liveReceipt({ id: 'live-alpha-1', productKey: 'synth-alpha' });
  const re = reanalysisReceipt({ id: 're-alpha-1', ofId: 'live-alpha-1', productKey: 'synth-alpha' });
  const options = baseOptions(products, {
    integrityByReceiptId: { 're-alpha-1': { bytesPresent: true, shaVerified: true, expectedSha256: SHA_A } },
  });
  const counts = payloadSampleCountsFromReceipts([live, re], products, options);
  assert.equal(counts.public_sample_complete, 1);
});

test('two releases of one product count once; two products count twice', () => {
  const products = synthProducts();
  const rel1 = liveReceipt({ id: 'live-alpha-rel1', productKey: 'synth-alpha', releaseId: 'REL-2023' });
  const rel2 = liveReceipt({ id: 'live-alpha-rel2', productKey: 'synth-alpha', releaseId: 'REL-2024', sha: SHA_B });
  const one = payloadSampleCountsFromReceipts([rel1, rel2], products, baseOptions(products));
  assert.equal(one.public_sample_complete, 1);
  const beta = liveReceipt({ id: 'live-beta-1', productKey: 'synth-beta', sha: SHA_C });
  const two = payloadSampleCountsFromReceipts([rel1, beta], products, baseOptions(products));
  assert.equal(two.public_sample_complete, 2);
});

test('missing bytes count zero (reanalysis and corpus)', () => {
  const products = synthProducts();
  const live = liveReceipt({ id: 'live-alpha-1', productKey: 'synth-alpha' });
  const reAbsent = reanalysisReceipt({ id: 're-alpha-absent', ofId: 'live-alpha-1', productKey: 'synth-alpha' });
  const absent = payloadSampleCountsFromReceipts([live, reAbsent], products, baseOptions(products, {
    integrityByReceiptId: { 're-alpha-absent': { bytesPresent: false, shaVerified: true, expectedSha256: SHA_A } },
  }));
  assert.equal(absent.public_sample_complete, 1);
  assert.ok(absent.assessments.find((a) => a.receipt_id === 're-alpha-absent').reasons.includes('integrity_bytes_absent'));
  const corpusAbsent = corpusReceipt({ id: 'corpus-alpha-absent', productKey: 'synth-alpha' });
  const corpusCounts = payloadSampleCountsFromReceipts([corpusAbsent], products, baseOptions(products, {
    integrityByReceiptId: { 'corpus-alpha-absent': { bytesPresent: false, shaVerified: false, expectedSha256: SHA_A } },
    acquisitionEvidenceByReceiptId: { 'corpus-alpha-absent': true },
  }));
  assert.equal(corpusCounts.public_sample_complete, 0);
});

test('digest mismatch counts zero', () => {
  const products = synthProducts();
  const live = liveReceipt({ id: 'live-alpha-1', productKey: 'synth-alpha', sha: SHA_A });
  const reMismatch = reanalysisReceipt({
    id: 're-alpha-mismatch', ofId: 'live-alpha-1', productKey: 'synth-alpha', sha: SHA_B,
  });
  const counts = payloadSampleCountsFromReceipts([live, reMismatch], products, baseOptions(products, {
    integrityByReceiptId: { 're-alpha-mismatch': { bytesPresent: true, shaVerified: true, expectedSha256: SHA_B } },
  }));
  // Receipt SHA differs from the original capture SHA: not the same bytes.
  assert.equal(counts.public_sample_complete, 1);
  assert.ok(counts.assessments.find((a) => a.receipt_id === 're-alpha-mismatch').reasons.includes('integrity_sha_mismatch'));
  const claimedMismatch = liveReceipt({
    id: 'live-alpha-claimed', productKey: 'synth-alpha', sha: SHA_A, extraPayload: { evidence_sha256: SHA_C },
  });
  const claimed = payloadSampleCountsFromReceipts([claimedMismatch], products, baseOptions(products));
  assert.equal(claimed.public_sample_complete, 0);
  assert.ok(claimed.assessments[0].reasons.includes('integrity_sha_mismatch'));
});

test('missing authorization and provenance count zero', () => {
  const products = synthProducts();
  const noAuth = liveReceipt({ id: 'live-noauth', productKey: 'synth-alpha', extraPayload: { authorization: { id: '', authorized: false } } });
  assert.equal(payloadSampleCountsFromReceipts([noAuth], products, baseOptions(products)).public_sample_complete, 0);
  const live = liveReceipt({ id: 'live-alpha-1', productKey: 'synth-alpha' });
  const dangling = reanalysisReceipt({ id: 're-dangling', ofId: 'receipt-that-does-not-exist', productKey: 'synth-alpha' });
  const danglingCounts = payloadSampleCountsFromReceipts([live, dangling], products, baseOptions(products, {
    integrityByReceiptId: { 're-dangling': { bytesPresent: true, shaVerified: true, expectedSha256: SHA_A } },
  }));
  assert.equal(danglingCounts.public_sample_complete, 1);
  assert.ok(danglingCounts.assessments.find((a) => a.receipt_id === 're-dangling').reasons.includes('auth_chain_unresolved_reference'));
});

test('nonempty reanalysis_of alone never implies provenance; live_http=false never implies original was offline', () => {
  const products = synthProducts();
  const offlineOriginal = liveReceipt({
    id: 'orig-offline', productKey: 'synth-alpha', extraPayload: { live_http: false, execution: { kind: 'bounded_file_sample', started_at: FILE_STARTED, ended_at: FILE_ENDED } },
  });
  const reOfOffline = reanalysisReceipt({ id: 're-of-offline', ofId: 'orig-offline', productKey: 'synth-alpha' });
  const options = baseOptions(products, {
    integrityByReceiptId: { 're-of-offline': { bytesPresent: true, shaVerified: true, expectedSha256: SHA_A } },
  });
  const counts = payloadSampleCountsFromReceipts([offlineOriginal, reOfOffline], products, options);
  assert.equal(counts.public_sample_complete, 0);
  const verdict = counts.assessments.find((a) => a.receipt_id === 're-of-offline');
  assert.ok(verdict.reasons.includes('auth_chain_original_not_live'));
  // Direct unit check: unresolved reference fails even with a nonempty string.
  const solo = assessUnifiedRetainedSample(reanalysisReceipt({ id: 're-solo', ofId: 'missing-original', productKey: 'synth-alpha' }), {
    productsByKey: new Map(synthProducts().map((p) => [p.product_key, p])),
    receiptsById: new Map(),
    releaseVerificationByProduct: verifiedReleases(),
    requirementsByProduct: synthRequirements(),
    integrityByReceiptId: { 're-solo': { bytesPresent: true, shaVerified: true, expectedSha256: SHA_A } },
    now: NOW,
  });
  assert.equal(solo.eligible, false);
  assert.ok(solo.reasons.includes('auth_chain_unresolved_reference'));
});

test('unresolved release counts zero; missing release map fails closed', () => {
  const products = synthProducts();
  const receipts = [liveReceipt({ id: 'live-alpha-1', productKey: 'synth-alpha' })];
  const unresolved = payloadSampleCountsFromReceipts(receipts, products, baseOptions(products, {
    releaseVerificationByProduct: { 'synth-alpha': { status: 'unresolved', field: 'year', reason: 'mock unresolved' } },
  }));
  assert.equal(unresolved.public_sample_complete, 0);
  assert.ok(unresolved.assessments[0].reasons.includes('release_unverified:unresolved'));
  const missing = payloadSampleCountsFromReceipts(receipts, products, baseOptions(products, {
    releaseVerificationByProduct: {},
  }));
  assert.equal(missing.public_sample_complete, 0);
  assert.ok(missing.assessments[0].reasons.includes('release_unverified:missing'));
});

test('stale acquisition counts zero per the documented freshness rule; freshness follows the capture', () => {
  const products = synthProducts();
  const stale = liveReceipt({
    id: 'live-stale', productKey: 'synth-alpha', startedAt: '2025-01-01T00:00:00Z', endedAt: '2025-01-01T00:00:05Z',
  });
  const staleCounts = payloadSampleCountsFromReceipts([stale], products, baseOptions(products));
  assert.equal(staleCounts.public_sample_complete, 0);
  assert.ok(staleCounts.assessments[0].reasons.includes('freshness_stale'));
  // Reanalysis freshness follows the ORIGINAL capture, not the file timestamp.
  const oldLive = liveReceipt({
    id: 'live-old', productKey: 'synth-alpha', startedAt: '2025-01-01T00:00:00Z', endedAt: '2025-01-01T00:00:05Z',
  });
  const reOfOld = reanalysisReceipt({ id: 're-of-old', ofId: 'live-old', productKey: 'synth-alpha' });
  const reCounts = payloadSampleCountsFromReceipts([oldLive, reOfOld], products, baseOptions(products, {
    integrityByReceiptId: { 're-of-old': { bytesPresent: true, shaVerified: true, expectedSha256: SHA_A } },
  }));
  assert.equal(reCounts.public_sample_complete, 0);
  assert.ok(reCounts.assessments.find((a) => a.receipt_id === 're-of-old').reasons.includes('freshness_stale'));
  // Missing acquisition time is excluded as ambiguous, not assumed recent.
  const noTime = liveReceipt({
    id: 'live-notime', productKey: 'synth-alpha', extraPayload: { execution: { kind: 'bounded_http_sample' } },
  });
  const noTimeCounts = payloadSampleCountsFromReceipts([noTime], products, baseOptions(products));
  assert.equal(noTimeCounts.public_sample_complete, 0);
  assert.ok(noTimeCounts.assessments[0].reasons.includes('acquisition_time_unparseable'));
});

test('missing recipe counts zero (ambiguity A2 kept excluded)', () => {
  const products = synthProducts();
  const noRecipe = liveReceipt({ id: 'live-norecipe', productKey: 'synth-alpha', extraPayload: { recipe: '   ' } });
  const counts = payloadSampleCountsFromReceipts([noRecipe], products, baseOptions(products));
  assert.equal(counts.public_sample_complete, 0);
  assert.ok(counts.assessments[0].reasons.includes('recipe_missing'));
});

test('present HCRIS/PLACES samples remain zero with actual limitations', () => {
  const hcris = JSON.parse(readFileSync(path.join(ROOT, 'verification/research-program/evidence/pilot-receipts/cms-hcris-hospital-provider-cost-report.json'), 'utf8'));
  const places = JSON.parse(readFileSync(path.join(ROOT, 'verification/research-program/evidence/pilot-receipts/cdc-places-local-data-for-better-health.json'), 'utf8'));
  const reanalysisFile = JSON.parse(readFileSync(path.join(ROOT, 'verification/research-program/evidence/reanalysis/hcris-provider-ccn-20260915.json'), 'utf8'));
  const reanalysis = reanalysisFile.receipt ?? reanalysisFile;
  const cohorts = JSON.parse(readFileSync(path.join(ROOT, 'evaluation/research-program/cohorts.json'), 'utf8'));
  const bare = payloadSampleCountsFromReceipts([hcris, places, reanalysis], cohorts.products ?? []);
  assert.equal(bare.public_sample_complete, 0);
  const byId = Object.fromEntries(bare.assessments.map((a) => [a.receipt_id, a]));
  assert.ok(byId['pilot-cms-hcris-hospital-provider-cost-report'].reasons.includes('sample_not_supported'));
  assert.ok(byId['pilot-cdc-places-local-data-for-better-health'].reasons.includes('release_unverified:missing'));
  assert.ok(byId['reanalysis-hcris-provider-ccn-20260915'].reasons.includes('integrity_bytes_absent'));
});

test('current evidence stays zero through the retained rule with unified wiring', () => {
  const report = qualifyRetainedPayload({ repoRoot: ROOT, fetchImpl: null });
  assert.equal(report.acceptance_comparison.public_sample_complete, 0);
  assert.equal(report.acceptance_comparison.r04_eligible_retained_samples, 0);
  assert.equal(report.acceptance_comparison.r04_accepted, false);
  assert.equal(report.r04_eligible, false);
  assert.equal(report.fetch_calls, 0);
  assert.equal(report.no_refetch_performed, true);
  for (const row of report.acceptance_comparison.unified_assessments) {
    assert.equal(row.eligible, false);
  }
});
