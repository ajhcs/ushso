import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyDictionaryProposal } from './dictionary-proposal-verification.mjs';
import { packageFieldSupplement } from './dictionary-field-supplements.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const PAGE_BYTES = 64 * 1024, DESCRIPTOR_BYTES = 256 * 1024;
export async function packageDictionaryReview({ manifestFile, records, generation, output, captureDirectory }) {
  const manifestBytes = await fs.readFile(manifestFile), manifest = JSON.parse(manifestBytes);
  if (manifest.generation !== generation || manifest.publication_authorized !== false || manifest.review_status !== 'pending_owner_review') throw Error('PROPOSAL_MANIFEST_BINDING');
  if (!Array.isArray(manifest.index)) throw Error('PROPOSAL_MANIFEST_SHAPE');
  await fs.mkdir(output); // Refuse existing output: an isolated rerun cannot leave stale successful records.
  await fs.mkdir(path.join(output, 'records'), { recursive: true });
  await fs.mkdir(path.join(output, 'pages'), { recursive: true });
  const summary = { format: 'ushso.dictionary-review-package.v1', generation, generated_at: new Date().toISOString(),
    source_manifest_sha256: hash(manifestBytes), review_status: 'pending_owner_review', publication_authorized: false,
    canonical_records_changed: 0, records: [], isolated: [], variables: 0, pages: 0, maximum_page_bytes: 0 };
  const counts = new Map();
  for (const item of manifest.index) if (typeof item?.record_id === 'string') counts.set(item.record_id, (counts.get(item.record_id) ?? 0) + 1);
  for (const item of manifest.index) {
    try {
      if (!item || typeof item.record_id !== 'string') throw Error('MALFORMED_INDEX_ENTRY');
      if (counts.get(item.record_id) !== 1) throw Error('DUPLICATE_RECORD');
      const record = records.get(item.record_id); if (!record) throw Error('RECORD_NOT_IN_GENERATION');
      // Each proposal is a bounded build-time input; large dictionaries are not loaded in the Worker.
      const stat = await fs.stat(item.file); if (stat.size > 64 * 1024 * 1024) throw Error('PROPOSAL_SIZE_LIMIT');
      const bytes = await fs.readFile(item.file); if (hash(bytes) !== item.sha256) throw Error('PROPOSAL_HASH');
      const proposal = JSON.parse(bytes), dictionary = proposal.changes?.find(c => c.path === '/variable_documentation')?.after;
      if (proposal.record_id !== item.record_id || proposal.baseline_record_sha256 !== hash(JSON.stringify(record))
        || proposal.review_status !== 'pending_owner_review' || proposal.publication_authorized !== false
        || !Array.isArray(dictionary?.variables) || dictionary.variables.length !== item.variables
        || !proposal.source_evidence?.url || !/^[a-f0-9]{64}$/.test(proposal.source_evidence.capture_sha256)) throw Error('PROPOSAL_BINDING');
      const evidenceContext = await verifyDictionaryProposal(proposal, record, generation, captureDirectory);
      const pages = [], isolated = [], supplements = [], names = new Set(); let page = [];
      async function flush() {
        if (!page.length) return;
        const body = JSON.stringify(page) + '\n', sha256 = hash(body);
        if (Buffer.byteLength(body) > PAGE_BYTES) throw Error('PAGE_SIZE_LIMIT');
        await fs.writeFile(path.join(output, 'pages', sha256 + '.json'), body);
        pages.push({ sha256, count: page.length, bytes: Buffer.byteLength(body) }); page = [];
      }
      for (let variable of dictionary.variables) {
        if (!variable || typeof variable.name !== 'string' || !variable.name.trim() || names.has(variable.name)) throw Error('VARIABLE_IDENTITY');
        names.add(variable.name);
        if (Buffer.byteLength(JSON.stringify([variable]) + '\n') > PAGE_BYTES) {
          const supplement = await packageFieldSupplement(variable, output); supplements.push(supplement.binding); variable = supplement.stub;
          if (Buffer.byteLength(JSON.stringify([variable]) + '\n') > PAGE_BYTES) throw Error('FIELD_STUB_SIZE');
        }
        if (page.length === 50 || Buffer.byteLength(JSON.stringify([...page, variable]) + '\n') > PAGE_BYTES) await flush();
        page.push(variable);
      }
      await flush();
      const descriptor = { format: 'ushso.dictionary-review.v1', record_id: record.record_id, generation,
        baseline_record_sha256: proposal.baseline_record_sha256, source_proposal_sha256: item.sha256,
        source_evidence: proposal.source_evidence, ...evidenceContext, review_status: 'pending_owner_review', publication_authorized: false,
        schema_applicability: 'unresolved', variable_count: pages.reduce((n, p) => n + p.count, 0), isolated_fields: isolated, supplements, full_field_count: dictionary.variables.length, supplemental_field_count: supplements.length, pages };
      const body = JSON.stringify(descriptor) + '\n';
      if (Buffer.byteLength(body) > DESCRIPTOR_BYTES || pages.length > 2000 || isolated.length > 2000) throw Error('DESCRIPTOR_SIZE_LIMIT');
      const file = `records/${hash(record.record_id)}.json`;
      await fs.writeFile(path.join(output, file), body);
      summary.records.push({ record_id: record.record_id, file, sha256: hash(body), variables: descriptor.variable_count, isolated_fields: isolated.length, full_fields: dictionary.variables.length, supplemental_fields: supplements.length });
      summary.variables += descriptor.variable_count; summary.pages += pages.length;
      summary.maximum_page_bytes = Math.max(summary.maximum_page_bytes, ...pages.map(p => p.bytes));
    } catch (error) { summary.isolated.push({ record_id: item?.record_id ?? null, code: error.message }); }
  }
  const manifestBody = JSON.stringify(summary, null, 2) + '\n';
  if (Buffer.byteLength(manifestBody) > 2 * 1024 * 1024 || summary.records.length > 4000) throw Error('PACKAGE_MANIFEST_SIZE');
  await fs.writeFile(path.join(output, 'manifest.json'), manifestBody);
  return summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestFile, corpusDirectory, output, captureDirectory] = process.argv.slice(2);
  if (!manifestFile || !corpusDirectory || !output || !captureDirectory) throw Error('Usage: package-dictionary-review.mjs PROPOSAL_MANIFEST CORPUS_DIRECTORY OUTPUT_DIRECTORY CAPTURE_DIRECTORY');
  const corpus = JSON.parse(await fs.readFile(path.join(corpusDirectory, 'corpus.json'))), records = new Map();
  for (const file of corpus.record_files) for (const line of (await fs.readFile(path.join(corpusDirectory, file), 'utf8')).trim().split('\n')) { const record = JSON.parse(line); records.set(record.record_id, record); }
  const summary = await packageDictionaryReview({ manifestFile, records, generation: corpus.publication.generation, output, captureDirectory });
  console.log(JSON.stringify({ ...summary, records: summary.records.length }));
}
