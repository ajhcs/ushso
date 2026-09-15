import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ATTEMPT_AXES,
  LAST_GOOD_GENERATION,
  calculateAttemptLedger,
  calculateObservation,
  ingestEvidence,
  resetEvidenceHashCache,
  validateReceipt,
} from '../../scripts/research-program/ingest-evidence.mjs';
import { materializeAttemptLedger } from '../../scripts/research-program/materialize-attempt-ledger.mjs';
import { observeOperations } from '../../verification/research-program/operations/observe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = "915be2e8ff28a86863cbd6c5cef36b7caf4239ef0e332ae6fe4fd764900c79a2";
const REF = "verification/research-program/evidence/payloads/fixture-validation.txt";
const HEAD = '31631bc18808e67b5f63472585707787a29e933b';

function receipt(kind, payload, extra = {}) {
  return {
    format: 'ushso.evidence-receipt.v1',
    receipt_id: extra.receipt_id ?? `receipt-${kind}`,
    kind,
    generation: LAST_GOOD_GENERATION,
    candidate_head: extra.candidate_head ?? HEAD,
    candidate_tree: extra.candidate_tree ?? '19a87a712a544465bea709e7c7addc18dcd72c39',
    recorded_at: extra.recorded_at ?? '2026-09-15T12:00:00Z',
    evidence_reference: extra.evidence_reference ?? REF,
    evidence_sha256: extra.evidence_sha256 ?? SHA,
    payload,
  };
}

const AFTER_REFRESH = {
  examples_checked: true,
  schemas_checked: true,
  joins_checked: true,
  cross_surface_checked: true,
  evidence_sha256: SHA,
};

const DEPLOYMENT = {
  deployment_id: 'dep-fixture',
  version_id: 'ver-fixture',
  candidate_head: HEAD,
  deployed_at: '2026-08-31T00:00:00Z',
};

const fixtureAuth = {
  id: 'AUTH-FIXTURE',
  authorized: true,
  environment: 'fixture',
  candidate_head: HEAD,
};

test('stale, duplicate, mismatched, incomplete, and accepted-flag receipts are rejected', () => {
  const good = receipt('attempt_axis', {
    record_id: 'obs:asset:cdc-socrata:235m-gsry-94053d5d5c02689f',
    axis: 'metadata',
    attempt_state: 'failed',
    eligibility: 'eligible',
    stop_reason: 'fixture stop',
    attempted_at: '2026-09-15T12:00:00Z',
  });
  validateReceipt(good, { repoRoot: ROOT, currentCandidateHead: HEAD });
  assert.throws(() => validateReceipt({ ...good, candidate_head: 'deadbeef' }, { repoRoot: ROOT, currentCandidateHead: HEAD }), { code: 'STALE_CANDIDATE_HEAD' });
  assert.throws(() => validateReceipt({ ...good, evidence_sha256: 'b'.repeat(64) }, { repoRoot: ROOT }), { code: 'EVIDENCE_SHA256_MISMATCH' });
  assert.throws(() => validateReceipt({ ...good, incomplete: true }, { repoRoot: ROOT }), { code: 'INCOMPLETE_RECEIPT' });
  assert.throws(() => validateReceipt({ ...good, accepted: true }, { repoRoot: ROOT }), { code: 'RECEIPT_CANNOT_SET_ACCEPTED' });
  assert.throws(() => validateReceipt({ ...good, scientific_approval: true }, { repoRoot: ROOT }), { code: 'RECEIPT_CANNOT_GRANT_SCIENTIFIC_APPROVAL' });
  const seen = new Set([good.receipt_id]);
  assert.throws(() => validateReceipt(good, { repoRoot: ROOT, seenIds: seen }), { code: 'DUPLICATE_RECEIPT_ID' });
});

test('caller-supplied observation counters remain rejected; empty receipts retain the failed snapshot', () => {
  const empty = { elapsed_observation_days: 14, complete_scheduled_cycles: 2, generated_dates: false, simulated_operation: false, scheduler_created: true, scheduler_ran: true };
  assert.throws(() => observeOperations({ observation: empty }), { code: 'OBSERVATION_RECEIPTS_REQUIRED' });
  const obs = observeOperations();
  assert.equal(obs.observation.elapsed_observation_days, 0);
  assert.equal(obs.observation.complete_scheduled_cycles, 0);
  assert.equal(obs.observation.result, 'unverified');
  assert.equal(obs.requirements.find((row) => row.id === 'R15').result, 'fail');
  assert.equal(obs.requirements.find((row) => row.id === 'R15').accepted, false);
  assert.equal(obs.program_complete, false);
});

