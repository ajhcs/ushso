// Current semantic input accounting. This instrumentation is not a security sandbox.
// Keep this preload's static imports restricted to Node builtins.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { registerHooks, isBuiltin } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const verificationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repositoryRoot = path.resolve(verificationRoot, '../../..');
const ownFile = fileURLToPath(import.meta.url);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function canonicalJson(value) {
  const normalize = (x) => x === null || typeof x !== 'object' ? x : Array.isArray(x)
    ? x.map(normalize) : Object.fromEntries(Object.keys(x).sort().map((k) => [k, normalize(x[k])]));
  return JSON.stringify(normalize(value));
}
export const digest = (value) => sha256(canonicalJson(value));
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const within = (p, root) => p === root || p.startsWith(root + path.sep);
export function requireCondition(ok, code) {
  if (!ok) throw Object.assign(new Error(code), { code });
}
export function relativePath(value) {
  requireCondition(typeof value === 'string' && value.length > 0 && !value.includes('\\') &&
    !path.posix.isAbsolute(value) && value.split('/').every((p) => p && p !== '.' && p !== '..'), 'INVALID_RELATIVE_PATH');
  return value;
}
function rejectSymlinkComponents(absolute) {
  let current=absolute;
  while (true) {
    requireCondition(!fs.lstatSync(current).isSymbolicLink(),'SYMLINK_FORBIDDEN');
    if(current===path.dirname(current)) break;current=path.dirname(current);
  }
}
export function regularFile(root, relative, maximumBytes = 16777216) {
  relativePath(relative);
  const absolute = path.resolve(root, relative);
  requireCondition(within(absolute, path.resolve(root)), 'FILE_OUTSIDE_ROOT');
  rejectSymlinkComponents(absolute);
  const st = fs.statSync(absolute);
  requireCondition(st.isFile(), 'REGULAR_FILE_REQUIRED');
  requireCondition(st.size <= maximumBytes, 'FILE_BYTE_LIMIT');
  const bytes = fs.readFileSync(absolute);
  requireCondition(bytes.length === st.size && bytes.length <= maximumBytes, 'FILE_SIZE_DRIFT');
  return { path: relative, sha256: sha256(bytes), bytes: bytes.length };
}
const jsonFile = (root, rel, max) => {
  regularFile(root, rel, max);
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
};
export function inventory(root, spec) {
  const limits = spec.bounds;
  for (const k of ['maximum_files', 'maximum_total_bytes', 'maximum_file_bytes', 'maximum_depth'])
    requireCondition(Number.isSafeInteger(limits[k]) && limits[k] > 0, 'INVENTORY_LIMIT_INVALID');
  const found = new Map();
  let total = 0;
  function add(rel) {
    if (found.has(rel)) return;
    requireCondition(found.size < limits.maximum_files, 'INVENTORY_COUNT_LIMIT');
    const record = regularFile(root, rel, limits.maximum_file_bytes);
    total += record.bytes;
    requireCondition(total <= limits.maximum_total_bytes, 'INVENTORY_TOTAL_LIMIT');
    found.set(rel, record);
  }
  function walk(rel, depth) {
    relativePath(rel);
    requireCondition(depth <= limits.maximum_depth, 'INVENTORY_DEPTH_LIMIT');
    const absolute = path.join(root, rel);rejectSymlinkComponents(absolute);const st = fs.lstatSync(absolute);
    requireCondition(!st.isSymbolicLink(), 'SYMLINK_FORBIDDEN');
    requireCondition(st.isDirectory(), 'DIRECTORY_REQUIRED');
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a,b) => compare(a.name,b.name))) {
      requireCondition(!entry.isSymbolicLink(), 'SYMLINK_FORBIDDEN');
      if (entry.isDirectory() && entry.name === 'node_modules') continue;
      const child = rel + '/' + entry.name;
      if (entry.isDirectory()) walk(child, depth + 1);
      else { requireCondition(entry.isFile(), 'REGULAR_FILE_REQUIRED'); add(child); }
    }
  }
  requireCondition(new Set(spec.recursive_roots).size === spec.recursive_roots.length &&
    new Set(spec.exact_files).size === spec.exact_files.length, 'DUPLICATE_INVENTORY_ROOT');
  for (const rel of spec.recursive_roots) walk(rel, 0);
  for (const rel of spec.exact_files) add(rel);
  return [...found.values()].sort((a,b) => compare(a.path,b.path));
}
export function assertManifest(records) {
  requireCondition(Array.isArray(records) && records.length > 0, 'EMPTY_MANIFEST');
  const names = new Set();
  for (const row of records) {
    relativePath(row.path);
    requireCondition(!names.has(row.path), 'DUPLICATE_MANIFEST_ENTRY');
    names.add(row.path);
    requireCondition(/^[a-f0-9]{64}$/.test(row.sha256) && Number.isSafeInteger(row.bytes) && row.bytes >= 0, 'INVALID_FILE_RECORD');
  }
  requireCondition(records.map((r) => r.path).join('\0') === [...names].sort(compare).join('\0'), 'UNSORTED_MANIFEST');
}
export function assertUnchanged(root, records) {
  assertManifest(records);
  for (const row of records) {
    const after = regularFile(root, row.path);
    requireCondition(after.sha256 === row.sha256 && after.bytes === row.bytes, 'INPUT_DRIFT');
  }
}
export function connectorFingerprint(records, root = repositoryRoot) {
  const hash = createHash('sha256');
  // Preserve the released fingerprint algorithm, including its lexical ordering.
  for (const record of records.filter((r) => r.path.startsWith('packages/connectors/') &&
    !r.path.includes('/node_modules/') && !r.path.endsWith('manifests/package-manifest.json')).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    hash.update(record.path.slice('packages/connectors/'.length)); hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, record.path))); hash.update('\0');
  }
  return hash.digest('hex');
}
export function readPolicy() { return jsonFile(verificationRoot, 'receipts/current-subject-policy.json'); }
export function verifyHistorical(root = repositoryRoot, pkg = verificationRoot) {
  const pins = jsonFile(pkg, 'receipts/v1.0-package-pins.json');
  requireCondition(digest(pins) === 'e2ba6f1bc4c2977503f08ae67dc20184ea077ffe8cd6f8daa042810d2ca92f7e', 'HISTORICAL_PINS_ALTERED');
  requireCondition(pins.files.length === 13 && pins.historical_fingerprint === 'df5fb94f4f3f3468ca2631a63768a4bf7711696657c88c4b7df57830e7031b99', 'HISTORICAL_PIN_SHAPE');
  assertManifest(pins.files);
  assertUnchanged(root, pins.files);
  const policy = jsonFile(pkg, 'receipts/current-subject-policy.json');
  requireCondition(policy.origin.component_merge_sha === 'e268652c5e92876a3540809595636c4795ebec6f' &&
    policy.origin.component_merge_tree === '0ffb5e5e2ad336f5f67695adc3398dc67c503037', 'HISTORICAL_ORIGIN_INVALID');
  requireCondition(policy.origin_hash === '13b949613a0110c4279f180834ce0a8284659a0fe95f16600da6bf2ef34b8f57' && policy.origin_input_pins_hash === '302a4335ab01179e36089a889c689eeb0f6ff4f5c9d521783607849cd93648e4' &&
    policy.origin_hash === digest(policy.origin) && policy.origin_input_pins_hash === digest(policy.origin_input_pins), 'HISTORICAL_ORIGIN_HASH');
  requireCondition(policy.origin.current_approval_issued === false && policy.origin.historical_approval_transferred === false, 'ORIGIN_APPROVAL_FORBIDDEN');
  for (const rel of ['evidence-ledger.json', ...['activation-status','delivery-wave-fixtures','fixture-matrix','legacy-lane-parity','r2-capture-protocol','request-capture-reconciliation','zero-payload-proof'].map((x) => 'receipts/'+x+'.json')]) {
    const ref = jsonFile(pkg, rel);
    requireCondition(ref.evidence_kind === 'historical_reference_only' && ref.current_result === null && ref.approval === null, 'HISTORICAL_PASS_RELABELED');
    const row = pins.files.find((x) => x.path === ref.original.path);
    requireCondition(row && row.sha256 === ref.original.sha256 && row.bytes === ref.original.bytes, 'HISTORICAL_REFERENCE_INVALID');
  }
  return { files: pins.files, origin: policy.origin, origin_input_pins: policy.origin_input_pins };
}

