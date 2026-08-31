import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJson, contentFingerprint, fingerprintTruthRevision, sha256Bytes } from '../tools/common.mjs';
import { assertSafeBuildArgs, buildFixtures } from '../tools/build-fixtures.mjs';
import { loadSchemas, schemaErrors } from '../tools/schema.mjs';
import { applyAdversarialCase, COLLECTION_SCHEMAS, semanticErrors } from '../tools/semantics.mjs';
import { validatePackage } from '../tools/validate-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function json(relative) {
  return JSON.parse(await fs.readFile(path.join(ROOT, relative), 'utf8'));
}

test('all strict Draft 2020-12 schemas compile and entity boundaries deny unevaluated properties', async () => {
  const { ajv, rows } = await loadSchemas();
  assert.equal(rows.length, 20);
  assert.ok(rows.every(({ schema }) => schema.$schema === 'https://json-schema.org/draft/2020-12/schema'));
  const bundle = await json('bundle/valid-bundle.json');
  for (const [collection, schemaName] of Object.entries(COLLECTION_SCHEMAS)) {
    const schema = rows.find(row => row.name === schemaName)?.schema;
    assert.equal(schema.unevaluatedProperties, false, schemaName);
    const validate = ajv.getSchema(schema.$id);
    const row = structuredClone(bundle[collection][0]);
    row.unexpected_contract_field = true;
    assert.equal(validate(row), false, `${schemaName} accepted an unexpected property`);
  }
});

test('valid fixture bundle passes schema and all semantic invariants', async () => {
  const bundle = await json('bundle/valid-bundle.json');
  const { ajv } = await loadSchemas();
  const validate = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/fixture-bundle.schema.json');
  assert.equal(validate(bundle), true, JSON.stringify(schemaErrors(validate)));
  assert.deepEqual(semanticErrors(bundle), []);
  for (const rows of Object.values(bundle).filter(Array.isArray)) {
    for (const row of rows) assert.equal(row.canonical_content_fingerprint, fingerprintTruthRevision(row));
  }
});

test('the fixture preserves append-only, bidirectional, acyclic supersession', async () => {
  const { assertions } = await json('bundle/valid-bundle.json');
  const oldRevision = assertions.find(row => row.revision_id.endsWith('-r1'));
  const newRevision = assertions.find(row => row.revision_id.endsWith('-r2'));
  assert.equal(oldRevision.entity_id, newRevision.entity_id);
  assert.equal(oldRevision.lifecycle_state, 'superseded');
  assert.equal(oldRevision.history.superseded_by_revision_id, newRevision.revision_id);
  assert.ok(newRevision.history.supersedes_revision_ids.includes(oldRevision.revision_id));
  assert.ok(oldRevision.clocks.superseded_at);
});

test('access visibility, payload access, authorization, and execution stay separate', async () => {
  const bundle = await json('bundle/valid-bundle.json');
  const publicObservation = bundle.access_observations.find(row => row.access_route_id.endsWith('facility-directory-public'));
  const restrictedObservation = bundle.access_observations.find(row => row.access_route_id.endsWith('facility-utilization-application'));
  assert.equal(publicObservation.catalog_visibility_state, 'visible');
  assert.equal(publicObservation.payload_access_state, 'not_tested');
  assert.equal(publicObservation.infrastructure_state, 'not_tested');
  assert.equal(restrictedObservation.payload_access_state, 'restricted');
  assert.equal(restrictedObservation.authorization_state, 'required');
  assert.ok(bundle.access_routes.every(row => row.execution_state === 'not_executed' && row.access_workflow_submitted === false && row.payloads_acquired === false));
});

test('identity candidates, family membership, and join compatibility are orthogonal', async () => {
  const { relationships } = await json('bundle/valid-bundle.json');
  const identity = relationships.find(row => row.relationship_domain === 'identity');
  const family = relationships.find(row => row.relationship_domain === 'family');
  const join = relationships.find(row => row.relationship_domain === 'join');
  assert.equal(identity.relationship_kind, 'same_identity_candidate');
  assert.equal(identity.identity_semantics.state, 'candidate');
  assert.equal(family.family_semantics.identity_equality, false);
  assert.equal(family.identity_semantics, null);
  assert.equal(join.join_semantics.evidence_state, 'candidate');
  assert.equal(join.join_semantics.compatibility, 'conditional');
  assert.ok(join.join_semantics.requirements.some(row => row.kind === 'crosswalk' && row.satisfaction_state === 'unsatisfied'));
  assert.ok(join.join_semantics.blockers.some(row => row.resolution_state === 'open'));
});

test('every sealed adversarial case is rejected with every named code', async () => {
  const bundle = await json('bundle/valid-bundle.json');
  const adversarial = await json('fixtures/adversarial-cases.json');
  const { ajv } = await loadSchemas();
  const validate = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/fixture-bundle.schema.json');
  for (const adversarialCase of adversarial.cases) {
    const mutated = applyAdversarialCase(bundle, adversarialCase);
    const errors = [];
    if (!validate(mutated)) errors.push(...schemaErrors(validate));
    errors.push(...semanticErrors(mutated, { verifyFingerprints: false }));
    const codes = new Set(errors.map(error => error.code));
    assert.ok(errors.length > 0, `${adversarialCase.case_id} was accepted`);
    for (const expected of adversarialCase.expected_error_codes) assert.ok(codes.has(expected), `${adversarialCase.case_id} missed ${expected}: ${[...codes].join(', ')}`);
  }
});

test('canonical content fingerprints are key-order independent but exact file hashes are not', () => {
  const compact = '{"a":1,"b":2}\n';
  const pretty = '{\n  "b": 2,\n  "a": 1\n}\n';
  assert.notEqual(sha256Bytes(compact), sha256Bytes(pretty));
  assert.equal(contentFingerprint(JSON.parse(compact)), contentFingerprint(JSON.parse(pretty)));
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.notEqual(contentFingerprint(['a', 'b']), contentFingerprint(['b', 'a']));
  assert.throws(() => canonicalJson(1.5), /CANONICAL_JSON_NUMBER_MUST_BE_SAFE_INTEGER/);
  assert.throws(() => canonicalJson(-0), /CANONICAL_JSON_NUMBER_MUST_BE_SAFE_INTEGER/);
});

test('fixture build is deterministic and fails closed for network, payload, and analysis modes', async () => {
  const first = await buildFixtures();
  const second = await buildFixtures();
  assert.deepEqual(first.receipt, second.receipt);
  assert.equal(first.canonical_bytes, second.canonical_bytes);
  for (const flag of ['--network', '--fetch', '--full', '--execute-analysis', '--acquire-payloads']) {
    assert.throws(() => assertSafeBuildArgs([flag]), /PROHIBITED_MODE/, flag);
  }
  assert.throws(() => assertSafeBuildArgs(['--surprise']), /UNKNOWN_ARGUMENT/);
});

test('package manifest, build receipt, fixtures, and semantic validator produce a clean receipt', async () => {
  const report = await validatePackage();
  assert.equal(report.valid, true, report.errors.map(error => `${error.code} ${error.path}: ${error.message}`).join('\n'));
  assert.equal(report.package_manifest_checked, true);
  assert.equal(report.adversarial_case_count, 10);
  assert.equal(report.record_counts.relationships, 4);
});
