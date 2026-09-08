import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {composeDictionaryPackages, verifyDictionaryPackage} from './dictionary-package-closure.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const HEX = /^[a-f0-9]{64}$/;
const HISTORICAL_INPUT_ATTEMPT = 'historical_input_attempt';
const compareRecordManifest = (a, b) => a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0;
const isWithin = (file, root) => file === root || file.startsWith(root + path.sep);
async function canonicalPath(file) {
  let current = path.resolve(file);
  const missing = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, ...missing.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) return current;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}
async function readBoundDocument(file, sha256, max = 64 * 1024 * 1024) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > max) throw Error('COMPOSITION_SOURCE_SIZE');
  const bytes = await fs.readFile(file);
  const actual = hash(bytes);
  if (bytes.length > max || (sha256 && actual !== sha256)) throw Error('COMPOSITION_SOURCE_HASH');
  return {bytes, sha256: actual, value: JSON.parse(bytes)};
}
async function readBound(file, sha256, max = 64 * 1024 * 1024) {
  return (await readBoundDocument(file, sha256, max)).value;
}
function pointer(document, locator) {
  if (typeof locator !== 'string' || !locator.startsWith('/')) throw Error('COMPOSITION_SOURCE_POINTER');
  for (const token of locator.slice(1).split('/')) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!document || !Object.hasOwn(document, key)) throw Error('COMPOSITION_SOURCE_POINTER');
    document = document[key];
  }
  return document;
}
export async function runComposition({specFile, output, verifyOnly = false, specSha256 = null}) {
  const spec = await readBound(specFile, specSha256, 8 * 1024 * 1024);
  if (spec.format !== 'ushso.dictionary-composition-inputs.v1' || spec.publication_authorized !== false
    || !Array.isArray(spec.packages) || spec.packages.length > 4000 || !Array.isArray(spec.expected_fields) || spec.expected_fields.length > 4000) {
    throw Error('COMPOSITION_INPUT_SPEC');
  }
  const outputRoot = path.resolve(output), outputCanonicalRoot = await canonicalPath(outputRoot), resolve = file => path.resolve(path.dirname(specFile), file);
  const resolveSource = async file => {
    if (typeof file !== 'string') throw Error('COMPOSITION_SOURCE_POINTER');
    const source = resolve(file);
    if (isWithin(source, outputRoot)) throw Error('COMPOSITION_SOURCE_OUTPUT');
    const canonical = await fs.realpath(source).catch(error => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return source;
      throw error;
    });
    if (isWithin(canonical, outputCanonicalRoot)) throw Error('COMPOSITION_SOURCE_OUTPUT');
    return canonical;
  };
  const index = new Map();
  for (const entry of spec.expected_fields) {
    if (!entry || typeof entry.record_id !== 'string' || index.has(entry.record_id)
      || typeof entry.file !== 'string' || !HEX.test(entry.sha256)) throw Error('COMPOSITION_EXPECTED_IDENTITY');
    if (typeof entry.pointer !== 'string' || !entry.pointer.startsWith('/') || (entry.issues_pointer !== undefined
      && (typeof entry.issues_pointer !== 'string' || !entry.issues_pointer.startsWith('/'))) || (entry.parser_issues_pointer !== undefined
      && (typeof entry.parser_issues_pointer !== 'string' || !entry.parser_issues_pointer.startsWith('/')))) throw Error('COMPOSITION_SOURCE_POINTER');
    await resolveSource(entry.file);
    index.set(entry.record_id, entry);
  }
  const pinnedPackages = [], expectedRecords = [], expectedRecordIds = new Set();
  for (const input of spec.packages) {
    if (!input || typeof input.directory !== 'string' || !HEX.test(input.manifest_sha256)) throw Error('COMPOSITION_INPUT_HASH');
    const directory = resolve(input.directory), pinned = await readBoundDocument(path.join(directory, 'manifest.json'), input.manifest_sha256, 2 * 1024 * 1024), manifest = pinned.value;
    if (manifest.generation !== spec.generation) throw Error('COMPOSITION_GENERATION');
    if (!Array.isArray(manifest.records)) throw Error('COMPOSITION_INPUT_MANIFEST');
    for (const item of manifest.records) {
      if (!item || typeof item.record_id !== 'string' || expectedRecordIds.has(item.record_id)) throw Error('COMPOSITION_RECORD_CONFLICT:' + item?.record_id);
      expectedRecordIds.add(item.record_id);
      expectedRecords.push(item);
    }
    pinnedPackages.push({directory, manifest, manifest_sha256: pinned.sha256});
  }
  const expectedRecordManifest = expectedRecords.slice().sort(compareRecordManifest);
  const expectedSourcePackages = pinnedPackages.map(({manifest, manifest_sha256}) => ({manifest_sha256, records: manifest.records.length}))
    .sort((a, b) => a.manifest_sha256.localeCompare(b.manifest_sha256));
  const expectedIsolated = [], expectedIsolationHistory = [], historyKeys = new Set();
  const appendHistory = entry => { const key = JSON.stringify(entry); if (!historyKeys.has(key)) { historyKeys.add(key); expectedIsolationHistory.push(entry); } };
  const historical = (entry, manifest_sha256) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || (entry.source_manifest_sha256 !== undefined && entry.source_manifest_sha256 !== manifest_sha256)) throw Error('COMPOSITION_ISOLATION_SOURCE');
    return {...entry, input_attempt_status: HISTORICAL_INPUT_ATTEMPT, source_manifest_sha256: manifest_sha256};
  };
  const recordIds = new Set(expectedRecordManifest.map(item => item.record_id));
  for (const {manifest, manifest_sha256} of pinnedPackages) {
    if (!Array.isArray(manifest.isolated ?? []) || !Array.isArray(manifest.isolation_history ?? [])) throw Error('COMPOSITION_INPUT_MANIFEST');
    for (const attempt of manifest.isolation_history ?? []) {
      if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt) || attempt.input_attempt_status !== HISTORICAL_INPUT_ATTEMPT || !HEX.test(attempt.source_manifest_sha256)) throw Error('COMPOSITION_ISOLATION_HISTORY');
      appendHistory(attempt);
    }
    for (const attempt of manifest.isolated ?? []) {
      appendHistory(historical(attempt, manifest_sha256));
      if (typeof attempt.record_id !== 'string' || !recordIds.has(attempt.record_id)) {
        expectedIsolated.push(attempt);
      }
    }
  }
  expectedIsolated.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  expectedIsolationHistory.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const expectedFields = async (item, descriptor) => {
    const entry = index.get(item.record_id);
    if (!entry) throw Error('COMPOSITION_UNEXPECTED_RECORD');
    const source = await readBound(await resolveSource(entry.file), entry.sha256);
    const variables = pointer(source, entry.pointer);
    if (!Array.isArray(variables)) throw Error('COMPOSITION_EXPECTED_FIELDS');
    if (!entry.add_review_context) return variables;
    if (!Array.isArray(descriptor.evidence) || !descriptor.evidence.length
      || typeof descriptor.evidence[0]?.evidence_id !== 'string' || !descriptor.evidence[0].evidence_id.length) throw Error('COMPOSITION_REVIEW_CONTEXT');
    // JSON serialization deliberately removes undefined optional properties, never nulls.
    return JSON.parse(JSON.stringify(variables.map(row => ({...row,
      evidence_ids: [descriptor.evidence[0].evidence_id], document_context: descriptor.source_evidence}))));
  };
  const expectedIssues = async (item,descriptor) => {
    const entry=index.get(item.record_id);
    if(!entry.issues_pointer) {
      if (descriptor.isolated_fields?.length) throw Error('COMPOSITION_EXPECTED_ISSUES');
      return null;
    }
    return pointer(await readBound(await resolveSource(entry.file),entry.sha256),entry.issues_pointer);
  };
  const expectedParserIssues = async (item) => {
    const entry = index.get(item.record_id);
    if (!entry.parser_issues_pointer) return null;
    return pointer(await readBound(await resolveSource(entry.file), entry.sha256), entry.parser_issues_pointer);
  };
  const common = {expectedRecords: [...index.keys()], expectedFields, expectedIssues, expectedParserIssues};
  if (expectedRecordIds.size !== index.size || [...expectedRecordIds].some(id => !index.has(id))) throw Error('COMPOSITION_EXPECTED_RECORD_SET');
  const outputDocument = verifyOnly ? await readBoundDocument(path.join(output, 'manifest.json'), null, 2 * 1024 * 1024) : null;
  const identityOutput = verifyOnly && pinnedPackages.length === 1 && outputDocument.sha256 === pinnedPackages[0].manifest_sha256;
  const result = verifyOnly
    ? await verifyDictionaryPackage({directory: output, ...common, requireSortedRecords: identityOutput ? false : true})
    : await composeDictionaryPackages({inputs: pinnedPackages.map(p => p.directory), output, ...common});
  const outputManifest = (outputDocument ?? await readBoundDocument(path.join(output, 'manifest.json'), null, 2 * 1024 * 1024)).value;
  if (outputManifest.generation !== spec.generation) throw Error('COMPOSITION_OUTPUT_GENERATION');
  if (!isDeepStrictEqual(outputManifest.records, identityOutput ? pinnedPackages[0].manifest.records : expectedRecordManifest)) throw Error('COMPOSITION_OUTPUT_RECORD_MANIFEST');
  if (!identityOutput && !isDeepStrictEqual(outputManifest.source_packages, expectedSourcePackages)) throw Error('COMPOSITION_OUTPUT_SOURCE_PACKAGES');
  if (!isDeepStrictEqual(outputManifest.isolated ?? [], identityOutput ? (pinnedPackages[0].manifest.isolated ?? []) : expectedIsolated)) throw Error('COMPOSITION_OUTPUT_ISOLATION');
  if (!identityOutput && !isDeepStrictEqual(outputManifest.isolation_history ?? [], expectedIsolationHistory)) throw Error('COMPOSITION_OUTPUT_ISOLATION_HISTORY');
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [specFile, output, mode] = process.argv.slice(2);
  if (!specFile || !output || (mode && mode !== '--verify-only')) throw Error('Usage: compose-dictionary-review.mjs INPUT_SPEC OUTPUT [--verify-only]');
  console.log(JSON.stringify(await runComposition({specFile, output, verifyOnly: mode === '--verify-only'})));
}
