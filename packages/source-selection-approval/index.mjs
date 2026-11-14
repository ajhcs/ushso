import {
  canonical,
  sha256,
  validateLedger,
} from "../source-selection/index.mjs";
export const digest = (value) => sha256(canonical(value));
export const ACTIONS = [
  "metadata_capture",
  "store_bytes",
  "publish_metadata",
  "send_to_provider",
  "redistribute_excerpt",
];
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const text = (x) =>
  typeof x === "string" &&
  x.trim() &&
  !["unassigned", "pending", "TBD"].includes(x);
const time = (x) =>
  typeof x === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x) &&
  Number.isFinite(Date.parse(x));
const hash = (x) => /^[a-f0-9]{64}$/.test(x || "");
const url = (x) => {
  try {
    return ["https:", "http:"].includes(new URL(x).protocol);
  } catch {
    return false;
  }
};
export function validatePacket(packet, ledger) {
  validateLedger(ledger);
  if (
    packet.schema_version !== "ushso.approval-packet.v1" ||
    packet.base_ledger_sha256 !== digest(ledger)
  )
    fail("stale_base_ledger");
  if (
    canonical(packet.scope_asset_ids?.slice().sort()) !==
    canonical(["asset_hcris", "asset_phc4"])
  )
    fail("invalid_publication_scope");
  if (
    !Array.isArray(packet.proposals) ||
    !packet.proposals.length ||
    !Array.isArray(packet.rights_reviews)
  )
    fail("invalid_packet");
  const ids = new Set();
  for (const p of packet.proposals) {
    if (
      !text(p.proposal_id) ||
      ids.has(p.proposal_id) ||
      !packet.scope_asset_ids.includes(p.subject_id) ||
      !text(p.proposer) ||
      !time(p.observed_at) ||
      !p.scope ||
      !Array.isArray(p.evidence_refs) ||
      !p.evidence_refs.length
    )
      fail("invalid_proposal");
    ids.add(p.proposal_id);
    for (const ref of p.evidence_refs) {
      const c = ledger.captures.find((c) => c.capture_id === ref.capture_id);
      if (
        !c ||
        c.asset_id !== p.subject_id ||
        Date.parse(c.retrieved_at) > Date.parse(p.observed_at)
      )
        fail("wrong_evidence_asset");
      if (c.retention_mode === "metadata_only" && !text(ref.locator))
        fail("invalid_locator");
      if (
        c.retention_mode === "bytes" &&
        (!Number.isSafeInteger(ref.locator?.start) ||
          !Number.isSafeInteger(ref.locator?.end) ||
          ref.locator.start < 0 ||
          ref.locator.end <= ref.locator.start ||
          !hash(ref.quote_hash))
      )
        fail("invalid_span");
    }
  }
  for (const id of packet.scope_asset_ids) {
    const rights = packet.rights_reviews.filter((r) => r.asset_id === id);
    if (
      rights.length !== 1 ||
      !packet.proposals.some(
        (p) => p.subject_id === id && p.predicate === "identity",
      )
    )
      fail("missing_identity_or_rights");
    const r = rights[0];
    if (
      !ledger.rights.some((x) => x.rights_id === r.source_rights_id) ||
      !url(r.terms_url) ||
      !text(r.scope) ||
      !Array.isArray(r.terms_evidence) ||
      !r.terms_evidence.length ||
      !time(r.expires_at) ||
      ACTIONS.some(
        (a) =>
          !["allowed", "prohibited", "unresolved"].includes(r.actions?.[a]),
      )
    )
      fail("invalid_rights_review");
    if (
      packet.proposals
        .filter((p) => p.subject_id === id)
        .some((p) =>
          p.evidence_refs.some(
            (ref) =>
              ledger.captures.find((c) => c.capture_id === ref.capture_id)
                .rights_id !== r.source_rights_id,
          ),
        )
    )
      fail("wrong_rights_asset");
  }
  const deferred = ledger.assets
    .filter((a) => !packet.scope_asset_ids.includes(a.asset_id))
    .map((a) => a.asset_id)
    .sort();
  if (
    canonical(packet.deferred_assets?.map((x) => x.asset_id).sort()) !==
      canonical(deferred) ||
    packet.deferred_assets.some(
      (x) => x.disposition !== "defer" || !text(x.reason),
    )
  )
    fail("missing_deferral");
  return true;
}
function actual(record, role, packetDigest, records, now) {
  if (!record || record.packet_digest !== packetDigest)
    fail("packet_digest_mismatch");
  if (
    record.evidence_class !== "actual_human" ||
    !text(record.attestation_ref) ||
    !text(record.reviewer) ||
    !text(record.reviewer_role) ||
    !text(record.rationale) ||
    !time(record.reviewed_at) ||
    Date.parse(record.reviewed_at) > Date.parse(now)
  )
    fail("actual_human_record_required");
  const appointment = records.operating_roles?.find(
    (x) =>
      x.person === record.reviewer &&
      x.role === record.reviewer_role &&
      x.capabilities?.includes(role),
  );
  if (
    !appointment ||
    appointment.packet_digest !== packetDigest ||
    appointment.evidence_class !== "actual_human" ||
    appointment.accepted !== true ||
    !text(appointment.attestation_ref) ||
    !text(appointment.capacity) ||
    !text(appointment.contact_private_ref) ||
    !time(appointment.accepted_at) ||
    Date.parse(appointment.accepted_at) > Date.parse(record.reviewed_at)
  )
    fail("role_not_accepted");
}
export function importReviewRecords(
  packet,
  ledger,
  records,
  { now = new Date().toISOString() } = {},
) {
  validatePacket(packet, ledger);
  const packetDigest = digest(packet),
    next = structuredClone(ledger);
  if (
    records.packet_digest !== packetDigest ||
    !Array.isArray(records.claim_decisions) ||
    !Array.isArray(records.rights_decisions)
  )
    fail("packet_digest_mismatch");
  const rightsByAsset = new Map(),
    seenRights = new Set(),
    seenClaims = new Set();
  for (const r of records.rights_decisions) {
    actual(r, "rights_review", packetDigest, records, now);
    const target = packet.rights_reviews.find((x) => x.asset_id === r.asset_id);
    if (
      !target ||
      seenRights.has(r.asset_id) ||
      r.rights_digest !== digest(target)
    )
      fail("rights_digest_mismatch");
    seenRights.add(r.asset_id);
    if (!["accept", "reject", "defer", "conflict"].includes(r.decision))
      fail("invalid_rights_decision");
    if (r.decision !== "accept") continue;
    if (
      Date.parse(r.reviewed_at) >= Date.parse(target.expires_at) ||
      Date.parse(now) >= Date.parse(target.expires_at) ||
      target.terms_evidence.some(
        (e) =>
          !url(e.url) ||
          !time(e.checked_at) ||
          Date.parse(e.checked_at) > Date.parse(r.reviewed_at) ||
          !text(e.locator) ||
          !hash(e.receipt_sha256) ||
          e.status !== "observed",
      )
    )
      fail("rights_not_current");
    const rights_id = `rights_review_${digest(r)}`;
    const right = {
      rights_id,
      terms_url: target.terms_url,
      checked_at: r.reviewed_at,
      reviewer: r.reviewer,
      reviewer_role: r.reviewer_role,
      scope: target.scope,
      expires_at: target.expires_at,
      actions: target.actions,
      approval_record: r,
    };
    next.rights.push(right);
    rightsByAsset.set(r.asset_id, right);
  }
  for (const r of records.claim_decisions) {
    actual(r, "claim_review", packetDigest, records, now);
    const p = packet.proposals.find((x) => x.proposal_id === r.proposal_id);
    if (!p || seenClaims.has(p.proposal_id) || r.proposal_digest !== digest(p))
      fail("proposal_digest_mismatch");
    seenClaims.add(p.proposal_id);
    if (r.reviewer === p.proposer) fail("self_review");
    if (
      !["accept", "reject", "defer", "conflict"].includes(r.decision) ||
      Date.parse(r.reviewed_at) < Date.parse(p.observed_at)
    )
      fail("invalid_claim_decision");
    const decision_id = `decision_review_${digest(r)}`;
    let refs = p.evidence_refs;
    if (r.decision === "accept") {
      const right = rightsByAsset.get(p.subject_id);
      if (
        !right ||
        right.actions.metadata_capture !== "allowed" ||
        right.actions.publish_metadata !== "allowed" ||
        r.source_support_confirmed !== true
      )
        fail("publication_rights_or_support_missing");
      refs = p.evidence_refs.map((ref) => {
        const old = ledger.captures.find(
          (c) => c.capture_id === ref.capture_id,
        );
        const capture_id = `capture_review_${digest({ old, right: right.rights_id })}`;
        const observation = packet.observations?.find(
          (o) => o.capture_id === old.capture_id,
        );
        const promote =
          right.actions.store_bytes === "allowed" &&
          ref.private_byte_locator &&
          observation?.body_retained;
        if (!next.captures.some((c) => c.capture_id === capture_id)) {
          const capture = { ...old, capture_id, rights_id: right.rights_id };
          if (promote) {
            delete capture.retention_reason;
            Object.assign(capture, {
              retention_mode: "bytes",
              sha256: observation.receipt_sha256,
              artifact_ref: `${observation.receipt_sha256}.html`,
              approval_original_capture_id: old.capture_id,
            });
          }
          next.captures.push(capture);
        }
        return promote
          ? {
              capture_id,
              locator: ref.private_byte_locator,
              quote_hash: ref.quote_hash,
            }
          : { ...ref, capture_id };
      });
    }
    const assertion_id = `assertion_review_${digest(r)}`;
    next.decisions.push({
      decision_id,
      decision: r.decision === "conflict" ? "defer" : r.decision,
      reviewer: r.reviewer,
      reviewer_role: r.reviewer_role,
      rationale: r.rationale,
      reviewed_at: r.reviewed_at,
      subject_id: p.subject_id,
      evidence_ids: refs.map((x) => x.capture_id),
      assertion_ids: r.decision === "accept" ? [assertion_id] : [],
      approval_record: r,
    });
    if (r.decision === "accept")
      next.assertions.push({
        assertion_id,
        decision_id,
        subject_id: p.subject_id,
        predicate: p.predicate,
        value: p.value,
        ...(p.null_reason ? { null_reason: p.null_reason } : {}),
        scope: p.scope,
        observed_at: p.observed_at,
        evidence_refs: refs,
      });
  }
  // Rights rejects, conflicts and deferrals are retained even though they grant nothing.
  const coreRecords = {
    packet_digest: records.packet_digest,
    operating_roles: records.operating_roles,
    rights_decisions: records.rights_decisions,
    claim_decisions: records.claim_decisions,
  };
  next.approval_imports = [
    ...(next.approval_imports || []),
    {
      packet_digest: packetDigest,
      records_digest: digest(coreRecords),
      records: structuredClone(coreRecords),
    },
  ];
  validateLedger(next);
  return next;
}
export function readiness(packet, ledger, records, options) {
  const blockers = [];
  let next;
  try {
    next = importReviewRecords(packet, ledger, records, options);
  } catch (e) {
    blockers.push(e.code || e.message);
  }
  for (const p of packet.proposals)
    if (
      !records.claim_decisions?.some(
        (r) => r.proposal_id === p.proposal_id && r.decision === "accept",
      )
    )
      blockers.push(`claim_not_accepted:${p.proposal_id}`);
  for (const a of packet.scope_asset_ids)
    if (
      !records.rights_decisions?.some(
        (r) => r.asset_id === a && r.decision === "accept",
      )
    )
      blockers.push(`rights_not_accepted:${a}`);
  blockers.push(
    ...readinessEvidence(
      packet,
      records,
      digest(packet),
      options?.now || new Date().toISOString(),
    ),
  );
  return {
    status: blockers.length ? "blocked" : "ready_for_generation_review",
    packet_digest: digest(packet),
    blockers,
    ledger_sha256: next ? digest(next) : null,
    production_authorized: false,
    paid_execution_authorized: false,
  };
}

