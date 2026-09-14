import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPANSION_FAMILY_COUNT,
  REPEATED_TITLE_CASES,
  contextualMention,
  expansionFamilyCoverage,
  groupReleaseFamilies,
  loadNamedSourceRegistry,
  namedSourceResult,
  refuseSimilarCatalogText,
  resolveNamedSource,
  titleDelete,
  titleMerge,
} from '../../packages/enrichment/named-sources.mjs';

const registry = loadNamedSourceRegistry();

test('MEPS/HCUP/NPPES/PHC4 exact-name fixtures cannot resolve to unrelated descriptions mentioning similar words', () => {
  const meps = resolveNamedSource('Find MEPS public use files', registry);
  assert.equal(meps.exact, true);
  assert.equal(meps.sources[0].source_id, 'ahrq-meps');
  const similarMeps = refuseSimilarCatalogText('Find MEPS', {
    title: 'Medical expenditure estimates for hospitals',
    description: 'Hospital spending and medical expenditure context without the survey product.',
  }, registry);
  assert.equal(similarMeps.catalog_is_not_the_named_source, true);

  const hcup = resolveNamedSource('Find HCUP', registry);
  assert.equal(hcup.sources[0].source_id, 'ahrq-hcup');
  const similarHcup = refuseSimilarCatalogText('Find HCUP', {
    title: 'Healthcare cost reports',
    description: 'Utilization project notes in a different catalog family.',
  }, registry);
  assert.equal(similarHcup.catalog_is_not_the_named_source, true);

  const nppes = resolveNamedSource('Need NPPES downloadable files', registry);
  assert.equal(nppes.sources[0].source_id, 'cms-nppes');
  assert.equal(nppes.sources[0].catalog_membership, false);
  const similarNppes = refuseSimilarCatalogText('Need NPPES', {
    title: 'National provider directory excerpt',
    description: 'Provider enumeration mentioned in passing.',
  }, registry);
  assert.equal(similarNppes.catalog_is_not_the_named_source, true);

  const phc4 = resolveNamedSource('PHC4 hospital financial reports', registry);
  assert.equal(phc4.sources[0].source_id, 'pa-phc4');
  const similarPhc4 = refuseSimilarCatalogText('PHC4', {
    title: 'Pennsylvania health care cost study',
    description: 'Statewide hospital spending estimates with no named council product.',
  }, registry);
  assert.equal(similarPhc4.catalog_is_not_the_named_source, true);

  const coverage = expansionFamilyCoverage(registry);
  assert.equal(coverage.expansion_family_count >= EXPANSION_FAMILY_COUNT, true);
  assert.equal(coverage.not_yet_indexed_without_invented_membership, true);
});

test('the 579 repeated-title cases are accounted for; title equality alone never deletes or merges a record', () => {
  const grouped = groupReleaseFamilies([
    { record_id: 'a', title: 'Hospital Cost Report' },
    { record_id: 'b', title: 'Hospital Cost Report' },
    { record_id: 'c', title: 'Different Title' },
  ], { repeatedTitleCount: REPEATED_TITLE_CASES });
  assert.equal(grouped.repeated_title_cases_accounted, 579);
  assert.equal(grouped.title_equality_merged, false);
  assert.equal(grouped.title_equality_deleted, false);
  assert.ok(grouped.ambiguous_title_matches.every((item) => item.status === 'candidate' && item.merged === false && item.deleted === false));
  assert.throws(() => titleMerge({ record_id: 'a', title: 'Same' }, { record_id: 'b', title: 'Same' }), { code: 'TITLE_EQUALITY_MUST_NOT_MERGE' });
  assert.throws(() => titleDelete({ record_id: 'a', title: 'Same' }, 'Same'), { code: 'TITLE_EQUALITY_MUST_NOT_DELETE' });
});

test('an unavailable named source returns a specific bounded coverage explanation, not a fabricated exact match', () => {
  const meps = registry.sources.find((source) => source.source_id === 'ahrq-meps');
  const gap = namedSourceResult(meps);
  assert.equal(gap.result_state, 'coverage_gap');
  assert.equal(gap.fabricated, false);
  assert.match(gap.explanation, /not indexed/i);
  assert.equal(gap.catalog_membership, false);
  assert.equal(gap.family_recognition, true);

  const hcris = registry.sources.find((source) => source.source_id === 'cms-hcris');
  const exact = namedSourceResult(hcris);
  assert.equal(exact.result_state, 'exact');
  assert.notEqual(exact.catalog_membership, exact === gap);

  const mention = contextualMention({ record_id: 'other' }, meps);
  assert.equal(mention.result_state, 'contextual');
  assert.equal(mention.exact, false);
});
