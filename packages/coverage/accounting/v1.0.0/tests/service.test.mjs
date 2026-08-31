import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CoverageAccountingService,
  CoverageAccountingServiceError
} from '../src/coverage-accounting-service.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relative) {
  return JSON.parse(await fs.readFile(path.join(ROOT, relative), 'utf8'));
}

async function service() {
  return new CoverageAccountingService({
    snapshot: await read('artifacts/coverage-snapshot.json'),
    matrix: await read('artifacts/coverage-matrix.json'),
    cellRegistry: await read('artifacts/state-source-class-cell-registry.json'),
    publicView: await read('artifacts/public-coverage-view.json'),
    federalRegistry: await read('artifacts/federal-source-registry.json')
  });
}

function expectCode(code) {
  return error => error instanceof CoverageAccountingServiceError && error.code === code;
}

test('overview is pinned, bounded, and zero-action', async () => {
  const api = await service();
  const response = api.getOverview({ expectedSnapshotId: 'coverage-snapshot:wp9:v1.0.0' });
  assert.equal(response.capability, 'get_coverage_overview');
  assert.equal(response.result.positioning.publication_authorized, false);
  assert.ok(Object.values(response.truth_boundary).every(value => value === false));
  assert.ok(new TextEncoder().encode(JSON.stringify(response)).byteLength <= 128 * 1024);
});

test('matrix pagination is deterministic and exhausts all 306 cells once', async () => {
  const api = await service();
  let cursor;
  const ids = [];
  do {
    const response = api.getMatrix({ cursor, limit: 37 });
    ids.push(...response.result.values.map(cell => cell.cell_id));
    cursor = response.result.next_cursor;
  } while (cursor !== null);
  assert.equal(ids.length, 306);
  assert.equal(new Set(ids).size, 306);
  assert.deepEqual(ids, [...ids].sort());
});

test('matrix bounded filters preserve denominator context and assessment grain', async () => {
  const api = await service();
  const state = api.getMatrix({ jurisdictionId: 'jurisdiction:US-PA', limit: 10 });
  assert.equal(state.result.returned_count, 6);
  assert.equal(state.result.denominator.configured_cell_count, 306);
  assert.ok(state.result.values.every(cell => cell.coverage_cell_state === 'not_assessed'));
  assert.ok(state.result.values.every(cell => cell.agency_operator.status === 'not_identified'));
  assert.ok(state.result.values.every(cell => cell.legacy_status_promotable_to_cell === false));

  const sourceClass = api.getMatrix({ sourceClassId: 'all-payer-claims-database', limit: 100 });
  assert.equal(sourceClass.result.returned_count, 51);
  assert.ok(sourceClass.result.values.every(cell => cell.source_class_id === 'all-payer-claims-database'));
});

test('service enforces limits, canonical states, cursors, snapshot pins, and aborts', async () => {
  const api = await service();
  assert.throws(() => api.getMatrix({ limit: 101 }), expectCode('INVALID_LIMIT'));
  assert.throws(() => api.getMatrix({ states: ['made_up'] }), expectCode('INVALID_FILTER'));
  assert.throws(() => api.getMatrix({ cursor: 'cov1:00000000000000000000:1' }), expectCode('STALE_CURSOR'));
  assert.throws(() => api.getOverview({ expectedSnapshotId: 'coverage-snapshot:other' }), expectCode('SNAPSHOT_MISMATCH'));
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => api.getMetrics({ signal: controller.signal }), expectCode('ABORTED'));
});

test('returned values cannot mutate the immutable service snapshot', async () => {
  const api = await service();
  const first = api.getMatrix({ jurisdictionId: 'jurisdiction:US-PA', limit: 6 });
  first.result.values[0].coverage_cell_state = 'integrated';
  const second = api.getMatrix({ jurisdictionId: 'jurisdiction:US-PA', limit: 6 });
  assert.ok(second.result.values.every(cell => cell.coverage_cell_state === 'not_assessed'));
});

test('metric and federal-source views are bounded and explicit about applicability', async () => {
  const api = await service();
  const metrics = api.getMetrics({ limit: 18 });
  assert.equal(metrics.result.returned_count, 18);
  const federal = api.getFederalSources({ limit: 14 });
  assert.equal(federal.result.returned_count, 14);
  assert.deepEqual(federal.result.applicability, { direct: 11, crosswalk_required: 2, unknown: 1 });
  assert.ok(federal.result.values.every(source => source.validation_boundary.research_fitness_proven === false));
});
