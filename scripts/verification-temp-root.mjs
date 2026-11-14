import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const beneath = (candidate, root) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

// Hosted runners have their own storage contract. Local work uses the mounted
// data volume: /workspace on BuilderBob, /mnt/d on historical Plumbob setups.
// No fallback to the root disk, symlink escape, or nested foreign mount is allowed.
export async function verificationTempRoot({ env = process.env, realpath = fs.realpath, stat = fs.stat } = {}) {
  const hosted = env.GITHUB_ACTIONS === 'true';
  const configured = hosted ? env.RUNNER_TEMP : env.TMPDIR;
  assert.ok(typeof configured === 'string' && path.isAbsolute(configured), 'VERIFICATION_TEMP_ROOT_REQUIRED');
  const resolved = await realpath(configured);
  if (hosted) return resolved;
  const storageRoot = ['/workspace', '/mnt/d'].find(root => beneath(resolved, root));
  assert.ok(storageRoot, 'WP0_TEMP_STORAGE_MUST_BE_ON_MOUNTED_DATA_DISK');
  const canonicalRoot = await realpath(storageRoot);
  assert.equal(canonicalRoot, storageRoot, 'VERIFICATION_STORAGE_ROOT_MUST_NOT_BE_SYMLINK');
  const [temporary, storage, system] = await Promise.all([stat(resolved), stat(canonicalRoot), stat('/')]);
  assert.ok(temporary.isDirectory() && storage.isDirectory(), 'VERIFICATION_TEMP_ROOT_MUST_BE_DIRECTORY');
  assert.notEqual(storage.dev, system.dev, 'VERIFICATION_STORAGE_MUST_BE_SEPARATE_DEVICE');
  assert.equal(temporary.dev, storage.dev, 'VERIFICATION_TEMP_ROOT_DEVICE_MISMATCH');
  return resolved;
}