test('validated receipts change calculated observation and attempt results without editing accepted', () => {
  const window = receipt('observation_window', {
    environment: 'staging',
    observation_started_at: '2026-09-01T00:00:00Z',
    observation_ended_at: '2026-09-15T00:00:00Z',
    generated_dates: false,
    simulated_operation: false,
    deployment: DEPLOYMENT,
    authorization: { id: 'AUTH-03', authorized: true, environment: 'staging', candidate_head: HEAD },
  }, { receipt_id: 'window-1' });
  const cycle = (id) => receipt('scheduled_cycle', {
    cycle_id: id,
    started_at: '2026-09-02T00:00:00Z',
    completed_at: '2026-09-02T06:00:00Z',
    scheduler_run_id: `run-${id}`,
    generated_dates: false,
    simulated_operation: false,
    complete: true,
    environment: 'staging',
    deployment: { deployment_id: 'dep-fixture' },
    after_refresh: AFTER_REFRESH,
  }, { receipt_id: `cycle-${id}` });
  const register = { entries: [{ id: 'AUTH-03', authorized: true }] };
  const days = calculateObservation([
    validateReceipt(window, { repoRoot: ROOT, authorizationRegister: register }),
    validateReceipt(cycle('c1'), { repoRoot: ROOT }),
    validateReceipt(cycle('c2'), { repoRoot: ROOT }),
  ]);
  assert.equal(days.elapsed_observation_days, 14);
  assert.equal(days.complete_scheduled_cycles, 2);
  assert.equal(days.technical_success, true);
  assert.equal(days.scientific_approval, false);

  const fixtureWindow = receipt('observation_window', {
    environment: 'fixture',
    observation_started_at: '2026-09-01T00:00:00Z',
    observation_ended_at: '2026-09-15T00:00:00Z',
    generated_dates: false,
    simulated_operation: false,
    deployment: DEPLOYMENT,
    authorization: fixtureAuth,
  }, { receipt_id: 'window-fixture' });
  const fixtureDays = calculateObservation([validateReceipt(fixtureWindow, { repoRoot: ROOT })]);
  assert.equal(fixtureDays.elapsed_observation_days, 14);
  assert.equal(fixtureDays.technical_success, false);
  assert.equal(fixtureDays.fixture_observation_cannot_satisfy_r15, true);

  const ids = ['obs:asset:cdc-socrata:235m-gsry-94053d5d5c02689f', 'obs:asset:cdc-socrata:2g2d-yfx9-060a56b0e1f5e82b'];
  const attemptReceipts = [];
  let n = 0;
  for (const recordId of ids) {
    for (const axis of ATTEMPT_AXES) {
      n += 1;
      attemptReceipts.push(validateReceipt(receipt('attempt_axis', {
        record_id: recordId,
        axis,
        attempt_state: 'failed',
        eligibility: 'eligible',
        stop_reason: 'bounded fixture stop',
        attempted_at: '2026-09-15T12:00:00Z',
      }, { receipt_id: `attempt-${n}` }), { repoRoot: ROOT }));
    }
  }
  const ledger = calculateAttemptLedger(attemptReceipts, ids);
  assert.equal(ledger.combinations, 8);
  assert.equal(ledger.combinations_accounted, 8);
  assert.equal(ledger.source_run_dispositions.failed, 8);
  assert.equal(ledger.source_run_dispositions.not_attempted, 0);
  assert.equal(ledger.r03.result, 'unverified');
  assert.equal(ledger.r03.accepted, false);
  assert.equal(ledger.scientific_approval, false);

  const ingested = ingestEvidence({ receipts: attemptReceipts, baselineIds: ids, repoRoot: ROOT });
  assert.equal(ingested.attempts.receipts_applied, 8);
  assert.equal(ingested.accepted_flags_edited, false);
  assert.equal(ingested.scientific_approval, false);
});

