import { CANONICAL_COVERAGE_CELL_STATES, TRUTH_BOUNDARY } from './constants.mjs';
import {
  canonicalDigest,
  canonicalJson,
  matrixMembershipPayload,
  snapshotDigest
} from '../../../../../contracts/coverage/v1.0.0/tools/common.mjs';

const DEFAULT_LIMIT = 25;
const MAX_MATRIX_LIMIT = 100;
const MAX_METRIC_LIMIT = 18;
const MAX_RESPONSE_BYTES = 128 * 1024;

function clone(value) {
  return structuredClone(value);
}

function fail(code, message, details = null) {
  throw new CoverageAccountingServiceError(code, message, details);
}

function abortIfNeeded(signal) {
  if (signal?.aborted) fail('ABORTED', 'The coverage request was aborted.');
}

function integerLimit(value, fallback, maximum) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    fail('INVALID_LIMIT', `limit must be an integer from 1 through ${maximum}`, { received: value });
  }
  return resolved;
}

function assertStringOrUndefined(value, name) {
  if (value !== undefined && (typeof value !== 'string' || value.length === 0 || value.length > 180)) {
    fail('INVALID_FILTER', `${name} must be a non-empty string no longer than 180 characters`);
  }
}

function cursorFor(snapshotDigest, offset) {
  return `cov1:${snapshotDigest.slice(0, 20)}:${offset.toString(36)}`;
}

function offsetFromCursor(cursor, snapshotDigest) {
  if (cursor === undefined || cursor === null) return 0;
  if (typeof cursor !== 'string' || cursor.length > 80) fail('INVALID_CURSOR', 'The coverage cursor is malformed.');
  const match = /^cov1:([a-f0-9]{20}):([0-9a-z]+)$/.exec(cursor);
  if (!match) fail('INVALID_CURSOR', 'The coverage cursor is malformed.');
  if (match[1] !== snapshotDigest.slice(0, 20)) fail('STALE_CURSOR', 'The coverage cursor belongs to a different immutable snapshot.');
  const offset = Number.parseInt(match[2], 36);
  if (!Number.isSafeInteger(offset) || offset < 0) fail('INVALID_CURSOR', 'The coverage cursor offset is invalid.');
  return offset;
}

function enforceBytes(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > MAX_RESPONSE_BYTES) fail('RESPONSE_TOO_LARGE', 'The bounded coverage response exceeded 128 KiB.', { bytes, maximum: MAX_RESPONSE_BYTES });
  return value;
}

function page(items, { offset, limit, snapshotDigest }) {
  if (offset > items.length) fail('CURSOR_OUT_OF_RANGE', 'The coverage cursor points beyond the result set.');
  const values = items.slice(offset, offset + limit);
  const nextOffset = offset + values.length;
  return {
    values,
    total_count: items.length,
    returned_count: values.length,
    truncated: nextOffset < items.length,
    next_cursor: nextOffset < items.length ? cursorFor(snapshotDigest, nextOffset) : null
  };
}

function envelope(service, capability, result, warnings = []) {
  return enforceBytes({
    service_contract_version: 'ushso-coverage-accounting-service.v1.0.0',
    capability,
    result_snapshot_id: service.snapshot.coverage_snapshot_id,
    coverage_snapshot_digest: service.snapshot.immutability.canonical_digest,
    registry_revision: service.snapshot.revision_pins.registry_revision.value,
    index_generation: service.snapshot.revision_pins.index_generation.value,
    as_of: service.snapshot.as_of,
    result,
    warnings,
    truth_boundary: clone(TRUTH_BOUNDARY)
  });
}

