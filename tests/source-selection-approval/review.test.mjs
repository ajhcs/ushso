import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  digest,
  importReviewRecords,
  readiness,
  validatePacket,
  validateGenerationApproval,
} from "../../packages/source-selection-approval/index.mjs";
const base = JSON.parse(
  await readFile(
    new URL(
      "../../docs/source-selection-approval/base-ledger.json",
      import.meta.url,
    ),
  ),
);
const draft = JSON.parse(
  await readFile(
    new URL(
      "../../docs/source-selection-approval/packet.json",
      import.meta.url,
    ),
  ),
);
const now = "2026-11-15T00:00:00Z";
// Synthetic records exercise validation mechanics only. They are never production evidence.
function fixture() {
  const packet = structuredClone(draft),
    ledger = structuredClone(base);
  for (const r of packet.rights_reviews) {
    r.actions.metadata_capture = "allowed";
    r.actions.publish_metadata = "allowed";
    r.terms_evidence = [
      {
        url: r.terms_url,
        checked_at: "2026-11-14T03:00:00Z",
        locator: "Synthetic test terms",
        receipt_sha256: "a".repeat(64),
        status: "observed",
      },
    ];
  }
  const pd = digest(packet),
    record = {
      packet_digest: pd,
      reviewer: "Test reviewer",
      reviewer_role: "Test role",
      reviewed_at: "2026-11-14T04:00:00Z",
      rationale: "Synthetic test only",
      evidence_class: "actual_human",
      attestation_ref: "fixture-only:never-use-as-evidence",
      decision: "accept",
    };
  const records = {
    packet_digest: pd,
    operating_roles: [
      {
        packet_digest: pd,
        person: "Test reviewer",
        role: "Test role",
        capabilities: ["claim_review", "rights_review"],
        accepted: true,
        accepted_at: "2026-11-14T03:00:00Z",
        capacity: "test only",
        contact_private_ref: "fixture-only",
        evidence_class: "actual_human",
        attestation_ref: "fixture-only",
      },
    ],
    rights_decisions: packet.rights_reviews.map((r) => ({
      ...record,
      asset_id: r.asset_id,
      rights_digest: digest(r),
    })),
    claim_decisions: packet.proposals.map((p) => ({
      ...record,
      proposal_id: p.proposal_id,
      proposal_digest: digest(p),
      source_support_confirmed: true,
    })),
  };
  return { packet, ledger, records };
}
test("unsigned real packet remains blocked without acceptance defaults", () => {
  validatePacket(draft, base);
  const r = readiness(
    draft,
    base,
    { packet_digest: digest(draft), claim_decisions: [], rights_decisions: [] },
    { now },
  );
  assert.equal(r.status, "blocked");
  assert.equal(r.production_authorized, false);
  assert.ok(r.blockers.includes("actual_retrieval_evaluation_missing"));
  assert.ok(r.blockers.includes("operational_acceptance_missing"));
});
test("imports append records with new immutable rights/capture IDs and preserves old unresolved rights", () => {
  const { packet, ledger, records } = fixture();
  const next = importReviewRecords(packet, ledger, records, { now });
  assert.equal(next.assertions.length, 8);
  assert.equal(next.rights[0].actions.metadata_capture, "unresolved");
  assert.equal(next.captures.length, ledger.captures.length + 2);
  assert.equal(readiness(packet, ledger, records, { now }).status, "blocked");
});
for (const [label, mutate, code] of [
  [
    "changed wording",
    (f) => (f.packet.proposals[0].value = "tampered"),
    "packet_digest_mismatch",
  ],
  [
    "stale base",
    (f) => (f.ledger.assets[0].title = "changed"),
    "stale_base_ledger",
  ],
  [
    "wrong asset",
    (f) =>
      (f.packet.proposals[0].evidence_refs[0].capture_id =
        "capture_20261114_phc4"),
    "wrong_evidence_asset",
  ],
  [
    "wrong locator shape",
    (f) =>
      (f.packet.proposals[0].evidence_refs[0].locator = { start: 0, end: 1 }),
    "invalid_locator",
  ],
  [
    "forged claim digest",
    (f) => (f.records.claim_decisions[0].proposal_digest = "0".repeat(64)),
    "proposal_digest_mismatch",
  ],
  [
    "no role acceptance",
    (f) => (f.records.operating_roles[0].accepted = false),
    "role_not_accepted",
  ],
  [
    "synthetic declared",
    (f) => (f.records.claim_decisions[0].evidence_class = "synthetic"),
    "actual_human_record_required",
  ],
  [
    "no actual support",
    (f) => (f.records.claim_decisions[0].source_support_confirmed = false),
    "publication_rights_or_support_missing",
  ],
  [
    "expired terms",
    (f) => {
      f.packet.rights_reviews[0].expires_at = "2026-11-14T03:00:00Z";
      rebind(f);
    },
    "rights_not_current",
  ],
  [
    "self review",
    (f) => {
      f.packet.proposals[0].proposer = "Test reviewer";
      rebind(f);
    },
    "self_review",
  ],
  [
    "rights changed without binding",
    (f) => (f.records.rights_decisions[0].rights_digest = "f".repeat(64)),
    "rights_digest_mismatch",
  ],
  [
    "future human timestamp",
    (f) => (f.records.claim_decisions[0].reviewed_at = "2030-01-01T00:00:00Z"),
    "actual_human_record_required",
  ],
])
  test(label, () => {
    const f = fixture();
    mutate(f);
    assert.throws(
      () => importReviewRecords(f.packet, f.ledger, f.records, { now }),
      (e) => e.code === code,
    );
  });
