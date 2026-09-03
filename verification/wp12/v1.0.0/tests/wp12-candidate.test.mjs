import assert from 'node:assert/strict';
import test from 'node:test';

test('WP12 historical candidate receipt remains archived while successor activation is explicit', async () => {
  const originalExitCode = process.exitCode;
  await import('../tools/verify.mjs');
  assert.equal(process.exitCode, originalExitCode);
});
