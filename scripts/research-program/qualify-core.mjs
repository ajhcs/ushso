import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAST_GOOD_GENERATION } from '../../packages/coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';
import { evaluateCoreReadiness, loadCohort, PRODUCT_DENOMINATOR, PUBLIC_SAMPLE_TARGET } from '../../packages/coverage/research-program/v1.0.0/src/core-readiness.mjs';
import { refuseSelfApproval } from './qualify-mrf.mjs';
import { ingestEvidence } from './ingest-evidence.mjs';

export const QUALIFY_CORE_FORMAT = 'ushso.core-scientific-completeness.v1';
export const HUMAN_RESEARCH_REVIEWER = 'named-human-research-reviewer';
export { LAST_GOOD_GENERATION, PRODUCT_DENOMINATOR, PUBLIC_SAMPLE_TARGET };

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function defaultCohortPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../evaluation/research-program/cohorts.json');
}

export function refuseUnknownCellAsSupported(cell) {
  if ((cell?.status === 'unknown' || cell?.supported == null) && cell?.supported === true) {
    fail('UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED');
  }
  if (cell?.unknown === true && cell?.supported === true) fail('UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED');
  return freeze({ supported: false, unknown: cell?.unknown === true || cell?.status === 'unknown' });
}

export function essentialOutcomes(product, { cellEvidence = {} } = {}) {
  const anchor = product.anchor ?? {};
  const catalog = anchor.status === 'resolved_catalog_record';
  const intake = anchor.status === 'named_intake';
  const restricted = ['restricted_or_manual_route', 'pending_source_intake', 'mixed_public_and_restricted'].includes(product.access_expectation);
  const cells = freeze({
    catalog_record: freeze({
      status: catalog ? 'resolved' : (intake ? 'named_intake' : 'unknown'),
      supported: catalog,
      unknown: !catalog && !intake,
    }),
    release_distinction: freeze({ status: product.product_release_distinction ? 'documented' : 'unknown', supported: Boolean(product.product_release_distinction), unknown: !product.product_release_distinction }),
    access_expectation: freeze({ status: product.access_expectation ?? 'unknown', supported: false, unknown: product.access_expectation == null, note: 'access_expectation_is_not_proof' }),
    publisher_access: evidenceCell(cellEvidence.publisher_access, 'unknown'),
    schema_qualification: evidenceCell(cellEvidence.schema_qualification, 'unknown'),
    join_route: evidenceCell(cellEvidence.join_route, 'unknown'),
    unit_grain_date_denominator: evidenceCell(cellEvidence.unit_grain_date_denominator, 'unknown'),
  });
  for (const cell of Object.values(cells)) {
    if (cell.unknown && cell.supported) fail('UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED');
  }
  const unsupported = Object.entries(cells).filter(([, cell]) => cell.supported !== true).map(([field, cell]) => freeze({ field, ...cell }));
  return freeze({
    product_key: product.product_key,
    title: product.title,
    domain: product.domain,
    publisher: product.publisher ?? null,
    access_expectation: product.access_expectation,
    restricted_or_manual: restricted,
    source_context: freeze({
      anchor_status: anchor.status ?? 'unknown',
      record_id: anchor.representative?.record_id ?? null,
      authoritative_url: anchor.representative?.authoritative_url ?? anchor.intake?.official_discovery_url ?? null,
      access_expectation_is_not_proof: anchor.access_expectation_is_not_proof !== false,
    }),
    cells,
    unsupported_claims: freeze(unsupported),
    conflicts: freeze([...(product.conflicts ?? [])]),
    example_ids: freeze([]),
    citations: freeze([anchor.representative?.authoritative_url ?? anchor.intake?.official_discovery_url].filter(Boolean)),
    follow_up: unsupported.length
      ? freeze({ id: `follow-up:${product.product_key}`, kind: 'bounded_core_remediation', replacement_allowed: false })
      : null,
  });
}

function evidenceCell(evidence, fallbackStatus) {
  if (!evidence) return freeze({ status: fallbackStatus, supported: false, unknown: true });
  if (evidence.unknown === true && evidence.supported === true) fail('UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED');
  return freeze({
    status: evidence.status ?? (evidence.supported ? 'evidenced' : fallbackStatus),
    supported: evidence.supported === true,
    unknown: evidence.unknown === true,
    receipt_id: evidence.receipt_id ?? null,
    recipe: evidence.recipe ?? null,
    limitation: evidence.limitation ?? null,
  });
}

