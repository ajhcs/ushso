const RESTRICTED = new Set(['registration_required', 'application_required', 'dua_required', 'licensed_paid', 'controlled']);

export function semanticErrors(record) {
  const errors = [];
  if (record.record_id !== record.identity.asset.asset_id) errors.push('record_id must equal identity.asset.asset_id');
  const evidenceIds = new Set(record.evidence.map((row) => row.evidence_id));
  const provenanceIds = new Set(record.provenance.map((row) => row.provenance_id));
  if (evidenceIds.size !== record.evidence.length) errors.push('evidence_id values must be unique within a record');
  if (provenanceIds.size !== record.provenance.length) errors.push('provenance_id values must be unique within a record');
  const referencedEvidence = [
    ...record.identity.family.evidence_ids,
    ...record.geography.evidence_ids,
    ...record.time_coverage.evidence_ids,
    ...record.access.evidence_ids
  ];
  for (const capability of [...record.capabilities.topics, ...record.capabilities.use_cases]) referencedEvidence.push(...capability.evidence_ids);
  for (const key of record.join_compatibility.keys) referencedEvidence.push(...key.evidence_ids);
  for (const id of referencedEvidence) if (!evidenceIds.has(id)) errors.push(`unknown evidence reference: ${id}`);
  for (const row of record.evidence) for (const id of row.provenance_ids) if (!provenanceIds.has(id)) errors.push(`unknown provenance reference: ${id}`);
  record.retrieval.instructions.forEach((step, index) => {
    if (step.sequence !== index + 1) errors.push('retrieval instruction sequence must be contiguous and ordered');
  });
  if (RESTRICTED.has(record.access.status) && record.retrieval.machine_actionable) errors.push('restricted access cannot be marked machine_actionable');
  if (RESTRICTED.has(record.access.status) && !record.retrieval.instructions.some((step) => step.requires_human)) errors.push('restricted access requires a human-gated retrieval step');
  if (record.access.infrastructure_state === 'not_tested_offline' && record.freshness_verification.verification_method !== 'offline_fixture') errors.push('not_tested_offline infrastructure requires offline_fixture verification method');
  if (record.identity.family.resolution_state === 'ambiguous' && record.identity.family.candidate_family_ids.length < 2) errors.push('ambiguous family identity requires at least two candidates');
  return [...new Set(errors)];
}