export function inspectDependency(root, file, lock, limits) {
  relativePath(file);
  requireCondition(file.startsWith('node_modules/'), 'DEPENDENCY_OUTSIDE_NODE_MODULES');
  const parts = file.split('/');
  const boundaries = [];
  for (let i = 1; i < parts.length; i++) {
    const rel = parts.slice(0, i).join('/') + '/package.json';
    if (fs.existsSync(path.join(root, rel))) {
      const record = regularFile(root, rel, limits.maximum_module_file_bytes);
      const metadata = jsonFile(root, rel), packagePath = parts.slice(0, i).join('/');
      const locked = lock.packages?.[packagePath];
      if (locked) {
        requireCondition(!locked.link && !locked.resolved?.startsWith('file:'), 'WORKSPACE_DEPENDENCY_UNSUPPORTED');
        const last = packagePath.slice(packagePath.lastIndexOf('node_modules/') + 13);
        requireCondition(metadata.name === last && metadata.version === locked.version && (!locked.name || locked.name === metadata.name), 'PACKAGE_LOCK_MISMATCH');
      } else {
        const parent = boundaries.findLast((b) => b.lock_entry);
        requireCondition(parent && !packagePath.slice(parent.lock_path.length).includes('/node_modules/') &&
          metadata.name === undefined && metadata.version === undefined, 'UNEXPLAINED_PACKAGE_BOUNDARY');
      }
      boundaries.push({ ...record, name: metadata.name ?? null, version: metadata.version ?? null, lock_path: locked ? packagePath : null, lock_entry: locked ?? null });
    }
  }
  requireCondition(boundaries.some((x) => x.lock_entry) && boundaries.length <= limits.maximum_package_depth, 'DEPENDENCY_PACKAGE_BOUNDARY');
  return boundaries;
}
export function createModuleGuard(spec) {
  const limits = {...spec.module_limits};
  for(const key of ['maximum_packages','maximum_module_files','maximum_total_module_bytes','maximum_module_file_bytes','maximum_package_depth'])
    requireCondition(Number.isSafeInteger(limits[key]) && limits[key]>0,'MODULE_LIMIT_INVALID');
  const root = path.resolve(spec.root); assertManifest(spec.files);
  const expected = new Map(spec.files.map((r) => [r.path,r]));
  const modules = new Map(), packages = new Map(), builtins = new Set(), denied = [];
  const preload = regularFile(root, 'verification/wp5/v1.1.0/tools/common.mjs');
  requireCondition(expected.get(preload.path)?.sha256 === preload.sha256, 'PRELOAD_NOT_PINNED');
  let total = 0;
  function fail(code) { denied.push(code); requireCondition(false, code); }
  function check(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:' || parsed.href.includes('#') || parsed.href.includes('?')) fail('MODULE_URL_FORBIDDEN');
    const absolute = fileURLToPath(parsed);
    if (!within(absolute, root)) fail('MODULE_OUTSIDE_ROOT');
    const rel = path.relative(root, absolute).split(path.sep).join('/');
    if (rel.endsWith('.node')) fail('NATIVE_ADDON_UNSUPPORTED');
    const actual = regularFile(root, rel, limits.maximum_module_file_bytes);
    let boundaries = [];
    if (rel.startsWith('node_modules/')) {
      boundaries = inspectDependency(root, rel, spec.lock, limits);
      for (const row of boundaries) {
        if (packages.has(row.path) && canonicalJson(packages.get(row.path)) !== canonicalJson(row)) fail('PACKAGE_METADATA_DRIFT');
        packages.set(row.path,row);
      }
      if (packages.size > limits.maximum_packages) fail('DEPENDENCY_PACKAGE_LIMIT');
    } else {
      const before = expected.get(rel);
      if (!before) fail('UNCOVERED_MODULE');
      if (before.sha256 !== actual.sha256 || before.bytes !== actual.bytes) fail('MODULE_INPUT_DRIFT');
    }
    return { actual, absolute, boundaries };
  }
  const hooks = {
    resolve(specifier, context, nextResolve) {
      if (isBuiltin(specifier)) { builtins.add(specifier.replace(/^node:/,'')); return nextResolve(specifier,context); }
      // Check the requested spelling before the native resolver can erase symlinks.
      if (/^(file:|\.?\.?\/|\/)/.test(specifier)) {
        const requested = new URL(specifier,context.parentURL);
        if (requested.protocol === 'file:') {
          const p = fileURLToPath(requested);
          if (!within(p,root)) fail('MODULE_OUTSIDE_ROOT');
          let cur = p;
          while (within(cur,root)) { if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) fail('MODULE_SYMLINK'); if (cur===root) break; cur=path.dirname(cur); }
        }
      }
      if (!/^(?:file:|\.?\.?\/|\/)/.test(specifier) && !specifier.includes(':')) {
        // Native resolution follows package symlinks. Inspect each possible
        // node_modules spelling first, including scoped names, while still
        // preserving the native resolver's result and package export rules.
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0,2).join('/') : specifier.split('/')[0];
        let directory = context.parentURL?.startsWith('file:') ? path.dirname(fileURLToPath(context.parentURL)) : root;
        while (within(directory, root)) {
          const candidate = path.join(directory,'node_modules',name);
          let current = candidate;
          while (within(current,root)) {
            try { if (fs.lstatSync(current).isSymbolicLink()) fail('MODULE_SYMLINK'); }
            catch(error) { if (error.code!=='ENOENT' && error.code!=='ENOTDIR') throw error; }
            if (current===root) break; current=path.dirname(current);
          }
          if (directory===root) break; directory=path.dirname(directory);
        }
      }
      const result = nextResolve(specifier,context);
      if (!isBuiltin(result.url)) check(result.url);
      return result;
    },
    load(url, context, nextLoad) {
      if (isBuiltin(url)) { builtins.add(url.replace(/^node:/,'')); return nextLoad(url,context); }
      const { actual, absolute, boundaries } = check(url), before = fs.readFileSync(absolute);
      const result = nextLoad(url,context);
      if (![undefined,null,'module','commonjs','json'].includes(result.format) ||
        ![undefined,null,'module','commonjs','json'].includes(context.format)) fail('MODULE_FORMAT_UNSUPPORTED');
      if (!(typeof result.source === 'string' || result.source instanceof ArrayBuffer || ArrayBuffer.isView(result.source))) fail('MODULE_SOURCE_UNSUPPORTED');
      const source = typeof result.source === 'string' ? Buffer.from(result.source) : result.source instanceof ArrayBuffer
        ? Buffer.from(result.source) : Buffer.from(result.source.buffer,result.source.byteOffset,result.source.byteLength);
      if (!source.equals(before) || !fs.readFileSync(absolute).equals(before)) fail('MODULE_SOURCE_CHANGED');
      const record = { ...actual, reported_format: result.format ?? null, context_format: context.format ?? null, package_paths: boundaries.map((x) => x.path) };
      if (modules.has(actual.path) && canonicalJson(modules.get(actual.path)) !== canonicalJson(record)) fail('MODULE_RELOAD_DRIFT');
      if (!modules.has(actual.path)) total += actual.bytes;
      modules.set(actual.path,record);
      if (modules.size > limits.maximum_module_files || total > limits.maximum_total_module_bytes) fail('MODULE_TOTAL_LIMIT');
      return result;
    }
  };
  return { hooks, finish() {
    assertUnchanged(root,spec.files);
    for (const row of [...modules.values(),...packages.values()]) {
      const now = regularFile(root,row.path,limits.maximum_module_file_bytes);
      requireCondition(now.sha256===row.sha256 && now.bytes===row.bytes,'POST_EXECUTION_MODULE_DRIFT');
    }
    return { preload, modules:[...modules.values()].sort((a,b)=>compare(a.path,b.path)), packages:[...packages.values()].sort((a,b)=>compare(a.path,b.path)), builtins:[...builtins].sort(), denied };
  } };
}

