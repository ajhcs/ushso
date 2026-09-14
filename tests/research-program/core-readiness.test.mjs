import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LAST_GOOD_GENERATION,
  PRODUCT_DENOMINATOR,
  PUBLIC_SAMPLE_TARGET,
  essentialReadiness,
  evaluateCoreReadiness,
  loadCohort,
  productDenominator,
} from '../../scripts/research-program/core-readiness.mjs';

const cohort = loadCohort();

test('annual releases do not inflate the 100-product denominator; missing essential context remains a named blocker', () => {
  assert.equal(cohort.products.length, PRODUCT_DENOMINATOR);
  const denom = productDenominator(cohort.products, {
    extraReleases: [{ product_key: 'cms-hcris-hospital-provider-cost-report', year: 2023 }],
  });
  assert.equal(denom.denominator, 100);
  assert.equal(denom.annual_releases_are_not_products, true);
  assert.throws(() => productDenominator(cohort.products, {
    extraReleases: [{ product_key: 'cms-hcris-hospital-provider-cost-report-2023', year: 2023 }],
  }), { code: 'ANNUAL_RELEASE_INFLATED_DENOMINATOR' });
  const intake = cohort.products.find((product) => product.product_key === 'nppes-npi-registry');
  const contextReady = essentialReadiness(intake);
  assert.equal(contextReady.research_ready, false);
});

test('a thousand populated optional fields cannot compensate for an unknown essential denominator or inaccessible recipe', () => {
  const hcris = cohort.products.find((product) => product.product_key === 'cms-hcris-hospital-provider-cost-report');
  const unknown = essentialReadiness(hcris, { optionalFields: 1000, unknownEssentialDenominator: true, publicSample: true });
  assert.equal(unknown.research_ready, false);
  assert.equal(unknown.code, 'UNKNOWN_ESSENTIAL_DENOMINATOR');
  assert.equal(unknown.optional_fields_cannot_compensate, true);
  const recipe = essentialReadiness(hcris, { optionalFields: 1000, inaccessibleRecipe: true, publicSample: true });
  assert.equal(recipe.code, 'INACCESSIBLE_RECIPE');
  assert.equal(recipe.public_sample_complete, true);
});

test('every incomplete priority product has a concrete next task; the program gate cannot waive it by adding more easy records', () => {
  const result = evaluateCoreReadiness(cohort);
  assert.equal(result.denominator, 100);
  assert.equal(result.last_good_generation_changed, false);
  assert.equal(result.generation, LAST_GOOD_GENERATION);
  assert.ok(result.public_sample_complete >= PUBLIC_SAMPLE_TARGET);
  assert.equal(result.r04_engineering_target_met, true);
  assert.equal(result.r04_accepted, false);
  assert.equal(result.r05_accepted, false);
  assert.ok(result.incomplete >= 1);
  assert.ok(result.deficits.every((row) => row.next_task && row.cannot_waive_by_adding_easy_records === true));
  assert.equal(result.gate_cannot_waive_by_adding_easy_records, true);
  const publicAndRestricted = result.rows.filter((row) => row.readiness.public_sample_complete && row.readiness.restricted_route_complete);
  assert.equal(publicAndRestricted.length, 0);
});
