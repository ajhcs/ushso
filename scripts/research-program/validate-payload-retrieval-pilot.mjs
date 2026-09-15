#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKET_REL = 'verification/research-program/evidence/payload-retrieval-pilot.json';
const COHORTS_REL = 'evaluation/research-program/cohorts.json';
const EXPECTED_COHORTS_SHA256 = '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543';
const PILOT_KEYS = Object.freeze(['cms-hcris-hospital-provider-cost-report', 'cdc-places-local-data-for-better-health']);
const FORBIDDEN_PLACES = '7cmc-7y5g';

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function validatePayloadRetrievalPilot({ repoRoot = ROOT } = {}) {
  const packet = JSON.parse(readFileSync(path.join(repoRoot, PACKET_REL), 'utf8'));
  if (packet.format !== 'ushso.payload-retrieval-pilot-packet.v1') fail('PILOT_FORMAT');
  if (packet.status !== 'prepared_not_authorized') fail('PILOT_NOT_PREPARED');
  if (packet.authorization?.requested === true) fail('PILOT_MUST_NOT_REQUEST_AUTH_YET');
  if (packet.authorization?.auth_04_does_not_cover_payload_retrieval !== true) fail('AUTH04_MUST_NOT_COVER_PAYLOAD');
  if (packet.accepted === true || packet.scientific_approval === true) fail('PILOT_CANNOT_ACCEPT');
  if (packet.live_http === true) fail('PILOT_LIVE_HTTP_FORBIDDEN');
  const cohortsBytes = readFileSync(path.join(repoRoot, COHORTS_REL));
  const cohortsSha = createHash('sha256').update(cohortsBytes).digest('hex');
  if (cohortsSha !== EXPECTED_COHORTS_SHA256) fail('FROZEN_COHORTS_CHANGED');
  if (packet.frozen_cohort?.sha256 !== EXPECTED_COHORTS_SHA256) fail('PILOT_COHORTS_SHA_MISMATCH');
  const cohorts = JSON.parse(cohortsBytes.toString('utf8'));
  const byKey = Object.fromEntries((cohorts.products ?? []).map((row) => [row.product_key, row]));
  if (!Array.isArray(packet.products) || packet.products.length !== 2) fail('PILOT_PRODUCT_COUNT');
  const keys = packet.products.map((row) => row.product_key);
  if (JSON.stringify(keys) !== JSON.stringify(PILOT_KEYS)) fail('PILOT_PRODUCT_KEYS');
  let requests = 0;
  let bytes = 0;
  let rows = 0;
  for (const item of packet.products) {
    const frozen = byKey[item.product_key];
    if (!frozen) fail('PILOT_PRODUCT_NOT_IN_COHORT', item.product_key);
    if (frozen.access_expectation !== 'public_sample_eligible') fail('PILOT_NOT_PUBLIC_SAMPLE_ELIGIBLE', item.product_key);
    if (item.frozen_record_id !== frozen.anchor?.representative?.record_id) fail('PILOT_RECORD_ID_MISMATCH', item.product_key);
    if (item.credentials?.required === true) fail('PILOT_CREDENTIAL_NOT_ALLOWED', item.product_key);
    const host = new URL(item.endpoint).host;
    if (!item.permitted_hosts.includes(host)) fail('PILOT_ENDPOINT_HOST', item.product_key);
    if (item.endpoint.includes(FORBIDDEN_PLACES) || String(item.native_product_id).includes(FORBIDDEN_PLACES)) fail('PLACES_VINTAGE_SUBSTITUTION');
    if (!item.identity_checks?.required_fields || Object.keys(item.identity_checks.required_fields).length === 0) fail('PILOT_IDENTITY_CHECKS');
    requests += item.limits.max_requests;
    bytes += item.limits.max_bytes;
    rows += item.limits.max_rows;
  }
  if (requests !== packet.totals.max_requests) fail('PILOT_TOTAL_REQUESTS');
  if (bytes !== packet.totals.max_bytes) fail('PILOT_TOTAL_BYTES');
  if (rows !== packet.totals.max_rows) fail('PILOT_TOTAL_ROWS');
  if (packet.totals.max_concurrency !== 1) fail('PILOT_CONCURRENCY');
  return Object.freeze({
    format: 'ushso.payload-retrieval-pilot-validation.v1',
    status: packet.status,
    products: Object.freeze(keys),
    authorized: false,
    live_http: false,
    accepted: false,
    frozen_cohorts_unmodified: true,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(validatePayloadRetrievalPilot(), null, 2)}\n`);
}