test('observeOperations uses ingested observation and still never accepts R15', () => {
  const ingestion = {
    observation: {
      elapsed_observation_days: 15,
      complete_scheduled_cycles: 2,
      required_elapsed_days: 14,
      required_scheduled_cycles: 2,
      generated_dates: false,
      simulated_operation: false,
      scheduler_created: true,
      scheduler_ran: true,
      scheduler_created_is_not_evidence_it_ran: false,
      missing_observation_time: false,
      missing_or_failed_cycle: false,
      technical_success: true,
      deployed_product_observation: true,
      scientific_approval: false,
      result: 'observed',
    },
    accepted_flags_edited: false,
    scientific_approval: false,
  };
  const obs = observeOperations({ ingestion });
  assert.equal(obs.observation.elapsed_observation_days, 15);
  assert.equal(obs.observation.complete_scheduled_cycles, 2);
  assert.equal(obs.observation.technical_success, true);
  assert.equal(obs.observation.scientific_approval, false);
  assert.equal(obs.requirements.find((row) => row.id === 'R15').result, 'observed');
  assert.equal(obs.requirements.find((row) => row.id === 'R15').accepted, false);
  assert.equal(obs.program_complete, false);
});

test('known-unsupported core cells require a limitation and still cannot count as supported', () => {
  const productKey = 'cms-hcris-hospital-provider-cost-report';
  const known = validateReceipt(receipt('core_cell', {
    product_key: productKey,
    field: 'publisher_access',
    supported: false,
    unknown: false,
    status: 'catalog_metadata_only',
    bounded_sample: false,
    verified_route: false,
    live_http: false,
    recipe: 'read frozen catalog metadata only',
    limitation: 'Dataset contents were not executed.',
  }, { receipt_id: 'core-cell-known-unsupported' }), { repoRoot: ROOT });
  assert.equal(known.payload.supported, false);
  assert.equal(known.payload.unknown, false);
  assert.throws(() => validateReceipt(receipt('core_cell', {
    product_key: productKey,
    field: 'publisher_access',
    supported: false,
    unknown: false,
    status: 'catalog_metadata_only',
    bounded_sample: false,
    verified_route: false,
    live_http: false,
    recipe: 'read frozen catalog metadata only',
  }, { receipt_id: 'core-cell-missing-limitation' }), { repoRoot: ROOT }), { code: 'CORE_CELL_LIMITATION_REQUIRED' });
  assert.throws(() => validateReceipt(receipt('core_cell', {
    product_key: productKey,
    field: 'publisher_access',
    supported: false,
    unknown: true,
    status: 'unknown',
    bounded_sample: false,
    verified_route: false,
    live_http: false,
    recipe: 'missing sample',
  }, { receipt_id: 'core-cell-unknown-without-sample' }), { repoRoot: ROOT }), { code: 'CORE_CELL_SAMPLE_OR_ROUTE_REQUIRED' });
  assert.throws(() => validateReceipt(receipt('core_cell', {
    product_key: productKey,
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'live',
    bounded_sample: true,
    live_http: true,
    recipe: 'forbidden live fetch',
  }, { receipt_id: 'core-cell-live-http' }), { repoRoot: ROOT }), { code: 'UNAUTHORIZED_LIVE_HTTP' });
  assert.throws(() => validateReceipt(receipt('core_cell', {
    product_key: productKey,
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'catalog_as_sample',
    bounded_sample: true,
    payload_success: true,
    native_product_id: 'native',
    release_id: 'release',
    catalog_membership_as_sample: true,
    live_http: false,
    recipe: 'catalog membership counted as sample',
  }, { receipt_id: 'core-cell-catalog-as-sample' }), { repoRoot: ROOT }), { code: 'CATALOG_MEMBERSHIP_IS_NOT_PAYLOAD_SAMPLE' });
  assert.throws(() => validateReceipt(receipt('core_cell', {
    product_key: 'census-acs-5year-data-profiles',
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'vintage_swap',
    bounded_sample: true,
    payload_success: true,
    native_product_id: 'https://api.census.gov/data/id/ACSDP5Y2023',
    release_id: 'ACSDP5Y2023',
    vintage_substitution: true,
    live_http: false,
    recipe: 'bind 2023 fixture to 2024 product',
  }, { receipt_id: 'core-cell-vintage-swap' }), { repoRoot: ROOT }), { code: 'VINTAGE_SUBSTITUTION_FORBIDDEN' });
  assert.throws(() => validateReceipt(receipt('core_cell', {
    product_key: 'hospital-price-transparency-mrfs',
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'fictional_as_live',
    bounded_sample: true,
    payload_success: true,
    native_product_id: 'west-mercy',
    release_id: 'v3-fictional',
    fictional: true,
    synthetic: true,
    live_http: false,
    recipe: 'count official fictional CMS walkthrough as live sample',
  }, { receipt_id: 'core-cell-fictional-sample' }), { repoRoot: ROOT }), { code: 'FICTIONAL_WALKTHROUGH_IS_NOT_LIVE_SAMPLE' });
  assert.throws(() => validateReceipt(receipt('core_cell', {
    product_key: 'ahrq-hcup',
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'workflow_as_route',
    bounded_sample: false,
    verified_route: true,
    route_id: 'hcup-read-docs',
    family_workflow_as_verified_route: true,
    live_http: false,
    recipe: 'count family workflow as verified route',
  }, { receipt_id: 'core-cell-workflow-as-route' }), { repoRoot: ROOT }), { code: 'FAMILY_WORKFLOW_IS_NOT_VERIFIED_ROUTE' });
  assert.throws(() => validateReceipt(receipt('core_cell', {
    product_key: productKey,
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'sample-without-payload',
    bounded_sample: true,
    payload_success: false,
    native_product_id: 'native',
    release_id: 'release',
    live_http: false,
    recipe: 'claim bounded sample without payload success',
  }, { receipt_id: 'core-cell-sample-without-payload' }), { repoRoot: ROOT }), { code: 'BOUNDED_SAMPLE_RECORD_ID_REQUIRED' });
  assert.throws(() => validateReceipt(receipt('core_cell', {
    product_key: productKey,
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'catalog_locator_as_sample',
    bounded_sample: true,
    payload_success: true,
    native_product_id: 'arbitrary-native-id',
    release_id: 'arbitrary-release-id',
    live_http: false,
    recipe: 'reuse catalog-slim bytes as if they were payload rows',
  }, {
    receipt_id: 'core-cell-catalog-locator-as-sample',
    evidence_reference: 'verification/research-program/pr-013/fixtures/cms-catalog-slim.json.gz',
    evidence_sha256: 'e36c53352e0781a16dac658ff4e227ed430fef88aba89d38fc70aa652df2c722',
  }), { repoRoot: ROOT }), { code: 'BOUNDED_SAMPLE_RECORD_ID_REQUIRED' });
});

