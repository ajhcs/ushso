import { createHash } from 'node:crypto';
import { selectClaims } from '../../scripts/research/claim-selector.mjs';

export const PROMOTION_POLICY_VERSION = 'ushso.promotion-policy.v1';
export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';

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

export const PROMOTION_CLASSES = Object.freeze({
  literal_publisher_metadata: {
    requires_human_click: false,
    literal_observation: true,
    scientific_acceptance: false,
  },
  inferred_scientific_statement: {
    requires_human_click: true,
    literal_observation: false,
    scientific_acceptance: true,
  },
  identity_merge: {
    requires_human_click: true,
    literal_observation: false,
    scientific_acceptance: true,
  },
  ambiguous_mapping: {
    requires_human_click: true,
    literal_observation: false,
    scientific_acceptance: false,
  },
});

export function classifyPromotion(claim = {}) {
  if (claim.class === 'identity_merge' || claim.identity_merge === true) return 'identity_merge';
  if (claim.class === 'ambiguous_mapping' || claim.ambiguous === true) return 'ambiguous_mapping';
  if (claim.class === 'inferred_scientific_statement' || claim.inferred === true || claim.claim_type === 'definition' && claim.literal !== true) {
    return 'inferred_scientific_statement';
  }
  if (claim.literal === true && claim.publisher_metadata === true) return 'literal_publisher_metadata';
  return 'inferred_scientific_statement';
}

export function authorizeTechnical(decision) {
  return decision?.technical_accepted === true && decision?.scientific_accepted !== true ? true : decision?.technical_accepted === true && decision?.scientific_required !== true;
}

export function promoteClaims({
  claims = [],
  decisions = [],
  records,
  generation,
  sourceHashes,
  previousPublic = {},
  incompleteSourceRun = false,
} = {}) {
  if (incompleteSourceRun === true) fail('INCOMPLETE_SOURCE_RUN');
  const classified = claims.map((claim) => {
    const promotionClass = classifyPromotion(claim);
    const spec = PROMOTION_CLASSES[promotionClass];
    return { ...claim, promotion_class: promotionClass, literal_observation: spec.literal_observation };
  });
  if (classified.some((claim) => claim.inferred === true && claim.literal_observation === true)) fail('INFERRED_NOT_LITERAL_OBSERVATION');
  const selected = selectClaims({
    claims: classified.map((claim) => {
      const { promotion_class, literal_observation, class: _class, inferred, literal, publisher_metadata, current_field_hash, ...subject } = claim;
      return {
        ...subject,
        field_path: claim.field_path ?? '/evidence/-',
        promotion_policy: claim.promotion_class === 'literal_publisher_metadata' ? 'owner_scoped_note_only' : (claim.promotion_policy ?? 'semantic_hold'),
        promotion_class,
        proposal_sha256: claim.proposal_sha256,
      };
    }),
    decisions,
    records,
    generation,
    sourceHashes,
    verifyAuthorization: (decision) => decision?.technical_accepted === true && decision?.authorizes_source_access !== true && decision?.authorizes_legal_rights !== true,
  });
  const promoted = [];
  const blocked = [...selected.excluded];
  for (const row of selected.selected) {
    const claim = classified.find((item) => item.claim_id === row.claim_id);
    if (claim.promotion_class !== 'literal_publisher_metadata') {
      blocked.push({ claim_id: row.claim_id, reason: 'EXPLICIT_REVIEW_REQUIRED', promotion_class: claim.promotion_class });
      continue;
    }
    if (claim.field_hash && claim.current_field_hash && claim.field_hash !== claim.current_field_hash) {
      blocked.push({ claim_id: row.claim_id, reason: 'CHANGED_FIELD_HASH' });
      continue;
    }
    promoted.push(freeze({
      ...row,
      promotion_class: claim.promotion_class,
      scientific_accepted: false,
      technical_accepted: true,
      public_fact: true,
      authorizes_source_access: false,
      authorizes_legal_rights: false,
    }));
  }
  const publicFacts = { ...previousPublic };
  const history = [...(previousPublic.__history ?? [])];
  for (const row of promoted) publicFacts[row.record_id + ':' + row.field_path] = row.after;
  const revision = freeze({
    format: 'ushso.promotion-revision.v1',
    policy_version: PROMOTION_POLICY_VERSION,
    generation,
    last_good_generation: LAST_GOOD_GENERATION,
    promoted: freeze(promoted),
    blocked: freeze(blocked),
    rejected_or_unknown_preserved: freeze(blocked),
    scientific_acceptance: 'separate',
    technical_acceptance: 'separate',
    publication_authorized: false,
    source_access_authorized: false,
    legal_rights_authorized: false,
    public_facts: freeze({ ...publicFacts, __history: undefined }),
    history: freeze(history),
  });
  return revision;
}

export function promotionDiff(previousPublic, revision) {
  const before = { ...previousPublic };
  delete before.__history;
  const after = { ...revision.public_facts };
  const searchEffects = Object.keys(after).filter((key) => !(key in before) || JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  return freeze({
    format: 'ushso.promotion-diff.v1',
    before: freeze(before),
    after: freeze(after),
    source_card_changes: freeze(searchEffects),
    schema_changes: freeze(searchEffects.filter((key) => key.includes('/variable') || key.includes('schema'))),
    example_changes: freeze(searchEffects.filter((key) => key.includes('example'))),
    search_api_effects: freeze(searchEffects),
    destructive_migration: false,
  });
}

export function rollbackPromotion(revision, previousPublic, attemptHistory = []) {
  return freeze({
    public_facts: freeze({ ...previousPublic }),
    restored_generation: previousPublic.generation ?? LAST_GOOD_GENERATION,
    retained_history: freeze([...(attemptHistory ?? []), { generation: revision.generation, promoted: revision.promoted, blocked: revision.blocked }]),
    newer_attempt_retained: true,
    destructive_migration: false,
  });
}
