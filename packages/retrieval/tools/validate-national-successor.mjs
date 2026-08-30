import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRetrievalEngine } from './retrieval-core.mjs';
import { semanticErrors } from './record-semantics.mjs';
import { PACKAGE_ROOT } from './package-common.mjs';

const root = path.join(PACKAGE_ROOT, 'versions/v1.1.0');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifests/corpus-manifest.json'), 'utf8'));
const corpus = JSON.parse(await fs.readFile(path.join(root, 'corpus/corpus.json'), 'utf8'));
const records = (await fs.readFile(path.join(root, 'corpus/records.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const searchDocuments = (await fs.readFile(path.join(root, 'corpus/search-documents.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const joinRoutes = (await fs.readFile(path.join(root, 'corpus/join-routes.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const vocabulary = JSON.parse(await fs.readFile(path.join(root, 'fixtures/controlled-vocabulary.json'), 'utf8'));
const readiness = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'readiness/v0.1.0/state-readiness.json'), 'utf8'));
const failures = [];

for (const file of manifest.files) {
  const content = await fs.readFile(path.join(root, file.path));
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  if (content.byteLength !== file.bytes) failures.push(`byte mismatch:${file.path}`);
  if (hash !== file.sha256) failures.push(`hash mismatch:${file.path}`);
}
if (corpus.corpus_version !== '1.1.0') failures.push('corpus version mismatch');
if (records.length !== corpus.record_count) failures.push('record count mismatch');
if (searchDocuments.length !== records.length) failures.push('search document count mismatch');
if (corpus.source_slices.national_federal_backbone_live_validated !== 14) failures.push('federal slice mismatch');
if (new Set(records.map((record) => record.record_id)).size !== records.length) failures.push('duplicate record id');
for (const record of records) {
  const errors = semanticErrors(record);
  if (errors.length) failures.push(`semantic:${record.record_id}:${errors.join('|')}`);
}
const engine = createRetrievalEngine({ records, searchDocuments, joinRoutes, vocabulary, corpus });
for (const state of readiness.states) {
  const result = engine.retrieve({ question: `hospital financial and utilization data in ${state.name}`, limit: 50 });
  const geographyCodes = result.query.interpretation.geographies.map((item) => item.id);
  if (!geographyCodes.includes(`US-${state.postal}`)) failures.push(`state recognition:${state.postal}`);
  if (!result.results.some((item) => item.record_id.startsWith('us-federal:'))) failures.push(`federal baseline retrieval:${state.postal}`);
}

process.stdout.write(`${JSON.stringify({ status: failures.length ? 'FAIL' : 'PASS', records: records.length, federal_records: corpus.source_slices.national_federal_backbone_live_validated, national_query_checks: readiness.states.length, manifest_files: manifest.files.length, failures }, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
