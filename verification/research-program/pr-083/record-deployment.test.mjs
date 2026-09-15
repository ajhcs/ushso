import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  HISTORICAL_PRODUCTION_WORKER,
  LAST_GOOD_GENERATION,
  recordDeployment,
} from './record-deployment.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('no deployment takes place merely because this planning package exists', () => {
  const rec = recordDeployment();
  assert.equal(rec.generation, LAST_GOOD_GENERATION);
  assert.equal(rec.planning_package_exists, true);
  assert.equal(rec.deployment_because_planning_package_exists, false);
  assert.equal(rec.approved_staged_rollout_executed, false);
  assert.equal(rec.wrangler_deploy_invoked, false);
  assert.equal(rec.implicit_upgrade, false);
  assert.equal(rec.new_binding_introduced, false);
  assert.equal(rec.rebuilt_bundle_introduced, false);
  assert.equal(rec.authorization.authorized, false);
  assert.equal(rec.authorization.auth_07, 'not_requested');
});

test('production truth is not claimed to match an independently qualified artifact; staging is not relabeled', () => {
  const rec = recordDeployment();
  assert.equal(rec.independently_qualified_artifact.exists, false);
  assert.equal(rec.independently_qualified_artifact.production_truth_matches_independently_qualified_artifact, false);
  assert.equal(rec.staging_evidence_relabeled_as_production, false);
  assert.equal(rec.production_journeys.production_screenshots_recorded, false);
  assert.equal(rec.production_journeys.real_production_responses_recorded, false);
  assert.equal(rec.production_journeys.result, 'unverified');
  assert.equal(rec.production.changed, false);
  assert.equal(rec.production.worker_id, HISTORICAL_PRODUCTION_WORKER);
  assert.equal(rec.rollback_target.worker_id, HISTORICAL_PRODUCTION_WORKER);
  assert.equal(rec.r16.accepted, false);
  assert.equal(rec.r16.result, 'fail');
  assert.equal(rec.c0091, 'unresolved');
  const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'verification/research-program/release/deployment.json'), 'utf8'));
  assert.equal(onDisk.wrangler_deploy_invoked, false);
  assert.equal(onDisk.production.changed, false);
});
