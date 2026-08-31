export class EvidenceResolutionError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'EvidenceResolutionError';
    this.code = code;
    this.details = details;
  }
}

function decodeToken(token, pointer) {
  if (/~(?:[^01]|$)/u.test(token)) throw new EvidenceResolutionError('JSON_POINTER_ESCAPE_INVALID', { pointer });
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function resolveJsonPointer(document, pointer) {
  if (pointer === '') return document;
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new EvidenceResolutionError('JSON_POINTER_INVALID', { pointer });
  }
  let current = document;
  for (const rawToken of pointer.slice(1).split('/')) {
    const token = decodeToken(rawToken, pointer);
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(token)) {
        throw new EvidenceResolutionError('JSON_POINTER_ARRAY_INDEX_INVALID', { pointer, token });
      }
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) {
        throw new EvidenceResolutionError('JSON_POINTER_UNRESOLVED', { pointer, token });
      }
      current = current[index];
    } else if (current !== null && typeof current === 'object' && Object.hasOwn(current, token)) {
      current = current[token];
    } else {
      throw new EvidenceResolutionError('JSON_POINTER_UNRESOLVED', { pointer, token });
    }
  }
  return current;
}

/**
 * Resolve claim evidence references without weakening unresolved evidence into a
 * truth claim. Each claim uses {claim_id, evidence_refs:[{evidence_id,pointer}]}.
 * Each evidence row uses {evidence_id, document}; when document is omitted the
 * entire evidence row is pointer-addressable.
 */
export function resolveEvidenceClaims({ claims, evidence }) {
  if (!Array.isArray(claims) || !Array.isArray(evidence)) throw new EvidenceResolutionError('EVIDENCE_ARRAYS_REQUIRED');
  const evidenceById = new Map();
  const errors = [];
  for (const row of evidence) {
    if (!row || typeof row.evidence_id !== 'string' || row.evidence_id.length === 0) {
      errors.push({ code: 'EVIDENCE_ID_INVALID', evidence_id: row?.evidence_id ?? null });
    } else if (evidenceById.has(row.evidence_id)) {
      errors.push({ code: 'EVIDENCE_ID_DUPLICATE', evidence_id: row.evidence_id });
    } else {
      evidenceById.set(row.evidence_id, row);
    }
  }
  const claimIds = new Set();
  const resolved = [];
  for (const claim of [...claims].sort((left, right) => String(left?.claim_id) < String(right?.claim_id) ? -1 : String(left?.claim_id) > String(right?.claim_id) ? 1 : 0)) {
    const claimId = claim?.claim_id;
    if (typeof claimId !== 'string' || claimId.length === 0) {
      errors.push({ code: 'CLAIM_ID_INVALID', claim_id: claimId ?? null });
      continue;
    }
    if (claimIds.has(claimId)) {
      errors.push({ code: 'CLAIM_ID_DUPLICATE', claim_id: claimId });
      continue;
    }
    claimIds.add(claimId);
    if (!Array.isArray(claim.evidence_refs) || claim.evidence_refs.length === 0) {
      errors.push({ code: 'CLAIM_EVIDENCE_REQUIRED', claim_id: claimId });
      continue;
    }
    const references = [];
    for (const reference of claim.evidence_refs) {
      const evidenceRow = evidenceById.get(reference?.evidence_id);
      if (!evidenceRow) {
        errors.push({ code: 'EVIDENCE_REFERENCE_UNRESOLVED', claim_id: claimId, evidence_id: reference?.evidence_id ?? null });
        continue;
      }
      try {
        const pointer = reference.pointer ?? '';
        const document = Object.hasOwn(evidenceRow, 'document') ? evidenceRow.document : evidenceRow;
        references.push({ evidence_id: reference.evidence_id, pointer, value: resolveJsonPointer(document, pointer) });
      } catch (error) {
        errors.push({ code: error.code ?? 'EVIDENCE_POINTER_ERROR', claim_id: claimId, evidence_id: reference.evidence_id, pointer: reference.pointer ?? '' });
      }
    }
    if (references.length > 0) resolved.push({ claim_id: claimId, references });
  }
  errors.sort((left, right) => JSON.stringify(left) < JSON.stringify(right) ? -1 : JSON.stringify(left) > JSON.stringify(right) ? 1 : 0);
  return { ok: errors.length === 0, resolved, errors };
}

export function assertEvidenceClaims(input) {
  const result = resolveEvidenceClaims(input);
  if (!result.ok) throw new EvidenceResolutionError('EVIDENCE_RESOLUTION_FAILED', { errors: result.errors });
  return result.resolved;
}

function isAtOrBelow(pointer, root) {
  return pointer === root || pointer.startsWith(`${root}/`);
}

