import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  blockedFetch,
  buildDocumentExtractionCoverage,
  classifyDocumentSignature,
  resumeDocumentWindows,
  routeDocument,
} from '../../scripts/research/collect-pdf-windows.mjs';

const span = (text, x, y) => ({ text, x, y });
function gridPage(number = 1) {
  return {
    page: number,
    status: 'captured',
    rectangles: [[0, 0, 1, 100], [100, 0, 101, 100], [200, 0, 201, 100], [400, 0, 401, 100], ...[90, 80, 50, 20].map((y) => [0, y, 401, y + 1])],
    spans: [
      span('Variable Name', 10, 85), span('Term Name', 110, 85), span('Definition', 210, 85),
      span('current', 10, 65), span('Current', 110, 65), span('Current definition first.', 210, 75), span('Current definition last.', 210, 55),
      span('prior', 10, 35), span('Prior', 110, 35), span('Prior definition first.', 210, 45), span('Prior definition last.', 210, 25),
    ],
  };
}
const gridDocument = (pages) => ({ mode: 'painted-bordered-grid-v2', total_pages: pages.length, pages });
const codebook = 'Variable Format Q#/Freq Description/Label\nNAME     A10            Name label';
const workbook = {
  status: 'captured_cells',
  sheets: [{
    name: 'IQIES',
    merged_cells: [],
    rows: [
      { row: 1, cells: [{ reference: 'A1', text: 'POS Header', formula: null }, { reference: 'C1', text: 'Label', formula: null }, { reference: 'D1', text: 'Definition', formula: null }] },
      { row: 2, cells: [{ reference: 'A2', text: 'PROVNUM', formula: null }, { reference: 'B2', text: 'CHAR', formula: null }, { reference: 'C2', text: 'Provider', formula: null }, { reference: 'D2', text: 'Medicare provider number', formula: null }] },
    ],
  }],
};

test('CSV, XLSX, text-PDF and grid families select a parser from validated layout evidence', () => {
  assert.equal(classifyDocumentSignature({ text: codebook }).parser, 'parseTextCodebook');
  assert.equal(classifyDocumentSignature(workbook).parser, 'parseWorkbookCells');
  assert.equal(classifyDocumentSignature({ status: 'captured_window', pypdf_version: '6.18.0', pages: [] }).parser, 'pdf_text_window');
  assert.equal(classifyDocumentSignature(gridDocument([gridPage()])).parser, 'parseGrid');
  assert.equal(routeDocument({ text: codebook }).field_count, 1);
  assert.equal(routeDocument(workbook).field_count, 1);
  assert.equal(routeDocument(gridDocument([gridPage()])).field_count, 2);
});

test('unsupported and scanned documents remain residual, not payload success', () => {
  const scanned = routeDocument({ scanned: true, mediaType: 'application/pdf' });
  assert.equal(scanned.residual, true);
  assert.equal(scanned.reason, 'scanned');
  assert.equal(scanned.payload_success, false);
  assert.equal(scanned.publication_authorized, false);
  const unsupported = routeDocument({ mediaType: 'application/pdf' });
  assert.equal(unsupported.residual, true);
  assert.equal(unsupported.reason, 'unsupported');
  assert.equal(unsupported.payload_success, false);
});

test('encrypted and ambiguous-layout documents are grouped as residual with explicit reasons', () => {
  const encrypted = routeDocument({ encrypted: true });
  assert.equal(encrypted.reason, 'encrypted');
  const ambiguous = routeDocument({
    mode: 'painted-bordered-grid-v2',
    total_pages: 1,
    pages: [{ page: 1, status: 'captured', rectangles: [[0, 0, 1, 100]], spans: [{ text: 'not a header', x: 10, y: 10 }] }],
  });
  assert.equal(ambiguous.residual, true);
  assert.ok(['ambiguous_layout', 'parser_defect', 'unsupported'].includes(ambiguous.reason));
});

