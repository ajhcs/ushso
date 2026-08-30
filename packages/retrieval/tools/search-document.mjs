import { recordSearchText } from './question-parser.mjs';

function unique(values) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ''))].sort();
}

export function projectSearchDocument(record, joinRoutes = []) {
  const capabilities = [...(record.capabilities?.topics ?? []), ...(record.capabilities?.use_cases ?? [])];
  return {
    schema_version: 'observatory-search-document.v1.0.0',
    search_document_id: `search:${record.record_id}`,
    resource_record_id: record.record_id,
    projection_role: 'discovery_view',
    authoritative_record: false,
    title: record.title,
    description: record.description,
    authoritative_url: record.authoritative_url,
    identity: {
      source_id: record.identity.source.source_id,
      source_name: record.identity.source.name,
      family_id: record.identity.family.family_id,
      family_name: record.identity.family.name,
      family_resolution_state: record.identity.family.resolution_state,
      asset_id: record.identity.asset.asset_id,
      asset_type: record.identity.asset.asset_type,
      version_state: record.identity.asset.version_state,
      version_label: record.identity.asset.version_label
    },
    geography: {
      coverage_level: record.geography.coverage_level,
      jurisdictions: [...record.geography.jurisdictions],
      rurality_support: record.geography.rurality_support
    },
    time_coverage: {
      state: record.time_coverage.state,
      start: record.time_coverage.start,
      end: record.time_coverage.end,
      temporal_granularity: record.time_coverage.temporal_granularity
    },
    units_of_analysis: [...record.unit_of_analysis],
    capabilities: capabilities.map(item => ({ id: item.id, label: item.label, fitness: item.fitness, evidence_state: item.evidence_state })),
    access: {
      status: record.access.status,
      mechanisms: [...record.access.mechanisms],
      requirements: [...record.access.requirements],
      machine_actionable: record.retrieval.machine_actionable,
      preferred_interface: record.retrieval.preferred_interface
    },
    search_text: recordSearchText(record),
    facets: {
      geography: unique([record.geography.coverage_level, ...record.geography.jurisdictions]),
      unit_of_analysis: unique(record.unit_of_analysis),
      capability: unique(capabilities.map(item => item.id)),
      access_status: [record.access.status],
      access_mechanism: unique(record.access.mechanisms),
      source: [record.identity.source.source_id],
      family: [record.identity.family.family_id]
    },
    projection_inputs: [{
      ref_id: record.record_id,
      ref_type: 'legacy_discovery_record',
      schema_version: record.schema_version
    }],
    evidence_refs: unique(record.evidence.map(item => item.evidence_id)),
    provenance_refs: unique(record.provenance.map(item => item.provenance_id)),
    relationship_refs: unique(joinRoutes
      .filter(route => route.from_record_id === record.record_id || route.to_record_id === record.record_id)
      .map(route => route.route_id)),
    projection_warning: 'This search document is a denormalized retrieval view, not source truth. Resolve claims through referenced evidence, access observations, and relationships.'
  };
}

export function projectSearchDocuments(records, joinRoutes = []) {
  return records.map(record => projectSearchDocument(record, joinRoutes)).sort((a, b) => a.search_document_id.localeCompare(b.search_document_id));
}
