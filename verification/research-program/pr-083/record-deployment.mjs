#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const CAPTURED_ARTIFACT_HEAD = '8e7520c807668e42ec5daf9313b493bf1dd6fcf8';

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

export function recordDeployment({
  qualification = loadJson('verification/research-program/release/qualification.json'),
  auth = loadJson('verification/external-authorization/v1.0.0/register.json'),
  baseline = loadJson('verification/research-program/release/production-baseline.json'),
} = {}) {
  if (qualification.release_qualified === true) fail('PR082_RELEASE_QUALIFIED_CLAIM');
  if (qualification.r16?.accepted === true) fail('R16_ACCEPTED');
  if (qualification.proceeds_to_production === true) fail('PR082_PROCEEDS_TO_PRODUCTION');
  if (qualification.captured_candidate?.head_sha !== CAPTURED_ARTIFACT_HEAD) fail('CAPTURED_CANDIDATE_MISMATCH');

  const authById = Object.fromEntries((auth.entries ?? []).map((row) => [row.id, row]));
  for (const id of ['AUTH-01', 'AUTH-02', 'AUTH-03', 'AUTH-07']) {
    const row = authById[id];
    if (!row || row.authorized === true) fail('PRODUCTION_AUTHORIZATION_INVENTED', id);
  }

  return freeze({
    format: 'ushso.pr083-deployment-record.v1',
    generation: LAST_GOOD_GENERATION,
    planning_package_exists: true,
    deployment_because_planning_package_exists: false,
    approved_staged_rollout_executed: false,
    wrangler_deploy_invoked: false,
    implicit_upgrade: false,
    new_binding_introduced: false,
    rebuilt_bundle_introduced: false,
    independently_qualified_artifact: freeze({
      exists: false,
      captured_head: CAPTURED_ARTIFACT_HEAD,
      r16_accepted: false,
      release_qualified: false,
      production_truth_matches_independently_qualified_artifact: false,
    }),
    authorization: freeze({
      auth_01: 'not_requested',
      auth_02: 'not_requested',
      auth_03: 'not_requested',
      auth_07: 'not_requested',
      authorized: false,
    }),
    staging_evidence_relabeled_as_production: false,
    production_journeys: freeze({
      public_domains_checked: false,
      actual_mcp_webmcp_checked: false,
      website_examples_checked: false,
      real_production_responses_recorded: false,
      production_screenshots_recorded: false,
      result: 'unverified',
      note: 'Do not invent screenshots or live-browser captures. Staging evidence is not production verification.',
    }),
    production: freeze({
      changed: false,
      worker_name: baseline.worker_name,
      version_id: baseline.version_id,
      deployment_id: baseline.deployment_id,
      account_id: baseline.account_id,
      traffic_state: 'last_recorded_deployment_not_live_reverified',
      recorded_traffic_percentage: baseline.traffic_percentage,
      evidence: baseline.evidence,
      observed_health: 'not_re-measured_in_this_pr',
      monitoring_owner: 'unchanged; this packet does not assign a new owner',
      last_known_date: baseline.deployed_at,
    }),
    rollback_target: freeze({
      version_id: baseline.rollback_version_id,
      note: 'Rollback version retained by the September 14 deployment. Reverify production and rollback eligibility before a future authorized rollout.',
    }),
    failed_release_evidence_intact: true,
    c0091: 'unresolved',
    r16: freeze({ id: 'R16', accepted: false, result: 'fail' }),
    public_traffic_changed: false,
    paid_resource_changed: false,
    secret_changed: false,
    http_200_is_completed_research_task: false,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(recordDeployment(), null, 2)}\n`);
}
