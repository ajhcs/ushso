import { createHash } from 'node:crypto';
import { proposalHash } from './validate-claims.mjs';

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function buildClaimReviewPacket({
  recordId,
  field,
  sourceId,
  before = null,
  after,
  release,
  context,
  quotation,
  span,
  parserVersion,
  modelVersion,
  disagreement = false,
  affectedProducts = [],
  affectedExamples = [],
  sourceBytes,
  proposal,
  cause = 'source_document_interpretation',
  owner = 'Astra/root',
  nextStep = 'review_exact_claim',
  essential = true,
  lane,
} = {}) {
  if (!field) fail('FIELD_REQUIRED');
  if (!recordId) fail('RECORD_REQUIRED');
  if (field === '*' || recordId === '*' || sourceId === '*') fail('WHOLE_DATASET_APPROVAL_FORBIDDEN');
  const packet = {
    format: 'ushso.claim-review-packet.v1',
    packet_id: `packet:${sha({ recordId, field, sourceId, after, quotation, span }).slice(0, 24)}`,
    record_id: recordId,
    field,
    source_id: sourceId,
    before,
    after,
    release,
    context,
    quotation,
    span,
    parser_version: parserVersion,
    model_version: modelVersion,
    disagreement,
    affected_products: freeze([...(affectedProducts ?? [])]),
    affected_examples: freeze([...(affectedExamples ?? [])]),
    source_bytes_sha256: sha(sourceBytes ?? ''),
    proposal_hash: proposal ? proposalHash(proposal) : sha({ after, quotation, span }),
    cause,
    owner,
    next_step: nextStep,
    essential,
    lane: lane ?? (cause === 'owner_disclosure' ? 'owner_disclosure' : 'source_document_interpretation'),
    asks_whole_dataset: false,
    public_fact: false,
  };
  packet.packet_hash = sha({
    packet_id: packet.packet_id,
    record_id: packet.record_id,
    field: packet.field,
    source_id: packet.source_id,
    before: packet.before,
    after: packet.after,
    quotation: packet.quotation,
    span: packet.span,
    source_bytes_sha256: packet.source_bytes_sha256,
    proposal_hash: packet.proposal_hash,
  });
  return freeze(packet);
}

export function groupIdenticalEvidence(packets) {
  const groups = new Map();
  for (const packet of packets) {
    const key = `${packet.source_bytes_sha256}:${packet.quotation}:${packet.span?.start}:${packet.span?.end}`;
    const current = groups.get(key) ?? [];
    current.push(packet.packet_id);
    groups.set(key, current);
  }
  return freeze([...groups.entries()].map(([evidence_key, packet_ids]) => freeze({
    evidence_key,
    packet_ids: freeze(packet_ids),
    merged_source_identities: false,
    distinct_source_ids: freeze([...new Set(packets.filter((row) => packet_ids.includes(row.packet_id)).map((row) => row.source_id))]),
  })));
}

export function replayPacketValidation(packet, validate) {
  return validate(packet);
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

export function claimPriority(cause) {
  return CLAIM_PRIORITY[cause] ?? 20;
}

export function enqueueClaimPackets(packets, { now = '2026-09-14T00:00:00.000Z' } = {}) {
  const items = packets.map((row) => freeze({
    queue_item_id: `claim-review:${row.packet_id}`,
    packet_id: row.packet_id,
    record_id: row.record_id,
    field: row.field,
    source_id: row.source_id,
    priority: claimPriority(row.cause),
    cause: row.cause,
    owner: row.owner ?? 'Astra/root',
    next_step: row.next_step ?? 'review_exact_claim',
    essential: row.essential !== false,
    lane: row.lane ?? (row.cause === 'owner_disclosure' ? 'owner_disclosure' : 'source_document_interpretation'),
    state: 'pending',
    public_fact: false,
    enqueued_at: now,
    packet_hash: row.packet_hash,
    source_bytes_sha256: row.source_bytes_sha256,
    proposal_hash: row.proposal_hash,
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
