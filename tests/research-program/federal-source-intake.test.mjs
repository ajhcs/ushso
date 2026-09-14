import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNamedSourceRegistry, resolveNamedSource } from '../../packages/enrichment/named-sources.mjs';
import {
  LAST_GOOD_GENERATION,
  configureAdapter,
  evaluateFamilyQuestion,
  evaluateFederalIntake,
  loadFederalFamilies,
  refuseAspeAsAtsdrSvi,
  refuseTafPublicSummary,
} from '../../packages/connectors/source-registry/federal-intake.mjs';

const families = loadFederalFamilies();
const registry = loadNamedSourceRegistry();
const byId = Object.fromEntries(families.families.map((family) => [family.family_id, family]));

test('every locator is publisher-supported; TAF restricted research files are not confused with public summary products', () => {
  const result = evaluateFederalIntake({ families: families.families, registry });
  assert.equal(result.family_count, 5);
  assert.equal(result.generation, LAST_GOOD_GENERATION);
  assert.equal(result.taf_access_asserted, false);
  const taf = byId['cms-tmsis-taf'];
  assert.equal(taf.access_class, 'restricted_research_files');
  assert.equal(taf.public_medicaid_summary_is_not_taf, true);
  assert.throws(() => refuseTafPublicSummary('Medicaid managed care enrollment', {
    title: 'Medicaid Managed Care enrollment',
    product_class: 'public_medicaid_summary',
  }, taf), { code: 'TAF_RESTRICTED_NOT_PUBLIC_SUMMARY' });
  const nppes = byId['cms-nppes'];
  assert.equal(nppes.npi_is_not_ccn, true);
});

test('each family has a literal configuration and fixture; an unsupported protocol produces a specific extension task rather than a scraper', () => {
  for (const family of families.families) {
    const configured = configureAdapter(family);
    assert.equal(configured.configured, true);
    assert.ok(configured.fixture);
    assert.equal(configured.retrieval_authorized, false);
  }
  const scrape = configureAdapter({ family_id: 'cms-nppes', adapter_port: 'unbounded_scraper' });
  assert.equal(scrape.configured, false);
  assert.equal(scrape.code, 'UNSUPPORTED_PROTOCOL_EXTENSION_REQUIRED');
  assert.equal(scrape.scraper_forbidden, true);
  assert.match(scrape.extension_task, /PR-043-extension-cms-nppes-unbounded_scraper/);
});

test('original NPPES/AHRF/SAMHSA/SVI questions identify the intended family and exact restrictions remain visible', () => {
  const cases = [
    ['Need NPPES downloadable files', 'cms-nppes'],
    ['Find AHRF county workforce files', 'hrsa-ahrf'],
    ['SAMHSA facility locator', 'samhsa-facility-services'],
    ['ATSDR SVI county ranks', 'cdc-atsdr-svi'],
  ];
  for (const [question, familyId] of cases) {
    const family = byId[familyId];
    const identified = evaluateFamilyQuestion(question, registry, family);
    assert.equal(identified.identified, true);
    assert.equal(identified.named_source_id, family.named_source_id);
    assert.equal(identified.catalog_membership, false);
    assert.equal(identified.restrictions_visible, true);
    const resolved = resolveNamedSource(question, registry);
    assert.equal(resolved.sources[0].source_id, family.named_source_id);
  }
  const aspe = refuseAspeAsAtsdrSvi({
    title: 'HHS ASPE Social Vulnerability Index',
    native_id: 'ypqf-r5qs',
  });
  assert.equal(aspe.catalog_is_not_atsdr_svi, true);
  assert.equal(aspe.reason, 'ASPE_SVI_IS_NOT_ATSDR_SVI');
});
