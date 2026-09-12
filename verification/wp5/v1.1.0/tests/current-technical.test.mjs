import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  digest, sha256, relativePath, regularFile, inventory, assertManifest, assertUnchanged,
  createModuleGuard, inspectDependency, parseNativeTap, runBoundedChild,
  semanticSubject, assertSubject, assertUnapproved, verifyHistorical, readPolicy,
  repositoryRoot, verificationRoot,
} from '../tools/common.mjs';

const moduleLimits={maximum_packages:256,maximum_module_files:2048,maximum_total_module_bytes:67108864,maximum_module_file_bytes:16777216,maximum_package_depth:16};
const fileBounds={maximum_files:2048,maximum_total_bytes:67108864,maximum_file_bytes:16777216,maximum_depth:16};
const commonRelative='verification/wp5/v1.1.0/tools/common.mjs';
const unapproved={evidence_kind:'current_technical_only',approval:null,historical_approval_transferred:false,current_approval_issued:false,release_qualified:false,live_collection:false,managed_persistence:false,production_changed:false};
function fixture(t) {
  const parent=fs.mkdtempSync(path.join(tmpdir(),'wp5-input-test-')),root=path.join(parent,'root');fs.mkdirSync(root);
  t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  const put=(rel,body)=>{const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);return p;};
  put(commonRelative,fs.readFileSync(path.join(verificationRoot,'tools/common.mjs')));
  put('app/entry.mjs','export default 1;\n');
  const sourceSpec={recursive_roots:['app','verification'],exact_files:[],bounds:fileBounds};
  const spec=()=>({root,files:inventory(root,sourceSpec),module_limits:moduleLimits,lock:{packages:{}}});
  return {parent,root,put,spec,sourceSpec};
}
const childEnv=()=>{const env={...process.env};for(const k of ['NODE_OPTIONS','NODE_PATH','NODE_TEST_CONTEXT','WP5_PROBE_POLICY','USHSO_WP5_RUN_SPEC'])delete env[k];return env;};
const childOptions=(cwd)=>({cwd,env:childEnv(),maximumMilliseconds:5000,maximumOutputBytes:1048576});
function load(guard,root,rel,{format='module',context='module',change,source}={}) {
  return guard.hooks.load(pathToFileURL(path.join(root,rel)).href,{format:context},()=>{
    const result={source:source??fs.readFileSync(path.join(root,rel))};if(format!==undefined)result.format=format;
    if(change)change();return result;
  });
}
const subject=(overrides={})=>semanticSubject({policy:{version:1},files:[{path:'a',sha256:'a'.repeat(64),bytes:1}],modules:[],packages:[],runtime:{node:process.version},fingerprint:'x',configuredPackageManager:'npm@11.19.1',...overrides});
const tap=(names=['required'],suffix='')=>'TAP version 13\n'+names.map((n,i)=>`# Subtest: ${n}\nok ${i+1} - ${n}\n  ---\n  duration_ms: 1\n  type: 'test'\n  ...\n`).join('')+`1..${names.length}\n# tests ${names.length}\n# suites 0\n# pass ${names.length}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n`+suffix;