function validateArtifactSet({ snapshot, matrix, cellRegistry, publicView, federalRegistry }) {
  if (snapshot.immutability?.canonical_digest !== snapshotDigest(snapshot)) fail('ARTIFACT_DIGEST_MISMATCH', 'The coverage snapshot digest is not reproducible.');
  if (matrix.denominator?.membership_manifest_hash !== canonicalDigest('ushso:coverage-membership-manifest:v1\n', matrixMembershipPayload(matrix))) fail('ARTIFACT_DIGEST_MISMATCH', 'The coverage matrix membership digest is not reproducible.');
  if (matrix.coverage_snapshot_id !== snapshot.coverage_snapshot_id || snapshot.matrix_id !== matrix.matrix_id) fail('ARTIFACT_PIN_MISMATCH', 'The coverage snapshot and matrix do not share immutable pins.');
  if (canonicalJson(matrix.revision_pins) !== canonicalJson(snapshot.revision_pins)) fail('ARTIFACT_PIN_MISMATCH', 'The coverage matrix revision pins do not match the snapshot.');
  const registryRevision = snapshot.revision_pins?.registry_revision?.value;
  if (cellRegistry.registry_revision !== registryRevision || cellRegistry.jurisdiction_registry_revision !== registryRevision || federalRegistry.registry_revision !== registryRevision) fail('ARTIFACT_PIN_MISMATCH', 'Registry artifacts do not share the snapshot registry revision.');
  if (publicView.coverage_snapshot_id !== snapshot.coverage_snapshot_id || publicView.coverage_snapshot_digest !== snapshot.immutability.canonical_digest || publicView.matrix_id !== matrix.matrix_id || canonicalJson(publicView.revisions) !== canonicalJson(snapshot.revision_pins)) fail('ARTIFACT_PIN_MISMATCH', 'The public coverage view is not bound to the snapshot and matrix.');
  if (publicView.matrix_summary?.membership_manifest_hash !== matrix.denominator.membership_manifest_hash) fail('ARTIFACT_PIN_MISMATCH', 'The public coverage view has a different matrix membership digest.');
  if (cellRegistry.configured_cell_count !== matrix.cells.length || cellRegistry.cells.length !== matrix.cells.length) fail('ARTIFACT_PIN_MISMATCH', 'The coverage cell registry does not cover the matrix.');
  const detailByCell = new Map();
  for (const detail of cellRegistry.cells) {
    if (detailByCell.has(detail.cell_id)) fail('ARTIFACT_PIN_MISMATCH', `The coverage cell registry repeats ${detail.cell_id}.`);
    detailByCell.set(detail.cell_id, detail);
  }
  const stateDistribution = Object.fromEntries(CANONICAL_COVERAGE_CELL_STATES.map(state => [state, 0]));
  for (const cell of matrix.cells) {
    const detail = detailByCell.get(cell.cell_id);
    if (!detail || detail.jurisdiction_id !== cell.jurisdiction_id || detail.source_class_id !== cell.source_class_id || detail.coverage_cell_state !== cell.coverage_cell_state) fail('ARTIFACT_PIN_MISMATCH', `The coverage cell detail does not match ${cell.cell_id}.`);
    if (!Object.hasOwn(stateDistribution, cell.coverage_cell_state)) fail('ARTIFACT_PIN_MISMATCH', `The matrix has an unknown state for ${cell.cell_id}.`);
    stateDistribution[cell.coverage_cell_state] += 1;
  }
  if (canonicalJson(publicView.matrix_summary?.coverage_cell_state_distribution) !== canonicalJson(stateDistribution)) fail('ARTIFACT_PIN_MISMATCH', 'The public coverage state distribution does not match the matrix.');
  if (!Array.isArray(federalRegistry.sources) || federalRegistry.source_count !== federalRegistry.sources.length || new Set(federalRegistry.sources.map(source => source.record_id)).size !== federalRegistry.sources.length) fail('ARTIFACT_PIN_MISMATCH', 'The federal source registry is not a unique, counted artifact.');
}

export class CoverageAccountingServiceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'CoverageAccountingServiceError';
    this.code = code;
    this.details = details;
  }
}

export class CoverageAccountingService {
  constructor({ snapshot, matrix, cellRegistry, publicView, federalRegistry }) {
    if (!snapshot || !matrix || !cellRegistry || !publicView || !federalRegistry) {
      fail('INVALID_ARTIFACT_SET', 'CoverageAccountingService requires one complete immutable artifact set.');
    }
    validateArtifactSet({ snapshot, matrix, cellRegistry, publicView, federalRegistry });
    this.snapshot = clone(snapshot);
    this.matrix = clone(matrix);
    this.cellRegistry = clone(cellRegistry);
    this.publicView = clone(publicView);
    this.federalRegistry = clone(federalRegistry);
    this.cellDetails = new Map(this.cellRegistry.cells.map(cell => [cell.cell_id, cell]));
  }

