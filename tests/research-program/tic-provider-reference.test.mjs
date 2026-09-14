import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachReferenceCompleteness,
  loadOfficialInNetworkExample,
  refuseCrossFileJoin,
  refuseNameInventedGroup,
  refuseNpiAsHospitalCcn,
  refuseReferenceAsNpiOrCcn,
  resolveProviderReferences,
  scopedReferenceId,
} from '../../packages/connectors/mrf/payer-provider-reference.mjs';
import { extractInNetworkRates } from '../../packages/connectors/mrf/payer-in-network.mjs';

const example = loadOfficialInNetworkExample();

test('equal numeric reference IDs in different files cannot be joined accidentally', () => {
  const left = scopedReferenceId({ fileId: 'file-a', version: '2.0.0', providerGroupId: 1 });
  const right = scopedReferenceId({ fileId: 'file-b', version: '2.0.0', providerGroupId: 1 });
  assert.notEqual(left.scoped_key, right.scoped_key);
  assert.equal(left.not_npi, true);
  assert.equal(left.not_hospital_ccn, true);
  assert.throws(() => refuseCrossFileJoin(left, right), { code: 'EQUAL_NUMERIC_REFERENCE_IDS_CANNOT_JOIN_ACROSS_FILES' });
  assert.throws(() => refuseReferenceAsNpiOrCcn({ provider_group_id: 1, treated_as_npi: true }), { code: 'PROVIDER_REFERENCE_ID_IS_NOT_NPI' });
  assert.throws(() => refuseReferenceAsNpiOrCcn({ provider_group_id: 1, treated_as_hospital_ccn: true }), { code: 'PROVIDER_REFERENCE_ID_IS_NOT_HOSPITAL_CCN' });
});

test('a missing referenced object yields an unresolved association; no provider group is invented from a hospital name', () => {
  const missing = resolveProviderReferences({
    ...example,
    in_network: [{
      ...example.in_network[0],
      negotiated_rates: [{ provider_references: [1, 99], negotiated_prices: example.in_network[0].negotiated_rates[0].negotiated_prices }],
    }],
  }, { fileId: 'official-in-network-sample' });
  assert.equal(missing.unresolved_count, 1);
  assert.equal(missing.unresolved[0].provider_group_id, 99);
  assert.equal(missing.unresolved[0].invented, false);
  assert.throws(() => refuseNameInventedGroup({ invented_from_hospital_name: true }), { code: 'NO_PROVIDER_GROUP_FROM_HOSPITAL_NAME' });
  assert.throws(() => resolveProviderReferences(example, { maxReferences: 1 }), { code: 'REFERENCE_COUNT_LIMIT' });
});

test('an NPI-bearing rate does not automatically map to a hospital CCN or a complete facility roster', () => {
  const resolved = resolveProviderReferences(example, { fileId: 'official-in-network-sample' });
  assert.equal(resolved.resolved_count >= 1, true);
  assert.equal(resolved.implicit_cross_source_merge, false);
  const rates = extractInNetworkRates(example, { maxItems: 5 });
  const completeness = attachReferenceCompleteness(rates, resolved);
  assert.equal(completeness.npi_present, true);
  assert.equal(completeness.maps_to_hospital_ccn, false);
  assert.equal(completeness.complete_facility_roster, false);
  assert.equal(completeness.facility_mapping, 'separate_qualified_join');
  assert.throws(() => refuseNpiAsHospitalCcn({ npi_maps_to_hospital_ccn: true }), { code: 'NPI_BEARING_RATE_DOES_NOT_MAP_TO_HOSPITAL_CCN' });
  assert.throws(() => refuseNpiAsHospitalCcn({ complete_facility_roster: true }), { code: 'NPI_IS_NOT_COMPLETE_FACILITY_ROSTER' });
});
