import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {composeDictionaryPackages, verifyDictionaryPackage} from './dictionary-package-closure.mjs';
import {runComposition} from './compose-dictionary-review.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const generation = 'composition-test-generation';
const base = [process.env.TMPDIR, process.env.RUNNER_TEMP].find(v => typeof v === 'string' && path.isAbsolute(v) && path.resolve(v) !== '/');
assert.ok(base, 'TMPDIR or RUNNER_TEMP scratch required');

async function writeJson(file, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, bytes);
  return {file, bytes, sha256: hash(bytes)};
}

async function packageFixture(root, {recordId, variableName = recordId, isolated = [], parserIssues = null} = {}) {
  await fs.mkdir(path.join(root, 'records'), {recursive: true});
  await fs.mkdir(path.join(root, 'pages'), {recursive: true});
  const variable = {name: variableName, description: `Literal ${variableName}`, unit: null, evidence_ids: ['evidence.fixture']};
  const page = await writeJson(path.join(root, 'pages', 'pending.json'), [variable]);
  await fs.rename(page.bytes ? path.join(root, 'pages', 'pending.json') : '', path.join(root, 'pages', `${page.sha256}.json`));
  let parserIssuesArtifact;
  if (parserIssues) {
    const parserBody = Buffer.from(JSON.stringify(parserIssues));
    const parserSha256 = hash(parserBody);
    parserIssuesArtifact = {format: 'ushso.glyph-parser-issues.v1', file: `parser-issues/${parserSha256}.json`, sha256: parserSha256,
      bytes: parserBody.length, count: parserIssues.length, source: 'fixture', all_parser_issues_preserved: true};
    await fs.mkdir(path.join(root, 'parser-issues'), {recursive: true});
    await fs.writeFile(path.join(root, parserIssuesArtifact.file), parserBody);
  }
  const descriptor = await writeJson(path.join(root, 'records', `${hash(recordId)}.json`), {
    format: 'ushso.dictionary-review.v1', record_id: recordId, generation,
    baseline_record_sha256: 'a'.repeat(64), source_proposal_sha256: 'b'.repeat(64),
    source_evidence: {publisher_url: 'https://example.test/dictionary', release_applicability: 'unresolved'},
    evidence: [{evidence_id: 'evidence.fixture', provenance_ids: ['provenance.fixture']}],
    provenance: [{provenance_id: 'provenance.fixture', locator: 'https://example.test/dictionary', content_sha256: 'c'.repeat(64)}],
    limitations: ['Pending scientific review.'], review_status: 'pending_owner_review', publication_authorized: false,
    schema_applicability: 'unresolved', variable_count: 1, isolated_fields: [],
    ...(parserIssuesArtifact ? {parser_issues_artifact: parserIssuesArtifact} : {}),
    pages: [{sha256: page.sha256, count: 1, bytes: page.bytes.length}]
  });
  const manifest = await writeJson(path.join(root, 'manifest.json'), {
    format: 'ushso.dictionary-review-package.v1', generation, review_status: 'pending_owner_review',
    publication_authorized: false, canonical_records_changed: 0,
    records: [{record_id: recordId, file: `records/${hash(recordId)}.json`, sha256: descriptor.sha256, variables: 1, isolated_fields: 0}],
    isolated, variables: 1, pages: 1, maximum_page_bytes: page.bytes.length
  });
  return {variable, manifest, descriptor, parserIssuesArtifact};
}

async function sourceFixture(root, id, variable) {
  const source = await writeJson(path.join(root, `${id}-source.json`), {variables: [variable], issues: []});
  return {record_id: id, file: sourceFile(source), sha256: source.sha256, pointer: '/variables', issues_pointer: '/issues'};
}

function sourceFile(source) {
  return source.file;
}

async function runInScratch(fn) {
  const root = await fs.mkdtemp(path.join(base, 'ushso-composition-fix-'));
  try { return await fn(root); } finally { await fs.rm(root, {recursive: true, force: true}); }
}

