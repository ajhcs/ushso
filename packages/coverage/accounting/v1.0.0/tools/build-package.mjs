import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalDigest,
  sha256File,
  writeJson
} from '../../../../../contracts/coverage/v1.0.0/tools/common.mjs';
import {
  buildCellRegistry,
  buildCorpusPositioningManifest,
  buildCoverageMatrix,
  buildCoverageSnapshot,
  buildFederalSourceRegistry,
  buildJurisdictionRegistry,
  buildPublicCoverageView,
  buildSourceScopes,
  buildStageFacts
} from '../src/accounting.mjs';
import { AS_OF } from '../src/constants.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../../../..');
const ARTIFACT_ROOT = path.join(PACKAGE_ROOT, 'artifacts');

async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(REPO_ROOT, relative), 'utf8'));
}

async function readPackageJson(relative) {
  return JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, relative), 'utf8'));
}

async function readJsonl(relative) {
  const text = await fs.readFile(path.join(REPO_ROOT, relative), 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`INVALID_JSONL:${relative}:${index + 1}:${error.message}`);
    }
  });
}

async function verifyEvidencePins(provenance) {
  const verified = [];
  for (const source of provenance.sources) {
    const actual = await sha256File(path.join(REPO_ROOT, source.path));
    if (actual !== source.sha256) throw new Error(`EVIDENCE_DIGEST_MISMATCH:${source.path}:${actual}:${source.sha256}`);
    verified.push({ evidence_id: source.evidence_id, path: source.path, sha256: actual, status: 'verified' });
  }
  for (const [relative, expected] of Object.entries(provenance.wp1_byte_pins)) {
    const actual = await sha256File(path.join(REPO_ROOT, relative));
    if (actual !== expected) throw new Error(`WP1_BYTE_PIN_MISMATCH:${relative}:${actual}:${expected}`);
    verified.push({ evidence_id: 'wp1-byte-pin', path: relative, sha256: actual, status: 'verified_unchanged' });
  }
  return verified;
}

async function fileEntry(relative) {
  const file = path.join(PACKAGE_ROOT, relative);
  const bytes = (await fs.stat(file)).size;
  return { path: relative, bytes, sha256: await sha256File(file) };
}

