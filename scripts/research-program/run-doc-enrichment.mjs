#!/usr/bin/env node
// Documentation-enrichment collector for the navigator increment (2026-09-17).
// Bounded public-documentation retrieval only. No payload rows, no bulk files,
// no credentials, no payment, no personal data. Every request, redirect, and
// retry is charged against the ledger BEFORE execution.
//
// Budget (owner-authorized 2026-09-17, valid 7 days):
//   max_requests=100, max_bytes=104857600 (100 MiB), max_bytes_per_response=10485760,
//   max_seconds_per_request=30, max_concurrency=2 (max 1 per publisher host),
//   max_redirect_hops=2, max_retries=1 transient only.
// Eligible: official product pages, dictionaries, codebooks, methodology,
// release notes, archive manifests, API schema/catalog metadata, access
// instructions. Excluded: dataset row endpoints and bulk data files.
// Do not spend requests on another copy of the HCRIS or PLACES payload.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUTH_REL = 'verification/research-program/authorization/documentation-enrichment-authorizations.json';
const LEDGER_REL = 'verification/research-program/evidence/documentation-enrichment-ledger.json';
export const DOC_OPERATION_ID = 'OP-DOC-ENRICH-20260917';
export const DOC_AUTH_ID = 'AUTH-DOC-ENRICH-20260917';
export const DOC_PACKET_VERSION = 'ushso.documentation-enrichment-packet.v1';
export const DOC_LEDGER_FORMAT = 'ushso.documentation-enrichment-ledger.v1';