export function validateGenerationApproval(
  approval,
  expected,
  { now = new Date().toISOString() } = {},
) {
  if (
    !approval ||
    approval.action !== "publish_exact_generation" ||
    approval.evidence_class !== "actual_human" ||
    !text(approval.approver) ||
    !text(approval.role) ||
    !text(approval.attestation_ref) ||
    !text(approval.rollback_ref) ||
    !time(approval.issued_at) ||
    !time(approval.expires_at) ||
    Date.parse(approval.issued_at) > Date.parse(now) ||
    Date.parse(approval.expires_at) <= Date.parse(now)
  )
    fail("generation_approval_missing");
  for (const key of [
    "generation_id",
    "ledger_revision",
    "bundle_hash",
    "rights_policy_hash",
  ])
    if (!hash(expected[key]) || approval[key] !== expected[key])
      fail("generation_approval_mismatch");
  if (!text(expected.target) || approval.target !== expected.target)
    fail("generation_target_mismatch");
  return true;
}

function readinessEvidence(packet, records, packetDigest, now) {
  const missing = [];
  const reviews = records.release_reviews || {};
  const check = (record, kind) => {
    try {
      actual(record, kind, packetDigest, records, now);
      return record.decision === "accept";
    } catch {
      return false;
    }
  };
  for (const p of packet.proposals) {
    const challenger = reviews.independent_challenges?.find(
      (x) => x.proposal_id === p.proposal_id,
    );
    const first = records.claim_decisions?.find(
      (x) => x.proposal_id === p.proposal_id,
    );
    if (
      !check(challenger, "independent_challenge") ||
      challenger.reviewer === first?.reviewer ||
      challenger.reviewer === p.proposer ||
      challenger.proposal_digest !== digest(p)
    )
      missing.push(`independent_challenge_missing:${p.proposal_id}`);
  }
  const retrieval = reviews.retrieval;
  if (
    !check(retrieval, "evaluation_review") ||
    retrieval.evidence_class !== "actual_human" ||
    !hash(retrieval.results_sha256) ||
    !text(retrieval.results_private_ref) ||
    !Array.isArray(retrieval.cases) ||
    retrieval.cases.length !== 12 ||
    new Set(retrieval.cases.map((c) => c.case_id)).size !== 12 ||
    retrieval.cases.some(
      (c) =>
        !/^R(0[1-9]|1[0-2])$/.test(c.case_id) ||
        ![0, 1, 2].includes(c.score) ||
        c.critical_error !== false,
    ) ||
    retrieval.cases.reduce((n, c) => n + c.score, 0) < 20
  )
    missing.push("actual_retrieval_evaluation_missing");
  const usability = reviews.usability;
  if (
    !check(usability, "evaluation_review") ||
    !hash(usability.results_sha256) ||
    !text(usability.results_private_ref) ||
    !text(usability.consent_private_ref) ||
    !time(usability.retention_until) ||
    !Array.isArray(usability.tasks) ||
    usability.tasks.length !== 6 ||
    new Set(usability.tasks.map((t) => t.participant_id)).size !== 3 ||
    usability.tasks.some((t) => !text(t.participant_id)) ||
    new Set(usability.tasks.map((t) => t.task_id)).size !== 6 ||
    usability.tasks.some(
      (t) =>
        !/^U0[1-6]$/.test(t.task_id) ||
        typeof t.unassisted_completion !== "boolean" ||
        t.false_authorization !== false,
    ) ||
    usability.tasks.filter((t) => t.unassisted_completion).length < 5
  )
    missing.push("actual_usability_evaluation_missing");
  const restore = reviews.restore;
  if (
    !check(restore, "technical_review") ||
    !hash(restore.receipt_sha256) ||
    !text(restore.receipt_ref) ||
    restore.outcome !== "pass"
  )
    missing.push("restore_evidence_missing");
  const ops = reviews.operations;
  if (
    !check(ops, "operational_acceptance") ||
    !text(ops.on_call_private_ref) ||
    !text(ops.capacity_private_ref) ||
    !text(ops.backup_private_ref)
  )
    missing.push("operational_acceptance_missing");
  return missing;
}
