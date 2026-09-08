// Review-only, out-of-line publisher dictionaries. No schema/release approval.
const encoder = new TextEncoder();
const HEX = /^[a-f0-9]{64}$/;
const BASE = '/research-dictionaries-v1';
export const DICTIONARY_PAGE_BYTES = 64 * 1024;
export const DICTIONARY_DESCRIPTOR_BYTES = 256 * 1024;
export async function dictionaryHash(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
const fail = code => { throw Object.assign(new Error(code), { code }); };
export async function boundedJson(assets, origin, path, maximum, expectedHash) {
  const response = await assets.fetch(new Request(new URL(path, origin)));
  if (response.status === 404) fail('dictionary_unavailable');
  if (!response.ok || !response.body) fail('dictionary_storage_unavailable');
  if (Number(response.headers.get('content-length')) > maximum) { await response.body.cancel(); fail('dictionary_size_exceeded'); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); fail('dictionary_size_exceeded'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const sha256 = await dictionaryHash(bytes);
  if (expectedHash && sha256 !== expectedHash) fail('dictionary_hash_mismatch');
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('dictionary_invalid_json'); }
  return { value, sha256, bytes: size };
}
export async function dictionaryReviewPage({ assets, origin, record, generation, cursorSigner, packageManifestSha256, cursor = null, field = null, expectedGeneration = null }) {
  if (expectedGeneration != null && expectedGeneration !== generation) fail('generation_unavailable');
  if (!HEX.test(packageManifestSha256)) fail('dictionary_package_pin_required');
  const { value: manifest } = await boundedJson(assets, origin, `${BASE}/manifest.json`, 2 * 1024 * 1024, packageManifestSha256);
  if (manifest.format !== 'ushso.dictionary-review-package.v1' || manifest.generation !== generation
    || manifest.review_status !== 'pending_owner_review' || manifest.publication_authorized !== false
    || !Array.isArray(manifest.records) || manifest.records.length > 4000) fail('dictionary_package_binding');
  const matches = manifest.records.filter(item => item?.record_id === record.record_id);
  if (!matches.length) fail('dictionary_unavailable');
  if (matches.length !== 1 || !HEX.test(matches[0].sha256)) fail('dictionary_package_binding');
  const idHash = await dictionaryHash(record.record_id);
  const { value: descriptor, sha256 } = await boundedJson(assets, origin, `${BASE}/records/${idHash}.json`, DICTIONARY_DESCRIPTOR_BYTES, matches[0].sha256);
  if (descriptor.format !== 'ushso.dictionary-review.v1' || descriptor.record_id !== record.record_id
    || descriptor.generation !== generation || descriptor.baseline_record_sha256 !== await dictionaryHash(JSON.stringify(record))
    || descriptor.review_status !== 'pending_owner_review' || descriptor.publication_authorized !== false
    || descriptor.schema_applicability !== 'unresolved' || !HEX.test(descriptor.source_proposal_sha256)
    || !Array.isArray(descriptor.pages) || descriptor.pages.length > 2000
    || !Number.isSafeInteger(descriptor.variable_count) || descriptor.variable_count < 0
    || !Array.isArray(descriptor.isolated_fields) || descriptor.isolated_fields.length > 2000
    || !Array.isArray(descriptor.evidence) || !Array.isArray(descriptor.provenance) || !Array.isArray(descriptor.limitations)) fail('dictionary_binding_invalid');
  let count = 0;
  for (const page of descriptor.pages) {
    if (!HEX.test(page.sha256) || !Number.isSafeInteger(page.count) || page.count < 1 || page.count > 50
      || !Number.isSafeInteger(page.bytes) || page.bytes < 2 || page.bytes > DICTIONARY_PAGE_BYTES) fail('dictionary_binding_invalid');
    count += page.count;
  }
  if (count !== descriptor.variable_count) fail('dictionary_count_mismatch');

  if (field !== null) {
    if (!HEX.test(field) || !Array.isArray(descriptor.supplements)) fail('dictionary_field_unavailable');
    const matches = descriptor.supplements.filter(item => item?.field_sha256 === field);
    if (matches.length !== 1 || !HEX.test(matches[0].descriptor_sha256)) fail('dictionary_field_unavailable');
    const { value: supplement } = await boundedJson(assets, origin, `${BASE}/supplements/${matches[0].descriptor_sha256}.json`, DICTIONARY_DESCRIPTOR_BYTES, matches[0].descriptor_sha256);
    if (supplement.format !== 'ushso.dictionary-field-supplement.v1' || supplement.field_sha256 !== field
      || supplement.review_status !== 'pending_owner_review' || supplement.publication_authorized !== false
      || supplement.encoding !== 'base64-raw-utf8-json' || typeof supplement.name !== 'string'
      || !Array.isArray(supplement.evidence_ids) || !Array.isArray(supplement.fragments)
      || supplement.fragments.length < 1 || supplement.fragments.length > 2048
      || supplement.fragment_count !== supplement.fragments.length || !Number.isSafeInteger(supplement.total_bytes)
      || supplement.total_bytes < 1 || supplement.total_bytes > 64 * 1024 * 1024) fail('dictionary_supplement_binding');
    const evidenceIds = new Set(descriptor.evidence.map(e => e.evidence_id)), provenanceIds = new Set(descriptor.provenance.map(p => p.provenance_id));
    if (supplement.evidence_ids.some(id => !evidenceIds.has(id)) || descriptor.evidence.some(e => !Array.isArray(e.provenance_ids) || e.provenance_ids.some(id => !provenanceIds.has(id)))) fail('dictionary_evidence_closure');
    let total = 0;
    for (const part of supplement.fragments) {
      if (!HEX.test(part.sha256) || !Number.isSafeInteger(part.bytes) || part.bytes < 2 || part.bytes > DICTIONARY_PAGE_BYTES
        || !Number.isSafeInteger(part.decoded_bytes) || part.decoded_bytes < 1 || part.decoded_bytes > 32768) fail('dictionary_supplement_binding');
      total += part.decoded_bytes;
    }
    if (total !== supplement.total_bytes) fail('dictionary_supplement_binding');
    const pagination = await cursorSigner.page({ capability: 'dictionary_review',
      input: { record_id: record.record_id, expected_generation: expectedGeneration, cursor, field, limit: 1 },
      generation, manifest: packageManifestSha256, items: supplement.fragments, section: 'field_fragments' });
    const selected = pagination.selected[0], index = supplement.fragments.indexOf(selected);
    const { value: fragment } = await boundedJson(assets, origin, `${BASE}/supplements/${selected.sha256}.json`, DICTIONARY_PAGE_BYTES, selected.sha256);
    let decoded;
    try {
      if (typeof fragment.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(fragment.data)) fail('dictionary_fragment_binding');
      decoded = atob(fragment.data);
      if (btoa(decoded) !== fragment.data) fail('dictionary_fragment_binding');
    } catch { fail('dictionary_fragment_binding'); }
    if (fragment.encoding !== 'base64' || fragment.index !== index || fragment.decoded_bytes !== selected.decoded_bytes
      || decoded.length !== selected.decoded_bytes || fragment.byte_offset !== supplement.fragments.slice(0, index).reduce((n, x) => n + x.decoded_bytes, 0)) fail('dictionary_fragment_binding');
    return { format: supplement.format, record_id: record.record_id, generation, name: supplement.name,
      field_sha256: field, total_bytes: supplement.total_bytes, fragment_count: supplement.fragment_count,
      review_status: 'pending_owner_review', publication_authorized: false, schema_applicability: 'unresolved', scientific_approval: null,
      encoding: supplement.encoding, field_completeness: 'partial', full_field_available: true,
      evidence: descriptor.evidence, provenance: descriptor.provenance, limitations: descriptor.limitations,
      fragment, ...pagination.envelope, result_state: 'partial',
      warnings: ['Concatenate decoded fragment bytes in index order; verify total byte count and full field SHA-256 before UTF-8 JSON decoding. Individual fragments may split multibyte characters.',
        'Lossless field availability does not establish scientific completeness, schema applicability or approval.',
        ...(cursorSigner.ephemeral ? ['Cursor is instance-limited until a shared signing key is configured.'] : [])] };
  }

  const pagination = await cursorSigner.page({ capability: 'dictionary_review',
    input: { record_id: record.record_id, expected_generation: expectedGeneration, cursor, field: null, limit: 1 },
    generation, manifest: packageManifestSha256, items: descriptor.pages, section: 'variables' });
  const selected = pagination.selected[0]; let variables = [];
  if (selected) {
    const page = await boundedJson(assets, origin, `${BASE}/pages/${selected.sha256}.json`, DICTIONARY_PAGE_BYTES, selected.sha256);
    if (!Array.isArray(page.value) || page.value.length !== selected.count) fail('dictionary_count_mismatch');
    variables = page.value;
    const evidenceIds = new Set(descriptor.evidence.map(e => e.evidence_id)), provenanceIds = new Set(descriptor.provenance.map(p => p.provenance_id));
    if (variables.some(v => !Array.isArray(v.evidence_ids) || v.evidence_ids.some(id => !evidenceIds.has(id)))
      || descriptor.evidence.some(e => !Array.isArray(e.provenance_ids) || e.provenance_ids.some(id => !provenanceIds.has(id)))) fail('dictionary_evidence_closure');
  }
  return { format: descriptor.format, record_id: record.record_id, generation,
    review_status: 'pending_owner_review', publication_authorized: false, schema_applicability: 'unresolved',
    scientific_approval: null, descriptor_sha256: sha256, source_proposal_sha256: descriptor.source_proposal_sha256,
    source_evidence: descriptor.source_evidence, evidence: descriptor.evidence, provenance: descriptor.provenance,
    limitations: descriptor.limitations, dictionary_scope: descriptor.dictionary_scope, variable_count: descriptor.variable_count,
    isolated_field_count: descriptor.isolated_fields.length, full_field_count: descriptor.full_field_count ?? descriptor.variable_count,
    supplemental_field_count: descriptor.supplemental_field_count ?? 0, variables, ...pagination.envelope,
    result_state: 'partial', dictionary_completeness: 'unknown',
    warnings: ['Publisher dictionary proposals only; not an approved payload schema, release mapping, observation grain, measurement unit or scientific fitness claim.',
      'End of pagination means all packaged entries were traversed, not that the publisher dictionary or scientific evidence is complete.',
      ...(cursorSigner.ephemeral ? ['Cursor is instance-limited until a shared signing key is configured.'] : [])] };
}
