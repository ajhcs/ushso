import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRetrievalEngine } from './retrieval-core.mjs';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, relativePath), 'utf8'));
}

async function readJsonl(relativePath, maxBytes = 16 * 1024 * 1024) {
  const filePath = path.join(PACKAGE_ROOT, relativePath);
  const stats = await fs.stat(filePath);
  if (stats.size > maxBytes) throw new Error(`bounded fixture loader refuses ${relativePath}: ${stats.size} bytes exceeds ${maxBytes}`);
  const text = await fs.readFile(filePath, 'utf8');
  return text.trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${relativePath}:${index + 1}: ${error.message}`); }
  });
}

export async function loadPublishedCorpus() {
  const [records, searchDocuments, joinRoutes, vocabulary, corpus] = await Promise.all([
    readJsonl('corpus/records.jsonl'),
    readJsonl('corpus/search-documents.jsonl'),
    readJsonl('corpus/join-routes.jsonl'),
    readJson('fixtures/controlled-vocabulary.json'),
    readJson('corpus/corpus.json')
  ]);
  return { records, searchDocuments, joinRoutes, vocabulary, corpus };
}

export async function createPublishedEngine() {
  return createRetrievalEngine(await loadPublishedCorpus());
}
