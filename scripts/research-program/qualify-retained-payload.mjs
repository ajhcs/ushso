#!/usr/bin/env node
// Retained-payload eligibility rule — Track 3 (2026-09-16).
//
// Qualifies the two EXISTING pilot captures + one file-sample reanalysis
// without issuing any new publisher request. No fetch, no ledger spend,
// no AUTH rebind, no cohort edit. File reanalysis is separate from live and
// contributes 0 R04 samples.
//
// Live history (SHA 2efafed, AUTH-PAYLOAD-PILOT, 2 used / 2 remaining):
//   - HCRIS 44060663: identity FAILED under then-required PROVNUM
//     (live rows expose Provider CCN). Original failure preserved.
//   - PLACES swc5-untb: identity PASSED on stateabbr, release UNRESOLVED (year).
// Amendment HCRIS-IDENTITY-PROVIDER-CCN-20260915 requires Provider CCN for any
// future run or file reanalysis. The prepared packet (PROVNUM) is preserved as
// pre-amendment history and must not be executed as-is.
//
// Acceptance ground (docs/research-program/acceptance.md R04, unaccepted):
// "Frozen 100-product cohort has complete mandatory source cards. At least 80
// publicly accessible products have a recent successful bounded sample and
// exact technical recipe; remaining cohort members have verified
// restricted/manual access routes." Denominator: 100 frozen product
// identities; numerator: 100 source cards + >=80 public bounded samples with
// exact recipes + verified restricted routes. Correction 4 (2026-09-17): this
// rule compares the retained receipts against THAT text across four cases —
// (a) originally authorized live capture, (b) later local reanalysis of the
// same bytes, (c) suitably evidenced frozen corpus, (d) capture with missing
// evidence — instead of defining the contract as isR04EligiblePayload() and
// concluding the implementation matches itself. isR04EligiblePayload() remains
// the Case-A live-sample engineering predicate; assessReanalysisEligibility()
// and assessFrozenCorpusEligibility() state when Cases B/C can qualify without
// a refetch. Receipt status strings never count. Present receipts fail on
// identity/release dimensions, so the retained set yields exactly 0 R04.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packetIdentityCurrency } from './validate-payload-retrieval-pilot.mjs';
import {
  assessFrozenCorpusEligibility,
  assessReanalysisEligibility,
  isR04EligiblePayload,
  payloadSampleCountsFromReceipts,
} from './qualify-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const RETAINED_PAYLOAD_RULE_VERSION = 'ushso.retained-payload-eligibility.v1';
export const FROZEN_COHORTS_SHA256 = '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543';
export const LIVE_EXECUTION_HEAD = '2efafed96104012da2d17ec14d8a93c5b33a3d25';
export const REANALYSIS_CANDIDATE = 'be7d32b6a238571402a94e4723b914f86cc1907a';
export const HCRIS_SHA256 = 'efb538d31b8d51bf8443b12b617271617afd2f73bf379ed53c0e8bdad2eba08f';
export const PLACES_SHA256 = 'd67b34efce9a129cd4d79dc56b05961c2741f41807d6dd54b154c905179ca6f4';
export const HCRIS_PRODUCT = 'cms-hcris-hospital-provider-cost-report';
export const PLACES_PRODUCT = 'cdc-places-local-data-for-better-health';

// Correction 4 (2026-09-17): verbatim R04 acceptance text from
// docs/research-program/acceptance.md. The rule compares retained receipts
// against THIS text — it must never define the contract as
// isR04EligiblePayload() and then conclude the implementation matches itself.
export const R04_ACCEPTANCE_TEXT = Object.freeze({
  source: 'docs/research-program/acceptance.md R04 — Core research sources are usable',
  status: 'unaccepted',
  frame_state: 'identities_frozen_usability_not_materialized',
  threshold: 'Frozen 100-product cohort has complete mandatory source cards. At least 80 '
    + 'publicly accessible products have a recent successful bounded sample and exact '
    + 'technical recipe; remaining cohort members have verified restricted/manual access '
    + 'routes. Record versions are not extra products.',
  denominator: '100 frozen product identities from C-002-1. Public-sample target uses '
    + 'the public-access subset of that same 100; it does not redefine the cohort.',
  numerator: 'Pass iff all 100 have complete mandatory source cards, at least 80 '
    + 'public-access members have recent successful bounded samples plus exact recipes, '
    + 'and every remaining member has a verified restricted/manual route. Shortfall is '
    + 'reported; the cohort is not quietly redefined.',
});

