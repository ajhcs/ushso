import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { routeScientificReview } from "../worker/scientific-review-router.mjs";
const sha = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
function fixture() {
  const record = { record_id: "record-1", title: "Public aggregate" }, claim = { claim_id: "SCI-04:test", card_id: "SCI-04", record_id: "record-1", generation: "generation-1", baseline_record_sha256: sha(record), field_path: "/evidence/-", proposed_value: { text: "Pending literal draft", state: "pending_owner_review" }, sources: [{ url: "https://data.cms.gov/dictionary.pdf", source_sha256: "a".repeat(64) }], promotion_policy: "owner_scoped_note_only", owner_decision: null };
  const { owner_decision, ...subject } = claim;
  claim.proposal_sha256 = sha(subject);
  const bytes = JSON.stringify({ schema: "ushso.scientific-review-assets.v1", generation: "generation-1", owner_decision: null, publication_authorized: false, claims: [{ claim, passages: [{ url: claim.sources[0].url, source_sha256: "a".repeat(64), page: 1, literal: "Public publisher passage" }] }] });
  return { record, env: { USHSO_SCIENTIFIC_REVIEW: "enabled", USHSO_SCIENTIFIC_REVIEW_MANIFEST_SHA256: sha(bytes), ASSETS: { fetch: async () => new Response(bytes) } }, loadCatalog: async () => ({ records: [record], corpus: { publication: { generation: "generation-1" } } }) };
}
function pinnedFixture({ sources, digest = "a".repeat(64), passageOverride } = {}) {
  const record = { record_id: "record-1", title: "Public aggregate" }, url = "https://data.cms.gov/dictionary.pdf", claim = { claim_id: "SCI-04:test", card_id: "SCI-04", record_id: "record-1", generation: "generation-1", baseline_record_sha256: sha(record), field_path: "/evidence/-", proposed_value: { text: "Pending literal draft", state: "pending_owner_review" }, sources: sources !== undefined ? sources : [{ url, source_sha256: digest }], promotion_policy: "owner_scoped_note_only", owner_decision: null };
  const { owner_decision, ...subject } = claim;
  claim.proposal_sha256 = sha(subject);
  const bytes = JSON.stringify({ schema: "ushso.scientific-review-assets.v1", generation: "generation-1", owner_decision: null, publication_authorized: false, claims: [{ claim, passages: [passageOverride === undefined ? { url, source_sha256: digest, page: 1, literal: "Public publisher passage" } : passageOverride] }] });
  return { record, env: { USHSO_SCIENTIFIC_REVIEW: "enabled", USHSO_SCIENTIFIC_REVIEW_MANIFEST_SHA256: sha(bytes), ASSETS: { fetch: async () => new Response(bytes) } }, loadCatalog: async () => ({ records: [record], corpus: { publication: { generation: "generation-1" } } }) };
}
const request = (query) => new Request("http://local.test/api/research/v1/scientific-review?" + new URLSearchParams({ record_id: "record-1", generation: "generation-1", ...query }));
async function reviewBody(f) {
  const response = await routeScientificReview(request(), f.env, f);
  return { status: response.status, body: await response.json() };
}
test("scientific preview disabled by default, no request-controlled enablement", async () => {
  const f = fixture();
  assert.equal((await routeScientificReview(request({ enabled: "true" }), {}, f)).status, 404);
});
test("exact pending review responds without mutating catalog or approving claims", async () => {
  const f = fixture(), before = JSON.stringify(f.record), response = await routeScientificReview(request(), f.env, f), body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.result.owner_decision, null);
  assert.equal(body.result.publication_authorized, false);
  assert.equal(JSON.stringify(f.record), before);
  assert.equal(body.result.claims[0].claim.proposed_value.text, "Pending literal draft");
});
test("scientific preview rejects wrong pin, generation, record identity and query switches", async () => {
  const f = fixture();
  assert.equal((await routeScientificReview(request(), { ...f.env, USHSO_SCIENTIFIC_REVIEW_MANIFEST_SHA256: "b".repeat(64) }, f)).status, 503);
  assert.equal((await routeScientificReview(request({ generation: "wrong" }), f.env, f)).status, 409);
  f.record.title = "Changed";
  assert.equal((await routeScientificReview(request(), f.env, f)).status, 503);
  assert.equal((await routeScientificReview(request({ enabled: "true" }), f.env, f)).status, 400);
});
test("malformed source digests and collections fail at passage binding with recomputed pins", async () => {
  const url = "https://data.cms.gov/dictionary.pdf", hex64 = "a".repeat(64), got = [];
  for (const f of [
    pinnedFixture({ digest: "A".repeat(64) }),
    pinnedFixture({ digest: "g".repeat(64) }),
    pinnedFixture({ digest: "a".repeat(63) }),
    pinnedFixture({ sources: null }),
    pinnedFixture({ sources: { url, source_sha256: hex64 } }),
    pinnedFixture({ sources: [null] })
  ]) {
    const r = await reviewBody(f);
    got.push({ status: r.status, code: r.body.error?.code ?? null });
  }
  assert.deepEqual(got, Array(6).fill({ status: 503, code: "scientific_review_passage_binding" }));
});
test("mixed malformed and valid sources fail closed", async () => {
  const url = "https://data.cms.gov/dictionary.pdf", hex64 = "a".repeat(64), r = await reviewBody(pinnedFixture({ sources: [null, { url, source_sha256: hex64 }] }));
  assert.deepEqual({ status: r.status, code: r.body.error?.code ?? null, owner: r.body.result?.owner_decision ?? null, published: r.body.result?.publication_authorized ?? null }, { status: 503, code: "scientific_review_passage_binding", owner: null, published: null });
});

test("missing digests and malformed passage identities return typed failures", async (t) => {
  const url = "https://data.cms.gov/dictionary.pdf";
  for (const [name, options] of [
    ["null digest", { digest: null }],
    ["missing source digest", { sources: [{ url }] }],
    ["null passage", { passageOverride: null }],
    ["missing passage URL", { passageOverride: {} }],
    ["invalid passage URL", { passageOverride: { url: "invalid" } }],
    ["missing passage digest", { passageOverride: { url, page: 1, literal: "Text" } }]
  ]) await t.test(name, async () => {
    const r = await reviewBody(pinnedFixture(options));
    assert.deepEqual({ status: r.status, code: r.body.error?.code }, { status: 503, code: "scientific_review_passage_binding" });
  });
});
