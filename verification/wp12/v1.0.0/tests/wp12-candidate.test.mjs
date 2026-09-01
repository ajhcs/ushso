import assert from 'node:assert/strict';
import test from 'node:test';

test('WP12 protected candidate receipt, frozen manifest, and activation boundary validate', async () => {
  const originalExitCode = process.exitCode;
  await import('../tools/verify.mjs');
  assert.equal(process.exitCode, originalExitCode);
});
