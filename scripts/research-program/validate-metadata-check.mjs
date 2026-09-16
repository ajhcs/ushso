#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKET_REL = 'verification/research-program/evidence/metadata-check-packet.json';
const COHORTS_REL = 'evaluation/research-program/cohorts.json';
const EXPECTED_COHORTS_SHA256 = '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543';
const METADATA_KEYS = Object.freeze(['cms-hcris-hospital-provider-cost-report', 'cdc-places-local-data-for-better-health']);
const FORBIDDEN_PLACES = '7cmc-7y5g';
const EXPECTED_BRANCH = 'codex/ushso-corr1-metadata-20260917';
const EXPECTED_ENDPOINTS = Object.freeze([
  'https://data.cms.gov/data-api/v1/dataset-resources/44060663-47d8-4ced-a115-b53b4c270acb',
  'https://data.cdc.gov/api/views/swc5-untb.json',
]);
const EXPECTED_AUTH = 'AUTH-METADATA-CHECK';

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

export function validateMetadataCheck({ repoRoot = ROOT } = {}) {
  const packet = JSON.parse(readFileSync(path.join(repoRoot, PACKET_REL), 'utf8'));
  if (packet.format !== 'ushso.metadata-check-packet.v1') fail('METADATA_FORMAT');
  if (packet.status !== 'prepared_not_authorized') fail('METADATA_NOT_PREPARED');
  if (packet.authorization?.requested === true) fail('METADATA_MUST_NOT_REQUEST_AUTH_YET');
  if (packet.authorization?.auth_04_does_not_cover_metadata_check !== true) fail('AUTH04_MUST_NOT_COVER_METADATA');
  if (packet.authorization?.auth_payload_pilot_does_not_cover_metadata_check !== true) fail('PAYLOAD_PILOT_MUST_NOT_COVER_METADATA');
  if (packet.authorization?.required_auth_id_if_later_granted !== EXPECTED_AUTH) fail('METADATA_AUTH_ID');
  if (packet.accepted === true || packet.scientific_approval === true) fail('METADATA_CANNOT_ACCEPT');
  if (packet.live_http === true) fail('METADATA_LIVE_HTTP_FORBIDDEN');
  if (packet.candidate_binding?.must_match_git_head !== true) fail('METADATA_MUST_BIND_GIT_HEAD');
  if (packet.candidate_binding?.branch !== EXPECTED_BRANCH) fail('METADATA_BRANCH');
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const currentBranch = git(repoRoot, ['branch', '--show-current']);
  if (currentBranch && currentBranch !== EXPECTED_BRANCH) fail('METADATA_WORKTREE_BRANCH');
  if (!currentBranch) {
    const names = git(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/' + EXPECTED_BRANCH, 'refs/remotes/origin/' + EXPECTED_BRANCH]);
    if (!names.split('\n').filter(Boolean).length) fail('METADATA_BRANCH_REF_MISSING');
  }
  if (packet.candidate_head && packet.candidate_head !== head) fail('METADATA_CANDIDATE_HEAD_STALE');
  if (packet.candidate_binding?.stale_sha_named_at_first_draft === head) fail('METADATA_STALE_DRAFT_SHA');
  const cohortsBytes = readFileSync(path.join(repoRoot, COHORTS_REL));
  const cohortsSha = createHash('sha256').update(cohortsBytes).digest('hex');
  if (cohortsSha !== EXPECTED_COHORTS_SHA256) fail('FROZEN_COHORTS_CHANGED');
  if (packet.frozen_cohort?.sha256 !== EXPECTED_COHORTS_SHA256) fail('METADATA_COHORTS_SHA_MISMATCH');
  // Totals: 2 requests, 131072 bytes, 10 rows, 15s, concurrency 1, no credentials.
  if (packet.totals?.products !== 2) fail('METADATA_PRODUCT_COUNT_TOTAL');
  if (packet.totals?.max_requests !== 2) fail('METADATA_TOTAL_REQUESTS');
  if (packet.totals?.max_bytes !== 131072) fail('METADATA_TOTAL_BYTES');
  if (packet.totals?.max_rows !== 10) fail('METADATA_TOTAL_ROWS');
  if (packet.totals?.max_seconds !== 15) fail('METADATA_TOTAL_SECONDS');
  if (packet.totals?.max_concurrency !== 1) fail('METADATA_CONCURRENCY');
  if (packet.totals?.credential_required === true) fail('METADATA_CREDENTIAL_NOT_ALLOWED');
  const accounting = packet.request_accounting ?? {};
  if (accounting.redirects_consume_budget !== true || accounting.retries_consume_budget !== true) fail('METADATA_REQUEST_BUDGET');
  if (accounting.validate_redirect_host_before_follow !== true) fail('METADATA_REDIRECT_MUST_BE_VALIDATED');
  if (accounting.max_redirects_per_request !== 0 || accounting.max_retries_per_source !== 0) fail('METADATA_REDIRECT_RETRY_MUST_BE_ZERO');
  const gitignore = readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  if (!packet.retention?.captures_gitignored) fail('METADATA_CAPTURES_MUST_BE_GITIGNORED');
  if (!gitignore.includes(packet.retention.gitignore_entry)) fail('METADATA_GITIGNORE_MISSING');
  if (packet.retention.gitignore_entry !== 'verification/research-program/evidence/payloads/metadata-check/') fail('METADATA_GITIGNORE_ENTRY');
  if (packet.retention.captures_path !== 'verification/research-program/evidence/payloads/metadata-check/') fail('METADATA_CAPTURES_PATH');
  if (packet.retention.do_not_commit_publisher_rows !== true) fail('METADATA_DO_NOT_COMMIT_ROWS');
  if (packet.retention.max_object_bytes !== 65536) fail('METADATA_MAX_OBJECT_BYTES');
  if (packet.authorized_receipt_path?.live_http_must_remain_true !== true) fail('METADATA_LIVE_HTTP_MUST_STAY_TRUE');
  if (packet.authorized_receipt_path?.authorization_id_required !== EXPECTED_AUTH) fail('METADATA_AUTHORIZED_RECEIPT_AUTH');
  if (packet.authorized_receipt_path?.auth_04_rejected !== true) fail('METADATA_AUTH04_MUST_BE_REJECTED');
  if (packet.authorized_receipt_path?.auth_payload_pilot_rejected !== true) fail('METADATA_PAYLOAD_PILOT_MUST_BE_REJECTED');
  // Endpoint provenance: exact 2 URLs from prior proposals.
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
  let rows = 0;
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
    if (!item.identity_checks?.required_fields || Object.keys(item.identity_checks.required_fields).length < 1) fail('METADATA_IDENTITY_CHECKS');
    if (item.release_verification?.status !== 'unresolved') fail('METADATA_RELEASE_MUST_STAY_UNRESOLVED', item.product_key);
    if (item.identity_checks.constraints && Object.keys(item.identity_checks.constraints).length > 0) fail('METADATA_GUESSED_YEAR_CONSTRAINT', item.product_key);
    // Do not equate observation year with release year: forbid any year equality constraint text.
    const note = JSON.stringify(item.identity_checks) + JSON.stringify(item.release_verification);
    if (/year\s*==\s*2025|year=2025|2025.*release.*prove|prove.*2025/i.test(note) && !/cannot prove|does not prove|unresolved/i.test(note)) fail('METADATA_YEAR_EQUALS_RELEASE', item.product_key);
    if (item.permitted_redirects !== 0) fail('METADATA_PERMITTED_REDIRECTS', item.product_key);
    if (item.permitted_redirects !== accounting.max_redirects_per_request) fail('METADATA_PERMITTED_REDIRECTS_MISMATCH', item.product_key);
    if (item.limits.max_requests !== 1) fail('METADATA_SOURCE_REQUESTS', item.product_key);
    if (item.limits.max_bytes !== 65536) fail('METADATA_SOURCE_BYTES', item.product_key);
    if (item.limits.max_rows !== 5) fail('METADATA_SOURCE_ROWS', item.product_key);
    if (item.limits.max_seconds !== 15) fail('METADATA_SOURCE_SECONDS', item.product_key);
    if (item.limits.max_concurrency !== 1) fail('METADATA_SOURCE_CONCURRENCY', item.product_key);
    // Amended HCRIS identity: Provider CCN, not PROVNUM.
    if (item.product_key === 'cms-hcris-hospital-provider-cost-report') {
      if (!item.identity_checks.required_fields['Provider CCN']) fail('METADATA_HCRIS_PROVIDER_CCN', item.product_key);
      if (item.identity_checks.required_fields['PROVNUM']) fail('METADATA_HCRIS_PROVNUM_FORBIDDEN', item.product_key);
    }
    requests += item.limits.max_requests;
    bytes += item.limits.max_bytes;
    rows += item.limits.max_rows;
  }
  if (requests !== packet.totals.max_requests) fail('METADATA_TOTAL_REQUESTS_SUM');
  if (bytes !== packet.totals.max_bytes) fail('METADATA_TOTAL_BYTES_SUM');
  if (rows !== packet.totals.max_rows) fail('METADATA_TOTAL_ROWS_SUM');
  // Allocation block must match.
  if (packet.allocation?.per_source?.['cms-hcris-hospital-provider-cost-report']?.max_requests !== 1) fail('METADATA_ALLOCATION_CMS');
  if (packet.allocation?.per_source?.['cdc-places-local-data-for-better-health']?.max_requests !== 1) fail('METADATA_ALLOCATION_CDC');
  if (packet.allocation?.sums?.max_requests !== 2 || packet.allocation?.sums?.max_bytes !== 131072 || packet.allocation?.sums?.max_rows !== 10) fail('METADATA_ALLOCATION_SUMS');
  return Object.freeze({
    format: 'ushso.metadata-check-validation.v1',
    status: packet.status,
    products: Object.freeze(keys),
    endpoints: Object.freeze(endpoints),
    authorized: false,
    live_http: false,
    accepted: false,
    frozen_cohorts_unmodified: true,
    captures_gitignored: true,
    redirects_consume_budget: true,
    branch: EXPECTED_BRANCH,
    git_head: git(repoRoot, ['rev-parse', 'HEAD']),
    detached_head_allowed: !git(repoRoot, ['branch', '--show-current']),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(validateMetadataCheck(), null, 2) + '\n');
}
