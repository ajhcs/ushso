import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runCmsUpdate, checkedInput} from './cms-update-cycle.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = [process.env.TMPDIR, process.env.RUNNER_TEMP].find((v) => typeof v === 'string' && path.isAbsolute(v) && path.resolve(v) !== '/');
assert.ok(scratch, 'TMPDIR or RUNNER_TEMP scratch required');
async function addBaselinePeer({root, plan, source}) {
  const pkg = plan.baseline_directory, manifestFile = path.join(pkg, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile));
  const descriptor = JSON.parse(await fs.readFile(path.join(pkg, manifest.records[0].file)));
  const file = 'records/' + sha('cms-unavailable') + '.json';
  const saved = await write(path.join(pkg, file), {...descriptor, record_id: 'cms-unavailable'});
  manifest.records.push({record_id: 'cms-unavailable', file, sha256: saved.sha256, variables: 1});
  manifest.variables++; manifest.pages++;
  const updated = await write(manifestFile, manifest);
  const spec = JSON.parse(await fs.readFile(plan.baseline_spec.file));
  const peer = {record_id: 'cms-unavailable', ...source, pointer: '/variables'};
  spec.expected_fields.push(peer); spec.packages[0].manifest_sha256 = updated.sha256;
  plan.baseline_spec = await write(plan.baseline_spec.file, spec);
  const corpus = plan.corpus_files[0];
  await fs.appendFile(corpus.file, JSON.stringify({record_id: 'cms-unavailable'}) + '\n');
  corpus.sha256 = sha(await fs.readFile(corpus.file));
  return peer;
}
test('CMS record isolation updates a healthy record and preserves failed peer from the same package', () => fixture(async ({root, modules, plan, source}) => {
  const peer = await addBaselinePeer({root, plan, source});
  const changed = await write(path.join(root, 'changed.json'), {variables: [{name: 'EXACT', description: 'Changed public definition.', measurement_unit: null}]});
  const adapter_input = await write(path.join(root, 'adapter.json'), {inputs: [{record_id: 'cms-test', ...changed}]});
  plan.retained_inputs.push(changed, adapter_input);
  plan.jobs = [{family: 'legacy', record_ids: ['cms-test', 'cms-unavailable'], partial_policy: 'record_isolation',
    inputs: [changed], adapter_input, expected_fields: [{record_id: 'cms-test', ...changed, pointer: '/variables'}, peer]}];
  const options = {plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch};
  const result = await runCmsUpdate(options);
  assert.equal(result.outcomes[0].status, 'qualified_partial_review_only');
  assert.deepEqual(result.outcomes[0].qualified_record_ids, ['cms-test']);
  assert.deepEqual(result.outcomes[0].unresolved_record_ids, ['cms-unavailable']);
  assert.equal(result.after.records, 2); assert.equal(result.field_diff.changed_fields, 1);
  const m = JSON.parse(await fs.readFile(path.join(root, 'run/complete/manifest.json')));
  const baseline = JSON.parse(await fs.readFile(path.join(plan.baseline_directory, 'manifest.json')));
  assert.deepEqual(m.records.find(r => r.record_id === 'cms-unavailable'), baseline.records.find(r => r.record_id === 'cms-unavailable'));
  assert.equal((await runCmsUpdate(options)).resumed, true);
  assert.equal(result.scientific_approval, false);
  const receiptFile = path.join(root, 'run/receipt.json');
  const modified = JSON.parse(await fs.readFile(receiptFile));
  modified.outcomes[0].qualified_record_ids = ['cms-unavailable'];
  modified.outcomes[0].unresolved_record_ids = ['cms-test'];
  const rewritten = await write(receiptFile, modified);
  const checkpointFile = path.join(root, 'run/completion.json');
  const checkpoint = JSON.parse(await fs.readFile(checkpointFile));
  await write(checkpointFile, {...checkpoint, receipt_sha256: rewritten.sha256});
  await assert.rejects(runCmsUpdate(options), /CMS_CYCLE_RECEIPT_PARTITION/);
}));
test('CMS whole-group historical policy does not silently opt into partial adoption', () => fixture(async ({root, modules, plan, source}) => {
  const peer = await addBaselinePeer({root, plan, source});
  const adapter_input = await write(path.join(root, 'adapter.json'), {inputs: [{record_id: 'cms-test', ...source}]});
  plan.retained_inputs.push(adapter_input);
  plan.jobs = [{family: 'legacy', record_ids: ['cms-test', 'cms-unavailable'], inputs: [source], adapter_input,
    expected_fields: [{record_id: 'cms-test', ...source, pointer: '/variables'}, peer]}];
  const result = await runCmsUpdate({plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch});
  assert.equal(result.outcomes[0].code, 'CMS_CYCLE_PARTIAL_FAMILY');
  assert.equal(result.after.records, 2); assert.equal(result.field_diff.changed_fields, 0);
}));
async function write(file, value) {
  const bytes = JSON.stringify(value);
  await fs.writeFile(file, bytes);
  return {file, sha256: sha(bytes)};
}
async function fixture(fn) {
  const root = await fs.mkdtemp(path.join(scratch, 'cms-cycle-test-'));
  try {
    const modules = path.join(root, 'modules'); await fs.mkdir(modules);
    // A synthetic adapter exercises orchestration of changed values, not CMS scientific binding.
    const adapterFile = path.join(modules, 'package-cms-legacy-review.mjs');
    await fs.writeFile(adapterFile, `import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function packageCmsLegacyReview({inputs,generation,output}) {
 await fs.mkdir(output);await fs.mkdir(output+'/records');await fs.mkdir(output+'/pages');
 const input=inputs[0],bytes=await fs.readFile(input.file);
 if(hash(bytes)!==input.sha256)throw Error('SYNTHETIC_SOURCE_HASH');
 if(input.mutate_file)await fs.appendFile(input.mutate_file,'\\n');
 const fields=JSON.parse(bytes).variables,body=JSON.stringify(fields),ph=hash(body);
 await fs.writeFile(output+'/pages/'+ph+'.json',body);
 const d={format:'ushso.dictionary-review.v1',record_id:input.record_id,generation,baseline_record_sha256:hash(JSON.stringify({record_id:input.record_id})),source_proposal_sha256:hash(bytes),source_evidence:{source:'synthetic-fixture'},evidence:[{evidence_id:'e',provenance_ids:['p']}],provenance:[{provenance_id:'p',locator:'https://example.test',content_sha256:'c'.repeat(64)}],limitations:['Synthetic fixture pending review.'],isolated_fields:[],publication_authorized:false,review_status:'pending_owner_review',schema_applicability:'unresolved',variable_count:fields.length,pages:[{sha256:ph,count:fields.length,bytes:Buffer.byteLength(body)}]};
 const db=JSON.stringify(d),file='records/'+hash(input.record_id)+'.json';await fs.writeFile(output+'/'+file,db);
 await fs.writeFile(output+'/manifest.json',JSON.stringify({format:'ushso.dictionary-review-package.v1',generation,publication_authorized:false,review_status:'pending_owner_review',canonical_records_changed:0,records:[{record_id:input.record_id,file,sha256:hash(db),variables:fields.length}],variables:fields.length,pages:1,maximum_page_bytes:Buffer.byteLength(body)}));
}`);
    const parser_files = [];
    for (const name of ['compose-dictionary-review.mjs', 'dictionary-package-closure.mjs']) {
      const bytes = await fs.readFile(path.join(here, name));
      const file = path.join(modules, name); await fs.writeFile(file, bytes);
      parser_files.push({file, sha256: sha(bytes)});
    }
    parser_files.push({file: adapterFile, sha256: sha(await fs.readFile(adapterFile))});
    const record = {record_id: 'cms-test'};
    const corpusFile = path.join(root, 'records.jsonl');
    const recordBytes = JSON.stringify(record) + '\n'; await fs.writeFile(corpusFile, recordBytes);
    const corpus_manifest = await write(path.join(root, 'corpus.json'), {publication: {generation: 'g'}, record_files: ['records.jsonl']});
    const source = await write(path.join(root, 'publisher.json'), {variables: [{name: 'EXACT', description: 'Literal publisher definition.', measurement_unit: null}]});
    const pkg = path.join(root, 'baseline'); await fs.mkdir(pkg);
    for (const name of ['records', 'pages']) await fs.mkdir(path.join(pkg, name));
    const page = await write(path.join(pkg, 'page.tmp'), [{name: 'EXACT', description: 'Literal publisher definition.', measurement_unit: null}]);
    const pageBytes = await fs.readFile(page.file); await fs.rename(page.file, path.join(pkg, 'pages', page.sha256 + '.json'));
    const file = 'records/' + sha(record.record_id) + '.json';
    const descriptor = await write(path.join(pkg, file), {format: 'ushso.dictionary-review.v1',
      record_id: record.record_id, generation: 'g',
      baseline_record_sha256: sha(JSON.stringify(record)), source_proposal_sha256: sha(pageBytes),
      source_evidence: {source: 'synthetic-fixture'},
      evidence: [{evidence_id: 'e', provenance_ids: ['p']}],
      provenance: [{provenance_id: 'p', locator: 'https://example.test', content_sha256: 'c'.repeat(64)}],
      limitations: ['Synthetic fixture pending review.'], isolated_fields: [],
      publication_authorized: false, review_status: 'pending_owner_review',
      schema_applicability: 'unresolved', variable_count: 1,
      pages: [{sha256: page.sha256, count: 1, bytes: pageBytes.length}]});
    const manifest = await write(path.join(pkg, 'manifest.json'), {format: 'ushso.dictionary-review-package.v1', generation: 'g',
      publication_authorized: false, review_status: 'pending_owner_review', canonical_records_changed: 0,
      records: [{record_id: record.record_id, file, sha256: descriptor.sha256, variables: 1}], variables: 1, pages: 1, maximum_page_bytes: pageBytes.length});
    const expected = {record_id: record.record_id, ...source, pointer: '/variables'};
    const baseline_spec = await write(path.join(root, 'spec.json'), {format: 'ushso.dictionary-composition-inputs.v1', generation: 'g',
      publication_authorized: false, packages: [{directory: pkg, manifest_sha256: manifest.sha256}], expected_fields: [expected]});
    const plan = {format: 'ushso.cms-update.v1', generation: 'g', publication_authorized: false, scientific_approval: false,
      orchestrator_sha256: sha(await fs.readFile(path.join(here, 'cms-update-cycle.mjs'))), parser_files,
      corpus_manifest, corpus_files: [{file: corpusFile, sha256: sha(recordBytes)}], retained_inputs: [source], jobs: [],
      baseline_spec, baseline_directory: pkg, evidence_root: root};
    await fn({root, modules, plan, source, expected});
  } finally { await fs.rm(root, {recursive: true, force: true}); }
}
test('CMS unchanged repeat revalidates and reproduces complete closure', () => fixture(async ({root, modules, plan}) => {
  const options = {plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch};
  const first = await runCmsUpdate(options), second = await runCmsUpdate(options);
  assert.equal(first.after.records, 1); assert.equal(first.after.fields, 1);
  assert.equal(second.resumed, true); assert.deepEqual(second.after, first.after);
  assert.equal(second.scientific_approval, false);
}));
test('CMS same filename changed definition invalidates retained proposal and resume', () => fixture(async ({root, modules, plan, source}) => {
  const options = {plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch};
  await runCmsUpdate(options);
  await write(source.file, {variables: [{name: 'EXACT', description: 'Different definition.'}]});
  await assert.rejects(checkedInput(source), /CMS_CYCLE_INPUT_CHANGED/);
  await assert.rejects(runCmsUpdate(options), /COMPOSITION_SOURCE_HASH/);
}));
test('CMS failed family retains healthy verified baseline without approval', () => fixture(async ({root, modules, plan, source, expected}) => {
  plan.jobs = [{family: 'unavailable-parser', record_ids: ['cms-test'], inputs: [source], adapter_input: source, expected_fields: [expected]}];
  const result = await runCmsUpdate({plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch});
  assert.equal(result.outcomes[0].status, 'failed_retained_verified_baseline');
  assert.equal(result.after.records, 1); assert.equal(result.after.fields, 1);
  assert.equal(result.publication_authorized, false);
}));
test('CMS receipt tampering cannot be returned as verified', () => fixture(async ({root, modules, plan}) => {
  const options = {plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch};
  await runCmsUpdate(options);
  const file = path.join(root, 'run/receipt.json'), receipt = JSON.parse(await fs.readFile(file));
  receipt.after.fields = 999;
  await write(file, receipt);
  await assert.rejects(runCmsUpdate(options), /CMS_CYCLE_INPUT_CHANGED/);
}));
test('CMS composition tampering invalidates completed resume', () => fixture(async ({root, modules, plan}) => {
  const options = {plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch};
  await runCmsUpdate(options);
  await fs.appendFile(path.join(root, 'run/composition.json'), ' ');
  await assert.rejects(runCmsUpdate(options), /CMS_CYCLE_INPUT_CHANGED/);
}));
test('CMS recomputed closure rejects a rewritten receipt checksum', () => fixture(async ({root, modules, plan}) => {
  const options = {plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch};
  await runCmsUpdate(options);
  const receiptFile = path.join(root, 'run/receipt.json'), receipt = JSON.parse(await fs.readFile(receiptFile));
  receipt.after.fields = 999;
  const changed = await write(receiptFile, receipt);
  const checkpointFile = path.join(root, 'run/completion.json'), checkpoint = JSON.parse(await fs.readFile(checkpointFile));
  await write(checkpointFile, {...checkpoint, receipt_sha256: changed.sha256});
  await assert.rejects(runCmsUpdate(options), /CMS_CYCLE_RECEIPT_CLOSURE/);
}));
test('CMS review-only boundary rejects a rewritten approval receipt', () => fixture(async ({root, modules, plan}) => {
  const options = {plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch};
  await runCmsUpdate(options);
  const receiptFile = path.join(root, 'run/receipt.json'), receipt = JSON.parse(await fs.readFile(receiptFile));
  receipt.scientific_approval = true;
  const changed = await write(receiptFile, receipt);
  const checkpointFile = path.join(root, 'run/completion.json'), checkpoint = JSON.parse(await fs.readFile(checkpointFile));
  await write(checkpointFile, {...checkpoint, receipt_sha256: changed.sha256});
  await assert.rejects(runCmsUpdate(options), /CMS_CYCLE_RECEIPT_BOUNDARY/);
}));
test('CMS duplicate record within a job is rejected before output creation', () => fixture(async ({root, modules, plan}) => {
  plan.jobs = [{family: 'legacy', record_ids: ['cms-test', 'cms-test']}];
  await assert.rejects(runCmsUpdate({plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch}), /CMS_CYCLE_DUPLICATE_JOB_RECORD/);
  await assert.rejects(fs.stat(path.join(root, 'run')), {code: 'ENOENT'});
}));
test('CMS new pinned plan produces changed definition while preserving historical baseline', () => fixture(async ({root, modules, plan, source}) => {
  const old = await runCmsUpdate({plan, directory: path.join(root, 'old'), moduleDirectory: modules, storageRoot: scratch});
  const changed = await write(path.join(root, 'new-publisher.json'), {variables: [{name: 'EXACT', description: 'New literal definition.', measurement_unit: null}]});
  const adapter_input = await write(path.join(root, 'new-inputs.json'), {inputs: [{...changed, record_id: 'cms-test'}]});
  const newPlan = {...plan, retained_inputs: [source, changed, adapter_input], jobs: [{family: 'legacy', record_ids: ['cms-test'],
    inputs: [changed], adapter_input, expected_fields: [{record_id: 'cms-test', ...changed, pointer: '/variables'}]}]};
  const result = await runCmsUpdate({plan: newPlan, directory: path.join(root, 'new'), moduleDirectory: modules, storageRoot: scratch});
  assert.equal(result.outcomes[0].status, 'qualified_review_only');
  assert.notEqual(result.after.manifest_sha256, old.after.manifest_sha256);
  assert.equal(result.before.manifest_sha256, old.before.manifest_sha256);
  const m = JSON.parse(await fs.readFile(path.join(root, 'new/complete/manifest.json')));
  const d = JSON.parse(await fs.readFile(path.join(root, 'new/complete', m.records[0].file)));
  const fields = JSON.parse(await fs.readFile(path.join(root, 'new/complete/pages', d.pages[0].sha256 + '.json')));
  assert.equal(fields[0].description, 'New literal definition.');
  assert.equal(result.field_diff.changed_fields, 1);
  const diff = JSON.parse(await fs.readFile(path.join(root, 'new', result.field_diff.file)));
  const changes = JSON.parse(await fs.readFile(path.join(root, 'new/field-diff', diff.records[0].pages[0].file)));
  assert.equal(changes[0].name, 'EXACT');
  assert.equal(changes[0].change, 'changed');
  assert.equal(changes[0].before.description, 'Literal publisher definition.');
  assert.equal(changes[0].after.description, 'New literal definition.');
  assert.equal(changes[0].before.measurement_unit, null);
  assert.equal(changes[0].after.measurement_unit, null);
  assert.equal(JSON.parse(await fs.readFile(source.file)).variables[0].description, 'Literal publisher definition.');
  assert.equal(result.scientific_approval, false);
  const resumed = await runCmsUpdate({plan: newPlan, directory: path.join(root, 'new'), moduleDirectory: modules, storageRoot: scratch});
  assert.deepEqual(resumed.field_diff, result.field_diff);
  await fs.appendFile(path.join(root, 'new/field-diff', diff.records[0].pages[0].file), ' ');
  await assert.rejects(runCmsUpdate({plan: newPlan, directory: path.join(root, 'new'), moduleDirectory: modules, storageRoot: scratch}), /CMS_CYCLE_INPUT_CHANGED/);
}));
test('CMS resumes identical retained failures but rejects changed bad bytes', () => fixture(async ({root, modules, plan}) => {
  const badFile = path.join(root, 'bad-input.json');
  await fs.writeFile(badFile, 'bad-a');
  plan.retained_inputs.push({file: badFile, sha256: '0'.repeat(64)});
  const options = {plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch};
  const first = await runCmsUpdate(options);
  assert.equal(first.retained_input_failures.length, 1);
  const same = await runCmsUpdate(options);
  assert.equal(same.resumed, true);
  assert.deepEqual(same.retained_input_failures, first.retained_input_failures);
  await fs.writeFile(badFile, 'bad-b');
  await assert.rejects(runCmsUpdate(options), /CMS_CYCLE_RECEIPT_BOUNDARY/);
}));
test('CMS keeps unchanged oversized retained failures fail-closed', () => fixture(async ({root, modules, plan}) => {
  const oversizedFile = path.join(root, 'oversized-input.json');
  await fs.writeFile(oversizedFile, 'x'.repeat(64 * 1024 * 1024 + 1));
  plan.retained_inputs.push({file: oversizedFile, sha256: '0'.repeat(64)});
  const options = {plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch};
  const first = await runCmsUpdate(options);
  assert.equal(first.retained_input_failures.length, 1);
  assert.equal(Object.hasOwn(first.retained_input_failures[0], 'observed_sha256'), false);
  await assert.rejects(runCmsUpdate(options), /CMS_CYCLE_RESUME_CHANGED/);
}));
test('CMS keeps changed oversized retained failures fail-closed even when size is unchanged', () => fixture(async ({root, modules, plan}) => {
  const oversizedFile = path.join(root, 'oversized-input.json');
  const bytes = Buffer.alloc(64 * 1024 * 1024 + 1, 'a');
  await fs.writeFile(oversizedFile, bytes);
  plan.retained_inputs.push({file: oversizedFile, sha256: '0'.repeat(64)});
  const options = {plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch};
  await runCmsUpdate(options);
  await fs.writeFile(oversizedFile, Buffer.alloc(bytes.length, 'b'));
  await assert.rejects(runCmsUpdate(options), /CMS_CYCLE_RESUME_CHANGED/);
}));
test('CMS keeps unchanged missing retained failures fail-closed', () => fixture(async ({root, modules, plan}) => {
  const missingFile = path.join(root, 'missing-input.json');
  plan.retained_inputs.push({file: missingFile, sha256: '0'.repeat(64)});
  const options = {plan, directory: path.join(root, 'run'), moduleDirectory: modules, storageRoot: scratch};
  const first = await runCmsUpdate(options);
  assert.equal(first.retained_input_failures.length, 1);
  assert.equal(Object.hasOwn(first.retained_input_failures[0], 'observed_sha256'), false);
  await assert.rejects(runCmsUpdate(options), /CMS_CYCLE_RESUME_CHANGED/);
}));
test('CMS baseline spec replacement after initial pin is rejected before completion', () => fixture(async ({root, modules, plan, source}) => {
  const changed = {...source, mutate_file: plan.baseline_spec.file};
  const adapter_input = await write(path.join(root, 'adapter.json'), {inputs: [changed]});
  plan.retained_inputs.push(changed, adapter_input);
  plan.jobs = [{family: 'legacy', record_ids: ['cms-test'], inputs: [changed], adapter_input,
    expected_fields: [{record_id: 'cms-test', ...source, pointer: '/variables'}]}];
  const runDirectory = path.join(root, 'run');
  await assert.rejects(runCmsUpdate({plan, directory: runDirectory, moduleDirectory: modules, storageRoot: scratch}), /CMS_CYCLE_INPUT_CHANGED/);
  await assert.rejects(fs.stat(path.join(runDirectory, 'receipt.json')), {code: 'ENOENT'});
}));
