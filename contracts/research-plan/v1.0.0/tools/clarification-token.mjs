import { createHmac, timingSafeEqual } from 'node:crypto';

import { canonicalJson } from './common.mjs';

const MAX_TTL_MS = 24 * 60 * 60 * 1000;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signature(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signClarificationToken(claims, key) {
  if (key.state !== 'active') throw new Error('TOKEN_SIGNING_KEY_NOT_ACTIVE');
  if (claims.key_version !== key.key_version) throw new Error('TOKEN_KEY_VERSION_MISMATCH');
  const payload = base64url(canonicalJson(claims));
  return `${payload}.${signature(payload, key.test_secret ?? key.secret)}`;
}

export function verifyClarificationToken(token, { keys, now, request_hash, question_set_hash, expected_generation }) {
  if (typeof token !== 'string' || token.split('.').length !== 2) return { ok: false, code: 'TOKEN_MALFORMED' };
  const [payload, suppliedSignature] = token.split('.');
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, code: 'TOKEN_MALFORMED' };
  }
  const key = keys.find(candidate => candidate.key_version === claims.key_version);
  if (!key) return { ok: false, code: 'TOKEN_KEY_UNKNOWN' };
  if (key.state === 'retired') return { ok: false, code: 'TOKEN_KEY_RETIRED' };
  const expectedSignature = signature(payload, key.test_secret ?? key.secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return { ok: false, code: 'TOKEN_SIGNATURE_INVALID' };

  const issued = Date.parse(claims.issued_at);
  const expires = Date.parse(claims.expires_at);
  const current = Date.parse(now);
  if (![issued, expires, current].every(Number.isFinite)) return { ok: false, code: 'TOKEN_TIME_INVALID' };
  if (expires - issued > MAX_TTL_MS || expires <= issued) return { ok: false, code: 'TOKEN_TTL_INVALID' };
  if (issued > current) return { ok: false, code: 'TOKEN_NOT_YET_VALID' };
  if (expires <= current) return { ok: false, code: 'TOKEN_EXPIRED' };
  if (claims.request_hash !== request_hash) return { ok: false, code: 'REQUEST_HASH_MISMATCH' };
  if (claims.question_set_hash !== question_set_hash) return { ok: false, code: 'QUESTION_SET_HASH_MISMATCH' };
  if (claims.expected_generation !== expected_generation) return { ok: false, code: 'GENERATION_MISMATCH' };
  return { ok: true, code: 'TOKEN_VALID', claims };
}

export function tamperToken(token) {
  const [payload, signatureValue] = token.split('.');
  const last = signatureValue.at(-1);
  return `${payload}.${signatureValue.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
}
