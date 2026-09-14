import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  enqueueClaimPackets,
  invalidateStaleDisposition,
  recordClaimDisposition,
  reportClaimQueue,
} from '../../packages/identity/src/review-queue.mjs';
import { buildClaimReviewPacket, groupIdenticalEvidence } from '../../packages/enrichment/review-packet.mjs';
import { quoteSupported } from '../../packages/enrichment/validate-claims.mjs';

const sourceA = 'Crude prevalence is the percent of adults.';
const sourceB = 'S0101_C01_001E: Total population';

test('a reviewer can accept one field while leaving others unresolved and packet hashes bind reviewed values', () => {
  const definition = buildClaimReviewPacket({
    recordId: 'obs:asset:cdc-socrata:example',
    field: 'definition',
    sourceId: 'cdc-socrata',
    before: null,
    after: 'percent of adults',
    release: 'places-2023',
    context: 'PLACES local estimates',
    quotation: 'percent of adults',
    span: { start: sourceA.indexOf('percent of adults'), end: sourceA.indexOf('percent of adults') + 'percent of adults'.length },
    parserVersion: 'pr025-task-builder',
    modelVersion: 'deepseek/deepseek-chat',
    disagreement: false,
    affectedProducts: ['places-card'],
    affectedExamples: ['example:cdc-definition'],
    sourceBytes: sourceA,
    proposal: { field: 'definition', value: 'percent of adults', quotation: 'percent of adults', span: { start: 24, end: 41 }, passage_ids: ['source'], claim_type: 'definition' },
    cause: 'source_document_interpretation',
  });
  const unit = buildClaimReviewPacket({
    recordId: 'obs:asset:cdc-socrata:example',
    field: 'unit',
    sourceId: 'cdc-socrata',
    after: 'percent',
    release: 'places-2023',
    quotation: 'percent',
    span: { start: sourceA.indexOf('percent'), end: sourceA.indexOf('percent') + 'percent'.length },
    parserVersion: 'pr025-task-builder',
    modelVersion: 'deepseek/deepseek-chat',
    disagreement: true,
    sourceBytes: sourceA,
    proposal: { field: 'unit', value: 'percent', quotation: 'percent', span: { start: 24, end: 31 }, passage_ids: ['source'], claim_type: 'unit' },
    cause: 'scientific_unit',
  });
  const queue = enqueueClaimPackets([definition, unit]);
  const accepted = recordClaimDisposition(queue.find((row) => row.field === 'definition'), 'accept', {
    reviewer: 'Astra/root',
    rationale: 'Quoted span matches the capture for this field only.',
    currentPacketHash: definition.packet_hash,
    currentSourceBytesSha256: definition.source_bytes_sha256,
    currentProposalHash: definition.proposal_hash,
  });
  const leftover = queue.find((row) => row.field === 'unit');
  assert.equal(accepted.state, 'accept');
  assert.equal(leftover.state, 'pending');
  assert.equal(accepted.public_fact, false);
  const again = buildClaimReviewPacket({
    recordId: 'obs:asset:cdc-socrata:example',
    field: 'definition',
    sourceId: 'cdc-socrata',
    before: null,
    after: 'percent of adults',
    release: 'places-2023',
    context: 'PLACES local estimates',
    quotation: 'percent of adults',
    span: { start: sourceA.indexOf('percent of adults'), end: sourceA.indexOf('percent of adults') + 'percent of adults'.length },
    parserVersion: 'pr025-task-builder',
    modelVersion: 'deepseek/deepseek-chat',
    affectedProducts: ['places-card'],
    affectedExamples: ['example:cdc-definition'],
    sourceBytes: sourceA,
    proposal: { field: 'definition', value: 'percent of adults', quotation: 'percent of adults', span: { start: 24, end: 41 }, passage_ids: ['source'], claim_type: 'definition' },
    cause: 'source_document_interpretation',
  });
  assert.equal(definition.packet_hash, again.packet_hash);
  const replay = quoteSupported({ source_bytes: sourceA }, definition.quotation, definition.span);
  assert.equal(replay, true);
});

