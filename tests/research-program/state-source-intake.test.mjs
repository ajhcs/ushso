import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNamedSourceRegistry, resolveNamedSource } from '../../packages/enrichment/named-sources.mjs';
import {
  LAST_GOOD_GENERATION,
  configurePortal,
  evaluateStateIntake,
  loadStateFamilies,
  pennsylvaniaFinanceCard,
  refuseAllStateCompleteness,
  refuseFamiliarTitleAuthority,
} from '../../packages/connectors/source-registry/state-intake.mjs';

const families = loadStateFamilies();
const registry = loadNamedSourceRegistry();
const byId = Object.fromEntries(families.families.map((family) => [family.family_id, family]));

test("one state's coverage never implies all-state completeness; publisher authority is not inferred from a familiar title", () => {
  const result = evaluateStateIntake({ families: families.families, registry });
  assert.equal(result.family_count, 4);
  assert.equal(result.generation, LAST_GOOD_GENERATION);
  assert.equal(result.all_state_completeness, false);
  assert.equal(result.national_completeness_from_pilot, false);
  const apcd = byId['state-apcd-programs'];
  assert.deepEqual(apcd.jurisdictions, ['US-MA']);
  assert.throws(() => refuseAllStateCompleteness(apcd, { claimNational: true }), { code: 'ONE_STATE_IS_NOT_NATIONAL_COMPLETENESS' });
  assert.throws(() => refuseAllStateCompleteness({ ...apcd, implies_all_state_completeness: true }), { code: 'ONE_STATE_IS_NOT_NATIONAL_COMPLETENESS' });
  assert.throws(() => refuseFamiliarTitleAuthority({
    title: 'Pennsylvania health care cost study',
    operator: 'Unrelated catalog publisher',
    infer_publisher_from_title: false,
  }, byId['pa-phc4']), { code: 'PUBLISHER_AUTHORITY_NOT_INFERRED_FROM_TITLE' });
  const sheps = byId['rural-hospital-closure-tracking'];
  assert.equal(sheps.nongovernmental, true);
  assert.match(sheps.operator, /Sheps Center/);
});

test('a known portal/API boundary has a fixture and budget; scraping a public page does not bypass an application or DUA', () => {
  for (const family of families.families) {
    const portal = configurePortal(family);
    assert.equal(portal.configured, true);
    assert.ok(portal.fixture);
    assert.equal(portal.scrape_bypasses_application_or_dua, false);
    assert.equal(portal.retrieval_authorized, false);
    assert.ok(portal.budget);
  }
  assert.equal(configurePortal(byId['pa-phc4']).application_or_dua_path.includes('data-request'), true);
  assert.throws(() => configurePortal({ ...byId['state-apcd-programs'], scrape_bypasses_application_or_dua: true }), { code: 'SCRAPE_DOES_NOT_BYPASS_APPLICATION_OR_DUA' });
  const scrape = configurePortal({ family_id: 'pa-phc4', adapter_port: 'unbounded_scraper' });
  assert.equal(scrape.configured, false);
  assert.equal(scrape.scraper_forbidden, true);
});

test('the Pennsylvania finance task returns PHC4 alongside HCRIS without identical reporting definitions or unrestricted payload access', () => {
  const card = pennsylvaniaFinanceCard(families.families);
  assert.deepEqual(card.families.map((row) => row.family_id).sort(), ['cms-hcris', 'pa-phc4']);
  assert.equal(card.identical_reporting_definitions, false);
  assert.equal(card.unrestricted_payload_access, false);
  const phc4 = resolveNamedSource('PHC4 hospital financial reports', registry);
  assert.equal(phc4.sources[0].source_id, 'pa-phc4');
  const result = evaluateStateIntake({ families: families.families, registry });
  assert.equal(result.pennsylvania_finance.identical_reporting_definitions, false);
});
