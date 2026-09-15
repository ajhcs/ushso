#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const CAPTURED_HEAD = '8e7520c807668e42ec5daf9313b493bf1dd6fcf8';
export const CAPTURED_TREE = '7562df6cba965f450d27d4149fd62c0690ae99ec';
export const CAPTURE_RUN_ID = '20260915T072218Z-781fcf0b2216';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function freeze(value) {
  return Object.freeze(value);
}

function loadJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function qualifyRelease({
  index = loadJson('verification/research-program/acceptance/index.json'),
  pointer = loadJson('verification/research-program/release/candidate-capture.pointer.json'),
  auth = loadJson('verification/external-authorization/v1.0.0/register.json'),
  costs = readFileSync(path.join(ROOT, 'docs/research-program/costs.md'), 'utf8'),
} = {}) {
  if (index.generation !== LAST_GOOD_GENERATION) fail('LAST_GOOD_GENERATION_CHANGED');
  if (index.fully_evidenced_candidate === true) fail('PR081_FULLY_EVIDENCED_CLAIM');
  if (pointer.head_sha !== CAPTURED_HEAD || pointer.tree_sha !== CAPTURED_TREE) fail('CAPTURED_CANDIDATE_MISMATCH');
  if (pointer.copied_into_git === true) fail('TWENTY_ONE_MIB_RECEIPT_IN_GIT');
  if (pointer.verdict !== 'passed') fail('CAPTURE_GATE_NOT_PASSED');

  const authById = Object.fromEntries((auth.entries ?? []).map((row) => [row.id, row]));
  for (const id of ['AUTH-01', 'AUTH-02', 'AUTH-03']) {
    const row = authById[id];
    if (!row || row.authorized === true) fail('STAGING_AUTHORIZATION_INVENTED', id);
  }
  if (!costs.includes('C-009-1 remains **unresolved**')) fail('C0091_UNRESOLVED_TEXT_MISSING');

  const requirements = (index.requirements ?? []).map((row) => freeze({
    id: row.id,
    accepted: false,
    result: row.result,
    closed: false,
  }));
  if (requirements.length !== 16) fail('REQUIREMENT_COUNT_NOT_16');
  if (requirements.some((row) => row.accepted === true)) fail('REQUIREMENT_ACCEPTED');
  const r16 = requirements.find((row) => row.id === 'R16');
  if (!r16 || r16.accepted === true) fail('R16_ACCEPTED');
  if (!['fail', 'unverified'].includes(r16.result)) fail('R16_NOT_OPEN', String(r16.result));

  const skipped = freeze([
    { id: 'staging-deploy', skipped: true, pass: false, reason: 'AUTH-01/02/03 remain not_requested and unauthorized. Skipped checks are not passes.' },
    { id: 'actual-browser-journeys', skipped: true, pass: false, reason: 'Live Chromium/Firefox/WebKit remain untested. Historical console records are not current captures.' },
    { id: 'assistive-technology', skipped: true, pass: false, reason: 'NVDA/VoiceOver/JAWS remain untested.' },
    { id: 'two-scheduled-cycles', skipped: true, pass: false, reason: 'Two authorized scheduled cycles and 14 elapsed observation days remain absent.' },
    { id: 'eight-plus-eight-participants', skipped: true, pass: false, reason: 'Actual novice participants 0/8 and actual advanced participants 0/8. Implementer self-tests cannot satisfy R12.' },
  ]);
  if (skipped.some((row) => row.pass === true)) fail('SKIPPED_CHECK_COUNTED_AS_PASS');

  return freeze({
    format: 'ushso.pr082-release-qualification.v1',
    generation: LAST_GOOD_GENERATION,
    captured_candidate: freeze({
      head_sha: CAPTURED_HEAD,
      tree_sha: CAPTURED_TREE,
      run_id: CAPTURE_RUN_ID,
      local_gate_verdict: pointer.verdict,
      duration_seconds: pointer.duration_seconds,
      receipt_sha256: pointer.receipt_sha256,
      receipt_bytes: pointer.receipt_bytes,
      copied_into_git: false,
      rebuild_creates_new_candidate: true,
      old_approvals_cannot_be_copied_onto_changed_bytes: true,
    }),
    pins: freeze({
      node_engines: '>=22.15.0',
      npm_engines: '>=11.19.1 <12',
      package_manager: 'npm@11.19.1',
      package_lock_sha256: '7001c1d478ff1468464abe40990ff183f639fc60e769e20a0189638878f4d3a3',
      release_gate_toml_sha256: '068273993ddb6692eb5ac77a07d9ab7a10a5ee670efdf3b236ba1064de297478',
      last_good_generation: LAST_GOOD_GENERATION,
    }),
    local_gate_stages: freeze([
      'preflight', 'bootstrap', 'dependency-tree', 'tests', 'build', 'local-e2e', 'release-audit', 'cloudflare-dry-run', 'retain-deployable-artifacts', 'receipt',
    ]),
    skipped_checks_are_not_passes: true,
    staging: freeze({
      deployed: false,
      authorized: false,
      auth_01: 'not_requested',
      auth_02: 'not_requested',
      auth_03: 'not_requested',
      result: 'unverified',
    }),
    c0091: freeze({
      status: 'unresolved',
      measured_cheapest_new_topology: null,
      public_prices_insufficient: true,
      rejected_as_full_acceptance: true,
    }),
    r16: freeze({
      id: 'R16',
      accepted: false,
      result: 'fail',
      independent_reviewer_identity: 'Astra/root (engineering). Named human scientific/owner reviewer: absent.',
      reason: 'Unresolved C-009-1, unauthorized staging, missing actual browser/AT/human/elapsed-day witnesses, and unaccepted prior requirements block independent exact release qualification. Merged engineering is not a pass.',
    }),
    requirements,
    skipped,
    fully_evidenced_candidate: false,
    release_qualified: false,
    proceeds_to_production: false,
    public_traffic_changed: false,
    paid_resource_changed: false,
    secret_changed: false,
    production_changed: false,
    rollback_target: freeze({
      version_id: 'ecc1603f-9eb4-4a1b-a566-bd9d7a415de4',
      note: 'Rollback version retained by the September 14 production deployment; not the current deployed version. Reverify before rollout.',
    }),
    http_200_is_completed_research_task: false,
    passing_schema_is_scientific_approval: false,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(qualifyRelease(), null, 2)}\n`);
}