test('invalid observation windows and cycles cannot report technical success', () => {
  const register = { entries: [{ id: 'AUTH-03', authorized: true }] };
  const future = receipt('observation_window', {
    environment: 'staging',
    observation_started_at: '2099-01-01T00:00:00Z',
    observation_ended_at: '2099-01-15T00:00:00Z',
    generated_dates: false,
    simulated_operation: false,
    deployment: { deployment_id: 'dep-fixture', version_id: 'ver-fixture' },
    authorization: { id: 'AUTH-03', authorized: true, environment: 'staging', candidate_head: HEAD },
  }, { receipt_id: 'window-future' });
  assert.throws(() => validateReceipt(future, { repoRoot: ROOT, authorizationRegister: register }), { code: 'OBSERVATION_WINDOW_IN_FUTURE' });

  const window = validateReceipt(receipt('observation_window', {
    environment: 'staging',
    observation_started_at: '2026-09-01T00:00:00Z',
    observation_ended_at: '2026-09-15T00:00:00Z',
    generated_dates: false,
    simulated_operation: false,
    deployment: DEPLOYMENT,
    authorization: { id: 'AUTH-03', authorized: true, environment: 'staging', candidate_head: HEAD },
  }, { receipt_id: 'window-valid' }), { repoRoot: ROOT, authorizationRegister: register });

  assert.throws(() => validateReceipt(receipt('scheduled_cycle', {
    cycle_id: 'inverted',
    started_at: '2026-09-03T00:00:00Z',
    completed_at: '2026-09-02T00:00:00Z',
    scheduler_run_id: 'run-inverted',
    generated_dates: false,
    simulated_operation: false,
    complete: true,
    after_refresh: AFTER_REFRESH,
  }, { receipt_id: 'cycle-inverted' }), { repoRoot: ROOT }), { code: 'CYCLE_TIMESTAMPS_INVERTED' });

  const outside = validateReceipt(receipt('scheduled_cycle', {
    cycle_id: 'outside',
    started_at: '2026-08-01T00:00:00Z',
    completed_at: '2026-08-01T06:00:00Z',
    scheduler_run_id: 'run-outside',
    generated_dates: false,
    simulated_operation: false,
    complete: true,
    after_refresh: AFTER_REFRESH,
  }, { receipt_id: 'cycle-outside' }), { repoRoot: ROOT });
  assert.throws(() => calculateObservation([window, outside]), { code: 'CYCLE_OUTSIDE_OBSERVATION_WINDOW' });

  const duplicateA = validateReceipt(receipt('scheduled_cycle', {
    cycle_id: 'dup-a',
    started_at: '2026-09-02T00:00:00Z',
    completed_at: '2026-09-02T06:00:00Z',
    scheduler_run_id: 'same-run',
    generated_dates: false,
    simulated_operation: false,
    complete: true,
    after_refresh: AFTER_REFRESH,
  }, { receipt_id: 'cycle-dup-a' }), { repoRoot: ROOT });
  assert.throws(() => validateReceipt(receipt('scheduled_cycle', {
    cycle_id: 'dup-b',
    started_at: '2026-09-03T00:00:00Z',
    completed_at: '2026-09-03T06:00:00Z',
    scheduler_run_id: 'same-run',
    generated_dates: false,
    simulated_operation: false,
    complete: true,
    after_refresh: AFTER_REFRESH,
  }, { receipt_id: 'cycle-dup-b' }), { repoRoot: ROOT, seenSchedulerRunIds: new Set([duplicateA.payload.scheduler_run_id]) }), { code: 'DUPLICATE_SCHEDULER_RUN_ID' });
});

