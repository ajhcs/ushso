import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOSPITAL_DENOMINATOR,
  LAST_GOOD_GENERATION,
  collectDocumentedLink,
  defineHospitalMrfIdentity,
  loadFrozenHospitalIds,
  loadHospitalCohort,
  reconcileHospitalCohort,
  refuseEnforcementAsRateFile,
  refuseSystemLandingPageAsOwnedFiles,
} from '../../packages/connectors/mrf/hospital-registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cohorts = JSON.parse(readFileSync(path.join(root, 'evaluation/research-program/cohorts.json'), 'utf8'));
const local = loadHospitalCohort();

test('a health-system landing page is not counted as a verified file for every hospital it owns', () => {
  const nicklaus = local.hospitals.find((row) => row.candidate_id === '103301');
  const identity = defineHospitalMrfIdentity(nicklaus, { locator: 'https://example.test/system/price-transparency', format: 'html_landing_page', declaredSchema: 'v3.0' });
  assert.equal(identity.verified_file, false);
  assert.throws(() => refuseSystemLandingPageAsOwnedFiles({
    kind: 'health_system_landing_page',
    locator: 'https://example.test/system/price-transparency',
    verified_for_every_owned_hospital: true,
  }, ['103301', '050373']), { code: 'LANDING_PAGE_IS_NOT_VERIFIED_FILE_FOR_EVERY_OWNED_HOSPITAL' });
  const distinct = defineHospitalMrfIdentity(nicklaus, { declaredSchema: 'v3.0', detectedSchema: 'v2.0', format: 'json', locator: 'https://example.test/103301.json' });
  assert.equal(distinct.schema_versions_distinct, true);
});

test('broken links, redirect gates and unexpected formats receive typed outcomes; no crawler explores arbitrary sites; full-size download needs a budget', () => {
  assert.equal(collectDocumentedLink({ candidate_id: '103301', outcome: 'broken_link' }).outcome, 'broken_link');
  assert.equal(collectDocumentedLink({ candidate_id: '103301', outcome: 'redirect_gate' }).outcome, 'redirect_gate');
  assert.equal(collectDocumentedLink({ candidate_id: '103301', outcome: 'unexpected_format', media_type: 'application/pdf' }).outcome, 'unexpected_format');
  assert.throws(() => collectDocumentedLink({ outcome: 'ok', crawler_explores_arbitrary_sites: true }), { code: 'NO_ARBITRARY_CRAWLER' });
  assert.throws(() => collectDocumentedLink({ outcome: 'discovered_file', full_size_download: true, budget_decision: false }), { code: 'FULL_SIZE_MRF_REQUIRES_BUDGET' });
});

test('all 25 hospitals remain in the denominator, including failures; an enforcement dataset cannot satisfy a rate-file entry', () => {
  const ids = loadFrozenHospitalIds(cohorts);
  assert.equal(ids.length, HOSPITAL_DENOMINATOR);
  assert.deepEqual(ids, local.ids);
  const dispositions = ids.map((id, index) => ({
    candidate_id: id,
    outcome: index === 0 ? 'discovered_file' : 'unresolved',
    accessible: index === 0,
    declared_schema_version: index === 0 ? 'v3.0' : null,
    format: index === 0 ? 'json' : null,
  }));
  const summary = reconcileHospitalCohort(ids, dispositions);
  assert.equal(summary.selected, 25);
  assert.equal(summary.discovered, 1);
  assert.equal(summary.unresolved, 24);
  assert.equal(summary.denominator_includes_failures, true);
  assert.equal(summary.generation, LAST_GOOD_GENERATION);
  assert.throws(() => reconcileHospitalCohort(ids, dispositions.slice(1)), { code: 'DENOMINATOR_SHRUNK' });
  assert.throws(() => refuseEnforcementAsRateFile({ product_key: 'cms-hospital-price-transparency-enforcement', satisfies_rate_file: true }), { code: 'ENFORCEMENT_IS_NOT_RATE_FILE' });
});
