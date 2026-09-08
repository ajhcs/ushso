import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { verifyGridBinding } from './cms-grid-binding.mjs';
import { requireResearchPython } from './research-python.mjs';
import { parseTypedLayout } from './cms-typed-layout.mjs';
import { parseVariableLayout } from './cms-variable-layout.mjs';
import { parseCmsDictionary } from './cms-dictionary-parser.mjs';
const hash = b => createHash('sha256').update(b).digest('hex'), exec = promisify(execFile);
export async function packageCmsLegacyReview({ inputs, records, generation, evidenceRoot, output }) {
    await fs.mkdir(output);
    for (const f of ['records', 'pages', 'qualified-proposals', 'captures'])
        await fs.mkdir(path.join(output, f));
    const seen = new Set(), summary = { format: 'ushso.dictionary-review-package.v1', generation, review_status: 'pending_owner_review', publication_authorized: false, canonical_records_changed: 0, records: [], isolated: [], variables: 0, pages: 0, maximum_page_bytes: 0 }, qualified = [];
    async function capture(dir, url) { const m = JSON.parse(await fs.readFile(path.join(dir, hash(url) + '.json'))), bytes = await fs.readFile(path.join(dir, m.sha256 + '.body')); if (m.url !== url || hash(bytes) !== m.sha256)
        throw Error('LEGACY_CAPTURE_HASH'); return { sha256: m.sha256, data: JSON.parse(bytes) }; }
    const catalog = await capture(path.join(evidenceRoot, 'evidence/captures'), 'https://data.cms.gov/data.json');
    for (const input of inputs) {
        if (seen.has(input.record_id))
            throw Error('LEGACY_DUPLICATE_CONTEXT');
        seen.add(input.record_id);
        const bytes = await fs.readFile(input.file);
        if (hash(bytes) !== input.sha256)
            throw Error('LEGACY_PROPOSAL_HASH');
        const p = JSON.parse(bytes), record = records.get(p.record_id);
        if (p.record_id !== input.record_id || !record || p.generation !== generation || p.baseline_record_sha256 !== hash(JSON.stringify(record)) || p.publication_authorized !== false || p.review_status !== 'pending_owner_review')
            throw Error('LEGACY_PROPOSAL_BINDING');
        const sourceBytes = await fs.readFile(p.source_record_file);
        if (hash(sourceBytes) !== p.source_record_sha256)
            throw Error('LEGACY_SOURCE_HASH');
        const source = JSON.parse(sourceBytes), docs = source.documents?.filter(d => d.role === 'dictionary' && d.sha256 === p.pdf_sha256 && d.url === p.publisher_url);
        if (docs?.length !== 1)
            throw Error('LEGACY_DOCUMENT_CONTEXT');
        const binding = await verifyGridBinding(source, docs[0], { generation, originals: records, catalog, capture: url => capture(path.dirname(p.source_record_file), url) }), pdfFile = path.join(path.dirname(p.source_record_file), p.pdf_sha256 + '.pdf');
        if (hash(await fs.readFile(pdfFile)) !== p.pdf_sha256)
            throw Error('LEGACY_PDF_HASH');
        const plain = input.parser === 'plaintext', script = plain ? 'pdf-text.py' : 'pdf-layout.py', { stdout } = await exec(requireResearchPython(), ['-I', fileURLToPath(new URL('./' + script, import.meta.url)), pdfFile], { timeout: 25000, maxBuffer: 20 * 1024 * 1024 }), document = JSON.parse(stdout), parsed = plain ? parseCmsDictionary(document, p.pdf_sha256) : (input.parser === 'typed' ? parseTypedLayout(document) : input.parser === 'variable' ? parseVariableLayout(document) : (() => { throw Error('LEGACY_PARSER'); })());
        if (!parsed.variables?.length || !isDeepStrictEqual(parsed.variables.map(v => v.name), input.expected_names))
            throw Error('LEGACY_FIELD_IDENTITY');
        if (input.expected_parsed_sha256 && hash(JSON.stringify(parsed)) !== input.expected_parsed_sha256)
            throw Error('LEGACY_PARSE_REPLAY');
        await fs.writeFile(path.join(output, 'captures', hash(stdout) + '.json'), stdout);
        const context = { publisher_url: p.publisher_url, pdf_sha256: p.pdf_sha256, extracted_text_sha256: hash(stdout), release_binding: p.release_binding, source_record_sha256: p.source_record_sha256, release_applicability: 'unresolved', schema_promotion_authorized: false }, id = hash(JSON.stringify([p.record_id, context])), eid = 'evidence.cms-legacy.' + id, pid = 'provenance.cms-legacy.' + id, variables = parsed.variables.map(v => ({ ...v, evidence_ids: [eid], document_context: context, eligible_for_schema_promotion: false })), proposal = { record_id: p.record_id, generation, baseline_record_sha256: p.baseline_record_sha256, source_proposal_sha256: hash(bytes), binding_verification: binding, source_evidence: context, variables, scientific_approval: false, publication_authorized: false }, qb = JSON.stringify(proposal) + '\n', qfile = 'qualified-proposals/' + hash(p.record_id) + '.json';
        await fs.writeFile(path.join(output, qfile), qb);
        qualified.push({ record_id: p.record_id, file: qfile, sha256: hash(qb), variables: variables.length });
        const pages = [];
        let page = [];
        async function flush() { if (!page.length)
            return; const body = JSON.stringify(page) + '\n', bytes = Buffer.byteLength(body), sha256 = hash(body); if (bytes > 65536)
            throw Error('LEGACY_PAGE_SIZE'); await fs.writeFile(path.join(output, 'pages', sha256 + '.json'), body); pages.push({ sha256, bytes, count: page.length }); page = []; }
        for (const v of variables) {
            if (Buffer.byteLength(JSON.stringify([v]) + '\n') > 65536)
                throw Error('LEGACY_FIELD_SIZE');
            if (page.length === 50 || Buffer.byteLength(JSON.stringify([...page, v]) + '\n') > 65536)
                await flush();
            page.push(v);
        }
        await flush();
        const limitations = ['Partial publisher dictionary extraction only; no payload schema or scientific approval.', 'Release applicability, observation grain, measurement units and scientific fitness remain unresolved.'], descriptor = { format: 'ushso.dictionary-review.v1', record_id: p.record_id, generation, baseline_record_sha256: p.baseline_record_sha256, source_proposal_sha256: hash(qb), source_evidence: context, evidence: [{ evidence_id: eid, provenance_ids: [pid], claim: 'Literal qualified publisher dictionary rows.', limitations }], provenance: [{ provenance_id: pid, locator: p.publisher_url, content_sha256: p.pdf_sha256 }], limitations, review_status: 'pending_owner_review', publication_authorized: false, schema_applicability: 'unresolved', variable_count: variables.length, isolated_fields: [], pages }, db = JSON.stringify(descriptor) + '\n', file = 'records/' + hash(p.record_id) + '.json';
        if (Buffer.byteLength(db) > 262144)
            throw Error('LEGACY_DESCRIPTOR_SIZE');
        await fs.writeFile(path.join(output, file), db);
        summary.records.push({ record_id: p.record_id, file, sha256: hash(db), variables: variables.length, isolated_fields: 0 });
        summary.variables += variables.length;
        summary.pages += pages.length;
        summary.maximum_page_bytes = Math.max(summary.maximum_page_bytes, ...pages.map(p => p.bytes));
    }
    summary.records.sort((a, b) => a.record_id < b.record_id ? -1 : 1);
    await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n');
    await fs.writeFile(path.join(output, 'qualified-inputs.json'), JSON.stringify(qualified, null, 2) + '\n');
    return summary;
}