test('authorized live HTTP captures remain live_http=true; AUTH-04 cannot grant that path', () => {
  const productKey = 'cms-hcris-hospital-provider-cost-report';
  const native = 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data-viewer';
  const payload = {
    product_key: productKey,
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'bounded_sample',
    bounded_sample: true,
    payload_success: true,
    native_product_id: native,
    record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
    release_id: 'CostReport_2023_Final',
    result_format: 'json_array',
    row_count: 2,
    identity_checks: { required_fields: { PROVNUM: 'string' }, constraints: { FY_END_DT: { pattern: '^2023-' } } },
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
    recipe: 'authorized bounded HTTP sample; origin remains live_http=true',
    live_http: true,
  };
  assert.throws(() => validateReceipt(receipt('core_cell', {
    ...payload,
    authorization: { id: 'AUTH-04', authorized: true, environment: 'staging_egress', candidate_head: HEAD },
  }, {
    receipt_id: 'core-cell-auth04-live',
    evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-fixture.json',
    evidence_sha256: 'dfcad649b21231c75873d1d22d7490566fb3a208a7a9b66524f0bac926533e11',
  }), { repoRoot: ROOT }), { code: 'UNAUTHORIZED_LIVE_HTTP' });
  assert.throws(() => validateReceipt(receipt('core_cell', {
    ...payload,
    authorization: { id: 'AUTH-PAYLOAD-PILOT', authorized: true, environment: 'staging_egress', candidate_head: HEAD },
  }, {
    receipt_id: 'core-cell-auth-payload-pilot-unregistered',
    evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-fixture.json',
    evidence_sha256: 'dfcad649b21231c75873d1d22d7490566fb3a208a7a9b66524f0bac926533e11',
  }), { repoRoot: ROOT }), { code: 'UNAUTHORIZED_LIVE_HTTP' });
  const granted = {
    format: 'ushso.payload-authorization-register.v1',
    entries: [{
      id: 'AUTH-PAYLOAD-PILOT',
      authorized: true,
      status: 'authorized',
      action: 'payload_retrieval',
      candidate_head: HEAD,
      product_keys: [productKey],
      endpoints: ['https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data'],
      limits: { max_rows: 5, max_bytes: 131072 },
      credentials: { required: false, kind: 'none' },
    }],
  };
  const accepted = validateReceipt(receipt('core_cell', {
    ...payload,
    authorization: { id: 'AUTH-PAYLOAD-PILOT', authorized: true, environment: 'staging_egress', candidate_head: HEAD },
  }, {
    receipt_id: 'core-cell-auth-payload-pilot',
    evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-fixture.json',
    evidence_sha256: 'dfcad649b21231c75873d1d22d7490566fb3a208a7a9b66524f0bac926533e11',
  }), { repoRoot: ROOT, payloadAuthRegister: granted });
  assert.equal(accepted.payload.live_http, true);
  assert.equal(accepted.payload._derived_payload_sample, true);
  assert.equal(accepted.payload.authorization.id, 'AUTH-PAYLOAD-PILOT');
  assert.throws(() => validateReceipt(receipt('core_cell', {
    ...payload,
    execution: { ...payload.execution, request_url: 'https://data.cdc.gov/resource/swc5-untb.json?$limit=5', final_url: 'https://data.cdc.gov/resource/swc5-untb.json?$limit=5' },
    authorization: { id: 'AUTH-PAYLOAD-PILOT', authorized: true, environment: 'staging_egress', candidate_head: HEAD },
  }, {
    receipt_id: 'core-cell-auth-payload-wrong-endpoint',
    evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-fixture.json',
    evidence_sha256: 'dfcad649b21231c75873d1d22d7490566fb3a208a7a9b66524f0bac926533e11',
  }), { repoRoot: ROOT, payloadAuthRegister: granted }), { code: 'UNAUTHORIZED_LIVE_HTTP' });
});