// Initial URL inventory: exact official locators from retained provenance
// (researchNavigator officialDiscoveryUrl + named-source-registry evidence_urls).
// No guessed endpoints. Additive candidate bindings may extend this list only
// with URLs discovered through verified official publisher navigation, without
// resetting the ledger or increasing the budget.
export const INITIAL_URLS = Object.freeze([
  { product_key: 'cms-hcris', url: 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report' },
  { product_key: 'cms-hcris-methodology', url: 'https://data.cms.gov/sites/default/files/2024-10/aba118b3-4f1f-45a4-8c61-b392d96b1b12/Hospital%20Provider%20Cost%20Report%20Methodology_2024_508%20Approved.pdf' },
  { product_key: 'cms-chow', url: 'https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/hospital-change-of-ownership-owner-information' },
  { product_key: 'cms-ltcf', url: 'https://data.cms.gov/quality-of-care/long-term-care-facility-characteristics' },
  { product_key: 'census-sahie', url: 'https://api.census.gov/data/id/SAHIE' },
  { product_key: 'cdc-places', url: 'https://data.cdc.gov/d/i46a-9kgh' },
  { product_key: 'cdc-maternal', url: 'https://data.cdc.gov/d/e2d5-ggg7' },
  { product_key: 'cdc-infant', url: 'https://data.cdc.gov/d/jqwm-z2g9' },
  { product_key: 'cdc-brfss', url: 'https://data.cdc.gov/d/5eh7-pjx8' },
  { product_key: 'ahrq-hcup', url: 'https://hcup-us.ahrq.gov/databases.jsp' },
  { product_key: 'ahrq-hcup-factsheet', url: 'https://hcup-us.ahrq.gov/news/exhibit_booth/hcup_fact_sheet.jsp' },
  { product_key: 'ahrq-meps', url: 'https://meps.ahrq.gov/mepsweb/data_stats/download_data_files.jsp' },
  { product_key: 'ahrq-compendium', url: 'https://www.ahrq.gov/chsp/data-resources/compendium-2020.html' },
  { product_key: 'ahrq-compendium-tech', url: 'https://www.ahrq.gov/chsp/data-resources/compendium/technical-documentation.html' },
  { product_key: 'cms-nppes', url: 'https://download.cms.gov/nppes/NPI_Files.html' },
  { product_key: 'hrsa-ahrf', url: 'https://data.hrsa.gov/topics/health-workforce/ahrf' },
  { product_key: 'samhsa-nsumhss', url: 'https://www.samhsa.gov/data/data-we-collect/n-sumhss-national-substance-use-and-mental-health-services-survey' },
  { product_key: 'cms-tmsis-taf', url: 'https://www.medicaid.gov/medicaid/data-systems/macbis/medicaid-chip-research-files' },
  { product_key: 'cdc-atsdr-svi', url: 'https://www.atsdr.cdc.gov/place-health/php/svi/index.html' },
  { product_key: 'state-apcd', url: 'https://www.apcdcouncil.org/state-apcd-activities' },
  { product_key: 'state-licensure-ctx', url: 'https://www.cms.gov/medicare/health-safety-standards/certification-compliance' },
  { product_key: 'sheps-closures', url: 'https://www.shepscenter.unc.edu/programs-projects/rural-health/rural-hospital-closures/' },
  { product_key: 'aha-survey', url: 'https://www.ahadata.com/aha-annual-survey-database' },
]);

export const APPROVED_HOSTS = Object.freeze([...new Set(INITIAL_URLS.map((r) => {
  try { return new URL(r.url).hostname; } catch { return ''; }
}).filter(Boolean))]);

function fail(code, detail) {
  const e = new Error(detail ?? code);
  e.code = code;
  throw e;
}
function sha256(b) { return createHash('sha256').update(b).digest('hex'); }
function gitHead() { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
function collectorSha() { return sha256(readFileSync(fileURLToPath(import.meta.url))); }

export function loadAuth() { return JSON.parse(readFileSync(path.join(ROOT, AUTH_REL), 'utf8')); }
export function loadLedger() { return JSON.parse(readFileSync(path.join(ROOT, LEDGER_REL), 'utf8')); }

export function assertDocExecutionAuthorized(entry, head, wallNow = Date.now()) {
  if (!entry || entry.authorized !== true) fail('DOC_AUTH_NOT_MATERIALIZED');
  if (entry.status !== 'authorized') fail('DOC_AUTH_NOT_MATERIALIZED');
  if (entry.revoked === true) fail('DOC_AUTH_REVOKED');
  if (!entry.candidate_head || entry.candidate_head !== head) fail('DOC_AUTH_NOT_MATERIALIZED');
  const t = typeof wallNow === 'function' ? wallNow() : wallNow;
  if (entry.valid_from && !(Date.parse(entry.valid_from) <= t)) fail('DOC_AUTH_NOT_YET_VALID');
  if (entry.valid_until && !(t <= Date.parse(entry.valid_until))) fail('DOC_AUTH_EXPIRED');
  const lim = entry.limits ?? {};
  if (lim.max_requests !== 100) fail('DOC_AUTH_LIMIT_MISMATCH', 'max_requests');
  if (lim.max_bytes !== 104857600) fail('DOC_AUTH_LIMIT_MISMATCH', 'max_bytes');
}

export function chargeBeforeExecution(ledger, cost) {
  // cost: { requests, bytes }
  const used = ledger.totals.used_requests + cost.requests;
  const bytes = ledger.totals.used_bytes + cost.bytes;
  if (used > ledger.totals.max_requests) fail('DOC_BUDGET_EXHAUSTED', 'requests');
  if (bytes > ledger.totals.max_bytes) fail('DOC_BUDGET_EXHAUSTED', 'bytes');
  return { used_requests: used, used_bytes: bytes };
}

// Offline self-check: packet/ledger/auth coherence without network.
export function validateOffline() {
  const auth = loadAuth();
  const ledger = loadLedger();
  const entry = (auth.entries ?? []).find((r) => r.id === DOC_AUTH_ID);
  if (!entry) fail('DOC_AUTH_ENTRY_MISSING', DOC_AUTH_ID);
  if (ledger.authorization_id !== DOC_AUTH_ID) fail('DOC_LEDGER_AUTH_MISMATCH');
  if (ledger.operation_id !== DOC_OPERATION_ID) fail('DOC_LEDGER_OP_MISMATCH');
  if (!Array.isArray(ledger.inventory) || ledger.inventory.length < 1) fail('DOC_LEDGER_INVENTORY_MISSING');
  return { auth: entry.id, urls: ledger.inventory.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2] || 'validate';
  if (cmd === 'validate') {
    const out = validateOffline();
    console.log(JSON.stringify({ ok: true, ...out, head: gitHead(), collector_sha256: collectorSha() }));
  } else if (cmd === 'head') {
    console.log(JSON.stringify({ head: gitHead(), collector_sha256: collectorSha() }));
  } else {
    console.error('unknown command: ' + cmd);
    process.exit(1);
  }
}
