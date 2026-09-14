import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContextScopedSchemaFieldId } from '../../packages/identity/src/schema-catalog.mjs';
import { retainNameDiscrepancySummary } from '../../packages/identity/src/variable-identity.mjs';
import {
  blockedFetch,
  buildMappedRecipe,
  compareExactKeys,
  expandCountedHcrisNames,
  invalidateMappingOnDocumentationUpdate,
  proposeWireKeyReconciliation,
  fieldIdForAcceptedWireMapping,
} from '../../scripts/research/cms-variable-layout.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = path.join(root, 'verification/research-program/pr-017/fixtures/hcris-wire-key-fixture.json');
const pr008Audit = path.join(root, 'verification/research-program/pr-008/evidence/c008-3-mapping-audit.json');
const pr008Comparison = path.join(root, 'verification/research-program/bootstrap/pr008-scope-20260911/sample-shape-comparison.json');

const context = {
  source_id: 'urn:ushso:source:cms-hcris',
  asset_id: 'urn:ushso:asset:cms-hcris-hospital-cost-reports',
  release_id: 'urn:ushso:release:cms-hcris-2023',
  distribution_id: 'urn:ushso:distribution:cms-hcris-api',
  schema_snapshot_id: 'urn:ushso:schema:cms-hcris-2023',
  schema_field_id: 'urn:ushso:field:pending',
  field_revision_id: 'urn:ushso:revision:pending',
  state: 'resolved',
  binding_state: 'exact',
};

async function loadFixture() {
  return JSON.parse(await fs.readFile(fixturePath, 'utf8'));
}

test('117 documented names and 117 wire keys keep count equality while exact-key comparison reports eleven mismatches', async () => {
  const fixture = await loadFixture();
  const expanded = expandCountedHcrisNames(fixture);
  assert.equal(expanded.documented_names.length, 117);
  assert.equal(expanded.wire_names.length, 117);
  const compared = compareExactKeys(expanded.documented_names, expanded.wire_names);
  assert.equal(compared.count_equal, true);
  assert.equal(compared.exact_key_equal, false);
  assert.equal(compared.mismatch_count, 11);
  assert.equal(compared.only_documented.length, 11);
  assert.equal(compared.only_wire.length, 11);
  const summary = retainNameDiscrepancySummary({
    record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
    sample: 'cms-hcris',
    sample_fields: 117,
    dictionary_fields: 117,
    mismatch_count: 11,
    in_payload_not_dictionary: fixture.mismatches.map((row) => row.wire_name),
    in_dictionary_not_payload: fixture.mismatches.map((row) => row.documented_name),
    limitation: fixture.limitation,
  });
  assert.equal(summary.mismatch_count, 11);
  assert.ok(summary.mappings.every((mapping) => mapping.state === 'ambiguous' && mapping.wire_name === null));
});

test('labels stay distinct from wire identifiers and hashes bind the eleven retained mismatches', async () => {
  const fixture = await loadFixture();
  const audit = JSON.parse(await fs.readFile(pr008Audit, 'utf8'));
  const comparison = JSON.parse(await fs.readFile(pr008Comparison, 'utf8'));
  const hcris = comparison.find((row) => row.sample === 'cms-hcris');
  assert.equal(fixture.source_audit.sha256, createHash('sha256').update(await fs.readFile(pr008Audit)).digest('hex'));
  assert.equal(fixture.source_comparison.sha256, createHash('sha256').update(await fs.readFile(pr008Comparison)).digest('hex'));
  assert.deepEqual(fixture.mismatches.map((row) => row.wire_name), audit.in_payload_not_dictionary);
  assert.deepEqual(fixture.mismatches.map((row) => row.documented_name), hcris.in_dictionary_not_payload);
  for (const row of fixture.mismatches) {
    assert.notEqual(row.documented_name, row.wire_name);
    assert.equal(row.label_is_not_wire, true);
    assert.equal(row.documented_sha256, createHash('sha256').update(row.documented_name).digest('hex'));
    assert.equal(row.wire_sha256, createHash('sha256').update(row.wire_name).digest('hex'));
  }
});

test('exact names match first and hyphen/case aliases require review evidence', async () => {
  const fixture = await loadFixture();
  const hyphenDoc = fixture.mismatches.find((row) => row.wire_name === 'Wage-Related Costs (Core)').documented_name;
  const exact = proposeWireKeyReconciliation({
    documentedName: 'PROVNUM',
    candidateWireNames: ['PROVNUM', 'provnum'],
  });
  assert.equal(exact.state, 'exact');
  assert.equal(exact.wire_name, 'PROVNUM');
  assert.equal(exact.silent_pick, false);
  const hyphen = proposeWireKeyReconciliation({
    documentedName: hyphenDoc,
    candidateWireNames: ['Wage-Related Costs (Core)'],
  });
  assert.equal(hyphen.state, 'ambiguous');
  assert.equal(hyphen.wire_name, null);
  assert.ok(hyphen.proposals[0].differences.includes('hyphen_or_dash'));
  const reviewed = proposeWireKeyReconciliation({
    documentedName: hyphenDoc,
    candidateWireNames: ['Wage-Related Costs (Core)'],
    reviews: [{ accepted: true, documented_name: hyphenDoc, wire_name: 'Wage-Related Costs (Core)', evidence_id: 'evidence:pr017:hyphen-core', mapping_version: 'hcris-alias-v1' }],
  });
  assert.equal(reviewed.state, 'reviewed_alias');
  assert.equal(reviewed.wire_name, 'Wage-Related Costs (Core)');
  assert.deepEqual(reviewed.evidence_ids, ['evidence:pr017:hyphen-core']);
});

