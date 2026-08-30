import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { semanticErrors } from '../tools/semantics.mjs';
import { loadSchemas } from '../tools/schema.mjs';
import { validatePackage } from '../tools/validate-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function jsonl(name) {
  return (await fs.readFile(path.join(ROOT, 'bundle', name), 'utf8')).trim().split('\n').map(JSON.parse);
}

async function collections() {
  return {
    objects: await jsonl('objects.jsonl'),
    assertions: await jsonl('assertions.jsonl'),
    access: await jsonl('access-observations.jsonl'),
    evidence: await jsonl('evidence.jsonl'),
    relationships: await jsonl('relationships.jsonl')
  };
}

test('strict Draft 2020-12 schemas compile', async () => {
  const { rows } = await loadSchemas();
  assert.equal(rows.length, 12);
  assert.ok(rows.every(row => row.schema.$schema === 'https://json-schema.org/draft/2020-12/schema'));
});

test('all object roles exist and native identifiers remain exact source values', async () => {
  const { objects } = await collections();
  assert.deepEqual([...new Set(objects.map(row => row.role))].sort(), ['capture', 'catalog', 'dataset', 'distribution', 'documentation', 'organization', 'repository', 'service', 'source', 'version']);
  assert.ok(objects.every(row => row.native_identifiers.length > 0));
  assert.ok(objects.flatMap(row => row.native_identifiers).every(identifier => identifier.preservation === 'exact'));
  const candidate = objects.find(row => row.object_id === 'obs:object:source.cms-portal-label-candidate');
  const source = objects.find(row => row.object_id === 'obs:object:source.data-cms-gov');
  assert.notEqual(candidate.object_id, source.object_id);
});

test('assertion and access supersession preserves both generations bidirectionally', async () => {
  const data = await collections();
  const oldAssertion = data.assertions.find(row => row.assertion_id === 'obs:assertion:pos-data-through-2025');
  const newAssertion = data.assertions.find(row => row.assertion_id === 'obs:assertion:pos-data-through-2026');
  assert.equal(oldAssertion.status, 'superseded');
  assert.equal(oldAssertion.supersession.superseded_by_id, newAssertion.assertion_id);
  assert.ok(newAssertion.supersession.supersedes_ids.includes(oldAssertion.assertion_id));
  const oldAccess = data.access.find(row => row.observation_id.endsWith('v1'));
  const newAccess = data.access.find(row => row.observation_id.endsWith('v2'));
  assert.equal(oldAccess.supersession.superseded_by_id, newAccess.observation_id);
  assert.ok(newAccess.supersession.supersedes_ids.includes(oldAccess.observation_id));
});

test('access separates visibility, data access, and infrastructure evidence', async () => {
  const { access } = await collections();
  const current = access.find(row => row.status === 'active');
  assert.equal(current.catalog_visibility_state, 'visible');
  assert.equal(current.data_access_state, 'not_tested');
  assert.equal(current.infrastructure_state, 'not_tested_offline');
  assert.equal(current.verifier.result, 'not_verified');
});

test('identity candidate remains unresolved rather than becoming a merge', async () => {
  const { relationships } = await collections();
  const candidate = relationships.find(row => row.predicate === 'identity_candidate_for');
  assert.equal(candidate.status, 'unresolved');
  assert.equal(candidate.confidence.band, 'low');
});

test('search record is explicitly a denormalized non-truth projection', async () => {
  const projection = JSON.parse(await fs.readFile(path.join(ROOT, 'examples', 'denormalized-search-view-projection.json'), 'utf8'));
  assert.equal(projection.view_schema, 'observatory-record.v1.0.0');
  assert.equal(projection.view_role, 'denormalized_discovery_search_view');
  assert.equal(projection.source_of_truth, false);
  assert.ok(projection.assertion_ids.length > 0 && projection.evidence_ids.length > 0);
});

test('payloads and invalid identity promotion fail closed', async () => {
  const data = await collections();
  const projection = JSON.parse(await fs.readFile(path.join(ROOT, 'examples', 'denormalized-search-view-projection.json'), 'utf8'));
  const withPayload = structuredClone(data);
  withPayload.evidence[0].payload = { rows: [1] };
  assert.ok(semanticErrors(withPayload, projection).some(error => error.includes('prohibited payload key payload')));
  const promoted = structuredClone(data);
  const candidate = promoted.relationships.find(row => row.predicate === 'identity_candidate_for');
  candidate.status = 'active';
  candidate.confidence.band = 'high';
  assert.ok(semanticErrors(promoted, projection).some(error => error.includes('identity candidate must remain unresolved')));
});

test('package validates and fixture build is deterministic/offline-only', async () => {
  const report = await validatePackage();
  assert.equal(report.valid, true, report.errors.join('\n'));
  const one = JSON.parse(execFileSync(process.execPath, ['tools/build-fixtures.mjs', '--fixture'], { cwd: ROOT, encoding: 'utf8' }));
  const two = JSON.parse(execFileSync(process.execPath, ['tools/build-fixtures.mjs', '--fixture'], { cwd: ROOT, encoding: 'utf8' }));
  assert.deepEqual(one.outputs, two.outputs);
  for (const args of [['--full'], ['--fixture', '--network'], ['--fixture', '--execute-coverage']]) {
    const result = spawnSync(process.execPath, ['tools/build-fixtures.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  }
});