// Track 3 retained-payload repair: single source of truth for the R04 LIVE-sample
// engineering predicate. Receipt status strings never count; only this
// live_http + frozen-derivation + verified-release predicate counts for Case A
// (originally authorized live capture). This predicate is NOT the whole R04
// acceptance contract: docs/research-program/acceptance.md R04 requires
// "recent successful bounded sample[s] plus exact recipes" over the frozen
// 100-product cohort, and Correction 4 (2026-09-17) defines when a later local
// reanalysis (Case B, assessReanalysisEligibility) or a suitably evidenced
// frozen corpus sample (Case C, assessFrozenCorpusEligibility) can satisfy that
// text without a refetch. live_http=false alone never forces a refetch; a
// missing dimension (unbound SHA, broken auth chain, failed identity,
// unverified release, missing recipe) is what disqualifies.
export function isR04EligiblePayload(payload = {}) {
  return payload._derived_payload_sample === true
    && payload._derived_from_frozen_requirements === true
    && payload.live_http === true
    && payload.supported === true
    && payload.bounded_sample === true
    && payload.payload_success === true
    && payload.fictional !== true
    && payload.synthetic !== true
    && payload.catalog_membership_as_sample !== true
    && payload.vintage_substitution !== true
    && payload._release_check?.status === 'verified'
    && Number.isSafeInteger(payload._derived_row_count)
    && payload._derived_row_count > 0;
}

export const REANALYSIS_QUALIFICATION_VERSION = 'ushso.reanalysis-qualification.v1';

function hasRecipe(payload) {
  return typeof payload.recipe === 'string' && payload.recipe.trim().length > 0;
}

function hasDerivedIdentity(payload) {
  return payload._derived_payload_sample === true
    && payload._derived_from_frozen_requirements === true
    && Number.isSafeInteger(payload._derived_row_count)
    && payload._derived_row_count > 0;
}

function releaseStatusOf(payload) {
  return payload._release_check?.status ?? 'missing';
}

// Correction 4 (2026-09-17) Case B: later local reanalysis of the SAME bytes
// captured by an originally authorized live retrieval. A reanalysis CAN satisfy
// the R04 acceptance text ("recent successful bounded sample plus exact
// recipe") without a refetch when all five dimensions hold: (1) integrity —
// bytes are SHA-bound to the original capture (digest equality, not a claimed
// string); (2) acquisition provenance — the auth chain is intact
// (reanalysis_of links the original receipt, not_a_new_retrieval is true, no
// budget is spent); (3) identity — re-derived under CURRENT frozen
// requirements (not a superseded field); (4) release — verified (a reporting
// attribute such as FY_END_DT or year is not release proof); (5)
// reproducibility — an exact recipe is recorded. live_http=false alone never
// forces a refetch; a failed dimension does. Pure predicate: no I/O, no fetch.
export function assessReanalysisEligibility(payload = {}, {
  expectedSha256 = null,
  shaVerified = null,
  bytesPresent = null,
} = {}) {
  const reasons = [];
  if (payload.live_http !== false) reasons.push('not_a_reanalysis_use_live_path');
  if (payload.not_a_new_retrieval !== true) reasons.push('auth_chain_new_retrieval_claim');
  if (typeof payload.reanalysis_of !== 'string' || payload.reanalysis_of.trim() === '') {
    reasons.push('auth_chain_no_reanalysis_link');
  }
  if (expectedSha256 != null
    && typeof payload.evidence_sha256 === 'string'
    && payload.evidence_sha256 !== expectedSha256) {
    reasons.push('integrity_sha_mismatch');
  }
  if (shaVerified === false) reasons.push('integrity_sha_unverified');
  if (bytesPresent === false) reasons.push('integrity_bytes_absent');
  if (expectedSha256 == null && shaVerified !== true) reasons.push('integrity_sha_unbound');
  if (!hasDerivedIdentity(payload)) reasons.push('identity_not_derived');
  const release = releaseStatusOf(payload);
  if (release !== 'verified') reasons.push('release_unverified:' + release);
  if (!hasRecipe(payload)) reasons.push('recipe_missing');
  if (payload.fictional === true || payload.synthetic === true) reasons.push('fictional_or_synthetic');
  if (payload.vintage_substitution === true) reasons.push('vintage_substitution');
  if (payload.catalog_membership_as_sample === true) reasons.push('catalog_membership_is_not_sample');
  return freeze({
    format: REANALYSIS_QUALIFICATION_VERSION,
    case: 'reanalysis_of_retained_bytes',
    eligible: reasons.length === 0,
    reasons: freeze(reasons),
    release_status: release,
  });
}

