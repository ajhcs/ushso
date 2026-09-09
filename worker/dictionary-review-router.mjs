import { dictionaryReviewPage } from './dictionary-review-store.mjs';
const ROUTE = '/api/research/v1/dictionary-review';
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' };
const reply = (body, status = 200) => new Response(JSON.stringify(body) + '\n', { status, headers });
const error = (code, status) => reply({ review_status: 'pending_owner_review', publication_authorized: false, result: null, error: { code } }, status);
export async function routeDictionaryReview(request, env, { loadCatalog, cursorSigner }) {
  const url = new URL(request.url); if (url.pathname !== ROUTE) return null;
  // This is an opt-in local review surface, not a silently published scientific API.
  if (env.USHSO_DICTIONARY_REVIEW !== 'enabled') return error('dictionary_review_disabled', 404);
  if (request.method !== 'GET') return error('method_not_allowed', 405);
  const allowed = new Set(['record_id', 'generation', 'cursor', 'field']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return error('invalid_input', 400);
  const field = url.searchParams.get('field');
  if (field !== null && !/^[a-f0-9]{64}$/.test(field)) return error('invalid_input', 400);
  const recordId = url.searchParams.get('record_id'), generation = url.searchParams.get('generation'), cursor = url.searchParams.get('cursor');
  if (!recordId || !/^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,127}$/.test(recordId)
    || (generation !== null && !/^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,127}$/.test(generation))
    || (cursor !== null && (!cursor.length || cursor.length > 2048))) return error('invalid_input', 400);
  try {
    const catalog = await loadCatalog(request, env), record = catalog.records.find(r => r.record_id === recordId);
    if (!record) return error('record_unavailable_in_generation', 404);
    const result = await dictionaryReviewPage({ assets: env.ASSETS, origin: url.origin, record,
      generation: catalog.corpus.publication.generation, cursorSigner, cursor, field, expectedGeneration: generation,
      packageManifestSha256: env.USHSO_DICTIONARY_REVIEW_MANIFEST_SHA256 });
    const body = { result, error: null };
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 128 * 1024) return error('response_limit_exceeded', 413);
    return reply(body);
  } catch (failure) {
    if (failure.message === 'MACHINE_CURSOR_RESTART_REQUIRED') return error('cursor_restart_required', 410);
    const code = failure.code;
    if (code === 'generation_unavailable') return error(code, 410);
    if (code === 'dictionary_unavailable' || code === 'dictionary_field_unavailable') return error(code, 404);
    return error('dictionary_verification_failed', 503);
  }
}