test('each semantic input changes subject identity and an old receipt cannot approve it', () => {
  const first=subject();assertSubject({...unapproved,subject:first},first);
  for(const delta of [
    {policy:{version:2}}, {files:[{path:'a',sha256:'b'.repeat(64),bytes:1}]},
    {modules:[{path:'node_modules/dep/index.js',sha256:'c'.repeat(64),bytes:2,reported_format:null}]},
    {packages:[{path:'node_modules/dep/package.json',lock_entry:{version:'2'}}]},
    {runtime:{node:process.version+'-different'}}, {fingerprint:'y'}, {configuredPackageManager:'npm@different'},
  ]) {const next=subject(delta);assert.notEqual(first.sha256,next.sha256);assert.throws(()=>assertSubject({...unapproved,subject:first},next),/CURRENT_SUBJECT_MISMATCH/);}
  assert.equal(digest({b:1,a:2}),digest({a:2,b:1}));
  assert.throws(()=>assertSubject({...unapproved,subject:{...first,value:{...first.value,runtime:{}}}},first),/CURRENT_SUBJECT_MISMATCH/);
});
test('every current approval or activation overclaim is rejected',()=>{
  assertUnapproved(unapproved);
  for(const key of ['historical_approval_transferred','current_approval_issued','release_qualified','live_collection','managed_persistence','production_changed'])assert.throws(()=>assertUnapproved({...unapproved,[key]:true}),/CURRENT_APPROVAL_FORBIDDEN/);
  for(const delta of [{approval:'historical'},{evidence_kind:'accepted'}])assert.throws(()=>assertUnapproved({...unapproved,...delta}),/CURRENT_APPROVAL_FORBIDDEN/);
});
test('inventory rejects traversal and ambiguous paths and uses byte-stable complete ordering',(t)=>{
  const f=fixture(t);f.put('app/é.json','{}');f.put('app/Z.json','{}');
  for(const invalid of ['../a','/a','a/../b','a//b','a/./b','a\\b',''])assert.throws(()=>relativePath(invalid),/INVALID_RELATIVE_PATH/);
  const before=inventory(f.root,f.sourceSpec);assertManifest(before);
  assert.deepEqual(before.map(r=>r.path),before.map(r=>r.path).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))));
  f.put('app/new-schema.json','{}');const after=inventory(f.root,f.sourceSpec);assert.notEqual(digest(after),digest(before));
  assert.throws(()=>inventory(f.root,{...f.sourceSpec,exact_files:['missing.json']}),/ENOENT/);
  assert.throws(()=>inventory(f.root,{...f.sourceSpec,recursive_roots:['missing']}),/ENOENT/);
  assert.throws(()=>assertManifest([...before,before[0]]),/DUPLICATE_MANIFEST_ENTRY/);
  assert.throws(()=>assertManifest([...before].reverse()),/UNSORTED_MANIFEST/);
});
test('all source inventory ceilings fail closed without silently dropping files',(t)=>{
  const f=fixture(t);f.put('app/a/b/deep.json','1234');
  for(const [key,value,code] of [['maximum_files',1,'COUNT'],['maximum_total_bytes',1,'TOTAL'],['maximum_file_bytes',1,'FILE_BYTE'],['maximum_depth',1,'DEPTH']]){
    assert.throws(()=>inventory(f.root,{...f.sourceSpec,bounds:{...fileBounds,[key]:value}}),new RegExp(code+'_LIMIT'));
  }
  assert.throws(()=>inventory(f.root,{...f.sourceSpec,bounds:{...fileBounds,maximum_files:0}}),/INVENTORY_LIMIT_INVALID/);
  assert.throws(()=>inventory(f.root,{...f.sourceSpec,recursive_roots:['app','app']}),/DUPLICATE_INVENTORY_ROOT/);
});
test('source symlinks and special files are refused, including roots and ancestors',(t)=>{
  const f=fixture(t);fs.symlinkSync('entry.mjs',path.join(f.root,'app/link.mjs'));
  assert.throws(()=>inventory(f.root,f.sourceSpec),/SYMLINK_FORBIDDEN/);
  assert.throws(()=>regularFile(f.root,'app/link.mjs'),/SYMLINK_FORBIDDEN/);
  fs.unlinkSync(path.join(f.root,'app/link.mjs'));fs.symlinkSync('app',path.join(f.root,'linked'));
  assert.throws(()=>inventory(f.root,{...f.sourceSpec,recursive_roots:['linked']}),/SYMLINK_FORBIDDEN/);
  assert.throws(()=>regularFile(f.root,'app'),/REGULAR_FILE_REQUIRED/);
  fs.mkdirSync(path.join(f.root,'app/empty'));assert.throws(()=>inventory(f.root,{...f.sourceSpec,recursive_roots:['linked/empty']}),/SYMLINK_FORBIDDEN/);
});
test('pre-execution and post-execution repository drift are rejected',(t)=>{
  const f=fixture(t),before=f.spec(),guard=createModuleGuard(before);
  f.put('app/entry.mjs','export default 2;\n');
  assert.throws(()=>load(guard,f.root,'app/entry.mjs'),/MODULE_INPUT_DRIFT/);
  assert.throws(()=>assertUnchanged(f.root,before.files),/INPUT_DRIFT/);
  assert.throws(()=>guard.finish(),/INPUT_DRIFT/);
});
test('loader accounts exact ESM, CJS and JSON byte representations and preserves loader results',(t)=>{
  const f=fixture(t);f.put('app/value.cjs','module.exports=1;');f.put('app/value.json','{"x":1}');
  const guard=createModuleGuard(f.spec());
  const esm=load(guard,f.root,'app/entry.mjs',{source:fs.readFileSync(path.join(f.root,'app/entry.mjs'),'utf8')});assert.equal(esm.format,'module');
  guard.hooks.load(pathToFileURL(path.join(f.root,'app/value.cjs')).href,{format:'commonjs'},()=>({source:fs.readFileSync(path.join(f.root,'app/value.cjs'))}));
  const data=fs.readFileSync(path.join(f.root,'app/value.json'));load(guard,f.root,'app/value.json',{format:'json',context:'json',source:new Uint8Array(data)});
  const result=guard.finish();assert.equal(result.modules.length,3);assert.equal(result.modules.find(r=>r.path.endsWith('.cjs')).reported_format,null);
  assert.equal(result.preload.sha256,sha256(fs.readFileSync(path.join(f.root,commonRelative))));
});
test('transformed, missing, unsupported-format and changing returned source are refused',(t)=>{
  const f=fixture(t);let guard=createModuleGuard(f.spec());
  assert.throws(()=>load(guard,f.root,'app/entry.mjs',{source:'export default 9;'}),/MODULE_SOURCE_CHANGED/);
  guard=createModuleGuard(f.spec());assert.throws(()=>load(guard,f.root,'app/entry.mjs',{source:{}}),/MODULE_SOURCE_UNSUPPORTED/);
  guard=createModuleGuard(f.spec());assert.throws(()=>load(guard,f.root,'app/entry.mjs',{format:'wasm'}),/MODULE_FORMAT_UNSUPPORTED/);
  guard=createModuleGuard(f.spec());assert.throws(()=>load(guard,f.root,'app/entry.mjs',{change:()=>f.put('app/entry.mjs','changed')}),/MODULE_SOURCE_CHANGED/);
});
test('uncovered, outside, native, URL query and fragment module requests reject',(t)=>{
  const f=fixture(t),guard=createModuleGuard(f.spec());f.put('app/uncovered.mjs','export default 1;');f.put('app/native.node','x');
  assert.throws(()=>load(guard,f.root,'app/uncovered.mjs'),/UNCOVERED_MODULE/);
  assert.throws(()=>load(guard,f.root,'app/native.node'),/NATIVE_ADDON_UNSUPPORTED/);
  for(const suffix of ['?','?x=1','#','#part'])assert.throws(()=>guard.hooks.resolve('./entry.mjs'+suffix,{parentURL:pathToFileURL(path.join(f.root,'app/other.mjs')).href},()=>({url:pathToFileURL(path.join(f.root,'app/entry.mjs')).href+suffix})),/MODULE_URL_FORBIDDEN/);
  assert.throws(()=>guard.hooks.resolve('data:text/javascript,1',{},()=>({url:'data:text/javascript,1'})),/MODULE_URL_FORBIDDEN/);
  assert.throws(()=>guard.hooks.resolve(pathToFileURL(path.join(f.parent,'outside.mjs')).href,{},()=>({url:''})),/MODULE_OUTSIDE_ROOT/);
});
function dep(f){
  f.put('node_modules/dep/package.json',JSON.stringify({name:'dep',version:'1.0.0',main:'index.cjs'}));
  f.put('node_modules/dep/index.cjs','module.exports=require("./value.json");');f.put('node_modules/dep/value.json','{"answer":42}');
  const spec=f.spec();spec.lock.packages['node_modules/dep']={version:'1.0.0',resolved:'https://registry.example/dep.tgz',integrity:'sha512-example'};return spec;
}
test('loaded dependencies require actual package metadata and exact matching lock identity',(t)=>{
  const f=fixture(t),spec=dep(f),guard=createModuleGuard(spec);load(guard,f.root,'node_modules/dep/index.cjs',{format:'commonjs',context:'commonjs'});
  const observation=guard.finish();assert.equal(observation.packages[0].name,'dep');assert.equal(observation.packages[0].lock_entry.version,'1.0.0');
  for(const entry of [{version:'2'},{version:'1.0.0',name:'alias'},{version:'1.0.0',link:true},{version:'1.0.0',resolved:'file:../dep'}])assert.throws(()=>inspectDependency(f.root,'node_modules/dep/index.cjs',{packages:{'node_modules/dep':entry}},moduleLimits),/PACKAGE_LOCK_MISMATCH|WORKSPACE_DEPENDENCY_UNSUPPORTED/);
  assert.throws(()=>inspectDependency(f.root,'node_modules/dep/index.cjs',{packages:{}},moduleLimits),/UNEXPLAINED_PACKAGE_BOUNDARY/);
});
test('unexplained nested dependency and bare-package symlink resolution reject',(t)=>{
  const f=fixture(t),spec=dep(f);f.put('node_modules/dep/node_modules/ghost/package.json','{"name":"ghost","version":"1"}');f.put('node_modules/dep/node_modules/ghost/index.js','module.exports=1;');
  assert.throws(()=>inspectDependency(f.root,'node_modules/dep/node_modules/ghost/index.js',spec.lock,moduleLimits),/UNEXPLAINED_PACKAGE_BOUNDARY/);
  fs.symlinkSync('dep',path.join(f.root,'node_modules/alias'));
  const guard=createModuleGuard(spec);
  assert.throws(()=>guard.hooks.resolve('alias',{parentURL:pathToFileURL(path.join(f.root,'app/entry.mjs')).href},()=>({url:pathToFileURL(path.join(f.root,'node_modules/dep/index.cjs')).href})),/MODULE_SYMLINK/);
});
test('loaded dependency bytes and package metadata are rechecked after execution',(t)=>{
  const f=fixture(t),spec=dep(f),guard=createModuleGuard(spec);load(guard,f.root,'node_modules/dep/index.cjs',{format:'commonjs',context:'commonjs'});
  f.put('node_modules/dep/index.cjs','module.exports=43;');assert.throws(()=>guard.finish(),/POST_EXECUTION_MODULE_DRIFT/);
  const next=createModuleGuard(dep(f));load(next,f.root,'node_modules/dep/index.cjs',{format:'commonjs',context:'commonjs'});
  f.put('node_modules/dep/package.json','{"name":"dep","version":"1.0.1"}');assert.throws(()=>next.finish(),/POST_EXECUTION_MODULE_DRIFT/);
});
test('module and package bounds include every actual loaded input',(t)=>{
  const f=fixture(t),spec=dep(f);
  for(const limits of [{maximum_module_files:1},{maximum_total_module_bytes:1},{maximum_packages:0},{maximum_module_file_bytes:1},{maximum_package_depth:0}]){
    assert.throws(()=>{const guard=createModuleGuard({...spec,module_limits:{...moduleLimits,...limits}});load(guard,f.root,'app/entry.mjs');load(guard,f.root,'node_modules/dep/index.cjs',{format:'commonjs',context:'commonjs'});},/LIMIT|DEPENDENCY_PACKAGE_BOUNDARY/);
  }
});

