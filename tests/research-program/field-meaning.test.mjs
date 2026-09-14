import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  blockedFetch,
  documentedEnumeration,
  extractCodebookEvidence,
  extractVersionedVariables,
  hash,
  inferUnitFromFieldName,
  reportFieldMeaningCoverage,
  representConservativeMeaning,
} from '../../scripts/research/source-extractors.mjs';

test('numeric-looking codebook identifiers remain strings and suppressed markers are not zero', () => {
  const codebook = extractCodebookEvidence({
    source: 'cms',
    release: 'hcris-2023',
    pointer: '/codebook',
    table: [
      { code: '001', label: 'Leading zero' },
      { code: '07', label: 'Still a string' },
      { code: '.', label: 'Suppressed', suppressed: true },
      { code: 'NA', label: 'Missing', missing: true },
    ],
  });
  assert.equal(codebook.rows[0].code, '001');
  assert.equal(typeof codebook.rows[0].code, 'string');
  assert.equal(codebook.rows[1].code, '07');
  assert.equal(codebook.rows[2].suppressed, true);
  assert.equal(codebook.rows[2].numeric_value, null);
  assert.equal(codebook.rows[3].missing, true);
  assert.equal(codebook.rows[3].numeric_value, null);
  assert.throws(() => extractCodebookEvidence({ table: [{ code: 7 }] }), { code: 'CODE_MUST_REMAIN_STRING' });
  assert.throws(() => extractCodebookEvidence({ table: [{ code: '.', suppressed: true, numeric_value: 0 }] }), { code: 'SUPPRESSED_NOT_ZERO' });
  const enumerated = documentedEnumeration({ '001': 'Leading zero', '—': 'Unicode' });
  assert.deepEqual(enumerated.codes, ['001', '—']);
});

test('Census concepts stay concepts and identifiers accept not-applicable units', () => {
  const data = { variables: { GEOID: { label: 'Geography ID', concept: 'Census geography', predicateType: 'string' } } };
  const body = JSON.stringify(data);
  const capture = { status: 'captured', url: 'https://example.test/census.json', text: body, data, sha256: hash(body), captured_at: '2026-09-11T00:00:00Z', evidence_id: 'evidence:test:census-concept' };
  const [variable] = extractVersionedVariables(data.variables, 'census', { capture, semanticRoleFor: () => 'identifier' });
  assert.equal(variable.publisher_concept, 'Census geography');
  assert.equal(variable.definition, null);
  const meaning = representConservativeMeaning({
    source: 'census',
    release: 'acs5-2023',
    role: 'identifier',
    label: variable.publisher_label,
    concept: variable.publisher_concept,
    definition: variable.definition,
    unitState: 'not_applicable',
    evidenceIds: ['evidence:test:census-concept'],
  });
  assert.equal(meaning.concept_is_not_definition, true);
  assert.equal(meaning.unit.state, 'not_applicable');
  assert.equal(meaning.unit.value, null);
});

test('a rate without a documented denominator remains incomplete', () => {
  const meaning = representConservativeMeaning({
    source: 'cdc',
    release: 'places-2023',
    role: 'rate',
    label: 'Crude Prevalence',
    definition: 'Percent of adults',
  });
  assert.equal(meaning.completeness, 'incomplete');
  assert.equal(meaning.unit.state, 'missing');
  assert.equal(meaning.unit.incomplete, true);
});

test('a unit inferred only from a field name fails acceptance', () => {
  assert.throws(() => inferUnitFromFieldName('percent_adults'), { code: 'UNIT_INFERRED_FROM_NAME' });
  assert.throws(() => representConservativeMeaning({
    source: 'cms',
    role: 'measure',
    label: 'percent_adults',
    unitState: 'inferred_from_name',
  }), { code: 'UNIT_INFERRED_FROM_NAME' });
});

test('coverage totals reconcile and high-volume Census cannot hide missing CMS/CDC semantics', () => {
  const census = Array.from({ length: 20 }, (_, index) => representConservativeMeaning({
    source: 'census',
    release: 'acs5-2023',
    role: 'measure',
    label: `CENSUS_${index}`,
    definition: 'Literal ACS definition',
    unit: 'person',
    evidenceIds: ['evidence:test:census-unit'],
  })).map((meaning, index) => ({ id: `census-${index}`, meaning }));
  const cms = representConservativeMeaning({
    source: 'cms',
    release: 'hcris-2023',
    role: 'measure',
    label: 'Total Salaries',
    definition: 'Total Salaries',
  });
  const cdc = representConservativeMeaning({
    source: 'cdc',
    release: 'places-2023',
    role: 'rate',
    label: 'Crude Prevalence',
    definition: 'Percent of adults',
  });
  const coverage = reportFieldMeaningCoverage([
    ...census,
    { id: 'cms-salaries', meaning: cms, conflicting_codebook: true },
    { id: 'cdc-prevalence', meaning: cdc },
  ]);
  assert.equal(coverage.record_count, 22);
  assert.equal(coverage.totals.fields, 22);
  assert.equal(coverage.by_source.census, 20);
  assert.equal(coverage.by_source.cms, 1);
  assert.equal(coverage.by_source.cdc, 1);
  assert.equal(coverage.reconciled, true);
  assert.ok(coverage.groups.description_equals_label.includes('cms-salaries'));
  assert.ok(coverage.groups.unsupported_unit.includes('cdc-prevalence'));
  assert.ok(coverage.groups.conflicting_codebook.includes('cms-salaries'));
  assert.deepEqual([...coverage.census_cannot_hide_cms_cdc.cms_cdc_missing_semantics].sort(), ['cdc-prevalence', 'cms-salaries']);
  assert.equal(coverage.census_cannot_hide_cms_cdc.hidden, false);
  assert.equal(coverage.publication_authorized, false);
});

test('no model is required for literal extraction and live fetch is forbidden', async () => {
  const codebook = extractCodebookEvidence({ table: [{ code: '001', label: 'A' }] });
  assert.equal(codebook.rows[0].code, '001');
  await assert.rejects(() => blockedFetch('https://api.census.gov'), { code: 'FIELD_MEANING_LIVE_NETWORK_FORBIDDEN' });
});