test('identical evidence is grouped without merging source identities; stale source bytes invalidate approval', () => {
  const cdc = buildClaimReviewPacket({
    recordId: 'obs:asset:cdc-socrata:example',
    field: 'definition',
    sourceId: 'cdc-socrata',
    after: 'percent of adults',
    quotation: 'percent of adults',
    span: { start: 24, end: 41 },
    sourceBytes: sourceA,
    parserVersion: 'v1',
    modelVersion: 'none',
  });
  const census = buildClaimReviewPacket({
    recordId: 'obs:asset:census-api:example',
    field: 'label',
    sourceId: 'census-api',
    after: 'Total population',
    quotation: 'Total population',
    span: { start: sourceB.indexOf('Total population'), end: sourceB.indexOf('Total population') + 'Total population'.length },
    sourceBytes: sourceB,
    parserVersion: 'v1',
    modelVersion: 'none',
    cause: 'identity_conflict',
  });
  const sameEvidence = buildClaimReviewPacket({
    recordId: 'obs:asset:cdc-socrata:mirror',
    field: 'definition',
    sourceId: 'cdc-socrata',
    after: 'percent of adults',
    quotation: 'percent of adults',
    span: { start: 24, end: 41 },
    sourceBytes: sourceA,
    parserVersion: 'v1',
    modelVersion: 'none',
  });
  const groups = groupIdenticalEvidence([cdc, census, sameEvidence]);
  const cdcGroup = groups.find((row) => row.packet_ids.includes(cdc.packet_id));
  assert.equal(cdcGroup.merged_source_identities, false);
  assert.ok(cdcGroup.packet_ids.includes(sameEvidence.packet_id));
  assert.ok(!cdcGroup.packet_ids.includes(census.packet_id));
  const queued = enqueueClaimPackets([cdc]);
  const accepted = recordClaimDisposition(queued[0], 'accept', {
    reviewer: 'Astra/root',
    rationale: 'Exact quoted span for this one field.',
    currentPacketHash: cdc.packet_hash,
    currentSourceBytesSha256: cdc.source_bytes_sha256,
    currentProposalHash: cdc.proposal_hash,
  });
  const changed = createHash('sha256').update(sourceA + ' revised').digest('hex');
  const stale = invalidateStaleDisposition(accepted, {
    packetHash: cdc.packet_hash,
    sourceBytesSha256: changed,
    proposalHash: cdc.proposal_hash,
  });
  assert.equal(stale.state, 'invalidated');
  assert.equal(stale.inherited_approval, false);
  assert.throws(() => recordClaimDisposition(queued[0], 'accept', {
    reviewer: 'Astra/root',
    rationale: 'Trying to inherit after bytes changed.',
    currentPacketHash: cdc.packet_hash,
    currentSourceBytesSha256: changed,
    currentProposalHash: cdc.proposal_hash,
  }), { code: 'STALE_SOURCE_BYTES' });
});

test('pending essential fields have owners; reports never call pending proposals public facts; whole datasets cannot be approved', () => {
  const packet = buildClaimReviewPacket({
    recordId: 'obs:asset:census-api:example',
    field: 'label',
    sourceId: 'census-api',
    after: 'Total population',
    quotation: 'Total population',
    span: { start: 16, end: 32 },
    sourceBytes: sourceB,
    parserVersion: 'v1',
    modelVersion: 'none',
    cause: 'grain_conflict',
    owner: 'Astra/root',
    nextStep: 'adjudicate_grain',
  });
  const items = enqueueClaimPackets([packet]);
  const report = reportClaimQueue(items);
  assert.equal(report.pending_are_public_facts, false);
  assert.equal(report.whole_dataset_approval, false);
  assert.equal(report.items[0].owner, 'Astra/root');
  assert.equal(report.items[0].next_step, 'adjudicate_grain');
  assert.equal(report.items[0].public_fact, false);
  assert.throws(() => buildClaimReviewPacket({
    recordId: '*',
    field: '*',
    sourceId: '*',
    after: 'everything',
    quotation: 'x',
    span: { start: 0, end: 1 },
    sourceBytes: 'x',
  }), { code: 'WHOLE_DATASET_APPROVAL_FORBIDDEN' });
});
