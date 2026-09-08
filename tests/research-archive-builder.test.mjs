import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('research archive producer preserves exact inventories and rejects unsafe sources', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('../scripts/test-build-research-archive.py', import.meta.url))], { encoding: 'utf8', timeout: 60000, env: process.env });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran 13 tests/);
  assert.match(result.stderr, /\bOK\b/);
});
