import { canonicalizeJson } from '../../contracts/tooling/v1.0.0/src/canonical-json.mjs';
import { assertTypedDigest, canonicalJsonDigest } from '../../contracts/tooling/v1.0.0/src/digests.mjs';
import { digest, publicationMaterial } from '../../contracts/publication/v1.0.0/tools/common.mjs';
import { PUBLICATION_COMPONENT_TYPES } from './projection-v2.mjs';

export const PUBLICATION_LIFECYCLE_VERSION = 'ushso-publication-lifecycle.v2.0.0';
export const REQUIRED_PROMOTION_GATES = Object.freeze([
  'complete_sealed_enumeration',
  'membership_checkpoint_committed',
  'terminal_normalized_or_excluded',
  'w1_sealed',
  'all_projection_obligations_acknowledged',
  'references_resolved',
  'checksums_verified',
  'visibility_reconciled',
  'search_seo_coverage_reconciled',
  'retrieval_quality',
  'security',
  'performance',
  'coverage',
]);

const ALLOWED_TRANSITIONS = new Set([
  'null>building',
  'building>validated',
  'building>rejected',
  'validated>published',
  'validated>rejected',
  'published>retired',
  'retired>published',
  'retired>physically_expired',
]);

const ID = /^[a-z][a-z0-9_.:-]{2,191}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u;
const PROMOTION_EVIDENCE_RECEIPT_VERSION = 'promotion-gate-evidence.v1';
const PROMOTION_EVIDENCE_RECEIPT_KEYS = Object.freeze([
  'receipt_version',
  'evidence_id',
  'gate',
  'publication_id',
  'publication_digest',
  'generation_ids',
  'status',
  'verification_state',
  'issued_at',
  'expires_at',
  'evidence_digest',
].sort());

export class PublicationLifecycleError extends Error {
  constructor(code, detail, { retryable = false } = {}) {
    super(`${code}${detail ? `:${detail}` : ''}`);
    this.name = 'PublicationLifecycleError';
    this.code = code;
    this.detail = detail ?? null;
    this.retryable = retryable;
  }
}

function fail(code, detail, options) {
  throw new PublicationLifecycleError(code, detail, options);
}

function assertId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail('PUBLICATION_ID_INVALID', label);
  return value;
}

function assertTimestamp(value, label) {
  if (typeof value !== 'string' || !UTC.test(value) || Number.isNaN(Date.parse(value))) fail('PUBLICATION_TIMESTAMP_INVALID', label);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function same(left, right) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function evidenceMaterial(receipt) {
  const { evidence_digest: ignoredDigest, ...material } = receipt;
  return material;
}

function sortedGenerationIds(publication) {
  return publication.component_generation_refs
    .map(reference => reference.generation_id)
    .sort();
}

export function buildPromotionEvidenceReceipt({
  evidenceId,
  gate,
  publication,
  issuedAt,
  expiresAt,
  generationIds = null,
}) {
  assertId(evidenceId, 'evidence_id');
  if (!REQUIRED_PROMOTION_GATES.includes(gate)) fail('PROMOTION_GATE_UNKNOWN', gate);
  if (!publication || typeof publication !== 'object') fail('PROMOTION_EVIDENCE_PUBLICATION_REQUIRED');
  assertId(publication.publication_id, 'publication_id');
  assertTimestamp(issuedAt, 'evidence_issued_at');
  assertTimestamp(expiresAt, 'evidence_expires_at');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) fail('PROMOTION_EVIDENCE_EXPIRY_INVALID', evidenceId);
  generationIds ??= sortedGenerationIds(publication);
  if (!Array.isArray(generationIds) || generationIds.length === 0) fail('PROMOTION_EVIDENCE_GENERATIONS_REQUIRED', evidenceId);
  const normalizedGenerationIds = [...new Set(generationIds)].sort();
  if (normalizedGenerationIds.length !== generationIds.length || normalizedGenerationIds.some(id => !ID.test(id))) {
    fail('PROMOTION_EVIDENCE_GENERATIONS_INVALID', evidenceId);
  }
  const receipt = {
    receipt_version: PROMOTION_EVIDENCE_RECEIPT_VERSION,
    evidence_id: evidenceId,
    gate,
    publication_id: publication.publication_id,
    publication_digest: clone(publication.publication_digest),
    generation_ids: normalizedGenerationIds,
    status: 'passed',
    verification_state: 'verified',
    issued_at: issuedAt,
    expires_at: expiresAt,
    evidence_digest: null,
  };
  receipt.evidence_digest = canonicalJsonDigest(evidenceMaterial(receipt));
  return deepFreeze(receipt);
}