test('composition moves superseded package isolation to hash-bound history', () => runInScratch(async root => {
  const baseline = path.join(root, 'baseline'), replacement = path.join(root, 'replacement'), output = path.join(root, 'output');
  const old = await packageFixture(baseline, {recordId: 'record-old', isolated: [{record_id: 'record-new', code: 'NO_EXTRACTED_GRID_ROWS'}]});
  const newer = await packageFixture(replacement, {recordId: 'record-new'});
  const result = await composeDictionaryPackages({inputs: [baseline, replacement], output, expectedRecords: ['record-old', 'record-new']});
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json')));
  assert.equal(result.records, 2);
  assert.deepEqual(manifest.isolated, []);
  assert.equal(manifest.isolation_history.length, 1);
  assert.deepEqual(manifest.isolation_history[0], {
    record_id: 'record-new', code: 'NO_EXTRACTED_GRID_ROWS', input_attempt_status: 'historical_input_attempt',
    source_manifest_sha256: old.manifest.sha256
  });
  assert.equal(manifest.records.some(item => item.record_id === 'record-new'), true);
  assert.equal(newer.descriptor.sha256, manifest.records.find(item => item.record_id === 'record-new').sha256);
}));

test('composition preserves history across a later composition and stays deterministic', () => runInScratch(async root => {
  const first = path.join(root, 'first'), second = path.join(root, 'second'), third = path.join(root, 'third'), composed = path.join(root, 'composed'), chained = path.join(root, 'chained'), repeated = path.join(root, 'repeated');
  await packageFixture(first, {recordId: 'record-a', isolated: [{record_id: 'record-x', code: 'NO_EXTRACTED_GRID_ROWS'}]});
  const firstManifestBytes = await fs.readFile(path.join(first, 'manifest.json'));
  const firstManifestSha256 = hash(firstManifestBytes);
  await packageFixture(second, {recordId: 'record-b', isolated: [{record_id: 'record-x', code: 'SOURCE_UNAVAILABLE'}]});
  await packageFixture(third, {recordId: 'record-c', isolated: [{record_id: 'record-y', code: 'SOURCE_UNAVAILABLE'}]});
  await composeDictionaryPackages({inputs: [first, second], output: composed});
  await composeDictionaryPackages({inputs: [composed, third], output: chained});
  await composeDictionaryPackages({inputs: [composed, third], output: repeated});
  assert.equal(await fs.readFile(path.join(chained, 'manifest.json'), 'utf8'), await fs.readFile(path.join(repeated, 'manifest.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(chained, 'manifest.json')));
  assert.deepEqual(manifest.isolated.map(item => item.record_id), ['record-x', 'record-x', 'record-y']);
  assert.deepEqual(manifest.isolation_history.map(item => item.record_id), ['record-x', 'record-x', 'record-x', 'record-x', 'record-y']);
  assert.equal(manifest.isolation_history.some(item => item.source_manifest_sha256 === firstManifestSha256), true);
}));

test('verify-only binds exact records and source packages while allowing pinned identity output', () => runInScratch(async root => {
  const input = path.join(root, 'input'), output = path.join(root, 'output'), composed = path.join(root, 'composed'), specDir = path.join(root, 'spec');
  const fixture = await packageFixture(input, {recordId: 'record-a'});
  const expected = await sourceFixture(specDir, 'record-a', fixture.variable);
  const spec = await writeJson(path.join(specDir, 'composition.json'), {
    format: 'ushso.dictionary-composition-inputs.v1', generation, publication_authorized: false,
    packages: [{directory: input, manifest_sha256: fixture.manifest.sha256}], expected_fields: [expected]
  });
  await runComposition({specFile: spec.file, output: composed});
  assert.equal((await runComposition({specFile: spec.file, output: composed, verifyOnly: true})).records, 1);
  await fs.cp(input, output, {recursive: true});
  const result = await runComposition({specFile: spec.file, output, verifyOnly: true});
  assert.equal(result.records, 1);
  const tampered = JSON.parse(await fs.readFile(path.join(output, 'manifest.json')));
  tampered.source_packages = [{manifest_sha256: 'd'.repeat(64), records: 1}];
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(tampered));
  await assert.rejects(runComposition({specFile: spec.file, output, verifyOnly: true}), /COMPOSITION_OUTPUT_SOURCE_PACKAGES/);
  const metadataOutput = path.join(root, 'metadata-output'); await fs.cp(input, metadataOutput, {recursive: true});
  const metadataManifest = JSON.parse(await fs.readFile(path.join(metadataOutput, 'manifest.json')));
  metadataManifest.records[0].review_trace = 'tampered';
  await fs.writeFile(path.join(metadataOutput, 'manifest.json'), JSON.stringify(metadataManifest));
  await assert.rejects(runComposition({specFile: spec.file, output: metadataOutput, verifyOnly: true}), /COMPOSITION_OUTPUT_RECORD_MANIFEST/);
  const generationOutput = path.join(root, 'generation-output'); await fs.cp(input, generationOutput, {recursive: true});
  const generationDescriptorFile = path.join(generationOutput, 'records', `${hash('record-a')}.json`);
  const generationDescriptor = JSON.parse(await fs.readFile(generationDescriptorFile)); generationDescriptor.generation = 'wrong-generation';
  const generationDescriptorBytes = Buffer.from(JSON.stringify(generationDescriptor));
  await fs.writeFile(generationDescriptorFile, generationDescriptorBytes);
  const generationManifest = JSON.parse(await fs.readFile(path.join(generationOutput, 'manifest.json')));
  generationManifest.generation = 'wrong-generation'; generationManifest.records[0].sha256 = hash(generationDescriptorBytes);
  await fs.writeFile(path.join(generationOutput, 'manifest.json'), JSON.stringify(generationManifest));
  await assert.rejects(runComposition({specFile: spec.file, output: generationOutput, verifyOnly: true}), /COMPOSITION_OUTPUT_GENERATION/);
}));

test('verify-only rejects expected source files inside output and tampered descriptor identity', () => runInScratch(async root => {
  const input = path.join(root, 'input'), output = path.join(root, 'output'), specDir = path.join(root, 'spec');
  const fixture = await packageFixture(input, {recordId: 'record-a'});
  await fs.cp(input, output, {recursive: true});
  const source = await writeJson(path.join(output, 'source.json'), {variables: [fixture.variable], issues: []});
  const spec = await writeJson(path.join(specDir, 'composition.json'), {
    format: 'ushso.dictionary-composition-inputs.v1', generation, publication_authorized: false,
    packages: [{directory: input, manifest_sha256: fixture.manifest.sha256}],
    expected_fields: [{record_id: 'record-a', file: source.file, sha256: source.sha256, pointer: '/variables', issues_pointer: '/issues'}]
  });
  await assert.rejects(runComposition({specFile: spec.file, output, verifyOnly: true}), /COMPOSITION_SOURCE_OUTPUT/);
  const required = ['format', 'baseline_record_sha256', 'source_proposal_sha256', 'evidence', 'provenance', 'limitations', 'isolated_fields'];
  for (const field of required) {
    const invalid = path.join(root, `missing-${field}`); await fs.cp(input, invalid, {recursive: true});
    const descriptorFile = path.join(invalid, 'records', `${hash('record-a')}.json`);
    const descriptor = JSON.parse(await fs.readFile(descriptorFile)); delete descriptor[field];
    const descriptorBytes = Buffer.from(JSON.stringify(descriptor)); await fs.writeFile(descriptorFile, descriptorBytes);
    const manifestFile = path.join(invalid, 'manifest.json'), manifest = JSON.parse(await fs.readFile(manifestFile));
    manifest.records[0].sha256 = hash(descriptorBytes); await fs.writeFile(manifestFile, JSON.stringify(manifest));
    await assert.rejects(verifyDictionaryPackage({directory: invalid}), /GRAPH_RECORD_IDENTITY/);
  }
}));

test('composition rejects source symlinks resolving into output and accepts external links', () => runInScratch(async root => {
  const input = path.join(root, 'input'), output = path.join(root, 'output'), composed = path.join(root, 'composed'), specDir = path.join(root, 'spec');
  const fixture = await packageFixture(input, {recordId: 'record-a'});
  await fs.cp(input, output, {recursive: true});
  const outputOracle = await writeJson(path.join(output, 'oracle.json'), {variables: [fixture.variable], issues: []});
  const sourceLink = path.join(root, 'source-link.json');
  await fs.symlink(outputOracle.file, sourceLink);
  const makeSpec = source => writeJson(path.join(specDir, 'composition.json'), {
    format: 'ushso.dictionary-composition-inputs.v1', generation, publication_authorized: false,
    packages: [{directory: input, manifest_sha256: fixture.manifest.sha256}],
    expected_fields: [{record_id: 'record-a', file: path.relative(specDir, source), sha256: outputOracle.sha256, pointer: '/variables', issues_pointer: '/issues'}]
  });
  const outputSpec = await makeSpec(sourceLink);
  await assert.rejects(runComposition({specFile: outputSpec.file, output, verifyOnly: true}), /COMPOSITION_SOURCE_OUTPUT/);

  await fs.unlink(sourceLink);
  const external = await writeJson(path.join(root, 'external-source.json'), {variables: [fixture.variable], issues: []});
  await fs.symlink(external.file, sourceLink);
  const externalSpec = await makeSpec(sourceLink);
  const result = await runComposition({specFile: externalSpec.file, output: composed});
  assert.equal(result.records, 1);
}));

test('supplement binding encoding cannot contradict its descriptor', () => runInScratch(async root => {
  await fs.mkdir(path.join(root, 'records'), {recursive: true});
  await fs.mkdir(path.join(root, 'pages'), {recursive: true});
  await fs.mkdir(path.join(root, 'supplements'), {recursive: true});
  const variable = {name: 'large', description: 'x'.repeat(70000), evidence_ids: ['evidence.fixture']};
  const raw = Buffer.from(JSON.stringify(variable)), fragmentBody = JSON.stringify({encoding: 'base64', index: 0, byte_offset: 0, decoded_bytes: raw.length, data: raw.toString('base64')});
  const fragmentSha = hash(fragmentBody);
  await fs.writeFile(path.join(root, 'supplements', `${fragmentSha}.json`), fragmentBody);
  const supplement = {format: 'ushso.dictionary-field-supplement.v1', field_sha256: hash(raw), name: variable.name, evidence_ids: variable.evidence_ids,
    encoding: 'base64-raw-utf8-json', total_bytes: raw.length, fragment_count: 1, review_status: 'pending_owner_review', publication_authorized: false,
    fragments: [{sha256: fragmentSha, bytes: Buffer.byteLength(fragmentBody), decoded_bytes: raw.length}]};
  const supplementBody = JSON.stringify(supplement), supplementSha = hash(supplementBody);
  await fs.writeFile(path.join(root, 'supplements', `${supplementSha}.json`), supplementBody);
  const pageBody = JSON.stringify([{name: variable.name, evidence_ids: variable.evidence_ids,
    supplement: {field_sha256: supplement.field_sha256, descriptor_sha256: supplementSha, encoding: 'wrong', total_bytes: raw.length, fragment_count: 1}}]);
  const pageSha = hash(pageBody); await fs.writeFile(path.join(root, 'pages', `${pageSha}.json`), pageBody);
  const descriptorBody = JSON.stringify({format: 'ushso.dictionary-review.v1', record_id: 'record-large', generation,
    baseline_record_sha256: 'a'.repeat(64), source_proposal_sha256: 'b'.repeat(64), evidence: [{evidence_id: 'evidence.fixture', provenance_ids: ['provenance.fixture']}],
    provenance: [{provenance_id: 'provenance.fixture'}], limitations: ['pending'], review_status: 'pending_owner_review', publication_authorized: false,
    schema_applicability: 'unresolved', variable_count: 1, isolated_fields: [], supplements: [{field_sha256: supplement.field_sha256, descriptor_sha256: supplementSha}],
    pages: [{sha256: pageSha, count: 1, bytes: Buffer.byteLength(pageBody)}]});
  const descriptorSha = hash(descriptorBody), descriptorFile = `records/${hash('record-large')}.json`;
  await fs.writeFile(path.join(root, descriptorFile), descriptorBody);
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({format: 'ushso.dictionary-review-package.v1', generation,
    review_status: 'pending_owner_review', publication_authorized: false, canonical_records_changed: 0,
    records: [{record_id: 'record-large', file: descriptorFile, sha256: descriptorSha, variables: 1, isolated_fields: 0}], isolated: [], variables: 1, pages: 1, maximum_page_bytes: Buffer.byteLength(pageBody)}));
  await assert.rejects(verifyDictionaryPackage({directory: root}), /GRAPH_SUPPLEMENT_ID/);
}));

test('composition verifies and copies parser issue sidecars', () => runInScratch(async root => {
  const input = path.join(root, 'input'), output = path.join(root, 'output');
  const fixture = await packageFixture(input, {recordId: 'record-parser', parserIssues: [{code: 'FIXTURE_PARSER_ISSUE'}]});
  await composeDictionaryPackages({inputs: [input], output});
  const descriptorFile = path.join(output, 'records', `${hash('record-parser')}.json`);
  const descriptor = JSON.parse(await fs.readFile(descriptorFile));
  const artifact = descriptor.parser_issues_artifact;
  const copied = await fs.readFile(path.join(output, artifact.file));
  assert.equal(copied.length, artifact.bytes);
  assert.equal(hash(copied), artifact.sha256);
  assert.deepEqual(JSON.parse(copied), [{code: 'FIXTURE_PARSER_ISSUE'}]);
  await fs.writeFile(path.join(output, artifact.file), Buffer.from('[]'));
  await assert.rejects(verifyDictionaryPackage({directory: output}), /GRAPH_HASH/);
  assert(fixture.parserIssuesArtifact);
}));