  #assertExpectedSnapshot(expectedSnapshotId) {
    assertStringOrUndefined(expectedSnapshotId, 'expectedSnapshotId');
    if (expectedSnapshotId !== undefined && expectedSnapshotId !== this.snapshot.coverage_snapshot_id) {
      fail('SNAPSHOT_MISMATCH', 'The requested coverage snapshot is not available from this service instance.', {
        expected: expectedSnapshotId,
        actual: this.snapshot.coverage_snapshot_id
      });
    }
  }

  getOverview({ expectedSnapshotId, signal } = {}) {
    abortIfNeeded(signal);
    this.#assertExpectedSnapshot(expectedSnapshotId);
    const result = clone(this.publicView);
    abortIfNeeded(signal);
    return envelope(this, 'get_coverage_overview', result, clone(this.publicView.warnings));
  }

  getMetrics({ metricIds, cursor, limit, expectedSnapshotId, signal } = {}) {
    abortIfNeeded(signal);
    this.#assertExpectedSnapshot(expectedSnapshotId);
    const resolvedLimit = integerLimit(limit, MAX_METRIC_LIMIT, MAX_METRIC_LIMIT);
    if (metricIds !== undefined) {
      if (!Array.isArray(metricIds) || metricIds.length > MAX_METRIC_LIMIT || new Set(metricIds).size !== metricIds.length) {
        fail('INVALID_FILTER', `metricIds must contain at most ${MAX_METRIC_LIMIT} unique IDs.`);
      }
      for (const id of metricIds) assertStringOrUndefined(id, 'metricIds[]');
    }
    const allowed = metricIds === undefined ? null : new Set(metricIds);
    const metrics = this.snapshot.metrics
      .filter(metric => allowed === null || allowed.has(metric.metric_id))
      .sort((left, right) => left.metric_id.localeCompare(right.metric_id));
    if (allowed && metrics.length !== allowed.size) {
      const found = new Set(metrics.map(metric => metric.metric_id));
      fail('UNKNOWN_METRIC', 'At least one requested coverage metric is unknown.', { unknown: [...allowed].filter(id => !found.has(id)) });
    }
    const offset = offsetFromCursor(cursor, this.snapshot.immutability.canonical_digest);
    const result = page(metrics, { offset, limit: resolvedLimit, snapshotDigest: this.snapshot.immutability.canonical_digest });
    abortIfNeeded(signal);
    return envelope(this, 'get_coverage_metrics', result);
  }

  getMatrix({ jurisdictionId, sourceClassId, states, cursor, limit, expectedSnapshotId, signal } = {}) {
    abortIfNeeded(signal);
    this.#assertExpectedSnapshot(expectedSnapshotId);
    assertStringOrUndefined(jurisdictionId, 'jurisdictionId');
    assertStringOrUndefined(sourceClassId, 'sourceClassId');
    if (states !== undefined) {
      if (!Array.isArray(states) || states.length === 0 || states.length > CANONICAL_COVERAGE_CELL_STATES.length || new Set(states).size !== states.length) {
        fail('INVALID_FILTER', 'states must be a non-empty unique subset of the canonical coverage states.');
      }
      for (const state of states) if (!CANONICAL_COVERAGE_CELL_STATES.includes(state)) fail('INVALID_FILTER', `Unknown coverage state: ${state}`);
    }
    const allowedStates = states === undefined ? null : new Set(states);
    const cells = this.matrix.cells
      .filter(cell => jurisdictionId === undefined || cell.jurisdiction_id === jurisdictionId)
      .filter(cell => sourceClassId === undefined || cell.source_class_id === sourceClassId)
      .filter(cell => allowedStates === null || allowedStates.has(cell.coverage_cell_state))
      .map(cell => {
        const detail = this.cellDetails.get(cell.cell_id);
        if (!detail) fail('ARTIFACT_PIN_MISMATCH', `Missing registry detail for ${cell.cell_id}`);
        return {
          ...clone(cell),
          jurisdiction_name: detail.jurisdiction_name,
          jurisdiction_postal: detail.jurisdiction_postal,
          source_class_label: detail.source_class_label,
          agency_operator: clone(detail.agency_operator),
          denominator_type: detail.scope.denominator_type,
          denominator_definition: detail.scope.definition,
          connector_disposition: detail.disposition.connector,
          manual_review_disposition: detail.disposition.manual_review,
          evidence_grain: detail.evidence.cell_grain_evidence_state,
          legacy_aggregate_status: detail.evidence.legacy_aggregate_readiness_status,
          legacy_status_promotable_to_cell: false
        };
      })
      .sort((left, right) => left.cell_id.localeCompare(right.cell_id));
    const resolvedLimit = integerLimit(limit, DEFAULT_LIMIT, MAX_MATRIX_LIMIT);
    const offset = offsetFromCursor(cursor, this.snapshot.immutability.canonical_digest);
    const result = {
      denominator: clone(this.matrix.denominator),
      filters: {
        jurisdiction_id: jurisdictionId ?? null,
        source_class_id: sourceClassId ?? null,
        states: states ?? null
      },
      ...page(cells, { offset, limit: resolvedLimit, snapshotDigest: this.snapshot.immutability.canonical_digest })
    };
    abortIfNeeded(signal);
    return envelope(this, 'get_coverage_matrix', result, [
      'A matrix cell is an assessment unit, not a source, record, or asset count.',
      'Legacy jurisdiction-level readiness is shown only as non-promotable provenance.'
    ]);
  }

  getFederalSources({ cursor, limit, expectedSnapshotId, signal } = {}) {
    abortIfNeeded(signal);
    this.#assertExpectedSnapshot(expectedSnapshotId);
    const resolvedLimit = integerLimit(limit, 14, 14);
    const offset = offsetFromCursor(cursor, this.snapshot.immutability.canonical_digest);
    const sources = [...this.federalRegistry.sources].sort((left, right) => left.record_id.localeCompare(right.record_id));
    const result = {
      applicability: clone(this.federalRegistry.applicability),
      ...page(sources, { offset, limit: resolvedLimit, snapshotDigest: this.snapshot.immutability.canonical_digest })
    };
    abortIfNeeded(signal);
    return envelope(this, 'get_federal_coverage_sources', result, [
      'Live-metadata validation confirms a scoped catalog or landing route only; it does not prove payload access or research fitness.'
    ]);
  }
}
