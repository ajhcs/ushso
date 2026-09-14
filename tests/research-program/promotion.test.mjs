import assert from 'node:assert/strict';
import test from 'node:test';
import { digest, claimHash } from '../../scripts/research/claim-selector.mjs';
import {
  LAST_GOOD_GENERATION,
  classifyPromotion,
  promoteClaims,
  promotionDiff,
  rollbackPromotion,
} from '../../packages/enrichment/promotion.mjs';

const record = { record_id: 'obs:asset:cdc-socrata:example', title: 'PLACES' };
const source = 'source-bytes';

function literalClaim(overrides = {}) {
  const claim = {
    claim_id: 'lit:cdc:title',
    record_id: record.record_id,
    generation: 'candidate-1',
    baseline_record_sha256: digest(record),
    field_path: '/evidence/-',
    proposed_value: { text: 'PLACES local estimates' },
    sources: [{ source_sha256: digest(source), passage_locator: 'title' }],
    promotion_policy: 'owner_scoped_note_only',
    literal: true,
    publisher_metadata: true,
    class: 'literal_publisher_metadata',
    ...overrides,
  };
  claim.proposal_sha256 = claimHash(claim);
  claim.field_hash = digest({ record_id: claim.record_id, field_path: claim.field_path, generation: claim.generation, proposed_value: claim.proposed_value });
  return claim;
}

test('inferred scientific statements cannot receive literal-observation status; literals do not all need a click', () => {
  assert.equal(classifyPromotion({ literal: true, publisher_metadata: true }), 'literal_publisher_metadata');
  assert.equal(classifyPromotion({ inferred: true, claim_type: 'definition' }), 'inferred_scientific_statement');
  const inferred = literalClaim({
    claim_id: 'sci:cdc:def',
    inferred: true,
    literal: false,
    publisher_metadata: false,
    class: 'inferred_scientific_statement',
    promotion_policy: 'semantic_hold',
    proposed_value: { text: 'prevalence means something else' },
  });
  inferred.proposal_sha256 = claimHash(inferred);
  const revision = promoteClaims({
    claims: [literalClaim(), inferred],
    decisions: [
      { claim_id: 'lit:cdc:title', decision: 'approved', proposal_sha256: literalClaim().proposal_sha256, technical_accepted: true, scientific_accepted: false, authorizes_source_access: false, authorizes_legal_rights: false },
      { claim_id: 'sci:cdc:def', decision: 'approved', proposal_sha256: inferred.proposal_sha256, technical_accepted: true, scientific_accepted: false, authorizes_source_access: false, authorizes_legal_rights: false },
    ],
    records: new Map([[record.record_id, record]]),
    generation: 'candidate-1',
    sourceHashes: new Set([digest(source)]),
  });
  assert.equal(revision.promoted.length, 1);
  assert.equal(revision.promoted[0].claim_id, 'lit:cdc:title');
  assert.ok(revision.blocked.some((row) => row.claim_id === 'sci:cdc:def'));
  assert.equal(revision.scientific_acceptance, 'separate');
  assert.equal(revision.source_access_authorized, false);
});

test('stale approval, incomplete source run and changed field hash cannot promote; unaffected accepted claims remain', () => {
  const good = literalClaim();
  const stale = literalClaim({ claim_id: 'lit:cdc:stale', proposed_value: { text: 'old title' } });
  stale.proposal_sha256 = claimHash(stale);
  const changed = literalClaim({ claim_id: 'lit:cdc:changed', proposed_value: { text: 'new title' } });
  changed.proposal_sha256 = claimHash(changed);
  const revision = promoteClaims({
    claims: [good, stale, changed],
    decisions: [
      { claim_id: good.claim_id, decision: 'approved', proposal_sha256: good.proposal_sha256, technical_accepted: true, authorizes_source_access: false, authorizes_legal_rights: false },
      { claim_id: stale.claim_id, decision: 'approved', proposal_sha256: 'old-hash', technical_accepted: true, authorizes_source_access: false, authorizes_legal_rights: false },
      { claim_id: changed.claim_id, decision: 'approved', proposal_sha256: changed.proposal_sha256, field_hash: 'old-field', technical_accepted: true, authorizes_source_access: false, authorizes_legal_rights: false },
    ],
    records: new Map([[record.record_id, record]]),
    generation: 'candidate-1',
    sourceHashes: new Set([digest(source)]),
  });
  assert.equal(revision.promoted.map((row) => row.claim_id).join(), good.claim_id);
  assert.ok(revision.blocked.some((row) => row.reason === 'STALE_APPROVAL'));
  assert.ok(revision.blocked.some((row) => row.reason === 'CHANGED_FIELD_HASH'));
  assert.throws(() => promoteClaims({
    claims: [good],
    decisions: [{ claim_id: good.claim_id, decision: 'approved', proposal_sha256: good.proposal_sha256, technical_accepted: true }],
    records: new Map([[record.record_id, record]]),
    generation: 'candidate-1',
    sourceHashes: new Set([digest(source)]),
    incompleteSourceRun: true,
  }), { code: 'INCOMPLETE_SOURCE_RUN' });
});

test('rollback restores prior public facts and retains newer attempt history; last-good generation is unchanged', () => {
  const good = literalClaim();
  const previous = { generation: LAST_GOOD_GENERATION, 'obs:asset:cdc-socrata:example:/evidence/-': { text: 'prior title' } };
  const revision = promoteClaims({
    claims: [good],
    decisions: [{ claim_id: good.claim_id, decision: 'approved', proposal_sha256: good.proposal_sha256, technical_accepted: true, authorizes_source_access: false, authorizes_legal_rights: false }],
    records: new Map([[record.record_id, record]]),
    generation: 'candidate-1',
    sourceHashes: new Set([digest(source)]),
    previousPublic: previous,
  });
  const diff = promotionDiff(previous, revision);
  assert.ok(diff.source_card_changes.length >= 1);
  assert.equal(diff.destructive_migration, false);
  const rolled = rollbackPromotion(revision, previous, [{ generation: 'attempt-0' }]);
  assert.deepEqual(rolled.public_facts['obs:asset:cdc-socrata:example:/evidence/-'], { text: 'prior title' });
  assert.equal(rolled.restored_generation, LAST_GOOD_GENERATION);
  assert.equal(rolled.newer_attempt_retained, true);
  assert.equal(revision.last_good_generation, LAST_GOOD_GENERATION);
  assert.equal(revision.publication_authorized, false);
});
