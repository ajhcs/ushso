import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { semanticErrors } from '../packages/retrieval/tools/record-semantics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionRoot = path.join(root, 'packages/retrieval/versions/v1.2.0');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

async function json(relative) {
  return JSON.parse(await fs.readFile(path.join(versionRoot, relative), 'utf8'));
}

async function jsonlFiles(files) {
  const rows = [];
  for (const file of files) {
    const text = await fs.readFile(path.join(versionRoot, 'corpus', file), 'utf8');
    rows.push(...text.trim().split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)));
  }
  return rows;
}

test('v1.2 live catalog is broad, complete within its named scopes, and truthfully verified', async () => {
  const corpus = await json('corpus/corpus.json');
  const validation = await json('validation/validation-report.json');
  const receipt = JSON.parse(await fs.readFile(path.join(root, 'verification/catalog/v1.2.0/live-catalog-receipt.json'), 'utf8'));
  const records = await jsonlFiles(corpus.record_files);
  const documents = await jsonlFiles(corpus.search_document_files);

  assert.equal(corpus.record_count, 3434);
  assert.equal(records.length, corpus.record_count);
  assert.equal(documents.length, 0);
  assert.equal(corpus.search_document_count, 0);
  assert.equal(corpus.runtime_search_projection, 'on_demand');
  assert.deepEqual(corpus.source_slices, { 'cms-data-catalog': 159, 'cdc-socrata': 1472, 'census-api': 1803 });
  assert.equal(validation.status, 'PASS');
  assert.equal(validation.counts.not_live_verified, 0);
  assert.equal(receipt.totals.payload_downloads, 0);
  assert.equal(receipt.totals.identity_merges, 0);
  assert.equal(new Set(records.map(record => record.record_id)).size, records.length);

  for (const record of records) {
    assert.deepEqual(semanticErrors(record), [], record.record_id);
    assert.equal(record.freshness_verification.verification_status, 'current_verified');
    assert.equal(record.freshness_verification.verification_method, 'first_party_live');
    assert.equal(record.geography.coverage_level, 'unknown');
    assert.deepEqual(record.geography.jurisdictions, []);
    assert.equal(record.retrieval.machine_actionable, false);
    assert.equal(record.retrieval.preferred_interface, 'unknown');
    assert.deepEqual(record.access.mechanisms, ['unknown']);
    assert.equal(record.access.infrastructure_state, 'unknown');
  }
});

test('v1.2 publication shards are bounded and manifest hashes match', async () => {
  const manifest = await json('manifests/corpus-manifest.json');
  for (const file of manifest.files) {
    const content = await fs.readFile(path.join(versionRoot, file.path));
    assert.ok(content.byteLength <= 8 * 1024 * 1024, `${file.path} exceeds the 8 MiB generation limit`);
    assert.equal(content.byteLength, file.bytes, file.path);
    assert.equal(sha256(content), file.sha256, file.path);
  }
});

test('v1.2 public WebMCP contract exposes eight read-only tools and no planner', async () => {
  const contract = JSON.parse(await fs.readFile(path.join(root, 'packages/machine-toolkit/public-webmcp-tool.json'), 'utf8'));
  assert.equal(contract.enabled_tool_count, 8);
  assert.equal(contract.tools.length, 8);
  assert.ok(contract.tools.every(tool => tool.registration_state === 'active'));
  assert.deepEqual(contract.disabled_tools.map(tool => tool.capability), ['plan_research']);
  assert.equal(contract.source_network_allowed_at_invocation, false);
  assert.equal(contract.payload_retrieval_allowed, false);
});

test('v1.2 native WebMCP receipt proves browser discovery and invocation', async () => {
  const corpus = await json('corpus/corpus.json');
  const receipt = JSON.parse(await fs.readFile(path.join(root, 'verification/catalog/v1.2.0/native-webmcp-receipt.json'), 'utf8'));
  const allowedSurfaces = new Set(['document.modelContext', 'navigator.modelContext']);

  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.generation, corpus.publication.generation);
  assert.equal(receipt.secure_context, true);
  assert.ok(allowedSurfaces.has(receipt.surface), receipt.surface);
  assert.equal(receipt.primary_surface, 'document.modelContext');
  assert.equal(receipt.discovered_tool_count, 8);
  assert.equal(receipt.discovered_tools.length, 8);
  assert.equal(receipt.all_schemas_self_contained, true);
  assert.ok(receipt.discovered_tools.every(tool => tool.schema_self_contained));
  assert.equal(receipt.planner_absent, true);
  assert.equal(receipt.successful_invocation_count, 8);
  assert.equal(receipt.invocations.length, 8);
  assert.ok(receipt.invocations.every(invocation => invocation.ok));
  assert.ok(receipt.invocations.every(invocation => Object.values(invocation.truth_boundary).every(value => value === false)));
});
