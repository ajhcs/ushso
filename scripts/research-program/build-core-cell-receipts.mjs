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
const CDC_VIEW_INDEX_REL = 'verification/research-program/pr-014/fixtures/cdc-view-index.json.gz';
const COHORTS_REL = 'evaluation/research-program/cohorts.json';

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

function loadCdcViewIndex(repoRoot) {
  const abs = path.join(repoRoot, CDC_VIEW_INDEX_REL);
  const gzipBytes = readFileSync(abs);
  const text = gunzipSync(gzipBytes).toString('utf8');
  const data = JSON.parse(text);
  const byNative = new Map((data.views ?? []).map((view) => [view.source_native_id, view]));
  const byRecord = new Map((data.views ?? []).map((view) => [view.record_id, view]));
  return {
    data,
    fileSha: sha256File(abs),
    uncompressedSha: createHash('sha256').update(text).digest('hex'),
    byNative,
    byRecord,
  };
}

function namedIntakeReceipts(product, cohortsSha) {
  const intake = product.anchor?.intake ?? {};
  const limits = Array.isArray(product.anchor?.unresolved_identity_limits)
    ? product.anchor.unresolved_identity_limits.join(' ')
    : 'Named intake only.';
  const locator = typeof intake.locator === 'string' ? intake.locator : null;
  const recipe = [
    `Read frozen named-intake locator for ${product.product_key} from ${COHORTS_REL} (sha256=${cohortsSha}).`,
    locator
      ? `Recorded locator_kind=${intake.locator_kind ?? 'unknown'} locator_status=${intake.locator_status ?? 'unknown'} locator=${locator}.`
      : 'No locator string is present.',
    'Do not fetch the locator. An unverified locator is not publisher access, a verified restricted route, or a bounded payload sample.',
    limits,
  ].join(' ');
  const limitation = [
    'Named-intake locators in frozen cohorts.json are unverified. They were not fetched, captured, or proven current.',
    'This is not a verified restricted/manual route and not a bounded payload sample.',
    limits,
  ].join(' ');
  const fields = [
    {
      field: 'publisher_access',
      status: 'named_intake_unverified_locator',
      limitation,
    },
    {
      field: 'schema_qualification',
      status: 'named_intake_no_publisher_schema',
      limitation: 'No publisher schema or dictionary is bound. Named intake is not schema qualification.',
    },
    {
      field: 'join_route',
      status: 'named_intake_no_join_route',
      limitation: 'No independently qualified join route is inferred from an unverified locator.',
    },
    {
      field: 'unit_grain_date_denominator',
      status: 'named_intake_no_payload_denominator',
      limitation: 'No payload grain, date, or denominator is evidenced. Family-level freeze is not a research denominator.',
    },
  ];
  return fields.map((field) => ({
    format: 'ushso.evidence-receipt.v1',
    receipt_id: `core-cell-${product.product_key}-${field.field}`,
    kind: 'core_cell',
    generation: LAST_GOOD_GENERATION,
    candidate_head: HEAD,
    candidate_tree: TREE,
    recorded_at: '2026-09-15T16:10:00Z',
    evidence_reference: COHORTS_REL,
    evidence_sha256: cohortsSha,
    payload: {
      product_key: product.product_key,
      record_id: null,
      live_http: false,
      bounded_sample: false,
      verified_route: false,
      recipe,
      supported: false,
      unknown: false,
      status: field.status,
      field: field.field,
      limitation: field.limitation,
      locator,
      locator_kind: intake.locator_kind ?? null,
      locator_status: intake.locator_status ?? 'unverified_locator',
      access_expectation: product.access_expectation,
    },
  }));
}

function overlayCdcNamedColumnCount(receipt, view, cdcIndex) {
  if (receipt.payload.field !== 'schema_qualification') return receipt;
  const count = view.named_column_count;
  const recipe = [
    receipt.payload.recipe,
    `Overlay frozen CDC view-index named_column_count from ${CDC_VIEW_INDEX_REL} (gzip sha256=${cdcIndex.fileSha}).`,
    `view_type=${view.view_type ?? 'unknown'} named_column_count=${count ?? 'unknown'}.`,
    'Column arrays were not retrieved. named_column_count is not a qualified publisher dictionary or payload sample.',
    'The separate PLACES 7cmc-7y5g column fixture is a different product and is not substituted here.',
  ].join(' ');
  return {
    ...receipt,
    evidence_reference: CDC_VIEW_INDEX_REL,
    evidence_sha256: cdcIndex.fileSha,
    payload: {
      ...receipt.payload,
      status: 'catalog_named_column_count_not_dictionary',
      recipe,
      limitation: 'CDC view-index named_column_count is catalog metadata. Column names, types, and payload rows were not retrieved. This is not schema qualification.',
      payload_success: false,
      named_column_count: count ?? null,
      view_type: view.view_type ?? null,
    },
  };
}

