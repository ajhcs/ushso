import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { computeManifest } from '../tools/build-manifest.mjs';
import { PACKAGE_ROOT, canonicalJsonSha256, compareCanonical, readJson, sha256File } from '../tools/common.mjs';
import { loadSchemas } from '../tools/schema.mjs';
import { stateCoverage, validateIdentityBundle } from '../tools/semantics.mjs';
import { loadFixtureBundle, validatePackage } from '../tools/validate-package.mjs';

test('strict JSON Schema 2020-12 package compiles and validates offline', async () => {
  const { schemas } = await loadSchemas();
  assert.equal(schemas.length, 13);
  assert.ok(schemas.every(({ schema }) => schema.$schema === 'https://json-schema.org/draft/2020-12/schema'));
  const { report } = await validatePackage();
  assert.equal(report.valid, true, report.errors.join('\n'));
  assert.equal(report.external_requests, 0);
  assert.equal(report.source_payload_downloads, 0);
  assert.equal(report.identity_merges_performed, false);
  assert.equal(report.analysis_executed, false);
  assert.equal(report.production_auto_resolution_authorized, false);
});

test('valid fixture has complete state coverage and no semantic errors', async () => {
  const { bundle } = await loadFixtureBundle();
  assert.deepEqual(validateIdentityBundle(bundle), []);
  assert.deepEqual(stateCoverage(bundle), {
    candidate_states: ['accepted', 'deferred', 'open', 'rejected', 'superseded'],
    decision_kinds: ['defer', 'family_member', 'mirror_of', 'needs_more_evidence', 'not_same_identity', 'same_identity', 'successor_of'],
    family_kinds: ['collection', 'format', 'mirror', 'successor', 'version'],
    operation_kinds: ['aggregate', 'crosswalk', 'filter', 'join', 'measure_harmonization', 'temporal_alignment'],
    evidence_states: ['ambiguous', 'candidate', 'documented', 'executed', 'observed', 'proven', 'unknown'],
    compatibilities: ['compatible', 'conditional', 'incompatible', 'unknown'],
    requirement_states: ['not_applicable', 'satisfied', 'unknown', 'unsatisfied']
  });
});

test('all required adversarial identity, temporal, join, and reversal cases fail closed', async () => {
  const { adversarialResults } = await validatePackage();
  assert.equal(adversarialResults.length, 21);
  assert.deepEqual(adversarialResults.filter(result => !result.passed), []);
  const byId = new Map(adversarialResults.map(result => [result.case_id, result]));
  for (const id of [
    'fuzzy-score-cannot-auto-merge',
    'reused-identifier-periods-do-not-overlap',
    'exact-identifier-grain-conflict',
    'exact-identifier-entity-conflict',
    'family-relation-cannot-become-identity',
    'same-named-field-candidate-cannot-be-documented',
    'current-identity-snapshot-cannot-answer-historical-route',
    'aggregation-cannot-satisfy-crosswalk',
    'review-decision-supersession-cycle',
    'reversal-must-retain-both-source-objects'
  ]) assert.equal(byId.get(id)?.passed, true, id);
});

test('only exact policy and current same-identity review decisions project equality', async () => {
  const { bundle } = await loadFixtureBundle();
  const equality = bundle.relationship_projections.filter(item => item.relationship_type === 'same_identity' && item.state === 'active');
  assert.deepEqual(equality.map(item => item.projection_id).sort(), ['projection:auto-exact', 'projection:human-same']);
  assert.ok(!equality.some(item => item.basis.reference_id === 'candidate:fuzzy-open'));
  assert.ok(bundle.candidates.filter(item => ['open', 'deferred'].includes(item.state)).every(item =>
    !equality.some(projection => projection.object_a_id === item.object_a_id && projection.object_b_id === item.object_b_id)
  ));
  assert.ok(bundle.family_memberships.every(item => item.member_object_id !== 'object:facility.alpha'));
});

test('reversal is append-only and rebuilds every dependent view', async () => {
  const { bundle } = await loadFixtureBundle();
  const plan = bundle.reversal_plans[0];
  assert.deepEqual([...plan.rebuild_targets].sort(), ['aliases', 'identity_clusters', 'join_views', 'plan_fixtures', 'search_projections']);
  assert.equal(plan.retain_source_observations, true);
  assert.equal(plan.retain_identifier_assertions, true);
  assert.equal(plan.destructive_deletes_allowed, false);
  assert.equal(plan.orphaned_lineage_allowed, false);
  const oldDecision = bundle.review_decisions.find(item => item.decision_id === plan.superseded_decision_id);
  const newDecision = bundle.review_decisions.find(item => item.decision_id === plan.superseding_decision_id);
  assert.equal(oldDecision.superseded_by_decision_id, newDecision.decision_id);
  assert.equal(newDecision.supersedes_decision_id, oldDecision.decision_id);
});

test('join routes are exact-field pinned and preserve orthogonal axes', async () => {
  const { bundle } = await loadFixtureBundle();
  for (const route of bundle.join_routes) {
    for (const side of ['source_endpoint', 'target_endpoint']) {
      assert.ok(route[side].release_id);
      assert.ok(route[side].distribution_id);
      assert.ok(route[side].schema_snapshot_id);
      assert.ok(route[side].schema_field_id);
      assert.ok(route[side].field_revision_id);
      assert.equal('family_id' in route[side], false);
      assert.equal('source_id' in route[side], false);
    }
  }
  const candidate = bundle.transformation_steps.find(item => item.step_id === 'step:candidate.join');
  assert.equal(candidate.evidence_state, 'candidate');
  assert.equal(candidate.compatibility, 'unknown');
  assert.equal(candidate.requirements[0].state, 'unknown');
  assert.equal(candidate.blockers[0].state, 'open');
  assert.equal(candidate.derived_readiness, 'blocked');
  const executed = bundle.transformation_steps.find(item => item.evidence_state === 'executed');
  assert.equal(executed.execution_context.public_request, false);
});

test('stored manifest and receipt use deterministic, non-interchangeable digest domains', async () => {
  const storedManifest = await readJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'));
  const computedManifest = await computeManifest();
  assert.equal(compareCanonical(storedManifest, computedManifest), true);
  assert.deepEqual(storedManifest.digest_taxonomy.map(item => item.digest_id), ['byte_sha256', 'canonical_json_sha256']);
  for (const file of storedManifest.files.filter(item => item.media_type === 'application/json')) assert.match(file.canonical_json_sha256, /^[a-f0-9]{64}$/);
  for (const file of storedManifest.files.filter(item => item.media_type !== 'application/json')) assert.equal(file.canonical_json_sha256, null);
  const receipt = await readJson(path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json'));
  assert.equal(receipt.manifest_byte_sha256, await sha256File(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json')));
  assert.equal(receipt.package_payload_digest_sha256, storedManifest.package_payload_digest_sha256);
  assert.match(receipt.validation_input_digest_sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(receipt.manifest_byte_sha256, receipt.package_payload_digest_sha256);
  assert.notEqual(canonicalJsonSha256(storedManifest), receipt.manifest_byte_sha256);
});

test('fixture package contains no downloaded source payloads', async () => {
  const files = await fs.readdir(path.join(PACKAGE_ROOT, 'fixtures'));
  assert.deepEqual(files.sort(), ['adversarial-cases.json', 'valid-bundle.json']);
});