export function parseNativeTap(text, required = []) {
  requireCondition(typeof text === 'string' && text.startsWith('TAP version 13\n') && text.endsWith('\n'), 'TAP_ENVELOPE_INVALID');
  requireCondition(!/^(?:\s*not ok\b|Bail out!)/m.test(text) && !/^\s*ok [^\n]*#\s*(?:SKIP|TODO)\b/im.test(text), 'TAP_NONPASS');
  const root={depth:0,completed:[],pending:null,plan:null}, scopes=new Map([[0,root]]), records=[], totals=new Map();
  let diagnostic=null, last=null, ended=false;
  for (const line of text.split('\n').slice(1,-1)) {
    if (line==='') continue;
    requireCondition(!ended,'TAP_MALFORMED');
    if (diagnostic) {
      if (line===' '.repeat(diagnostic.indent)+'...') { diagnostic=null;continue; }
      const field=new RegExp('^ {'+diagnostic.indent+"}(duration_ms|type): (.+)$").exec(line);
      requireCondition(field && !diagnostic.fields.has(field[1]),'TAP_MALFORMED');diagnostic.fields.add(field[1]);
      if(field[1]==='type') { requireCondition(["'test'","'suite'"].includes(field[2]),'TAP_MALFORMED');diagnostic.record.type=field[2].slice(1,-1); }
      else requireCondition(/^[0-9]+(?:\.[0-9]+)?$/.test(field[2]),'TAP_MALFORMED');
      continue;
    }
    const diag=/^( *)---$/.exec(line);
    if(diag) { requireCondition(last && diag[1].length===last.depth*4+2 && !last.diagnostic,'TAP_MALFORMED');last.diagnostic=true;diagnostic={record:last,indent:diag[1].length,fields:new Set()};continue; }
    const counter=/^# (tests|suites|pass|fail|cancelled|skipped|todo) ([0-9]+)$/.exec(line);
    if(counter) { requireCondition(root.plan!==null,'TAP_CASE_INVENTORY');requireCondition(!totals.has(counter[1]),'TAP_DUPLICATE_COUNTER');totals.set(counter[1],Number(counter[2]));continue; }
    if(/^# duration_ms [0-9]+(?:\.[0-9]+)?$/.test(line)) { requireCondition(root.plan!==null,'TAP_MALFORMED');ended=true;continue; }
    const item=/^( *)(?:# Subtest: (.+)|ok ([1-9][0-9]*) - (.+)|1\.\.([0-9]+))$/.exec(line);
    requireCondition(item && item[1].length%4===0,'TAP_MALFORMED');
    const depth=item[1].length/4;
    let scope=scopes.get(depth);
    if(!scope) {
      const parent=scopes.get(depth-1)?.pending;
      requireCondition(parent && item[2]!==undefined,'TAP_MALFORMED');
      scope={depth,completed:[],pending:null,plan:null,parent};scopes.set(depth,scope);parent.children=scope;
    }
    if(item[2]!==undefined) {
      requireCondition(scope.plan===null && scope.pending===null,'TAP_MALFORMED');
      scope.pending={name:item[2],depth,type:'test',children:null};
    } else if(item[3]!==undefined) {
      requireCondition(scope.pending && Number(item[3])===scope.completed.length+1 && scope.pending.name===item[4],'TAP_SEQUENCE');
      const record=scope.pending;
      if(record.children) { requireCondition(record.children.plan===record.children.completed.length && record.children.pending===null,'TAP_CASE_INVENTORY');scopes.delete(depth+1); }
      scope.completed.push(record);records.push(record);scope.pending=null;last=record;
    } else {
      requireCondition(scope.pending===null && scope.plan===null,'TAP_DUPLICATE_PLAN');scope.plan=Number(item[5]);
      requireCondition(scope.plan===scope.completed.length,'TAP_CASE_INVENTORY');
    }
  }
  const tests=records.filter(r=>r.type==='test'), leaves=tests.filter(r=>!r.children), names=tests.map(r=>r.name);
  requireCondition(!diagnostic && ended && root.plan===root.completed.length && root.plan>0 && leaves.length>0 &&
    new Set(names).size===names.length,'TAP_CASE_INVENTORY');
  requireCondition(totals.get('tests')===tests.length && totals.get('suites')===records.length-tests.length && totals.get('pass')===tests.length &&
    ['fail','cancelled','skipped','todo'].every(k=>totals.get(k)===0),'TAP_TERMINAL_COUNTERS');
  requireCondition(leaves.every(r=>!/(?:^|\/)[^ ]*\.test\.(?:mjs|cjs|js)$/.test(r.name)),'TAP_WRAPPER_ONLY');
  requireCondition(required.every(n=>names.includes(n)),'TAP_MANDATORY_CASE_MISSING');
  return { names, count:tests.length, leaf_count:leaves.length, leaf_names:leaves.map(r=>r.name), suites:records.length-tests.length };
}
export function assertUnapproved(result) {
  requireCondition(result.evidence_kind==='current_technical_only' && result.approval===null &&
    ['historical_approval_transferred','current_approval_issued','release_qualified','live_collection','managed_persistence','production_changed'].every((k)=>result[k]===false), 'CURRENT_APPROVAL_FORBIDDEN');
}
export function semanticSubject({ policy, files, modules, packages, runtime, fingerprint, configuredPackageManager }) {
  const value = { format:'ushso.wp5-current-semantic-subject.v1', canonical_basis:'ushso-canonical-json.v1', policy,
    files, modules, packages, runtime, connector_fingerprint:fingerprint, configured_package_manager:configuredPackageManager };
  return { sha256:digest(value), value };
}
export function assertSubject(receipt, subject) {
  assertUnapproved(receipt);
  requireCondition(receipt.subject?.sha256===subject.sha256 && digest(receipt.subject.value)===subject.sha256,'CURRENT_SUBJECT_MISMATCH');
}

export async function runBoundedChild(argv, { cwd, env, maximumMilliseconds, maximumOutputBytes }) {
  requireCondition(Number.isSafeInteger(maximumMilliseconds) && maximumMilliseconds>0 && Number.isSafeInteger(maximumOutputBytes) && maximumOutputBytes>0,'CHILD_LIMIT_INVALID');
  requireCondition(process.platform!=='win32','POSIX_PROCESS_GROUP_REQUIRED');
  return new Promise((resolve,reject) => {
    // A fresh POSIX group keeps ordinary child helpers within this command's
    // lifetime. This is cleanup/accounting, not confinement of hostile code.
    const child=spawn(process.execPath,argv,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});
    const chunks={stdout:[],stderr:[]};let bytes=0,reason=null,settled=false,cleanupTimer;
    let exitCode=null,exitSignal=null;
    const terminateGroup=()=>{
      if(!child.pid) return;
      try { process.kill(-child.pid,'SIGKILL'); }
      catch(error) { if(error.code!=='ESRCH') reason??='CHILD_GROUP_CLEANUP_FAILED'; }
    };
    const finish=(code,signal)=>{
      if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cleanupTimer);
      resolve({argv,pid:child.pid,code,signal,reason,stdout:Buffer.concat(chunks.stdout).toString('utf8'),stderr:Buffer.concat(chunks.stderr).toString('utf8'),bytes});
    };
    const stop=(code)=>{
      reason??=code;terminateGroup();
      // Even an unsupported escaped pipe owner cannot make receipt settlement
      // unbounded. Such a result remains a failure with partial output.
      cleanupTimer??=setTimeout(()=>{
        reason='CHILD_CLEANUP_TIMEOUT';child.stdout.destroy();child.stderr.destroy();child.unref();
        finish(exitCode,exitSignal);
      },250);
    };
    const timer=setTimeout(()=>stop('CHILD_DEADLINE'),maximumMilliseconds);
    for(const stream of ['stdout','stderr']) child[stream].on('data',(chunk)=>{
      bytes+=chunk.length;
      if(bytes>maximumOutputBytes) stop('CHILD_OUTPUT_LIMIT');
      else chunks[stream].push(chunk);
    });
    child.once('error',(error)=>{
      if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cleanupTimer);terminateGroup();
      child.stdout.destroy();child.stderr.destroy();reject(error);
    });
    child.once('exit',(code,signal)=>{
      exitCode=code;exitSignal=signal;
      // An otherwise successful parent must not leave its helpers alive.
      try { process.kill(-child.pid,0);stop('CHILD_DESCENDANTS_REMAIN'); }
      catch(error) { if(error.code!=='ESRCH') stop('CHILD_GROUP_CLEANUP_FAILED'); }
    });
    child.once('close',(code,signal)=>finish(code,signal));
  });
}

