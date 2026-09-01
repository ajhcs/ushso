export function invariant(condition, code, detail = '') {
  if (!condition) {
    const error = new Error(`${code}${detail ? `:${detail}` : ''}`);
    error.code = code;
    error.detail = detail;
    throw error;
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  invariant(encoded !== undefined, 'CANONICAL_JSON_UNSUPPORTED');
  return encoded;
}

export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(part => part.toString(16).padStart(2, '0')).join('');
}

export async function deterministicOpaqueId(prefix, value, length = 32) {
  return `${prefix}_${(await sha256Hex(canonicalJson(value))).slice(0, length)}`;
}

export function clone(value) {
  return structuredClone(value);
}

export function iso(timestampMs) {
  invariant(Number.isFinite(timestampMs), 'TIMESTAMP_INVALID', String(timestampMs));
  return new Date(timestampMs).toISOString();
}

export function parseTimestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  invariant(Number.isFinite(parsed), 'TIMESTAMP_INVALID', String(value));
  return parsed;
}

export function requirePort(port, methods, name) {
  invariant(port && typeof port === 'object', 'PORT_MISSING', name);
  for (const method of methods) invariant(typeof port[method] === 'function', 'PORT_METHOD_MISSING', `${name}.${method}`);
  return port;
}

export class InjectedFault extends Error {
  constructor(point) {
    super(`INJECTED_FAULT:${point}`);
    this.name = 'InjectedFault';
    this.code = 'INJECTED_FAULT';
    this.point = point;
  }
}

export class FaultInjector {
  #armed = new Map();

  arm(point, times = 1) {
    invariant(Number.isInteger(times) && times > 0, 'FAULT_COUNT_INVALID');
    this.#armed.set(point, times);
  }

  clear() { this.#armed.clear(); }

  hit(point) {
    const remaining = this.#armed.get(point) ?? 0;
    if (remaining <= 0) return;
    if (remaining === 1) this.#armed.delete(point);
    else this.#armed.set(point, remaining - 1);
    throw new InjectedFault(point);
  }
}
