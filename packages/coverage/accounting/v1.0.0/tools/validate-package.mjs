import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalDigest,
  canonicalJson,
  sha256File
} from '../../../../../contracts/coverage/v1.0.0/tools/common.mjs';
import { validatorFor, validationMessage } from '../../../../../contracts/coverage/v1.0.0/tools/schema.mjs';
import {
  CANONICAL_COVERAGE_CELL_STATES,
  validateCoverageBundle
} from '../../../../../contracts/coverage/v1.0.0/tools/semantics.mjs';
import { assertDenominatorInvariants, assessAbsenceClaim } from '../src/accounting.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../../../..');

async function readPackage(relative) {
  return JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, relative), 'utf8'));
}

async function readRepo(relative) {
  return JSON.parse(await fs.readFile(path.join(REPO_ROOT, relative), 'utf8'));
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

async function validateSchema(name, values) {
  const validator = await validatorFor(name);
  for (const [index, value] of values.entries()) {
    if (!validator(value)) throw new Error(`SCHEMA_INVALID:${name}:${index}:${validationMessage(validator)}`);
  }
}

export async function validatePackage() {
  const definitionRegistry = await readPackage('artifacts/denominator-definition-registry.json');
  const definitions = await readRepo('contracts/coverage/v1.0.0/contracts/metric-definitions.json');
  const sourceScopes = await readPackage('artifacts/source-scopes.json');
  const stageFacts = await readPackage('artifacts/stage-facts.json');
  const snapshot = await readPackage('artifacts/coverage-snapshot.json');
  const matrix = await readPackage('artifacts/coverage-matrix.json');
  const cellRegistry = await readPackage('artifacts/state-source-class-cell-registry.json');
  const jurisdictionRegistry = await readPackage('artifacts/jurisdiction-registry.json');
  const sourceClasses = await readPackage('registry/source-classes.v1.0.0.json');
  const federalRegistry = await readPackage('artifacts/federal-source-registry.json');
  const corpus = await readPackage('artifacts/corpus-positioning-manifest.json');
  const publicView = await readPackage('artifacts/public-coverage-view.json');
  const publicCopy = await readPackage('fixtures/public-copy-audit.v1.0.0.json');
  const stateFixture = await readPackage('fixtures/coverage-cell-state-conformance.json');
  const invariantFixture = await readPackage('fixtures/denominator-invariants.json');
  const manifest = await readPackage('manifests/generated-artifact-manifest.json');
  const provenance = await readPackage('registry/evidence-provenance.v1.0.0.json');

  assert(canonicalJson(definitionRegistry.definitions_document) === canonicalJson(definitions), 'DENOMINATOR_DEFINITION_TRUTH_DRIFT');
  assert(definitionRegistry.canonical_definition_digest === canonicalDigest('ushso:canonical-json:v1\n', definitions), 'DENOMINATOR_DEFINITION_DIGEST_MISMATCH');
  await validateSchema('source-scope.schema.json', sourceScopes);
  await validateSchema('stage-fact.schema.json', stageFacts);
  await validateSchema('coverage-snapshot.schema.json', [snapshot]);
  await validateSchema('coverage-matrix.schema.json', [matrix]);

  const semanticErrors = validateCoverageBundle(definitions, { source_scopes: sourceScopes, stage_facts: stageFacts, snapshot, matrix });
  assert(semanticErrors.length === 0, `COVERAGE_SEMANTIC_ERRORS:${JSON.stringify(semanticErrors)}`);

  assert(sourceScopes.length === 14 && sourceScopes.every(scope => scope.registry_state === 'unassessed'), 'SOURCE_SCOPE_SEED_OVERCLAIM');
  assert(sourceScopes.every(scope => scope.enumeration.status === 'never_started' && !scope.absence_claim_permitted), 'SOURCE_SCOPE_ABSENCE_OVERCLAIM');
  assert(stageFacts.length === 14 && stageFacts.every(fact => fact.stage === 'registry' && fact.outcome === 'unassessed'), 'STAGE_FACT_SCOPE_DRIFT');
  assert(jurisdictionRegistry.jurisdictions.length === 51, 'JURISDICTION_REGISTRY_COUNT_MISMATCH');
  assert(sourceClasses.classes.length === 6, 'SOURCE_CLASS_REGISTRY_COUNT_MISMATCH');
  assert(cellRegistry.cells.length === 306 && matrix.cells.length === 306, 'MATRIX_CELL_COUNT_MISMATCH');
  assert(new Set(matrix.cells.map(cell => `${cell.jurisdiction_id}\u0000${cell.source_class_id}`)).size === 306, 'MATRIX_CELL_NOT_UNIQUE');
  assert(matrix.cells.every(cell => cell.coverage_cell_state === 'not_assessed'), 'UNSUPPORTED_MATRIX_STATE_PROMOTION');
  assert(matrix.cells.every(cell => !cell.absence_claim_permitted && cell.absence_reason === 'scope_not_assessed'), 'MATRIX_ABSENCE_OVERCLAIM');
  assert(cellRegistry.cells.every(cell => cell.agency_operator.status === 'not_identified'), 'UNSUPPORTED_AGENCY_OPERATOR_CLAIM');
  assert(cellRegistry.cells.every(cell => cell.evidence.legacy_status_promotable_to_cell === false), 'LEGACY_GRAIN_PROMOTION_ENABLED');

  const fixtureStates = stateFixture.states.map(item => item.state);
  assert(canonicalJson(fixtureStates) === canonicalJson(CANONICAL_COVERAGE_CELL_STATES), 'COVERAGE_STATE_TAXONOMY_DRIFT');
  assert(stateFixture.production_evidence === false, 'SYNTHETIC_STATE_FIXTURE_MARKED_PRODUCTION');
  assertDenominatorInvariants(invariantFixture);
  assert(invariantFixture.production_evidence === false, 'SYNTHETIC_DENOMINATOR_FIXTURE_MARKED_PRODUCTION');
  assert(assessAbsenceClaim({ denominatorStatus: 'unknown', enumerationStatus: 'failed', sealed: false }).permitted === false, 'UNKNOWN_DENOMINATOR_ABSENCE_ALLOWED');
  assert(assessAbsenceClaim({ denominatorStatus: 'known', enumerationStatus: 'incomplete', sealed: false }).reason === 'enumeration_incomplete', 'INCOMPLETE_ENUMERATION_ABSENCE_REASON_DRIFT');

  assert(snapshot.metrics.length === 18 && snapshot.membership_manifests.length === 18, 'METRIC_SET_INCOMPLETE');
  for (const metric of snapshot.metrics) {
    assert(Object.hasOwn(metric, 'numerator_count'), `METRIC_NUMERATOR_MISSING:${metric.metric_id}`);
    assert(Object.hasOwn(metric, 'denominator_count'), `METRIC_DENOMINATOR_MISSING:${metric.metric_id}`);
    assert(typeof metric.unit === 'string', `METRIC_UNIT_MISSING:${metric.metric_id}`);
    assert(typeof metric.denominator_definition === 'string', `METRIC_DEFINITION_MISSING:${metric.metric_id}`);
    assert(metric.as_of === snapshot.as_of, `METRIC_AS_OF_MISMATCH:${metric.metric_id}`);
    assert(metric.revision_pins.coverage_contract_version.value === '1.0.0', `METRIC_REVISION_PIN_MISSING:${metric.metric_id}`);
    if (metric.denominator_status !== 'known' || metric.denominator_count === 0) assert(metric.rate === null, `UNSAFE_RATE:${metric.metric_id}`);
  }
  const normalized = snapshot.metrics.find(metric => metric.metric_id === 'coverage.normalized_outcome/v1');
  assert(normalized.partition_counts.map(item => item.state).join('|') === 'normalized|pending|failed|excluded|not_applicable|unknown', 'NORMALIZATION_PARTITION_DRIFT');
  assert(normalized.partition_counts.reduce((sum, item) => sum + item.count, 0) === normalized.denominator_count, 'NORMALIZATION_PARTITION_NOT_EXHAUSTIVE');
  const configured = snapshot.metrics.find(metric => metric.metric_id === 'coverage.configured_scope_status/v1');
  assert(configured.partition_counts.map(item => item.state).join('|') === 'active|paused|excluded|retired|unassessed', 'CONFIGURED_PARTITION_DRIFT');
  assert(configured.partition_counts.reduce((sum, item) => sum + item.count, 0) === 14, 'CONFIGURED_PARTITION_NOT_EXHAUSTIVE');

  assert(federalRegistry.source_count === 14, 'FEDERAL_SOURCE_COUNT_MISMATCH');
  assert(federalRegistry.applicability.direct === 11 && federalRegistry.applicability.crosswalk_required === 2 && federalRegistry.applicability.unknown === 1, 'FEDERAL_APPLICABILITY_DRIFT');
  assert(corpus.denominator_count === 157 && corpus.unit === 'published_record', 'CORPUS_POSITIONING_DENOMINATOR_DRIFT');
  assert(corpus.composition.reduce((sum, item) => sum + item.count, 0) === 157, 'CORPUS_COMPOSITION_NOT_EXHAUSTIVE');
  assert(publicView.positioning.headline === publicCopy.positioning, 'POSITIONING_COPY_DRIFT');
  assert(publicView.positioning.product_owner_review_status === 'pending_product_owner_review', 'PRODUCT_REVIEW_STATUS_OVERCLAIM');
  assert(publicView.positioning.publication_authorized === false, 'UNAUTHORIZED_PUBLIC_COPY');
  assert(publicView.concepts.map(item => item.unit).join('|') === 'federal_source_scope|jurisdiction_label|coverage_assessment_cell|published_record', 'CONCEPT_UNIT_MIXING');
  assert(publicView.matrix_summary.coverage_cell_state_distribution.not_assessed === 306, 'PUBLIC_MATRIX_DISTRIBUTION_DRIFT');
  assert(publicView.legacy_aggregate_readiness.canonical_for_source_class_matrix === false, 'LEGACY_READINESS_CANONICALIZED');

  for (const entry of manifest.generated_files) {
    const actual = await sha256File(path.join(PACKAGE_ROOT, entry.path));
    assert(actual === entry.sha256, `GENERATED_ARTIFACT_DIGEST_MISMATCH:${entry.path}`);
    assert((await fs.stat(path.join(PACKAGE_ROOT, entry.path))).size === entry.bytes, `GENERATED_ARTIFACT_SIZE_MISMATCH:${entry.path}`);
  }
  assert(manifest.artifact_set_sha256 === canonicalDigest('ushso:coverage-accounting-artifact-set:v1\n', manifest.generated_files), 'ARTIFACT_SET_DIGEST_MISMATCH');
  for (const [relative, expected] of Object.entries(provenance.wp1_byte_pins)) {
    assert(await sha256File(path.join(REPO_ROOT, relative)) === expected, `WP1_BYTE_PIN_MISMATCH:${relative}`);
  }

  return {
    status: 'pass',
    coverage_snapshot_sha256: snapshot.immutability.canonical_digest,
    matrix_membership_sha256: matrix.denominator.membership_manifest_hash,
    artifact_set_sha256: manifest.artifact_set_sha256,
    counts: {
      metrics: snapshot.metrics.length,
      source_scopes: sourceScopes.length,
      jurisdictions: jurisdictionRegistry.jurisdictions.length,
      source_classes: sourceClasses.classes.length,
      cells: matrix.cells.length,
      published_records: corpus.denominator_count
    },
    product_owner_wording_review: publicCopy.approval_status
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await validatePackage())}\n`);
}
