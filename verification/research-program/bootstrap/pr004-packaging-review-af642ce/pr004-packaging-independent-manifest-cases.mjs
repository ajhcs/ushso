import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const [root, outFile] = process.argv.slice(2);
assert(root && path.isAbsolute(root) && outFile && path.isAbsolute(outFile));
const directory = path.join(root, 'verification/research-program/pr-004');
const {loadPackagedCompletenessView} = await import(pathToFileURL(path.join(directory, 'completeness-view-packaging.mjs')));
const transportBytes = await fs.readFile(path.join(directory, 'completeness-view.json.gz'));
const originalBytes = await fs.readFile(path.join(directory, 'completeness-view.manifest.json'));
const original = JSON.parse(originalBytes);
const started_at = new Date().toISOString();
const cases = [];
async function check(name, value, shouldPass) {
  let accepted = false, code = null;
  try {
    const result = await loadPackagedCompletenessView({
      root, manifestBytes: Buffer.from(JSON.stringify(value)), transportBytes
    });
    assert.equal(result.decoded.length, 49808256);
    assert.equal(result.view.membership.record_count, 3434);
    accepted = true;
  } catch (error) {
    code = error.code ?? error.name;
  }
  const passed = accepted === shouldPass;
  cases.push({name, expected: shouldPass ? 'accept' : 'reject', actual: accepted ? 'accept' : 'reject', code, passed});
  console.log(JSON.stringify(cases.at(-1)));
  if (global.gc) global.gc();
}
await check('canonical-manifest', original, true);
function reorder(v) {
  if (Array.isArray(v)) return v.map(reorder);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).reverse().map(([k,x]) => [k,reorder(x)]));
  return v;
}
await check('same-metadata-reordered-object-keys', reorder(original), true);
const fields = [
  'format','schema_version','compressor.module','compressor.method','compressor.level',
  'compressor.header.mtime','compressor.header.os','compressor.header.xfl',
  'transport.path','transport.encoding','transport.bytes','transport.sha256',
  'decoded.path','decoded.encoding','decoded.bytes','decoded.sha256',
  'decoded.git_snapshot.commit','decoded.git_snapshot.path',
  'logical.schema_version','logical.artifact_id','logical.artifact_digest','logical.vector_encoding',
  'logical.cohort','logical.generation','logical.as_of','logical.input_digest',
  'logical.record_count','logical.source_membership_count','logical.isolated_count',
  'logical.searchable_record_count','logical.vector_field_count','logical.metric_count',
  'logical.evidence_catalog_count','offline_consumption.loader','offline_consumption.verifier'
];
for (const field of fields) {
  for (const action of ['change','remove']) {
    const copy = structuredClone(original);
    const parts = field.split('.'), leaf = parts.pop();
    let obj = copy;
    for (const k of parts) obj = obj[k];
    assert(Object.hasOwn(obj, leaf), 'controller fixture field missing: '+field);
    if (action === 'remove') delete obj[leaf];
    else if (typeof obj[leaf] === 'number') obj[leaf] += 1;
    else if (/^[a-f0-9]{64}$/.test(obj[leaf])) obj[leaf] = '0'.repeat(64);
    else if (/^[a-f0-9]{40}$/.test(obj[leaf])) obj[leaf] = '0'.repeat(40);
    else obj[leaf] = 'controller-wrong-' + obj[leaf];
    await check(action+'-'+field, copy, false);
  }
}
const report = {
  format:'ushso.pr004.independent-manifest-field-checks.v1',
  reviewer:'root Astra; cases authored before the corrected producer head was available',
  started_at, completed_at:new Date().toISOString(), root,
  case_count:cases.length, cases, status:cases.every(x=>x.passed)?'passed':'changes_requested'
};
await fs.writeFile(outFile, JSON.stringify(report,null,2)+'\n', {flag:'wx'});
process.exitCode=report.status==='passed'?0:1;
