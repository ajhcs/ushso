import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { ROOT, publishImmutable, readJson, recordId, requireFixture, sha256Bytes, sha256File, stableJson } from './common.mjs';
import { loadSchemas, schemaError } from './schema.mjs';
import { semanticErrors } from './semantics.mjs';

async function readJsonl(file) {
  const rows = [];
  const lines = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (rows.length >= 1000) throw new Error('FIXTURE_ROW_LIMIT_EXCEEDED');
    rows.push(JSON.parse(line));
  }
  return rows;
}

export async function buildFixtures() {
  const { ajv } = await loadSchemas();
  const manifestPath = path.join(ROOT, 'fixtures', 'fixture-manifest.json');
  const manifest = await readJson(manifestPath);
  const manifestSchema = await readJson(path.join(ROOT, 'schemas', 'fixture-manifest.schema.json'));
  const validateManifest = ajv.getSchema(manifestSchema.$id);
  if (!validateManifest(manifest)) throw new Error(`FIXTURE_MANIFEST_INVALID: ${schemaError(validateManifest)}`);

  const collections = { objects: [], assertions: [], access: [], evidence: [], relationships: [] };
  const keyByType = { ObservatoryObject: 'objects', Assertion: 'assertions', AccessObservation: 'access', Evidence: 'evidence', Relationship: 'relationships' };
  const outputs = [];
  for (const entry of manifest.files) {
    const source = path.join(ROOT, 'fixtures', entry.path);
    const schema = await readJson(path.join(ROOT, 'schemas', entry.schema));
    const validate = ajv.getSchema(schema.$id);
    const rows = await readJsonl(source);
    for (const row of rows) {
      if (!validate(row)) throw new Error(`FIXTURE_SCHEMA_INVALID ${entry.path} ${recordId(row)}: ${schemaError(validate)}`);
      if (row.entity_type !== entry.entity_type) throw new Error(`FIXTURE_ENTITY_TYPE_MISMATCH: ${entry.path}`);
    }
    rows.sort((a, b) => recordId(a).localeCompare(recordId(b)));
    collections[keyByType[entry.entity_type]].push(...rows);
    const content = rows.map(row => `${stableJson(row)}\n`).join('');
    const outputPath = `bundle/${entry.path}`;
    await publishImmutable(path.join(ROOT, outputPath), content);
    outputs.push({ path: outputPath, record_count: rows.length, sha256: sha256Bytes(content) });
  }
  const projection = await readJson(path.join(ROOT, 'examples', 'denormalized-search-view-projection.json'));
  const projectionSchema = await readJson(path.join(ROOT, 'schemas', 'search-view-projection.schema.json'));
  const validateProjection = ajv.getSchema(projectionSchema.$id);
  if (!validateProjection(projection)) throw new Error(`PROJECTION_INVALID: ${schemaError(validateProjection)}`);
  const semantics = semanticErrors(collections, projection);
  if (semantics.length) throw new Error(`FIXTURE_SEMANTICS_INVALID: ${semantics.join('; ')}`);
  outputs.sort((a, b) => a.path.localeCompare(b.path));
  const receipt = {
    receipt_version: 'observatory-core-build.v1',
    contract_version: 'observatory-core-contract.v1.0.0',
    mode: 'fixture',
    offline: true,
    network_used: false,
    payloads_included: false,
    fixture_manifest_sha256: await sha256File(manifestPath),
    outputs,
    immutable: true
  };
  const receiptSchema = await readJson(path.join(ROOT, 'schemas', 'build-receipt.schema.json'));
  const validateReceipt = ajv.getSchema(receiptSchema.$id);
  if (!validateReceipt(receipt)) throw new Error(`BUILD_RECEIPT_INVALID: ${schemaError(validateReceipt)}`);
  await publishImmutable(path.join(ROOT, 'receipts', 'fixture-build.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

if (process.argv[1]?.endsWith('build-fixtures.mjs')) {
  try {
    requireFixture(process.argv.slice(2));
    const receipt = await buildFixtures();
    process.stdout.write(`${JSON.stringify({ valid: true, outputs: receipt.outputs }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
