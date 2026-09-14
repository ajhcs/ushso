import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMrfProfile,
  defineMrfIdentity,
  indexNegotiatedRateQuery,
  publishMrfCoverage,
} from '../../packages/registry/mrf-repository.mjs';
import { refuseSampleAsCompletePublication } from '../../packages/coverage/research-program/v1.0.0/src/mrf-coverage.mjs';

test('a profile can explain a blocked file without claiming a sample exists; separate files/releases retain stable identities', () => {
  const a = defineMrfIdentity({ entityId: '103301', releaseId: '2026-04-01', fileType: 'hospital_json' });
  const b = defineMrfIdentity({ entityId: '103301', releaseId: '2025-04-01', fileType: 'hospital_json' });
  assert.notEqual(a.stable_key, b.stable_key);
  const blocked = createMrfProfile({
    entityId: '67190',
    releaseId: '2026-01-01',
    fileType: 'in_network',
    entity_kind: 'payer',
    disposition: 'blocked',
    accessible: false,
    blocked_reason: 'inaccessible_bulk_file',
  });
  assert.equal(blocked.sample_exists, false);
  assert.equal(blocked.disposition, 'blocked');
  assert.equal(blocked.source_card.tested_state, 'failed');
  assert.throws(() => createMrfProfile({
    entityId: '67190',
    releaseId: '2026-01-01',
    fileType: 'in_network',
    disposition: 'blocked',
    sample_exists: true,
  }), { code: 'BLOCKED_FILE_CANNOT_CLAIM_SAMPLE' });
});

test('a query for negotiated rate files does not lead with enforcement outcomes as a compatible file', () => {
  const indexed = indexNegotiatedRateQuery([
    { product_key: 'cms-hospital-price-transparency-enforcement', file_type: 'enforcement', satisfies_rate_file: false },
    { product_key: 'payer-in-network', file_type: 'in_network', rate_type: 'negotiated' },
  ]);
  assert.equal(indexed.results[0].file_type, 'in_network');
  assert.equal(indexed.enforcement_not_leading_compatible_file, true);
  assert.throws(() => indexNegotiatedRateQuery([
    { product_key: 'cms-hospital-price-transparency-enforcement', satisfies_rate_file: true },
  ]), { code: 'ENFORCEMENT_IS_NOT_RATE_FILE' });
});

test('counts represent hospitals/reporting entities/files separately; shared files do not inflate provider coverage; an MRF sample is not a complete publication', () => {
  const coverage = publishMrfCoverage({
    hospitals: [{ id: '103301' }, { id: '050373' }],
    payers: [{ id: '67190' }, { id: '45845' }],
    files: [
      { locator: 'https://example.test/shared.json', stable_key: 'a' },
      { locator: 'https://example.test/shared.json', stable_key: 'b' },
      { locator: 'https://example.test/other.json', stable_key: 'c' },
    ],
  });
  assert.equal(coverage.hospital_count, 2);
  assert.equal(coverage.reporting_entity_count, 2);
  assert.equal(coverage.file_count, 2);
  assert.equal(coverage.shared_files_do_not_inflate_provider_coverage, true);
  assert.equal(coverage.complete_hospital_publication, false);
  assert.equal(coverage.complete_payer_publication, false);
  assert.throws(() => refuseSampleAsCompletePublication({ complete_hospital_publication: true }), { code: 'MRF_SAMPLE_IS_NOT_COMPLETE_PUBLICATION' });
  assert.throws(() => refuseSampleAsCompletePublication({ complete_payer_publication: true }), { code: 'MRF_SAMPLE_IS_NOT_COMPLETE_PUBLICATION' });
});
