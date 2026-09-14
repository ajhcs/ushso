import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  FROZEN_PAYER_IDS,
  HOSPITAL_HPT_SCHEMA_FAMILY,
  PAYER_DENOMINATOR,
  PAYER_TIC_SCHEMA_FAMILY,
  classifyFileType,
  loadFrozenPayerIds,
  loadOfficialTocExample,
  loadPayerCohort,
  loadPinnedTocSchema,
  parseTableOfContents,
  reconcilePayerCohort,
  reconcileSharedFiles,
  recordPayerDisposition,
  refuseHospitalSchemaAsPayer,
  refuseIdentitySubstitution,
} from '../../packages/connectors/mrf/payer-index.mjs';

const cohorts = JSON.parse(readFileSync('evaluation/research-program/cohorts.json', 'utf8'));
const cohort = loadPayerCohort();
const example = loadOfficialTocExample();
const schema = loadPinnedTocSchema();

test('an employer plan ID, insurer identity and hospital identity cannot be substituted for one another', () => {
  assert.equal(loadFrozenPayerIds(cohorts).length, PAYER_DENOMINATOR);
  assert.deepEqual([...loadFrozenPayerIds(cohorts)], [...FROZEN_PAYER_IDS]);
  assert.equal(cohort.ids.length, 10);
  assert.throws(() => refuseIdentitySubstitution({ employerPlanId: '12-3456789', insurerIdentity: '12-3456789' }), { code: 'EMPLOYER_PLAN_ID_IS_NOT_INSURER_IDENTITY' });
  assert.throws(() => refuseIdentitySubstitution({ employerPlanId: '103301', hospitalIdentity: '103301' }), { code: 'EMPLOYER_PLAN_ID_IS_NOT_HOSPITAL_IDENTITY' });
  assert.throws(() => refuseIdentitySubstitution({ insurerIdentity: '67190', hospitalIdentity: '67190' }), { code: 'INSURER_IDENTITY_IS_NOT_HOSPITAL_IDENTITY' });
  const kept = refuseIdentitySubstitution({ employerPlanId: '12-3456789', insurerIdentity: '67190', hospitalIdentity: '103301' });
  assert.equal(kept.substitutable, false);
});

test('the same file linked by many plans is fetched once but retains all supported plan associations', () => {
  assert.equal(example.synthetic, true);
  assert.equal(schema.$id.includes('table-of-contents'), true);
  const parsed = parseTableOfContents(example);
  const shared = parsed.files.find((file) => file.location.includes('in-network-file-123456.json'));
  assert.equal(shared.fetch_once ?? shared.fetched_once, true);
  assert.equal(shared.plan_associations.length, 2);
  assert.deepEqual(shared.plan_associations.map((plan) => plan.plan_id).sort(), ['000000000', '1111111111']);
  const summary = reconcileSharedFiles(parsed);
  assert.equal(summary.fetched_once, true);
  assert.equal(summary.plan_associations_retained, true);
});

test('all ten reporting entities are accounted for; an inaccessible bulk file remains a valid documented route with failed sample state', () => {
  const dispositions = FROZEN_PAYER_IDS.map((id, index) => recordPayerDisposition({
    candidate_id: id,
    outcome: index === 0 ? 'inaccessible_bulk_file' : 'discovered_index',
    locator: index === 0 ? null : `https://example.test/tic/${id}/index.json`,
    file_type: 'in_network',
    declared_version: '2.2.1',
  }));
  const ledger = reconcilePayerCohort(FROZEN_PAYER_IDS, dispositions);
  assert.equal(ledger.selected, 10);
  assert.equal(ledger.denominator, 10);
  assert.equal(ledger.inaccessible, 1);
  assert.equal(ledger.denominator_includes_failures, true);
  assert.equal(ledger.inaccessible_bulk_file_remains_documented_route, true);
  assert.equal(dispositions[0].sample_state, 'failed');
  assert.equal(dispositions[0].documented_route, true);
  assert.throws(() => reconcilePayerCohort(FROZEN_PAYER_IDS, dispositions.slice(1)), { code: 'DENOMINATOR_SHRUNK' });
  assert.throws(() => reconcilePayerCohort(FROZEN_PAYER_IDS, [...dispositions, { candidate_id: '99999', outcome: 'discovered_index' }]), { code: 'REPLACEMENT_FORBIDDEN' });
});

test('hospital HPT and payer TiC schemas remain separate; allowed-amount files are discoverable without in-network validation', () => {
  assert.notEqual(HOSPITAL_HPT_SCHEMA_FAMILY, PAYER_TIC_SCHEMA_FAMILY);
  assert.throws(() => refuseHospitalSchemaAsPayer({ schema_family: HOSPITAL_HPT_SCHEMA_FAMILY, treated_as_payer_tic: true }), { code: 'HOSPITAL_HPT_IS_NOT_PAYER_TIC' });
  const allowed = classifyFileType({ description: 'allowed amount file', location: 'https://www.some_site.com/files/allowed-amount-file-987665.json', file_type: 'allowed_amount' });
  assert.equal(allowed.file_type, 'allowed_amount');
  assert.equal(allowed.discoverable, true);
  assert.equal(allowed.in_network_parser_validates, false);
  assert.throws(() => recordPayerDisposition({
    candidate_id: '67190',
    outcome: 'discovered_index',
    file_type: 'allowed_amount',
    in_network_parser_validates: true,
  }), { code: 'ALLOWED_AMOUNT_NOT_VALIDATED_BY_IN_NETWORK_PARSER' });
  const parsed = parseTableOfContents(example);
  const allowedFile = parsed.files.find((file) => file.file_type === 'allowed_amount');
  assert.equal(allowedFile.in_network_parser_validates, false);
  assert.equal(parsed.hospital_hpt_and_payer_tic_remain_separate, true);
});
