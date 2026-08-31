import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_COVERAGE_CELL_STATES,
  validateCoverageBundle
} from '../../../../../contracts/coverage/v1.0.0/tools/semantics.mjs';
import {
  assertDenominatorInvariants,
  assessAbsenceClaim
} from '../src/accounting.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '../../../..');

async function pkg(relative) {
  return JSON.parse(await fs.readFile(path.join(ROOT, relative), 'utf8'));
}

async function repo(relative) {
  return JSON.parse(await fs.readFile(path.join(REPO, relative), 'utf8'));
}

test('generated coverage bundle passes frozen contract semantics', async () => {
  const definitions = await repo('contracts/coverage/v1.0.0/contracts/metric-definitions.json');
  const sourceScopes = await pkg('artifacts/source-scopes.json');
  const stageFacts = await pkg('artifacts/stage-facts.json');
  const snapshot = await pkg('artifacts/coverage-snapshot.json');
  const matrix = await pkg('artifacts/coverage-matrix.json');
  assert.deepEqual(validateCoverageBundle(definitions, {
    source_scopes: sourceScopes,
    stage_facts: stageFacts,
    snapshot,
    matrix
  }), []);
});

test('registry cross-product creates exactly one honest state for every cell', async () => {
  const jurisdictions = await pkg('artifacts/jurisdiction-registry.json');
  const sourceClasses = await pkg('registry/source-classes.v1.0.0.json');
  const registry = await pkg('artifacts/state-source-class-cell-registry.json');
  const matrix = await pkg('artifacts/coverage-matrix.json');

  assert.equal(jurisdictions.jurisdictions.length, 51);
  assert.equal(sourceClasses.classes.length, 6);
  assert.equal(registry.cells.length, 51 * 6);
  assert.equal(matrix.cells.length, 51 * 6);
  assert.equal(new Set(matrix.cells.map(cell => `${cell.jurisdiction_id}\u0000${cell.source_class_id}`)).size, 306);
  assert.ok(matrix.cells.every(cell => cell.coverage_cell_state === 'not_assessed'));
  assert.ok(matrix.cells.every(cell => cell.absence_claim_permitted === false));
  assert.ok(registry.cells.every(cell => cell.agency_operator.status === 'not_identified'));
  assert.ok(registry.cells.every(cell => cell.evidence.legacy_status_promotable_to_cell === false));
  assert.ok(registry.cells.every(cell => cell.last_complete_enumeration === null));
});

test('all seven canonical state values are frozen without inventing production examples', async () => {
  const fixture = await pkg('fixtures/coverage-cell-state-conformance.json');
  assert.equal(fixture.production_evidence, false);
  assert.deepEqual(fixture.states.map(item => item.state), CANONICAL_COVERAGE_CELL_STATES);
  assert.equal(new Set(fixture.states.map(item => item.state)).size, 7);
});

test('all 18 metric envelopes expose denominator semantics and exact partitions', async () => {
  const snapshot = await pkg('artifacts/coverage-snapshot.json');
  assert.equal(snapshot.metrics.length, 18);
  assert.equal(snapshot.membership_manifests.length, 18);
  for (const metric of snapshot.metrics) {
    assert.ok(Number.isInteger(metric.numerator_count));
    assert.ok(Object.hasOwn(metric, 'denominator_count'));
    assert.ok(metric.unit);
    assert.ok(metric.denominator_definition.length >= 12);
    assert.equal(metric.as_of, snapshot.as_of);
    assert.ok(metric.membership_manifest_hash.match(/^[a-f0-9]{64}$/));
    assert.ok(metric.revision_pins.registry_revision);
    assert.ok(metric.revision_pins.policy_revision);
    assert.equal(metric.denominator_status !== 'known' || metric.denominator_count === 0 ? metric.rate : metric.numerator_count / metric.denominator_count, metric.rate);
  }

  const configured = snapshot.metrics.find(metric => metric.metric_id === 'coverage.configured_scope_status/v1');
  assert.deepEqual(configured.partition_counts, [
    { state: 'active', count: 0 },
    { state: 'paused', count: 0 },
    { state: 'excluded', count: 0 },
    { state: 'retired', count: 0 },
    { state: 'unassessed', count: 14 }
  ]);
  assert.equal(configured.partition_counts.reduce((sum, item) => sum + item.count, 0), configured.denominator_count);

  const normalized = snapshot.metrics.find(metric => metric.metric_id === 'coverage.normalized_outcome/v1');
  assert.deepEqual(normalized.partition_counts.map(item => item.state), [
    'normalized', 'pending', 'failed', 'excluded', 'not_applicable', 'unknown'
  ]);
  assert.equal(normalized.partition_counts.reduce((sum, item) => sum + item.count, 0), normalized.denominator_count);
});

test('configured and due denominator invariants retain paused, excluded, and failed work', async () => {
  const fixture = await pkg('fixtures/denominator-invariants.json');
  const result = assertDenominatorInvariants(fixture);
  assert.equal(result.configured_denominator, 5);
  assert.equal(result.harvest_due_denominator, 3);
  assert.equal(result.harvest_complete_numerator, 1);
  assert.equal(result.due_check_denominator, 3);
  assert.equal(result.due_check_attempted_numerator, 2);
});

test('incomplete, failed, or unknown enumeration cannot support an absence claim', () => {
  assert.deepEqual(
    assessAbsenceClaim({ denominatorStatus: 'unknown', enumerationStatus: 'failed', sealed: false }),
    { permitted: false, reason: 'denominator_unknown' }
  );
  assert.deepEqual(
    assessAbsenceClaim({ denominatorStatus: 'known', enumerationStatus: 'failed', sealed: false }),
    { permitted: false, reason: 'enumeration_incomplete' }
  );
  assert.deepEqual(
    assessAbsenceClaim({ denominatorStatus: 'known', enumerationStatus: 'incomplete', sealed: false }),
    { permitted: false, reason: 'enumeration_incomplete' }
  );
  assert.deepEqual(
    assessAbsenceClaim({ denominatorStatus: 'known', enumerationStatus: 'complete', sealed: true, unknownCount: 1 }),
    { permitted: false, reason: 'unknown_membership' }
  );
  assert.deepEqual(
    assessAbsenceClaim({ denominatorStatus: 'known', enumerationStatus: 'complete', sealed: true }),
    { permitted: true, reason: null }
  );
});

test('51, 14, 306, and 157 remain distinct non-additive concepts', async () => {
  const view = await pkg('artifacts/public-coverage-view.json');
  assert.deepEqual(view.concepts.map(concept => [concept.count, concept.unit]), [
    [14, 'federal_source_scope'],
    [51, 'jurisdiction_label'],
    [306, 'coverage_assessment_cell'],
    [157, 'published_record']
  ]);
  assert.ok(view.concepts.every(concept => concept.additive_with_other_concepts === false));
  assert.equal(view.federal_applicability.direct, 11);
  assert.equal(view.federal_applicability.crosswalk_required, 2);
  assert.equal(view.federal_applicability.unknown, 1);
  assert.equal(view.legacy_aggregate_readiness.canonical_for_source_class_matrix, false);
});
