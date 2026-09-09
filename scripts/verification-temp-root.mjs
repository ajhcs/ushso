import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Hosted CI uses its own ephemeral storage; Plumbob retains its mounted-disk rule.
export async function verificationTempRoot({ env = process.env, realpath = fs.realpath } = {}) {
  const hosted = env.GITHUB_ACTIONS === 'true';
  const configured = hosted ? env.RUNNER_TEMP : (env.TMPDIR ?? '/mnt/d/tmp/plumbob');
  assert.ok(typeof configured === 'string' && path.isAbsolute(configured), 'VERIFICATION_TEMP_ROOT_REQUIRED');
  const resolved = await realpath(configured);
  if (!hosted) assert.ok(resolved.startsWith('/mnt/d/'), 'WP0_TEMP_STORAGE_MUST_BE_ON_MOUNTED_DATA_DISK');
  return resolved;
}
