import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const packet = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/source-selection-evidence/review-packet.json",
      import.meta.url,
    ),
  ),
);
test("priority proposals bind same-asset substantive observations without invented decisions", () => {
  const captures = new Map(packet.captures.map((c) => [c.capture_id, c]));
  const observations = new Map(
    packet.observations
      .filter((o) => o.capture_id)
      .map((o) => [o.capture_id, o]),
  );
  assert.equal(new Set(packet.proposals.map((p) => p.proposal_id)).size, 8);
  for (const p of packet.proposals) {
    assert.equal(p.decision, null);
    assert.equal(p.review_status, "pending");
    const privateRef = p.private_review_evidence;
    assert.match(privateRef.sha256, /^[a-f0-9]{64}$/);
    assert.match(privateRef.quote_hash, /^[a-f0-9]{64}$/);
    assert.ok(privateRef.locator.end > privateRef.locator.start);
    assert.ok(privateRef.locator.start >= 0);
    for (const ref of p.evidence_refs) {
      const c = captures.get(ref.capture_id),
        o = observations.get(ref.capture_id);
      assert.equal(c.asset_id, p.subject_id);
      assert.equal(o.status, "substantive");
      assert.match(o.receipt_sha256, /^[a-f0-9]{64}$/);
      assert.equal(p.observed_at, o.observed_at);
      assert.ok(ref.locator.length > 20);
      assert.equal(o.body_retained, true);
      assert.equal(o.formal_rights_status, "unresolved");
      assert.ok(o.byte_locators.length);
    }
  }
});
test("all eight sources retain separate unresolved action reviews and bounded retention", () => {
  assert.equal(new Set(packet.terms_evidence.map((t) => t.asset_id)).size, 8);
  for (const t of packet.terms_evidence)
    for (const action of [
      "metadata_capture",
      "store_bytes",
      "send_to_provider",
      "redistribute_excerpt",
      "publish_metadata",
    ])
      assert.equal(t.actions[action], "unresolved");
  for (const o of packet.observations) {
    if (o.derived_text_retained) {
      assert.ok(["meps", "meps_copyright"].includes(o.observation_id));
      assert.ok(o.retention_basis_url);
      assert.match(o.text_sha256, /^[a-f0-9]{64}$/);
    } else if (o.body_retained) {
      assert.equal(o.retention_mode, "private_review_bytes");
      assert.equal(o.formal_rights_status, "unresolved");
      assert.ok(o.private_body_path.startsWith("/workspace/build/"));
    } else assert.equal(o.retention_mode, "metadata_only");
  }
});