/**
 * Resolve research-plan evidence `claim_pointers` against one exact response.
 * Transport-only pointers are forbidden. Pointers must fall under an auditable
 * root or a declared critical-claim root, and critical coverage is reported
 * separately so callers cannot mistake a resolved non-critical pointer for a
 * fully evidenced plan.
 */
export function resolveClaimPointers({ claimDocument, evidenceReferences, claimManifest }) {
  if (!Array.isArray(evidenceReferences) || !claimManifest || typeof claimManifest !== 'object') {
    throw new EvidenceResolutionError('CLAIM_POINTER_INPUT_INVALID');
  }
  const auditableRoots = Array.isArray(claimManifest.auditable_roots) ? claimManifest.auditable_roots : [];
  const criticalClaims = Array.isArray(claimManifest.critical_claims) ? claimManifest.critical_claims : [];
  const criticalPointers = criticalClaims.map(row => row.json_pointer);
  const allowedRoots = [...new Set([...auditableRoots, ...criticalPointers])];
  const transportRoots = Array.isArray(claimManifest.transport_only_pointers) ? claimManifest.transport_only_pointers : [];
  const seenReferenceIds = new Set();
  const resolved = [];
  const errors = [];
  const resolvedPointers = new Set();

  for (const reference of evidenceReferences) {
    const referenceId = reference?.evidence_reference_id;
    if (typeof referenceId !== 'string' || referenceId.length === 0) {
      errors.push({ code: 'EVIDENCE_REFERENCE_ID_INVALID', evidence_reference_id: referenceId ?? null });
      continue;
    }
    if (seenReferenceIds.has(referenceId)) {
      errors.push({ code: 'EVIDENCE_REFERENCE_ID_DUPLICATE', evidence_reference_id: referenceId });
      continue;
    }
    seenReferenceIds.add(referenceId);
    if (!Array.isArray(reference.claim_pointers) || reference.claim_pointers.length === 0) {
      errors.push({ code: 'CLAIM_POINTER_REQUIRED', evidence_reference_id: referenceId });
      continue;
    }
    const seenPointers = new Set();
    const references = [];
    for (const pointer of reference.claim_pointers) {
      if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
        errors.push({ code: 'CLAIM_POINTER_INVALID', evidence_reference_id: referenceId, pointer: pointer ?? null });
        continue;
      }
      if (seenPointers.has(pointer)) {
        errors.push({ code: 'CLAIM_POINTER_DUPLICATE', evidence_reference_id: referenceId, pointer });
        continue;
      }
      seenPointers.add(pointer);
      if (transportRoots.some(root => isAtOrBelow(pointer, root))) {
        errors.push({ code: 'CLAIM_POINTER_TRANSPORT_ONLY', evidence_reference_id: referenceId, pointer });
        continue;
      }
      if (!allowedRoots.some(root => isAtOrBelow(pointer, root))) {
        errors.push({ code: 'CLAIM_POINTER_NOT_AUDITABLE', evidence_reference_id: referenceId, pointer });
        continue;
      }
      try {
        const value = resolveJsonPointer(claimDocument, pointer);
        references.push({ pointer, value });
        resolvedPointers.add(pointer);
      } catch (error) {
        errors.push({ code: error.code ?? 'CLAIM_POINTER_UNRESOLVED', evidence_reference_id: referenceId, pointer });
      }
    }
    if (references.length > 0) resolved.push({ evidence_reference_id: referenceId, evidence_id: reference.evidence_id ?? null, claims: references });
  }

  const uncoveredCriticalClaims = criticalClaims
    .filter(claim => ![...resolvedPointers].some(pointer => isAtOrBelow(pointer, claim.json_pointer)))
    .map(claim => ({ claim_id: claim.claim_id, json_pointer: claim.json_pointer }));
  errors.sort((left, right) => JSON.stringify(left) < JSON.stringify(right) ? -1 : JSON.stringify(left) > JSON.stringify(right) ? 1 : 0);
  return {
    ok: errors.length === 0,
    critical_coverage_complete: uncoveredCriticalClaims.length === 0,
    resolved,
    uncovered_critical_claims: uncoveredCriticalClaims,
    errors
  };
}

export function assertClaimPointers(input, { requireCriticalCoverage = true } = {}) {
  const result = resolveClaimPointers(input);
  if (!result.ok || (requireCriticalCoverage && !result.critical_coverage_complete)) {
    throw new EvidenceResolutionError('CLAIM_POINTER_RESOLUTION_FAILED', {
      errors: result.errors,
      uncovered_critical_claims: result.uncovered_critical_claims
    });
  }
  return result;
}
