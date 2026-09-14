import { canonicalJson, snapshotDigest } from '../packages/machine-toolkit/src/json.mjs';

const TTL_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();
const fail = () => { throw new Error('MACHINE_CURSOR_RESTART_REQUIRED'); };
function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return fail();
  const bytes = Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  if (encode(bytes) !== text) return fail();
  return bytes;
}

// No request data is retained. Without an explicitly provisioned dedicated key,
// cursors survive only within this signer/Worker instance, not across isolates.
export function createMachineCursorSigner({ signingKey, clock = () => Date.now(), cryptoProvider = globalThis.crypto } = {}) {
  let keyPromise;
  function key() {
    if (!keyPromise) {
      const bytes = signingKey === undefined ? cryptoProvider.getRandomValues(new Uint8Array(32)) : encoder.encode(signingKey);
      if (typeof signingKey !== 'undefined' && (typeof signingKey !== 'string' || bytes.length < 32 || bytes.length > 1024)) throw new Error('MACHINE_CURSOR_KEY_INVALID');
      keyPromise = cryptoProvider.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    }
    return keyPromise;
  }
  return Object.freeze({
    ephemeral: signingKey === undefined,
    async page({ capability, input, generation, manifest, items, section }) {
      const maximum=capability==='search_assets'?20:capability==='get_coverage_status'?100:capability==='get_asset'?50:capability==='dictionary_review'?1:0;
      if(!Number.isSafeInteger(input?.limit)||input.limit<1||input.limit>maximum||!Array.isArray(items))fail();
      const { cursor, ...query } = input;
      if (query.expected_generation != null && query.expected_generation !== generation) fail();
      // Discovery and a subsequent explicit pin to its resolved generation are
      // the same traversal; conflicting pins must never reuse a cursor.
      query.expected_generation = generation;
      const binding = await snapshotDigest({ version: 1, capability, generation, manifest, query });
      const now = clock();
      let offset = 0, issued = now, expires = now + TTL_MS;
      if (cursor) {
        try {
          if (cursor.length > 2048) fail();
          const parts = cursor.split('.');
          if (parts.length !== 2) fail();
          const payloadBytes = decode(parts[0]);
          if (!await cryptoProvider.subtle.verify('HMAC', await key(), decode(parts[1]), payloadBytes)) fail();
          const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
          if (canonicalJson(Object.keys(payload).sort()) !== canonicalJson(['binding', 'expires', 'issued', 'offset', 'version'])) fail();
          if (payload.version !== 1 || payload.binding !== binding || !Number.isSafeInteger(payload.offset)
            || payload.offset <= 0 || payload.offset % input.limit !== 0 || payload.offset >= items.length
            || !Number.isSafeInteger(payload.issued) || !Number.isSafeInteger(payload.expires)
            || payload.issued > now || payload.expires <= now || payload.expires - payload.issued !== TTL_MS) fail();
          ({ offset, issued, expires } = payload);
        } catch { fail(); }
      }
      const selected = items.slice(offset, offset + input.limit);
      const more = offset + selected.length < items.length;
      let next = null;
      if (more) {
        const bytes = encoder.encode(canonicalJson({ version: 1, binding, offset: offset + selected.length, issued, expires }));
        next = `${encode(bytes)}.${encode(new Uint8Array(await cryptoProvider.subtle.sign('HMAC', await key(), bytes)))}`;
      }
      return { selected, binding, resultState: more ? 'partial' : selected.length ? 'complete' : 'empty',
        envelope: { truncated: more, omitted_sections: more ? [section] : [], next_cursor: next, continuation_expires_at: more ? new Date(expires).toISOString() : null } };
    },
  });
}
