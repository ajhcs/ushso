// Exact publisher cost-report header grammar. No label, unit, or release inference.
const unique = values => [...new Set(values.map(v => Math.round(v * 10) / 10))].sort((a, b) => a - b);
const grammar = ['Variable Name', 'Cost Report Worksheet Element', 'Definition'];
function borderCovers(rectangles, edge, bottom, top) {
  const segments = rectangles.filter(([x,y,x2,y2]) => x2-x > 0 && x2-x <= 2 && y2-y > 0
    && Math.abs(x2-edge) <= .2).map(r=>[r[1],r[3]]).sort((a,b)=>a[0]-b[0]);
  let covered = bottom;
  for (const [start,end] of segments) {
    if (end < covered) continue;
    if (start > covered + .2) return false;
    covered = Math.max(covered,end);
    if (covered >= top - .2) return true;
  }
  return false;
}
export function parseCostReportGrid(document) {
  const result = {status: 'unavailable', variables: [], issues: [], pages_parsed: [],
    scientific_approval: false, publication_authorized: false, canonical_records_changed: 0};
  if (document?.mode !== 'painted-bordered-grid-v2' || !Array.isArray(document.pages)
    || document.pages.length !== document.total_pages || document.pages.length > 64) {
    result.issues.push({code: 'COST_GRID_DOCUMENT'}); return result;
  }
  let continuation = null;
  for (const [index, page] of document.pages.entries()) {
    try {
      if (!page || page.page !== index + 1 || page.status !== 'captured'
        || !Array.isArray(page.rectangles) || !Array.isArray(page.spans)) throw Error('COST_GRID_PAGE');
      const {rectangles, spans} = page;
      if (rectangles.length > 50000 || spans.length > 50000
        || rectangles.some(r => !Array.isArray(r) || r.length !== 4 || r.some(v => !Number.isFinite(v)))
        || spans.some(s => !s || typeof s.text !== 'string' || !Number.isFinite(s.x) || !Number.isFinite(s.y))) throw Error('COST_GRID_GEOMETRY');
      if (spans.some(s => /[\r\n]/.test(s.text.trim()) || (s.text.trim() && s.x === 0 && s.y === 0))) throw Error('COST_GRID_AMBIGUOUS_TEXT_POSITION');
      const candidates = [];
      for (const first of spans.filter(s => s.text === 'Variable' || s.text === 'Variable Name')) {
        const vertical = rectangles.filter(([x, y, x2, y2]) => x2 - x > 0 && x2 - x <= 2 && y2 - y > 5 && y < first.y && y2 > first.y);
        const edges = unique(vertical.map(r => r[2]));
        const left = edges.filter(x => x < first.x).at(-1), start = edges.indexOf(left);
        if (start < 0 || edges.length - start !== 4) continue;
        const bounds = edges.slice(start);
        const horizontal = rectangles.filter(([x, y, x2, y2]) => y2 - y > 0 && y2 - y <= 2 && x <= bounds[0] + 2 && x2 >= bounds[3] - 2);
        const ys = unique(horizontal.map(r => r[3])).sort((a, b) => b - a);
        const top = ys.filter(y => y > first.y).at(-1), bottom = ys.find(y => y < first.y);
        if (top === undefined || bottom === undefined) continue;
        const cellSpans = [0, 1, 2].map(i => spans.filter(s => s.x >= bounds[i] - .2 && s.x < bounds[i + 1] - .2 && s.y < top && s.y > bottom).sort((a, b) => b.y - a.y || a.x - b.x));
        const cells = cellSpans.map(cell => cell.map(s => s.text).join(' ').trim());
        if (JSON.stringify(cells) === JSON.stringify(grammar)) candidates.push({bounds, ys, bottom, source_cells: cellSpans});
      }
      if (!candidates.length && continuation && !spans.some(s => ['Variable', 'Variable Name', 'Definition'].includes(s.text))) {
        const bounds = unique(rectangles.filter(([x,y,x2,y2]) => x2-x > 0 && x2-x <= 2 && y2-y > 5).map(r => r[2]));
        if (JSON.stringify(bounds) !== JSON.stringify(continuation.bounds)) throw Error('COST_GRID_CONTINUATION_COLUMNS');
        const ys = unique(rectangles.filter(([x,y,x2,y2]) => y2-y > 0 && y2-y <= 2 && x <= bounds[0]+2 && x2 >= bounds[3]-2).map(r=>r[3])).sort((a,b)=>b-a);
        if (ys.length < 2 || spans.some(s => !(s.x >= bounds[0]-.2 && s.x < bounds[3]-.2 && s.y < ys[0] && s.y > ys.at(-1)) && !/^\d+$/.test(s.text))) throw Error('COST_GRID_CONTINUATION_CONTENT');
        candidates.push({bounds, ys, bottom: ys[0], source_cells: continuation.header_cells,
          inherited_header_page: continuation.header_page});
      }
      if (candidates.length !== 1) throw Error(candidates.length ? 'COST_GRID_HEADER_AMBIGUOUS' : 'COST_GRID_HEADER_UNSUPPORTED');
      const {bounds, ys, bottom: headerBottom, source_cells: header_cells, inherited_header_page} = candidates[0];
      continuation = {bounds, header_cells, header_page: inherited_header_page ?? page.page};
      const rowYs = ys.filter(y => y <= headerBottom);
      if (rowYs.length < 2) throw Error('COST_GRID_ROW_BOUNDARY');
      let count = 0;
      for (let i = 0; i < rowYs.length - 1; i++) {
        const top = rowYs[i], bottom = rowYs[i + 1];
        // Vertical strokes terminate at the painted top border's lower edge.
        // Require coverage of the actual open cell interior, not the border's fill thickness.
        const topFills = rectangles.filter(([x,y,x2,y2]) => y2-y > 0 && y2-y <= 2 && Math.abs(y2-top)<=.2 && x<=bounds[0]+2 && x2>=bounds[3]-2);
        const interiorTop = topFills.length ? Math.min(...topFills.map(r=>r[1])) : top;
        if (!bounds.every(edge => borderCovers(rectangles,edge,bottom,interiorTop))) {
          result.issues.push({code:'COST_GRID_ROW_COLUMN_BOUNDARY_GAP',page:page.page,bounds:[bounds[0],bottom,bounds[3],top]});continue;
        }
        const boundarySpans = spans.filter(s => s.x >= bounds[0]-.2 && s.x <= bounds[3]+.2 && s.y >= bottom-.2 && s.y <= top+.2
          && (Math.abs(s.y-bottom)<=.2 || Math.abs(s.y-top)<=.2 || bounds.some(edge=>Math.abs(s.x-edge)<=.2)
            || rectangles.some(([x,y,x2,y2]) => s.x>=x-.2&&s.x<=x2+.2&&s.y>=y-.2&&s.y<=y2+.2
              && ((x2-x>0&&x2-x<=2&&bounds.some(edge=>Math.abs(x2-edge)<=.2))
                || (y2-y>0&&y2-y<=2&&x<=bounds[0]+2&&x2>=bounds[3]-2)))));
        if (boundarySpans.length) {
          result.issues.push({code:'COST_GRID_TEXT_ON_BOUNDARY',page:page.page,bounds:[bounds[0],bottom,bounds[3],top],source_spans:boundarySpans});continue;
        }
        const source_cells = [0, 1, 2].map(column => spans.filter(s => s.x >= bounds[column] - .2 && s.x < bounds[column + 1] - .2 && s.y < top && s.y > bottom).sort((a, b) => b.y - a.y || a.x - b.x));
        const cells = source_cells.map(cell => cell.map(s => s.text).join(' ').trim());
        if (cells.every(c => !c)) continue;
        const worksheet = cells[1] === 'NA' || (/^[A-Z][0-9]* ‐ /.test(cells[1]) && /Line/.test(cells[1]) && /Column/.test(cells[1]) && /[0-9]/.test(cells[1]));
        if (!cells[0] || cells[0].length > 512 || !worksheet || !cells[2]) {
          result.issues.push({code: 'COST_GRID_ROW_IDENTITY_OR_CONTINUATION', page: page.page,
            bounds: [bounds[0], bottom, bounds[3], top], cells, source_cells}); continue;
        }
        result.variables.push({name: cells[0], label: null, description: cells[2], unit: null,
          publisher_worksheet_element: cells[1], description_completeness: 'unverified',
          page: page.page, bounds: [bounds[0], bottom, bounds[3], top], source_cells, header_cells,
          publisher_name_kind: 'literal_variable_name_cell_not_payload_schema_verified', header_page: continuation.header_page,
          ownership_evidence: 'publisher_explicit_cell_borders', release_applicability: 'unresolved', eligible_for_schema_promotion: false});
        count++;
      }
      result.pages_parsed.push({page: page.page, rows: count});
    } catch (error) { continuation = null; result.issues.push({page: page?.page ?? index + 1, code: error.message}); }
  }
  const counts = new Map();
  for (const v of result.variables) counts.set(v.name, (counts.get(v.name) ?? 0) + 1);
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
  if (duplicates.length) result.issues.push({code: 'COST_GRID_DUPLICATE_IDENTITY', names: duplicates});
  result.variables = result.variables.filter(v => !duplicates.includes(v.name));
  result.status = result.issues.length ? 'partial' : 'extracted_pending_review';
  return result;
}