test('frozen 3434 IDs seed 13736 not_attempted axes without promoting not_attempted to success', () => {
  const { ids, ledger, rows } = materializeAttemptLedger({ repoRoot: ROOT });
  assert.equal(ids.length, 3434);
  assert.equal(rows.length, 13736);
  assert.equal(ledger.combinations, 13736);
  assert.equal(ledger.combinations_accounted, 13736);
  assert.equal(ledger.source_run_dispositions.not_attempted, 13736);
  assert.equal(ledger.source_run_dispositions.succeeded, 0);
  assert.equal(ledger.not_attempted_is_not_success, true);
  assert.equal(ledger.success_total_counts_unattempted_work, false);
  assert.equal(ledger.silent_loss, false);
  assert.equal(ledger.identity_accounted, true);
  assert.equal(ledger.r01.accepted, false);
  assert.equal(ledger.r01.result, 'unverified');
  assert.equal(ledger.r03.accepted, false);
  assert.equal(ledger.r03.result, 'fail');
});

test('a valid first payload row cannot hide an invalid later row', () => {
  const productKey = 'cms-hcris-hospital-provider-cost-report';
  const native = 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data-viewer';
  assert.throws(() => validateReceipt(receipt('core_cell', {
    product_key: productKey,
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'bounded_sample',
    bounded_sample: true,
    payload_success: true,
    native_product_id: native,
    record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
    release_id: 'CostReport_2023_Final',
    result_format: 'json_array',
    row_count: 2,
    execution: {
      kind: 'bounded_file_sample',
      started_at: '2026-09-15T12:00:00Z',
      ended_at: '2026-09-15T12:00:01Z',
    },
    recipe: 'mixed rows: first valid, second missing PROVNUM',
    live_http: false,
  }, {
    receipt_id: 'core-cell-mixed-rows',
    evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-mixed-rows.json',
    evidence_sha256: '789c23b0ce8a0f76fda8706dd0c35b3c0c5502169b78ab33d131fdf1ca558404',
  }), { repoRoot: ROOT }), { code: 'BOUNDED_SAMPLE_IDENTITY_FIELD_MISSING' });
});

test('caller-supplied derived flags cannot bypass frozen identity checks', () => {
  const productKey = 'cms-hcris-hospital-provider-cost-report';
  assert.throws(() => validateReceipt(receipt('core_cell', {
    product_key: productKey,
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'bounded_sample',
    bounded_sample: true,
    payload_success: true,
    native_product_id: 'arbitrary-native-id',
    record_id: 'arbitrary-record',
    release_id: 'arbitrary-release',
    result_format: 'json_array',
    row_count: 2,
    _derived_payload_sample: true,
    _derived_row_count: 2,
    _derived_from_frozen_requirements: true,
    execution: {
      kind: 'bounded_file_sample',
      started_at: '2026-09-15T12:00:00Z',
      ended_at: '2026-09-15T12:00:01Z',
    },
    recipe: 'forged derived flags',
    live_http: false,
  }, {
    receipt_id: 'core-cell-forged-derived',
    evidence_reference: 'verification/research-program/evidence/payloads/derived-sample-hcris-fixture.json',
    evidence_sha256: 'dfcad649b21231c75873d1d22d7490566fb3a208a7a9b66524f0bac926533e11',
  }), { repoRoot: ROOT }), { code: 'SAMPLE_RECORD_ID_MISMATCH' });
});

