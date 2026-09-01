const encoder = new TextEncoder();

function assertUnicode(value, pointer) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError(`JCS_LONE_SURROGATE:${pointer}`);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`JCS_LONE_SURROGATE:${pointer}`);
    }
  }
}

function encodeCanonical(value, pointer, ancestors) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`JCS_NON_FINITE_NUMBER:${pointer}`);
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    assertUnicode(value, pointer);
    return JSON.stringify(value);
  }
  if (!value || typeof value !== 'object') throw new TypeError(`JCS_UNSUPPORTED_TYPE:${pointer}`);
  if (ancestors.has(value)) throw new TypeError(`JCS_CYCLE:${pointer}`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((child, index) => encodeCanonical(child, `${pointer}/${index}`, ancestors)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`JCS_NON_JSON_OBJECT:${pointer}`);
    return `{${Object.keys(value).sort().map((key) => {
      assertUnicode(key, pointer);
      return `${JSON.stringify(key)}:${encodeCanonical(value[key], `${pointer}/${key}`, ancestors)}`;
    }).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value) {
  return encodeCanonical(value, '', new WeakSet());
}

export function serializedBytes(value) {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

export function snapshotBody(response) {
  const copy = structuredClone(response);
  delete copy.request_id;
  delete copy.response_generated_at;
  delete copy.transport_adapter;
  delete copy.result_snapshot_id;
  delete copy.candidate_snapshot_id;
  if (copy.rate_limit) {
    delete copy.rate_limit.remaining;
    delete copy.rate_limit.reset_at;
    delete copy.rate_limit.retry_after_seconds;
  }
  return copy;
}

export async function sha256Hex(bytes, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle) throw new Error('MACHINE_TOOLKIT_WEB_CRYPTO_REQUIRED');
  const digest = await cryptoProvider.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function snapshotDigest(response, cryptoProvider = globalThis.crypto) {
  const bytes = encoder.encode(canonicalJson(snapshotBody(response)));
  return `sha256:${await sha256Hex(bytes, cryptoProvider)}`;
}

export function cloneJson(value) {
  const clone = structuredClone(value);
  // Canonical encoding rejects non-JSON values, cycles, lone surrogates, and
  // non-finite numbers before any source-controlled value reaches a transport.
  canonicalJson(clone);
  return clone;
}