async function compareCurrentControls(root) {
  const load = (rel) => import(pathToFileURL(path.join(root,rel)).href);
  const [api, foundation, delivery, reconcile] = await Promise.all([
    load('packages/connectors/src/index.mjs'),load('packages/connectors/src/testing/fixture-matrix.mjs'),
    load('packages/connectors/src/testing/wave-fixtures.mjs'),load('packages/connectors/src/testing/reconciliation-audit.mjs')]);
  const history=(name)=>jsonFile(root,'verification/wp5/v1.0.0/receipts/'+name+'.json');
  const matrix=await foundation.runFixtureMatrix(), waves=await delivery.runDeliveryWaveFixtureMatrix(), audit=await reconcile.runReconciliationAudit();
  for(const result of [matrix,waves,audit]) assert.equal(result.status,'PASS');
  assert.deepEqual(matrix.scenarios.map((s)=>s.scenario),history('fixture-matrix').scenarios);
  assert.deepEqual(waves.scenarios.map((s)=>s.scenario),history('delivery-wave-fixtures').scenarios);
  assert.equal(matrix.totals.scenarios,18);assert.equal(matrix.totals.assertions,81);
  assert.equal(waves.totals.scenarios,10);assert.equal(waves.totals.assertions,64);
  assert.equal(waves.recorded_fixtures,18);assert.equal(waves.fixture_manifest_digest,history('delivery-wave-fixtures').fixture_manifest_digest);
  assert.equal(api.validateDeliveryWaveRegistry().source_instances,18);assert.equal(api.validateRegulatorApcdRegistry().entries,8);
  assert.equal(api.deliveryWaveManifest().length,18);
  for(const result of [matrix,waves]) assert.ok(Object.values(result.zero_external_actions).every((n)=>n===0));
  assert.equal(audit.discoveries,2);assert.equal(audit.exact_locator_capture_links,2);
  for(const k of ['prohibited_capture_classifications','blocked_sentinel_transport_calls','healthcare_row_captures']) assert.equal(audit[k],0);
  const legacy=history('legacy-lane-parity');
  const corpus=fs.readFileSync(path.join(root,legacy.source_artifact));
  const parity=api.buildLegacyLaneParity(corpus.toString('utf8').trim().split(/\n/).map(JSON.parse));
  assert.deepEqual(parity.counts,legacy.counts);assert.equal(parity.records,legacy.records_reconciled);
  assert.equal(parity.mapping_digest,legacy.mapping_digest);assert.equal(parity.automatic_identity_merges,0);
  return {matrix_scenarios:18,matrix_assertions:81,delivery_scenarios:10,delivery_assertions:64,legacy_records:parity.records,
    legacy_input_sha256:sha256(corpus),legacy_mapping_digest:parity.mapping_digest,reconciled_discoveries:2,external_actions:0};
}