function overlayCdcViewIndex(receipt, view, cdcIndex) {
  if (receipt.payload.field !== 'publisher_access') return receipt;
  const native = view.source_native_id;
  const locator = native ? `https://data.cdc.gov/d/${native}` : null;
  const recipe = [
    receipt.payload.recipe,
    `Overlay frozen CDC view-index ${CDC_VIEW_INDEX_REL} (gzip sha256=${cdcIndex.fileSha}; uncompressed sha256=${cdcIndex.uncompressedSha}).`,
    `view_type=${view.view_type ?? 'unknown'} named_column_count=${view.named_column_count ?? 'unknown'} isolated=${view.isolated === true}.`,
    locator ? `Catalog locator ${locator} was not fetched. Column arrays were not retrieved.` : 'No catalog locator was derived.',
    'The separate PLACES 7cmc-7y5g column fixture is a different product and is not substituted here.',
  ].join(' ');
  return {
    ...receipt,
    evidence_reference: CDC_VIEW_INDEX_REL,
    evidence_sha256: cdcIndex.fileSha,
    payload: {
      ...receipt.payload,
      status: 'catalog_view_index_not_payload',
      recipe,
      limitation: 'CDC view-index entries are catalog metadata. Dataset rows, column arrays, authorization, and payload retrieval were not executed.',
      payload_success: false,
      view_type: view.view_type ?? null,
      named_column_count: view.named_column_count ?? null,
      catalog_locator: locator,
    },
  };
}

