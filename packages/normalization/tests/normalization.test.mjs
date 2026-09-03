import assert from 'node:assert/strict';
import test from 'node:test';
import { semanticErrors } from '../../../contracts/core/v2.0.0/tools/semantics.mjs';
import { loadSchemas } from '../../../contracts/core/v2.0.0/tools/schema.mjs';
import { canonicalJson, contentFingerprint } from '../src/canonical.mjs';
import { loadLegacyCorpus } from '../src/legacy-loader.mjs';
import { normalizeLegacyCorpus } from '../src/normalize.mjs';
import { assertImportMappings, importMappingErrors } from '../src/mapping-reconciliation.mjs';
import { assertDatabaseImportSemantics } from '../src/database-semantics.mjs';

const legacy = await loadLegacyCorpus();

test('frozen v1.1.0 source hashes and exact 157/157/14 counts are verified', () => {
  assert.equal(legacy.records.length, 157);
  assert.equal(legacy.searchDocuments.length, 157);
  assert.equal(legacy.joinRoutes.length, 14);
  assert.equal(legacy.hashes.manifest, '23f704ce3e421a6eb26c2b3677d616a1ae6b4f45226233257b9a1ff676caba2b');
  assert.equal(legacy.hashes.corpus, '4eaeffdcbb3db324f51485f38f915e392724b80c5372358933681c003eb5f864');
});

test('normalization is deterministic and validates against core v2 truth semantics', async () => {
  const first = normalizeLegacyCorpus(legacy);
  const second = normalizeLegacyCorpus(legacy);
  assert.equal(canonicalJson(first.importDocument), canonicalJson(second.importDocument));
  assert.deepEqual(semanticErrors(first.bundle), []);
  const { ajv } = await loadSchemas();
  const validate = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/fixture-bundle.schema.json');
  assert.equal(validate(first.bundle), true, JSON.stringify(validate.errors));
});

test('all legacy objects reconcile and canonical asset identity remains one-to-one', () => {
  const { plan, bundle } = normalizeLegacyCorpus(legacy);
  assert.equal(plan.record_mappings.length, 157);
  assert.equal(plan.join_route_mappings.length, 14);
  assert.equal(plan.rejected_items.length, 0);
  assert.equal(bundle.assets.length, 157);
  assert.equal(new Set(bundle.assets.map(row => row.asset_id)).size, 157);
  assert.equal(bundle.sources.length, 157);
  assert.equal(new Set(bundle.sources.map(row => row.source_id)).size, 157);
  assert.ok(plan.record_mappings.every(row => row.legacy_alias_preserved));
  assert.ok(plan.join_route_mappings.every(row => row.relationship_ids.length > 0));
});

test('every explicit mapping resolves to its exact canonical graph', () => {
  const normalized = normalizeLegacyCorpus(legacy);
  assert.equal(assertImportMappings(normalized), true);
  const wrongRecordTarget = structuredClone(normalized);
  wrongRecordTarget.plan.record_mappings[0].canonical_ids.asset_id = wrongRecordTarget.plan.record_mappings[1].canonical_ids.asset_id;
  assert.ok(importMappingErrors(wrongRecordTarget).some(error => error.code === 'RECORD_MAPPING_ASSET_MISMATCH'));
  const wrongRouteTarget = structuredClone(normalized);
  wrongRouteTarget.plan.join_route_mappings[0].relationship_ids[0] = wrongRecordTarget.plan.record_mappings[0].canonical_ids.asset_id;
  assert.ok(importMappingErrors(wrongRouteTarget).some(error => error.code === 'ROUTE_MAPPING_TARGET_MISSING'));
});

test('legacy operator IDs never collapse distinct source-system observations', () => {
  const { plan, bundle } = normalizeLegacyCorpus(legacy);
  const cmsRecords = legacy.records.filter(row => row.identity?.source?.source_id === 'us-federal:source:centers-for-medicare-and-medicaid-services');
  const cmsMappings = cmsRecords.map(row => plan.record_mappings.find(mapping => mapping.legacy_record_id === row.record_id));
  assert.equal(new Set(cmsMappings.map(mapping => mapping.canonical_ids.organization_id)).size, 1);
  assert.equal(new Set(cmsMappings.map(mapping => mapping.canonical_ids.source_id)).size, cmsRecords.length);
  const portals = new Set(cmsRecords.map(row => row.identity?.match_fields?.source_portal));
  assert.ok(portals.has('data.cms.gov'));
  assert.ok(portals.has('pecosai.portal.cms.gov'));
  assert.ok(plan.source_identity_review_candidates.length > 0);
  assert.ok(plan.source_identity_review_candidates.every(candidate => candidate.state === 'open' && candidate.automatic_merge_performed === false));
  const sourceCandidateRelationships = bundle.relationships.filter(row =>
    row.relationship_kind === 'same_identity_candidate'
      && bundle.sources.some(source => source.source_id === row.subject_id)
  );
  assert.equal(sourceCandidateRelationships.length, plan.source_identity_review_candidates.length);
  assert.equal(bundle.relationships.filter(row => row.relationship_kind === 'same_identity').length, 0);
});