test('changed evidence bytes at the same path invalidate a cached digest', () => {
  const relative = 'verification/research-program/evidence/payloads/hash-cache-mutation.json';
  const abs = path.join(ROOT, relative);
  const first = Buffer.from('[{"PROVNUM":"010001"}]');
  writeFileSync(abs, first);
  const sha = createHash('sha256').update(first).digest('hex');
  const native = 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data-viewer';
  const payload = {
    product_key: 'cms-hcris-hospital-provider-cost-report',
    field: 'publisher_access',
    supported: true,
    unknown: false,
    status: 'bounded_sample',
    bounded_sample: true,
    payload_success: true,
    native_product_id: native,
    record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
    release_id: 'CostReport_2023_Final',
    result_format: 'json_array',
    row_count: 1,
    execution: { kind: 'bounded_file_sample', started_at: '2026-09-15T12:00:00Z', ended_at: '2026-09-15T12:00:01Z' },
    recipe: 'hash cache mutation',
    live_http: false,
  };
  try {
    resetEvidenceHashCache();
    validateReceipt(receipt('core_cell', payload, {
      receipt_id: 'hash-cache-first',
      evidence_reference: relative,
      evidence_sha256: sha,
    }), { repoRoot: ROOT });
    writeFileSync(abs, Buffer.from('[{"PROVNUM":"CHANGED"}]'));
    assert.throws(() => validateReceipt(receipt('core_cell', payload, {
      receipt_id: 'hash-cache-second',
      evidence_reference: relative,
      evidence_sha256: sha,
    }), { repoRoot: ROOT }), { code: 'EVIDENCE_SHA256_MISMATCH' });
  } finally {
    try { unlinkSync(abs); } catch {}
  }
});

test('near-future observation end and missing deployment bindings fail closed', () => {
  const register = { entries: [{ id: 'AUTH-03', authorized: true }] };
  const nearFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  assert.throws(() => validateReceipt(receipt('observation_window', {
    environment: 'staging',
    observation_started_at: '2026-09-01T00:00:00Z',
    observation_ended_at: nearFuture,
    generated_dates: false,
    simulated_operation: false,
    deployment: DEPLOYMENT,
    authorization: { id: 'AUTH-03', authorized: true, environment: 'staging', candidate_head: HEAD },
  }, { receipt_id: 'window-near-future' }), { repoRoot: ROOT, authorizationRegister: register }), { code: 'OBSERVATION_WINDOW_IN_FUTURE' });
  assert.throws(() => validateReceipt(receipt('observation_window', {
    environment: 'staging',
    observation_started_at: '2026-09-01T00:00:00Z',
    observation_ended_at: '2026-09-15T00:00:00Z',
    generated_dates: false,
    simulated_operation: false,
    deployment: { deployment_id: 'dep-fixture', version_id: 'ver-fixture' },
    authorization: { id: 'AUTH-03', authorized: true, environment: 'staging', candidate_head: HEAD },
  }, { receipt_id: 'window-missing-candidate' }), { repoRoot: ROOT, authorizationRegister: register }), { code: 'OBSERVATION_DEPLOYMENT_CANDIDATE_REQUIRED' });
  const window = validateReceipt(receipt('observation_window', {
    environment: 'staging',
    observation_started_at: '2026-09-01T00:00:00Z',
    observation_ended_at: '2026-09-15T00:00:00Z',
    generated_dates: false,
    simulated_operation: false,
    deployment: DEPLOYMENT,
    authorization: { id: 'AUTH-03', authorized: true, environment: 'staging', candidate_head: HEAD },
  }, { receipt_id: 'window-for-missing-cycle-env' }), { repoRoot: ROOT, authorizationRegister: register });
  const cycle = validateReceipt(receipt('scheduled_cycle', {
    cycle_id: 'missing-env',
    started_at: '2026-09-02T00:00:00Z',
    completed_at: '2026-09-02T06:00:00Z',
    scheduler_run_id: 'run-missing-env',
    generated_dates: false,
    simulated_operation: false,
    complete: true,
    after_refresh: AFTER_REFRESH,
  }, { receipt_id: 'cycle-missing-env' }), { repoRoot: ROOT });
  assert.throws(() => calculateObservation([window, cycle]), { code: 'CYCLE_ENVIRONMENT_REQUIRED' });
});
