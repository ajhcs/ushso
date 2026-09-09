import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const DEFAULT_STORAGE_ROOT = '/mnt/d/tmp/plumbob';
function resolveStorageRoot(storageRoot = DEFAULT_STORAGE_ROOT) {
  if (typeof storageRoot !== 'string' || !path.isAbsolute(storageRoot)) throw Error('CMS_CYCLE_STORAGE');
  const root = path.resolve(storageRoot);
  if (root === path.parse(root).root) throw Error('CMS_CYCLE_STORAGE');
  return root;
}
function isStrictDescendant(candidate, root) {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate.startsWith(prefix);
}
const families = {
  grid: ['package-cms-grid-review.mjs', 'packageCmsGridReview'],
  structured: ['package-cms-structured-review.mjs', 'packageCmsStructuredReview'],
  legacy: ['package-cms-legacy-review.mjs', 'packageCmsLegacyReview'],
  derived: ['package-cms-derived-review.mjs', 'packageCmsDerivedReview'],
};
export async function checkedInput(input, maximum = 64 * 1024 * 1024) {
  if (!input || !path.isAbsolute(input.file) || !/^[a-f0-9]{64}$/.test(input.sha256)) throw Error('CMS_CYCLE_INPUT');
  const stat = await fs.stat(input.file);
  if (!stat.isFile() || stat.size > maximum) throw Error('CMS_CYCLE_SIZE');
  const bytes = await fs.readFile(input.file);
  if (bytes.length > maximum) throw Error('CMS_CYCLE_INPUT_CHANGED:' + input.file);
  const actualSha256 = hash(bytes);
  if (actualSha256 !== input.sha256) {
    const error = Error('CMS_CYCLE_INPUT_CHANGED:' + input.file);
    error.observed_sha256 = actualSha256;
    throw error;
  }
  return bytes;
}
function retainedFailure(input, error) {
  const failure = {file: input?.file ?? null, code: error.message};
  if (typeof error.observed_sha256 === 'string') failure.observed_sha256 = error.observed_sha256;
  return failure;
}
function hasObservedDigest(failure) {
  return typeof failure?.observed_sha256 === 'string' && /^[a-f0-9]{64}$/.test(failure.observed_sha256);
}
async function writeNew(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
}
async function semanticDiff({before, after, directory, verify = false}) {
  const previous = new Map(before.map(e => [e.record_id, e]));
  const next = new Map(after.map(e => [e.record_id, e]));
  const manifest = {format: 'ushso.cms-field-diff.v1', scientific_approval: false,
    publication_authorized: false, records: [], changed_fields: 0, total_artifact_bytes: 0};
  if (!verify) await fs.mkdir(directory);
  async function artifact(file, value) {
    const bytes = JSON.stringify(value) + '\n';
    manifest.total_artifact_bytes += Buffer.byteLength(bytes);
    if (Buffer.byteLength(bytes) > 65536 || manifest.total_artifact_bytes > 64 * 1024 * 1024) throw Error('CMS_DIFF_SIZE');
    const ref = {file, sha256: hash(bytes), bytes: Buffer.byteLength(bytes)};
    if (verify) await checkedInput({file: path.join(directory, file), sha256: ref.sha256}, 65536);
    else await fs.writeFile(path.join(directory, file), bytes, {flag: 'wx'});
    return ref;
  }
  async function fields(entry) {
    if (!entry) return [];
    let value = JSON.parse(await checkedInput(entry));
    if (typeof entry.pointer !== 'string' || !entry.pointer.startsWith('/')) throw Error('CMS_DIFF_POINTER');
    for (const part of entry.pointer.slice(1).split('/')) {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!value || !Object.hasOwn(value, key)) throw Error('CMS_DIFF_POINTER');
      value = value[key];
    }
    if (!Array.isArray(value) || value.length > 100000) throw Error('CMS_DIFF_FIELDS');
    const names = new Set();
    for (const field of value) {
      if (typeof field?.name !== 'string' || names.has(field.name)) throw Error('CMS_DIFF_IDENTITY');
      names.add(field.name);
    }
    return value;
  }
  for (const id of [...new Set([...previous.keys(), ...next.keys()])].sort()) {
    const a = previous.get(id), b = next.get(id);
    if (a && b && a.sha256 === b.sha256 && a.pointer === b.pointer) continue;
    const oldFields = new Map((await fields(a)).map(f => [f.name, f]));
    const newFields = new Map((await fields(b)).map(f => [f.name, f]));
    const record = {record_id: id, before_source: a ?? null, after_source: b ?? null, changed_fields: 0, pages: [], fragments: []};
    let page = [];
    async function flush() {
      if (!page.length) return;
      record.pages.push(await artifact(hash(id) + '-page-' + record.pages.length + '.json', page));
      page = [];
    }
    for (const name of [...new Set([...oldFields.keys(), ...newFields.keys()])].sort()) {
      const oldValue = oldFields.get(name), newValue = newFields.get(name);
      if (isDeepStrictEqual(oldValue, newValue)) continue;
      let change = {name, change: oldValue === undefined ? 'added' : newValue === undefined ? 'removed' : 'changed',
        before: oldValue ?? null, after: newValue ?? null};
      const raw = Buffer.from(JSON.stringify(change));
      if (raw.length > 60000) {
        const fragments = [];
        for (let offset = 0; offset < raw.length; offset += 32768) {
          const fragment = {encoding: 'base64', byte_offset: offset, data: raw.subarray(offset, offset + 32768).toString('base64')};
          const ref = await artifact(hash(id) + '-fragment-' + record.fragments.length + '.json', fragment);
          fragments.push(ref); record.fragments.push(ref);
        }
        change = {name, change: change.change, encoding: 'base64-raw-utf8-json', raw_sha256: hash(raw), raw_bytes: raw.length, fragments};
      }
      if (page.length === 50 || Buffer.byteLength(JSON.stringify([...page, change])) + 1 > 65536) await flush();
      page.push(change); record.changed_fields++; manifest.changed_fields++;
      if (manifest.changed_fields > 100000) throw Error('CMS_DIFF_COUNT');
    }
    await flush();
    if (record.changed_fields) manifest.records.push(record);
  }
  const bytes = JSON.stringify(manifest) + '\n';
  if (Buffer.byteLength(bytes) > 8 * 1024 * 1024) throw Error('CMS_DIFF_MANIFEST_SIZE');
  const summary = {file: 'field-diff/manifest.json', sha256: hash(bytes), records: manifest.records.length,
    changed_fields: manifest.changed_fields, artifact_bytes: manifest.total_artifact_bytes};
  if (verify) await checkedInput({file: path.join(directory, 'manifest.json'), sha256: summary.sha256}, 8 * 1024 * 1024);
  else await fs.writeFile(path.join(directory, 'manifest.json'), bytes, {flag: 'wx'});
  return summary;
}
export async function runCmsUpdate({plan, directory, moduleDirectory, storageRoot} = {}) {
  if (plan.format !== 'ushso.cms-update.v1' || plan.publication_authorized !== false || plan.scientific_approval !== false
    || !Array.isArray(plan.jobs) || plan.jobs.length > 159 || !Array.isArray(plan.parser_files)
    || !Array.isArray(plan.retained_inputs) || plan.retained_inputs.length > 10000) throw Error('CMS_CYCLE_PLAN');
  await checkedInput({file: fileURLToPath(import.meta.url), sha256: plan.orchestrator_sha256});
  const declaredIds = new Set();
  for (const job of plan.jobs) {
    if (job.partial_policy !== undefined && job.partial_policy !== 'record_isolation') throw Error('CMS_CYCLE_PARTIAL_POLICY');
    if (!Array.isArray(job.record_ids) || !job.record_ids.length) throw Error('CMS_CYCLE_JOB_SCOPE');
    for (const id of job.record_ids) {
      if (typeof id !== 'string' || declaredIds.has(id)) throw Error('CMS_CYCLE_DUPLICATE_JOB_RECORD');
      declaredIds.add(id);
    }
  }
  const scope = resolveStorageRoot(storageRoot);
  const parent = await fs.realpath(path.dirname(directory));
  if (!isStrictDescendant(parent, await fs.realpath(scope)) || path.basename(directory) === '.' || !path.isAbsolute(moduleDirectory)) throw Error('CMS_CYCLE_STORAGE');
  // Pin the complete local parser/module set, not just the direct family entry point.
  const actualNames = (await fs.readdir(moduleDirectory)).filter(n => /\.(mjs|py)$/.test(n)).sort();
  const declaredNames = plan.parser_files.map(p => path.basename(p.file)).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(declaredNames)
    || plan.parser_files.some(p => path.dirname(p.file) !== moduleDirectory)) throw Error('CMS_CYCLE_PARSER_INVENTORY');
  for (const input of plan.parser_files) await checkedInput(input);
  const corpusBytes = await checkedInput(plan.corpus_manifest, 2 * 1024 * 1024);
  const corpus = JSON.parse(corpusBytes), records = new Map();
  if (corpus.publication.generation !== plan.generation || !Array.isArray(plan.corpus_files)
    || JSON.stringify(corpus.record_files.slice().sort()) !== JSON.stringify(plan.corpus_files.map(p => path.basename(p.file)).sort())) throw Error('CMS_CYCLE_CORPUS');
  for (const input of plan.corpus_files) {
    if (path.dirname(input.file) !== path.dirname(plan.corpus_manifest.file)) throw Error('CMS_CYCLE_CORPUS_PATH');
    for (const line of (await checkedInput(input)).toString().trim().split('\n')) {
      const record = JSON.parse(line);
      if (records.has(record.record_id)) throw Error('CMS_CYCLE_DUPLICATE_RECORD');
      records.set(record.record_id, record);
    }
  }
  const retainedFailures = [];
  for (const input of plan.retained_inputs) {
    try { await checkedInput(input); }
    catch (error) { retainedFailures.push(retainedFailure(input, error)); }
  }
  for (const job of plan.jobs) {
    // All replay inputs also participate in resume identity, even when a family fails.
    for (const input of [job.adapter_input, ...(job.expected_fields ?? [])]) {
      try { await checkedInput(input); }
      catch (error) { retainedFailures.push(retainedFailure(input, error)); }
    }
  }
  const {runComposition} = await import(pathToFileURL(path.join(moduleDirectory, 'compose-dictionary-review.mjs')));
  const {subsetDictionaryPackage} = await import(pathToFileURL(path.join(moduleDirectory, 'dictionary-package-closure.mjs')));
  const baseline = JSON.parse(await checkedInput(plan.baseline_spec, 8 * 1024 * 1024));
  // Baseline is a complete verified fallback, never an unverified list of advertised files.
  const before = await runComposition({specFile: plan.baseline_spec.file, specSha256: plan.baseline_spec.sha256,
    output: plan.baseline_directory, verifyOnly: true});
  if (baseline.generation !== plan.generation) throw Error('CMS_CYCLE_GENERATION');
  const planHash = hash(JSON.stringify(plan)), receiptFile = path.join(directory, 'receipt.json');
  let existing;
  try { existing = JSON.parse(await fs.readFile(receiptFile)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (existing.plan_sha256 !== planHash) throw Error('CMS_CYCLE_RESUME_CHANGED');
    if (retainedFailures.some(failure => !hasObservedDigest(failure))) throw Error('CMS_CYCLE_RESUME_CHANGED');
    const checkpoint = JSON.parse(await fs.readFile(path.join(directory, 'completion.json')));
    if (checkpoint.plan_sha256 !== planHash) throw Error('CMS_CYCLE_COMPLETION_PLAN');
    await checkedInput({file: receiptFile, sha256: checkpoint.receipt_sha256});
    await checkedInput({file: path.join(directory, 'composition.json'), sha256: checkpoint.composition_sha256});
    if (existing.format !== 'ushso.cms-update-receipt.v1' || existing.scientific_approval !== false
      || existing.publication_authorized !== false || existing.review_status !== 'pending_owner_review'
      || existing.canonical_records_changed !== 0 || !isDeepStrictEqual(existing.before, before)
      || !Array.isArray(existing.outcomes) || existing.outcomes.length !== plan.jobs.length
      || !isDeepStrictEqual(existing.retained_input_failures, retainedFailures)) throw Error('CMS_CYCLE_RECEIPT_BOUNDARY');
    for (const [index, outcome] of existing.outcomes.entries()) {
      const job = plan.jobs[index];
      if (outcome.family !== job.family || !isDeepStrictEqual(outcome.record_ids, job.record_ids)
        || !['qualified_review_only', 'qualified_partial_review_only', 'failed_retained_verified_baseline'].includes(outcome.status)
        || (outcome.status.startsWith('qualified') ? Object.hasOwn(outcome, 'code') : typeof outcome.code !== 'string')) throw Error('CMS_CYCLE_RECEIPT_OUTCOME');
      if (outcome.status === 'qualified_partial_review_only') {
        if (job.partial_policy !== 'record_isolation' || !Array.isArray(outcome.qualified_record_ids)
          || !Array.isArray(outcome.unresolved_record_ids) || !outcome.qualified_record_ids.length || !outcome.unresolved_record_ids.length
          || !isDeepStrictEqual([...outcome.qualified_record_ids, ...outcome.unresolved_record_ids].sort(), job.record_ids.slice().sort())) throw Error('CMS_CYCLE_RECEIPT_PARTITION');
      }
      if (outcome.status.startsWith('qualified')) {
        const adapterManifest = JSON.parse(await fs.readFile(path.join(directory, 'job-' + index, 'manifest.json')));
        const actualIds = adapterManifest.records.map(r => r.record_id).sort();
        const reportedIds = outcome.status === 'qualified_partial_review_only' ? outcome.qualified_record_ids : job.record_ids;
        if (!isDeepStrictEqual(actualIds, reportedIds.slice().sort())) throw Error('CMS_CYCLE_RECEIPT_PARTITION');
      }
    }
    const actual = await runComposition({specFile: path.join(directory, 'composition.json'), output: path.join(directory, 'complete'), verifyOnly: true});
    if (!isDeepStrictEqual(existing.after, actual)) throw Error('CMS_CYCLE_RECEIPT_CLOSURE');
    const composed = JSON.parse(await fs.readFile(path.join(directory, 'composition.json')));
    const baselineFields = baseline.expected_fields.map(e => ({...e, file: path.resolve(path.dirname(plan.baseline_spec.file), e.file)}));
    const diff = await semanticDiff({before: baselineFields, after: composed.expected_fields, directory: path.join(directory, 'field-diff'), verify: true});
    if (!isDeepStrictEqual(existing.field_diff, diff) || checkpoint.field_diff_sha256 !== diff.sha256) throw Error('CMS_CYCLE_DIFF_RECEIPT');
    return {...existing, resumed: true};
  }
  await fs.mkdir(directory); // Existing incomplete runs are preserved, never overwritten.
  await writeNew(path.join(directory, 'plan.json'), plan);
  const resolveBaseline = value => path.resolve(path.dirname(plan.baseline_spec.file), value);
  let packages = baseline.packages.map(p => ({...p, directory: resolveBaseline(p.directory)}));
  let expected = baseline.expected_fields.map(p => ({...p, file: resolveBaseline(p.file)}));
  const outcomes = [], used = new Set();
  for (const [index, job] of plan.jobs.entries()) {
    const output = path.join(directory, 'job-' + index);
    try {
      if (!families[job.family] || !Array.isArray(job.record_ids) || !job.record_ids.length
        || job.record_ids.some(id => used.has(id) || !records.has(id))) throw Error('CMS_CYCLE_JOB_SCOPE');
      for (const id of job.record_ids) used.add(id);
      if (!Array.isArray(job.inputs) || job.inputs.some(i => !plan.retained_inputs.some(p => p.file === i.file && p.sha256 === i.sha256))) throw Error('CMS_CYCLE_JOB_INPUTS');
      for (const input of job.inputs) await checkedInput(input);
      const [module, method] = families[job.family];
      const adapter = (await import(pathToFileURL(path.join(moduleDirectory, module))))[method];
      const args = {records, generation: plan.generation, evidenceRoot: plan.evidence_root, output};
      if (job.family === 'legacy' || job.family === 'derived') args.inputs = JSON.parse(await checkedInput(job.adapter_input)).inputs;
      else args.manifestFile = job.adapter_input.file;
      await checkedInput(job.adapter_input);
      await adapter(args);
      const manifestBytes = await fs.readFile(path.join(output, 'manifest.json')), manifest = JSON.parse(manifestBytes);
      const qualifiedIds = manifest.records.map(r => r.record_id);
      if (!qualifiedIds.length || new Set(qualifiedIds).size !== qualifiedIds.length || qualifiedIds.some(id => !job.record_ids.includes(id))) throw Error('CMS_CYCLE_ADAPTER_SCOPE');
      const unresolvedIds = job.record_ids.filter(id => !qualifiedIds.includes(id));
      // Opt-in exact-record isolation retains failed peers from the verified baseline.
      // Whole-group v1 plans keep their historical conservative behavior.
      if (unresolvedIds.length && job.partial_policy !== 'record_isolation') throw Error('CMS_CYCLE_PARTIAL_FAMILY');
      const replacement = new Set(qualifiedIds), selected = [];
      if (!Array.isArray(job.expected_fields) || new Set(job.expected_fields.map(r => r.record_id)).size !== job.expected_fields.length
        || job.expected_fields.some(r => !job.record_ids.includes(r.record_id))) throw Error('CMS_CYCLE_EXPECTED_SCOPE');
      const qualifiedExpected = job.expected_fields.filter(r => replacement.has(r.record_id));
      if (!isDeepStrictEqual(qualifiedExpected.map(r => r.record_id).sort(), qualifiedIds.slice().sort())) throw Error('CMS_CYCLE_EXPECTED_SCOPE');
      for (const input of qualifiedExpected) await checkedInput(input);
      // Validate exact successful fields before changing any baseline grouping.
      const familySpecFile = path.join(directory, 'job-' + index + '-source-check.json');
      const familyPackage = {directory: output, manifest_sha256: hash(manifestBytes)};
      await writeNew(familySpecFile, {...baseline, packages: [familyPackage], expected_fields: qualifiedExpected});
      await runComposition({specFile: familySpecFile, output, verifyOnly: true});
      for (const pkg of packages) {
        const m = JSON.parse(await fs.readFile(path.join(pkg.directory, 'manifest.json')));
        if (m.records.some(r => replacement.has(r.record_id))) {
          const retainedIds = m.records.filter(r => !replacement.has(r.record_id)).map(r => r.record_id);
          if (retainedIds.length) {
            if (job.partial_policy !== 'record_isolation') throw Error('CMS_CYCLE_REPLACEMENT_MUST_MATCH_PACKAGE_GROUP');
            const subsetDirectory = path.join(directory, 'job-' + index + '-retained-' + selected.length);
            const subset = await subsetDictionaryPackage({directory: pkg.directory, output: subsetDirectory, recordIds: retainedIds});
            selected.push({directory: subsetDirectory, manifest_sha256: subset.manifest_sha256});
          }
        } else selected.push(pkg);
      }
      const nextPackages = [...selected, familyPackage];
      const nextExpected = [...expected.filter(e => !replacement.has(e.record_id)), ...qualifiedExpected];
      const spec = {...baseline, packages: nextPackages, expected_fields: nextExpected};
      const specFile = path.join(directory, 'job-' + index + '-composition.json');
      await writeNew(specFile, spec);
      packages = nextPackages; expected = nextExpected;
      outcomes.push({family: job.family, record_ids: job.record_ids, status: unresolvedIds.length ? 'qualified_partial_review_only' : 'qualified_review_only',
        ...(unresolvedIds.length ? {qualified_record_ids: qualifiedIds, unresolved_record_ids: unresolvedIds} : {})});
    } catch (error) {
      outcomes.push({family: job.family, record_ids: job.record_ids, status: 'failed_retained_verified_baseline', code: error.message});
    }
  }
  // Refuse publication of a verification receipt if executable identity changed mid-run.
  for (const input of plan.parser_files) await checkedInput(input);
  await checkedInput(plan.corpus_manifest, 2 * 1024 * 1024);
  for (const input of plan.corpus_files) await checkedInput(input);
  await checkedInput(plan.baseline_spec, 8 * 1024 * 1024);
  const specFile = path.join(directory, 'composition.json');
  await writeNew(specFile, {...baseline, packages, expected_fields: expected});
  const after = await runComposition({specFile, output: path.join(directory, 'complete')});
  const field_diff = await semanticDiff({before: baseline.expected_fields.map(e => ({...e, file: resolveBaseline(e.file)})),
    after: expected, directory: path.join(directory, 'field-diff')});
  const receipt = {format: 'ushso.cms-update-receipt.v1', plan_sha256: planHash, before, after, outcomes,
    field_diff, retained_input_failures: retainedFailures, scientific_approval: false, publication_authorized: false,
    review_status: 'pending_owner_review', canonical_records_changed: 0};
  await writeNew(receiptFile, receipt);
  await writeNew(path.join(directory, 'completion.json'), {plan_sha256: planHash,
    receipt_sha256: hash(await fs.readFile(receiptFile)), composition_sha256: hash(await fs.readFile(specFile)), field_diff_sha256: field_diff.sha256});
  return receipt;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [planFile, directory, moduleDirectory] = process.argv.slice(2);
  const plan = JSON.parse(await fs.readFile(planFile));
  console.log(JSON.stringify(await runCmsUpdate({plan, directory, moduleDirectory})));
}
