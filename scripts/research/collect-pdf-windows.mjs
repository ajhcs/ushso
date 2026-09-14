import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { requireResearchPython } from './research-python.mjs';
import { parseGrid } from './cms-grid-parser.mjs';
import { parseTextCodebook, parseWorkbookCells } from './cms-structured-dictionary.mjs';
import { parseCmsDictionary, templates as cmsDictionaryTemplates } from './cms-dictionary-parser.mjs';

const exec = promisify(execFile);
export const hash = (b) => createHash('sha256').update(b).digest('hex');

export function assertPdfWindowResumeCompatible({ previous = null, pdfSha256, extractorSha256 }) {
  if (!previous) return true;
  if (previous.pdf_sha256 !== pdfSha256 || previous.extractor_sha256 !== extractorSha256) {
    throw Error('PDF_WINDOW_RESUME_EXTRACTOR');
  }
  if (!Array.isArray(previous.windows) || previous.windows.length > 2048
    || new Set(previous.windows.map((w) => w?.file)).size !== previous.windows.length
    || previous.windows.some((w) => !w || !Number.isSafeInteger(w.start_page) || w.start_page < 1 || !Number.isSafeInteger(w.count) || w.count < 1 || w.count > 8 || w.file !== w.start_page + '-' + w.count + '.json' || !/^[a-f0-9]{64}$/.test(w.sha256))) {
    throw Error('PDF_WINDOW_CHECKPOINT_SHAPE');
  }
  return true;
}

export function mergePdfWindowResults({ previous = null, windows = [] }) {
  const known = new Map((previous?.windows ?? []).map((w) => [w.file, w]));
  const retained = new Map(known);
  for (const result of windows) retained.set(result.file, result);
  const merged = [...retained.values()].sort((a, b) => a.start_page - b.start_page);
  const nextPage = merged.length ? merged.reduce((max, item) => Math.max(max, item.start_page + item.count), 1) : 1;
  const total = previous?.total_pages ?? null;
  return Object.freeze({
    pdf_sha256: previous?.pdf_sha256 ?? null,
    extractor_sha256: previous?.extractor_sha256 ?? null,
    total_pages: total,
    next_page: nextPage,
    completed: total != null && nextPage > total,
    windows: Object.freeze(merged),
    scientific_approval: false,
  });
}

