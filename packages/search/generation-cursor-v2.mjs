import crypto from 'node:crypto';
import { canonicalizeJson } from '../../contracts/tooling/v1.0.0/src/canonical-json.mjs';
import { parseStrictJson } from '../../contracts/tooling/v1.0.0/src/strict-json.mjs';
import { SEARCH_PROJECTION_TYPES } from './projection-v2.mjs';

export const GENERATION_CURSOR_VERSION = 'ushso-search-cursor.v2.0.0';
const MAX_CURSOR_BYTES = 4096;
const MAX_CURSOR_TTL_MS = 15 * 60 * 1000;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u;

export class SearchCursorError extends Error {
  constructor(code, detail, { restartRequired = false } = {}) {
    super(`${code}${detail ? `:${detail}` : ''}`);
    this.name = 'SearchCursorError';
    this.code = code;
    this.detail = detail ?? null;
    this.restart_required = restartRequired;
  }
}

function fail(code, detail, options) {
  throw new SearchCursorError(code, detail, options);
}

function secretBytes(secret) {
  const bytes = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret ?? []);
  if (bytes.length < 32) fail('CURSOR_SECRET_TOO_SHORT');
  return bytes;
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secretBytes(secret)).update(payload).digest();
}

function assertTimestamp(value, label) {
  if (typeof value !== 'string' || !UTC.test(value) || Number.isNaN(Date.parse(value))) fail('CURSOR_TIMESTAMP_INVALID', label);
}

function assertPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('CURSOR_PAYLOAD_INVALID');
  const expected = ['cursor_version', 'expires_at', 'generation_id', 'issued_at', 'projection_type', 'publication_manifest_id', 'sort'];
  if (canonicalizeJson(Object.keys(value).sort()) !== canonicalizeJson(expected)) fail('CURSOR_FIELDS_INVALID');
  if (value.cursor_version !== GENERATION_CURSOR_VERSION) fail('CURSOR_VERSION_UNSUPPORTED');
  if (!SEARCH_PROJECTION_TYPES.includes(value.projection_type)) fail('CURSOR_PROJECTION_TYPE_INVALID');
  for (const field of ['generation_id', 'publication_manifest_id']) {
    if (typeof value[field] !== 'string' || value[field].length < 3 || value[field].length > 192) fail('CURSOR_PIN_INVALID', field);
  }
  assertTimestamp(value.issued_at, 'issued_at');
  assertTimestamp(value.expires_at, 'expires_at');
  if (!value.sort || typeof value.sort !== 'object' || Array.isArray(value.sort)) fail('CURSOR_SORT_INVALID');
  if (canonicalizeJson(Object.keys(value.sort).sort()) !== canonicalizeJson(['canonical_id', 'document_id', 'rank_micros'])) fail('CURSOR_SORT_FIELDS_INVALID');
  if (!Number.isSafeInteger(value.sort.rank_micros) || value.sort.rank_micros < 0) fail('CURSOR_SORT_RANK_INVALID');
  for (const field of ['canonical_id', 'document_id']) {
    if (typeof value.sort[field] !== 'string' || value.sort[field].length < 3 || value.sort[field].length > 192) fail('CURSOR_SORT_ID_INVALID', field);
  }
  return value;
}

export function encodeGenerationCursor({
  publicationManifestId,
  generationId,
  projectionType,
  sort,
  issuedAt,
  expiresAt,
  generationRetainedUntil,
  secret,
}) {
  assertTimestamp(generationRetainedUntil, 'generation_retained_until');
  const payload = assertPayload({
    cursor_version: GENERATION_CURSOR_VERSION,
    publication_manifest_id: publicationManifestId,
    generation_id: generationId,
    projection_type: projectionType,
    sort,
    issued_at: issuedAt,
    expires_at: expiresAt,
  });
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expiresAt);
  if (expiresMs <= issuedMs || expiresMs - issuedMs > MAX_CURSOR_TTL_MS) fail('CURSOR_TTL_INVALID');
  if (expiresMs > Date.parse(generationRetainedUntil)) fail('CURSOR_EXCEEDS_GENERATION_RETENTION');
  const canonical = canonicalizeJson(payload);
  const body = Buffer.from(canonical, 'utf8').toString('base64url');
  const signature = sign(body, secret).toString('base64url');
  const cursor = `${body}.${signature}`;
  if (Buffer.byteLength(cursor, 'utf8') > MAX_CURSOR_BYTES) fail('CURSOR_BYTES_EXCEEDED');
  return cursor;
}

export function decodeGenerationCursor(cursor, {
  secret,
  observedAt,
  expectedPublicationManifestId,
  expectedGenerationId,
  expectedProjectionType,
} = {}) {
  if (typeof cursor !== 'string' || Buffer.byteLength(cursor, 'utf8') > MAX_CURSOR_BYTES) fail('CURSOR_INVALID');
  const parts = cursor.split('.');
  if (parts.length !== 2 || parts.some(part => part.length === 0)) fail('CURSOR_FORMAT_INVALID');
  const expectedSignature = sign(parts[0], secret);
  let suppliedSignature;
  try {
    suppliedSignature = Buffer.from(parts[1], 'base64url');
  } catch {
    fail('CURSOR_SIGNATURE_INVALID');
  }
  if (suppliedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(suppliedSignature, expectedSignature)) {
    fail('CURSOR_SIGNATURE_INVALID');
  }
  let payload;
  try {
    payload = parseStrictJson(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (error) {
    fail('CURSOR_JSON_INVALID', error.code ?? error.message);
  }
  assertPayload(payload);
  assertTimestamp(observedAt, 'observed_at');
  if (Date.parse(observedAt) >= Date.parse(payload.expires_at)) fail('CURSOR_EXPIRED', payload.generation_id, { restartRequired: true });
  if (expectedPublicationManifestId && payload.publication_manifest_id !== expectedPublicationManifestId) {
    fail('CURSOR_PUBLICATION_MISMATCH', payload.publication_manifest_id, { restartRequired: true });
  }
  if (expectedGenerationId && payload.generation_id !== expectedGenerationId) {
    fail('CURSOR_GENERATION_MISMATCH', payload.generation_id, { restartRequired: true });
  }
  if (expectedProjectionType && payload.projection_type !== expectedProjectionType) fail('CURSOR_PROJECTION_MISMATCH');
  return Object.freeze(payload);
}
