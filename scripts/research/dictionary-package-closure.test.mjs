import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyDictionaryPackage, composeDictionaryPackages, subsetDictionaryPackage } from './dictionary-package-closure.mjs';
import { FIELD_STUB_PREVIEW_BYTES, packageFieldSupplement } from './dictionary-field-supplements.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const base = [process.env.TMPDIR, process.env.RUNNER_TEMP].find((v) => typeof v === 'string' && path.isAbsolute(v) && path.resolve(v) !== '/');
assert.ok(base, 'TMPDIR or RUNNER_TEMP scratch required');
test('subset retains exact oversized values and issues without unselected record descriptors', () => run(async (root, f, dir) => {
    const issue = await addIssue(root, f), other = path.join(dir, 'other');
    await fixture(other, 'record-b');
    const combined = path.join(dir, 'combined');
    await composeDictionaryPackages({inputs: [root, other], output: combined});
    const output = path.join(dir, 'subset');
    const result = await subsetDictionaryPackage({directory: combined, output, recordIds: ['record-a']});
    assert.equal(result.records, 1); assert.equal(result.supplemented_fields, 1); assert.equal(result.fragments, 3);
    await verifyDictionaryPackage({directory: output, expectedRecords: ['record-a'], expectedFields: async () => [f.variable], expectedIssues: async () => [issue.raw]});
    assert.deepEqual(await fs.readFile(path.join(output, f.m.records[0].file)), await fs.readFile(path.join(root, f.m.records[0].file)));
    await assert.rejects(fs.stat(path.join(output, 'records', hash('record-b') + '.json')), {code: 'ENOENT'});
    const repeated = await subsetDictionaryPackage({directory: combined, output: path.join(dir, 'repeated'), recordIds: ['record-a']});
    assert.equal(result.manifest_sha256, repeated.manifest_sha256);
}));
test('subset rejects duplicate and unknown record requests before output creation', () => run(async (root, f, dir) => {
    const output = path.join(dir, 'subset');
    await assert.rejects(subsetDictionaryPackage({directory: root, output, recordIds: ['record-a', 'record-a']}), /SUBSET_RECORD_IDS/);
    await assert.rejects(subsetDictionaryPackage({directory: root, output, recordIds: ['missing']}), /SUBSET_RECORD_MISSING/);
    await assert.rejects(fs.stat(output), {code: 'ENOENT'});
}));
test('subset cannot hide corruption by selecting zero records', () => run(async (root, f, dir) => {
    await fs.appendFile(path.join(root, 'supplements', f.fragment.sha256 + '.json'), ' ');
    await assert.rejects(subsetDictionaryPackage({directory: root, output: path.join(dir, 'subset'), recordIds: []}), /GRAPH_HASH/);
}));
test('subset keeps an explicit empty graph and refuses historical overwrite', () => run(async (root, f, dir) => {
    const output = path.join(dir, 'subset');
    const result = await subsetDictionaryPackage({directory: root, output, recordIds: []});
    assert.equal(result.records, 0); assert.equal(result.fields, 0); assert.equal(result.pages, 0);
    await assert.rejects(subsetDictionaryPackage({directory: root, output, recordIds: []}), {code: 'EEXIST'});
}));
async function addIssue(root,f) {
    const raw={code:'UNRESOLVED',name:'BAD NAME',source_lines:[{physical_page:1,line:2,text:'literal unresolved text'}]},body=JSON.stringify(raw)+'\n',sha=hash(body),file='issues/'+sha+'.json';
    await fs.mkdir(path.join(root,'issues'));await fs.writeFile(path.join(root,file),body);
    f.d.isolated_fields=[{name:raw.name,code:raw.code,issue_file:file,issue_sha256:sha,source_locator:{physical_page:1,line:2}}];
    const descriptor=JSON.stringify(f.d)+'\n';await fs.writeFile(path.join(root,f.m.records[0].file),descriptor);
    f.m.records[0].sha256=hash(descriptor);f.m.records[0].isolated_fields=1;await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(f.m));return{raw,file};
}
test('isolated issue source values and locators verified',()=>run(async(root,f)=>{const issue=await addIssue(root,f);await verifyDictionaryPackage({directory:root,expectedIssues:async()=>[issue.raw]});await assert.rejects(verifyDictionaryPackage({directory:root,expectedIssues:async()=>[{...issue.raw,name:'OTHER'}]}),/GRAPH_SOURCE_ISSUE_MISMATCH/);}));
test('missing isolated issue reference fails closure',()=>run(async(root,f)=>{const issue=await addIssue(root,f);await fs.unlink(path.join(root,issue.file));await assert.rejects(verifyDictionaryPackage({directory:root}),/GRAPH_MISSING_FILE/);}));
test('removing issue reference cannot bypass exact source comparison',()=>run(async(root,f)=>{const issue=await addIssue(root,f);delete f.d.isolated_fields[0].issue_file;const bytes=JSON.stringify(f.d);await fs.writeFile(path.join(root,f.m.records[0].file),bytes);f.m.records[0].sha256=hash(bytes);await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(f.m));await assert.rejects(verifyDictionaryPackage({directory:root,expectedIssues:async()=>[issue.raw]}),/GRAPH_SOURCE_ISSUE_MISMATCH/);}));
async function fixture(root, id = 'record-a', options = {}) { await fs.mkdir(root); for (const d of ['records', 'pages', 'supplements'])
    await fs.mkdir(path.join(root, d)); const variable = { name: 'large', description: 'x'.repeat(70000), evidence_ids: ['e'], ...options.variable }, raw = Buffer.from(JSON.stringify(variable)), fragments = []; for (let offset = 0; offset < raw.length; offset += 32768) {
    const chunk = raw.subarray(offset, offset + 32768), body = JSON.stringify({ encoding: 'base64', index: fragments.length, byte_offset: offset, decoded_bytes: chunk.length, data: chunk.toString('base64') }) + '\n', sha256 = hash(body);
    await fs.writeFile(path.join(root, 'supplements', sha256 + '.json'), body);
    fragments.push({ sha256, bytes: Buffer.byteLength(body), decoded_bytes: chunk.length });
} const sd = { format: 'ushso.dictionary-field-supplement.v1', field_sha256: hash(raw), name: variable.name, evidence_ids: variable.evidence_ids, encoding: 'base64-raw-utf8-json', total_bytes: raw.length, fragment_count: fragments.length, review_status: 'pending_owner_review', publication_authorized: false, fragments }, sb = JSON.stringify(sd) + '\n', sh = hash(sb); await fs.writeFile(path.join(root, 'supplements', sh + '.json'), sb); const supplement = { field_sha256: hash(raw), descriptor_sha256: sh, total_bytes: raw.length, fragment_count: fragments.length }; const pageRow = { name: variable.name, evidence_ids: variable.evidence_ids, supplement, ...(options.stubPreview ?? {}) }; const pb = JSON.stringify([pageRow]) + '\n', ph = hash(pb); await fs.writeFile(path.join(root, 'pages', ph + '.json'), pb); const d = { format: 'ushso.dictionary-review.v1', record_id: id, generation: 'g',
  baseline_record_sha256: hash(JSON.stringify({ record_id: id })),
  source_proposal_sha256: hash(JSON.stringify(variable)),
  source_evidence: { source: 'synthetic-fixture' },
  evidence: [{ evidence_id: 'e', provenance_ids: ['p'] }],
  provenance: [{ provenance_id: 'p', locator: 'https://example.test', content_sha256: 'c'.repeat(64) }],
  limitations: ['Synthetic fixture pending review.'],
  publication_authorized: false, review_status: 'pending_owner_review', schema_applicability: 'unresolved',
  variable_count: 1, isolated_fields: [],
  supplements: [{ field_sha256: hash(raw), descriptor_sha256: sh }],
  pages: [{ sha256: ph, bytes: Buffer.byteLength(pb), count: 1 }] }, db = JSON.stringify(d) + '\n', file = 'records/' + hash(id) + '.json'; await fs.writeFile(path.join(root, file), db); const m = { format: 'ushso.dictionary-review-package.v1', generation: 'g', publication_authorized: false, review_status: 'pending_owner_review', canonical_records_changed: 0, records: [{ record_id: id, file, sha256: hash(db), variables: 1 }], variables: 1, pages: 1, maximum_page_bytes: Buffer.byteLength(pb) }; await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(m)); return { m, d, variable, fragment: fragments[0], page: ph, pageRow }; }
