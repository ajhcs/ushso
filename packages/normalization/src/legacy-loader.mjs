import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from '../../../contracts/core/v2.0.0/tools/common.mjs';
import {
  EXPECTED_JOIN_ROUTE_COUNT, EXPECTED_RECORD_COUNT, EXPECTED_SEARCH_DOCUMENT_COUNT,
  SOURCE_CONTENT_FINGERPRINT, SOURCE_CORPUS_SHA256, SOURCE_CORPUS_VERSION, SOURCE_JOIN_ROUTES_SHA256,
  SOURCE_MANIFEST_FILE_SHA256, SOURCE_RECORDS_SHA256, SOURCE_SEARCH_DOCUMENTS_SHA256
} from './constants.mjs';

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const LEGACY_ROOT = path.join(REPOSITORY_ROOT, 'packages/retrieval/versions/v1.1.0');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function readJsonl(file) {
  const text = await readFile(file, 'utf8');
  if (!text.endsWith('\n')) throw new Error(`JSONL_FINAL_NEWLINE_REQUIRED:${path.relative(REPOSITORY_ROOT, file)}`);
  return text.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`JSONL_PARSE_ERROR:${path.basename(file)}:${index + 1}:${error.message}`); }
  });
}

function unique(rows, field, label) {
  const values = rows.map(row => row[field]);
  if (values.some(value => typeof value !== 'string' || value.length === 0)) throw new Error(`${label}_ID_REQUIRED`);
  if (new Set(values).size !== values.length) throw new Error(`${label}_ID_DUPLICATE`);
}

export async function loadLegacyCorpus() {
  const files = {
    manifest: path.join(LEGACY_ROOT, 'manifests/corpus-manifest.json'),
    corpus: path.join(LEGACY_ROOT, 'corpus/corpus.json'),
    records: path.join(LEGACY_ROOT, 'corpus/records.jsonl'),
    searchDocuments: path.join(LEGACY_ROOT, 'corpus/search-documents.jsonl'),
    joinRoutes: path.join(LEGACY_ROOT, 'corpus/join-routes.jsonl')
  };
  const hashes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => [name, await sha256File(file)])));
  const expected = {
    manifest: SOURCE_MANIFEST_FILE_SHA256,
    corpus: SOURCE_CORPUS_SHA256,
    records: SOURCE_RECORDS_SHA256,
    searchDocuments: SOURCE_SEARCH_DOCUMENTS_SHA256,
    joinRoutes: SOURCE_JOIN_ROUTES_SHA256
  };
  for (const [name, digest] of Object.entries(expected)) if (hashes[name] !== digest) throw new Error(`LEGACY_SOURCE_HASH_MISMATCH:${name}:${hashes[name]}`);

  const [manifest, corpus, records, searchDocuments, joinRoutes] = await Promise.all([
    readJson(files.manifest), readJson(files.corpus), readJsonl(files.records), readJsonl(files.searchDocuments), readJsonl(files.joinRoutes)
  ]);
  if (manifest.corpus_version !== SOURCE_CORPUS_VERSION || corpus.corpus_version !== SOURCE_CORPUS_VERSION) throw new Error('LEGACY_CORPUS_VERSION_MISMATCH');
  if (manifest.content_fingerprint_sha256 !== SOURCE_CONTENT_FINGERPRINT || corpus.manifest_sha256 !== SOURCE_CONTENT_FINGERPRINT) throw new Error('LEGACY_CONTENT_FINGERPRINT_MISMATCH');
  const manifestFileHashes = new Map(manifest.files?.map(entry => [entry.path, entry.sha256]) ?? []);
  for (const [name, manifestPath] of Object.entries({
    corpus: 'corpus/corpus.json', records: 'corpus/records.jsonl',
    searchDocuments: 'corpus/search-documents.jsonl', joinRoutes: 'corpus/join-routes.jsonl'
  })) {
    if (manifestFileHashes.get(manifestPath) !== hashes[name]) throw new Error(`LEGACY_MANIFEST_FILE_HASH_MISMATCH:${name}`);
  }
  if (records.length !== EXPECTED_RECORD_COUNT || searchDocuments.length !== EXPECTED_SEARCH_DOCUMENT_COUNT || joinRoutes.length !== EXPECTED_JOIN_ROUTE_COUNT) throw new Error('LEGACY_CORPUS_COUNT_MISMATCH');
  unique(records, 'record_id', 'RECORD');
  unique(searchDocuments, 'search_document_id', 'SEARCH_DOCUMENT');
  unique(joinRoutes, 'route_id', 'JOIN_ROUTE');
  const recordIds = new Set(records.map(row => row.record_id));
  for (const document of searchDocuments) if (!recordIds.has(document.resource_record_id)) throw new Error(`SEARCH_DOCUMENT_RECORD_MISSING:${document.search_document_id}`);
  for (const route of joinRoutes) {
    if (!recordIds.has(route.from_record_id) || !recordIds.has(route.to_record_id)) throw new Error(`JOIN_ROUTE_RECORD_MISSING:${route.route_id}`);
  }
  return Object.freeze({ manifest, corpus, records, searchDocuments, joinRoutes, hashes, files });
}
