import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessFrozenCorpusEligibility,
  assessReanalysisEligibility,
  isR04EligiblePayload,
} from '../../scripts/research-program/qualify-core.mjs';
import {
  HCRIS_SHA256,
  R04_ACCEPTANCE_TEXT,
  qualifyRetainedPayload,
} from '../../scripts/research-program/qualify-retained-payload.mjs';
import { validateReceipt, LAST_GOOD_GENERATION } from '../../scripts/research-program/ingest-evidence.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Correction 4 (2026-09-17) regression: the R04 contract is the acceptance TEXT
// (R04_ACCEPTANCE_TEXT), not isR04EligiblePayload(). Four cases are
// distinguished below. Mock-only: pure predicates plus local-file reads;
// zero fetches — the throwing transport fails the suite if anything dials out.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function throwingFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    throw new Error('contract-case regression must never fetch: ' + url);
  };
  impl.calls = calls;
  return impl;
}

function derivedBase() {
  return {
    _derived_payload_sample: true,
    _derived_from_frozen_requirements: true,
    _derived_row_count: 5,
    _release_check: { status: 'verified', field: 'FY_END_DT', reason: 'mock first-party statement' },
    recipe: 'mock-only synthetic recipe for contract-case regression',
  };
}

test('contract is the quoted R04 text: threshold/denominator/numerator, still unaccepted', () => {
  assert.equal(R04_ACCEPTANCE_TEXT.status, 'unaccepted');
  assert.match(R04_ACCEPTANCE_TEXT.threshold, /At least 80 publicly accessible products/);
  assert.match(R04_ACCEPTANCE_TEXT.threshold, /exact technical recipe/);
  assert.match(R04_ACCEPTANCE_TEXT.denominator, /100 frozen product identities/);
  assert.match(R04_ACCEPTANCE_TEXT.denominator, /does not redefine the cohort/);
  assert.match(R04_ACCEPTANCE_TEXT.numerator, /Pass iff all 100/);
  assert.match(R04_ACCEPTANCE_TEXT.numerator, /cohort is not quietly redefined/);
});

test('case A: originally authorized live capture qualifies iff all five dimensions hold', () => {
  const full = {
    ...derivedBase(),
    live_http: true,
    supported: true,
    bounded_sample: true,
    payload_success: true,
  };
  assert.equal(isR04EligiblePayload(full), true);
  // Present PLACES-style live capture: identity passes but release unresolved.
  assert.equal(isR04EligiblePayload({
    ...full,
    _release_check: { status: 'unresolved', field: 'year', reason: 'mock unresolved' },
  }), false);
  // Present HCRIS-style live capture: failed, not a derived sample.
  assert.equal(isR04EligiblePayload({
    live_http: true, supported: false, bounded_sample: false, payload_success: false,
  }), false);
});

test('case B: fully-evidenced reanalysis CAN qualify — no blanket refetch from live_http=false', () => {
  const reanalysis = {
    ...derivedBase(),
    live_http: false,
    not_a_new_retrieval: true,
    reanalysis_of: 'pilot-cms-hcris-hospital-provider-cost-report',
    evidence_sha256: HCRIS_SHA256,
  };
  const verdict = assessReanalysisEligibility(reanalysis, {
    expectedSha256: HCRIS_SHA256,
    shaVerified: true,
    bytesPresent: true,
  });
  assert.equal(verdict.case, 'reanalysis_of_retained_bytes');
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.eligible, true);
  // And it is still not a Case-A live sample: the live predicate stays false
  // while the reanalysis path qualifies. live_http=false is a routing fact,
  // not a disqualifier.
  assert.equal(isR04EligiblePayload(reanalysis), false);
});

test('case B present-style: fails on release+integrity, never on live_http', () => {
  const present = {
    ...derivedBase(),
    _release_check: { status: 'unresolved', field: 'FY_END_DT', reason: 'mock unresolved' },
    live_http: false,
    not_a_new_retrieval: true,
    reanalysis_of: 'pilot-cms-hcris-hospital-provider-cost-report',
    evidence_sha256: HCRIS_SHA256,
  };
  const verdict = assessReanalysisEligibility(present, {
    expectedSha256: HCRIS_SHA256,
    shaVerified: false,
    bytesPresent: false,
  });
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.reasons.includes('release_unverified:unresolved'));
  assert.ok(verdict.reasons.includes('integrity_sha_unverified'));
  assert.ok(verdict.reasons.includes('integrity_bytes_absent'));
  // Auth chain intact, identity derived, recipe recorded: no complaint there.
  assert.ok(!verdict.reasons.some((r) => r.startsWith('auth_chain')));
  assert.ok(!verdict.reasons.includes('identity_not_derived'));
  assert.ok(!verdict.reasons.includes('recipe_missing'));
});

test('case B vs: sha mismatch, missing link, and missing derivation each disqualify', () => {
  const base = {
    ...derivedBase(),
    live_http: false,
    not_a_new_retrieval: true,
    reanalysis_of: 'pilot-cms-hcris-hospital-provider-cost-report',
    evidence_sha256: HCRIS_SHA256,
  };
  const opts = { expectedSha256: HCRIS_SHA256, shaVerified: true, bytesPresent: true };
  const mismatch = assessReanalysisEligibility(
    { ...base, evidence_sha256: '0'.repeat(64) },
    opts,
  );
  assert.equal(mismatch.eligible, false);
  assert.ok(mismatch.reasons.includes('integrity_sha_mismatch'));
  const noLink = assessReanalysisEligibility({ ...base, reanalysis_of: '' }, opts);
  assert.equal(noLink.eligible, false);
  assert.ok(noLink.reasons.includes('auth_chain_no_reanalysis_link'));
  const newRetrieval = assessReanalysisEligibility({ ...base, not_a_new_retrieval: false }, opts);
  assert.equal(newRetrieval.eligible, false);
  assert.ok(newRetrieval.reasons.includes('auth_chain_new_retrieval_claim'));
  const noIdentity = assessReanalysisEligibility(
    { ...base, _derived_payload_sample: false },
    opts,
  );
  assert.equal(noIdentity.eligible, false);
  assert.ok(noIdentity.reasons.includes('identity_not_derived'));
});

