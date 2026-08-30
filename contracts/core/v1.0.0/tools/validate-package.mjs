import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { EXCLUDES } from './build-manifest.mjs';
import { ROOT, exists, publishImmutable, readJson, recordId, sha256File, stableJson, walkFiles } from './common.mjs';
import { loadSchemas, schemaError } from './schema.mjs';
import { semanticErrors } from './semantics.mjs';

async function readJsonl(file) {
  const rows = [];
  const reader = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) rows.push(JSON.parse(line));
  return rows;
}

async function validateManifest(ajv, errors) {
  const file = path.join(ROOT, 'manifests', 'package-manifest.json');
  if (!await exists(file)) return false;
  const manifest = await readJson(file);
  const schema = await readJson(path.join(ROOT, 'schemas', 'package-manifest.schema.json'));
  const validate = ajv.getSchema(schema.$id);
  if (!validate(manifest)) errors.push(`package manifest: ${schemaError(validate)}`);
  const actual = (await walkFiles(ROOT)).filter(relative => !EXCLUDES.includes(relative));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files.map(row => row.path))) errors.push('package manifest path inventory mismatch');
  for (const row of manifest.files) {
    const target = path.join(ROOT, row.path);
    const stat = await fs.stat(target);
    if (stat.size !== row.bytes) errors.push(`package manifest bytes mismatch: ${row.path}`);
    if (await sha256File(target) !== row.sha256) errors.push(`package manifest hash mismatch: ${row.path}`);
  }
  return true;
}

export async function validatePackage({ writeReceipt = false } = {}) {
  const errors = [];
  const { ajv, rows: schemas } = await loadSchemas();
  const fixtureManifest = await readJson(path.join(ROOT, 'fixtures', 'fixture-manifest.json'));
  const fixtureManifestSchema = await readJson(path.join(ROOT, 'schemas', 'fixture-manifest.schema.json'));
  const validateFixtureManifest = ajv.getSchema(fixtureManifestSchema.$id);
  if (!validateFixtureManifest(fixtureManifest)) errors.push(`fixture manifest: ${schemaError(validateFixtureManifest)}`);
  const collections = { objects: [], assertions: [], access: [], evidence: [], relationships: [] };
  const counts = {};
  const keyByType = { ObservatoryObject: 'objects', Assertion: 'assertions', AccessObservation: 'access', Evidence: 'evidence', Relationship: 'relationships' };
  for (const entry of fixtureManifest.files) {
    const schema = await readJson(path.join(ROOT, 'schemas', entry.schema));
    const validate = ajv.getSchema(schema.$id);
    const sourceRows = await readJsonl(path.join(ROOT, 'fixtures', entry.path));
    const bundleFile = path.join(ROOT, 'bundle', entry.path);
    const bundleRows = await readJsonl(bundleFile);
    for (const row of [...sourceRows, ...bundleRows]) if (!validate(row)) errors.push(`${entry.path} ${recordId(row)}: ${schemaError(validate)}`);
    const canonical = [...sourceRows].sort((a, b) => recordId(a).localeCompare(recordId(b))).map(row => `${stableJson(row)}\n`).join('');
    if (await fs.readFile(bundleFile, 'utf8') !== canonical) errors.push(`${entry.path}: bundle is not the deterministic canonical projection of fixtures`);
    collections[keyByType[entry.entity_type]].push(...bundleRows);
    counts[entry.entity_type] = bundleRows.length;
  }
  const projection = await readJson(path.join(ROOT, 'examples', 'denormalized-search-view-projection.json'));
  const projectionSchema = await readJson(path.join(ROOT, 'schemas', 'search-view-projection.schema.json'));
  const validateProjection = ajv.getSchema(projectionSchema.$id);
  if (!validateProjection(projection)) errors.push(`search projection: ${schemaError(validateProjection)}`);
  errors.push(...semanticErrors(collections, projection));
  const buildReceipt = await readJson(path.join(ROOT, 'receipts', 'fixture-build.json'));
  const buildSchema = await readJson(path.join(ROOT, 'schemas', 'build-receipt.schema.json'));
  const validateBuild = ajv.getSchema(buildSchema.$id);
  if (!validateBuild(buildReceipt)) errors.push(`build receipt: ${schemaError(validateBuild)}`);
  if (buildReceipt.fixture_manifest_sha256 !== await sha256File(path.join(ROOT, 'fixtures', 'fixture-manifest.json'))) errors.push('build receipt fixture manifest hash mismatch');
  for (const output of buildReceipt.outputs) if (output.sha256 !== await sha256File(path.join(ROOT, output.path))) errors.push(`build receipt hash mismatch: ${output.path}`);
  const packageManifestChecked = await validateManifest(ajv, errors);
  const report = {
    report_version: 'observatory-core-validation.v1',
    contract_version: 'observatory-core-contract.v1.0.0',
    offline: true,
    valid: errors.length === 0,
    schema_count: schemas.length,
    record_counts: counts,
    checks: ['strict-draft-2020-12', 'all-typed-roles', 'exact-native-id-preservation', 'referential-integrity', 'evidence-linkage', 'no-payload-keys', 'bidirectional-supersession', 'supersession-acyclic', 'identity-candidates-not-merged', 'access-state-separation', 'search-view-not-source-truth', 'deterministic-bundle', 'build-receipt-hashes', ...(packageManifestChecked ? ['package-manifest-hashes'] : [])],
    errors,
    package_manifest_checked: packageManifestChecked
  };
  const reportSchema = await readJson(path.join(ROOT, 'schemas', 'validation-report.schema.json'));
  const validateReport = ajv.getSchema(reportSchema.$id);
  if (!validateReport(report)) throw new Error(`VALIDATION_RECEIPT_INVALID: ${schemaError(validateReport)}`);
  if (writeReceipt) await publishImmutable(path.join(ROOT, 'validation', 'validation-receipt.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1]?.endsWith('validate-package.mjs')) {
  try { const report = await validatePackage({ writeReceipt: process.argv.includes('--write-receipt') }); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.valid) process.exitCode = 1; }
  catch (error) { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; }
}
