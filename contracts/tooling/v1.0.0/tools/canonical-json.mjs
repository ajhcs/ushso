const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 128,
  maxNodes: 100_000,
  maxOutputBytes: 8 * 1024 * 1024
});

export class CanonicalJsonError extends TypeError {
  constructor(code, path, message = code) {
    super(`${code} at ${path}: ${message}`);
    this.name = 'CanonicalJsonError';
    this.code = code;
    this.path = path;
  }
}

function pointerToken(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function assertWellFormedUnicode(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalJsonError('JCS_LONE_SURROGATE', path);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalJsonError('JCS_LONE_SURROGATE', path);
    }
  }
}

function serialize(value, state, path, depth) {
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) {
    throw new CanonicalJsonError('JCS_NODE_LIMIT_EXCEEDED', path);
  }
  if (depth > state.limits.maxDepth) {
    throw new CanonicalJsonError('JCS_DEPTH_LIMIT_EXCEEDED', path);
  }

  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertWellFormedUnicode(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalJsonError('JCS_NON_FINITE_NUMBER', path);
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new CanonicalJsonError('JCS_UNSUPPORTED_TYPE', path, typeof value);
  }

  if (state.ancestors.has(value)) throw new CanonicalJsonError('JCS_CYCLIC_VALUE', path);
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const symbolKeys = Object.getOwnPropertySymbols(value);
      const ownNames = Object.getOwnPropertyNames(value).filter(key => key !== 'length');
      if (symbolKeys.length > 0) {
        throw new CanonicalJsonError('JCS_ARRAY_EXTRA_PROPERTY', path);
      }
      const rows = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new CanonicalJsonError('JCS_SPARSE_ARRAY', `${path}/${index}`);
        }
        const property = Object.getOwnPropertyDescriptor(value, String(index));
        if (!property || !('value' in property) || !property.enumerable) {
          throw new CanonicalJsonError('JCS_NON_JSON_PROPERTY_DESCRIPTOR', `${path}/${index}`);
        }
        rows.push(serialize(property.value, state, `${path}/${index}`, depth + 1));
      }
      if (ownNames.length !== value.length) {
        throw new CanonicalJsonError('JCS_ARRAY_EXTRA_PROPERTY', path);
      }
      return `[${rows.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError('JCS_NON_JSON_OBJECT', path);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new CanonicalJsonError('JCS_SYMBOL_KEY', path);
    }

    // RFC 8785 sorts property names by their raw UTF-16 code units. JavaScript's
    // default string sort implements precisely that ordering.
    const enumerableKeys = Object.keys(value);
    if (Object.getOwnPropertyNames(value).length !== enumerableKeys.length) {
      throw new CanonicalJsonError('JCS_NON_JSON_PROPERTY_DESCRIPTOR', path);
    }
    const keys = enumerableKeys.sort();
    const fields = keys.map(key => {
      assertWellFormedUnicode(key, `${path}/${pointerToken(key)}`);
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !('value' in property)) {
        throw new CanonicalJsonError('JCS_ACCESSOR_PROPERTY', `${path}/${pointerToken(key)}`);
      }
      return `${JSON.stringify(key)}:${serialize(property.value, state, `${path}/${pointerToken(key)}`, depth + 1)}`;
    });
    return `{${fields.join(',')}}`;
  } finally {
    state.ancestors.delete(value);
  }
}

/**
 * Canonicalize an already-parsed I-JSON value according to RFC 8785 (JCS).
 * Arrays retain their input order. Non-finite numbers, lone surrogates,
 * accessors, sparse arrays, cycles, and non-JSON values are rejected.
 */
export function canonicalizeJson(value, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const result = serialize(value, { limits, nodes: 0, ancestors: new WeakSet() }, '', 0);
  if (Buffer.byteLength(result, 'utf8') > limits.maxOutputBytes) {
    throw new CanonicalJsonError('JCS_OUTPUT_LIMIT_EXCEEDED', '');
  }
  return result;
}

export function canonicalJsonBytes(value, options = {}) {
  return Buffer.from(canonicalizeJson(value, options), 'utf8');
}

export const RFC8785_CANONICALIZATION = Object.freeze({
  identifier: 'rfc8785-jcs',
  input_profile: 'i-json',
  encoding: 'utf-8',
  object_key_order: 'utf-16-code-unit-ascending',
  array_order: 'preserved',
  number_serialization: 'ecmascript-json-stringify',
  whitespace: 'none'
});