test('case C: suitably evidenced corpus qualifies; present corpus does not', () => {
  const corpus = {
    ...derivedBase(),
    live_http: false,
    evidence_sha256: HCRIS_SHA256,
  };
  const good = assessFrozenCorpusEligibility(corpus, {
    expectedSha256: HCRIS_SHA256,
    shaVerified: true,
    bytesPresent: true,
    acquisitionEvidenced: true,
  });
  assert.equal(good.case, 'frozen_local_payload_corpus');
  assert.equal(good.eligible, true);
  const present = assessFrozenCorpusEligibility(
    {
      ...corpus,
      _release_check: { status: 'unresolved', field: 'FY_END_DT', reason: 'mock unresolved' },
    },
    { expectedSha256: HCRIS_SHA256, shaVerified: false, bytesPresent: false, acquisitionEvidenced: false },
  );
  assert.equal(present.eligible, false);
  assert.ok(present.reasons.includes('acquisition_provenance_unevidenced'));
  assert.ok(present.reasons.includes('integrity_bytes_absent'));
  assert.ok(present.reasons.includes('integrity_sha_unverified'));
  assert.ok(present.reasons.includes('release_unverified:unresolved'));
});

test('case D: capture with missing acquisition/release evidence cannot qualify', () => {
  const empty = assessReanalysisEligibility({}, {});
  assert.equal(empty.eligible, false);
  assert.ok(empty.reasons.length >= 4);
  const emptyCorpus = assessFrozenCorpusEligibility({}, {});
  assert.equal(emptyCorpus.eligible, false);
  assert.ok(emptyCorpus.reasons.includes('acquisition_provenance_unevidenced'));
  assert.equal(isR04EligiblePayload({}), false);
});

test('ingest repair: _reanalysis_of link flag is set without changing throw behavior', () => {
  const receipt = {
    format: 'ushso.evidence-receipt.v1',
    receipt_id: 'corr4-reanalysis-link-flag',
    kind: 'core_cell',
    generation: LAST_GOOD_GENERATION,
    candidate_head: '31631bc18808e67b5f63472585707787a29e933b',
    recorded_at: '2026-09-15T12:00:00Z',
    evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-fixture.json',
    evidence_sha256: '9c0755ab1d44e9902eac9c8103d9bb3017b7d00cad50eadeea5f13012887143c',
    payload: {
      product_key: 'cms-hcris-hospital-provider-cost-report',
      field: 'publisher_access',
      supported: true,
      unknown: false,
      status: 'file_sample_derived',
      bounded_sample: true,
      payload_success: true,
      native_product_id: 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data-viewer',
      record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
      release_id: 'CostReport_2023_Final',
      result_format: 'json_array',
      row_count: 2,
      execution: {
        kind: 'bounded_file_sample',
        started_at: '2026-09-15T12:00:00Z',
        ended_at: '2026-09-15T12:00:01Z',
      },
      recipe: 'corr4 link-flag check',
      live_http: false,
      not_a_new_retrieval: true,
      reanalysis_of: 'pilot-cms-hcris-hospital-provider-cost-report',
    },
  };
  const validated = validateReceipt(receipt, { repoRoot: ROOT });
  assert.equal(validated.payload._reanalysis_of, 'pilot-cms-hcris-hospital-provider-cost-report');
  assert.equal(validated.payload._file_sample, true);
  assert.equal(isR04EligiblePayload(validated.payload), false);
});

test('retained report grounds four cases in the R04 text: 0/80, unaccepted, zero fetches', () => {
  const fetchImpl = throwingFetch();
  const report = qualifyRetainedPayload({ repoRoot: ROOT, fetchImpl });
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(report.fetch_calls, 0);
  const grounding = report.acceptance_grounding;
  assert.equal(grounding.case_analysis.circular_contract_rejected, true);
  assert.equal(grounding.acceptance_text.threshold, R04_ACCEPTANCE_TEXT.threshold);
  assert.deepEqual(report.counts, {
    live_captures: 2,
    live_identity_failed: 1,
    live_identity_passed_release_unresolved: 1,
    reanalysis_file_samples: 1,
    qualified_r04_samples: 0,
    live_requests_used: 2,
    live_requests_remaining: 2,
  });
  for (const row of grounding.case_analysis.case_a_live_captures) {
    assert.equal(row.case, 'a_originally_authorized_live_capture');
    assert.equal(row.eligible, false);
  }
  const caseB = grounding.case_analysis.case_b_reanalysis_present;
  assert.equal(caseB.eligible, false);
  assert.equal(caseB.can_qualify_without_refetch, true);
  assert.ok(caseB.reasons.includes('release_unverified:unresolved'));
  assert.ok(!caseB.reasons.some((r) => r.includes('live_http')));
  const caseC = grounding.case_analysis.case_c_frozen_corpus_present;
  assert.equal(caseC.eligible, false);
  assert.equal(caseC.suitably_evidenced, false);
  assert.equal(grounding.case_analysis.case_d_missing_evidence.captures_with_missing_dimensions, 3);
  assert.equal(report.acceptance_comparison.r04_accepted, false);
  assert.equal(report.r04_eligible, false);
});
