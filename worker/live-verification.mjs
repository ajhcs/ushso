function fail(message) {
  throw new Error(`LIVE_VERIFICATION_RECEIPT_INVALID:${message}`);
}

function knownSourceUrls(record) {
  return new Set([
    record.authoritative_url,
    ...(record.provenance ?? []).map(source => source.locator),
    ...(record.retrieval?.instructions ?? []).map(step => step.url)
  ].filter(value => typeof value === 'string'));
}

export function applyLiveVerificationReceipt(records, receipt) {
  if (!receipt || receipt.schema_version !== 'observatory-live-verification.v1.0.0') fail('schema');
  if (!Array.isArray(receipt.records) || receipt.scope?.record_count !== receipt.records.length) fail('record_count');
  const recordsById = new Map(records.map(record => [record.record_id, structuredClone(record)]));
  const seen = new Set();

  for (const overlay of receipt.records) {
    if (!overlay?.record_id || seen.has(overlay.record_id)) fail(`duplicate_or_missing_id:${overlay?.record_id ?? 'unknown'}`);
    seen.add(overlay.record_id);
    const record = recordsById.get(overlay.record_id);
    if (!record) fail(`record_missing_from_corpus:${overlay.record_id}`);
    if (overlay.http_status !== 200 || overlay.verification_status !== 'current_verified' || overlay.verification_method !== 'first_party_live') fail(`not_current:${overlay.record_id}`);
    if (!knownSourceUrls(record).has(overlay.authoritative_url)) fail(`source_mismatch:${overlay.record_id}`);

    const evidenceId = `evidence:${receipt.receipt_id}:${record.record_id}`;
    const locators = [overlay.authoritative_url, ...(overlay.additional_evidence_urls ?? [])];
    const provenanceIds = locators.map((locator, index) => {
      const provenanceId = `provenance:${receipt.receipt_id}:${record.record_id}:${index + 1}`;
      record.provenance.push({
        provenance_id: provenanceId,
        kind: index === 0 ? 'first_party_page' : 'documentation',
        locator,
        observed_at: receipt.observed_at,
        capture_state: 'locator_only',
        content_sha256: null
      });
      return provenanceId;
    });
    record.evidence.push({
      evidence_id: evidenceId,
      claim: overlay.claim,
      state: 'verified_first_party',
      provenance_ids: provenanceIds,
      limitations: [...overlay.variable_documentation.limitations, receipt.scope.boundary]
    });
    record.freshness_verification = {
      ...record.freshness_verification,
      metadata_observed_at: receipt.observed_at,
      verification_status: overlay.verification_status,
      verification_method: overlay.verification_method
    };
    record.variable_documentation = {
      ...structuredClone(overlay.variable_documentation),
      variables: overlay.variable_documentation.variables.map(variable => ({
        ...structuredClone(variable),
        evidence_state: 'verified_first_party',
        evidence_ids: [evidenceId]
      })),
      evidence_state: 'verified_first_party',
      evidence_ids: [evidenceId]
    };
    recordsById.set(record.record_id, record);
  }

  return records.map(record => recordsById.get(record.record_id));
}