// Correction 4 (2026-09-17) Case C: suitably evidenced frozen local payload
// corpus. Same five dimensions as Case B, minus the reanalysis_of link (a
// corpus sample stands on its own evidence_reference + digest); acquisition
// provenance must instead be evidenced by the corpus manifest (caller passes
// acquisitionEvidenced=true only when that manifest binds the bytes to an
// authorized capture). "Suitably evidenced" means every dimension below
// holds; gitignored-and-absent bytes, an unresolved release, or a missing
// recipe each disqualify on their own. Pure predicate: no I/O, no fetch.
export function assessFrozenCorpusEligibility(payload = {}, {
  expectedSha256 = null,
  shaVerified = false,
  bytesPresent = false,
  acquisitionEvidenced = false,
} = {}) {
  const reasons = [];
  if (acquisitionEvidenced !== true) reasons.push('acquisition_provenance_unevidenced');
  if (bytesPresent !== true) reasons.push('integrity_bytes_absent');
  if (shaVerified !== true) reasons.push('integrity_sha_unverified');
  if (expectedSha256 != null
    && typeof payload.evidence_sha256 === 'string'
    && payload.evidence_sha256 !== expectedSha256) {
    reasons.push('integrity_sha_mismatch');
  }
  if (!hasDerivedIdentity(payload)) reasons.push('identity_not_derived');
  const release = releaseStatusOf(payload);
  if (release !== 'verified') reasons.push('release_unverified:' + release);
  if (!hasRecipe(payload)) reasons.push('recipe_missing');
  if (payload.fictional === true || payload.synthetic === true) reasons.push('fictional_or_synthetic');
  if (payload.vintage_substitution === true) reasons.push('vintage_substitution');
  if (payload.catalog_membership_as_sample === true) reasons.push('catalog_membership_is_not_sample');
  return freeze({
    format: REANALYSIS_QUALIFICATION_VERSION,
    case: 'frozen_local_payload_corpus',
    eligible: reasons.length === 0,
    reasons: freeze(reasons),
    release_status: release,
  });
}

// INT2-retained (2026-09-17): ONE validated retained-sample pathway for the
// authoritative R04 count. payloadSampleCountsFromReceipts() previously called
// only isR04EligiblePayload() (the Case-A live-sample predicate), so validated
// reanalysis/corpus assessments never fed the count. This pathway supports all
// four cases — live capture, local reanalysis of that capture, evidenced
// frozen payload corpus, and insufficient-evidence — across six dimensions:
// acquisition provenance+authorization, acquisition time/freshness,
// retained-bytes integrity (SHA), frozen product identity, release identity,
// and exact reproducible recipe.
//
// Eligibility is recomputed from receipt fields inside the counts function.
// Caller-supplied eligibility flags and every underscore-prefixed
// validator-derived field (all derived flags, release checks, file-sample
// markers, reanalysis link flags, evidence-kind markers, product requirement
// snapshots, scheduler markers, ...) are stripped before evaluation, as are
// bare eligibility flags (eligible, r04_eligible, qualified, accepted, ...).
// A forged-flag receipt therefore counts zero: only underlying receipt fields
// plus explicit context evidence (integrity maps, frozen release verification,
// corpus-manifest binding) can qualify.
//
// Reference resolution: live_http=false on a reanalysis never implies the
// original capture was offline — the referenced original receipt is looked up
// by receipt_id and its own live_http===true is required. A nonempty
// reanalysis_of string alone never implies provenance — an unresolvable
// reference fails as auth_chain_unresolved_reference.
//
// Counting: distinct frozen products, not receipts/releases/passes/requests.
// A fully-evidenced retained sample counts once without refetch; a live
// capture plus its eligible reanalysis of the same product counts once; two
// eligible receipts with different release_id values for one product count
// once (annual releases are not products).
export const RETAINED_SAMPLE_QUALIFICATION_VERSION = 'ushso.retained-sample-qualification.v1';
export const RETAINED_FRESHNESS_MAX_AGE_DAYS = 90;

// Documented freshness rule (narrow reading of R04 recent).
// AMBIGUITY A1 (kept excluded when unmet): the acceptance text says recent
// successful bounded sample without a numeric threshold. Working rule: the
// acquisition execution.ended_at must be within RETAINED_FRESHNESS_MAX_AGE_DAYS
// before evaluation time now. Freshness follows the ORIGINAL capture for
// reanalyses, never the later reanalysis timestamp. Missing, unparseable,
// future-dated, or older-than-threshold acquisition time counts as stale and
// the sample is excluded. This threshold is a documented interpretation, not
// acceptance text; samples needing a looser reading stay excluded.
export const RETAINED_FRESHNESS_RULE = freeze({
  version: RETAINED_SAMPLE_QUALIFICATION_VERSION,
  ambiguity: 'R04 says recent without a numeric threshold; any sample that needs a looser reading stays excluded.',
  max_age_days: RETAINED_FRESHNESS_MAX_AGE_DAYS,
  follows: 'original capture execution.ended_at for reanalyses, own execution.ended_at otherwise',
  stale_when: 'missing/unparseable/future acquisition time, or age over max_age_days',
});