function publicationRef(publication) {
  return {
    publication_id: publication.publication_id,
    manifest_digest: publication.publication_digest,
  };
}

function pinBehavior(state) {
  if (state === 'published' || state === 'retired') return 'serve_pinned';
  if (state === 'physically_expired') return 'restart_required';
  return 'unavailable';
}

export function buildPublicationManifest({
  publicationId,
  canonicalManifestRef,
  canonicalAsOf,
  componentGenerationRefs,
  coverageSnapshotId,
  buildReceiptRef,
  buildReceiptDigest,
  previousPublicationRef = null,
  nMinusOneWorker = null,
  staticCompatibilityRef,
  sealedAt,
  rollbackEligibleUntil,
}) {
  assertId(publicationId, 'publication_id');
  assertTimestamp(canonicalAsOf, 'canonical_as_of');
  assertTimestamp(sealedAt, 'sealed_at');
  assertTimestamp(rollbackEligibleUntil, 'rollback_eligible_until');
  if (Date.parse(rollbackEligibleUntil) < Date.parse(sealedAt)) fail('PUBLICATION_RETENTION_BEFORE_SEAL');
  const kinds = componentGenerationRefs.map(reference => reference.component_kind).sort();
  if (!same(kinds, [...PUBLICATION_COMPONENT_TYPES].sort())) fail('PUBLICATION_COMPONENT_SET_INCOMPLETE');
  const manifest = {
    manifest_version: 'publication-manifest.v1',
    publication_id: publicationId,
    contract_version: '1.0.0',
    candidate_state: 'validated',
    canonical_manifest_ref: clone(canonicalManifestRef),
    canonical_as_of: canonicalAsOf,
    component_generation_refs: clone(componentGenerationRefs).sort((left, right) => left.component_kind < right.component_kind ? -1 : 1),
    coverage_snapshot_id: assertId(coverageSnapshotId, 'coverage_snapshot_id'),
    build_receipt_ref: assertId(buildReceiptRef, 'build_receipt_ref'),
    build_receipt_digest: clone(buildReceiptDigest),
    visibility_policy: {
      policy_version: '1.0.0',
      public_states: ['public'],
      excluded_states: ['excluded', 'internal', 'quarantined', 'tombstoned'],
      absence_claim_permitted_for_exclusions: false,
    },
    promotion: {
      eligible: true,
      atomic_pointer_switch_required: true,
      partial_promotion_allowed: false,
      required_barrier_status: 'all_passed',
    },
    rollback: {
      previous_publication_ref: clone(previousPublicationRef),
      n_minus_one_worker: clone(nMinusOneWorker),
      static_compatibility_ref: clone(staticCompatibilityRef),
    },
    retention: {
      rollback_eligible_until: rollbackEligibleUntil,
      minimum_retained_publications: 2,
      pinned_cursor_behavior_after_expiry: 'restart_required',
    },
    publication_digest: null,
    sealed_at: sealedAt,
    immutable: true,
  };
  manifest.publication_digest = digest('publication_manifest', publicationMaterial(manifest));
  return deepFreeze(manifest);
}

function initialState() {
  return {
    generations: new Map(),
    publications: new Map(),
    pointer: null,
    publication_history: [],
    audit_events: [],
  };
}

