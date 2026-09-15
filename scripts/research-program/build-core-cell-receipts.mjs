#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LAST_GOOD_GENERATION } from './ingest-evidence.mjs';
import { bindCmsCatalogResources, retainedCatalogCapture, sha256Text } from '../research/cms-documents.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEAD = '9f96b491cdf0c9654ff1366e5ff81cd173b27a26';
const TREE = '5e02bd2ff2ebdcbed19d1d9e050b5b7745955dfc';
const CORPUS_REL = 'packages/retrieval/versions/v1.2.0/corpus';
const CMS_CATALOG_REL = 'verification/research-program/pr-013/fixtures/cms-catalog-slim.json.gz';

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

function loadCmsCatalog(repoRoot) {
  const abs = path.join(repoRoot, CMS_CATALOG_REL);
  const gzipBytes = readFileSync(abs);
  const text = gunzipSync(gzipBytes).toString('utf8');
  const capture = retainedCatalogCapture({
    url: 'https://data.cms.gov/data.json',
    status: 'captured',
    sha256: sha256Text(text),
    text,
    data: JSON.parse(text),
  });
  return {
    capture,
    fileSha: sha256File(abs),
    uncompressedSha: capture.sha256,
    payloadSuccess: capture.payload_success === true,
  };
}

function overlayCmsDistribution(receipt, bound, cmsCatalog) {
  if (receipt.payload.field !== 'publisher_access') return receipt;
  const roles = {};
  for (const distribution of bound.distributions ?? []) {
    roles[distribution.role] = (roles[distribution.role] ?? 0) + 1;
  }
  const locators = (bound.unique_locators ?? []).slice(0, 3).map((item) => `${item.kind}:${item.locator}`);
  const recipe = [
    receipt.payload.recipe,
    `Overlay frozen CMS catalog-slim ${CMS_CATALOG_REL} (gzip sha256=${cmsCatalog.fileSha}; uncompressed catalog sha256=${cmsCatalog.uncompressedSha}).`,
    `Bound ${bound.distributions.length} distribution records (roles=${JSON.stringify(roles)}). Sample locators: ${locators.join('; ') || 'none'}.`,
    'Do not fetch accessURL, downloadURL, or resourcesAPI. payload_success remains false.',
  ].join(' ');
  return {
    ...receipt,
    evidence_reference: CMS_CATALOG_REL,
    evidence_sha256: cmsCatalog.fileSha,
    payload: {
      ...receipt.payload,
      status: 'catalog_distribution_locators_not_payload',
      recipe,
      limitation: 'CMS catalog-slim locators are catalog metadata. Dataset contents, authorization, and payload retrieval were not executed. payload_success=false.',
      payload_success: false,
      distribution_count: bound.distributions.length,
      distribution_roles: roles,
    },
  };
}

export async function buildCatalogMetadataReceipts({ repoRoot = ROOT } = {}) {
  const { index } = await indexCorpus(repoRoot);
  const cohorts = JSON.parse(readFileSync(path.join(repoRoot, 'evaluation/research-program/cohorts.json'), 'utf8'));
  const cmsCatalog = loadCmsCatalog(repoRoot);
  if (cmsCatalog.payloadSuccess) throw new Error('CMS_CATALOG_SLIM_CANNOT_COUNT_AS_PAYLOAD');
  const receipts = [];
  const unresolved = [];
  const cmsBound = [];
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
      let receipt = {
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
      };
      if (rec.identity?.source?.source_id === 'cms-data-catalog' && field.field === 'publisher_access') {
        const bound = bindCmsCatalogResources(rec, cmsCatalog.capture);
        receipt = overlayCmsDistribution(receipt, bound, cmsCatalog);
        cmsBound.push({
          product_key: product.product_key,
          record_id: rec.record_id,
          distribution_count: bound.distributions.length,
          payload_success: false,
        });
      }
      receipts.push(receipt);
    }
  }
  return { receipts, unresolved, cmsBound, cmsCatalog };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { receipts, unresolved, cmsBound, cmsCatalog } = await buildCatalogMetadataReceipts();
  const dir = path.join(ROOT, 'verification/research-program/evidence/receipts');
  mkdirSync(dir, { recursive: true });
  const bundle = {
    format: 'ushso.core-cell-receipt-bundle.v1',
    generation: LAST_GOOD_GENERATION,
    candidate_head: HEAD,
    note: 'Catalog-metadata receipts only. CMS catalog-slim locators overlay publisher_access for 63 products. Dataset payloads were not executed. R04 remains unaccepted.',
    receipt_count: receipts.length,
    unresolved_products: unresolved,
    cms_distribution_products: cmsBound.length,
    cms_catalog_gzip_sha256: cmsCatalog.fileSha,
    cms_catalog_uncompressed_sha256: cmsCatalog.uncompressedSha,
    live_http: false,
  };
  writeFileSync(path.join(dir, 'core-cell-catalog-metadata.json'), `${JSON.stringify({ ...bundle, receipts }, null, 2)}\n`);
  writeFileSync(path.join(ROOT, 'verification/research-program/evidence/cms-distribution-locator-summary.json'), `${JSON.stringify({
    format: 'ushso.cms-distribution-locator-summary.v1',
    generation: LAST_GOOD_GENERATION,
    evidence_reference: CMS_CATALOG_REL,
    evidence_sha256: cmsCatalog.fileSha,
    uncompressed_catalog_sha256: cmsCatalog.uncompressedSha,
    products_bound: cmsBound.length,
    payload_success: false,
    bounded_sample: false,
    live_http: false,
    products: cmsBound,
    note: 'Distribution locators are not payload samples.',
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ receipt_count: receipts.length, unresolved: unresolved.length, products_covered: receipts.length / 4, cms_bound: cmsBound.length }, null, 2)}\n`);
}
