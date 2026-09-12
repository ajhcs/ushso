import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, relativePath, semanticSubject, assertSubject } from '../tools/common.mjs';
test('current source changes produce distinct unapproved semantic identities', () => {
  const base={policy:{version:1},files:[{path:'a',sha256:'a'.repeat(64),bytes:1}],modules:[],packages:[],runtime:{node:process.version},fingerprint:'x',configuredPackageManager:'npm@11.19.1'};
  const first=semanticSubject(base),second=semanticSubject({...base,files:[{...base.files[0],sha256:'b'.repeat(64)}]});
  assert.notEqual(first.sha256,second.sha256);
  const result={evidence_kind:'current_technical_only',approval:null,historical_approval_transferred:false,current_approval_issued:false,release_qualified:false,live_collection:false,managed_persistence:false,production_changed:false,subject:first};
  assertSubject(result,first);
  assert.throws(()=>assertSubject(result,second),/CURRENT_SUBJECT_MISMATCH/);
  assert.throws(()=>assertSubject({...result,approval:'historical'},first),/CURRENT_APPROVAL_FORBIDDEN/);
  assert.equal(digest({b:1,a:2}),digest({a:2,b:1}));
});
test('manifest paths reject traversal, absolute paths and ambiguous components', () => {
  for(const invalid of ['../a','/a','a/../b','a//b','a/./b','a\\b','']) assert.throws(()=>relativePath(invalid),/INVALID_RELATIVE_PATH/);
  assert.equal(relativePath('a/b.json'),'a/b.json');
});
