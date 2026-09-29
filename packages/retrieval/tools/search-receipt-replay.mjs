// Explicit, generation-bound replay preparation; no network, persistence or UI.
const version = 'observatory-search-manifest.v1.0.0';
function fail(code) { throw Object.assign(new Error(code), { code }); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export function queryFromSearchReceipt(receipt) {
  if (!object(receipt) || receipt.manifest_version !== version || receipt.scope !== 'current_page'
      || typeof receipt.question !== 'string' || typeof receipt.catalog_generation !== 'string' || !receipt.catalog_generation
      || typeof receipt.ranking_version !== 'string' || !Array.isArray(receipt.displayed_ordered_ids)
      || !receipt.displayed_ordered_ids.every(id => typeof id === 'string')
      || new Set(receipt.displayed_ordered_ids).size !== receipt.displayed_ordered_ids.length
      || !object(receipt.filters)) fail('invalid_search_receipt');
  const filters = receipt.filters;
  const traversal = object(filters.traversal) ? filters.traversal : filters;
  const query = { question: receipt.question, generation: receipt.catalog_generation, sort: receipt.sort };
  for (const key of ['geography', 'subjects', 'units_of_analysis', 'access_statuses', 'include_restricted', 'time_window', 'exclusions', 'facet_filters']) {
    if (filters[key] !== undefined && filters[key] !== null) query[key] = structuredClone(filters[key]);
  }
  const pageSize = traversal.page_size ?? filters.limit;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) fail('receipt_page_size_missing');
  query.page_size = pageSize;
  if (traversal.cursor != null) {
    if (typeof traversal.cursor !== 'string') fail('invalid_receipt_cursor');
    query.cursor = traversal.cursor;
  }
  // Neither generation nor cursor is silently removed to get a successful query.
  return query;
}
export function compareSearchReceiptReplay(receipt, result) {
  queryFromSearchReceipt(receipt);
  const mismatch = code => ({ status: 'not_reproduced', code, original_generation: receipt.catalog_generation, actual_generation: result?.pagination?.generation ?? null });
  if (result?.pagination?.generation !== receipt.catalog_generation) return mismatch('generation_mismatch');
  if (result?.ranking?.version !== receipt.ranking_version) return mismatch('ranking_version_mismatch');
  if (result?.ranking?.sort !== receipt.sort) return mismatch('sort_mismatch');
  if (result?.query?.question !== receipt.question) return mismatch('question_mismatch');
  if (!equal(result?.query?.interpretation, receipt.interpreted_constraints)) return mismatch('interpretation_mismatch');
  if (!equal(result?.results?.map(item => item.record_id), receipt.displayed_ordered_ids)) return mismatch('displayed_order_mismatch');
  return { status: 'reproduced', catalog_generation: receipt.catalog_generation, scope: 'current_page', record_count: receipt.displayed_ordered_ids.length };
}