test('mid-document PDF window resume loses no fields and duplicates none', () => {
  const previous = {
    pdf_sha256: 'a'.repeat(64),
    extractor_sha256: 'b'.repeat(64),
    total_pages: 3,
    windows: [{ file: '1-1.json', sha256: 'c'.repeat(64), start_page: 1, count: 1 }],
  };
  const resumed = resumeDocumentWindows({
    pdfSha256: previous.pdf_sha256,
    extractorSha256: previous.extractor_sha256,
    previous,
    windows: [{ file: '2-2.json', sha256: 'd'.repeat(64), start_page: 2, count: 2 }],
  });
  assert.equal(resumed.lost_pages, 0);
  assert.equal(resumed.duplicate_pages, 0);
  assert.equal(resumed.windows.length, 2);
  assert.deepEqual(resumed.windows.map((item) => item.start_page), [1, 2]);
  assert.equal(resumed.payload_success, false);
});

test('changed source bytes invalidate incompatible checkpoints', () => {
  const previous = {
    pdf_sha256: 'a'.repeat(64),
    extractor_sha256: 'b'.repeat(64),
    windows: [{ file: '1-1.json', sha256: 'c'.repeat(64), start_page: 1, count: 1 }],
  };
  assert.throws(
    () => resumeDocumentWindows({ pdfSha256: 'e'.repeat(64), extractorSha256: previous.extractor_sha256, previous, windows: [] }),
    /PDF_WINDOW_RESUME_EXTRACTOR/,
  );
  assert.throws(
    () => resumeDocumentWindows({ pdfSha256: previous.pdf_sha256, extractorSha256: 'f'.repeat(64), previous, windows: [] }),
    /PDF_WINDOW_RESUME_EXTRACTOR/,
  );
});

test('coverage report groups parser defect, missing source, encrypted/scanned and ambiguous layout', () => {
  const coverage = buildDocumentExtractionCoverage([
    { id: 'csv-ok', text: codebook, source: 'census' },
    { id: 'xlsx-ok', ...workbook, source: 'cms' },
    { id: 'grid-ok', ...gridDocument([gridPage()]), source: 'cms' },
    { id: 'missing', status: 'missing', source: 'cdc' },
    { id: 'encrypted', encrypted: true, source: 'cms' },
    { id: 'scanned', scanned: true, source: 'cdc' },
    { id: 'unsupported', mediaType: 'application/pdf', source: 'census' },
    { id: 'defect', mode: 'painted-bordered-grid-v2', total_pages: 1, pages: [{ page: 1, status: 'captured', rectangles: [], spans: [span('Variable Name', 10, 85), span('Term Name', 110, 85), span('Definition', 210, 85)] }], source: 'cms' },
  ]);
  assert.equal(coverage.record_count, 8);
  assert.ok(coverage.groups.selected.includes('csv-ok'));
  assert.ok(coverage.groups.missing_source.includes('missing'));
  assert.ok(coverage.groups.encrypted.includes('encrypted'));
  assert.ok(coverage.groups.scanned.includes('scanned'));
  assert.ok(coverage.groups.unsupported.includes('unsupported'));
  assert.ok(coverage.groups.parser_defect.includes('defect') || coverage.groups.ambiguous_layout.includes('defect'));
  assert.equal(coverage.payload_success, false);
  assert.equal(coverage.publication_authorized, false);
  assert.equal(coverage.live_source_traffic, false);
  assert.equal(coverage.rows.every((row) => row.payload_success === false), true);
});

test('live fetch is forbidden in the parser-routing path', async () => {
  await assert.rejects(() => blockedFetch('https://data.cms.gov'), { code: 'PARSER_ROUTING_LIVE_NETWORK_FORBIDDEN' });
});

test('hash identity is retained for coverage inputs', () => {
  const captures = [{ id: 'a', status: 'missing' }];
  const coverage = buildDocumentExtractionCoverage(captures);
  assert.equal(coverage.input_hash, createHash('sha256').update(JSON.stringify(captures)).digest('hex'));
});
