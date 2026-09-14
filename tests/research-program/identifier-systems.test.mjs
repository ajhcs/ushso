import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIXTURES,
  attachKeyRole,
  defineIdentifier,
  matchIdentifiers,
  preserveLeadingZeros,
  refuseNameMerge,
} from '../../packages/enrichment/identifier-systems.mjs';

test('CCN and NPI are never interchangeable; equal strings from different systems do not establish identity; leading zeros are preserved', () => {
  assert.equal(preserveLeadingZeros('12345', 'ccn'), '012345');
  assert.equal(FIXTURES.ccn.value.startsWith('0'), true);
  assert.equal(FIXTURES.npi.value.length, 10);
  const cross = matchIdentifiers(FIXTURES.same_digits_ccn, FIXTURES.same_digits_npi);
  assert.equal(cross.exact, false);
  assert.equal(cross.identity_established, false);
  assert.equal(cross.reason, 'DIFFERENT_IDENTIFIER_SYSTEMS');
  const same = matchIdentifiers(FIXTURES.ccn, defineIdentifier({ system: 'ccn', value: '012345' }));
  assert.equal(same.exact, true);
});

test('a sample unique identifier is not certified globally; composite facility/report/year keys remain composite', () => {
  assert.equal(FIXTURES.composite.role, 'composite_key');
  assert.equal(FIXTURES.composite.composite, true);
  assert.equal(FIXTURES.composite.globally_certified, false);
  assert.equal(FIXTURES.composite.evidence_scope, 'sampled');
  assert.throws(() => attachKeyRole('npi', { role: 'candidate_key', evidence_scope: 'full_release', sample_unique: true }), { code: 'SAMPLE_UNIQUENESS_NOT_GLOBAL' });
  const sampled = attachKeyRole('report_id', { role: 'candidate_key', evidence_scope: 'sampled', sample_unique: true, documentation: 'page sample' });
  assert.equal(sampled.globally_certified, false);
});

test('an identifier match outside its applicability period is ambiguous or incompatible, not exact; no name-based merge', () => {
  const outside = matchIdentifiers(FIXTURES.retired, FIXTURES.reused, { at: '2012-06-01' });
  assert.equal(outside.exact, false);
  assert.equal(outside.status, 'ambiguous_or_incompatible');
  const insideRetired = matchIdentifiers(FIXTURES.retired, FIXTURES.retired, { at: '2005-01-01' });
  assert.equal(insideRetired.exact, true);
  const names = refuseNameMerge({ left_name: 'General Hospital', right_name: 'General Hospital' });
  assert.equal(names.merged, false);
  assert.equal(names.reason, 'NAME_BASED_MERGE_FORBIDDEN');
});
