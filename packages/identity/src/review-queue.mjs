import { assert, uniqueSorted } from "./common.mjs";
import { automaticAssessmentIsBound } from "./projection-rebuilder.mjs";

const TERMINAL_DECISIONS = new Set(["same_identity", "not_same_identity", "family_member", "mirror_of", "successor_of"]);

const PRIORITY = Object.freeze({
  authoritative_conflict: 100,
  parent_campus_or_system_ambiguity: 90,
  temporal_or_reuse_uncertainty: 80,
  incompatible_entity_or_grain: 70,
  exact_candidate_gate_disabled: 60,
  fuzzy_candidate: 40,
  deferred: 20,
});

function classify(candidate, policyReasons) {
  const reasons = new Set(policyReasons);
  if (candidate.conflicting_assertion_ids?.length || reasons.has("no_authoritative_conflict")) return "authoritative_conflict";
  if (reasons.has("parent_campus_or_system_ambiguity")) return "parent_campus_or_system_ambiguity";
  if (["identifier_reuse_not_prohibited", "effective_dates_incomplete", "effective_periods_do_not_overlap"].some((reason) => reasons.has(reason))) return "temporal_or_reuse_uncertainty";
  if (reasons.has("entity_type_compatible") || reasons.has("grain_compatible")) return "incompatible_entity_or_grain";
  if (candidate.state === "deferred") return "deferred";
  if (candidate.features?.some((feature) => feature.feature_kind === "exact_identifier")) return "exact_candidate_gate_disabled";
  return "fuzzy_candidate";
}

export function buildReviewQueue(candidates, { currentDecisions = new Map(), assessments = [], authorizedEnablementReceiptIds = [] } = {}) {
  const assessmentByCandidate = new Map();
  for (const assessment of assessments) {
    assert(!assessmentByCandidate.has(assessment.candidate_id), "Policy assessments must be unique by candidate", "duplicate_policy_assessment");
    assessmentByCandidate.set(assessment.candidate_id, assessment);
  }
  return candidates
    .filter((candidate) => {
      const currentDecision = currentDecisions.get(candidate.candidate_id);
      if (currentDecision && !TERMINAL_DECISIONS.has(currentDecision.decision)) return true;
      if (currentDecision) return false;
      if (["open", "deferred"].includes(candidate.state)) return true;
      return candidate.state === "accepted"
        && candidate.resolution_mode === "automatic_exact_policy"
        && !automaticAssessmentIsBound(candidate, assessmentByCandidate.get(candidate.candidate_id), authorizedEnablementReceiptIds);
    })
    .map((candidate) => {
      const policyReasons = assessmentByCandidate.get(candidate.candidate_id)?.reasons ?? [];
      const reason = classify(candidate, policyReasons);
      return {
        queue_item_id: `review:${candidate.candidate_id}`,
        candidate_id: candidate.candidate_id,
        object_ids: uniqueSorted([candidate.object_a_id, candidate.object_b_id]),
        priority: PRIORITY[reason],
        reason,
        state: "pending_external_review",
        policy_reasons: uniqueSorted(policyReasons),
      };
    })
    .sort((left, right) => right.priority - left.priority || left.candidate_id.localeCompare(right.candidate_id));
}

export const CLAIM_DISPOSITIONS = Object.freeze(['accept', 'reject', 'request_evidence', 'supersede']);
export const CLAIM_PRIORITY = Object.freeze({
  identity_conflict: 100,
  grain_conflict: 90,
  denominator: 80,
  scientific_unit: 70,
  source_document_interpretation: 40,
  owner_disclosure: 30,
});

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function claimPriority(cause) {
  return CLAIM_PRIORITY[cause] ?? 20;
}

export function enqueueClaimPackets(packets, { now = '2026-09-14T00:00:00.000Z' } = {}) {
  const items = packets.map((packet) => freeze({
    queue_item_id: `claim-review:${packet.packet_id}`,
    packet_id: packet.packet_id,
    record_id: packet.record_id,
    field: packet.field,
    source_id: packet.source_id,
    priority: claimPriority(packet.cause),
    cause: packet.cause,
    owner: packet.owner ?? 'Astra/root',
    next_step: packet.next_step ?? 'review_exact_claim',
    essential: packet.essential !== false,
    lane: packet.lane ?? (packet.cause === 'owner_disclosure' ? 'owner_disclosure' : 'source_document_interpretation'),
    state: 'pending',
    public_fact: false,
    enqueued_at: now,
    packet_hash: packet.packet_hash,
    source_bytes_sha256: packet.source_bytes_sha256,
    proposal_hash: packet.proposal_hash,
  }));
  return freeze(items.sort((left, right) => right.priority - left.priority || left.packet_id.localeCompare(right.packet_id)));
}

export function recordClaimDisposition(item, disposition, { reviewer, rationale, now = '2026-09-14T00:00:00.000Z', currentPacketHash, currentSourceBytesSha256, currentProposalHash } = {}) {
  if (!CLAIM_DISPOSITIONS.includes(disposition)) fail('UNKNOWN_DISPOSITION');
  if (item.asks_whole_dataset === true) fail('WHOLE_DATASET_APPROVAL_FORBIDDEN');
  if (!reviewer) fail('REVIEWER_REQUIRED');
  if (!rationale) fail('RATIONALE_REQUIRED');
  if (currentPacketHash && currentPacketHash !== item.packet_hash) fail('STALE_PACKET');
  if (currentSourceBytesSha256 && currentSourceBytesSha256 !== item.source_bytes_sha256) fail('STALE_SOURCE_BYTES');
  if (currentProposalHash && currentProposalHash !== item.proposal_hash) fail('STALE_PROPOSAL');
  return freeze({
    ...item,
    state: disposition === 'request_evidence' ? 'pending' : disposition,
    disposition,
    reviewer,
    rationale,
    decided_at: now,
    public_fact: false,
  });
}

export function invalidateStaleDisposition(decision, { packetHash, sourceBytesSha256, proposalHash }) {
  if (decision.packet_hash !== packetHash || decision.source_bytes_sha256 !== sourceBytesSha256 || decision.proposal_hash !== proposalHash) {
    return freeze({ ...decision, state: 'invalidated', inherited_approval: false, public_fact: false, reason: 'SOURCE_OR_PROPOSAL_CHANGED' });
  }
  return decision;
}

export function reportClaimQueue(items, { now = '2026-09-14T01:00:00.000Z' } = {}) {
  const pending = items.filter((row) => row.state === 'pending');
  const missing = pending.filter((row) => row.essential && (!row.owner || !row.next_step));
  if (missing.length) fail('PENDING_ESSENTIAL_FIELD_UNOWNED');
  if (items.some((row) => row.public_fact === true && row.state === 'pending')) fail('PENDING_NOT_PUBLIC_FACT');
  const ageHours = (row) => (Date.parse(now) - Date.parse(row.enqueued_at ?? now)) / 36e5;
  return freeze({
    pending_count: pending.length,
    accepted_count: items.filter((row) => row.state === 'accept').length,
    rejected_count: items.filter((row) => row.state === 'reject').length,
    request_evidence_count: items.filter((row) => row.disposition === 'request_evidence').length,
    items: freeze(items.map((row) => freeze({
      packet_id: row.packet_id,
      field: row.field,
      cause: row.cause,
      priority: row.priority,
      owner: row.owner,
      next_step: row.next_step,
      lane: row.lane,
      age_hours: ageHours(row),
      state: row.state,
      public_fact: false,
    }))),
    pending_are_public_facts: false,
    whole_dataset_approval: false,
  });
}
