import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKAGE_ROOT,
  applyMutations,
  canonicalJson,
  readJson,
  sha256File,
  walkFiles,
  writeJson
} from './common.mjs';
import { loadSchemas, validationMessage, validatorFor } from './schema.mjs';
import { CANONICAL_COVERAGE_CELL_STATES, validateCoverageBundle, validateDigestTaxonomy } from './semantics.mjs';

async function schemaErrorsForBundle(fixture) {
  const validators = {
    sourceScope: await validatorFor('source-scope.schema.json'),
    stageFact: await validatorFor('stage-fact.schema.json'),
    snapshot: await validatorFor('coverage-snapshot.schema.json'),
    matrix: await validatorFor('coverage-matrix.schema.json')
  };
  const errors = [];
  for (const [index, scope] of fixture.source_scopes.entries()) {
    if (!validators.sourceScope(scope)) errors.push(`/source_scopes/${index} ${validationMessage(validators.sourceScope)}`);
  }
  for (const [index, fact] of fixture.stage_facts.entries()) {
    if (!validators.stageFact(fact)) errors.push(`/stage_facts/${index} ${validationMessage(validators.stageFact)}`);
  }
  if (!validators.snapshot(fixture.snapshot)) errors.push(`/snapshot ${validationMessage(validators.snapshot)}`);
  if (!validators.matrix(fixture.matrix)) errors.push(`/matrix ${validationMessage(validators.matrix)}`);
  return errors;
}

async function verifyManifest() {
  const errors = [];
  const manifestPath = path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json');
  const manifest = await readJson(manifestPath);
  const validate = await validatorFor('package-manifest.schema.json');
  if (!validate(manifest)) errors.push(`PACKAGE_MANIFEST_SCHEMA:${validationMessage(validate)}`);
  const excluded = new Set(['manifests/package-manifest.json', 'validation/validation-receipt.json']);
  const physical = (await walkFiles(PACKAGE_ROOT)).filter(file => !excluded.has(file));
  const listed = manifest.files.map(file => file.path);
  if (canonicalJson(physical) !== canonicalJson(listed)) errors.push('PACKAGE_MANIFEST_FILE_SET_MISMATCH');
  for (const entry of manifest.files) {
    const file = path.join(PACKAGE_ROOT, entry.path);
    try {
      const stat = await fs.stat(file);
      if (stat.size !== entry.bytes) errors.push(`PACKAGE_MANIFEST_BYTE_MISMATCH:${entry.path}`);
      if (await sha256File(file) !== entry.sha256) errors.push(`PACKAGE_MANIFEST_DIGEST_MISMATCH:${entry.path}`);
    } catch (error) {
      errors.push(`PACKAGE_MANIFEST_FILE_MISSING:${entry.path}:${error.code ?? error.message}`);
    }
  }
  return { errors, manifestPath };
}

export async function validatePackage() {
  const definitions = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'metric-definitions.json'));
  const taxonomy = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'digest-taxonomy.json'));
  const fixture = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-package.json'));
  const adversarial = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'adversarial-cases.json'));
  const { schemas } = await loadSchemas();
  const errors = [];

  const definitionValidator = await validatorFor('metric-definitions.schema.json');
  if (!definitionValidator(definitions)) errors.push(`METRIC_DEFINITIONS_SCHEMA:${validationMessage(definitionValidator)}`);
  const taxonomyValidator = await validatorFor('digest-taxonomy.schema.json');
  if (!taxonomyValidator(taxonomy)) errors.push(`DIGEST_TAXONOMY_SCHEMA:${validationMessage(taxonomyValidator)}`);
  else errors.push(...validateDigestTaxonomy(taxonomy).map(error => `${error.code}:${error.path}:${error.detail}`));
  const bundleSchemaErrors = await schemaErrorsForBundle(fixture);
  errors.push(...bundleSchemaErrors.map(error => `VALID_FIXTURE_SCHEMA:${error}`));
  if (bundleSchemaErrors.length === 0) {
    errors.push(...validateCoverageBundle(definitions, fixture, { requireAllCanonicalStates: true }).map(error => `${error.code}:${error.path}:${error.detail}`));
  }

  const adversarialResults = [];
  for (const adversarialCase of adversarial.cases) {
    const mutated = applyMutations(fixture, adversarialCase.mutations);
    const schemaErrors = await schemaErrorsForBundle(mutated);
    const codes = schemaErrors.length > 0
      ? ['SCHEMA_INVALID']
      : validateCoverageBundle(definitions, mutated, { requireAllCanonicalStates: true }).map(error => error.code);
    adversarialResults.push({
      id: adversarialCase.id,
      expected_code: adversarialCase.expected_code,
      observed_codes: [...new Set(codes)].sort(),
      passed: codes.includes(adversarialCase.expected_code)
    });
  }
  for (const result of adversarialResults) if (!result.passed) errors.push(`ADVERSARIAL_CASE_NOT_REJECTED:${result.id}:${result.expected_code}:${result.observed_codes.join(',')}`);

  const manifestResult = await verifyManifest();
  errors.push(...manifestResult.errors);
  const partitionDefinitions = definitions.definitions.filter(definition => definition.partition !== null);
  const report = {
    receipt_version: '1.0.0',
    package: '@ushso/coverage-contract',
    package_version: '1.0.0',
    validated_at: new Date().toISOString(),
    valid: errors.length === 0,
    schema_count: schemas.length,
    metric_definition_count: definitions.definitions.length,
    metric_instance_count: fixture.snapshot.metrics.length,
    membership_manifest_count: fixture.snapshot.membership_manifests.length,
    source_scope_count: fixture.source_scopes.length,
    stage_fact_count: fixture.stage_facts.length,
    matrix_cell_count: fixture.matrix.cells.length,
    canonical_coverage_cell_states: CANONICAL_COVERAGE_CELL_STATES,
    adversarial_case_count: adversarialResults.length,
    adversarial_cases_rejected: adversarialResults.filter(result => result.passed).length,
    partition_equations_verified: partitionDefinitions.length,
    external_requests: 0,
    errors,
    package_manifest_sha256: await sha256File(manifestResult.manifestPath)
  };
  const receiptValidator = await validatorFor('validation-receipt.schema.json');
  if (!receiptValidator(report)) {
    report.valid = false;
    report.errors.push(`VALIDATION_RECEIPT_SCHEMA:${validationMessage(receiptValidator)}`);
  }
  return { report, adversarialResults };
}

async function main() {
  const { report, adversarialResults } = await validatePackage();
  if (process.argv.includes('--write-receipt')) {
    await writeJson(path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json'), report);
  }
  process.stdout.write(`${JSON.stringify({ ...report, adversarial_results: adversarialResults }, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