// Documented recipe rule (narrow reading of R04 exact technical recipe).
// AMBIGUITY A2 (kept excluded when unmet): a non-empty recipe string is
// necessary but its semantic re-executability (no tacit manual steps) cannot
// be verified from string presence alone. Working rule: the receipt must carry
// a non-empty recipe string; recipes referencing unrecorded manual work remain
// excluded until a re-execution demonstration exists.
export const RETAINED_RECIPE_RULE = freeze({
  version: RETAINED_SAMPLE_QUALIFICATION_VERSION,
  ambiguity: 'String presence does not prove re-executability; tacit-knowledge recipes stay excluded.',
  requires: 'non-empty payload.recipe string naming the bounded operation',
});

const FORGED_ELIGIBILITY_KEYS = freeze([
  'eligible', 'r04_eligible', 'qualified', 'accepted', 'approved', 'verified', 'passed',
  'r04_accepted', 'scientific_approval', 'payload_eligible', 'sample_eligible',
]);

function stripDerivedAndForgedFlags(payload = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.startsWith('_')) continue;
    if (FORGED_ELIGIBILITY_KEYS.includes(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function isRfc3339Loose(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isSha256Loose(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function nowMsOf(now) {
  if (now == null) return Date.now();
  const ms = typeof now === 'number' ? now : Date.parse(now);
  return Number.isFinite(ms) ? ms : NaN;
}

function acquisitionEndedAtOf(cleanPayload, receipt, receiptsById) {
  const reanalysisOf = typeof cleanPayload.reanalysis_of === 'string' ? cleanPayload.reanalysis_of.trim() : '';
  const isReanalysisCandidate = cleanPayload.live_http === false
    && cleanPayload.execution?.kind === 'bounded_file_sample'
    && reanalysisOf !== '';
  if (isReanalysisCandidate) {
    const original = receiptsById.get(reanalysisOf) ?? null;
    const originalPayload = original?.payload ?? {};
    const endedAt = originalPayload.execution?.ended_at ?? null;
    return { endedAt, original, followsCapture: true };
  }
  return { endedAt: cleanPayload.execution?.ended_at ?? null, original: null, followsCapture: false };
}

// Single validated assessment for one receipt. Pure: no I/O, no fetch.
// Context (all optional; missing evidence fails closed):
//   productsByKey, receiptsById,
//   integrityByReceiptId {bytesPresent, shaVerified, expectedSha256},
//   releaseVerificationByProduct {status, field, reason},
//   requirementsByProduct {required_record_id, required_native_id, row_fields, authorized_hosts, authorized_url_contains},
//   acquisitionEvidenceByReceiptId {true when a corpus manifest binds bytes to an authorized capture},
//   now, maxAgeDays.
export function assessUnifiedRetainedSample(receipt = {}, context = {}) {
  const reasons = [];
  const receiptId = receipt.receipt_id ?? null;
  const rawPayload = receipt.payload ?? {};
  const payload = stripDerivedAndForgedFlags(rawPayload);
  const productKey = typeof payload.product_key === 'string' ? payload.product_key : null;
  const productsByKey = context.productsByKey ?? new Map();
  const receiptsById = context.receiptsById ?? new Map();
  const integrityByReceiptId = context.integrityByReceiptId ?? {};
  const releaseVerificationByProduct = context.releaseVerificationByProduct ?? {};
  const requirementsByProduct = context.requirementsByProduct ?? {};
  const acquisitionEvidenceByReceiptId = context.acquisitionEvidenceByReceiptId ?? {};
  const maxAgeDays = Number.isFinite(context.maxAgeDays) ? context.maxAgeDays : RETAINED_FRESHNESS_MAX_AGE_DAYS;
  const nowMs = nowMsOf(context.now);

  if (receipt.kind !== 'core_cell') {
    return freeze({ version: RETAINED_SAMPLE_QUALIFICATION_VERSION, case: 'insufficient_evidence', eligible: false, reasons: freeze(['not_a_core_cell_receipt']), receipt_id: receiptId, product_key: productKey });
  }
  if (payload.field !== 'publisher_access') {
    return freeze({ version: RETAINED_SAMPLE_QUALIFICATION_VERSION, case: 'insufficient_evidence', eligible: false, reasons: freeze(['not_a_publisher_access_cell']), receipt_id: receiptId, product_key: productKey });
  }

  // Shared structural gates recomputed from receipt fields (never flags).
  if (payload.supported !== true) reasons.push('sample_not_supported');
  if (payload.bounded_sample !== true) reasons.push('not_a_bounded_sample');
  if (payload.payload_success !== true) reasons.push('payload_not_successful');
  if (payload.fictional === true || payload.synthetic === true) reasons.push('fictional_or_synthetic');
  if (payload.catalog_membership_as_sample === true) reasons.push('catalog_membership_is_not_sample');
  if (payload.vintage_substitution === true) reasons.push('vintage_substitution');
  if (typeof payload.recipe !== 'string' || payload.recipe.trim() === '') reasons.push('recipe_missing');
  if (!Number.isSafeInteger(payload.row_count) || payload.row_count <= 0) reasons.push('row_count_not_positive');
  if (payload.result_format !== 'json_array' && payload.result_format !== 'json_object') reasons.push('result_format_not_bounded_rows');
  if (typeof payload.release_id !== 'string' || payload.release_id.trim() === '') reasons.push('release_claim_missing');
  if (productKey == null || productKey === '') reasons.push('product_key_missing');
  const frozenProduct = productKey != null ? productsByKey.get(productKey) : null;
  if (productKey != null && productKey !== '' && !frozenProduct) reasons.push('product_not_in_frozen_cohort');
  if (frozenProduct && frozenProduct.access_expectation !== 'public_sample_eligible') reasons.push('not_public_sample_eligible');

  // Frozen product identity from receipt fields vs frozen cohort (+ frozen
  // requirements when supplied).
  const requirement = productKey != null ? requirementsByProduct[productKey] ?? null : null;
  const frozenRecordId = frozenProduct?.anchor?.representative?.record_id ?? requirement?.required_record_id ?? null;
  const frozenNativeId = frozenProduct?.anchor?.representative?.native_id ?? requirement?.required_native_id ?? null;
  if (frozenProduct) {
    if (typeof payload.record_id !== 'string' || payload.record_id === '' || (frozenRecordId != null && payload.record_id !== frozenRecordId)) reasons.push('identity_record_mismatch');
    if (typeof payload.native_product_id !== 'string' || payload.native_product_id === '' || (frozenNativeId != null && payload.native_product_id !== frozenNativeId)) reasons.push('identity_native_mismatch');
  }
  if (requirement) {
    if (payload.record_id !== requirement.required_record_id) reasons.push('identity_record_mismatch');
    if (payload.native_product_id !== requirement.required_native_id) reasons.push('identity_native_mismatch');
    const rowFields = Object.keys(requirement.row_fields ?? {});
    if (rowFields.length === 0) reasons.push('identity_requirement_empty');
  }

  // Route the four cases from execution truth, not from flags.
  const reanalysisOf = typeof payload.reanalysis_of === 'string' ? payload.reanalysis_of.trim() : '';
  const executionKind = payload.execution?.kind ?? null;
  let sampleCase = 'insufficient_evidence';
  if (payload.live_http === true && executionKind === 'bounded_http_sample' && reanalysisOf === '') {
    sampleCase = 'live_capture';
  } else if (payload.live_http === false && executionKind === 'bounded_file_sample' && reanalysisOf !== '') {
    sampleCase = 'reanalysis_of_retained_bytes';
  } else if (payload.live_http === false && executionKind === 'bounded_file_sample' && reanalysisOf === '') {
    sampleCase = 'frozen_local_payload_corpus';
  } else {
    reasons.push('execution_not_a_qualifying_sample_path');
  }

  // Acquisition provenance + authorization.
  if (sampleCase === 'live_capture') {
    const auth = payload.authorization ?? null;
    if (!auth || typeof auth.id !== 'string' || auth.id === '' || auth.authorized !== true) reasons.push('authorization_missing_or_denied');
    const execution = payload.execution ?? {};
    if (!isRfc3339Loose(execution.started_at) || !isRfc3339Loose(execution.ended_at)) reasons.push('acquisition_time_unparseable');
    else if (Date.parse(execution.ended_at) < Date.parse(execution.started_at)) reasons.push('acquisition_time_inverted');
    if (typeof execution.request_url !== 'string' || !isHttpsUrl(execution.request_url)) reasons.push('acquisition_request_url_not_https');
    if (typeof execution.final_url !== 'string' || !isHttpsUrl(execution.final_url)) reasons.push('acquisition_final_url_not_https');
    if (!Number.isSafeInteger(execution.http_status) || execution.http_status < 200 || execution.http_status > 299) reasons.push('acquisition_http_status_not_success');
    if (requirement) {
      for (const url of [execution.request_url, execution.final_url]) {
        if (typeof url !== 'string') continue;
        let host = null;
        try { host = new URL(url).host; } catch { host = null; }
        if (host == null || !(requirement.authorized_hosts ?? []).includes(host)) reasons.push('acquisition_url_host_unauthorized');
        if (requirement.authorized_url_contains && !url.includes(requirement.authorized_url_contains)) reasons.push('acquisition_url_scope_mismatch');
      }
    }
  } else if (sampleCase === 'reanalysis_of_retained_bytes') {
    if (payload.not_a_new_retrieval !== true) reasons.push('auth_chain_new_retrieval_claim');
    const original = receiptsById.get(reanalysisOf) ?? null;
    if (!original) {
      reasons.push('auth_chain_unresolved_reference');
    } else {
      const originalPayload = original.payload ?? {};
      if (originalPayload.live_http !== true) reasons.push('auth_chain_original_not_live');
      const originalSha = original.evidence_sha256 ?? null;
      const thisSha = receipt.evidence_sha256 ?? null;
      if (isSha256Loose(originalSha) && isSha256Loose(thisSha) && thisSha !== originalSha) reasons.push('integrity_sha_mismatch');
    }
    if (!isRfc3339Loose(payload.execution?.started_at) || !isRfc3339Loose(payload.execution?.ended_at)) reasons.push('acquisition_time_unparseable');
  } else if (sampleCase === 'frozen_local_payload_corpus') {
    if (acquisitionEvidenceByReceiptId[receiptId] !== true) reasons.push('acquisition_provenance_unevidenced');
    if (!isRfc3339Loose(payload.execution?.started_at) || !isRfc3339Loose(payload.execution?.ended_at)) reasons.push('acquisition_time_unparseable');
  }

  // Acquisition time / freshness (documented rule; follows original capture).
  const endedInfo = acquisitionEndedAtOf(payload, receipt, receiptsById);
  const endedAt = endedInfo.endedAt;
  if (!isRfc3339Loose(endedAt)) {
    if (!reasons.includes('acquisition_time_unparseable')) reasons.push('acquisition_time_unparseable');
  } else if (!Number.isFinite(nowMs)) {
    reasons.push('freshness_evaluation_time_unparseable');
  } else {
    const endedMs = Date.parse(endedAt);
    if (endedMs > nowMs) reasons.push('acquisition_time_in_future');
    else if ((nowMs - endedMs) > maxAgeDays * 86400000) reasons.push('freshness_stale');
  }
  if (!isRfc3339Loose(receipt.recorded_at)) reasons.push('recorded_at_unparseable');

  // Retained-bytes integrity (SHA).
  const receiptSha = receipt.evidence_sha256 ?? null;
  if (!isSha256Loose(receiptSha)) reasons.push('integrity_sha_unbound');
  if (typeof receipt.evidence_reference !== 'string' || receipt.evidence_reference.trim() === '') reasons.push('integrity_reference_missing');
  const claimedSha = rawPayload.evidence_sha256 ?? payload.evidence_sha256 ?? null;
  if (claimedSha != null && isSha256Loose(receiptSha) && isSha256Loose(claimedSha) && claimedSha !== receiptSha) reasons.push('integrity_sha_mismatch');
  const integrity = integrityByReceiptId[receiptId] ?? null;
  if (sampleCase === 'reanalysis_of_retained_bytes' || sampleCase === 'frozen_local_payload_corpus') {
    if (integrity == null || integrity.bytesPresent !== true) reasons.push('integrity_bytes_absent');
    if (integrity == null || integrity.shaVerified !== true) reasons.push('integrity_sha_unverified');
    if (integrity?.expectedSha256 != null && isSha256Loose(receiptSha) && integrity.expectedSha256 !== receiptSha) reasons.push('integrity_sha_mismatch');
    if (claimedSha != null && integrity?.expectedSha256 != null && isSha256Loose(claimedSha) && claimedSha !== integrity.expectedSha256) reasons.push('integrity_sha_mismatch');
  } else if (sampleCase === 'live_capture' && integrity != null) {
    if (integrity.bytesPresent === false) reasons.push('integrity_bytes_absent');
    if (integrity.shaVerified === false) reasons.push('integrity_sha_unverified');
    if (integrity.expectedSha256 != null && isSha256Loose(receiptSha) && integrity.expectedSha256 !== receiptSha) reasons.push('integrity_sha_mismatch');
  }

  // Release identity from explicit frozen verification (never release-check flags).
  const releaseVerification = productKey != null ? releaseVerificationByProduct[productKey] ?? null : null;
  const releaseStatus = releaseVerification?.status ?? 'missing';
  if (releaseStatus !== 'verified') reasons.push('release_unverified:' + releaseStatus);

  const eligible = reasons.length === 0;
  return freeze({
    version: RETAINED_SAMPLE_QUALIFICATION_VERSION,
    case: eligible ? sampleCase : (sampleCase === 'insufficient_evidence' ? 'insufficient_evidence' : sampleCase),
    eligible,
    reasons: freeze([...new Set(reasons)]),
    receipt_id: receiptId,
    product_key: productKey,
    release_status: releaseStatus,
  });
}

export function payloadSampleCountsFromReceipts(receipts = [], products = [], options = {}) {
  const samples = new Set();
  const verifiedRoutes = new Set();
  const productsByKey = new Map((products ?? []).map((product) => [product.product_key, product]));
  const coreReceipts = (receipts ?? []).filter((row) => row.kind === 'core_cell');
  const receiptsById = new Map(coreReceipts.map((row) => [row.receipt_id, row]));
  const context = {
    productsByKey,
    receiptsById,
    integrityByReceiptId: options.integrityByReceiptId ?? {},
    releaseVerificationByProduct: options.releaseVerificationByProduct ?? {},
    requirementsByProduct: options.requirementsByProduct ?? {},
    acquisitionEvidenceByReceiptId: options.acquisitionEvidenceByReceiptId ?? {},
    now: options.now,
    maxAgeDays: options.maxAgeDays,
  };
  const assessments = [];
  for (const receipt of coreReceipts) {
    const payload = receipt.payload ?? {};
    if (payload.field !== 'publisher_access') continue;
    if (payload.catalog_membership_as_sample === true) fail('CATALOG_MEMBERSHIP_IS_NOT_PAYLOAD_SAMPLE');
    if (payload.vintage_substitution === true) fail('VINTAGE_SUBSTITUTION_FORBIDDEN');
    if ((payload.fictional === true || payload.synthetic === true) && payload.bounded_sample === true) {
      fail('FICTIONAL_WALKTHROUGH_IS_NOT_LIVE_SAMPLE');
    }
    if (payload.family_workflow_as_verified_route === true) fail('FAMILY_WORKFLOW_IS_NOT_VERIFIED_ROUTE');
    const verdict = assessUnifiedRetainedSample(receipt, context);
    assessments.push(verdict);
    if (verdict.eligible && verdict.product_key != null) samples.add(verdict.product_key);
    const realRoute = payload.supported === true
      && payload.verified_route === true
      && typeof payload.route_evidence === 'string'
      && payload.family_workflow_as_verified_route !== true
      && payload.fictional !== true
      && payload._evidence_kind !== 'family_registry';
    if (realRoute && typeof payload.product_key === 'string') verifiedRoutes.add(payload.product_key);
  }
  const publicEligible = products.filter((product) => product.access_expectation === 'public_sample_eligible');
  const publicComplete = publicEligible.filter((product) => samples.has(product.product_key)).length;
  const restricted = products.filter((product) => ['restricted_or_manual_route', 'pending_source_intake', 'mixed_public_and_restricted'].includes(product.access_expectation));
  const restrictedComplete = restricted.filter((product) => verifiedRoutes.has(product.product_key)).length;
  return freeze({
    catalog_membership_is_not_payload_sample: true,
    public_sample_complete: publicComplete,
    public_sample_target: PUBLIC_SAMPLE_TARGET,
    public_sample_eligible: publicEligible.length,
    restricted_route_complete: restrictedComplete,
    r04_engineering_target_met: publicComplete >= PUBLIC_SAMPLE_TARGET,
    r05_restricted_routes_verified: restricted.length > 0 && restrictedComplete === restricted.length,
    unified_pathway: RETAINED_SAMPLE_QUALIFICATION_VERSION,
    samples_are_distinct_frozen_products: true,
    assessments: freeze(assessments),
  });
}

export function coreCellEvidenceFromReceipts(receipts = []) {
  const byProduct = {};
  for (const receipt of receipts.filter((row) => row.kind === 'core_cell')) {
    const productKey = receipt.payload.product_key;
    if (!byProduct[productKey]) byProduct[productKey] = {};
    byProduct[productKey][receipt.payload.field] = freeze({
      supported: receipt.payload.supported === true,
      unknown: receipt.payload.unknown === true,
      status: receipt.payload.status ?? (receipt.payload.supported ? 'evidenced' : 'unknown'),
      receipt_id: receipt.receipt_id,
      recipe: receipt.payload.recipe,
      limitation: receipt.payload.limitation ?? null,
    });
  }
  return freeze(byProduct);
}

export function assembleCoreMatrix(cohorts, { cellEvidenceByProduct = {} } = {}) {
  const products = cohorts?.products ?? [];
  if (products.length !== PRODUCT_DENOMINATOR) fail('PRODUCT_DENOMINATOR_NOT_100', String(products.length));
  const rows = products.map((product) => essentialOutcomes(product, { cellEvidence: cellEvidenceByProduct[product.product_key] ?? {} }));
  const byDomain = {};
  for (const row of rows) {
    const domain = row.domain ?? 'unknown';
    if (!byDomain[domain]) byDomain[domain] = { domain, product_count: 0, unsupported_count: 0, unknown_cells: 0, supported_cells: 0 };
    byDomain[domain].product_count += 1;
    byDomain[domain].unsupported_count += row.unsupported_claims.length;
    for (const cell of Object.values(row.cells)) {
      if (cell.unknown) byDomain[domain].unknown_cells += 1;
      if (cell.supported) byDomain[domain].supported_cells += 1;
    }
  }
  return freeze({
    format: QUALIFY_CORE_FORMAT,
    generation: LAST_GOOD_GENERATION,
    product_count: rows.length,
    rows: freeze(rows),
    domain_totals: freeze(Object.values(byDomain).map((row) => freeze(row))),
    unknown_cells_counted_as_supported: false,
    last_good_generation_changed: false,
  });
}

export function independentSemanticReview(matrix, { actor = 'implementer', role = 'implementer', approved = false, namedHuman = HUMAN_RESEARCH_REVIEWER } = {}) {
  refuseSelfApproval({ actor, role, approved });
  const failed = matrix.rows.filter((row) => row.unsupported_claims.length > 0);
  const unresolvedJudgments = failed.map((row) => freeze({
    product_key: row.product_key,
    domain: row.domain,
    routed_to: namedHuman,
    accepted_values: freeze([]),
    status: 'unresolved_pending_named_human',
    follow_up: row.follow_up,
  }));
  return freeze({
    format: QUALIFY_CORE_FORMAT,
    reviewer: 'Astra/root',
    implementer_self_approved: false,
    scientific_output_approved: false,
    named_human_research_reviewer: namedHuman,
    failed_visible: failed.length,
    unresolved_domain_judgments: freeze(unresolvedJudgments),
    bounded_follow_up_prs: freeze(failed.map((row) => row.follow_up)),
    exact_accepted_values: freeze([]),
  });
}

export function issueCoreQualificationReceipt(cohorts = loadCohort(defaultCohortPath()), options = {}) {
  const sealedReadiness = evaluateCoreReadiness(cohorts, options.readinessExtras ?? {});
  const ingestion = options.ingestion ?? ingestEvidence();
  const receipts = ingestion.receipts ?? [];
  const cellEvidenceByProduct = options.cellEvidenceByProduct ?? coreCellEvidenceFromReceipts(receipts);
  const matrix = assembleCoreMatrix(cohorts, { cellEvidenceByProduct });
  const review = independentSemanticReview(matrix, options);
  const payloadCounts = payloadSampleCountsFromReceipts(receipts, cohorts.products ?? []);
  const r04 = false;
  const r05 = false;
  const r07 = false;
  const r08 = false;
  const passed = r04 && r05 && r07 && r08;
  if (passed !== true && options.forcePass === true) fail('FAILED_MATRIX_CANNOT_BE_FORCED_PASS');
  return freeze({
    format: QUALIFY_CORE_FORMAT,
    generation: LAST_GOOD_GENERATION,
    recorded_at: options.recordedAt ?? new Date().toISOString(),
    reviewer_scope: freeze({
      independent_reviewer: 'Astra/root',
      named_human_research_reviewer: HUMAN_RESEARCH_REVIEWER,
      implementer_cannot_self_approve: true,
    }),
    product_count: matrix.product_count,
    unknown_cells_counted_as_supported: false,
    r04_accepted: r04,
    r05_accepted: r05,
    r07_accepted: r07,
    r08_accepted: r08,
    scientific_completeness_pass: false,
    failed_matrix_retained: true,
    engineering_readiness: freeze({
      r04_engineering_target_met: payloadCounts.r04_engineering_target_met,
      r05_restricted_routes_verified: payloadCounts.r05_restricted_routes_verified,
      public_sample_complete: payloadCounts.public_sample_complete,
      public_sample_target: payloadCounts.public_sample_target,
      catalog_membership_is_not_payload_sample: true,
      sealed_catalog_membership_count: sealedReadiness.public_sample_complete,
      incomplete: sealedReadiness.incomplete,
    }),
    remaining_limits: freeze([
      'Unknown essential fields and unnamed intake records cannot count as supported.',
      'Catalog-metadata receipts are not bounded payload samples. Dataset contents were not executed.',
      'R07 remains incomplete until failing retrieval domains have bounded remediation.',
      'R08 remains incomplete below 15 independently qualified routes.',
      'Restricted/manual products remain incomplete until verified routes exist.',
      'C0091 measured topology remains unresolved.',
    ]),
    matrix,
    review,
    last_good_generation_changed: false,
  });
}

export { refuseSelfApproval, loadCohort, evaluateCoreReadiness };
