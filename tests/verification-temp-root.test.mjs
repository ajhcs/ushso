import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationTempRoot } from '../scripts/verification-temp-root.mjs';
const identity = async value => value;
test('GitHub uses its runner-owned temporary directory independently of host TMPDIR', async () => {
  assert.equal(await verificationTempRoot({env:{GITHUB_ACTIONS:'true', RUNNER_TEMP:'/runner/_temp', TMPDIR:'/mnt/d/tmp/plumbob'},realpath:identity}),'/runner/_temp');
});
test('GitHub never falls back to Plumbob storage when runner storage is missing', async () => {
  await assert.rejects(verificationTempRoot({env:{GITHUB_ACTIONS:'true'},realpath:identity}),/VERIFICATION_TEMP_ROOT_REQUIRED/);
  await assert.rejects(verificationTempRoot({env:{GITHUB_ACTIONS:'true',RUNNER_TEMP:'relative'},realpath:identity}),/VERIFICATION_TEMP_ROOT_REQUIRED/);
});
test('Plumbob still requires real temporary storage under the mounted data disk', async () => {
  assert.equal(await verificationTempRoot({env:{TMPDIR:'/mnt/d/tmp/plumbob/job'},realpath:identity}),'/mnt/d/tmp/plumbob/job');
  await assert.rejects(verificationTempRoot({env:{TMPDIR:'/tmp'},realpath:identity}),/MOUNTED_DATA_DISK/);
  await assert.rejects(verificationTempRoot({env:{TMPDIR:'/mnt/d/link'},realpath:async()=>'/tmp'}),/MOUNTED_DATA_DISK/);
});