export async function verifyCurrent() {
  requireCondition(typeof registerHooks==='function','NODE_22_15_REQUIRED');
  const historical=verifyHistorical(), policy=readPolicy(), design=policy.design;
  const files=inventory(repositoryRoot,design.repository_inventory);
  assertManifest(files);
  const lock=jsonFile(repositoryRoot,'package-lock.json'), limits=design.execution.commands.limits;
  const expectedFiles=policy.package_files;
  const actualPackage=files.filter((x)=>x.path.startsWith('verification/wp5/v1.1.0/')).map((x)=>x.path);
  assert.deepEqual(actualPackage,[...expectedFiles].sort(compare));
  const tests=files.filter((x)=>/^packages\/connectors\/tests\/.+\.test\.(?:cjs|mjs|js)$/.test(x.path)).map((x)=>x.path);
  requireCondition(design.execution.required_existing_test_files.every((x)=>tests.includes(x)),'MANDATORY_TEST_FILE_MISSING');
  const commands=[...tests.map((file)=>({file,kind:'test',argv:['--import',ownFile,'--test-reporter=tap',path.join(repositoryRoot,file)]})),
    {file:'packages/connectors/tools/validate-package.mjs',kind:'validator',argv:['--import',ownFile,path.join(repositoryRoot,'packages/connectors/tools/validate-package.mjs')]},
    {file:'verification/wp5/v1.1.0/tools/common.mjs',kind:'comparison',argv:['--import',ownFile,ownFile,'--compare-current']}];
  requireCondition(commands.length<=limits.maximum_children,'CHILD_COUNT_LIMIT');
  const temporary=path.resolve(process.env.TMPDIR??tmpdir());
  requireCondition(!within(temporary,repositoryRoot),'SCRATCH_IN_SOURCE_FORBIDDEN');
  const scratch=fs.mkdtempSync(path.join(temporary,'ushso-wp5-current-'));
  const started=Date.now(), executed=[], modules=new Map(), packages=new Map();
  let outputBytes=0;
  try {
    for(let index=0;index<commands.length;index++) {
      const command=commands[index], directory=path.join(scratch,String(index));fs.mkdirSync(directory);
      const spec={root:repositoryRoot,files,lock,module_limits:design.executed_module_coverage.bounds,result_file:path.join(directory,'modules.json')};
      const specPath=path.join(directory,'spec.json');fs.writeFileSync(specPath,canonicalJson(spec));
      const env={...process.env,USHSO_WP5_RUN_SPEC:specPath};
      for(const key of ['NODE_OPTIONS','NODE_PATH','NODE_TEST_CONTEXT','WP5_PROBE_POLICY']) delete env[key];
      const remaining=limits.maximum_combined_milliseconds-(Date.now()-started);
      requireCondition(remaining>0,'COMBINED_DEADLINE');
      const result=await runBoundedChild(command.argv,{cwd:repositoryRoot,env,
        maximumMilliseconds:Math.min(remaining,limits.maximum_child_milliseconds),maximumOutputBytes:limits.maximum_output_bytes_per_child});
      outputBytes+=result.bytes;
      requireCondition(outputBytes<=limits.maximum_combined_output_bytes,'COMBINED_OUTPUT_LIMIT');
      fs.writeFileSync(path.join(directory,'process.json'),JSON.stringify(result,null,2)+'\n');
      requireCondition(result.reason===null && result.code===0 && result.signal===null,'CHILD_EXECUTION_FAILED');
      const observation=jsonFile(directory,'modules.json',limits.maximum_output_bytes_per_child);
      requireCondition(observation.preload?.sha256===files.find((r)=>r.path==='verification/wp5/v1.1.0/tools/common.mjs').sha256,'PRELOAD_OBSERVATION_INVALID');
      requireCondition(observation.status==='complete' && observation.exit_code===0 && observation.spec_sha256===sha256(fs.readFileSync(specPath)) && observation.denied.length===0,'MODULE_TERMINAL_INVALID');
      requireCondition(observation.modules.some((x)=>x.path===command.file) || command.kind==='comparison','CHILD_MODULE_NOT_OBSERVED');
      for(const [target,records] of [[modules,observation.modules],[packages,observation.packages]]) for(const row of records) {
        const existing=target.get(row.path);
        if(existing) requireCondition(canonicalJson(existing)===canonicalJson(row),'CHILD_MODULE_DISAGREEMENT');
        target.set(row.path,row);
      }
      requireCondition(modules.size<=design.executed_module_coverage.bounds.maximum_module_files &&
        [...modules.values()].reduce((sum,r)=>sum+r.bytes,0)<=design.executed_module_coverage.bounds.maximum_total_module_bytes &&
        packages.size<=design.executed_module_coverage.bounds.maximum_packages,'COMBINED_MODULE_LIMIT');
      let controls;
      if(command.kind==='test') controls=parseNativeTap(result.stdout,design.mandatory_case_inventory.files.find((x)=>x.file===command.file)?.mandatory_names??[]);
      else {
        controls=JSON.parse(result.stdout);
        if(command.kind==='validator') {
          for(const [k,v] of Object.entries({status:'PASS',descriptor_templates:18,route_templates:29,fixture_scenarios:18,delivery_wave_scenarios:10,assertions:145,external_actions:0})) assert.equal(controls[k],v);
          assert.equal(controls.implementation_fingerprint,connectorFingerprint(files));
        } else assert.equal(controls.external_actions,0);
      }
      executed.push({file:command.file,kind:command.kind,argv:result.argv,pid:result.pid,exit_code:result.code,signal:result.signal,
        stdout_sha256:sha256(result.stdout),stderr_sha256:sha256(result.stderr),output_bytes:result.bytes,controls,observation_sha256:digest(observation)});
    }
    assert.deepEqual(inventory(repositoryRoot,design.repository_inventory),files);
    assertUnchanged(repositoryRoot,[...modules.values()].map(({path,sha256,bytes})=>({path,sha256,bytes})).sort((a,b)=>compare(a.path,b.path)));
    for(const row of packages.values()) assert.equal(regularFile(repositoryRoot,row.path).sha256,row.sha256);
    const subject=semanticSubject({policy,files,modules:[...modules.values()].sort((a,b)=>compare(a.path,b.path)),packages:[...packages.values()].sort((a,b)=>compare(a.path,b.path)),
      runtime:{node:process.version,versions:{...process.versions},platform:process.platform,arch:process.arch},fingerprint:connectorFingerprint(files),configuredPackageManager:jsonFile(repositoryRoot,'package.json').packageManager??null});
    const result={status:'PASS',work_package:'WP5',...design.output_boundaries,subject,historical_origin:historical.origin.component_merge_sha,
      execution:{pid:process.pid,commands:executed,started_at:new Date(started).toISOString(),duration_ms:Date.now()-started,actual_npm_execution:'unobserved',output_bytes:outputBytes},
      limitation:'Current fixture technical evidence only; module input accounting is not a sandbox or source/production approval.'};
    assertUnapproved(result);fs.rmSync(scratch,{recursive:true,force:true});return result;
  } catch(error) {
    error.message += `; retained execution diagnostics: ${scratch}`;
    throw error;
  }
}

