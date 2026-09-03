import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENERATION_CURSOR_VERSION,
  decodeGenerationCursor,
  encodeGenerationCursor,
} from '../../../../packages/search/generation-cursor-v2.mjs';

const secret = 'wp8-generation-cursor-secret-with-at-least-32-bytes';

function createCursor(overrides = {}) {
  return encodeGenerationCursor({
    publicationManifestId: 'publication:wp8-fixture:a',
    generationId: 'generation:asset_search:a',
    projectionType: 'asset_search',
    sort: { rank_micros: 500000, canonical_id: 'asset:fixture', document_id: 'document:asset:fixture' },
    issuedAt: '2026-08-30T22:00:00.000Z',
    expiresAt: '2026-08-30T22:15:00.000Z',
    generationRetainedUntil: '2026-10-01T00:00:00.000Z',
    secret,
    ...overrides,
  });
}

test('cursor is signed, bounded, generation-pinned, and contains no raw query', () => {
  const cursor = createCursor();
  assert.ok(Buffer.byteLength(cursor, 'utf8') < 4096);
  const decoded = decodeGenerationCursor(cursor, {
    secret,
    observedAt: '2026-08-30T22:10:00.000Z',
    expectedPublicationManifestId: 'publication:wp8-fixture:a',
    expectedGenerationId: 'generation:asset_search:a',
    expectedProjectionType: 'asset_search',
  });
  assert.equal(decoded.cursor_version, GENERATION_CURSOR_VERSION);
  assert.equal('query' in decoded, false);
  assert.equal('filters' in decoded, false);
  assert.equal(decoded.sort.rank_micros, 500000);
});

test('tampering, expiry, and cross-generation reuse fail closed', () => {
  const cursor = createCursor();
  const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('a') ? 'b' : 'a'}`;
  assert.throws(() => decodeGenerationCursor(tampered, { secret, observedAt: '2026-08-30T22:10:00.000Z' }), error => error.code === 'CURSOR_SIGNATURE_INVALID');
  assert.throws(() => decodeGenerationCursor(cursor, { secret, observedAt: '2026-08-30T22:15:00.000Z' }), error => error.code === 'CURSOR_EXPIRED' && error.restart_required === true);
  assert.throws(() => decodeGenerationCursor(cursor, {
    secret,
    observedAt: '2026-08-30T22:10:00.000Z',
    expectedGenerationId: 'generation:asset_search:b',
  }), error => error.code === 'CURSOR_GENERATION_MISMATCH' && error.restart_required === true);
});

test('cursor lifetime cannot exceed the fixed TTL or generation retention', () => {
  assert.throws(() => createCursor({ expiresAt: '2026-08-30T22:15:01.000Z' }), error => error.code === 'CURSOR_TTL_INVALID');
  assert.throws(() => createCursor({
    expiresAt: '2026-08-30T22:10:00.000Z',
    generationRetainedUntil: '2026-08-30T22:09:59.000Z',
  }), error => error.code === 'CURSOR_EXCEEDS_GENERATION_RETENTION');
  assert.throws(() => createCursor({ secret: 'short' }), error => error.code === 'CURSOR_SECRET_TOO_SHORT');
});
