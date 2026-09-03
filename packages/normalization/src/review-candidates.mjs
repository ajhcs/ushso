import { contentFingerprint, opaqueId } from './canonical.mjs';

function normalizedTitle(record) {
  return record.identity?.match_fields?.normalized_title?.trim() || null;
}

function normalizedUrl(record) {
  const value = record.identity?.match_fields?.normalized_url?.trim();
  if (!value) return null;
  return value.replace(/^https?:\/\//iu, '').replace(/\/$/u, '').toLowerCase();
}

export function buildReviewCandidates(records, assetIdByLegacyId) {
  const byPair = new Map();
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const left = records[leftIndex];
      const right = records[rightIndex];
      const titleMatch = normalizedTitle(left) !== null && normalizedTitle(left) === normalizedTitle(right);
      const locatorMatch = normalizedUrl(left) !== null && normalizedUrl(left) === normalizedUrl(right);
      if (!titleMatch && !locatorMatch) continue;
      const legacyIds = [left.record_id, right.record_id].sort();
      const assetIds = legacyIds.map(id => assetIdByLegacyId.get(id));
      const features = {
        normalized_title_equal: titleMatch,
        normalized_locator_equal: locatorMatch,
        publisher_equal: left.identity?.match_fields?.publisher === right.identity?.match_fields?.publisher,
        source_equal: left.identity?.source?.source_id === right.identity?.source?.source_id
      };
      const scoreMicros = titleMatch && locatorMatch ? 800000 : (locatorMatch ? 700000 : 650000);
      const candidate = {
        candidate_id: opaqueId('identity-candidate', `${assetIds[0]}\u0000${assetIds[1]}\u0000legacy-similarity-v1`),
        ordered_asset_ids: assetIds,
        ordered_legacy_record_ids: legacyIds,
        candidate_type: 'same_identity',
        state: 'open',
        algorithm: { name: 'legacy-similarity-candidate-generator', version: '1.0.0', feature_version: '1.0.0' },
        features,
        feature_fingerprint: contentFingerprint(features),
        match_score_micros: scoreMicros,
        epistemic_confidence: titleMatch && locatorMatch ? 'moderate' : 'low',
        automatic_merge_performed: false,
        required_resolution_basis: 'human_review'
      };
      byPair.set(assetIds.join('\u0000'), candidate);
    }
  }
  return [...byPair.values()].sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
}
