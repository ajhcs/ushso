import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const count = n => Number.isSafeInteger(n) && n >= 0;
const hash = b => createHash('sha256').update(b).digest('hex'), HEX = /^[a-f0-9]{64}$/;
const FIELD_STUB_PREVIEW_BYTES = 4 * 1024;
const PREVIEW_KEYS = ['label', 'description', 'unit'];
const HISTORICAL_INPUT_ATTEMPT = 'historical_input_attempt';
function requireValue(value, code) { if (!value)
    throw Error(code); }
function requireMatchingStubPreview(stub, restored) {
    for (const key of PREVIEW_KEYS) {
        if (!Object.hasOwn(stub, key))
            continue;
        const preview = stub[key];
        requireValue(preview === null || typeof preview === 'string', 'GRAPH_SUPPLEMENT_PREVIEW');
        if (typeof preview === 'string')
            requireValue(Buffer.byteLength(preview, 'utf8') <= FIELD_STUB_PREVIEW_BYTES, 'GRAPH_SUPPLEMENT_PREVIEW');
        requireValue(Object.hasOwn(restored, key) && Object.is(restored[key], preview), 'GRAPH_SUPPLEMENT_PREVIEW');
    }
}
function requireIsolationEntry(entry, code = 'GRAPH_ISOLATION_HISTORY') {
    requireValue(entry && typeof entry === 'object' && !Array.isArray(entry), code);
    return entry;
}
function historicalInputAttempt(entry, sourceManifestSha256) {
    requireIsolationEntry(entry, 'COMPOSITION_ISOLATION_ENTRY');
    if (Object.hasOwn(entry, 'source_manifest_sha256'))
        requireValue(entry.source_manifest_sha256 === sourceManifestSha256, 'COMPOSITION_ISOLATION_SOURCE');
    return { ...entry, input_attempt_status: HISTORICAL_INPUT_ATTEMPT, source_manifest_sha256: sourceManifestSha256 };
}
function retainedHistoricalAttempt(entry) {
    requireIsolationEntry(entry);
    requireValue(entry.input_attempt_status === HISTORICAL_INPUT_ATTEMPT && HEX.test(entry.source_manifest_sha256), 'GRAPH_ISOLATION_HISTORY');
    return entry;
}
function sortJson(a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); }
function appendUnique(entries, entry) {
    const key = JSON.stringify(entry);
    if (!entries.some(existing => JSON.stringify(existing) === key))
        entries.push(entry);
}
async function read(root, file, sha, max) { requireValue(typeof file === 'string' && !path.isAbsolute(file) && file.split('/').every(x => x && x !== '.' && x !== '..') && !file.includes('\\'), 'GRAPH_PATH'); const full = path.join(root, file), real = await fs.realpath(full).catch(() => { throw Error('GRAPH_MISSING_FILE:' + file); }); requireValue(real.startsWith((await fs.realpath(root)) + path.sep), 'GRAPH_PATH'); const stat = await fs.stat(full); requireValue(stat.isFile() && stat.size <= max, 'GRAPH_SIZE'); const bytes = await fs.readFile(full); requireValue(bytes.length <= max, 'GRAPH_SIZE'); if (sha)
    requireValue(HEX.test(sha) && hash(bytes) === sha, 'GRAPH_HASH:' + file); return { bytes, value: JSON.parse(bytes) }; }
