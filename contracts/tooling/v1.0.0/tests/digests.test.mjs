import assert from 'node:assert/strict';
import test from 'node:test';
import { byteSha256, canonicalSha256, jsonlSetSha256, packageContentSha256 } from '../src/digests.mjs';

test('typed byte and canonical digests are distinct and deterministic', () => {
  assert.deepEqual(byteSha256('abc'), {
    digest_type: 'byte_sha256',
    algorithm: 'sha256',
    value: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  });
  assert.deepEqual(canonicalSha256({ b: 2, a: 1 }), canonicalSha256({ a: 1, b: 2 }));
  assert.equal(canonicalSha256({ a: 1 }).digest_type, 'canonical_json_sha256');
});

test('JSONL set digest is row-order independent and rejects duplicate semantic rows', () => {
  assert.deepEqual(jsonlSetSha256('{"b":2}\n{"a":1}\n'), jsonlSetSha256('{"a":1}\r\n{"b":2}'));
  assert.throws(() => jsonlSetSha256('{"a":1}\n{"a":1}\n'), /JSONL_SET_DUPLICATE_ROW/u);
});

test('package content digest is path-order independent and typed', () => {
  const a = { path: 'a', bytes: 1, byte_digest: byteSha256('a'), semantic_kind: 'none', semantic_digest: null };
  const b = { path: 'b', bytes: 1, byte_digest: byteSha256('b'), semantic_kind: 'none', semantic_digest: null };
  assert.deepEqual(packageContentSha256([a, b]), packageContentSha256([b, a]));
  assert.equal(packageContentSha256([a, b]).digest_type, 'package_sha256');
  assert.throws(() => packageContentSha256([{ ...a, byte_digest: canonicalSha256({ a: 1 }) }]), /INVALID_TYPED_DIGEST:byte_sha256/u);
});
