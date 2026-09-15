#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LAST_GOOD_GENERATION } from './ingest-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEAD = '5915725e40d55f6afc6e7dac90b259e038e6381e';
const TREE = 'e8200a5b1921b33529be044ef43ec011623c78a1';
const CORPUS_REL = 'packages/retrieval/versions/v1.2.0/corpus';

function sha256File(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

async function indexCorpus(repoRoot) {
  const corpus = JSON.parse(readFileSync(path.join(repoRoot, CORPUS_REL, 'corpus.json'), 'utf8'));
  const index = new Map();
  for (const rel of corpus.record_files) {
    const fileRel = `${CORPUS_REL}/${rel}`;
    const abs = path.join(repoRoot, fileRel);
    const fileSha = sha256File(abs);
    const rl = readline.createInterface({ input: createReadStream(abs, { encoding: 'utf8' }), crlfDelay: Infinity });
    let line = 0;
    for await (const text of rl) {
      line += 1;
      if (!text.trim()) continue;
      const rec = JSON.parse(text);
      index.set(rec.record_id, { fileRel, line, fileSha, rec, bytes: Buffer.byteLength(text) });
    }
  }
  return { corpus, index };
}

function recipeFor(product, rec, fileRel, line) {
  return [
    `Read frozen catalog metadata at ${fileRel} line ${line} for record ${rec.record_id}.`,
    'Do not request dataset rows, files, query results, or restricted payloads.',
    rec.access?.restriction_note ?? 'Dataset contents were not executed.',
  ].join(' ');
}

export async function buildCatalogMetadataReceipts({ repoRoot = ROOT } = {}) {
  const { index } = await indexCorpus(repoRoot);
  const cohorts = JSON.parse(readFileSync(path.join(repoRoot, 'evaluation/research-program/cohorts.json'), 'utf8'));
  const receipts = [];
  const unresolved = [];
  for (const product of cohorts.products) {
    const rid = product.anchor?.representative?.record_id ?? null;
    const status = product.anchor?.status;
    if (status !== 'resolved_catalog_record' || !rid || !index.has(rid)) {
      unresolved.push({
        product_key: product.product_key,
        access_expectation: product.access_expectation,
        anchor_status: status ?? null,
        record_id: rid,
        reason: status === 'named_intake' ? 'named_intake_unverified_locator' : 'catalog_record_not_in_frozen_corpus',
      });
      continue;
    }
    const hit = index.get(rid);
    const rec = hit.rec;
    const payloadBase = {
      product_key: product.product_key,
      record_id: rec.record_id,
      live_http: false,
      bounded_sample: false,
      verified_route: false,
      recipe: recipeFor(product, rec, hit.fileRel, hit.line),
    };
    const fields = [
      {
        field: 'publisher_access',
        supported: false,
        unknown: false,
        status: 'catalog_metadata_only',
        limitation: rec.access?.restriction_note ?? 'Dataset contents, authorization, and payload retrieval were not executed.',
      },
      {
        field: 'schema_qualification',
        supported: false,
        unknown: false,
        status: 'observatory_record_schema_only',
        limitation: `Frozen record schema_version=${rec.schema_version ?? 'absent'} is the observatory envelope, not a qualified publisher data dictionary or payload schema.`,
      },
      {
        field: 'join_route',
        supported: false,
        unknown: false,
        status: rec.join_compatibility?.state ?? 'none_known',
        limitation: (rec.join_compatibility?.notes ?? []).join(' ') || 'No cross-source identity or join route is inferred from catalog metadata alone.',
      },
      {
        field: 'unit_grain_date_denominator',
        supported: false,
        unknown: false,
        status: 'catalog_metadata_not_payload_denominator',
        limitation: 'Unit/geography/time fields exist on the catalog record. Coverage level and temporal granularity remain unknown. This is not a payload denominator.',
      },
    ];
    for (const field of fields) {
      receipts.push({
        format: 'ushso.evidence-receipt.v1',
        receipt_id: `core-cell-${product.product_key}-${field.field}`,
        kind: 'core_cell',
        generation: LAST_GOOD_GENERATION,
        candidate_head: HEAD,
        candidate_tree: TREE,
        recorded_at: '2026-09-15T14:30:00Z',
        evidence_reference: hit.fileRel,
        evidence_sha256: hit.fileSha,
        payload: { ...payloadBase, ...field },
      });
    }
  }
  return { receipts, unresolved };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { receipts, unresolved } = await buildCatalogMetadataReceipts();
  const dir = path.join(ROOT, 'verification/research-program/evidence/receipts');
  mkdirSync(dir, { recursive: true });
  const bundle = {
    format: 'ushso.core-cell-receipt-bundle.v1',
    generation: LAST_GOOD_GENERATION,
    candidate_head: HEAD,
    note: 'Catalog-metadata receipts only. Dataset payloads were not executed. R04 remains unaccepted.',
    receipt_count: receipts.length,
    unresolved_products: unresolved,
    live_http: false,
  };
  writeFileSync(path.join(dir, 'core-cell-catalog-metadata.json'), `${JSON.stringify({ ...bundle, receipts }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ receipt_count: receipts.length, unresolved: unresolved.length, products_covered: receipts.length / 4 }, null, 2)}\n`);
}
