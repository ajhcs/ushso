import { canonicalJson, sha256 } from './canonical.mjs';

const LANES = Object.freeze({ harvard_dataverse: 52, datacite: 50 });

function sortedUnique(values, label) {
  if (values.some((value) => typeof value !== 'string' || value.length < 1)) throw new TypeError(`${label} contains an invalid identifier.`);
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) throw new Error(`${label} contains duplicate identifiers.`);
  return sorted;
}

export function buildLegacyLaneParity(records) {
  if (!Array.isArray(records)) throw new TypeError('Legacy parity input must be an array of canonical records.');
  const rows = records.filter((record) => Object.hasOwn(LANES, record?.identity?.source?.source_id));
  const mappings = rows.map((record) => {
    const lane = record.identity.source.source_id;
    const stableAssetId = record.identity?.asset?.asset_id;
    const sourceNativeId = record.identity?.match_fields?.source_id;
    if (record.record_id !== stableAssetId || typeof sourceNativeId !== 'string' || sourceNativeId.length < 1) {
      throw new Error(`Legacy ${lane} row does not preserve record/asset/source-native identity.`);
    }
    const provenanceIds = sortedUnique((record.provenance ?? []).map((entry) => entry.provenance_id), `${record.record_id} provenance`);
    const evidence = (record.evidence ?? []).map((entry) => {
      const refs = sortedUnique(entry.provenance_ids ?? [], `${entry.evidence_id} provenance references`);
      if (refs.some((id) => !provenanceIds.includes(id))) throw new Error(`${entry.evidence_id} references missing provenance.`);
      return { evidence_id: entry.evidence_id, state: entry.state, provenance_ids: refs };
    }).sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
    sortedUnique(evidence.map((entry) => entry.evidence_id), `${record.record_id} evidence`);
    if (!evidence.some((entry) => entry.evidence_id.endsWith(':evidence:source'))) throw new Error(`${record.record_id} has no source-evidence anchor.`);
    return {
      lane,
      legacy_record_id: record.record_id,
      stable_asset_id: stableAssetId,
      source_native_id: sourceNativeId,
      canonical_url: record.authoritative_url ?? null,
      doi: record.identity.match_fields.doi ?? null,
      evidence,
      provenance_ids: provenanceIds,
      automatic_identity_merge: false,
    };
  }).sort((a, b) => a.legacy_record_id.localeCompare(b.legacy_record_id));

  const counts = Object.fromEntries(Object.keys(LANES).map((lane) => [lane, mappings.filter((mapping) => mapping.lane === lane).length]));
  for (const [lane, expected] of Object.entries(LANES)) {
    if (counts[lane] !== expected) throw new Error(`Legacy lane ${lane} expected ${expected} records, received ${counts[lane]}.`);
  }
  sortedUnique(mappings.map((mapping) => mapping.legacy_record_id), 'legacy record IDs');
  sortedUnique(mappings.map((mapping) => mapping.stable_asset_id), 'stable asset IDs');
  return {
    schema_version: 'connector-legacy-lane-parity.v1.0.0',
    status: 'PASS',
    counts,
    records: mappings.length,
    stable_id_collisions: 0,
    missing_source_evidence: 0,
    missing_provenance_links: 0,
    automatic_identity_merges: 0,
    authority_precedence: 'below_first_party_government',
    mapping_digest: sha256(canonicalJson(mappings)),
  };
}