// Every child is a new process. Its normal exit hook writes one bounded terminal
// observation after rechecking actual source/dependency bytes; missing output fails.
if(process.env.USHSO_WP5_RUN_SPEC) {
  const specPath=path.resolve(process.env.USHSO_WP5_RUN_SPEC);
  const specBytes=fs.readFileSync(specPath);requireCondition(specBytes.length<=1048576,'EXECUTION_SPEC_LIMIT');
  const spec=JSON.parse(specBytes);
  requireCondition(path.isAbsolute(spec.result_file) && path.dirname(spec.result_file)===path.dirname(specPath) &&
    path.basename(spec.result_file)==='modules.json' && !within(specPath,path.resolve(spec.root)), 'EXECUTION_RESULT_PATH');
  const guard=createModuleGuard(spec);
  const registration=registerHooks(guard.hooks);
  process.once('exit',(code)=>{
    let result;
    try { result={status:'complete',exit_code:code,spec_sha256:sha256(specBytes),...guard.finish()}; }
    catch(error) { result={status:'failed',exit_code:code,spec_sha256:sha256(specBytes),code:error.code??error.name};process.exitCode=1; }
    const bytes=Buffer.from(canonicalJson(result)+'\n');
    requireCondition(bytes.length<=8388608,'MODULE_RECEIPT_LIMIT');
    fs.writeFileSync(spec.result_file,bytes,{flag:'wx'});
    registration.deregister();
  });
  if(process.argv[1] && path.resolve(process.argv[1])===ownFile && process.argv[2]==='--compare-current')
    process.stdout.write(JSON.stringify(await compareCurrentControls(spec.root))+'\n');
}
