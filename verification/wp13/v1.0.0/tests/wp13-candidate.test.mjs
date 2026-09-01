import assert from 'node:assert/strict';
import test from 'node:test';

test('WP13 protected candidate receipt, seal, discoverability invariants, and activation boundary validate', async () => {
  const originalExitCode = process.exitCode;
  await import('../tools/verify.mjs');
  assert.equal(process.exitCode, originalExitCode);
});
