import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyManagedAuthorizationReceipt } from '../src/database-import.mjs';

const now = Date.parse('2026-08-30T20:00:00.000Z');
const parameters = Object.freeze({
  import_id: 'urn:ushso:import:example',
  document_fingerprint: `sha256:${'a'.repeat(64)}`,
  bundle_fingerprint: `sha256:${'b'.repeat(64)}`,
  projection_fingerprint: `sha256:${'c'.repeat(64)}`,
  normalizer_name: 'legacy-corpus-normalizer',
  normalizer_version: '1.0.0'
});
const expected = Object.freeze({
  environment: 'staging',
  database: 'ushso',
  deploymentFingerprint: 'd'.repeat(64),
  action: 'normalization_import_v1_1_0',
  parameters
});
const valid = Object.freeze({
  receipt_version: 'ushso-normalization-managed-authorization.v1.0.0',
  authorization_id: 'authorization:wp6:staging-import',
  authorized: true,
  environment: expected.environment,
  database: expected.database,
  deployment_fingerprint: expected.deploymentFingerprint,
  action: expected.action,
  parameters,
  reviewer: 'independent-release-reviewer',
  approved_at: '2026-08-30T19:30:00.000Z',
  expires_at: '2026-08-30T20:30:00.000Z'
});

test('managed authorization is exact, current, and parameter-bound', () => {
  assert.equal(verifyManagedAuthorizationReceipt(valid, expected, { now }).authorizationId, valid.authorization_id);
  const attacks = [
    { ...valid, extra: true },
    { ...valid, environment: 'production' },
    { ...valid, database: 'other' },
    { ...valid, deployment_fingerprint: 'e'.repeat(64) },
    { ...valid, action: 'normalization_import_reject' },
    { ...valid, parameters: { ...parameters, document_fingerprint: `sha256:${'f'.repeat(64)}` } },
    { ...valid, parameters: { ...parameters, extra: true } },
    { ...valid, approved_at: '2026-08-30T20:01:00.000Z' },
    { ...valid, expires_at: '2026-08-30T20:00:00.000Z' },
    { ...valid, expires_at: '2026-09-01T20:00:00.000Z' }
  ];
  for (const attack of attacks) {
    assert.throws(() => verifyManagedAuthorizationReceipt(attack, expected, { now }), /authorization receipt/u);
  }
});

