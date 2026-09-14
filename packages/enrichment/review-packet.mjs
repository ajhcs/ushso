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
