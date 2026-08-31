import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PACKAGE_ROOT,
  canonicalJsonSha256,
  compareCanonical,
  pathExists,
  publishImmutable,
  readJson,
  sha256File,
  walkFiles
} from './common.mjs';
import { computeManifest, MANIFEST_EXCLUDES } from './build-manifest.mjs';
import { loadSchemas, validationMessage } from './schema.mjs';
import { applyAdversarialMutations, stateCoverage, validateIdentityBundle } from './semantics.mjs';

const COLLECTION_SCHEMAS = {
  namespaces: 'identifier-namespace.schema.json',
  identifier_assertions: 'identifier-assertion.schema.json',
  candidates: 'identity-candidate.schema.json',
  review_decisions: 'review-decision.schema.json',
  relationship_projections: 'relationship-projection.schema.json',
  families: 'family.schema.json',
  family_memberships: 'family-membership.schema.json',
  transformation_steps: 'transformation-step.schema.json',
  join_routes: 'join-route.schema.json',
  reversal_plans: 'reversal-plan.schema.json'
};

const EXPECTED_COVERAGE = {
  candidate_states: ['accepted', 'deferred', 'open', 'rejected', 'superseded'],
  decision_kinds: ['defer', 'family_member', 'mirror_of', 'needs_more_evidence', 'not_same_identity', 'same_identity', 'successor_of'],
  family_kinds: ['collection', 'format', 'mirror', 'successor', 'version'],
  operation_kinds: ['aggregate', 'crosswalk', 'filter', 'join', 'measure_harmonization', 'temporal_alignment'],
  evidence_states: ['ambiguous', 'candidate', 'documented', 'executed', 'observed', 'proven', 'unknown'],
  compatibilities: ['compatible', 'conditional', 'incompatible', 'unknown'],
  requirement_states: ['not_applicable', 'satisfied', 'unknown', 'unsatisfied']
};

function push(errors, code, detail) {
  errors.push(`${code}:${detail}`);
}

function fixtureId(record) {
  return Object.entries(record).find(([key]) => key.endsWith('_id'))?.[1] ?? 'record';
}

function validateFixtureEnvelope(bundle, adversarial, errors) {
  const bundleKeys = ['fixture_purpose', 'fixture_version', ...Object.keys(COLLECTION_SCHEMAS)].sort();
  if (!compareCanonical(Object.keys(bundle).sort(), bundleKeys)) push(errors, 'VALID_BUNDLE_ENVELOPE_INVALID', Object.keys(bundle).sort().join(','));
  if (bundle.fixture_version !== 'identity.valid-bundle.v1.0.0') push(errors, 'VALID_BUNDLE_VERSION_INVALID', String(bundle.fixture_version));
  if (typeof bundle.fixture_purpose !== 'string' || bundle.fixture_purpose.length < 20) push(errors, 'VALID_BUNDLE_PURPOSE_INVALID', 'fixture_purpose');
  if (!compareCanonical(Object.keys(adversarial).sort(), ['cases', 'fixture_version'])) push(errors, 'ADVERSARIAL_ENVELOPE_INVALID', Object.keys(adversarial).sort().join(','));
  if (adversarial.fixture_version !== 'identity.adversarial-cases.v1.0.0') push(errors, 'ADVERSARIAL_VERSION_INVALID', String(adversarial.fixture_version));
  const ids = new Set();
  for (const testCase of adversarial.cases) {
    if (ids.has(testCase.case_id)) push(errors, 'DUPLICATE_ADVERSARIAL_CASE', testCase.case_id);
    ids.add(testCase.case_id);
    if (!compareCanonical(Object.keys(testCase).sort(), ['case_id', 'description', 'expected_code', 'mutations'])) push(errors, 'ADVERSARIAL_CASE_ENVELOPE_INVALID', testCase.case_id);
    if (!Array.isArray(testCase.mutations) || testCase.mutations.length === 0) push(errors, 'ADVERSARIAL_CASE_MUTATIONS_MISSING', testCase.case_id);
  }
}