export async function verifyDictionaryPackage({ directory, expectedRecords, expectedFields, expectedIssues, expectedParserIssues, requireSortedRecords = true, onFile = async () => { } }) {
    const { bytes: mb, value: m } = await read(directory, 'manifest.json', null, 2 * 1024 * 1024);
    requireValue(m.format === 'ushso.dictionary-review-package.v1' && m.publication_authorized === false && m.review_status === 'pending_owner_review' && m.canonical_records_changed === 0 && Array.isArray(m.records) && (!Object.hasOwn(m, 'isolated') || Array.isArray(m.isolated)) && (!Object.hasOwn(m, 'isolation_history') || Array.isArray(m.isolation_history)) && count(m.variables) && count(m.pages) && count(m.maximum_page_bytes), 'GRAPH_MANIFEST');
    for (const attempt of (m.isolation_history ?? []))
        retainedHistoricalAttempt(attempt);
    let previousRecordId = null;
    const ids = new Set(), result = { generation: m.generation, manifest_sha256: hash(mb), records: 0, fields: 0, pages: 0, supplemented_fields: 0, fragments: 0, unowned_context_lines: 0, maximum_page_bytes: 0, files: 0 };
    await onFile('manifest.json', mb);
    result.files++;
    for (const item of m.records) {
        requireValue(typeof item.record_id === 'string' && !ids.has(item.record_id), 'GRAPH_DUPLICATE_RECORD');
        requireValue(!requireSortedRecords || previousRecordId === null || previousRecordId < item.record_id, 'GRAPH_RECORD_ORDER');
        previousRecordId = item.record_id;
        ids.add(item.record_id);
        requireValue(item.file === 'records/' + hash(item.record_id) + '.json', 'GRAPH_RECORD_PATH');
        const { bytes: db, value: d } = await read(directory, item.file, item.sha256, 262144);
        await onFile(item.file, db, item.record_id);
        result.files++;
        requireValue(d.format === 'ushso.dictionary-review.v1' && d.record_id === item.record_id && d.generation === m.generation && HEX.test(d.baseline_record_sha256) && HEX.test(d.source_proposal_sha256) && d.publication_authorized === false && d.review_status === 'pending_owner_review' && d.schema_applicability === 'unresolved' && Array.isArray(d.evidence) && Array.isArray(d.provenance) && Array.isArray(d.limitations) && Array.isArray(d.isolated_fields), 'GRAPH_RECORD_IDENTITY');
        const sourceParserIssues = expectedParserIssues ? await expectedParserIssues(item, d) : null;
        if (sourceParserIssues !== null && sourceParserIssues !== undefined)
            requireValue(Array.isArray(sourceParserIssues), 'GRAPH_EXPECTED_PARSER_ISSUES');
        if (d.parser_issues_artifact !== undefined) {
            const artifact = d.parser_issues_artifact;
            requireValue(artifact && typeof artifact === 'object' && !Array.isArray(artifact)
                && artifact.format === 'ushso.glyph-parser-issues.v1'
                && HEX.test(artifact.sha256)
                && artifact.file === 'parser-issues/' + artifact.sha256 + '.json'
                && count(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= 8 * 1024 * 1024
                && count(artifact.count)
                && artifact.all_parser_issues_preserved === true, 'GRAPH_PARSER_ISSUE_ARTIFACT');
            const { bytes: parserBytes, value: parserIssues } = await read(directory, artifact.file, artifact.sha256, 8 * 1024 * 1024);
            requireValue(parserBytes.length === artifact.bytes && Array.isArray(parserIssues)
                && parserIssues.length === artifact.count, 'GRAPH_PARSER_ISSUE_ARTIFACT');
            if (sourceParserIssues !== null && sourceParserIssues !== undefined)
                requireValue(isDeepStrictEqual(parserIssues, sourceParserIssues), 'GRAPH_SOURCE_PARSER_ISSUE_MISMATCH');
            await onFile(artifact.file, parserBytes, item.record_id);
            result.files++;
        } else if (sourceParserIssues !== null && sourceParserIssues !== undefined) {
            throw Error('GRAPH_PARSER_ISSUE_ARTIFACT');
        }
        requireValue(Array.isArray(d.pages) && d.pages.length <= 2000 && count(d.variable_count) && count(item.variables) && ['full_field_count', 'supplemental_field_count'].every(k => !Object.hasOwn(d, k) || count(d[k])) && ['full_fields', 'supplemental_fields', 'isolated_fields'].every(k => !Object.hasOwn(item, k) || count(item[k])), 'GRAPH_PAGES');
        requireValue(!d.supplements || Array.isArray(d.supplements), 'GRAPH_SUPPLEMENT_BINDING');
        const supplementBindings = new Map();
        for (const s of d.supplements ?? []) {
            requireValue(HEX.test(s?.field_sha256) && HEX.test(s?.descriptor_sha256) && !supplementBindings.has(s.field_sha256), 'GRAPH_DUPLICATE_SUPPLEMENT');
            supplementBindings.set(s.field_sha256, s.descriptor_sha256);
        }
        const expected = expectedFields ? await expectedFields(item, d) : null;
        if (expected)
            requireValue(Array.isArray(expected), 'GRAPH_EXPECTED_FIELDS');
        let position = 0;
        const names = new Set(), seenSupplements = new Set();
        for (const p of d.pages) {
            requireValue(Number.isSafeInteger(p.count) && p.count > 0 && p.count <= 50 && count(p.bytes) && p.bytes > 0 && p.bytes <= 65536, 'GRAPH_PAGE_LIMIT');
            const file = 'pages/' + p.sha256 + '.json', { bytes, value: rows } = await read(directory, file, p.sha256, 65536);
            requireValue(bytes.length === p.bytes && Array.isArray(rows) && rows.length === p.count, 'GRAPH_PAGE_COUNT');
            await onFile(file, bytes, item.record_id);
            result.files++;
            result.pages++;
            result.maximum_page_bytes = Math.max(result.maximum_page_bytes, bytes.length);
            for (let field of rows) {
                requireValue(typeof field?.name === 'string' && field.name.length && !names.has(field.name), 'GRAPH_DUPLICATE_FIELD');
                names.add(field.name);
                if (field.supplement) {
                    const binding = field.supplement;
                    requireValue(HEX.test(binding.field_sha256) && HEX.test(binding.descriptor_sha256) && (!Object.hasOwn(binding, 'encoding') || binding.encoding === 'base64-raw-utf8-json'), 'GRAPH_SUPPLEMENT_ID');
                    requireValue(supplementBindings.get(binding.field_sha256) === binding.descriptor_sha256 && !seenSupplements.has(binding.field_sha256), 'GRAPH_SUPPLEMENT_BINDING');
                    seenSupplements.add(binding.field_sha256);
                    const sf = 'supplements/' + binding.descriptor_sha256 + '.json', { bytes: sb, value: s } = await read(directory, sf, binding.descriptor_sha256, 262144);
                    await onFile(sf, sb, item.record_id);
                    result.files++;
                    requireValue(s.format === 'ushso.dictionary-field-supplement.v1' && s.field_sha256 === binding.field_sha256 && s.name === field.name && s.publication_authorized === false && s.review_status === 'pending_owner_review' && s.encoding === 'base64-raw-utf8-json' && count(s.total_bytes) && s.total_bytes > 0 && count(s.fragment_count) && s.fragment_count > 0 && s.total_bytes === binding.total_bytes && s.fragment_count === binding.fragment_count && Array.isArray(s.fragments) && s.fragments.length === s.fragment_count && s.fragments.length <= 2048 && s.total_bytes <= 64 * 1024 * 1024, 'GRAPH_SUPPLEMENT_DESCRIPTOR');
                    let offset = 0;
                    const chunks = [];
                    for (const [index, f] of s.fragments.entries()) {
                        const ff = 'supplements/' + f.sha256 + '.json', { bytes: fb, value: fragment } = await read(directory, ff, f.sha256, 65536);
                        requireValue(count(f.bytes) && count(f.decoded_bytes) && f.decoded_bytes > 0 && count(fragment.index) && count(fragment.byte_offset) && count(fragment.decoded_bytes) && fb.length === f.bytes && fragment.encoding === 'base64' && fragment.index === index && fragment.byte_offset === offset && typeof fragment.data === 'string', 'GRAPH_FRAGMENT_ORDER');
                        const chunk = Buffer.from(fragment.data, 'base64');
                        requireValue(chunk.toString('base64') === fragment.data && chunk.length === f.decoded_bytes && chunk.length === fragment.decoded_bytes && chunk.length <= 32768, 'GRAPH_FRAGMENT_BYTES');
                        chunks.push(chunk);
                        offset += chunk.length;
                        await onFile(ff, fb, item.record_id);
                        result.files++;
                        result.fragments++;
                    }
                    const full = Buffer.concat(chunks);
                    requireValue(full.length === s.total_bytes && hash(full) === s.field_sha256, 'GRAPH_SUPPLEMENT_RECONSTRUCTION');
                    const restored = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(full));
                    requireValue((!Object.hasOwn(binding, 'encoding') || binding.encoding === s.encoding) && restored.name === field.name && isDeepStrictEqual(restored.evidence_ids, field.evidence_ids), 'GRAPH_SUPPLEMENT_FIELD_IDENTITY');
                    requireMatchingStubPreview(field, restored);
                    field = restored;
                    result.supplemented_fields++;
                }
                if (expected)
                    requireValue(position < expected.length && isDeepStrictEqual(field, expected[position]), 'GRAPH_SOURCE_FIELD_MISMATCH:' + item.record_id + ':' + position);
                position++;
                result.fields++;
            }
        }
        requireValue(position === d.variable_count && position === item.variables && (!Object.hasOwn(d, 'full_field_count') || d.full_field_count === position) && (!Object.hasOwn(item, 'full_fields') || item.full_fields === position) && (!expected || position === expected.length), 'GRAPH_RECORD_COUNT');
        requireValue((d.supplements ?? []).length === seenSupplements.size && (!Object.hasOwn(d, 'supplemental_field_count') || d.supplemental_field_count === seenSupplements.size), 'GRAPH_SUPPLEMENT_COUNT');
        requireValue(Array.isArray(d.isolated_fields), 'GRAPH_ISSUE_COLLECTION');
        if (Object.hasOwn(item,'isolated_fields')) requireValue(item.isolated_fields === d.isolated_fields.length, 'GRAPH_ISSUE_COUNT');
        const sourceIssues = expectedIssues ? await expectedIssues(item,d) : null;
        if(sourceIssues) requireValue(Array.isArray(sourceIssues)&&sourceIssues.length===(d.isolated_fields??[]).length,'GRAPH_SOURCE_ISSUE_COUNT');
        for (const [issueIndex,issue] of (d.isolated_fields ?? []).entries()) {
            if (!issue.issue_file) {
                // Inline legacy outcomes still must match a supplied source expectation.
                if (sourceIssues) requireValue(isDeepStrictEqual(issue, sourceIssues[issueIndex]), 'GRAPH_SOURCE_ISSUE_MISMATCH');
                continue;
            }
            requireValue(issue.issue_file === 'issues/' + issue.issue_sha256 + '.json', 'GRAPH_ISSUE_PATH');
            const {bytes:ib,value:raw} = await read(directory,issue.issue_file,issue.issue_sha256,65536);
            if(sourceIssues) requireValue(isDeepStrictEqual(raw,sourceIssues[issueIndex]),'GRAPH_SOURCE_ISSUE_MISMATCH');
            requireValue(raw.code===issue.code && (raw.name??null)===(issue.name??null),'GRAPH_ISSUE_IDENTITY');
            const first=raw.source_lines?.[0];
            requireValue(isDeepStrictEqual(issue.source_locator,first?{physical_page:first.physical_page,line:first.line}:null),'GRAPH_ISSUE_LOCATOR');
            await onFile(issue.issue_file,ib,item.record_id);result.files++;
        }
        const u = d.source_evidence?.unowned_context;
        if (u) {
            requireValue(u.file === 'unowned-context/' + u.sha256 + '.json', 'GRAPH_CONTEXT_PATH');
            const { bytes: ub, value: lines } = await read(directory, u.file, u.sha256, 8 * 1024 * 1024);
            requireValue(Array.isArray(lines) && lines.length === u.count && lines.every(l => l.ownership === 'unknown' && l.eligible_for_definition_assignment === false), 'GRAPH_CONTEXT_OWNERSHIP');
            await onFile(u.file, ub, item.record_id);
            result.files++;
            result.unowned_context_lines += lines.length;
        }
        result.records++;
    }
    requireValue(result.fields === m.variables && result.pages === m.pages && result.maximum_page_bytes === m.maximum_page_bytes, 'GRAPH_MANIFEST_COUNT');
    if (expectedRecords)
        requireValue(isDeepStrictEqual([...ids].sort(), [...expectedRecords].sort()), 'GRAPH_EXPECTED_RECORD_SET');
    return result;
}
// Select exact record identities only after the complete source graph is verified.
// Descriptor, page, issue, context and supplement bytes are copied unchanged.
export async function subsetDictionaryPackage({directory, output, recordIds, expectedFields, expectedIssues}) {
    requireValue(Array.isArray(recordIds) && recordIds.length <= 4000
        && recordIds.every(id => typeof id === 'string') && new Set(recordIds).size === recordIds.length, 'SUBSET_RECORD_IDS');
    const selected = new Set(recordIds);
    const before = await verifyDictionaryPackage({directory, expectedFields, expectedIssues, requireSortedRecords: false});
    const {bytes, value: source} = await read(directory, 'manifest.json', before.manifest_sha256, 2 * 1024 * 1024);
    requireValue(recordIds.every(id => source.records.some(item => item.record_id === id)), 'SUBSET_RECORD_MISSING');
    const sourceManifestSha256 = before.manifest_sha256, sourceRecordIds = new Set(source.records.map(item => item.record_id)), isolationHistory = [];
    for (const attempt of (source.isolation_history ?? []))
        appendUnique(isolationHistory, retainedHistoricalAttempt(attempt));
    for (const attempt of (source.isolated ?? []))
        appendUnique(isolationHistory, historicalInputAttempt(attempt, sourceManifestSha256));
    await fs.mkdir(output); // Never overwrite a historical package or incomplete attempt.
    let variables = 0, pages = 0, maximum_page_bytes = 0;
    const second = await verifyDictionaryPackage({directory, expectedFields, expectedIssues, requireSortedRecords: false,
        onFile: async (file, body, recordId) => {
            if (!selected.has(recordId)) return;
            if (file.startsWith('records/')) {
                const descriptor = JSON.parse(body);
                variables += descriptor.variable_count; pages += descriptor.pages.length;
                maximum_page_bytes = Math.max(maximum_page_bytes, ...descriptor.pages.map(page => page.bytes));
            }
            const target = path.join(output, file);
            await fs.mkdir(path.dirname(target), {recursive: true});
            try { await fs.writeFile(target, body, {flag: 'wx'}); }
            catch (error) {
                if (error.code !== 'EEXIST') throw error;
                requireValue(hash(await fs.readFile(target)) === hash(body), 'SUBSET_FILE_CONFLICT');
            }
        }});
    requireValue(second.manifest_sha256 === before.manifest_sha256, 'SUBSET_SOURCE_CHANGED');
    const manifest = {format: 'ushso.dictionary-review-package.v1', generation: source.generation,
        review_status: 'pending_owner_review', publication_authorized: false, canonical_records_changed: 0,
        source_packages: [{manifest_sha256: hash(bytes), records: source.records.length}],
        records: source.records.filter(item => selected.has(item.record_id)).sort((a,b) => a.record_id < b.record_id ? -1 : 1),
        // Subsets carry only active isolation for selected IDs; any source attempt
        // remains in isolation_history with its original manifest context.
        isolated: (source.isolated ?? []).filter(item => selected.has(item.record_id) && !sourceRecordIds.has(item.record_id)),
        isolation_history: isolationHistory.sort(sortJson), variables, pages, maximum_page_bytes};
    await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
    return verifyDictionaryPackage({directory: output, expectedRecords: recordIds, expectedFields, expectedIssues});
}
export async function composeDictionaryPackages({ inputs, output, expectedRecords, expectedFields, expectedIssues }) {
    const records = [], isolated = [], isolationHistory = [], sources = [], seen = new Map(), packages = [];
    let generation;
    for (const directory of inputs) {
        const { bytes, value: m } = await read(directory, 'manifest.json', null, 2 * 1024 * 1024);
        requireValue(Array.isArray(m.records) && (!Object.hasOwn(m, 'isolated') || Array.isArray(m.isolated)) && (!Object.hasOwn(m, 'isolation_history') || Array.isArray(m.isolation_history)), 'COMPOSITION_INPUT_MANIFEST');
        generation ??= m.generation;
        requireValue(m.generation === generation, 'COMPOSITION_GENERATION');
        for (const item of m.records) {
            requireValue(!seen.has(item.record_id), 'COMPOSITION_RECORD_CONFLICT:' + item.record_id);
            seen.set(item.record_id, directory);
            records.push(item);
        }
        const manifest_sha256 = hash(bytes);
        packages.push({manifest: m, manifest_sha256, directory});
        sources.push({ manifest_sha256, records: m.records.length });
    }
    requireValue(!expectedRecords || isDeepStrictEqual([...seen.keys()].sort(), [...expectedRecords].sort()), 'COMPOSITION_EXPECTED_RECORD_SET');
    const recordIds = new Set(seen.keys());
    for (const {manifest: m, manifest_sha256} of packages) {
        for (const attempt of (m.isolation_history ?? []))
            appendUnique(isolationHistory, retainedHistoricalAttempt(attempt));
        for (const attempt of (m.isolated ?? [])) {
            appendUnique(isolationHistory, historicalInputAttempt(attempt, manifest_sha256));
            // A record that has since been qualified supersedes the package-level
            // isolation in the current view, while the attempt remains in history.
            // Multiple attempts for an unresolved ID remain current evidence; they
            // are not collapsed merely because they share a record identity.
            if (typeof attempt.record_id !== 'string' || !recordIds.has(attempt.record_id)) {
                isolated.push(attempt);
            }
        }
    }
    await fs.mkdir(output);
    let variables = 0, pages = 0, maximum_page_bytes = 0;
    for (const directory of inputs) {
        const report = await verifyDictionaryPackage({ directory, expectedFields, expectedIssues, requireSortedRecords: false, onFile: async (file, bytes) => { if (file === 'manifest.json')
                return; const target = path.join(output, file); await fs.mkdir(path.dirname(target), { recursive: true }); try {
                await fs.writeFile(target, bytes, { flag: 'wx' });
            }
            catch (e) {
                if (e.code !== 'EEXIST')
                    throw e;
                requireValue(hash(await fs.readFile(target)) === hash(bytes), 'COMPOSITION_FILE_CONFLICT');
            } } });
        variables += report.fields;
        pages += report.pages;
        maximum_page_bytes = Math.max(maximum_page_bytes, report.maximum_page_bytes);
    }
    records.sort((a, b) => a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0);
    isolated.sort(sortJson);
    isolationHistory.sort(sortJson);
    const manifest = { format: 'ushso.dictionary-review-package.v1', generation, review_status: 'pending_owner_review', publication_authorized: false, canonical_records_changed: 0, source_packages: sources.sort((a, b) => a.manifest_sha256.localeCompare(b.manifest_sha256)), records, isolated, isolation_history: isolationHistory, variables, pages, maximum_page_bytes };
    await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
    return verifyDictionaryPackage({ directory: output, expectedRecords, expectedFields, expectedIssues });
}
