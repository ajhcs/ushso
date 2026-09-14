import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCurrent, verifyHistorical, assertUnapproved } from '../tools/common.mjs';
test('frozen WP5 files remain historical references without current approval', () => {
  const history = verifyHistorical();
  assert.equal(history.files.length,13);
  assert.equal(history.origin.component_merge_sha,'e268652c5e92876a3540809595636c4795ebec6f');
});
test('all actual current connector controls execute on a newly measured unapproved subject', async () => {
  const result=await verifyCurrent();
  assertUnapproved(result);
  assert.equal(result.status,'PASS');
  assert.equal(result.execution.commands.filter((c)=>c.kind==='test').reduce((n,c)=>n+c.controls.count,0)>=48,true);
  assert.equal(result.subject.sha256.length,64);
  assert.ok(result.subject.value.modules.length>0);
  assert.ok(result.subject.value.packages.length>0);
});