function overlayCmsDescribedBy(receipt, bound, cmsCatalog) {
  if (receipt.payload.field !== 'schema_qualification') return receipt;
  const describedBy = cmsCatalog.capture.data?.dataset?.[bound.catalog_index]?.describedBy ?? null;
  if (typeof describedBy !== 'string' || !describedBy.trim()) return receipt;
  const recipe = [
    receipt.payload.recipe,
    `Overlay frozen CMS catalog-slim describedBy from ${CMS_CATALOG_REL} (gzip sha256=${cmsCatalog.fileSha}).`,
    `describedBy=${describedBy}`,
    'Do not fetch describedBy. A catalog dictionary locator is not a qualified publisher schema or payload sample.',
  ].join(' ');
  return {
    ...receipt,
    evidence_reference: CMS_CATALOG_REL,
    evidence_sha256: cmsCatalog.fileSha,
    payload: {
      ...receipt.payload,
      status: 'catalog_describedBy_locator_not_dictionary',
      recipe,
      limitation: 'CMS catalog-slim describedBy is a locator in frozen catalog metadata. The dictionary file was not retrieved or parsed. This is not schema qualification.',
      payload_success: false,
      described_by: describedBy,
    },
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
  const cdcIndex = loadCdcViewIndex(repoRoot);
  const receipts = [];
  const unresolved = [];
  const cmsBound = [];
  const cdcBound = [];
  const intakeBound = [];
  const cohortsRelAbs = path.join(repoRoot, COHORTS_REL);
  const cohortsSha = sha256File(cohortsRelAbs);
  for (const product of cohorts.products) {
    const rid = product.anchor?.representative?.record_id ?? null;
    const status = product.anchor?.status;
    if (status === 'named_intake') {
      const intakeReceipts = namedIntakeReceipts(product, cohortsSha);
      receipts.push(...intakeReceipts);
      intakeBound.push({
        product_key: product.product_key,
        access_expectation: product.access_expectation,
        locator: product.anchor?.intake?.locator ?? null,
        locator_kind: product.anchor?.intake?.locator_kind ?? null,
        locator_status: product.anchor?.intake?.locator_status ?? null,
        verified_route: false,
        payload_success: false,
      });
      unresolved.push({
        product_key: product.product_key,
        access_expectation: product.access_expectation,
        anchor_status: status,
        record_id: rid,
        reason: 'named_intake_unverified_locator',
      });
      continue;
    }
    if (status !== 'resolved_catalog_record' || !rid || !index.has(rid)) {
      unresolved.push({
        product_key: product.product_key,
        access_expectation: product.access_expectation,
        anchor_status: status ?? null,
        record_id: rid,
        reason: 'catalog_record_not_in_frozen_corpus',
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
      if (rec.identity?.source?.source_id === 'cms-data-catalog') {
        const bound = bindCmsCatalogResources(rec, cmsCatalog.capture);
        if (field.field === 'publisher_access') {
          receipt = overlayCmsDistribution(receipt, bound, cmsCatalog);
          cmsBound.push({
            product_key: product.product_key,
            record_id: rec.record_id,
            distribution_count: bound.distributions.length,
            described_by: cmsCatalog.capture.data?.dataset?.[bound.catalog_index]?.describedBy ?? null,
            payload_success: false,
          });
        }
        if (field.field === 'schema_qualification') {
          receipt = overlayCmsDescribedBy(receipt, bound, cmsCatalog);
        }
      }
      if (rec.identity?.source?.source_id === 'cdc-socrata') {
        const native = rec.identity?.match_fields?.source_id ?? product.anchor?.representative?.native_id ?? null;
        const view = cdcIndex.byRecord.get(rec.record_id) ?? cdcIndex.byNative.get(native);
        if (view) {
          if (field.field === 'publisher_access') {
            receipt = overlayCdcViewIndex(receipt, view, cdcIndex);
            cdcBound.push({
              product_key: product.product_key,
              record_id: rec.record_id,
              source_native_id: view.source_native_id,
              view_type: view.view_type ?? null,
              named_column_count: view.named_column_count ?? null,
              payload_success: false,
            });
          }
          if (field.field === 'schema_qualification') {
            receipt = overlayCdcNamedColumnCount(receipt, view, cdcIndex);
          }
        }
      }
      receipts.push(receipt);
    }
  }
  return { receipts, unresolved, cmsBound, cmsCatalog, cdcBound, cdcIndex, intakeBound, cohortsSha };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { receipts, unresolved, cmsBound, cmsCatalog, cdcBound, cdcIndex, intakeBound, cohortsSha } = await buildCatalogMetadataReceipts();
  const dir = path.join(ROOT, 'verification/research-program/evidence/receipts');
  mkdirSync(dir, { recursive: true });
  const bundle = {
    format: 'ushso.core-cell-receipt-bundle.v1',
    generation: LAST_GOOD_GENERATION,
    candidate_head: HEAD,
    note: 'Catalog-metadata receipts only. CMS catalog-slim locators overlay 63 products. CDC view-index locators overlay 10 products. Fourteen named-intake unverified locators are known-unsupported, not verified routes. Dataset payloads were not executed. R04 remains unaccepted.',
    receipt_count: receipts.length,
    unresolved_products: unresolved,
    cms_distribution_products: cmsBound.length,
    cdc_view_index_products: cdcBound.length,
    named_intake_products: intakeBound.length,
    cohorts_sha256: cohortsSha,
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
  writeFileSync(path.join(ROOT, 'verification/research-program/evidence/cdc-view-index-locator-summary.json'), `${JSON.stringify({
    format: 'ushso.cdc-view-index-locator-summary.v1',
    generation: LAST_GOOD_GENERATION,
    evidence_reference: CDC_VIEW_INDEX_REL,
    evidence_sha256: cdcIndex.fileSha,
    uncompressed_sha256: cdcIndex.uncompressedSha,
    products_bound: cdcBound.length,
    payload_success: false,
    bounded_sample: false,
    live_http: false,
    places_7cmc_7y5g_not_substituted_for_swc5_untb: true,
    products: cdcBound,
    note: 'View-index locators and named_column_count are not payload samples or qualified dictionaries.',
  }, null, 2)}\n`);
  writeFileSync(path.join(ROOT, 'verification/research-program/evidence/named-intake-locator-summary.json'), `${JSON.stringify({
    format: 'ushso.named-intake-locator-summary.v1',
    generation: LAST_GOOD_GENERATION,
    evidence_reference: COHORTS_REL,
    evidence_sha256: cohortsSha,
    products_bound: intakeBound.length,
    payload_success: false,
    bounded_sample: false,
    verified_route: false,
    live_http: false,
    products: intakeBound,
    note: 'Unverified locators in frozen cohorts.json are not publisher access, verified restricted routes, or payload samples. Locators were not fetched.',
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ receipt_count: receipts.length, unresolved: unresolved.length, products_covered: receipts.length / 4, cms_bound: cmsBound.length, cdc_bound: cdcBound.length, intake_bound: intakeBound.length }, null, 2)}\n`);
}
