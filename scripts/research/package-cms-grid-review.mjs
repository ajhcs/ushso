import {requireResearchPython} from './research-python.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseGrid } from './cms-grid-parser.mjs';
import { verifyGridBinding } from './cms-grid-binding.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const HEX = /^[a-f0-9]{64}$/;
const exec = promisify(execFile);
async function readBound(file, max = 20 * 1024 * 1024) {
  const stat = await fs.stat(file); if (!stat.isFile() || stat.size > max) throw Error('INPUT_SIZE_LIMIT');
  const bytes = await fs.readFile(file); if (bytes.length > max) throw Error('INPUT_SIZE_LIMIT'); return bytes;
}
async function capture(directory, url) {
  const receipt = JSON.parse(await readBound(path.join(directory, hash(url) + '.json')));
  if (receipt.url !== url || !HEX.test(receipt.sha256)) throw Error('CAPTURE_IDENTITY');
  const bytes = await readBound(path.join(directory, receipt.sha256 + '.body'), 64 * 1024 * 1024);
  if (hash(bytes) !== receipt.sha256) throw Error('CAPTURE_HASH');
  return { ...receipt, data: JSON.parse(bytes) };
}
export function chooseGridContexts(results) {
  const grouped = new Map(), isolated = [], selected = [];
  for (const item of results) {
    if (!item || typeof item.record_id !== 'string') { isolated.push({ record_id: null, code: 'MALFORMED_GRID_ENTRY' }); continue; }
    if (!Number.isSafeInteger(item.variables) || item.variables < 0) { isolated.push({ record_id: item.record_id, code: 'MALFORMED_GRID_ENTRY' }); continue; }
    if (!grouped.has(item.record_id)) grouped.set(item.record_id, []);
    grouped.get(item.record_id).push(item);
  }
  for (const [record_id, items] of grouped) {
    const positive = items.filter(x => x.variables > 0);
    if (!positive.length) { isolated.push({ record_id, code: 'NO_EXTRACTED_GRID_ROWS' }); continue; }
    // Multiple linked release/PDF contexts cannot be collapsed into one schema.
    const contexts = new Set(items.map(x => JSON.stringify([x.pdf_sha256, x.publisher_url, x.release_binding])));
    if (contexts.size !== 1 || positive.length !== 1) { isolated.push({ record_id, code: 'AMBIGUOUS_DICTIONARY_CONTEXT', contexts: contexts.size }); continue; }
    selected.push(positive[0]);
  }
  return { selected, isolated };
}
export async function verifyCmsGridItem(item, { records, generation, gridDirectory, evidenceRoot, catalog }) {
  for (const key of ['pdf_sha256', 'geometry_sha256', 'source_record_sha256', 'baseline_record_sha256']) if (!HEX.test(item[key])) throw Error('GRID_HASH_IDENTITY');
  const record = records.get(item.record_id);
  if (!record || item.generation !== generation || hash(JSON.stringify(record)) !== item.baseline_record_sha256) throw Error('GRID_RECORD_GENERATION');
  const sourceFile = path.resolve(item.source_record_file);
  const allowedFolders = ['cms-documents-v2', 'cms-release-documents'].map(x => path.resolve(evidenceRoot, x));
  if (!allowedFolders.includes(path.dirname(sourceFile)) || !sourceFile.endsWith('.record.json')) throw Error('GRID_SOURCE_LOCATION');
  const sourceBytes = await readBound(sourceFile); if (hash(sourceBytes) !== item.source_record_sha256) throw Error('GRID_SOURCE_HASH');
  const source = JSON.parse(sourceBytes);
  if (source.record_id !== item.record_id || source.record_sha256 !== item.baseline_record_sha256 || source.generation !== generation) throw Error('GRID_SOURCE_RECORD_IDENTITY');
  const docs = source.documents?.filter(doc => doc.status === 'captured_document' && doc.role === 'dictionary'
    && doc.sha256 === item.pdf_sha256 && doc.url === item.publisher_url && doc.resources_pointer === item.resources_pointer
    && isDeepStrictEqual(doc.release_binding ?? source.binding, item.release_binding));
  if (!Array.isArray(docs) || docs.length !== 1) throw Error('GRID_DOCUMENT_CONTEXT');
  const folder = path.dirname(sourceFile), doc = docs[0];
  await verifyGridBinding(source, doc, { generation, originals: records, catalog, capture: url => capture(folder, url) });
  const pdf = await readBound(path.join(folder, item.pdf_sha256 + '.pdf'), 64 * 1024 * 1024);
  if (hash(pdf) !== item.pdf_sha256) throw Error('GRID_PDF_HASH');
  const geometryBytes = await readBound(path.join(gridDirectory, item.pdf_sha256 + '.geometry.json'));
  if (hash(geometryBytes) !== item.geometry_sha256) throw Error('GRID_GEOMETRY_HASH');
  const { stdout } = await exec(requireResearchPython(), ['-I', fileURLToPath(new URL('./cms-grid-extract.py', import.meta.url)), path.join(folder, item.pdf_sha256 + '.pdf')], { timeout: 25000, maxBuffer: 20 * 1024 * 1024 });
  if (hash(stdout) !== item.geometry_sha256) throw Error('GRID_PDF_GEOMETRY_REPLAY');
  const parsed = parseGrid(JSON.parse(geometryBytes));
  const saved = JSON.parse(await readBound(path.join(gridDirectory, item.pdf_sha256 + '.json')));
  if (saved.pdf_sha256 !== item.pdf_sha256 || saved.geometry_sha256 !== item.geometry_sha256
    || !isDeepStrictEqual(saved.variables, parsed.variables) || !isDeepStrictEqual(saved.issues, parsed.issues)
    || saved.status !== parsed.status || parsed.variables.length !== item.variables) throw Error('GRID_PARSE_REPLAY');
  if (!parsed.variables.length) throw Error('NO_EXTRACTED_GRID_ROWS');
  const names = new Set();
  for (const variable of parsed.variables) {
    if (typeof variable.name !== 'string' || !variable.name.trim() || names.has(variable.name)) throw Error('GRID_VARIABLE_IDENTITY');
    names.add(variable.name);
    if (variable.release_applicability !== 'unresolved' || variable.eligible_for_schema_promotion !== false) throw Error('GRID_PROMOTION_BOUNDARY');
  }
  return { record, parsed, doc };
}
export async function packageCmsGridReview({ manifestFile, records, generation, output, evidenceRoot }) {
  const manifestBytes = await readBound(manifestFile), manifest = JSON.parse(manifestBytes);
  if (!Array.isArray(manifest.results) || manifest.scientific_approval !== false || manifest.canonical_records_changed !== 0) throw Error('GRID_MANIFEST_BOUNDARY');
  const catalog = await capture(path.join(evidenceRoot, 'evidence/captures'), 'https://data.cms.gov/data.json');
  const chosen = chooseGridContexts(manifest.results);
  await fs.mkdir(output); await fs.mkdir(path.join(output, 'records')); await fs.mkdir(path.join(output, 'pages'));
  const summary = { format: 'ushso.dictionary-review-package.v1', generation, generated_at: new Date().toISOString(), source_manifest_sha256: hash(manifestBytes),
    review_status: 'pending_owner_review', publication_authorized: false, canonical_records_changed: 0,
    records: [], isolated: chosen.isolated, variables: 0, pages: 0, maximum_page_bytes: 0 };
  for (const item of chosen.selected) {
    try {
      const { record, parsed } = await verifyCmsGridItem(item, { records, generation, gridDirectory: path.dirname(manifestFile), evidenceRoot, catalog });
      const contextHash = hash(JSON.stringify([item.record_id, item.pdf_sha256, item.release_binding]));
      const evidenceId = 'evidence.cms-grid.' + contextHash, provenanceId = 'provenance.cms-grid.' + contextHash;
      const limitations = ['Publisher cell ownership is geometrically extracted, not an approved payload schema or scientific interpretation.',
        'Release applicability, observation unit, measurement units and scientific fitness remain unresolved; no values are inferred from field names.',
        'A captured catalog distribution links this document; that link does not establish that every field applies to that release.',
        'Unparsed pages or rows and description continuation may remain; end of API pagination means packaged rows only.'];
      const context = { publisher_url: item.publisher_url, pdf_sha256: item.pdf_sha256, geometry_sha256: item.geometry_sha256,
        release_binding: item.release_binding, source_record_sha256: item.source_record_sha256, resources_pointer: item.resources_pointer,
        release_applicability: 'unresolved', schema_promotion_authorized: false };
      const pages = []; let page = [];
      async function flush() {
        if (!page.length) return;
        const body = JSON.stringify(page) + '\n', bytes = Buffer.byteLength(body), sha256 = hash(body);
        if (bytes > 65536) throw Error('GRID_PAGE_SIZE');
        await fs.writeFile(path.join(output, 'pages', sha256 + '.json'), body); pages.push({ sha256, bytes, count: page.length }); page = [];
      }
      for (const row of parsed.variables) {
        const variable = { ...row, evidence_ids: [evidenceId], document_context: context };
        if (Buffer.byteLength(JSON.stringify([variable]) + '\n') > 65536) throw Error('GRID_FIELD_SIZE');
        if (page.length === 50 || Buffer.byteLength(JSON.stringify([...page, variable]) + '\n') > 65536) await flush();
        page.push(variable);
      }
      await flush();
      const descriptor = { format: 'ushso.dictionary-review.v1', record_id: record.record_id, generation,
        baseline_record_sha256: item.baseline_record_sha256, source_proposal_sha256: hash(JSON.stringify(item)),
        source_evidence: context, evidence: [{ evidence_id: evidenceId, provenance_ids: [provenanceId], claim: 'Exact named rows replayed from captured publisher PDF cell geometry.', limitations }],
        provenance: [{ provenance_id: provenanceId, locator: item.publisher_url, content_sha256: item.pdf_sha256, geometry_sha256: item.geometry_sha256 }],
        limitations, dictionary_scope: { ...context, parser_status: parsed.status, parser_issues: parsed.issues },
        review_status: 'pending_owner_review', publication_authorized: false, schema_applicability: 'unresolved',
        variable_count: parsed.variables.length, isolated_fields: [], pages };
      const body = JSON.stringify(descriptor) + '\n';
      if (Buffer.byteLength(body) > 262144 || pages.length > 2000) throw Error('GRID_DESCRIPTOR_SIZE');
      const file = 'records/' + hash(record.record_id) + '.json'; await fs.writeFile(path.join(output, file), body);
      summary.records.push({ record_id: record.record_id, file, sha256: hash(body), variables: parsed.variables.length, isolated_fields: 0 });
      summary.variables += parsed.variables.length; summary.pages += pages.length; summary.maximum_page_bytes = Math.max(summary.maximum_page_bytes, ...pages.map(p => p.bytes));
    } catch (error) { summary.isolated.push({ record_id: item.record_id, code: error.message }); }
  }
  const body = JSON.stringify(summary, null, 2) + '\n'; if (Buffer.byteLength(body) > 2 * 1024 * 1024 || summary.records.length > 4000) throw Error('GRID_PACKAGE_SIZE');
  await fs.writeFile(path.join(output, 'manifest.json'), body); return { ...summary, manifest_sha256: hash(body) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestFile, corpusDirectory, output, evidenceRoot] = process.argv.slice(2);
  if (!manifestFile || !corpusDirectory || !output || !evidenceRoot) throw Error('Usage: package-cms-grid-review.mjs GRID_MANIFEST CORPUS_DIRECTORY OUTPUT EVIDENCE_ROOT');
  const corpus = JSON.parse(await readBound(path.join(corpusDirectory, 'corpus.json'))), records = new Map();
  for (const file of corpus.record_files) for (const line of (await readBound(path.join(corpusDirectory, file), 64 * 1024 * 1024)).toString().trim().split('\n')) { const record = JSON.parse(line); records.set(record.record_id, record); }
  const result = await packageCmsGridReview({ manifestFile, records, generation: corpus.publication.generation, output, evidenceRoot });
  console.log(JSON.stringify({ ...result, records: result.records.length, isolated: result.isolated.length }));
}
