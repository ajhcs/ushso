const RECORD_TARGETS = Object.freeze([
  ['organization_id', 'organizations', 'organization_id'],
  ['source_id', 'sources', 'source_id'],
  ['asset_id', 'assets', 'asset_id'],
  ['release_id', 'releases', 'release_id'],
  ['distribution_id', 'distributions', 'distribution_id'],
  ['documentation_id', 'documentation', 'documentation_id'],
  ['access_route_id', 'access_routes', 'access_route_id'],
  ['observation_id', 'access_observations', 'observation_id'],
  ['assertion_id', 'assertions', 'assertion_id']
]);

function indexBy(rows, key) {
  return new Map(rows.map(row => [row[key], row]));
}

export function importMappingErrors({ plan, bundle }) {
  const errors = [];
  const indexes = Object.fromEntries(RECORD_TARGETS.map(([, collection, idField]) => [collection, indexBy(bundle[collection], idField)]));
  const evidence = indexBy(bundle.evidence, 'evidence_id');
  const relationships = indexBy(bundle.relationships, 'relationship_id');
  const schemaFields = indexBy(bundle.schema_fields, 'schema_field_id');
  const mappedByTarget = Object.fromEntries(RECORD_TARGETS.map(([mappingField]) => [mappingField, new Set()]));

  for (const mapping of plan.record_mappings) {
    const legacyId = mapping.legacy_record_id;
    const ids = mapping.canonical_ids;
    const rows = {};
    for (const [mappingField, collection] of RECORD_TARGETS) {
      const id = ids?.[mappingField];
      const row = indexes[collection].get(id);
      rows[mappingField] = row;
      if (!row) errors.push({ code: 'RECORD_MAPPING_TARGET_MISSING', legacy_id: legacyId, field: mappingField, target_id: id ?? null });
      if (mappedByTarget[mappingField].has(id) && mappingField !== 'organization_id') {
        errors.push({ code: 'RECORD_MAPPING_TARGET_REUSED', legacy_id: legacyId, field: mappingField, target_id: id });
      }
      mappedByTarget[mappingField].add(id);
    }
    if (rows.asset_id && (
      rows.asset_id.source_id !== ids.source_id
      || rows.asset_id.responsible_organization_id !== ids.organization_id
      || !rows.asset_id.legacy_aliases.includes(legacyId)
    )) errors.push({ code: 'RECORD_MAPPING_ASSET_MISMATCH', legacy_id: legacyId });
    if (rows.source_id && !rows.source_id.legacy_aliases.includes(`${legacyId}#source`)) errors.push({ code: 'RECORD_MAPPING_SOURCE_ALIAS_MISMATCH', legacy_id: legacyId });
    if (rows.release_id && rows.release_id.asset_id !== ids.asset_id) errors.push({ code: 'RECORD_MAPPING_RELEASE_MISMATCH', legacy_id: legacyId });
    if (rows.distribution_id && rows.distribution_id.release_id !== ids.release_id) errors.push({ code: 'RECORD_MAPPING_DISTRIBUTION_MISMATCH', legacy_id: legacyId });
    if (rows.documentation_id && rows.documentation_id.subject_id !== ids.asset_id) errors.push({ code: 'RECORD_MAPPING_DOCUMENTATION_MISMATCH', legacy_id: legacyId });
    if (rows.access_route_id && rows.access_route_id.distribution_id !== ids.distribution_id) errors.push({ code: 'RECORD_MAPPING_ACCESS_ROUTE_MISMATCH', legacy_id: legacyId });
    if (rows.observation_id && rows.observation_id.access_route_id !== ids.access_route_id) errors.push({ code: 'RECORD_MAPPING_OBSERVATION_MISMATCH', legacy_id: legacyId });
    if (rows.assertion_id && rows.assertion_id.subject_id !== ids.asset_id) errors.push({ code: 'RECORD_MAPPING_ASSERTION_MISMATCH', legacy_id: legacyId });
    for (const evidenceId of mapping.evidence_ids ?? []) {
      if (!evidence.has(evidenceId)) errors.push({ code: 'RECORD_MAPPING_EVIDENCE_MISSING', legacy_id: legacyId, target_id: evidenceId });
    }
    const assetEvidence = new Set((rows.asset_id?.evidence_refs ?? []).map(reference => reference.evidence_id));
    if ((mapping.evidence_ids ?? []).some(id => !assetEvidence.has(id))) errors.push({ code: 'RECORD_MAPPING_EVIDENCE_MISMATCH', legacy_id: legacyId });
  }

  for (const mapping of plan.join_route_mappings) {
    for (const relationshipId of mapping.relationship_ids ?? []) {
      const relationship = relationships.get(relationshipId);
      if (!relationship) {
        errors.push({ code: 'ROUTE_MAPPING_TARGET_MISSING', legacy_id: mapping.legacy_route_id, target_id: relationshipId });
      } else if (relationship.relationship_domain !== 'join'
        || !relationship.legacy_aliases.includes(mapping.legacy_route_id)
        || !schemaFields.has(relationship.subject_id)
        || !schemaFields.has(relationship.object_id)) {
        errors.push({ code: 'ROUTE_MAPPING_TARGET_MISMATCH', legacy_id: mapping.legacy_route_id, target_id: relationshipId });
      }
    }
  }

  return errors;
}

export function assertImportMappings(value) {
  const errors = importMappingErrors(value);
  if (errors.length > 0) {
    const error = new Error(`IMPORT_MAPPING_RECONCILIATION_FAILED:${JSON.stringify(errors.slice(0, 10))}`);
    error.code = 'IMPORT_MAPPING_RECONCILIATION_FAILED';
    error.errors = errors;
    throw error;
  }
  return true;
}

