export function classifyDeletionEvidence({
  httpStatus = null,
  targetClass,
  explicitTombstone = false,
  consecutiveCompleteMisses = 0,
  requiredCompleteMisses = 2,
}) {
  if (explicitTombstone) {
    return { disposition: 'withdraw_item', admissible: true, sealAllowed: true, parentAssetWithdrawn: true, reason: 'explicit_tombstone' };
  }
  const absent = httpStatus === 404 || httpStatus === 410;
  if (absent && ['catalog_root', 'collection', 'pagination_cursor'].includes(targetClass)) {
    return { disposition: 'fail_enumeration', admissible: false, sealAllowed: false, parentAssetWithdrawn: false, reason: 'enumeration_target_absent' };
  }
  if (absent && targetClass === 'exact_item') {
    return { disposition: 'withdraw_item', admissible: true, sealAllowed: true, parentAssetWithdrawn: true, reason: 'exact_item_absent' };
  }
  if (absent && targetClass === 'exact_distribution') {
    return { disposition: 'update_distribution_access', admissible: true, sealAllowed: true, parentAssetWithdrawn: false, reason: 'exact_distribution_absent' };
  }
  if (absent && targetClass === 'documentation') {
    return { disposition: 'update_documentation_observation', admissible: true, sealAllowed: true, parentAssetWithdrawn: false, reason: 'documentation_absent' };
  }
  if (consecutiveCompleteMisses >= requiredCompleteMisses) {
    return { disposition: 'withdraw_item', admissible: true, sealAllowed: true, parentAssetWithdrawn: true, reason: 'consecutive_complete_misses' };
  }
  return { disposition: 'preserve_active', admissible: false, sealAllowed: true, parentAssetWithdrawn: false, reason: 'insufficient_deletion_evidence' };
}