function rebind(f) {
  const pd = digest(f.packet);
  f.records.packet_digest = pd;
  for (const a of f.records.operating_roles) a.packet_digest = pd;
  for (const r of f.records.rights_decisions) {
    r.packet_digest = pd;
    r.rights_digest = digest(
      f.packet.rights_reviews.find((p) => p.asset_id === r.asset_id),
    );
  }
  for (const r of f.records.claim_decisions) {
    r.packet_digest = pd;
    r.proposal_digest = digest(
      f.packet.proposals.find((p) => p.proposal_id === r.proposal_id),
    );
  }
}
test("conflicts and deferrals are preserved without assertions", () => {
  const f = fixture();
  f.records.claim_decisions[0].decision = "conflict";
  f.records.claim_decisions[1].decision = "defer";
  const n = importReviewRecords(f.packet, f.ledger, f.records, { now });
  assert.equal(n.assertions.length, 6);
  assert.equal(n.decisions[0].decision, "defer");
  assert.equal(n.decisions[0].approval_record.decision, "conflict");
});
test("identity cannot be removed from publication packet", () => {
  const f = fixture();
  f.packet.proposals = f.packet.proposals.filter(
    (p) => p.predicate !== "identity",
  );
  assert.throws(
    () => validatePacket(f.packet, f.ledger),
    (e) => e.code === "missing_identity_or_rights",
  );
});
test("generation approval binds exact hashes target and expiry", () => {
  const expected = {
    generation_id: "a".repeat(64),
    ledger_revision: "b".repeat(64),
    bundle_hash: "c".repeat(64),
    rights_policy_hash: "d".repeat(64),
    target: "local-review",
  };
  const a = {
    ...expected,
    action: "publish_exact_generation",
    evidence_class: "actual_human",
    approver: "fixture",
    role: "fixture",
    attestation_ref: "fixture",
    rollback_ref: "fixture",
    issued_at: "2026-11-14T00:00:00Z",
    expires_at: "2026-11-16T00:00:00Z",
  };
  assert.equal(validateGenerationApproval(a, expected, { now }), true);
  assert.throws(() =>
    validateGenerationApproval(
      { ...a, bundle_hash: "e".repeat(64) },
      expected,
      { now },
    ),
  );
  assert.throws(() =>
    validateGenerationApproval({ ...a, target: "production" }, expected, {
      now,
    }),
  );
  assert.throws(() =>
    validateGenerationApproval(a, expected, { now: "2026-11-17T00:00:00Z" }),
  );
});
test("offset expiry cannot bypass UTC review deadline", () => {
  const f = fixture();
  f.packet.rights_reviews[0].expires_at = "2026-11-15T13:00:00+14:00";
  rebind(f);
  assert.throws(
    () => importReviewRecords(f.packet, f.ledger, f.records, { now }),
    (e) => e.code === "invalid_rights_review",
  );
});
test("retained bytes and exact spans are checked before staging", async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { verifyPrivateEvidence, stageApprovedBytes } =
    await import("../../packages/source-selection-approval/artifacts.mjs");
  const tmp =
    process.env.TMPDIR ||
    "/workspace/build/builderbob/ushso-publication-ai/tmp";
  await mkdir(tmp, { recursive: true });
  const root = await mkdtemp(join(tmp, "approval-test-"));
  try {
    const body = Buffer.from("exact claim evidence");
    const path = join(root, "body.html");
    await writeFile(path, body);
    const { sha256 } =
      await import("../../packages/source-selection/index.mjs");
    const packet = {
      observations: [
        {
          capture_id: "c",
          body_retained: true,
          private_body_path: path,
          receipt_sha256: sha256(body),
        },
      ],
      proposals: [
        {
          evidence_refs: [
            {
              capture_id: "c",
              private_byte_locator: { start: 0, end: 5 },
              quote_hash: sha256(body.subarray(0, 5)),
            },
          ],
        },
      ],
    };
    await verifyPrivateEvidence(packet);
    packet.proposals[0].evidence_refs[0].private_byte_locator.end = 6;
    await assert.rejects(
      verifyPrivateEvidence(packet),
      (e) => e.code === "private_evidence_span_mismatch",
    );
    packet.proposals[0].evidence_refs[0].private_byte_locator.end = 5;
    await writeFile(path, "changed");
    await assert.rejects(
      verifyPrivateEvidence(packet),
      (e) => e.code === "private_evidence_hash_mismatch",
    );
    await writeFile(path, body);
    const ledger = {
      captures: [
        {
          capture_id: "new",
          approval_original_capture_id: "c",
          retention_mode: "bytes",
          sha256: sha256(body),
          artifact_ref: `${sha256(body)}.html`,
        },
      ],
    };
    await stageApprovedBytes(join(root, "ledger"), ledger, packet);
    assert.deepEqual(
      await readFile(
        join(root, "ledger", "captures", ledger.captures[0].artifact_ref),
      ),
      body,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("production handoff enforces human readiness exact ledger restore inventory and final approval", async () => {
  const { buildProductionHandoff } =
    await import("../../packages/source-selection-approval/handoff.mjs");
  const { createDataManifest, projectLedger } =
    await import("../../packages/source-selection/index.mjs");
  const f = fixture();
  f.records.operating_roles[0].capabilities.push(
    "evaluation_review",
    "technical_review",
    "operational_acceptance",
    "release_authorization",
  );
  f.records.operating_roles.push({
    ...f.records.operating_roles[0],
    person: "Independent fixture",
    capabilities: ["independent_challenge"],
  });
  const core = { ...f.records.claim_decisions[0] };
  delete core.proposal_id;
  delete core.proposal_digest;
  const ledger = importReviewRecords(f.packet, f.ledger, f.records, { now }),
    rightsPolicy = { revoked_rights: [] };
  const m = createDataManifest({
    ledgerRevision: digest(ledger),
    ledgerHash: digest(ledger),
    evidenceHash: digest(ledger.captures),
    rightsHash: digest(rightsPolicy),
    schemaHashes: { test: "f".repeat(64) },
  });
  const bundle = {
    data_manifest: m.manifest,
    views: projectLedger(ledger, m.generation_id),
    rights_expire_at: "2026-12-14T00:00:00Z",
  };
  const exact = {
    generation_id: m.generation_id,
    ledger_revision: digest(ledger),
    bundle_hash: digest(bundle),
    rights_policy_hash: digest(rightsPolicy),
    target: "fixture-production",
  };
  const retainedManifest = { inventory_sha256: "a".repeat(64), files: [] };
  const restoreReceipt = {
    schema_version: "ushso.local-restore-rehearsal.v1",
    status: "PASS",
    inventory_after_smoke_verified: true,
    inventory_sha256: retainedManifest.inventory_sha256,
    accepted_publication: {
      status: "available",
      generation_id: exact.generation_id,
      bundle_hash: exact.bundle_hash,
      revision: exact.ledger_revision,
      rights_hash: exact.rights_policy_hash,
      bundle,
    },
  };
  f.records.release_reviews = {
    independent_challenges: f.packet.proposals.map((p) => ({
      ...core,
      reviewer: "Independent fixture",
      proposal_id: p.proposal_id,
      proposal_digest: digest(p),
    })),
    retrieval: {
      ...core,
      results_sha256: "a".repeat(64),
      results_private_ref: "fixture",
      cases: Array.from({ length: 12 }, (_, i) => ({
        case_id: `R${String(i + 1).padStart(2, "0")}`,
        score: 2,
        critical_error: false,
      })),
    },
    usability: {
      ...core,
      results_sha256: "a".repeat(64),
      results_private_ref: "fixture",
      consent_private_ref: "fixture",
      retention_until: "2027-01-01T00:00:00Z",
      tasks: Array.from({ length: 6 }, (_, i) => ({
        task_id: `U0${i + 1}`,
        participant_id: `fixture-participant-${i % 3}`,
        unassisted_completion: true,
        false_authorization: false,
      })),
    },
    restore: {
      ...core,
      receipt_ref: "fixture",
      receipt_sha256: digest(restoreReceipt),
      outcome: "pass",
    },
    operations: {
      ...core,
      on_call_private_ref: "fixture",
      capacity_private_ref: "fixture",
      backup_private_ref: "fixture",
    },
  };
  const approval = {
    ...exact,
    inventory_sha256: retainedManifest.inventory_sha256,
    action: "publish_exact_generation",
    evidence_class: "actual_human",
    approver: "Test reviewer",
    role: "Test role",
    attestation_ref: "fixture",
    rollback_ref: "fixture",
    issued_at: "2026-11-14T05:00:00Z",
    expires_at: "2026-11-16T00:00:00Z",
  };
  const args = {
    packet: f.packet,
    baseLedger: f.ledger,
    records: f.records,
    ledger,
    bundle,
    rightsPolicy,
    restoreReceipt,
    retainedManifest,
    approval,
    target: exact.target,
    now,
  };
  assert.equal(buildProductionHandoff(args).status, "approved_handoff");
  assert.throws(() => buildProductionHandoff({...args, approval: {...approval, approver: "Unknown reviewer"}}), e => e.code === "release_authorizer_not_appointed");
  assert.throws(() => buildProductionHandoff({...args, approval: {...approval, issued_at: "2026-11-14T03:30:00Z"}}), e => e.code === "release_approval_precedes_evidence");

  assert.throws(
    () =>
      buildProductionHandoff({
        ...args,
        restoreReceipt: { ...restoreReceipt, inventory_sha256: "b".repeat(64) },
      }),
    (e) => e.code === "restore_receipt_mismatch",
  );
  assert.throws(
    () =>
      buildProductionHandoff({
        ...args,
        approval: { ...approval, target: "different" },
      }),
    (e) => e.code === "generation_target_mismatch",
  );
  const bad = structuredClone(f.records);
  bad.release_reviews.independent_challenges[0].reviewer = "Test reviewer";
  assert.throws(
    () => buildProductionHandoff({ ...args, records: bad }),
    (e) => e.code === "human_readiness_blocked",
  );
});