async function validatorsByCollection(ajv, schemas) {
  const validators = {};
  for (const [collection, schemaName] of Object.entries(COLLECTION_SCHEMAS)) {
    const entry = schemas.find(item => item.name === schemaName);
    if (!entry) throw new Error(`SCHEMA_NOT_FOUND:${schemaName}`);
    validators[collection] = ajv.getSchema(entry.schema.$id);
  }
  return validators;
}

function validateBundleSchemas(bundle, validators) {
  const failures = [];
  let checked = 0;
  for (const [collection, validate] of Object.entries(validators)) {
    for (const record of bundle[collection] ?? []) {
      checked += 1;
      if (!validate(record)) failures.push(`${collection}:${fixtureId(record)}:${validationMessage(validate)}`);
    }
  }
  return { checked, failures };
}

async function validateManifest(ajv, errors) {
  const target = path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json');
  if (!await pathExists(target)) {
    push(errors, 'MANIFEST_MISSING', 'manifests/package-manifest.json');
    return { verified: false, byteSha256: null, payloadDigest: null, positive: 0 };
  }
  const stored = await readJson(target);
  const validate = ajv.getSchema('https://ushso.local/contracts/identity/v1.0.0/package-manifest.schema.json');
  if (!validate(stored)) push(errors, 'MANIFEST_SCHEMA_INVALID', validationMessage(validate));
  const computed = await computeManifest();
  if (!compareCanonical(stored, computed)) push(errors, 'MANIFEST_CONTENT_MISMATCH', 'stored manifest differs from deterministic recomputation');
  const physical = (await walkFiles(PACKAGE_ROOT)).filter(relative => !MANIFEST_EXCLUDES.includes(relative));
  if (!compareCanonical(stored.files.map(file => file.path), physical)) push(errors, 'MANIFEST_FILE_SET_MISMATCH', `${stored.files.length}:${physical.length}`);
  return {
    verified: compareCanonical(stored, computed) && validate(stored),
    byteSha256: await sha256File(target),
    payloadDigest: stored.package_payload_digest_sha256,
    positive: stored.files.length + 4
  };
}

export async function loadFixtureBundle() {
  const bundle = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-bundle.json'));
  const adversarial = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'adversarial-cases.json'));
  return { bundle, adversarial };
}

export async function runAdversarialCases(bundle, adversarial, validators) {
  const results = [];
  for (const testCase of adversarial.cases) {
    const mutated = applyAdversarialMutations(bundle, testCase.mutations);
    const schema = validateBundleSchemas(mutated, validators);
    const observedCodes = schema.failures.length > 0
      ? ['SCHEMA_INVALID']
      : [...new Set(validateIdentityBundle(mutated).map(error => error.code))].sort();
    results.push({
      case_id: testCase.case_id,
      expected_code: testCase.expected_code,
      observed_codes: observedCodes,
      passed: observedCodes.includes(testCase.expected_code)
    });
  }
  return results;
}

