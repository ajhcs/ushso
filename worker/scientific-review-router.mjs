const sha = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
const digest = (value) => sha(new TextEncoder().encode(JSON.stringify(value)));
const hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const reply = (status, result = null, code = null) => new Response(JSON.stringify({ schema: "ushso.scientific-review-response.v1", result, error: code ? { code } : null }), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
async function routeScientificReview(request, env, { loadCatalog }) {
  if (env.USHSO_SCIENTIFIC_REVIEW !== "enabled") return reply(404, null, "scientific_review_disabled");
  if (request.method !== "GET") return reply(405, null, "method_not_allowed");
  const url = new URL(request.url), id = url.searchParams.get("record_id"), generation = url.searchParams.get("generation");
  if ([...url.searchParams.keys()].some((k) => !["record_id", "generation"].includes(k) || url.searchParams.getAll(k).length !== 1) || !id || id.length > 500 || !generation || generation.length > 200) return reply(400, null, "invalid_review_query");
  if (!hex(env.USHSO_SCIENTIFIC_REVIEW_MANIFEST_SHA256)) return reply(503, null, "scientific_review_pin_required");
  try {
    const response = await env.ASSETS.fetch(new Request(new URL("/scientific-review-v1/manifest.json", request.url)));
    if (!response.ok || !response.body) throw Error("scientific_review_asset_unavailable");
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64 * 1024) throw Error("scientific_review_asset_limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (await sha(bytes) !== env.USHSO_SCIENTIFIC_REVIEW_MANIFEST_SHA256) throw Error("scientific_review_pin_mismatch");
    const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (manifest.schema !== "ushso.scientific-review-assets.v1" || manifest.owner_decision !== null || manifest.publication_authorized !== false || !Array.isArray(manifest.claims) || manifest.claims.length > 4) throw Error("scientific_review_manifest_invalid");
    if (manifest.generation !== generation) return reply(409, null, "generation_unavailable");
    const catalog = await loadCatalog(request, env);
    if (catalog.corpus.publication?.generation !== generation) return reply(409, null, "generation_unavailable");
    const record = catalog.records.find((r) => r.record_id === id);
    if (!record) return reply(404, null, "record_unavailable");
    const claims = manifest.claims.filter((row) => row.claim?.record_id === id);
    if (new Set(manifest.claims.map(row => row.claim?.claim_id)).size !== manifest.claims.length) throw Error('scientific_review_claim_binding');
    if (!claims.length) return reply(404, null, "scientific_review_not_documented");
    for (const row of claims) {
      const c = row.claim, { proposal_sha256, owner_decision, ...subject } = c;
      if (!["SCI-04", "SCI-05"].includes(c.card_id) || c.generation !== generation || owner_decision !== null || c.proposed_value?.state !== "pending_owner_review" || c.promotion_policy !== "owner_scoped_note_only" || c.field_path !== "/evidence/-" || !hex(proposal_sha256) || await digest(subject) !== proposal_sha256 || await digest(record) !== c.baseline_record_sha256) throw Error("scientific_review_claim_binding");
      if (!Array.isArray(row.passages) || row.passages.length > 12 || !row.passages.length) throw Error("scientific_review_passage_binding");
      if (!Array.isArray(c.sources) || !c.sources.every((source) => source && typeof source.url === "string" && hex(source.source_sha256))) throw Error("scientific_review_passage_binding");
      for (const p of row.passages) {
        if (!p || typeof p.url !== "string") throw Error("scientific_review_passage_binding");
        let u;
        try { u = new URL(p.url); } catch { throw Error("scientific_review_passage_binding"); }
        if (u.protocol !== "https:" || u.hostname !== "data.cms.gov" || u.username || u.password || u.port || typeof p.literal !== "string" || p.literal.length > 6e3 || !Number.isSafeInteger(p.page) || p.page < 1 || !hex(p.source_sha256) || !c.sources.some((s) => s.url === p.url && s.source_sha256 === p.source_sha256)) throw Error("scientific_review_passage_binding");
      }
    }
    const result = { record_id: id, generation, manifest_sha256: env.USHSO_SCIENTIFIC_REVIEW_MANIFEST_SHA256, owner_decision: null, publication_authorized: false, canonical_records_changed: 0, claims };
    const encoded = JSON.stringify(result);
    if (new TextEncoder().encode(encoded).byteLength > 60 * 1024) throw Error("scientific_review_response_limit");
    return reply(200, result);
  } catch (error) {
    return reply(503, null, ["scientific_review_pin_mismatch", "scientific_review_claim_binding", "scientific_review_passage_binding", "scientific_review_asset_limit"].includes(error.message) ? error.message : "scientific_review_unavailable");
  }
}
export {
  routeScientificReview
};
