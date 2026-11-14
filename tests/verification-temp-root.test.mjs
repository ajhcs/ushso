import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationTempRoot } from '../scripts/verification-temp-root.mjs';
const identity = async value => value;
const stat = async value => ({dev:value==='/'?1:2,isDirectory:()=>true});
const options = {realpath:identity,stat};
test('GitHub uses runner temporary directory independently of host TMPDIR', async () => {
  assert.equal(await verificationTempRoot({...options,env:{GITHUB_ACTIONS:'true', RUNNER_TEMP:'/runner/_temp', TMPDIR:'/workspace/tmp'}}),'/runner/_temp');
});
test('missing or relative temporary directory never falls back to root storage', async () => {
  for (const env of [{GITHUB_ACTIONS:'true'},{GITHUB_ACTIONS:'true',RUNNER_TEMP:'relative'},{},{TMPDIR:'relative'}]) await assert.rejects(verificationTempRoot({...options,env}),/VERIFICATION_TEMP_ROOT_REQUIRED/);
});
test('BuilderBob accepts only real directories on the distinct workspace device', async () => {
  assert.equal(await verificationTempRoot({...options,env:{TMPDIR:'/workspace/build/job/tmp'}}),'/workspace/build/job/tmp');
  await assert.rejects(verificationTempRoot({...options,env:{TMPDIR:'/workspace-evil/job'}}),/MOUNTED_DATA_DISK/);
  await assert.rejects(verificationTempRoot({...options,env:{TMPDIR:'/workspace/link'},realpath:async()=>'/tmp'}),/MOUNTED_DATA_DISK/);
  await assert.rejects(verificationTempRoot({...options,env:{TMPDIR:'/workspace/tmp'},stat:async()=>({dev:1,isDirectory:()=>true})}),/SEPARATE_DEVICE/);
  await assert.rejects(verificationTempRoot({...options,env:{TMPDIR:'/workspace/nested'},stat:async p=>({dev:p==='/'?1:p==='/workspace'?2:3,isDirectory:()=>true})}),/DEVICE_MISMATCH/);
  await assert.rejects(verificationTempRoot({...options,env:{TMPDIR:'/workspace/file'},stat:async p=>({dev:p==='/'?1:2,isDirectory:()=>p!=='/workspace/file'})}),/MUST_BE_DIRECTORY/);
});
test('historical Plumbob path retains the same mounted-device checks', async () => {
  assert.equal(await verificationTempRoot({...options,env:{TMPDIR:'/mnt/d/tmp/plumbob/job'}}),'/mnt/d/tmp/plumbob/job');
  await assert.rejects(verificationTempRoot({...options,env:{TMPDIR:'/tmp'}}),/MOUNTED_DATA_DISK/);
});
test('mount root symlink substitution is rejected', async () => {
  await assert.rejects(verificationTempRoot({...options,env:{TMPDIR:'/workspace/tmp'},realpath:async p=>p==='/workspace'?'/somewhere':p}),/MUST_NOT_BE_SYMLINK/);
});
