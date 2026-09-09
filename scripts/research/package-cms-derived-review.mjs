import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { verifyGridBinding } from './cms-grid-binding.mjs';
import { requireResearchPython } from './research-python.mjs';
import { parseFragmentedGrid } from './cms-grid-fragmented-parser.mjs';
import { parseMcbsPages } from './mcbs-window-parser.mjs';
import { parseCostReportGrid } from './cms-cost-report-grid-parser.mjs';
const hash = b => createHash('sha256').update(b).digest('hex'), exec = promisify(execFile);
async function readBound(file, maximum = 64 * 1024 * 1024) {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > maximum) throw Error('DERIVED_INPUT_SIZE');
    const bytes = await fs.readFile(file);
    if (bytes.length > maximum) throw Error('DERIVED_INPUT_SIZE');
    return bytes;
}
export async function packageCmsDerivedReview({ inputs, records, generation, evidenceRoot, output }) {
    await fs.mkdir(output);
    for (const f of ['records', 'pages', 'qualified-proposals', 'captures', 'issues'])
        await fs.mkdir(path.join(output, f));
    const seen = new Set(), summary = { format: 'ushso.dictionary-review-package.v1', generation, review_status: 'pending_owner_review', publication_authorized: false, canonical_records_changed: 0, records: [], isolated: [], variables: 0, pages: 0, maximum_page_bytes: 0 }, qualified = [];
    async function capture(dir, url) { const m = JSON.parse(await fs.readFile(path.join(dir, hash(url) + '.json'))), bytes = await fs.readFile(path.join(dir, m.sha256 + '.body')); if (m.url !== url || hash(bytes) !== m.sha256)
        throw Error('DERIVED_CAPTURE_HASH'); return { sha256: m.sha256, data: JSON.parse(bytes) }; }
    const catalog = await capture(path.join(evidenceRoot, 'evidence/captures'), 'https://data.cms.gov/data.json');
    for (const input of inputs) {
        if (seen.has(input.record_id))
            throw Error('DERIVED_DUPLICATE_CONTEXT');
        seen.add(input.record_id);
        const bytes = await readBound(input.file);
        if (hash(bytes) !== input.sha256)
            throw Error('DERIVED_PROPOSAL_HASH');
        const p = JSON.parse(bytes), record = records.get(p.record_id);
        if (p.record_id !== input.record_id || !record || p.generation !== generation || p.baseline_record_sha256 !== hash(JSON.stringify(record)) || p.publication_authorized !== false || p.review_status !== 'pending_owner_review')
            throw Error('DERIVED_PROPOSAL_BINDING');
        const sourceFile = path.resolve(p.source_record_file);
        if (!['cms-documents-v2','cms-release-documents'].map(f=>path.resolve(evidenceRoot,f)).includes(path.dirname(sourceFile)) || !sourceFile.endsWith('.record.json')) throw Error('DERIVED_SOURCE_LOCATION');
        const sourceBytes = await readBound(sourceFile, 2 * 1024 * 1024);
        if (hash(sourceBytes) !== p.source_record_sha256)
            throw Error('DERIVED_SOURCE_HASH');
        const source = JSON.parse(sourceBytes), docs = source.documents?.filter(d => d.role === 'dictionary' && d.sha256 === p.pdf_sha256 && d.url === p.publisher_url);
        if (docs?.length !== 1)
            throw Error('DERIVED_DOCUMENT_CONTEXT');
        if (!isDeepStrictEqual(p.release_binding, docs[0].release_binding ?? source.binding))
            throw Error('DERIVED_RELEASE_BINDING');
        const binding = await verifyGridBinding(source, docs[0], { generation, originals: records, catalog, capture: url => capture(path.dirname(p.source_record_file), url) }), pdfFile = path.join(path.dirname(p.source_record_file), p.pdf_sha256 + '.pdf');
        if (hash(await readBound(pdfFile)) !== p.pdf_sha256)
            throw Error('DERIVED_PDF_HASH');
        let stdout, parsed;
        if (input.parser === 'fragmented-grid' || input.parser === 'cost-report-grid') {
            ({stdout} = await exec(requireResearchPython(), ['-I', fileURLToPath(new URL('./cms-grid-extract.py', import.meta.url)), pdfFile], {timeout:25000,maxBuffer:20*1024*1024}));
            if (hash(stdout) !== p.geometry_sha256) throw Error('DERIVED_GEOMETRY_HASH');
            parsed = input.parser === 'cost-report-grid' ? parseCostReportGrid(JSON.parse(stdout)) : parseFragmentedGrid(JSON.parse(stdout));
        } else if (input.parser === 'mcbs-windows') {
            const manifestBytes = await readBound(p.window_manifest_file, 2 * 1024 * 1024);
            if (hash(manifestBytes) !== p.window_manifest_sha256) throw Error('DERIVED_WINDOW_MANIFEST');
            const manifest = JSON.parse(manifestBytes), pages = [];
            const script = fileURLToPath(new URL('./pdf-text-window.py',import.meta.url));
            if (manifest.pdf_sha256 !== p.pdf_sha256 || !manifest.completed || manifest.extractor_sha256 !== hash(await fs.readFile(script))) throw Error('DERIVED_WINDOW_IDENTITY');
            for (const window of manifest.windows) {
                if (window.start_page !== pages.length+1 || !Number.isSafeInteger(window.count) || window.count<1 || window.count>8) throw Error('DERIVED_WINDOW_SEQUENCE');
                const replay = await exec(requireResearchPython(),['-I',script,pdfFile,String(window.start_page),String(window.count)],{timeout:25000,maxBuffer:9*1024*1024});
                if(hash(replay.stdout)!==window.sha256) throw Error('DERIVED_WINDOW_REPLAY');
                pages.push(...JSON.parse(replay.stdout).pages);
            }
            if(pages.length!==manifest.total_pages) throw Error('DERIVED_WINDOW_COUNT');
            parsed = parseMcbsPages(pages); stdout = manifestBytes.toString('utf8');
        } else throw Error('DERIVED_PARSER');
        if (!parsed.variables?.length || !isDeepStrictEqual(parsed.variables.map(v => v.name), input.expected_names))
            throw Error('DERIVED_FIELD_IDENTITY');
        if (input.expected_parsed_sha256 && hash(JSON.stringify(parsed)) !== input.expected_parsed_sha256)
            throw Error('DERIVED_PARSE_REPLAY');
        await fs.writeFile(path.join(output, 'captures', hash(stdout) + '.json'), stdout);
        const isolated = [];
        for (const issue of parsed.issues ?? []) {
            const body = JSON.stringify(issue) + '\n', sha256 = hash(body);
            if (Buffer.byteLength(body) > 65536) throw Error('DERIVED_ISSUE_SIZE');
            const file = 'issues/' + sha256 + '.json';
            await fs.writeFile(path.join(output,file),body);
            const first = issue.source_lines?.[0];
            isolated.push({name:issue.name ?? null,code:issue.code,issue_file:file,issue_sha256:sha256,
                source_locator:first ? {physical_page:first.physical_page,line:first.line} : null});
        }
        const context = { publisher_url: p.publisher_url, pdf_sha256: p.pdf_sha256, extracted_text_sha256: hash(stdout), release_binding: p.release_binding, source_record_sha256: p.source_record_sha256, release_applicability: 'unresolved', schema_promotion_authorized: false }, id = hash(JSON.stringify([p.record_id, context])), eid = 'evidence.cms-derived.' + id, pid = 'provenance.cms-derived.' + id, variables = parsed.variables.map(v => ({ ...v, evidence_ids: [eid], document_context: context, eligible_for_schema_promotion: false })), proposal = { record_id: p.record_id, generation, baseline_record_sha256: p.baseline_record_sha256, source_proposal_sha256: hash(bytes), binding_verification: binding, source_evidence: context, variables, parser_issues: parsed.issues ?? [], isolated_issue_refs: isolated, scientific_approval: false, publication_authorized: false }, qb = JSON.stringify(proposal) + '\n', qfile = 'qualified-proposals/' + hash(p.record_id) + '.json';
        await fs.writeFile(path.join(output, qfile), qb);
        qualified.push({ record_id: p.record_id, file: qfile, sha256: hash(qb), variables: variables.length });
        const pages = [];
        let page = [];
        async function flush() { if (!page.length)
            return; const body = JSON.stringify(page) + '\n', bytes = Buffer.byteLength(body), sha256 = hash(body); if (bytes > 65536)
            throw Error('DERIVED_PAGE_SIZE'); await fs.writeFile(path.join(output, 'pages', sha256 + '.json'), body); pages.push({ sha256, bytes, count: page.length }); page = []; }
        for (const v of variables) {
            if (Buffer.byteLength(JSON.stringify([v]) + '\n') > 65536)
                throw Error('DERIVED_FIELD_SIZE');
            if (page.length === 50 || Buffer.byteLength(JSON.stringify([...page, v]) + '\n') > 65536)
                await flush();
            page.push(v);
        }
        await flush();
        const limitations = ['Partial publisher dictionary extraction only; no payload schema or scientific approval.', 'Release applicability, observation grain, measurement units and scientific fitness remain unresolved.'], descriptor = { format: 'ushso.dictionary-review.v1', record_id: p.record_id, generation, baseline_record_sha256: p.baseline_record_sha256, source_proposal_sha256: hash(qb), source_evidence: context, evidence: [{ evidence_id: eid, provenance_ids: [pid], claim: 'Literal qualified publisher dictionary rows.', limitations }], provenance: [{ provenance_id: pid, locator: p.publisher_url, content_sha256: p.pdf_sha256 }], limitations, review_status: 'pending_owner_review', publication_authorized: false, schema_applicability: 'unresolved', variable_count: variables.length, dictionary_scope: {parser_status:parsed.status, parser_issue_count:isolated.length, issue_count_unit:'parser blocks, not certified unique variables'}, isolated_fields: isolated, pages }, db = JSON.stringify(descriptor) + '\n', file = 'records/' + hash(p.record_id) + '.json';
        if (Buffer.byteLength(db) > 262144)
            throw Error('DERIVED_DESCRIPTOR_SIZE');
        await fs.writeFile(path.join(output, file), db);
        summary.records.push({ record_id: p.record_id, file, sha256: hash(db), variables: variables.length, isolated_fields: isolated.length });
        summary.variables += variables.length;
        summary.pages += pages.length;
        summary.maximum_page_bytes = Math.max(summary.maximum_page_bytes, ...pages.map(p => p.bytes));
    }
    summary.records.sort((a, b) => a.record_id < b.record_id ? -1 : 1);
    await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n');
    await fs.writeFile(path.join(output, 'qualified-inputs.json'), JSON.stringify(qualified, null, 2) + '\n');
    return summary;
}