export async function validatePackage({ writeReceipt = false } = {}) {
  const errors = [];
  let positive = 0;
  const { ajv, schemas } = await loadSchemas();
  const validators = await validatorsByCollection(ajv, schemas);
  const { bundle, adversarial } = await loadFixtureBundle();
  validateFixtureEnvelope(bundle, adversarial, errors);
  if (errors.length === 0) positive += 2;

  const schema = validateBundleSchemas(bundle, validators);
  for (const failure of schema.failures) push(errors, 'SCHEMA_INVALID', failure);
  positive += schema.checked - schema.failures.length;

  const semanticErrors = validateIdentityBundle(bundle);
  for (const error of semanticErrors) push(errors, error.code, error.detail);
  if (semanticErrors.length === 0) positive += 1;

  const coverage = stateCoverage(bundle);
  for (const [axis, expected] of Object.entries(EXPECTED_COVERAGE)) if (!compareCanonical(coverage[axis], expected)) push(errors, 'STATE_COVERAGE_INCOMPLETE', `${axis}:${coverage[axis].join(',')}`);
  if (!errors.some(error => error.startsWith('STATE_COVERAGE_INCOMPLETE:'))) positive += Object.keys(EXPECTED_COVERAGE).length;

  const adversarialResults = await runAdversarialCases(bundle, adversarial, validators);
  for (const result of adversarialResults) if (!result.passed) push(errors, 'ADVERSARIAL_CASE_FAILED', `${result.case_id}:${result.expected_code}:${result.observed_codes.join(',')}`);
  positive += adversarialResults.filter(result => result.passed).length;

  const manifest = await validateManifest(ajv, errors);
  positive += manifest.positive;
  const fixtureRecordCount = Object.keys(COLLECTION_SCHEMAS).reduce((total, collection) => total + bundle[collection].length, 0);
  const validationInputDigest = canonicalJsonSha256({
    validator_version: '1.0.0',
    valid_bundle: canonicalJsonSha256(bundle),
    adversarial_cases: canonicalJsonSha256(adversarial),
    manifest_byte_sha256: manifest.byteSha256,
    package_payload_digest_sha256: manifest.payloadDigest
  });

  const report = {
    receipt_version: 'identity.validation-receipt.v1',
    package_version: '1.0.0',
    mode: 'fixture_offline',
    offline: true,
    valid: errors.length === 0,
    schema_count: schemas.length,
    fixture_record_count: fixtureRecordCount,
    positive_check_count: positive,
    adversarial_check_count: adversarialResults.length,
    adversarial_pass_count: adversarialResults.filter(result => result.passed).length,
    failed_count: errors.length,
    state_coverage: coverage,
    manifest_verified: manifest.verified,
    manifest_byte_sha256: manifest.byteSha256,
    package_payload_digest_sha256: manifest.payloadDigest,
    validation_input_digest_sha256: validationInputDigest,
    external_requests: 0,
    source_payload_downloads: 0,
    identity_merges_performed: false,
    analysis_executed: false,
    production_auto_resolution_authorized: false,
    checks: [
      'json-schema-2020-12-strict-compilation',
      'unexpected-property-rejection',
      'namespace-authority-entity-grain-reuse-effective-date-policy',
      'sealed-benchmark-auto-resolution-gate',
      'canonical-candidate-pair-and-separate-score-confidence',
      'append-only-review-and-supersession-acyclicity',
      'identity-family-join-graph-separation',
      'temporal-identity-snapshot-applicability',
      'exact-release-schema-field-bound-join-routes',
      'orthogonal-operation-evidence-compatibility-requirement-blocker-axes',
      'candidate-route-no-documentation-upgrade',
      'crosswalk-not-aggregation',
      'non-public-execution-evidence-context',
      'deterministic-reversal-reconstruction-without-deletion',
      'deterministic-byte-and-canonical-json-digest-taxonomy'
    ],
    errors,
    immutable: true
  };

  const receiptValidate = ajv.getSchema('https://ushso.local/contracts/identity/v1.0.0/validation-receipt.schema.json');
  if (!receiptValidate(report)) throw new Error(`VALIDATION_RECEIPT_SCHEMA_INVALID:${validationMessage(receiptValidate)}`);
  const receiptPath = path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json');
  if (writeReceipt) {
    if (!report.valid) throw new Error(`PACKAGE_VALIDATION_FAILED:${report.errors.join(';')}`);
    if (await pathExists(receiptPath)) {
      const stored = await readJson(receiptPath);
      if (!compareCanonical(stored, report)) throw new Error('VALIDATION_RECEIPT_ALREADY_EXISTS_AND_DIFFERS:publish a new contract version');
    } else await publishImmutable(receiptPath, `${JSON.stringify(report, null, 2)}\n`);
  } else if (await pathExists(receiptPath)) {
    const stored = await readJson(receiptPath);
    if (!receiptValidate(stored)) push(errors, 'STORED_RECEIPT_SCHEMA_INVALID', validationMessage(receiptValidate));
    else if (!compareCanonical(stored, report)) push(errors, 'STORED_RECEIPT_STALE', 'validation/validation-receipt.json');
    report.valid = errors.length === 0;
    report.failed_count = errors.length;
    report.errors = errors;
  }
  return { report, adversarialResults };
}

if (process.argv[1]?.endsWith('validate-package.mjs')) {
  validatePackage({ writeReceipt: process.argv.includes('--write-receipt') })
    .then(({ report }) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.valid) process.exitCode = 1;
    })
    .catch(error => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