test('Adult/Adults wording and two ambiguous candidates cannot silently pick a wrong field', () => {
  const adult = proposeWireKeyReconciliation({
    documentedName: 'Hospital Total Discharges (V + XVIII + XIX + Unknown) For Adult & Peds',
    candidateWireNames: ['Hospital Total Discharges (V + XVIII + XIX + Unknown) For Adults & Peds'],
  });
  assert.equal(adult.state, 'ambiguous');
  assert.equal(adult.wire_name, null);
  assert.ok(adult.proposals[0].differences.includes('adult_adults_wording'));
  const collision = proposeWireKeyReconciliation({
    documentedName: 'FTE',
    candidateWireNames: ['FTE_A', 'FTE-A'],
  });
  assert.equal(collision.state, 'ambiguous');
  assert.equal(collision.wire_name, null);
  assert.equal(collision.silent_pick, false);
  assert.equal(collision.candidate_wire_names.length, 2);
  assert.throws(() => proposeWireKeyReconciliation({
    documentedName: 'FTE',
    candidateWireNames: ['FTE_A'],
    reviews: [{ accepted: true, documented_name: 'FTE', wire_name: 'FTE_A' }],
  }), { code: 'REVIEW_EVIDENCE_REQUIRED' });
});

test('accepted mapping feeds a recipe using the observed API key and retains label, citation and version', () => {
  const mapping = proposeWireKeyReconciliation({
    documentedName: 'Total Salaries (Adjusted)',
    candidateWireNames: ['Total Salaries (adjusted)'],
    reviews: [{ accepted: true, documented_name: 'Total Salaries (Adjusted)', wire_name: 'Total Salaries (adjusted)', evidence_id: 'evidence:pr017:salaries-case', mapping_version: 'hcris-alias-v1' }],
  });
  const recipe = buildMappedRecipe({
    mapping,
    label: 'Total Salaries (Adjusted)',
    dictionaryCitation: 'HCRIS hospital cost report data dictionary',
    mappingVersion: 'hcris-alias-v1',
  });
  assert.equal(recipe.emitted, true);
  assert.equal(recipe.wire_name, 'Total Salaries (adjusted)');
  assert.deepEqual(recipe.get, ['Total Salaries (adjusted)']);
  assert.equal(recipe.label, 'Total Salaries (Adjusted)');
  assert.equal(recipe.dictionary_citation, 'HCRIS hospital cost report data dictionary');
  assert.equal(recipe.mapping_version, 'hcris-alias-v1');
  assert.equal(recipe.payload_success, false);
  const fieldId = fieldIdForAcceptedWireMapping(context, mapping);
  assert.equal(fieldId, createContextScopedSchemaFieldId(context, 'Total Salaries (adjusted)'));
});

test('a documentation update invalidates only the affected mapping for review', () => {
  const mapping = proposeWireKeyReconciliation({
    documentedName: 'Rural versus Urban',
    candidateWireNames: ['Rural Versus Urban'],
    reviews: [{ accepted: true, documented_name: 'Rural versus Urban', wire_name: 'Rural Versus Urban', evidence_id: 'evidence:pr017:rural-case', mapping_version: 'hcris-alias-v1' }],
  });
  const affected = invalidateMappingOnDocumentationUpdate({
    mapping,
    previousDocumentedName: 'Rural versus Urban',
    nextDocumentedName: 'Rural versus Urban (revised)',
    mappingVersion: 'hcris-alias-v1',
  });
  assert.equal(affected.invalidated, true);
  assert.equal(affected.mapping.state, 'unmatched');
  assert.equal(affected.mapping.wire_name, null);
  const other = invalidateMappingOnDocumentationUpdate({
    mapping,
    previousDocumentedName: 'Unrelated field',
    nextDocumentedName: 'Unrelated field (revised)',
  });
  assert.equal(other.invalidated, false);
  assert.equal(other.reason, 'unaffected');
});

test('broad punctuation stripping cannot merge two source columns', () => {
  const merged = proposeWireKeyReconciliation({
    documentedName: 'FTE-A',
    candidateWireNames: ['FTE_A', 'FTEA'],
  });
  assert.equal(merged.state, 'ambiguous');
  assert.equal(merged.wire_name, null);
  assert.equal(merged.silent_pick, false);
});

test('live fetch is forbidden in the wire-key path', async () => {
  await assert.rejects(() => blockedFetch('https://data.cms.gov'), { code: 'WIRE_KEY_LIVE_NETWORK_FORBIDDEN' });
});