export async function buildPackage() {
  const provenance = await readPackageJson('registry/evidence-provenance.v1.0.0.json');
  const sourceClasses = await readPackageJson('registry/source-classes.v1.0.0.json');
  const publicCopy = await readPackageJson('fixtures/public-copy-audit.v1.0.0.json');
  const evidenceVerification = await verifyEvidencePins(provenance);

  const readiness = await readJson('packages/retrieval/readiness/v0.1.0/state-readiness.json');
  const federalRecords = await readJsonl('packages/retrieval/fixtures/national-federal-v0.1.0/records.jsonl');
  const federalObservations = await readJsonl('packages/retrieval/fixtures/national-federal-v0.1.0/access-observations.jsonl');
  const federalValidation = await readJson('packages/retrieval/fixtures/national-federal-v0.1.0/validation-report.json');
  const definitionsDocument = await readJson('contracts/coverage/v1.0.0/contracts/metric-definitions.json');
  const corpusManifest = await readJson('packages/retrieval/versions/v1.1.0/manifests/corpus-manifest.json');
  const corpusRecords = await readJsonl('packages/retrieval/versions/v1.1.0/corpus/records.jsonl');
  const curatedAssets = await readJson('observatory/retrieval/v1.0.0/fixtures/curated-assets.json');

  if (federalObservations.length !== 14) throw new Error(`FEDERAL_OBSERVATION_COUNT_MISMATCH:${federalObservations.length}`);
  if (federalValidation.status !== 'pass_with_scoped_unknowns') throw new Error(`FEDERAL_VALIDATION_STATUS_MISMATCH:${federalValidation.status}`);
  if (federalValidation.counts?.promotion_eligible !== 14) throw new Error('FEDERAL_PROMOTION_ELIGIBLE_COUNT_MISMATCH');
  if (federalValidation.checks?.coverage_cells_run !== false) throw new Error('FEDERAL_FIXTURE_CLAIMS_CELL_ASSESSMENT');

  const jurisdictionRegistry = buildJurisdictionRegistry(readiness);
  const federalRegistry = buildFederalSourceRegistry(federalRecords);
  const sourceScopes = buildSourceScopes(federalRegistry);
  const stageFacts = buildStageFacts(sourceScopes);
  const cellRegistry = buildCellRegistry(jurisdictionRegistry, sourceClasses);
  const matrix = buildCoverageMatrix(cellRegistry);
  const snapshot = buildCoverageSnapshot({ definitionsDocument, sourceScopes, stageFacts });
  const corpusPositioning = buildCorpusPositioningManifest({
    corpusRecords,
    curatedAssetIds: curatedAssets.assets.map(asset => asset.record_id),
    corpusManifest
  });
  const publicView = buildPublicCoverageView({
    snapshot,
    matrix,
    federalRegistry,
    jurisdictionRegistry,
    cellRegistry,
    corpusPositioning,
    publicCopy,
    readiness
  });
  const definitionRegistry = {
    schema_version: 'ushso-coverage-denominator-definition-registry.v1.0.0',
    source_contract: 'contracts/coverage/v1.0.0/contracts/metric-definitions.json',
    source_file_sha256: 'd62e531f980cbb62612b5dc977c9ab6688f58c64c870b75cb189e78e9d45ade9',
    canonical_definition_digest: canonicalDigest('ushso:canonical-json:v1\n', definitionsDocument),
    definitions_document: definitionsDocument,
    shared_truth_rule: 'This embedded document must remain canonically identical to the frozen coverage contract; local overrides are prohibited.'
  };
  const reconciliation = {
    schema_version: 'ushso-wp9-evidence-reconciliation.v1.0.0',
    reconciled_at: AS_OF,
    network_access: false,
    inputs: evidenceVerification,
    findings: [
      {
        finding_id: 'federal-baseline',
        evidence_grain: 'federal_source_record',
        count: 14,
        result: 'retained_as_metadata_validated_source_scopes',
        limitations: ['no payload proof', 'no row-coverage proof', 'no schema-completeness proof', 'no authorization proof', 'no research-fitness proof']
      },
      {
        finding_id: 'jurisdiction-registry',
        evidence_grain: 'jurisdiction_label',
        count: 51,
        result: 'retained_as_registry_membership_only',
        limitations: ['does not imply integration', 'does not imply exhaustive state inventory']
      },
      {
        finding_id: 'state-source-class-matrix',
        evidence_grain: 'jurisdiction_source_class_cell',
        count: 306,
        result: 'all_cells_not_assessed',
        reason: 'No pinned repository artifact establishes the six explicit source classes at jurisdiction/source-class cell grain.',
        prohibited_promotions: ['integrated', 'candidate', 'navigation_only', 'evidence_gap', 'inaccessible', 'unknown']
      },
      {
        finding_id: 'legacy-readiness',
        evidence_grain: 'jurisdiction_aggregate',
        count: 51,
        result: 'preserved_as_noncanonical_provenance',
        reason: 'Jurisdiction aggregate labels cannot be copied into six more granular cells.'
      },
      {
        finding_id: 'production-corpus',
        evidence_grain: 'published_record',
        count: 157,
        result: 'retained_as_separate_non_additive_positioning_unit',
        limitations: ['not canonical asset count', 'not national completeness', 'not state completeness']
      }
    ],
    conflicts: [],
    product_owner_wording_review: 'pending_external_review'
  };

  const artifacts = new Map([
    ['artifacts/denominator-definition-registry.json', definitionRegistry],
    ['artifacts/jurisdiction-registry.json', jurisdictionRegistry],
    ['artifacts/federal-source-registry.json', federalRegistry],
    ['artifacts/source-scopes.json', sourceScopes],
    ['artifacts/stage-facts.json', stageFacts],
    ['artifacts/state-source-class-cell-registry.json', cellRegistry],
    ['artifacts/coverage-matrix.json', matrix],
    ['artifacts/coverage-snapshot.json', snapshot],
    ['artifacts/corpus-positioning-manifest.json', corpusPositioning],
    ['artifacts/public-coverage-view.json', publicView],
    ['artifacts/evidence-reconciliation.json', reconciliation]
  ]);

  await fs.mkdir(ARTIFACT_ROOT, { recursive: true });
  for (const [relative, value] of artifacts) await writeJson(path.join(PACKAGE_ROOT, relative), value);

  const files = [];
  for (const relative of artifacts.keys()) files.push(await fileEntry(relative));
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schema_version: 'ushso-coverage-accounting-artifact-manifest.v1.0.0',
    package_version: '1.0.0',
    generated_at: AS_OF,
    deterministic: true,
    network_access: false,
    generated_files: files,
    artifact_set_sha256: canonicalDigest('ushso:coverage-accounting-artifact-set:v1\n', files),
    coverage_snapshot_sha256: snapshot.immutability.canonical_digest,
    matrix_membership_sha256: matrix.denominator.membership_manifest_hash,
    public_view_sha256: canonicalDigest('ushso:public-coverage-view:v1\n', publicView)
  };
  await writeJson(path.join(PACKAGE_ROOT, 'manifests/generated-artifact-manifest.json'), manifest);
  const manifestBytesSha256 = crypto.createHash('sha256')
    .update(await fs.readFile(path.join(PACKAGE_ROOT, 'manifests/generated-artifact-manifest.json')))
    .digest('hex');
  return {
    status: 'built',
    coverage_snapshot_sha256: manifest.coverage_snapshot_sha256,
    matrix_membership_sha256: manifest.matrix_membership_sha256,
    artifact_set_sha256: manifest.artifact_set_sha256,
    manifest_file_sha256: manifestBytesSha256,
    counts: { source_scopes: 14, jurisdictions: 51, source_classes: 6, cells: 306, published_records: 157, metrics: 18 }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await buildPackage())}\n`);
}