test('fresh native child observes actual ESM, CommonJS and JSON with exact bytes',(t)=>{
  return (async()=>{
    const f=fixture(t);f.put('app/value.json','{"one":1}');f.put('app/entry.mjs',`import data from './value.json' with {type:'json'};import dep from 'dep';process.stdout.write(JSON.stringify({sum:data.one+dep.answer})+'\\n');`);
    const spec=dep(f),outside=path.join(f.parent,'observation');fs.mkdirSync(outside);spec.result_file=path.join(outside,'modules.json');
    const specPath=path.join(outside,'spec.json');fs.writeFileSync(specPath,JSON.stringify(spec));
    const opts=childOptions(f.root);opts.env.USHSO_WP5_RUN_SPEC=specPath;
    const result=await runBoundedChild(['--import',path.join(f.root,commonRelative),path.join(f.root,'app/entry.mjs')],opts);
    assert.equal(result.code,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{sum:43});
    const observed=JSON.parse(fs.readFileSync(spec.result_file));assert.equal(observed.status,'complete');
    for(const file of ['app/entry.mjs','app/value.json','node_modules/dep/index.cjs','node_modules/dep/value.json'])assert.equal(observed.modules.find(r=>r.path===file).sha256,sha256(fs.readFileSync(path.join(f.root,file))));
    assert.ok([null,'commonjs'].includes(observed.modules.find(r=>r.path.endsWith('index.cjs')).reported_format));
    assert.equal(observed.packages[0].name,'dep');
  })();
});
test('native child deadlines, output bounds, failures and signals cannot become success',async(t)=>{
  const f=fixture(t),opts=childOptions(f.root);
  const control=await runBoundedChild(['-e','process.stdout.write("ok")'],opts);assert.equal(control.stdout,'ok');assert.equal(control.code,0);
  const exit=await runBoundedChild(['-e','process.exitCode=7'],opts);assert.equal(exit.code,7);
  const signal=await runBoundedChild(['-e','process.kill(process.pid,"SIGTERM")'],opts);assert.equal(signal.signal,'SIGTERM');
  const deadline=await runBoundedChild(['-e','setInterval(()=>{},1000)'],{...opts,maximumMilliseconds:100});assert.equal(deadline.reason,'CHILD_DEADLINE');assert.equal(deadline.signal,'SIGKILL');
  const output=await runBoundedChild(['-e','process.stdout.write("a".repeat(10000))'],{...opts,maximumOutputBytes:100});assert.equal(output.reason,'CHILD_OUTPUT_LIMIT');
  assert.throws(()=>parseNativeTap(control.stdout),/TAP_ENVELOPE_INVALID/);
});
test('native TAP requires complete named cases, nonzero counts and terminal counters',()=>{
  assert.deepEqual(parseNativeTap(tap(['required','new discovered']),['required']).names,['required','new discovered']);
  const cases=[['',/ENVELOPE/],[tap([]),/CASE_INVENTORY/],[tap(['other']),/MANDATORY/],[tap(['required','required']),/CASE_INVENTORY/],[tap().replace('ok 1','not ok 1'),/NONPASS/],[tap().replace('ok 1 - required','ok 1 - required # SKIP'),/NONPASS/],[tap().replace('ok 1 - required','ok 1 - required # TODO'),/NONPASS/],[tap().replace('# pass 1','# pass 0'),/COUNTERS/],[tap().replace('# cancelled 0','# cancelled 1'),/COUNTERS/],[tap().replace('# skipped 0','# skipped 1'),/COUNTERS/],[tap().replace('# todo 0','# todo 1'),/COUNTERS/],[tap().replace('# fail 0','# fail 1'),/COUNTERS/],[tap().replace('1..1\n',''),/CASE_INVENTORY/],[tap().slice(0,-1),/ENVELOPE/],[tap(['tests/file.test.mjs']),/WRAPPER/],[tap(['required'],'garbage\n'),/MALFORMED/]];
  for(const [text,error] of cases)assert.throws(()=>parseNativeTap(text,['required']),error);
});
test('newly discovered native nested test leaves remain mandatory and accounted',async(t)=>{
  const f=fixture(t);f.put('app/nested.mjs',`import test,{describe,it} from 'node:test';import assert from 'node:assert/strict';test('required',()=>assert.equal(1,1));test('new parent',async t=>{await t.test('child one',()=>{});await t.test('child two',()=>{});});describe('new suite',()=>{it('suite leaf',()=>{});});`);
  const native=await runBoundedChild(['--test-reporter=tap',path.join(f.root,'app/nested.mjs')],childOptions(f.root));assert.equal(native.code,0,native.stderr);
  const parsed=parseNativeTap(native.stdout,['required']);assert.equal(parsed.count,5);assert.equal(parsed.leaf_count,4);assert.equal(parsed.suites,1);assert.ok(parsed.names.includes('child one'));assert.ok(parsed.names.includes('child two'));
});
test('historical content, pin edits, restamped PASS and origin changes are rejected',(t)=>{
  const f=fixture(t),pkg=path.join(f.root,'verification/wp5/v1.1.0');
  const history=JSON.parse(fs.readFileSync(path.join(verificationRoot,'receipts/v1.0-package-pins.json')));
  for(const row of history.files)f.put(row.path,fs.readFileSync(path.join(repositoryRoot,row.path)));
  for(const rel of ['evidence-ledger.json',...['activation-status','delivery-wave-fixtures','fixture-matrix','legacy-lane-parity','r2-capture-protocol','request-capture-reconciliation','zero-payload-proof','v1.0-package-pins','current-subject-policy'].map(n=>'receipts/'+n+'.json')])f.put('verification/wp5/v1.1.0/'+rel,fs.readFileSync(path.join(verificationRoot,rel)));
  assert.equal(verifyHistorical(f.root,pkg).files.length,13);
  const pinRel='verification/wp5/v1.1.0/receipts/v1.0-package-pins.json';const original=fs.readFileSync(path.join(f.root,pinRel));
  f.put(pinRel,JSON.stringify({...history,files:history.files.slice(1)}));assert.throws(()=>verifyHistorical(f.root,pkg),/HISTORICAL_PINS_ALTERED/);f.put(pinRel,original);
  f.put(history.files[0].path,'altered');assert.throws(()=>verifyHistorical(f.root,pkg),/INPUT_DRIFT/);f.put(history.files[0].path,fs.readFileSync(path.join(repositoryRoot,history.files[0].path)));
  const refRel='verification/wp5/v1.1.0/receipts/r2-capture-protocol.json';const refOriginal=fs.readFileSync(path.join(f.root,refRel));
  f.put(refRel,JSON.stringify({...JSON.parse(refOriginal),current_result:'PASS'}));assert.throws(()=>verifyHistorical(f.root,pkg),/HISTORICAL_PASS_RELABELED/);f.put(refRel,refOriginal);
  const policy=readPolicy();policy.origin_input_pins.files=[];policy.origin_input_pins_hash=digest(policy.origin_input_pins);
  f.put('verification/wp5/v1.1.0/receipts/current-subject-policy.json',JSON.stringify(policy));assert.throws(()=>verifyHistorical(f.root,pkg),/HISTORICAL_ORIGIN_HASH/);
});