export async function collectPdfWindows(pdf, out) {
  if (!pdf || !out) throw Error('PDF_WINDOW_USAGE');
  await fs.mkdir(out, { recursive: true });
  const stat = await fs.stat(pdf);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw Error('PDF_WINDOW_SOURCE_SIZE');
  const pdfBytes = await fs.readFile(pdf);
  if (pdfBytes.length > 64 * 1024 * 1024) throw Error('PDF_WINDOW_SOURCE_SIZE');
  const pdf_sha256 = hash(pdfBytes);
  const extractor = new URL('./pdf-text-window.py', import.meta.url).pathname;
  const extractor_sha256 = hash(await fs.readFile(extractor));
  let previous = null;
  try {
    const checkpoint = path.join(out, 'resume.json');
    if ((await fs.stat(checkpoint)).size > 2 * 1024 * 1024) throw Error('PDF_WINDOW_CHECKPOINT_SIZE');
    const bytes = await fs.readFile(checkpoint);
    if (bytes.length > 2 * 1024 * 1024) throw Error('PDF_WINDOW_CHECKPOINT_SIZE');
    previous = JSON.parse(bytes);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  assertPdfWindowResumeCompatible({ previous, pdfSha256: pdf_sha256, extractorSha256: extractor_sha256 });
  const known = new Map((previous?.windows ?? []).map((w) => [w.file, w]));
  let start = 1, total = null, results = [];
  while (total === null || start <= total) {
    const count = total === null ? 1 : Math.min(8, total - start + 1);
    const file = path.join(out, start + '-' + count + '.json');
    let body;
    try {
      if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw Error('PDF_WINDOW_CACHE_SIZE');
      body = await fs.readFile(file, 'utf8');
      if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw Error('PDF_WINDOW_CACHE_SIZE');
      if (known.get(path.basename(file))?.sha256 !== hash(body)) throw Error('PDF_WINDOW_RESUME_HASH');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const { stdout } = await exec(requireResearchPython(), ['-I', extractor, pdf, String(start), String(count)], { timeout: 25000, maxBuffer: 9 * 1024 * 1024 });
      body = stdout;
      await fs.writeFile(file, body, { flag: 'wx' });
    }
    const captured = JSON.parse(body);
    if (captured.status !== 'captured_window' || captured.pdf_sha256 !== pdf_sha256 || captured.start_page !== start || captured.count !== count || !Array.isArray(captured.pages) || captured.pages.length !== count || !Number.isSafeInteger(captured.total_pages) || captured.total_pages < 1 || captured.total_pages > 2048 || captured.pages.some((p, i) => !p || p.physical_page !== start + i || typeof p.text !== 'string' || Buffer.byteLength(p.text) > 1024 * 1024) || (total !== null && captured.total_pages !== total) || captured.pypdf_version !== '6.18.0') {
      throw Error('PDF_WINDOW_RESUME_IDENTITY');
    }
    total = captured.total_pages;
    results.push({ file: path.basename(file), sha256: hash(body), start_page: start, count });
    start += count;
    const retained = new Map(known);
    for (const result of results) retained.set(result.file, result);
    const windows = [...retained.values()].sort((a, b) => a.start_page - b.start_page);
    const receipt = { pdf_sha256, extractor_sha256, total_pages: total, next_page: start, completed: start > total, windows, scientific_approval: false };
    const next = path.join(out, 'resume.' + process.pid + '.next.json');
    let created = false;
    try {
      await fs.writeFile(next, JSON.stringify(receipt, null, 2) + String.fromCharCode(10), { flag: 'wx' });
      created = true;
      await fs.rename(next, path.join(out, 'resume.json'));
      created = false;
    } finally {
      if (created) await fs.unlink(next);
    }
    if (results.length % 10 === 0) console.log(JSON.stringify({ captured_pages: start - 1, total_pages: total }));
  }
  console.log(JSON.stringify({ pdf_sha256, pages: total, windows: results.length, completed: true }));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [pdf, out] = process.argv.slice(2);
  await collectPdfWindows(pdf, out);
}


export const PARSER_FAMILIES = Object.freeze(['csv', 'xlsx', 'text_pdf', 'grid']);
export const RESIDUAL_REASONS = Object.freeze([
  'missing_source',
  'unsupported',
  'scanned',
  'encrypted',
  'ambiguous_layout',
  'parser_defect',
]);

export async function blockedFetch() {
  const error = new Error('PARSER_ROUTING_LIVE_NETWORK_FORBIDDEN');
  error.code = 'PARSER_ROUTING_LIVE_NETWORK_FORBIDDEN';
  throw error;
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function residual(reason, detail = null, extra = {}) {
  if (!RESIDUAL_REASONS.includes(reason)) {
    const error = new Error('UNKNOWN_RESIDUAL_REASON');
    error.code = 'UNKNOWN_RESIDUAL_REASON';
    throw error;
  }
  return Object.freeze({
    selected: false,
    residual: true,
    family: extra.family ?? null,
    parser: null,
    reason,
    detail,
    parsed: extra.parsed ?? null,
    payload_success: false,
    publication_authorized: false,
    scientific_approval: false,
  });
}

function selected(family, parser, extra = {}) {
  return Object.freeze({
    selected: true,
    residual: false,
    family,
    parser,
    reason: null,
    evidence: extra.evidence ?? null,
    payload_success: false,
    publication_authorized: false,
    scientific_approval: false,
  });
}

export function classifyDocumentSignature(capture = {}) {
  if (!capture || typeof capture !== 'object') return residual('missing_source', 'CAPTURE_MISSING');
  if (capture.status === 'missing' || capture.missing === true) return residual('missing_source', 'SOURCE_BYTES_ABSENT');
  if (capture.encrypted === true || capture.error === 'PDF_ENCRYPTED') return residual('encrypted', 'PDF_ENCRYPTED', { family: 'text_pdf' });
  if (capture.scanned === true || capture.layout === 'image_only' || capture.text_extractable === false) {
    return residual('scanned', 'SCANNED_OR_IMAGE_ONLY', { family: 'text_pdf' });
  }
  if (capture.mode === 'painted-bordered-grid-v2') return selected('grid', 'parseGrid', { evidence: 'mode:painted-bordered-grid-v2' });
  if (capture.status === 'captured_cells' && Array.isArray(capture.sheets)) return selected('xlsx', 'parseWorkbookCells', { evidence: 'status:captured_cells' });
  if (capture.mediaType === 'text/csv' || capture.family === 'csv' || (typeof capture.text === 'string' && /^Variable\s+Format\s+(Q#\/Freq|Freq)\s+Description\/Label\s*$/m.test(capture.text))) {
    return selected('csv', 'parseTextCodebook', { evidence: 'csv_or_codebook_header' });
  }
  if (typeof capture.pdfSha256 === 'string' && Object.values(cmsDictionaryTemplates).includes(capture.pdfSha256)) {
    return selected('text_pdf', 'parseCmsDictionary', { evidence: 'cms_dictionary_template_hash' });
  }
  if (capture.status === 'captured_window' && capture.pypdf_version === '6.18.0') {
    return selected('text_pdf', 'pdf_text_window', { evidence: 'captured_window:pypdf:6.18.0' });
  }
  if (capture.mediaType === 'application/pdf' || capture.family === 'text_pdf') {
    return residual('unsupported', 'TEXT_PDF_LAYOUT_UNBOUND', { family: 'text_pdf' });
  }
  if (capture.mode && capture.mode !== 'painted-bordered-grid-v2') {
    return residual('unsupported', 'GRID_MODE_UNSUPPORTED', { family: 'grid' });
  }
  return residual('unsupported', 'NO_VALIDATED_LAYOUT_EVIDENCE');
}

export function routeDocument(capture = {}) {
  const route = classifyDocumentSignature(capture);
  if (route.residual) return route;
  try {
    if (route.parser === 'parseGrid') {
      const parsed = parseGrid(capture.document ?? capture);
      const issues = parsed.issues ?? [];
      const ambiguous = issues.some((issue) => /AMBIGUOUS|HEADER_UNSUPPORTED/.test(issue.code ?? ''));
      const defect = issues.some((issue) => /GEOMETRY|UNAVAILABLE|BORDER|ROWS_MISSING/.test(issue.code ?? ''));
      if (ambiguous && parsed.variables.length === 0) return residual('ambiguous_layout', issues[0]?.code, { family: 'grid', parsed });
      if (defect && parsed.variables.length === 0) return residual('parser_defect', issues[0]?.code, { family: 'grid', parsed });
      return Object.freeze({ ...route, parsed, field_count: parsed.variables?.length ?? 0 });
    }
    if (route.parser === 'parseWorkbookCells') {
      const parsed = parseWorkbookCells(capture.document ?? capture);
      const issues = parsed.issues ?? [];
      const ambiguous = issues.some((issue) => /AMBIGUOUS|AUXILIARY|MERGED/.test(issue.code ?? ''));
      if (ambiguous && parsed.variables.length === 0) return residual('ambiguous_layout', issues[0]?.code, { family: 'xlsx', parsed });
      return Object.freeze({ ...route, parsed, field_count: parsed.variables?.length ?? 0 });
    }
    if (route.parser === 'parseTextCodebook') {
      const parsed = parseTextCodebook(capture.text);
      const issues = parsed.issues ?? [];
      const ambiguous = issues.some((issue) => /AMBIGUOUS/.test(issue.code ?? ''));
      if (ambiguous && parsed.variables.length === 0) return residual('ambiguous_layout', issues[0]?.code, { family: 'csv', parsed });
      return Object.freeze({ ...route, parsed, field_count: parsed.variables?.length ?? 0 });
    }
    if (route.parser === 'parseCmsDictionary') {
      const parsed = parseCmsDictionary(capture.document, capture.pdfSha256);
      return Object.freeze({ ...route, parsed, field_count: parsed.variables?.length ?? 0 });
    }
    if (route.parser === 'pdf_text_window') {
      const pages = Array.isArray(capture.pages) ? capture.pages : [];
      return Object.freeze({
        ...route,
        parsed: { status: 'captured_window', pages },
        field_count: pages.filter((page) => typeof page.text === 'string' && page.text.trim()).length,
      });
    }
    return residual('parser_defect', 'PARSER_NOT_DISPATCHED', { family: route.family });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'CMS_DICTIONARY_LAYOUT_UNSUPPORTED') return residual('unsupported', message, { family: 'text_pdf' });
    if (message === 'GRID_DOCUMENT' || message === 'GRID_HEADER_UNSUPPORTED') return residual('unsupported', message, { family: 'grid' });
    if (message === 'CODEBOOK_HEADER') return residual('ambiguous_layout', message, { family: 'csv' });
    if (message === 'WORKBOOK_CELLS') return residual('parser_defect', message, { family: 'xlsx' });
    if (/AMBIGUOUS/.test(message)) return residual('ambiguous_layout', message, { family: route.family });
    return residual('parser_defect', message, { family: route.family });
  }
}

export function resumeDocumentWindows({ pdfSha256, extractorSha256, previous = null, windows = [] }) {
  assertPdfWindowResumeCompatible({ previous, pdfSha256, extractorSha256 });
  const merged = mergePdfWindowResults({ previous: previous ? { ...previous, pdf_sha256: pdfSha256, extractor_sha256: extractorSha256 } : null, windows });
  const files = merged.windows.map((item) => item.file);
  if (new Set(files).size !== files.length) {
    const error = new Error('PDF_WINDOW_DUPLICATE_WINDOW');
    error.code = 'PDF_WINDOW_DUPLICATE_WINDOW';
    throw error;
  }
  const pages = merged.windows.flatMap((item) => Array.from({ length: item.count ?? 0 }, (_, index) => item.start_page + index));
  if (new Set(pages).size !== pages.length) {
    const error = new Error('PDF_WINDOW_DUPLICATE_PAGE');
    error.code = 'PDF_WINDOW_DUPLICATE_PAGE';
    throw error;
  }
  return Object.freeze({
    ...merged,
    pdf_sha256: pdfSha256,
    extractor_sha256: extractorSha256,
    lost_pages: 0,
    duplicate_pages: 0,
    payload_success: false,
    publication_authorized: false,
    scientific_approval: false,
  });
}

export function buildDocumentExtractionCoverage(captures) {
  const rows = (captures ?? []).map((capture, index) => {
    const routed = routeDocument(capture);
    return Object.freeze({
      id: capture.id ?? capture.record_id ?? `capture-${index}`,
      source: capture.source ?? null,
      family: routed.family,
      parser: routed.parser,
      residual: routed.residual,
      reason: routed.reason,
      detail: routed.detail ?? null,
      field_count: routed.field_count ?? 0,
      payload_success: false,
      publication_authorized: false,
    });
  });
  const group = (reason) => rows.filter((row) => row.reason === reason).map((row) => row.id);
  return Object.freeze({
    format: 'ushso.document-extraction-coverage.v1',
    record_count: rows.length,
    rows: Object.freeze(rows),
    groups: Object.freeze({
      selected: Object.freeze(rows.filter((row) => row.residual === false).map((row) => row.id)),
      parser_defect: Object.freeze(group('parser_defect')),
      missing_source: Object.freeze(group('missing_source')),
      encrypted: Object.freeze(group('encrypted')),
      scanned: Object.freeze(group('scanned')),
      ambiguous_layout: Object.freeze(group('ambiguous_layout')),
      unsupported: Object.freeze(group('unsupported')),
    }),
    payload_success: false,
    publication_authorized: false,
    live_source_traffic: false,
    input_hash: sha256Text(JSON.stringify(captures ?? [])),
  });
}
