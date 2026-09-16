#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKET_REL = 'verification/research-program/evidence/metadata-check-packet.json';
const AUTH_REL = 'verification/research-program/authorization/metadata-authorizations.json';
const COHORTS_REL = 'evaluation/research-program/cohorts.json';
const EXPECTED_COHORTS_SHA256 = '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543';
const METADATA_KEYS = Object.freeze(['cms-hcris-hospital-provider-cost-report', 'cdc-places-local-data-for-better-health']);
const FORBIDDEN_PLACES = '7cmc-7y5g';
const EXPECTED_BRANCH = 'codex/ushso-corr1-metadata-20260917';
// Historical provenance only: the prepared packet was drafted on EXPECTED_BRANCH,
// but offline validation is branch-agnostic and must pass on integration branches,
// detached HEAD, and CI. Do NOT gate offline validation on checkout branch name.
// Execution-time authorization (run-metadata-check.mjs --execute) still enforces
// exact candidate HEAD + AUTH binding + endpoints + frozen SHA + budget before any fetch.
export const METADATA_HISTORICAL_BRANCH = EXPECTED_BRANCH;
// Single coherent corrected operation (packet v2). These literals must agree with
// scripts/research-program/run-metadata-check.mjs resolveMetadataOperation() and
// with the packet operation block, the additive AUTH entry, and the corrected
// ledger. They are repeated here (instead of imported) because the validator must
// stay importable from the runner without creating a module cycle.
const OPERATION_ID = 'OP-METADATA-CHECK-CORRECTED-20260917';
const PACKET_VERSION = 'ushso.metadata-check-packet.v2';
const EXPECTED_AUTH = 'AUTH-METADATA-CHECK-CORRECTED-20260917';
const CORRECTED_LEDGER_REL = 'verification/research-program/evidence/metadata-check-ledger-corrected-20260917.json';
const SPENT_LEDGER_REL = 'verification/research-program/evidence/metadata-check-ledger.json';
const EXPECTED_CAPTURE_DIR = 'verification/research-program/evidence/payloads/metadata-check/corrected-20260917/';
const EXPECTED_RECEIPT_DIR = 'verification/research-program/evidence/metadata-receipts-corrected-20260917/';
const EXPECTED_ATTEMPT_DIR = 'verification/research-program/evidence/metadata-attempts/corrected-20260917/';
const EXPECTED_LOCK_REL = 'verification/research-program/evidence/metadata-attempts/corrected-20260917.lock';
const EXPECTED_RUN_REPORT_REL = 'verification/research-program/evidence/metadata-check-run-corrected-20260917.json';
const EXPECTED_ENDPOINTS = Object.freeze([
  'https://data.cms.gov/data-api/v1/dataset-resources/44060663-47d8-4ced-a115-b53b4c270acb',
  'https://data.cdc.gov/api/views/swc5-untb.json',
]);

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function assertNoRowLimits(value, where) {
  if (value !== null && typeof value === 'object') {
    if ('max_rows' in value || 'max_rows_per_source' in value) fail('METADATA_ROW_LIMIT_FORBIDDEN', where);
  }
}