const PACKET_REL = 'verification/research-program/evidence/payload-retrieval-pilot.json';
const AUTH_REL = 'verification/research-program/authorization/payload-authorizations.json';
const LEDGER_REL = 'verification/research-program/evidence/payload-retrieval-pilot-ledger.json';
const RUN_REL = 'verification/research-program/evidence/payload-retrieval-pilot-run.json';
const REQUIREMENTS_REL = 'verification/research-program/evidence/product-sample-requirements.json';
const COHORTS_REL = 'evaluation/research-program/cohorts.json';
const HCRIS_RECEIPT_REL = 'verification/research-program/evidence/pilot-receipts/cms-hcris-hospital-provider-cost-report.json';
const PLACES_RECEIPT_REL = 'verification/research-program/evidence/pilot-receipts/cdc-places-local-data-for-better-health.json';
const REANALYSIS_REL = 'verification/research-program/evidence/reanalysis/hcris-provider-ccn-20260915.json';
const CAPTURE_DIR_REL = 'verification/research-program/evidence/payloads/pilot-r04';

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function readJson(repoRoot, rel) {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8'));
  } catch (error) {
    fail('RETAINED_EVIDENCE_UNREADABLE', rel + ': ' + error.message);
  }
}

function isRfc3339(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function assertNoFetch(fetchCalls) {
  if (fetchCalls !== 0) fail('RETAINED_RULE_MUST_NOT_FETCH', String(fetchCalls));
}

export function qualifyRetainedPayload({ repoRoot = ROOT, fetchImpl = null } = {}) {
  let fetchCalls = 0;
  const countedFetch = fetchImpl
    ? async (...args) => {
      fetchCalls += 1;
      return fetchImpl(...args);
    }
    : null;
  void countedFetch;

  const cohortsBytes = readFileSync(path.join(repoRoot, COHORTS_REL));
  const cohortsSha = createHash('sha256').update(cohortsBytes).digest('hex');
  if (cohortsSha !== FROZEN_COHORTS_SHA256) fail('FROZEN_COHORTS_CHANGED');
  const cohorts = JSON.parse(cohortsBytes.toString('utf8'));
  const byKey = Object.fromEntries((cohorts.products ?? []).map((row) => [row.product_key, row]));
  const hcrisFrozen = byKey[HCRIS_PRODUCT];
  const placesFrozen = byKey[PLACES_PRODUCT];
  if (!hcrisFrozen || !placesFrozen) fail('RETAINED_PRODUCT_NOT_IN_COHORT');
  if (hcrisFrozen.access_expectation !== 'public_sample_eligible') fail('RETAINED_NOT_PUBLIC_SAMPLE_ELIGIBLE', HCRIS_PRODUCT);
  if (placesFrozen.access_expectation !== 'public_sample_eligible') fail('RETAINED_NOT_PUBLIC_SAMPLE_ELIGIBLE', PLACES_PRODUCT);

  const requirements = readJson(repoRoot, REQUIREMENTS_REL);
  const amendment = (requirements.amendments ?? []).find((row) => row.id === 'HCRIS-IDENTITY-PROVIDER-CCN-20260915');
  if (!amendment || amendment.status !== 'applied') fail('RETAINED_AMENDMENT_MISSING');
  if (amendment.to_field !== 'Provider CCN' || amendment.from_field !== 'PROVNUM') fail('RETAINED_AMENDMENT_FIELD');
  if (amendment.does_not_rewrite_prior_failed_attempt !== true) fail('RETAINED_AMENDMENT_MUST_PRESERVE_FAILURE');
  if (amendment.not_a_new_retrieval !== true) fail('RETAINED_AMENDMENT_NOT_A_RETRIEVAL');
  const hcrisReq = requirements.products?.[HCRIS_PRODUCT];
  const placesReq = requirements.products?.[PLACES_PRODUCT];
  if (!hcrisReq || !placesReq) fail('PRODUCT_SAMPLE_REQUIREMENT_MISSING');
  if (JSON.stringify(Object.keys(hcrisReq.row_fields ?? {})) !== JSON.stringify(['Provider CCN'])) fail('RETAINED_HCRIS_REQUIRES_PROVIDER_CCN');
  if (JSON.stringify(Object.keys(placesReq.row_fields ?? {})) !== JSON.stringify(['stateabbr'])) fail('RETAINED_PLACES_REQUIRES_STATEABBR');
  if (hcrisReq.release_check?.status !== 'unresolved') fail('RETAINED_HCRIS_RELEASE_MUST_STAY_UNRESOLVED');
  if (placesReq.release_check?.status !== 'unresolved') fail('RETAINED_PLACES_RELEASE_MUST_STAY_UNRESOLVED');
  if (!(placesReq.forbidden_native_ids ?? []).includes('7cmc-7y5g')) fail('PLACES_FORBIDDEN_ID_MISSING');

  const packet = readJson(repoRoot, PACKET_REL);
  if (packet.status !== 'prepared_not_authorized') fail('RETAINED_PACKET_HISTORY_CHANGED');
  if (packet.live_http === true) fail('RETAINED_PACKET_MUST_NOT_BE_LIVE');
  if (packet.accepted === true || packet.scientific_approval === true) fail('RETAINED_PACKET_MUST_NOT_BE_ACCEPTED');
  const currency = packetIdentityCurrency(packet, requirements);
  if (currency.amendment_applied !== true) fail('RETAINED_CURRENCY_AMENDMENT');
  const packetStaleNoted = currency.stale_pre_amendment_packet === true
    && currency.packet_has_superseded_field === true
    && currency.packet_has_amended_field === false;

  const auth = readJson(repoRoot, AUTH_REL);
  const entry = (auth.entries ?? []).find((row) => row.id === 'AUTH-PAYLOAD-PILOT');
  if (!entry || entry.authorized !== true || entry.status !== 'authorized') fail('RETAINED_AUTH_NOT_GRANTED');
  if (entry.candidate_head !== LIVE_EXECUTION_HEAD) fail('RETAINED_AUTH_HEAD', entry.candidate_head);
  if (entry.action !== 'payload_retrieval') fail('RETAINED_AUTH_ACTION');
  if (!entry.product_keys?.includes(HCRIS_PRODUCT) || !entry.product_keys?.includes(PLACES_PRODUCT)) fail('RETAINED_AUTH_PRODUCTS');
  if (!entry.endpoints?.some((url) => url.includes('44060663-47d8-4ced-a115-b53b4c270acb'))) fail('RETAINED_AUTH_HCRIS_ENDPOINT');
  if (!entry.endpoints?.some((url) => url.includes('swc5-untb'))) fail('RETAINED_AUTH_PLACES_ENDPOINT');
  if (entry.limits?.max_requests !== 4 || entry.limits?.max_requests_per_source !== 2) fail('RETAINED_AUTH_LIMITS');
  if (entry.limits?.max_rows_per_source !== 5 || entry.limits?.max_bytes_per_source !== 131072) fail('RETAINED_AUTH_LIMITS');
  if ((entry.credentials?.kind ?? 'none') !== 'none') fail('RETAINED_AUTH_CREDENTIALS');

  const ledgerBytesBefore = readFileSync(path.join(repoRoot, LEDGER_REL), 'utf8');
  const ledger = JSON.parse(ledgerBytesBefore);
  if (ledger.format !== 'ushso.payload-retrieval-pilot-ledger.v1') fail('RETAINED_LEDGER_FORMAT');
  if (ledger.authorization_id !== 'AUTH-PAYLOAD-PILOT') fail('RETAINED_LEDGER_AUTH');
  if (ledger.closed === true) fail('RETAINED_LEDGER_CLOSED');
  if (ledger.totals?.max_requests !== 4 || ledger.totals?.used_requests !== 2 || ledger.totals?.remaining_requests !== 2) {
    fail('RETAINED_LEDGER_BUDGET', JSON.stringify(ledger.totals));
  }
  for (const key of [HCRIS_PRODUCT, PLACES_PRODUCT]) {
    const source = ledger.per_source?.[key];
    if (!source || source.max_requests !== 2 || source.used_requests !== 1 || source.remaining_requests !== 1) {
      fail('RETAINED_LEDGER_SOURCE_BUDGET', key);
    }
  }
  if (!ledger.attempts?.some((id) => String(id).includes('hcris')) || !ledger.attempts?.some((id) => String(id).includes('places'))) {
    fail('RETAINED_LEDGER_ATTEMPTS');
  }

  const run = readJson(repoRoot, RUN_REL);
  if (run.candidate_head !== LIVE_EXECUTION_HEAD) fail('RETAINED_RUN_HEAD');
  if (run.authorized !== true || run.live_http !== true) fail('RETAINED_RUN_LIVE');
  if (run.accepted === true || run.r04_accepted === true) fail('RETAINED_RUN_MUST_NOT_ACCEPT');
  if (run.requests_used !== 2 || run.requests_remaining !== 2) fail('RETAINED_RUN_BUDGET');
  if (run.frozen_cohorts_sha256 !== FROZEN_COHORTS_SHA256) fail('RETAINED_RUN_COHORT');
  const hcrisCapture = (run.captures ?? []).find((row) => row.product_key === HCRIS_PRODUCT);
  const placesCapture = (run.captures ?? []).find((row) => row.product_key === PLACES_PRODUCT);
  if (!hcrisCapture || !placesCapture) fail('RETAINED_RUN_CAPTURES');
  if (hcrisCapture.result !== 'identity_failed') fail('RETAINED_HCRIS_MUST_REMAIN_IDENTITY_FAILED', hcrisCapture.result);
  if (hcrisCapture.evidence_sha256 !== HCRIS_SHA256) fail('RETAINED_HCRIS_SHA');
  if (hcrisCapture.rows !== 5 || hcrisCapture.bytes !== 20751 || hcrisCapture.http_status !== 200) fail('RETAINED_HCRIS_COUNTS');
  if (placesCapture.result !== 'identity_passed_release_unresolved') fail('RETAINED_PLACES_RESULT', placesCapture.result);
  if (placesCapture.evidence_sha256 !== PLACES_SHA256) fail('RETAINED_PLACES_SHA');
  if (placesCapture.rows !== 5 || placesCapture.bytes !== 3194 || placesCapture.http_status !== 200) fail('RETAINED_PLACES_COUNTS');
  if (placesCapture.release_check?.status !== 'unresolved') fail('RETAINED_PLACES_RELEASE');

  const hcrisReceipt = readJson(repoRoot, HCRIS_RECEIPT_REL);
  const placesReceipt = readJson(repoRoot, PLACES_RECEIPT_REL);
  for (const [receipt, key] of [[hcrisReceipt, HCRIS_PRODUCT], [placesReceipt, PLACES_PRODUCT]]) {
    if (receipt.format !== 'ushso.evidence-receipt.v1' || receipt.kind !== 'core_cell') fail('RETAINED_RECEIPT_FORMAT', key);
    if (receipt.generation !== 'live-2026-09-03-85b50522b420') fail('RETAINED_RECEIPT_GENERATION', key);
    if (receipt.candidate_head !== LIVE_EXECUTION_HEAD) fail('RETAINED_RECEIPT_HEAD', key);
    if (!isRfc3339(receipt.recorded_at)) fail('RETAINED_RECEIPT_TIME', key);
    if (receipt.payload?.product_key !== key || receipt.payload?.field !== 'publisher_access') fail('RETAINED_RECEIPT_PRODUCT', key);
    if (receipt.payload?.live_http !== true) fail('RETAINED_LIVE_MUST_STAY_TRUE', key);
    if (receipt.payload?.authorization?.id !== 'AUTH-PAYLOAD-PILOT') fail('RETAINED_RECEIPT_AUTH', key);
    if (receipt.payload?.execution?.kind !== 'bounded_http_sample') fail('RETAINED_LIVE_EXECUTION_KIND', key);
    if (!isRfc3339(receipt.payload?.execution?.started_at) || !isRfc3339(receipt.payload?.execution?.ended_at)) {
      fail('RETAINED_LIVE_EXECUTION_TIMESTAMPS', key);
    }
  }
  if (hcrisReceipt.payload?.supported !== false || hcrisReceipt.payload?.bounded_sample !== false) {
    fail('RETAINED_HCRIS_FAILURE_MUST_STAY_FAILED');
  }
  if (hcrisReceipt.payload?.status !== 'live_payload_identity_mismatch') fail('RETAINED_HCRIS_STATUS');
  if (placesReceipt.payload?.supported !== true || placesReceipt.payload?.bounded_sample !== true) fail('RETAINED_PLACES_SAMPLE');
  if (hcrisReceipt.payload?.record_id !== hcrisFrozen.anchor?.representative?.record_id) fail('RETAINED_HCRIS_RECORD_ID');
  if (hcrisReceipt.payload?.native_product_id !== hcrisFrozen.anchor?.representative?.native_id) fail('RETAINED_HCRIS_NATIVE_ID');
  if (placesReceipt.payload?.record_id !== placesFrozen.anchor?.representative?.record_id) fail('RETAINED_PLACES_RECORD_ID');
  if (placesReceipt.payload?.native_product_id !== placesFrozen.anchor?.representative?.native_id) fail('RETAINED_PLACES_NATIVE_ID');
  for (const receipt of [hcrisReceipt, placesReceipt]) {
    const req = receipt.payload?.product_key === HCRIS_PRODUCT ? hcrisReq : placesReq;
    for (const url of [receipt.payload?.execution?.request_url, receipt.payload?.execution?.final_url]) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') fail('RETAINED_URL_NOT_HTTPS', url);
      if (!(req.authorized_hosts ?? []).includes(parsed.host)) fail('RETAINED_URL_HOST', url);
      if (req.authorized_url_contains && !url.includes(req.authorized_url_contains)) fail('RETAINED_URL_SCOPE', url);
    }
  }
  if (String(placesReceipt.payload?.native_product_id).includes('7cmc-7y5g')) fail('VINTAGE_SUBSTITUTION_FORBIDDEN');

  const reanalysisFile = readJson(repoRoot, REANALYSIS_REL);
  const reanalysis = reanalysisFile.receipt ?? reanalysisFile;
  const summary = reanalysisFile.summary ?? {};
  if (reanalysis.candidate_head !== REANALYSIS_CANDIDATE) fail('RETAINED_REANALYSIS_HEAD');
  if (reanalysis.payload?.live_http !== false) fail('RETAINED_REANALYSIS_MUST_NOT_BE_LIVE');
  if (reanalysis.payload?.execution?.kind !== 'bounded_file_sample') fail('RETAINED_REANALYSIS_KIND');
  if (reanalysis.payload?.not_a_new_retrieval !== true) fail('RETAINED_REANALYSIS_NOT_A_RETRIEVAL');
  if (reanalysis.payload?.reanalysis_of !== 'pilot-cms-hcris-hospital-provider-cost-report') fail('RETAINED_REANALYSIS_OF');
  if (reanalysis.evidence_sha256 !== HCRIS_SHA256) fail('RETAINED_REANALYSIS_SHA');
  if (reanalysis.payload?.record_id !== hcrisFrozen.anchor?.representative?.record_id) fail('RETAINED_REANALYSIS_RECORD_ID');
  if (reanalysis.payload?.native_product_id !== hcrisFrozen.anchor?.representative?.native_id) fail('RETAINED_REANALYSIS_NATIVE_ID');
  if (reanalysis.payload?._release_check?.status !== 'unresolved') fail('RETAINED_REANALYSIS_RELEASE');
  if (summary.r04_from_this_receipt_alone !== 0) fail('RETAINED_REANALYSIS_R04_MUST_BE_ZERO');
  if (summary.evidence_sha256 !== HCRIS_SHA256 || summary.rows !== 5) fail('RETAINED_REANALYSIS_SUMMARY');
  const legacyStatusHazard = reanalysis.payload?.status === 'bounded_sample'
    && reanalysis.payload?.bounded_sample === true;

  function captureIntegrity(productKey, expectedSha, expectedRows, expectedBytes) {
    const rel = productKey === HCRIS_PRODUCT
      ? CAPTURE_DIR_REL + '/cms-hcris-hospital-provider-cost-report.json'
      : CAPTURE_DIR_REL + '/cdc-places-local-data-for-better-health.json';
    const abs = path.join(repoRoot, rel);
    const present = existsSync(abs);
    if (!present) {
      return freeze({
        product_key: productKey,
        evidence_reference: rel,
        evidence_sha256_claimed: expectedSha,
        sha256_well_formed: isSha256(expectedSha),
        bytes_present: false,
        sha_verified: false,
        rows_claimed: expectedRows,
        bytes_claimed: expectedBytes,
        rows_reverified: false,
        reproducibility: 'unverified_missing_bytes',
        note: 'Publisher bytes are gitignored and absent in a fresh checkout. SHA binding is claimed by in-tree receipts, not re-verified here. No refetch is performed to fill the gap.',
      });
    }
    const bytes = readFileSync(abs);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== expectedSha) fail('RETAINED_BYTES_SHA_MISMATCH', rel);
    const rows = JSON.parse(bytes.toString('utf8'));
    const list = Array.isArray(rows) ? rows : (rows.data ?? rows.rows ?? rows.results);
    if (!Array.isArray(list) || list.length !== expectedRows) fail('RETAINED_BYTES_ROWS', rel);
    return freeze({
      product_key: productKey,
      evidence_reference: rel,
      evidence_sha256_claimed: expectedSha,
      sha256_well_formed: true,
      bytes_present: true,
      sha_verified: true,
      rows_claimed: expectedRows,
      bytes_claimed: expectedBytes,
      bytes_observed: bytes.length,
      rows_reverified: true,
      reproducibility: bytes.length === expectedBytes ? 'byte_identical' : 'sha_identical_bytes_differ_unexpected',
    });
  }
  const integrity = freeze([
    captureIntegrity(HCRIS_PRODUCT, HCRIS_SHA256, 5, 20751),
    captureIntegrity(PLACES_PRODUCT, PLACES_SHA256, 5, 3194),
  ]);

  const acceptanceReceipts = [hcrisReceipt, placesReceipt, reanalysis];
  const counts = payloadSampleCountsFromReceipts(acceptanceReceipts, cohorts.products ?? []);
  if (counts.public_sample_complete !== 0) fail('RETAINED_COUNTS_MUST_BE_ZERO', String(counts.public_sample_complete));
  if (counts.r04_engineering_target_met !== false) fail('RETAINED_R04_MUST_NOT_BE_MET');
  const r04Checks = freeze(acceptanceReceipts.map((receipt) => freeze({
    receipt_id: receipt.receipt_id,
    product_key: receipt.payload?.product_key,
    live_http: receipt.payload?.live_http,
    bounded_sample: receipt.payload?.bounded_sample,
    status_string: receipt.payload?.status,
    status_strings_ignored: true,
    r04_eligible: isR04EligiblePayload(receipt.payload ?? {}),
  })));
  if (r04Checks.some((row) => row.r04_eligible === true)) fail('RETAINED_NO_RECEIPT_IS_R04_ELIGIBLE');

  // Correction 4 (2026-09-17): compare the retained receipts against the R04
  // acceptance TEXT across four cases instead of against isR04EligiblePayload()
  // alone. Case A uses the live-sample predicate; Cases B/C use the
  // reanalysis/corpus predicates (a fully-evidenced local reanalysis CAN
  // qualify — live_http=false alone never forces a refetch); Case D is the
  // missing-evidence remainder. Present receipts fail on named dimensions.
  const hcrisIntegrity = integrity.find((row) => row.product_key === HCRIS_PRODUCT);
  const caseA = freeze([
    freeze({
      case: 'a_originally_authorized_live_capture',
      receipt_id: hcrisReceipt.receipt_id,
      eligible: isR04EligiblePayload(hcrisReceipt.payload ?? {}),
      disqualifying_dimensions: freeze(['identity: failed under then-required PROVNUM; not a derived sample']),
    }),
    freeze({
      case: 'a_originally_authorized_live_capture',
      receipt_id: placesReceipt.receipt_id,
      eligible: isR04EligiblePayload(placesReceipt.payload ?? {}),
      disqualifying_dimensions: freeze(['release: year is unresolved as 2025 county-table proof']),
    }),
  ]);
  const caseB = assessReanalysisEligibility(
    { ...(reanalysis.payload ?? {}), evidence_sha256: reanalysis.evidence_sha256 },
    {
      expectedSha256: HCRIS_SHA256,
      shaVerified: hcrisIntegrity.sha_verified,
      bytesPresent: hcrisIntegrity.bytes_present,
    },
  );
  const caseC = assessFrozenCorpusEligibility(
    { ...(reanalysis.payload ?? {}), evidence_sha256: reanalysis.evidence_sha256 },
    {
      expectedSha256: HCRIS_SHA256,
      shaVerified: hcrisIntegrity.sha_verified,
      bytesPresent: hcrisIntegrity.bytes_present,
      acquisitionEvidenced: false,
    },
  );
  const caseAnalysis = freeze({
    acceptance_source: R04_ACCEPTANCE_TEXT.source,
    acceptance_status: R04_ACCEPTANCE_TEXT.status,
    circular_contract_rejected: true,
    note: 'isR04EligiblePayload() is the Case-A live-sample predicate, not the acceptance '
      + 'contract. Cases B/C show when a local reanalysis or frozen corpus sample can '
      + 'qualify without a refetch (SHA-bound bytes + intact auth chain + current-identity '
      + 'derivation + verified release + exact recipe). Present samples fail on the named '
      + 'dimensions below, so no refetch is ordered by this rule — the failing dimension '
      + '(not live_http=false) is what must be repaired.',
    case_a_live_captures: caseA,
    case_b_reanalysis_present: freeze({
      receipt_id: reanalysis.receipt_id,
      eligible: caseB.eligible,
      reasons: caseB.reasons,
      can_qualify_without_refetch: true,
      why_not_yet: 'release unresolved (FY_END_DT) and bytes absent off-host; '
        + 'live_http=false is not the disqualifier',
    }),
    case_c_frozen_corpus_present: freeze({
      eligible: caseC.eligible,
      reasons: caseC.reasons,
      suitably_evidenced: false,
    }),
    case_d_missing_evidence: freeze({
      captures_with_missing_dimensions: 3,
      dimensions: freeze([
        'acquisition provenance: PLACES mixed-transport gap; no independent HTTP access log',
        'freshness: 2026-09-15 captures are not recent for future R04',
        'integrity: bytes gitignored and absent off-host; SHA claimed, not re-verified',
        'identity: HCRIS live failed under superseded PROVNUM (preserved)',
        'release: both products unresolved (FY_END_DT; year)',
      ]),
    }),
  });
  if (caseB.eligible !== false) fail('RETAINED_REANALYSIS_MUST_NOT_YET_QUALIFY');
  if (caseC.eligible !== false) fail('RETAINED_CORPUS_MUST_NOT_YET_QUALIFY');

  const ledgerBytesAfter = readFileSync(path.join(repoRoot, LEDGER_REL), 'utf8');
  if (ledgerBytesAfter !== ledgerBytesBefore) fail('RETAINED_LEDGER_MUTATED');
  assertNoFetch(fetchCalls);

  const missingEvidence = freeze([
    'No independent HTTP access log of the CMS/CDC sockets was retained besides captured bytes, SHA-256, and in-tree receipts.',
    'Receipt execution started_at/ended_at on the two pilot receipts are validation-assigned times (2026-09-15T18:40:00Z/20Z and 18:40:30Z/35Z), not measured on-the-wire socket times.',
    'PLACES leg was a manually assembled one-off fetch continuation after the HCRIS collector abort, not a second full collector --execute; run.json is mixed-transport history, not collector-path proof for both legs.',
    'Publisher bytes under ' + CAPTURE_DIR_REL + '/ are gitignored and absent in a fresh checkout; SHA binding cannot be re-verified without the original host disk.',
    'Prepared packet still names HCRIS PROVNUM; amendment HCRIS-IDENTITY-PROVIDER-CCN-20260915 supersedes it with Provider CCN. Packet must not be executed as-is.',
    'No first-party CMS statement proves Fiscal Year End Date identifies catalog distribution CostReport_2023_Final; no first-party PLACES dictionary proves year identifies the 2025 county-table release.',
  ]);

  return freeze({
    format: RETAINED_PAYLOAD_RULE_VERSION,
    generated_at: new Date().toISOString(),
    live_execution_head: LIVE_EXECUTION_HEAD,
    reanalysis_candidate: REANALYSIS_CANDIDATE,
    frozen_cohorts_sha256: FROZEN_COHORTS_SHA256,
    frozen_cohorts_unmodified: true,
    fetch_calls: fetchCalls,
    no_refetch_performed: true,
    acquisition: freeze({
      transport: 'historical: HCRIS via run-payload-retrieval-pilot.mjs --execute on 2efafed; PLACES via manual one-off continuation fetch; this rule issues zero requests',
      live_requests_used: 2,
      live_requests_remaining: 2,
      ledger_spend_unchanged: true,
      mixed_transport_disclosed: true,
      credentials: 'none',
    }),
    authorization: freeze({
      live_auth_id: 'AUTH-PAYLOAD-PILOT',
      live_auth_bound_head: LIVE_EXECUTION_HEAD,
      auth_04_does_not_cover_payload_retrieval: true,
      reanalysis_not_a_new_retrieval: true,
      reanalysis_does_not_spend_budget: true,
    }),
    time_freshness: freeze({
      live_recorded_hcris: hcrisReceipt.recorded_at,
      live_recorded_places: placesReceipt.recorded_at,
      reanalysis_recorded_at: reanalysis.recorded_at,
      execution_times_are_validation_assigned: true,
      freshness_for_R04: false,
      note: 'Retained captures from 2026-09-15 are not recent live samples for future R04; any future R04 sample needs a new authorized live retrieval.',
    }),
    product_identity: freeze({
      hcris_required_field: 'Provider CCN',
      hcris_superseded_field: 'PROVNUM',
      hcris_live_outcome_under_then_required_provnum: 'identity_failed_preserved',
      hcris_file_reanalysis_identity_derived: true,
      places_required_field: 'stateabbr',
      places_live_identity: 'passed',
      places_forbidden_vintage_absent: true,
      packet_stale_pre_amendment_noted: packetStaleNoted,
    }),
    release_identity: freeze({
      hcris_claimed_release: 'CostReport_2023_Final',
      hcris_release_check: freeze({ status: 'unresolved', field: 'FY_END_DT' }),
      places_claimed_release: 'PLACES_2025_county_table',
      places_release_check: freeze({ status: 'unresolved', field: 'year' }),
      verified_releases: 0,
    }),
    integrity_reproducibility: integrity,
    live_vs_reanalysis: freeze({
      live: freeze(['pilot-cms-hcris-hospital-provider-cost-report', 'pilot-cdc-places-local-data-for-better-health']),
      live_http_true_bounded_http_sample: 2,
      reanalysis: freeze(['reanalysis-hcris-provider-ccn-20260915']),
      reanalysis_live_http_false_bounded_file_sample: 1,
      original_hcris_failure_preserved: true,
      reanalysis_does_not_overwrite_live: true,
      legacy_status_hazard_noted: legacyStatusHazard,
      future_receipts_should_prefer_file_sample_derived: true,
    }),
    acceptance_grounding: freeze({
      acceptance_text: R04_ACCEPTANCE_TEXT,
      circular_contract_rejected:
        'The contract is the quoted R04 text above, not isR04EligiblePayload(). '
        + 'That predicate is the Case-A live-sample check inside the comparison below.',
      case_analysis: caseAnalysis,
    }),
    acceptance_comparison: freeze({
      contract: 'Case-A live-sample engineering predicate '
        + '(scripts/research-program/qualify-core.mjs isR04EligiblePayload: live_http + '
        + 'frozen-derivation + verified-release); receipt status strings never count. '
        + 'Cases B/C are assessed in acceptance_grounding, not here.',
      r04_target: 80,
      r04_eligible_retained_samples: 0,
      public_sample_complete: counts.public_sample_complete,
      r04_engineering_target_met: false,
      r04_accepted: false,
      per_receipt: r04Checks,
    }),
    counts: freeze({
      live_captures: 2,
      live_identity_failed: 1,
      live_identity_passed_release_unresolved: 1,
      reanalysis_file_samples: 1,
      qualified_r04_samples: 0,
      live_requests_used: 2,
      live_requests_remaining: 2,
    }),
    missing_evidence: missingEvidence,
    retained_eligible_for: freeze(['file-sample-identity-analysis-only']),
    r04_eligible: false,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(qualifyRetainedPayload(), null, 2) + '\n');
}
