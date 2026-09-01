import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  COMPONENT_KINDS,
  PACKAGE_ROOT,
  canonicalDigestValue,
  clone,
  projectionDocumentMaterial,
  readJson,
  sha256File,
  walkFiles
} from '../tools/common.mjs';
import { MANIFEST_EXCLUDES } from '../tools/build-manifest.mjs';
import { loadSchemas, validationMessage, validatorFor } from '../tools/schema.mjs';
import { validatePublicationBundle } from '../tools/semantics.mjs';
import { loadFixtureBundle, validatePackage } from '../tools/validate-package.mjs';

test('all strict Draft 2020-12 schemas compile and the complete fixture validates', async () => {
  const { ajv, schemas } = await loadSchemas();
  assert.equal(schemas.length, 16);
  const { bundle } = await loadFixtureBundle();
  const validate = validatorFor(ajv, 'publication-fixture.schema.json');
  assert.equal(validate(bundle), true, validationMessage(validate));
  assert.deepEqual(validatePublicationBundle(bundle), []);
});

test('W1 is exact revision membership and every obligation is acknowledged once', async () => {
  const { bundle } = await loadFixtureBundle();
  for (const manifest of bundle.canonical_manifests) {
    assert.equal(manifest.selection_model, 'exact_immutable_revision_membership');
    assert.equal(new Set(manifest.members.map(item => item.canonical_id)).size, manifest.members.length);
    const obligations = manifest.members.reduce((total, item) => total + item.projection_obligations.length, 0);
    assert.equal(manifest.projection_obligation_count, obligations);
    const receipt = bundle.build_receipts.find(item => item.canonical_manifest_ref.manifest_id === manifest.manifest_id);
    assert.equal(receipt.counts.acknowledgements, obligations);
    assert.equal(receipt.counts.projected + receipt.counts.excluded, obligations);
  }
});

test('publication pins seven coherent immutable components and an atomic pointer transaction', async () => {
  const { bundle } = await loadFixtureBundle();
  const active = bundle.publication_manifests.find(item => item.publication_id === bundle.pointer.active_publication_ref.publication_id);
  assert.deepEqual(active.component_generation_refs.map(item => item.component_kind).sort(), [...COMPONENT_KINDS].sort());
  assert.equal(active.promotion.partial_promotion_allowed, false);
  assert.equal(active.rollback.previous_publication_ref.publication_id, bundle.pointer.previous_publication_ref.publication_id);
  const latest = bundle.publication_history.events.at(-1);
  assert.equal(latest.transaction_id, bundle.pointer.transaction_id);
  assert.equal(latest.event_id, bundle.pointer.history_event_id);
  assert.equal(bundle.pointer.atomic_commit, true);
  assert.equal(bundle.pointer.cache_policy.pointer_lookup, 'cache_disabled');
});

test('visibility exclusions are explicit and never become absence claims', async () => {
  const { bundle } = await loadFixtureBundle();
  const excluded = bundle.acknowledgements.filter(item => item.result === 'excluded');
  assert.equal(excluded.length, 2);
  assert.ok(excluded.every(item => item.visibility_state === 'quarantined'));
  assert.ok(excluded.every(item => item.document_refs.length === 0));
  assert.ok(excluded.every(item => item.exclusion.absence_claim_permitted === false));
  assert.ok(bundle.projection_documents.every(item => item.visibility_state === 'public'));
});

test('semantic projection checksum excludes generation and projection time only', async () => {
  const { bundle } = await loadFixtureBundle();
  const document = bundle.projection_documents[0];
  const rebuilt = clone(document);
  rebuilt.generation_id = 'gen:independent-rebuild:asset_search';
  rebuilt.projected_at = '2026-09-01T00:00:00Z';
  assert.equal(canonicalDigestValue('projection_document', projectionDocumentMaterial(rebuilt)), document.document_checksum.value);
  rebuilt.content.label = 'changed semantic content';
  assert.notEqual(canonicalDigestValue('projection_document', projectionDocumentMaterial(rebuilt)), document.document_checksum.value);
});

test('retired pins serve before TTL and return restart_required at and after expiry', async () => {
  const { bundle } = await loadFixtureBundle();
  assert.deepEqual(bundle.pin_resolution_cases.map(item => item.expected_result), ['serve_pinned', 'restart_required', 'restart_required']);
  const retired = bundle.generation_history.filter(item => item.to_state === 'retired');
  assert.equal(retired.length, 7);
  assert.ok(retired.every(item => item.pin_behavior === 'serve_pinned'));
});

test('legacy static compatibility never fabricates unavailable coverage SEO or planning', async () => {
  const { bundle } = await loadFixtureBundle();
  const legacy = bundle.legacy_static_manifest;
  assert.equal(legacy.static_corpus.record_count, 157);
  assert.equal(legacy.capabilities.search.availability, 'available');
  for (const capability of ['coverage', 'seo', 'planner']) {
    assert.equal(legacy.capabilities[capability].availability, 'unknown');
    assert.equal(legacy.capabilities[capability].absence_claim_permitted, false);
  }
  assert.equal(legacy.truth_boundary.analytics_execution, false);
});

test('all adversarial membership, coherence, lifecycle, and rollback mutations fail closed', async () => {
  const { report, adversarialResults } = await validatePackage();
  assert.equal(adversarialResults.length, 29);
  assert.deepEqual(adversarialResults.filter(item => !item.passed), []);
  assert.equal(report.valid, true, report.errors.join('\n'));
});

test('package manifest pins the exact bytes of every payload file', async () => {
  const manifest = await readJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'));
  const physical = (await walkFiles(PACKAGE_ROOT)).filter(relative => !MANIFEST_EXCLUDES.includes(relative));
  assert.deepEqual(manifest.files.map(item => item.path), physical);
  for (const item of manifest.files) {
    const absolute = path.join(PACKAGE_ROOT, item.path);
    assert.equal((await fs.stat(absolute)).size, item.bytes, item.path);
    assert.equal(await sha256File(absolute), item.sha256, item.path);
  }
});