export function validateMetadataCheck({ repoRoot = ROOT } = {}) {
  const packet = JSON.parse(readFileSync(path.join(repoRoot, PACKET_REL), 'utf8'));
  if (packet.format !== PACKET_VERSION) fail('METADATA_FORMAT', String(packet.format));
  if (packet.status !== 'prepared_not_authorized') fail('METADATA_NOT_PREPARED');
  if (packet.authorization?.requested === true) fail('METADATA_MUST_NOT_REQUEST_AUTH_YET');
  if (packet.authorization?.auth_04_does_not_cover_metadata_check !== true) fail('AUTH04_MUST_NOT_COVER_METADATA');
  if (packet.authorization?.auth_payload_pilot_does_not_cover_metadata_check !== true) fail('PAYLOAD_PILOT_MUST_NOT_COVER_METADATA');
  if (packet.authorization?.required_auth_id_if_later_granted !== EXPECTED_AUTH) fail('METADATA_AUTH_ID');
  if (packet.accepted === true || packet.scientific_approval === true) fail('METADATA_CANNOT_ACCEPT');
  if (packet.live_http === true) fail('METADATA_LIVE_HTTP_FORBIDDEN');
  if (packet.candidate_binding?.must_match_git_head !== true) fail('METADATA_MUST_BIND_GIT_HEAD');
  // Branch provenance (informational, not a gate): record packet-declared branch
  // and checkout branch/HEAD. Offline validation must not fail on branch name.
  // Historical note: the v1 packet named EXPECTED_BRANCH; the v2 operation below
  // names the integration branch carrying this correction. Execution
  // authorization binds exact HEAD, not branch name.
  const packetBranch = packet.candidate_binding?.branch ?? null;
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const currentBranch = git(repoRoot, ['branch', '--show-current']);
  const checkoutBranch = currentBranch || null;
  const checkoutDetached = !currentBranch;
  if (packet.candidate_head && packet.candidate_head !== head) fail('METADATA_CANDIDATE_HEAD_STALE');
  if (packet.candidate_binding?.stale_sha_named_at_first_draft === head) fail('METADATA_STALE_DRAFT_SHA');
  const cohortsBytes = readFileSync(path.join(repoRoot, COHORTS_REL));
  const cohortsSha = createHash('sha256').update(cohortsBytes).digest('hex');
  if (cohortsSha !== EXPECTED_COHORTS_SHA256) fail('FROZEN_COHORTS_CHANGED');
  if (packet.frozen_cohort?.sha256 !== EXPECTED_COHORTS_SHA256) fail('METADATA_COHORTS_SHA_MISMATCH');
  // Totals: 2 requests, 131072 bytes, 15s, concurrency 1, no credentials, and NO
  // row limits anywhere (metadata docs are parsed as documents, not rows).
  if (packet.totals?.products !== 2) fail('METADATA_PRODUCT_COUNT_TOTAL');
  if (packet.totals?.max_requests !== 2) fail('METADATA_TOTAL_REQUESTS');
  if (packet.totals?.max_bytes !== 131072) fail('METADATA_TOTAL_BYTES');
  if (packet.totals?.max_seconds !== 15) fail('METADATA_TOTAL_SECONDS');
  if (packet.totals?.max_concurrency !== 1) fail('METADATA_CONCURRENCY');
  if (packet.totals?.credential_required === true) fail('METADATA_CREDENTIAL_NOT_ALLOWED');
  assertNoRowLimits(packet.totals, 'totals');
  const accounting = packet.request_accounting ?? {};
  if (accounting.redirects_consume_budget !== true || accounting.retries_consume_budget !== true) fail('METADATA_REQUEST_BUDGET');
  if (accounting.validate_redirect_host_before_follow !== true) fail('METADATA_REDIRECT_MUST_BE_VALIDATED');
  if (accounting.max_redirects_per_request !== 0 || accounting.max_retries_per_source !== 0) fail('METADATA_REDIRECT_RETRY_MUST_BE_ZERO');
  const gitignore = readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  // Captures/attempts/lock live under already-gitignored parent trees (no
  // .gitignore change is needed or permitted for this correction).
  if (packet.retention?.captures_path !== EXPECTED_CAPTURE_DIR) fail('METADATA_CAPTURES_PATH', String(packet.retention?.captures_path));
  if (!packet.retention?.captures_path?.startsWith('verification/research-program/evidence/payloads/metadata-check/')) fail('METADATA_CAPTURES_NOT_GITIGNORED_TREE');
  if (!gitignore.includes('verification/research-program/evidence/payloads/metadata-check/')) fail('METADATA_GITIGNORE_MISSING');
  if (packet.retention?.attempts_path !== EXPECTED_ATTEMPT_DIR) fail('METADATA_ATTEMPTS_PATH', String(packet.retention?.attempts_path));
  if (!packet.retention?.attempts_path?.startsWith('verification/research-program/evidence/metadata-attempts/')) fail('METADATA_ATTEMPTS_NOT_GITIGNORED_TREE');
  if (!gitignore.includes('verification/research-program/evidence/metadata-attempts/')) fail('METADATA_GITIGNORE_ATTEMPTS_MISSING');
  if (packet.retention?.receipts_path !== EXPECTED_RECEIPT_DIR) fail('METADATA_RECEIPTS_PATH', String(packet.retention?.receipts_path));
  if (packet.retention?.do_not_commit_publisher_rows !== true) fail('METADATA_DO_NOT_COMMIT_ROWS');
  if (packet.retention?.max_object_bytes !== 65536) fail('METADATA_MAX_OBJECT_BYTES');
  if (packet.retention?.captures_gitignored !== true) fail('METADATA_CAPTURES_MUST_BE_GITIGNORED');
  if (packet.authorized_receipt_path?.live_http_must_remain_true !== true) fail('METADATA_LIVE_HTTP_MUST_STAY_TRUE');
  if (packet.authorized_receipt_path?.authorization_id_required !== EXPECTED_AUTH) fail('METADATA_AUTHORIZED_RECEIPT_AUTH');
  if (packet.authorized_receipt_path?.auth_04_rejected !== true) fail('METADATA_AUTH04_MUST_BE_REJECTED');
  if (packet.authorized_receipt_path?.auth_payload_pilot_rejected !== true) fail('METADATA_PAYLOAD_PILOT_MUST_BE_REJECTED');
  if (packet.authorized_receipt_path?.receipt_format !== 'ushso.metadata-receipt.v1') fail('METADATA_RECEIPT_FORMAT');
  if (packet.authorized_receipt_path?.receipt_kind !== 'metadata_check') fail('METADATA_RECEIPT_KIND');
  if (packet.authorized_receipt_path?.receipt_field !== 'source_metadata') fail('METADATA_RECEIPT_FIELD');
  // Endpoint provenance: exact 2 metadata URLs from prior proposals.
  if (JSON.stringify(packet.endpoint_provenance?.urls) !== JSON.stringify([...EXPECTED_ENDPOINTS])) fail('METADATA_ENDPOINT_PROVENANCE');
  const cohorts = JSON.parse(cohortsBytes.toString('utf8'));
  const byKey = Object.fromEntries((cohorts.products ?? []).map((row) => [row.product_key, row]));
  if (!Array.isArray(packet.products) || packet.products.length !== 2) fail('METADATA_PRODUCT_COUNT');
  const keys = packet.products.map((row) => row.product_key);
  if (JSON.stringify(keys) !== JSON.stringify([...METADATA_KEYS])) fail('METADATA_PRODUCT_KEYS');
  // Exact URL check against prior proposals.
  const endpoints = packet.products.map((row) => row.endpoint);
  if (JSON.stringify(endpoints) !== JSON.stringify([...EXPECTED_ENDPOINTS])) fail('METADATA_EXACT_URLS');
  let requests = 0;
  let bytes = 0;
  for (const item of packet.products) {
    const frozen = byKey[item.product_key];
    if (!frozen) fail('METADATA_PRODUCT_NOT_IN_COHORT', item.product_key);
    if (frozen.access_expectation !== 'public_sample_eligible') fail('METADATA_NOT_PUBLIC_SAMPLE_ELIGIBLE', item.product_key);
    if (item.frozen_record_id !== frozen.anchor?.representative?.record_id) fail('METADATA_RECORD_ID_MISMATCH', item.product_key);
    if (item.native_product_id !== frozen.anchor?.representative?.native_id) fail('METADATA_NATIVE_ID_MISMATCH', item.product_key);
    if (item.release_verification?.native_product_id_must_equal_frozen_native_id !== true) fail('METADATA_RELEASE_NATIVE_CHECK', item.product_key);
    if (!item.endpoint.includes(item.release_verification.endpoint_must_contain)) fail('METADATA_ENDPOINT_RELEASE', item.product_key);
    if (item.credentials?.required === true) fail('METADATA_CREDENTIAL_NOT_ALLOWED', item.product_key);
    const host = new URL(item.endpoint).host;
    if (!item.permitted_hosts.includes(host)) fail('METADATA_ENDPOINT_HOST', item.product_key);
    if (item.endpoint.includes(FORBIDDEN_PLACES) || String(item.native_product_id).includes(FORBIDDEN_PLACES)) fail('PLACES_VINTAGE_SUBSTITUTION');
    if ((item.release_verification.forbidden_native_ids ?? []).includes(FORBIDDEN_PLACES) !== true && item.product_key === 'cdc-places-local-data-for-better-health') {
      fail('PLACES_FORBIDDEN_ID_MISSING');
    }
    // Source-specific metadata parser binding (documents, not rows): CMS binds
    // the dataset-resources structure and its dataset UUID; CDC binds the
    // Socrata view structure and swc5-untb. Row-level identity (Provider CCN /
    // stateabbr) applies to payload rows, not to these metadata docs, and must
    // not appear as metadata identity gates here.
    if (item.product_key === 'cms-hcris-hospital-provider-cost-report') {
      if (item.metadata_parser !== 'cms-dataset-resources.v1') fail('METADATA_CMS_PARSER', item.product_key);
      if (item.metadata_identity?.expected_uuid !== '44060663-47d8-4ced-a115-b53b4c270acb') fail('METADATA_CMS_UUID', item.product_key);
    }
    if (item.product_key === 'cdc-places-local-data-for-better-health') {
      if (item.metadata_parser !== 'cdc-socrata-view.v1') fail('METADATA_CDC_PARSER', item.product_key);
      if (item.metadata_identity?.expected_id !== 'swc5-untb') fail('METADATA_CDC_VIEW_ID', item.product_key);
    }
    if (item.identity_checks) fail('METADATA_ROW_IDENTITY_FORBIDDEN', item.product_key);
    if (item.release_verification?.status !== 'unresolved') fail('METADATA_RELEASE_MUST_STAY_UNRESOLVED', item.product_key);
    if (item.release_verification?.payload_fields) fail('METADATA_ROW_FIELDS_FORBIDDEN', item.product_key);
    // Do not equate observation year with release year: forbid any year equality constraint text.
    const note = JSON.stringify(item.metadata_identity ?? {}) + JSON.stringify(item.release_verification);
    if (/year\s*==\s*2025|year=2025|2025.*release.*prove|prove.*2025/i.test(note) && !/cannot prove|does not prove|unresolved/i.test(note)) fail('METADATA_YEAR_EQUALS_RELEASE', item.product_key);
    if (item.permitted_redirects !== 0) fail('METADATA_PERMITTED_REDIRECTS', item.product_key);
    if (item.permitted_redirects !== accounting.max_redirects_per_request) fail('METADATA_PERMITTED_REDIRECTS_MISMATCH', item.product_key);
    if (item.limits.max_requests !== 1) fail('METADATA_SOURCE_REQUESTS', item.product_key);
    if (item.limits.max_bytes !== 65536) fail('METADATA_SOURCE_BYTES', item.product_key);
    if (item.limits.max_seconds !== 15) fail('METADATA_SOURCE_SECONDS', item.product_key);
    if (item.limits.max_concurrency !== 1) fail('METADATA_SOURCE_CONCURRENCY', item.product_key);
    assertNoRowLimits(item.limits, item.product_key);
    requests += item.limits.max_requests;
    bytes += item.limits.max_bytes;
  }
  if (requests !== packet.totals.max_requests) fail('METADATA_TOTAL_REQUESTS_SUM');
  if (bytes !== packet.totals.max_bytes) fail('METADATA_TOTAL_BYTES_SUM');
  // Allocation block must match (requests + bytes only; no rows).
  if (packet.allocation?.per_source?.['cms-hcris-hospital-provider-cost-report']?.max_requests !== 1) fail('METADATA_ALLOCATION_CMS');
  if (packet.allocation?.per_source?.['cdc-places-local-data-for-better-health']?.max_requests !== 1) fail('METADATA_ALLOCATION_CDC');
  if (packet.allocation?.sums?.max_requests !== 2 || packet.allocation?.sums?.max_bytes !== 131072) fail('METADATA_ALLOCATION_SUMS');
  assertNoRowLimits(packet.allocation?.sums, 'allocation.sums');
  // Single coherent operation: packet operation block, AUTH entry, and corrected
  // ledger must all agree. The spent wrong-endpoint ledger must never appear here.
  const op = packet.operation;
  if (!op || op.id !== OPERATION_ID) fail('METADATA_OPERATION_UNRESOLVED', String(op?.id));
  if (op.packet_version !== PACKET_VERSION) fail('METADATA_OPERATION_VERSION', String(op.packet_version));
  if (op.auth_id !== EXPECTED_AUTH) fail('METADATA_OPERATION_AUTH', String(op.auth_id));
  if (!op.ledger || op.ledger === SPENT_LEDGER_REL) fail('METADATA_SPENT_LEDGER_FALLBACK', String(op.ledger));
  if (op.ledger !== CORRECTED_LEDGER_REL) fail('METADATA_OPERATION_LEDGER', String(op.ledger));
  if (op.capture_dir !== EXPECTED_CAPTURE_DIR) fail('METADATA_OPERATION_CAPTURE_DIR', String(op.capture_dir));
  if (op.receipt_dir !== EXPECTED_RECEIPT_DIR) fail('METADATA_OPERATION_RECEIPT_DIR', String(op.receipt_dir));
  if (op.attempt_dir !== EXPECTED_ATTEMPT_DIR) fail('METADATA_OPERATION_ATTEMPT_DIR', String(op.attempt_dir));
  if (op.lock !== EXPECTED_LOCK_REL) fail('METADATA_OPERATION_LOCK', String(op.lock));
  if (op.run_report !== EXPECTED_RUN_REPORT_REL) fail('METADATA_OPERATION_RUN_REPORT', String(op.run_report));
  if (JSON.stringify((op.endpoints ?? []).map((row) => row.url)) !== JSON.stringify([...EXPECTED_ENDPOINTS])) fail('METADATA_OPERATION_ENDPOINTS');
  if (JSON.stringify((op.endpoints ?? []).map((row) => row.product_key)) !== JSON.stringify([...METADATA_KEYS])) fail('METADATA_OPERATION_PRODUCTS');
  if (packet.authorization?.required_auth_id_if_later_granted !== op.auth_id) fail('METADATA_AUTH_ID');
  const auth = JSON.parse(readFileSync(path.join(repoRoot, AUTH_REL), 'utf8'));
  const authEntry = (auth.entries ?? []).find((row) => row.id === op.auth_id);
  if (!authEntry) fail('METADATA_AUTH_ENTRY_MISSING', op.auth_id);
  if (authEntry.action !== 'metadata_check') fail('METADATA_AUTH_ACTION_MISMATCH', String(authEntry.action));
  if (JSON.stringify(authEntry.product_keys) !== JSON.stringify([...METADATA_KEYS])) fail('METADATA_AUTH_PRODUCT_MISMATCH');
  if (JSON.stringify(authEntry.endpoints) !== JSON.stringify([...EXPECTED_ENDPOINTS])) fail('METADATA_AUTH_ENDPOINT_MISMATCH');
  const authLimits = authEntry.limits ?? {};
  if (authLimits.max_requests !== 2 || authLimits.max_bytes !== 131072 || authLimits.max_seconds !== 15 || authLimits.max_concurrency !== 1) fail('METADATA_AUTH_LIMIT_MISMATCH');
  if (authLimits.max_requests_per_source !== 1 || authLimits.max_bytes_per_source !== 65536 || authLimits.max_seconds_per_source !== 15) fail('METADATA_AUTH_LIMIT_MISMATCH');
  if (authLimits.max_redirects_per_request !== 0 || authLimits.max_retries_per_source !== 0) fail('METADATA_AUTH_LIMIT_MISMATCH');
  assertNoRowLimits(authLimits, 'auth.limits');
  if (authEntry.credentials?.required === true) fail('METADATA_AUTH_CREDENTIALS_FORBIDDEN');
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(path.join(repoRoot, op.ledger), 'utf8'));
  } catch {
    fail('METADATA_LEDGER_REQUIRED', op.ledger);
  }
  if (ledger.format !== 'ushso.metadata-check-ledger.v1') fail('METADATA_LEDGER_FORMAT');
  if (ledger.authorization_id !== op.auth_id) fail('METADATA_LEDGER_AUTH', String(ledger.authorization_id));
  if (ledger.operation_id && ledger.operation_id !== op.id) fail('METADATA_LEDGER_OPERATION_MISMATCH', String(ledger.operation_id));
  if (ledger.closed) fail('METADATA_LEDGER_CLOSED');
  if (ledger.totals?.max_requests !== 2) fail('METADATA_LEDGER_LIMIT_MISMATCH');
  if (!Number.isSafeInteger(ledger.totals?.used_requests) || ledger.totals.used_requests < 0) fail('METADATA_LEDGER_USED_INVALID');
  if (ledger.totals.remaining_requests !== ledger.totals.max_requests - ledger.totals.used_requests) fail('METADATA_LEDGER_REMAINING_MISMATCH');
  if (ledger.totals.used_requests > ledger.totals.max_requests) fail('METADATA_LEDGER_OVERSPENT');
  let sourceUsed = 0;
  for (const key of METADATA_KEYS) {
    const source = ledger.per_source?.[key];
    if (!source) fail('METADATA_LEDGER_SOURCE_MISSING', key);
    if (source.max_requests !== 1) fail('METADATA_LEDGER_SOURCE_LIMIT_MISMATCH', key);
    if (!Number.isSafeInteger(source.used_requests) || source.used_requests < 0) fail('METADATA_LEDGER_SOURCE_USED_INVALID', key);
    if (source.remaining_requests !== source.max_requests - source.used_requests) fail('METADATA_LEDGER_SOURCE_REMAINING_MISMATCH', key);
    if (source.used_requests > source.max_requests) fail('METADATA_LEDGER_SOURCE_OVERSPENT', key);
    sourceUsed += source.used_requests;
  }
  if (sourceUsed !== ledger.totals.used_requests) fail('METADATA_LEDGER_SOURCE_TOTAL_MISMATCH');
  return Object.freeze({
    format: 'ushso.metadata-check-validation.v1',
    status: packet.status,
    products: Object.freeze(keys),
    endpoints: Object.freeze(endpoints),
    operation_id: op.id,
    packet_version: PACKET_VERSION,
    auth_id: op.auth_id,
    ledger: op.ledger,
    capture_dir: op.capture_dir,
    receipt_dir: op.receipt_dir,
    attempt_dir: op.attempt_dir,
    lock: op.lock,
    run_report: op.run_report,
    authorized: false,
    live_http: false,
    accepted: false,
    frozen_cohorts_unmodified: true,
    captures_gitignored: true,
    redirects_consume_budget: true,
    branch: packetBranch ?? EXPECTED_BRANCH,
    packet_branch: packetBranch,
    historical_branch: EXPECTED_BRANCH,
    checkout_branch: checkoutBranch,
    checkout_head: head,
    branch_enforcement: 'execution-only',
    git_head: head,
    detached_head_allowed: checkoutDetached,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(validateMetadataCheck(), null, 2) + '\n');
}