test('mutable title and URL change revisions but never opaque entity IDs', () => {
  const original = normalizeLegacyCorpus(legacy);
  const changedLegacy = structuredClone(legacy);
  changedLegacy.records[0].title = `${changedLegacy.records[0].title} corrected`;
  changedLegacy.records[0].authoritative_url = 'https://example.invalid/corrected-location';
  changedLegacy.records[0].identity.match_fields.source_portal = 'replacement.example.invalid';
  const changed = normalizeLegacyCorpus(changedLegacy);
  const originalAsset = original.bundle.assets.find(row => row.legacy_aliases.includes(legacy.records[0].record_id));
  const changedAsset = changed.bundle.assets.find(row => row.legacy_aliases.includes(legacy.records[0].record_id));
  assert.equal(changedAsset.asset_id, originalAsset.asset_id);
  assert.notEqual(changedAsset.revision_id, originalAsset.revision_id);
  const originalSource = original.bundle.sources.find(row => row.legacy_aliases.includes(`${legacy.records[0].record_id}#source`));
  const changedSource = changed.bundle.sources.find(row => row.legacy_aliases.includes(`${legacy.records[0].record_id}#source`));
  assert.equal(changedSource.source_id, originalSource.source_id);
  assert.notEqual(changedSource.revision_id, originalSource.revision_id);
});

test('title and locator collisions remain separate open review candidates', () => {
  const { plan, bundle } = normalizeLegacyCorpus(legacy);
  assert.ok(plan.identity_review_candidates.length > 0);
  assert.ok(plan.identity_review_candidates.every(row => row.state === 'open' && row.automatic_merge_performed === false));
  for (const candidate of plan.identity_review_candidates) {
    assert.equal(new Set(candidate.ordered_asset_ids).size, 2);
    assert.ok(candidate.features.normalized_title_equal || candidate.features.normalized_locator_equal);
  }
  const equality = bundle.relationships.filter(row => row.relationship_kind === 'same_identity');
  assert.equal(equality.length, 0);
});

test('legacy join routes remain exact field-bound candidates without evidence upgrade', () => {
  const { bundle, plan } = normalizeLegacyCorpus(legacy);
  const joins = bundle.relationships.filter(row => row.relationship_domain === 'join');
  assert.equal(joins.length, 14);
  assert.equal(plan.join_route_mappings.length, 14);
  assert.ok(joins.every(row => row.join_semantics.evidence_state === 'candidate'));
  assert.ok(joins.every(row => ['conditional', 'incompatible'].includes(row.join_semantics.compatibility)));
  assert.ok(joins.every(row => bundle.schema_fields.some(field => field.schema_field_id === row.subject_id)));
  assert.ok(joins.every(row => bundle.schema_fields.some(field => field.schema_field_id === row.object_id)));
});

test('four clocks, evidence lineage, aliases, and zero-action boundary are explicit', () => {
  const normalized = normalizeLegacyCorpus(legacy);
  for (const asset of normalized.bundle.assets) {
    assert.ok(asset.clocks.first_seen_at);
    assert.ok(asset.clocks.observed_at);
    assert.ok(asset.clocks.recorded_at);
    assert.equal(asset.clocks.superseded_at, null);
    assert.ok(asset.evidence_refs.length > 0);
    assert.ok(asset.legacy_aliases.length > 0);
    assert.equal(asset.lineage.import_id, normalized.import_id);
  }
  assert.equal(normalized.plan.policy.source_payloads_acquired, false);
  assert.equal(normalized.plan.policy.analyses_executed, false);
  assert.equal(contentFingerprint(normalized.bundle), normalized.plan.bundle_fingerprint);
});

test('database selected-head profile explicitly rejects convergent multi-predecessor revisions', () => {
  const normalized = normalizeLegacyCorpus(legacy);
  assert.equal(assertDatabaseImportSemantics(normalized.bundle), true);
  const adversarial = structuredClone(normalized.bundle);
  adversarial.assets[0].history.supersedes_revision_ids = [
    'urn:ushso:revision:predecessor-a',
    'urn:ushso:revision:predecessor-b'
  ];
  assert.throws(() => assertDatabaseImportSemantics(adversarial), /DB_LINEAR_HISTORY_MULTIPLE_PREDECESSORS/u);
});
