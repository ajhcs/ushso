import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRetrievalValidators } from '../tools/schema-validation.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const successorPath = path.join(packageRoot, 'schemas/observatory-record-compatibility.v1.0.1.schema.json');
const historicalPath = path.resolve(packageRoot, '../../observatory/index/v1.0.0/schemas/observatory-record.schema.json');
const readJson = async filePath => JSON.parse(await fs.readFile(filePath, 'utf8'));

test('strict compatibility successor validates the frozen record corpus without claiming historical recovery', async () => {
  const schema = await readJson(successorPath);
  const manifest = await readJson(path.join(packageRoot, 'manifests/corpus-manifest.json'));
  const records = (await fs.readFile(path.join(packageRoot, 'corpus/records.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  const { validators, schemaPaths } = await loadRetrievalValidators();

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.match(schema.$id, /observatory-record-compatibility\.v1\.0\.1\.schema\.json$/);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schemaPaths.record, successorPath);
  assert.equal(await fs.stat(historicalPath).then(() => true, () => false), false);
  assert.deepEqual(manifest.schema_pins.observatory_record, {
    path: 'observatory/index/v1.0.0/schemas/observatory-record.schema.json',
    sha256: '2d778a3125ba03c7504aad92e7154fdedf686db66619e439a6259ba883e162d9'
  });
  assert.equal(records.length, 143);
  assert.ok(records.every(record => validators.record(record)));
  assert.ok(records.every(record => record.schema_version === 'observatory-record.v1.0.0'));
});

test('compatibility successor rejects an unknown nested property', async () => {
  const records = (await fs.readFile(path.join(packageRoot, 'corpus/records.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  const { validators } = await loadRetrievalValidators();
  const mutated = structuredClone(records[0]);
  mutated.identity.asset.unexpected_property = true;
  assert.equal(validators.record(mutated), false);
  assert.ok((validators.record.errors ?? []).some(error => error.keyword === 'additionalProperties' && error.instancePath === '/identity/asset'));
});

test('compatibility receipt does not claim historical recovery or digest equivalence', async () => {
  const schema = await readJson(successorPath);
  const receipt = await readJson(path.join(packageRoot, 'validation/legacy-schema-compatibility-receipt.json'));
  const successorSha256 = createHash('sha256').update(await fs.readFile(successorPath)).digest('hex');
  const objectDefs = Object.values(schema.$defs ?? {}).filter(value => value && value.type === 'object');

  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schema_version.const, 'observatory-record.v1.0.0');
  assert.ok(objectDefs.length > 0);
  assert.ok(objectDefs.every(definition => definition.additionalProperties === false));
  assert.equal(receipt.status, 'PASS_LOCAL_COMPATIBILITY');
  assert.equal(receipt.historical_schema.exact_bytes_recovered, false);
  assert.equal(receipt.historical_schema.locally_present, false);
  assert.equal(receipt.historical_schema.pin_preserved, true);
  assert.equal(receipt.historical_schema.equivalence_claim, false);
  assert.equal(receipt.historical_schema.sha256, '2d778a3125ba03c7504aad92e7154fdedf686db66619e439a6259ba883e162d9');
  assert.equal(receipt.compatibility_successor.sha256, successorSha256);
  assert.equal(receipt.corpus.record_count, 143);
  assert.equal(receipt.adversarial_case.result, 'rejected');
  assert.equal(receipt.external_requests, 0);
  assert.equal(receipt.payload_downloads, 0);
  assert.equal(receipt.analysis_executed, false);
});
