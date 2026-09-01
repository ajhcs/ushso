import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalizeJson, CanonicalJsonError } from '../src/canonical-json.mjs';
import { parseStrictJson, StrictJsonParseError } from '../src/strict-json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('RFC 8785 canonicalization vectors match byte-for-byte', async () => {
  const fixture = parseStrictJson(await fs.readFile(path.join(ROOT, 'fixtures', 'rfc8785-vectors.json'), 'utf8'));
  for (const vector of fixture.vectors) assert.equal(canonicalizeJson(vector.value), vector.canonical, vector.id);
});

test('canonicalization preserves array order and normalizes finite ECMAScript numbers', () => {
  assert.equal(canonicalizeJson({ z: [-0, 1e-7, 0.000001, 1e21], a: [3, 2, 1] }), '{"a":[3,2,1],"z":[0,1e-7,0.000001,1e+21]}');
  assert.throws(() => canonicalizeJson({ value: Number.NaN }), error => error instanceof CanonicalJsonError && error.code === 'JCS_NON_FINITE_NUMBER');
  assert.throws(() => canonicalizeJson({ value: Infinity }), error => error instanceof CanonicalJsonError && error.code === 'JCS_NON_FINITE_NUMBER');
  assert.throws(() => canonicalizeJson([, 1]), error => error instanceof CanonicalJsonError && error.code === 'JCS_SPARSE_ARRAY');
});

test('strict JSON parsing rejects decoded duplicate keys and unsafe I-JSON', () => {
  assert.throws(() => parseStrictJson('{"a":1,"\\u0061":2}'), error => error instanceof StrictJsonParseError && error.code === 'JSON_DUPLICATE_KEY');
  assert.throws(() => parseStrictJson('{"n":1e400}'), error => error instanceof StrictJsonParseError && error.code === 'JSON_NON_FINITE_NUMBER');
  assert.throws(() => parseStrictJson('﻿{}'), error => error instanceof StrictJsonParseError && error.code === 'JSON_BOM_NOT_ALLOWED');
  assert.throws(() => parseStrictJson('{"s":"\\ud800"}'), error => error instanceof StrictJsonParseError && error.code === 'JSON_LONE_SURROGATE');
});

test('strict parser preserves __proto__ as data without prototype pollution', () => {
  const parsed = parseStrictJson('{"__proto__":{"polluted":true}}');
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal({}.polluted, undefined);
});

test('canonicalization rejects accessors and non-enumerable object state without invoking it', () => {
  let invoked = false;
  const array = [];
  Object.defineProperty(array, '0', { enumerable: true, get() { invoked = true; return 1; } });
  array.length = 1;
  assert.throws(() => canonicalizeJson(array), error => error instanceof CanonicalJsonError && error.code === 'JCS_NON_JSON_PROPERTY_DESCRIPTOR');
  assert.equal(invoked, false);
  const object = {};
  Object.defineProperty(object, 'hidden', { value: 1 });
  assert.throws(() => canonicalizeJson(object), error => error instanceof CanonicalJsonError && error.code === 'JCS_NON_JSON_PROPERTY_DESCRIPTOR');
});