test('missing and nonpositive or noninteger module limits reject before any module load',(t)=>{
  const f=fixture(t),spec=f.spec();
  for(const key of Object.keys(moduleLimits))for(const value of [undefined,0,-1,1.5,NaN,Infinity]){
    assert.throws(()=>createModuleGuard({...spec,module_limits:{...moduleLimits,[key]:value}}),/MODULE_LIMIT_INVALID/);
  }
});
test('deadline terminates task-owned descendants and drains inherited pipes within the bound',async(t)=>{
  const f=fixture(t);const marker=path.join(f.parent,'descendant.pid');
  f.put('app/parent.mjs',`import {spawn} from 'node:child_process';import fs from 'node:fs';const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});fs.writeFileSync(${JSON.stringify(marker)},String(c.pid));setInterval(()=>{},1000);`);
  const start=Date.now(),result=await runBoundedChild([path.join(f.root,'app/parent.mjs')],{...childOptions(f.root),maximumMilliseconds:300});
  assert.equal(result.reason,'CHILD_DEADLINE');assert.equal(result.signal,'SIGKILL');assert.ok(Date.now()-start<1500);
  const pid=Number(fs.readFileSync(marker,'utf8'));
  // A killed orphan may briefly remain as a reparented zombie. It must never
  // remain an executing process or keep an output pipe open.
  try { const status=fs.readFileSync(`/proc/${pid}/stat`,'utf8');assert.equal(status.slice(status.lastIndexOf(')')+2).split(' ')[0],'Z'); }
  catch(error){if(error.code!=='ENOENT')throw error;}
});