async function run(fn, options) { const dir = await fs.mkdtemp(path.join(base, 'dictionary-graph-')); try {
    const root = path.join(dir, 'package'), f = await fixture(root, 'record-a', options);
    await fn(root, f, dir);
}
finally {
    await fs.rm(dir, { recursive: true, force: true });
} }
test('complete graph reconstructs exact oversized value', () => run(async (root, f) => { const r = await verifyDictionaryPackage({ directory: root, expectedRecords: ['record-a'], expectedFields: async () => [f.variable] }); assert.equal(r.supplemented_fields, 1); assert.equal(r.fragments, 3); }));
test('legacy stubs without preview literals remain valid', () => run(async (root, f) => {
    assert.equal(Object.hasOwn(f.pageRow, 'description'), false);
    assert.equal(Object.hasOwn(f.pageRow, 'label'), false);
    assert.equal(Object.hasOwn(f.pageRow, 'unit'), false);
    const r = await verifyDictionaryPackage({ directory: root, expectedFields: async () => [f.variable] });
    assert.equal(r.supplemented_fields, 1);
}));
test('matching stub preview equals restored original', () => run(async (root, f) => {
    const r = await verifyDictionaryPackage({ directory: root, expectedFields: async () => [f.variable] });
    assert.equal(r.supplemented_fields, 1);
    assert.equal(f.pageRow.description, f.variable.description);
    assert.equal(f.pageRow.unit, null);
}, { variable: { description: 'exact publisher text under four kibibytes', unit: null, audit_trace: 't'.repeat(70000) }, stubPreview: { description: 'exact publisher text under four kibibytes', unit: null } }));
test('forged stub preview rejected by closure', () => run(async (root, f) => {
    await assert.rejects(verifyDictionaryPackage({ directory: root }), /GRAPH_SUPPLEMENT_PREVIEW/);
}, { variable: { description: 'real definition', audit_trace: 't'.repeat(70000) }, stubPreview: { description: 'forged definition' } }));
test('invalid stub preview type rejected by closure', () => run(async (root, f) => {
    await assert.rejects(verifyDictionaryPackage({ directory: root }), /GRAPH_SUPPLEMENT_PREVIEW/);
}, { variable: { description: 'real definition', audit_trace: 't'.repeat(70000) }, stubPreview: { description: 12 } }));
test('oversize stub preview rejected by closure', () => run(async (root, f) => {
    await assert.rejects(verifyDictionaryPackage({ directory: root }), /GRAPH_SUPPLEMENT_PREVIEW/);
}, { variable: { description: 'a'.repeat(FIELD_STUB_PREVIEW_BYTES + 1), audit_trace: 't'.repeat(70000) }, stubPreview: { description: 'a'.repeat(FIELD_STUB_PREVIEW_BYTES + 1) } }));
test('missing record fails graph closure', () => run(async (root, f) => { await fs.unlink(path.join(root, f.m.records[0].file)); await assert.rejects(verifyDictionaryPackage({ directory: root }), /GRAPH_MISSING_FILE/); }));
test('altered page bytes fail hash', () => run(async (root, f) => { await fs.appendFile(path.join(root, 'pages', f.page + '.json'), ' '); await assert.rejects(verifyDictionaryPackage({ directory: root }), /GRAPH_HASH/); }));
test('duplicate record identity fails explicitly', () => run(async (root, f) => { f.m.records.push(f.m.records[0]); await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(f.m)); await assert.rejects(verifyDictionaryPackage({ directory: root }), /GRAPH_DUPLICATE_RECORD/); }));
test('tampered supplement fragment fails hash', () => run(async (root, f) => { await fs.appendFile(path.join(root, 'supplements', f.fragment.sha256 + '.json'), ' '); await assert.rejects(verifyDictionaryPackage({ directory: root }), /GRAPH_HASH/); }));
test('source value disagreement fails even with intact graph', () => run(async (root, f) => { await assert.rejects(verifyDictionaryPackage({ directory: root, expectedFields: async () => [{ ...f.variable, description: 'different' }] }), /GRAPH_SOURCE_FIELD_MISMATCH/); }));
test('composition rejects overlaps and rebuilds deterministically', () => run(async (root, f, dir) => { await assert.rejects(composeDictionaryPackages({ inputs: [root, root], output: path.join(dir, 'conflict') }), /COMPOSITION_RECORD_CONFLICT/); await composeDictionaryPackages({ inputs: [root], output: path.join(dir, 'one'), expectedRecords: ['record-a'] }); await composeDictionaryPackages({ inputs: [root], output: path.join(dir, 'two'), expectedRecords: ['record-a'] }); assert.equal(await fs.readFile(path.join(dir, 'one/manifest.json'), 'utf8'), await fs.readFile(path.join(dir, 'two/manifest.json'), 'utf8')); }));
test('noninteger counts rejected', () => run(async (root, f) => { f.m.variables = 1.5; await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(f.m)); await assert.rejects(verifyDictionaryPackage({ directory: root }), /GRAPH_MANIFEST/); }));
test('duplicate supplement bindings rejected', () => run(async (root, f) => { f.d.supplements.push(f.d.supplements[0]); const b = JSON.stringify(f.d); await fs.writeFile(path.join(root, f.m.records[0].file), b); f.m.records[0].sha256 = hash(b); await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(f.m)); await assert.rejects(verifyDictionaryPackage({ directory: root }), /GRAPH_DUPLICATE_SUPPLEMENT/); }));
test('unsorted record order rejected', () => run(async (root, f, dir) => { const other = path.join(dir, 'other'); await fixture(other, 'record-b'); const output = path.join(dir, 'ordered'); await composeDictionaryPackages({ inputs: [root, other], output }); const m = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'))); m.records.reverse(); await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(m)); await assert.rejects(verifyDictionaryPackage({ directory: output }), /GRAPH_RECORD_ORDER/); }));
test('publisher description within 4KiB is preserved exactly on the stub', async () => {
    const dir = await fs.mkdtemp(path.join(base, 'dictionary-stub-'));
    try {
        const description = 'publisher definition '.repeat(40).trim();
        assert.ok(Buffer.byteLength(description, 'utf8') <= FIELD_STUB_PREVIEW_BYTES);
        const variable = { name: 'glyph', label: 'Glyph label', description, unit: null, evidence_ids: ['e'], audit_trace: 'x'.repeat(70000) };
        const packed = await packageFieldSupplement(variable, dir);
        assert.equal(packed.stub.description, description);
        assert.equal(packed.stub.label, 'Glyph label');
        assert.equal(packed.stub.unit, null);
        assert.equal(Object.hasOwn(packed.stub, 'audit_trace'), false);
        assert.equal(packed.binding.field_sha256, hash(Buffer.from(JSON.stringify(variable))));
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
test('oversized UTF-8 preview property is omitted not truncated', async () => {
    const dir = await fs.mkdtemp(path.join(base, 'dictionary-stub-'));
    try {
        const oversized = '\u00e9'.repeat(Math.floor(FIELD_STUB_PREVIEW_BYTES / 2) + 1);
        assert.ok(oversized.length < FIELD_STUB_PREVIEW_BYTES);
        assert.ok(Buffer.byteLength(oversized, 'utf8') > FIELD_STUB_PREVIEW_BYTES);
        const variable = { name: 'glyph', description: oversized, unit: 'mg', evidence_ids: ['e'], audit_trace: 'x'.repeat(70000) };
        const packed = await packageFieldSupplement(variable, dir);
        assert.equal(Object.hasOwn(packed.stub, 'description'), false);
        assert.equal(packed.stub.description, undefined);
        assert.equal(packed.stub.unit, 'mg');
        assert.notEqual(packed.stub.description, oversized.slice(0, FIELD_STUB_PREVIEW_BYTES));
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
test('full field fragment bytes and hash stay unchanged when stub carries preview', async () => {
    const dir = await fs.mkdtemp(path.join(base, 'dictionary-stub-'));
    try {
        const variable = { name: 'glyph', description: 'bounded exact text', unit: null, evidence_ids: ['e'], audit_trace: 'x'.repeat(70000) };
        const raw = Buffer.from(JSON.stringify(variable));
        const packed = await packageFieldSupplement(variable, dir);
        assert.equal(packed.stub.supplement.field_sha256, hash(raw));
        assert.equal(packed.stub.supplement.total_bytes, raw.length);
        const descriptor = JSON.parse(await fs.readFile(path.join(dir, 'supplements', packed.binding.descriptor_sha256 + '.json'), 'utf8'));
        assert.equal(descriptor.field_sha256, hash(raw));
        const chunks = [];
        for (const fragment of descriptor.fragments) {
            const body = await fs.readFile(path.join(dir, 'supplements', fragment.sha256 + '.json'));
            assert.equal(hash(body), fragment.sha256);
            const parsed = JSON.parse(body);
            chunks.push(Buffer.from(parsed.data, 'base64'));
        }
        const reconstructed = Buffer.concat(chunks);
        assert.deepEqual(reconstructed, raw);
        assert.equal(hash(reconstructed), hash(raw));
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
