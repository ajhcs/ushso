import { createHash } from 'node:crypto';

const encoder = new TextEncoder();

export function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string') return encoder.encode(value);
  throw new TypeError('Expected a string, Uint8Array, or ArrayBuffer.');
}

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash('sha256').update(asBytes(value)).digest('hex');
}

export function semanticSha256(bytes, mediaType) {
  const body = asBytes(bytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  if (mediaType === 'application/json' || mediaType === 'application/ld+json' || mediaType.endsWith('+json')) {
    return sha256(canonicalJson(JSON.parse(text)));
  }
  if (mediaType === 'text/html' || mediaType === 'text/plain' || mediaType === 'text/csv') {
    return sha256(text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim());
  }
  return sha256(body);
}

export function deepClone(value) {
  return structuredClone(value);
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function deterministicId(prefix, value, length = 32) {
  return `${prefix}_${sha256(canonicalJson(value)).slice(0, length)}`;
}