export class InMemoryPublicationLedger {
  constructor({ mode = 'offline_rehearsal' } = {}) {
    if (!['offline_rehearsal', 'production'].includes(mode)) fail('PUBLICATION_MODE_INVALID', mode);
    this.mode = mode;
    this.state = initialState();
  }

  #atomic(operation) {
    const before = clone(this.state);
    try {
      return operation();
    } catch (error) {
      this.state = before;
      throw error;
    }
  }

  #transition(generation, toState, { occurredAt, reasonCode, transactionId }) {
    const fromState = generation.state ?? null;
    if (!ALLOWED_TRANSITIONS.has(`${fromState ?? 'null'}>${toState}`)) {
      fail('GENERATION_TRANSITION_INVALID', `${generation.generation_id}:${fromState ?? 'null'}>${toState}`);
    }
    generation.lifecycle.push({
      event_version: 'generation-state-event.v1',
      event_id: `generation-event:${generation.generation_id}:${generation.lifecycle.length + 1}`,
      generation_id: generation.generation_id,
      component_kind: generation.component_kind,
      from_state: fromState,
      to_state: toState,
      occurred_at: occurredAt,
      reason_code: reasonCode,
      transaction_id: transactionId,
      pin_behavior: pinBehavior(toState),
      append_only: true,
    });
    generation.state = toState;
  }

  beginGeneration({ generationId, componentKind, canonicalManifestId, retainedUntil, occurredAt, transactionId }) {
    assertId(generationId, 'generation_id');
    if (!PUBLICATION_COMPONENT_TYPES.includes(componentKind)) fail('GENERATION_COMPONENT_INVALID', componentKind);
    assertId(canonicalManifestId, 'canonical_manifest_id');
    assertTimestamp(retainedUntil, 'retained_until');
    assertTimestamp(occurredAt, 'occurred_at');
    assertId(transactionId, 'transaction_id');
    if (this.state.generations.has(generationId)) fail('GENERATION_ALREADY_EXISTS', generationId);
    const generation = {
      generation_id: generationId,
      component_kind: componentKind,
      canonical_manifest_id: canonicalManifestId,
      component_checksum: null,
      retained_until: retainedUntil,
      state: null,
      revoked: false,
      lifecycle: [],
    };
    this.#transition(generation, 'building', { occurredAt, reasonCode: 'build_started', transactionId });
    this.state.generations.set(generationId, generation);
    return deepFreeze(clone(generation));
  }

  validateGeneration({ component, occurredAt, transactionId }) {
    assertTimestamp(occurredAt, 'occurred_at');
    assertId(transactionId, 'transaction_id');
    const generation = this.state.generations.get(component.generation_id);
    if (!generation) fail('GENERATION_UNKNOWN', component.generation_id);
    if (component.sealed_state !== 'validated') fail('GENERATION_MANIFEST_NOT_VALIDATED', component.generation_id);
    if (component.component_kind !== generation.component_kind || component.canonical_manifest_ref.manifest_id !== generation.canonical_manifest_id) {
      fail('GENERATION_MANIFEST_SCOPE_MISMATCH', component.generation_id);
    }
    if (!SHA256.test(component.component_checksum?.value ?? '')) fail('GENERATION_CHECKSUM_INVALID', component.generation_id);
    generation.component_checksum = clone(component.component_checksum);
    generation.manifest = clone(component);
    this.#transition(generation, 'validated', { occurredAt, reasonCode: 'validation_passed', transactionId });
    return deepFreeze(clone(generation));
  }

  rejectGeneration({ generationId, occurredAt, transactionId, reasonCode = 'validation_failed' }) {
    assertId(generationId, 'generation_id');
    assertTimestamp(occurredAt, 'occurred_at');
    assertId(transactionId, 'transaction_id');
    assertId(reasonCode, 'reason_code');
    const generation = this.state.generations.get(generationId);
    if (!generation) fail('GENERATION_UNKNOWN', generationId);
    this.#transition(generation, 'rejected', { occurredAt, reasonCode, transactionId });
    return deepFreeze(clone(generation));
  }

  registerPublication(manifest) {
    if (this.state.publications.has(manifest.publication_id)) fail('PUBLICATION_ALREADY_EXISTS', manifest.publication_id);
    const expectedDigest = digest('publication_manifest', publicationMaterial(manifest));
    if (expectedDigest.value !== manifest.publication_digest?.value) fail('PUBLICATION_DIGEST_MISMATCH', manifest.publication_id);
    for (const reference of manifest.component_generation_refs) {
      const generation = this.state.generations.get(reference.generation_id);
      if (!generation || generation.state !== 'validated') fail('PUBLICATION_COMPONENT_NOT_VALIDATED', reference.generation_id);
      if (generation.component_kind !== reference.component_kind || generation.component_checksum?.value !== reference.manifest_digest?.value) {
        fail('PUBLICATION_COMPONENT_REFERENCE_INVALID', reference.generation_id);
      }
      if (generation.canonical_manifest_id !== manifest.canonical_manifest_ref.manifest_id) fail('PUBLICATION_COMPONENT_W1_MISMATCH', reference.generation_id);
    }
    this.state.publications.set(manifest.publication_id, clone(manifest));
    return manifest;
  }

  #assertGates(gates, { publication, observedAt }) {
    if (!Array.isArray(gates)) fail('PROMOTION_GATES_REQUIRED');
    const byName = new Map();
    for (const gate of gates) {
      if (!gate || typeof gate !== 'object' || byName.has(gate.gate)) fail('PROMOTION_GATE_DUPLICATE', gate?.gate);
      byName.set(gate.gate, gate);
    }
    const expectedGenerationIds = sortedGenerationIds(publication);
    const evidenceIds = new Set();
    for (const name of REQUIRED_PROMOTION_GATES) {
      const gate = byName.get(name);
      if (!gate || gate.status !== 'passed' || !Array.isArray(gate.evidence_refs) || gate.evidence_refs.length === 0) {
        fail('PROMOTION_GATE_NOT_PASSED', name);
      }
      for (const evidence of gate.evidence_refs) {
        if (!evidence || typeof evidence !== 'object'
            || canonicalizeJson(Object.keys(evidence).sort()) !== canonicalizeJson(PROMOTION_EVIDENCE_RECEIPT_KEYS)) {
          fail('PROMOTION_EVIDENCE_RECEIPT_INVALID', name);
        }
        assertId(evidence.evidence_id, 'evidence_id');
        if (evidenceIds.has(evidence.evidence_id)) fail('PROMOTION_EVIDENCE_DUPLICATE', evidence.evidence_id);
        evidenceIds.add(evidence.evidence_id);
        if (evidence.receipt_version !== PROMOTION_EVIDENCE_RECEIPT_VERSION
            || evidence.gate !== name
            || evidence.publication_id !== publication.publication_id
            || !same(evidence.publication_digest, publication.publication_digest)
            || evidence.status !== 'passed'
            || evidence.verification_state !== 'verified') {
          fail('PROMOTION_EVIDENCE_BINDING_MISMATCH', evidence.evidence_id);
        }
        if (!Array.isArray(evidence.generation_ids)
            || canonicalizeJson([...evidence.generation_ids].sort()) !== canonicalizeJson(expectedGenerationIds)) {
          fail('PROMOTION_EVIDENCE_GENERATION_BINDING_MISMATCH', evidence.evidence_id);
        }
        assertTimestamp(evidence.issued_at, 'evidence_issued_at');
        assertTimestamp(evidence.expires_at, 'evidence_expires_at');
        if (Date.parse(evidence.issued_at) > Date.parse(observedAt)
            || Date.parse(evidence.expires_at) <= Date.parse(observedAt)
            || Date.parse(evidence.expires_at) <= Date.parse(evidence.issued_at)) {
          fail('PROMOTION_EVIDENCE_EXPIRED', evidence.evidence_id);
        }
        try {
          assertTypedDigest(evidence.evidence_digest, 'canonical_json_sha256');
        } catch {
          fail('PROMOTION_EVIDENCE_DIGEST_INVALID', evidence.evidence_id);
        }
        const expectedDigest = canonicalJsonDigest(evidenceMaterial(evidence));
        if (expectedDigest.value !== evidence.evidence_digest.value) fail('PROMOTION_EVIDENCE_DIGEST_MISMATCH', evidence.evidence_id);
      }
    }
    if ([...byName.keys()].some(name => !REQUIRED_PROMOTION_GATES.includes(name))) fail('PROMOTION_GATE_UNKNOWN');
  }

  #assertAuthorizationPolicy(authorization, { action, observedAt }) {
    if (this.mode === 'production') {
      const expectedScope = action === 'rollback' ? 'production_publication_rollback' : 'production_publication';
      if (authorization?.external_cutover_authorized !== true || authorization?.scope !== expectedScope) {
        fail('PRODUCTION_CUTOVER_NOT_AUTHORIZED');
      }
      assertId(authorization.authorization_id, 'authorization_id');
      assertId(authorization.authorized_by_actor_id, 'authorized_by_actor_id');
      assertTimestamp(authorization.granted_at, 'authorization_granted_at');
      assertTimestamp(authorization.expires_at, 'authorization_expires_at');
      if (Date.parse(authorization.granted_at) > Date.parse(observedAt)
          || Date.parse(authorization.expires_at) <= Date.parse(observedAt)) {
        fail('PRODUCTION_CUTOVER_AUTHORIZATION_EXPIRED');
      }
    } else if (authorization?.external_cutover_authorized !== false || authorization?.scope !== 'offline_rehearsal') {
      fail('OFFLINE_REHEARSAL_AUTHORIZATION_INVALID');
    }
  }

  #assertAuthorizationBinding(authorization, publication) {
    if (this.mode !== 'production') return;
    if (authorization.publication_id !== publication.publication_id
        || !same(authorization.publication_digest, publication.publication_digest)) {
      fail('PRODUCTION_CUTOVER_AUTHORIZATION_BINDING_MISMATCH');
    }
  }

  promote({ publicationId, gates, authorization, occurredAt, transactionId, actorKind = 'projector', injectFaultAt = null }) {
    assertTimestamp(occurredAt, 'occurred_at');
    this.#assertAuthorizationPolicy(authorization, { action: 'promote', observedAt: occurredAt });
    assertId(transactionId, 'transaction_id');
    if (!['projector', 'operations'].includes(actorKind)) fail('PUBLICATION_ACTOR_KIND_INVALID', actorKind);
    return this.#atomic(() => {
      const publication = this.state.publications.get(publicationId);
      if (!publication) fail('PUBLICATION_UNKNOWN', publicationId);
      this.#assertGates(gates, { publication, observedAt: occurredAt });
      this.#assertAuthorizationBinding(authorization, publication);
      const priorPointer = this.state.pointer;
      const priorPublication = priorPointer ? this.state.publications.get(priorPointer.active_publication_ref.publication_id) : null;
      const expectedPrevious = publication.rollback.previous_publication_ref;
      if (priorPublication === null ? expectedPrevious !== null : !same(expectedPrevious, publicationRef(priorPublication))) {
        fail('PUBLICATION_PREVIOUS_POINTER_MISMATCH', publicationId);
      }
      const event = {
        event_id: `publication-history:${(priorPointer?.sequence ?? 0) + 1}`,
        sequence: (priorPointer?.sequence ?? 0) + 1,
        action: 'promote',
        from_publication_ref: priorPublication ? publicationRef(priorPublication) : null,
        to_publication_ref: publicationRef(publication),
        occurred_at: occurredAt,
        transaction_id: transactionId,
        atomic_commit: true,
        actor_kind: actorKind,
        reason_code: 'all_gates_passed',
      };
      this.state.publication_history.push(event);
      if (injectFaultAt === 'after_history') fail('INJECTED_PROMOTION_FAILURE', injectFaultAt);
      if (priorPublication) {
        for (const reference of priorPublication.component_generation_refs) {
          const generation = this.state.generations.get(reference.generation_id);
          if (generation.state === 'published') this.#transition(generation, 'retired', { occurredAt, reasonCode: 'superseded', transactionId });
        }
      }
      for (const reference of publication.component_generation_refs) {
        const generation = this.state.generations.get(reference.generation_id);
        this.#transition(generation, 'published', { occurredAt, reasonCode: 'atomic_promotion', transactionId });
      }
      if (injectFaultAt === 'before_pointer') fail('INJECTED_PROMOTION_FAILURE', injectFaultAt);
      this.state.pointer = {
        pointer_version: 'publication-pointer.v1',
        pointer_id: 'ushso:publication:active',
        sequence: event.sequence,
        active_publication_ref: event.to_publication_ref,
        previous_publication_ref: event.from_publication_ref,
        switched_at: occurredAt,
        history_event_id: event.event_id,
        transaction_id: transactionId,
        atomic_commit: true,
        cache_policy: {
          pointer_lookup: 'cache_disabled',
          immutable_generation_reads: 'cache_allowed',
          cache_key_includes_all_publication_ids: true,
        },
      };
      this.state.audit_events.push({ action: 'promote', publication_id: publicationId, transaction_id: transactionId, occurred_at: occurredAt, mode: this.mode });
      if (injectFaultAt === 'after_pointer') fail('INJECTED_PROMOTION_FAILURE', injectFaultAt);
      return this.resolveActivePointer();
    });
  }

  rollback({ targetPublicationId, authorization, occurredAt, transactionId, injectFaultAt = null }) {
    assertId(targetPublicationId, 'target_publication_id');
    assertTimestamp(occurredAt, 'occurred_at');
    this.#assertAuthorizationPolicy(authorization, { action: 'rollback', observedAt: occurredAt });
    assertId(transactionId, 'transaction_id');
    return this.#atomic(() => {
      const pointer = this.state.pointer;
      if (!pointer) fail('ACTIVE_PUBLICATION_MISSING');
      if (pointer.active_publication_ref.publication_id === targetPublicationId) fail('ROLLBACK_TARGET_ALREADY_ACTIVE', targetPublicationId);
      const active = this.state.publications.get(pointer.active_publication_ref.publication_id);
      const target = this.state.publications.get(targetPublicationId);
      if (!target) fail('ROLLBACK_TARGET_UNKNOWN', targetPublicationId);
      if (pointer.previous_publication_ref?.publication_id !== targetPublicationId
          || !same(pointer.previous_publication_ref, publicationRef(target))) {
        fail('ROLLBACK_TARGET_NOT_N_MINUS_ONE', targetPublicationId);
      }
      this.#assertAuthorizationBinding(authorization, target);
      if (Date.parse(target.retention.rollback_eligible_until) <= Date.parse(occurredAt)) fail('ROLLBACK_TARGET_EXPIRED', targetPublicationId);
      for (const reference of active.component_generation_refs) {
        const generation = this.state.generations.get(reference.generation_id);
        if (generation.state === 'published') this.#transition(generation, 'retired', { occurredAt, reasonCode: 'superseded', transactionId });
      }
      for (const reference of target.component_generation_refs) {
        const generation = this.state.generations.get(reference.generation_id);
        if (generation.state !== 'retired') fail('ROLLBACK_GENERATION_NOT_RETIRED', generation.generation_id);
        if (generation.revoked) fail('ROLLBACK_GENERATION_REVOKED', generation.generation_id);
        if (Date.parse(generation.retained_until) <= Date.parse(occurredAt)) fail('ROLLBACK_GENERATION_EXPIRED', generation.generation_id);
        this.#transition(generation, 'published', { occurredAt, reasonCode: 'rollback_restored', transactionId });
      }
      const event = {
        event_id: `publication-history:${pointer.sequence + 1}`,
        sequence: pointer.sequence + 1,
        action: 'rollback',
        from_publication_ref: publicationRef(active),
        to_publication_ref: publicationRef(target),
        occurred_at: occurredAt,
        transaction_id: transactionId,
        atomic_commit: true,
        actor_kind: 'operations',
        reason_code: 'restore_previous_validated',
      };
      this.state.publication_history.push(event);
      if (injectFaultAt === 'before_pointer') fail('INJECTED_ROLLBACK_FAILURE', injectFaultAt);
      this.state.pointer = {
        ...pointer,
        sequence: event.sequence,
        active_publication_ref: event.to_publication_ref,
        previous_publication_ref: event.from_publication_ref,
        switched_at: occurredAt,
        history_event_id: event.event_id,
        transaction_id: transactionId,
      };
      this.state.audit_events.push({ action: 'rollback', publication_id: targetPublicationId, transaction_id: transactionId, occurred_at: occurredAt, mode: this.mode });
      return this.resolveActivePointer();
    });
  }

  revokeGeneration({ generationId, auditRef }) {
    const generation = this.state.generations.get(generationId);
    if (!generation) fail('GENERATION_UNKNOWN', generationId);
    assertId(auditRef, 'audit_ref');
    generation.revoked = true;
    generation.revocation_audit_ref = auditRef;
  }

  expireRetiredGeneration({ generationId, observedAt, transactionId, auditRef }) {
    assertId(generationId, 'generation_id');
    assertTimestamp(observedAt, 'observed_at');
    assertId(transactionId, 'transaction_id');
    const generation = this.state.generations.get(generationId);
    if (!generation) fail('GENERATION_UNKNOWN', generationId);
    if (generation.state !== 'retired') fail('GENERATION_NOT_RETIRED', generationId);
    if (Date.parse(observedAt) < Date.parse(generation.retained_until)) fail('GENERATION_RETENTION_NOT_EXPIRED', generationId);
    const protectedIds = new Set([
      ...(this.state.pointer ? [this.state.pointer.active_publication_ref, this.state.pointer.previous_publication_ref].filter(Boolean).map(reference => reference.publication_id) : []),
    ]);
    for (const publicationId of protectedIds) {
      const publication = this.state.publications.get(publicationId);
      if (publication?.component_generation_refs.some(reference => reference.generation_id === generationId)) fail('GENERATION_ROLLBACK_PINNED', generationId);
    }
    assertId(auditRef, 'audit_ref');
    this.#transition(generation, 'physically_expired', { occurredAt: observedAt, reasonCode: 'retention_expired', transactionId });
    this.state.audit_events.push({ action: 'physical_expiry', generation_id: generationId, audit_ref: auditRef, occurred_at: observedAt });
  }

  resolveGenerationPin({ generationId, observedAt }) {
    assertId(generationId, 'generation_id');
    assertTimestamp(observedAt, 'observed_at');
    const generation = this.state.generations.get(generationId);
    if (!generation) fail('GENERATION_UNKNOWN', generationId);
    if (generation.revoked) fail('GENERATION_REVOKED', generationId);
    if (generation.state === 'physically_expired' || Date.parse(observedAt) >= Date.parse(generation.retained_until)) fail('GENERATION_RESTART_REQUIRED', generationId);
    if (!['published', 'retired'].includes(generation.state)) fail('GENERATION_NOT_QUERYABLE', generationId);
    return deepFreeze({ generation_id: generationId, state: generation.state, pin_behavior: 'serve_pinned', retained_until: generation.retained_until });
  }

  resolveActivePointer() {
    return this.state.pointer ? deepFreeze(clone(this.state.pointer)) : null;
  }

  snapshot() {
    return deepFreeze(clone(this.state));
  }
}
