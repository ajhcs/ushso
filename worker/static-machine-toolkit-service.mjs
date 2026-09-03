import {
  FALSE_TRUTH_BOUNDARY,
  createDomainErrorCore,
  snapshotDigest,
} from '../packages/machine-toolkit/src/index.mjs';

const POLICY_ID = 'policy.public-metadata-only.v1';
const POLICY_EVIDENCE_ID = 'evidence.policy.public-metadata-only.v1';
const PUBLIC_POLICY_URL = 'https://ushso.org/agents';
const SOURCE_CLASS = Object.freeze({
  'cms-data-catalog': 'catalog.cms',
  'cdc-socrata': 'catalog.cdc',
  'census-api': 'catalog.census',
});

function sourceExcerpt(value, fallback = 'Unknown') {
  const text = String(value ?? fallback).replace(/\s+/gu, ' ').trim();
  return (text || fallback).slice(0, 2000);
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function relatedId(kind, recordId) {
  return `${kind}.${stableHash(recordId)}`;
}

function toDate(value, edge) {
  if (typeof value !== 'string') return null;
  if (/^\d{4}$/u.test(value)) return `${value}-${edge === 'start' ? '01-01' : '12-31'}`;
  if (/^\d{4}-\d{2}$/u.test(value)) return `${value}-${edge === 'start' ? '01' : '28'}`;
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : null;
}

function grain(record) {
  const units = new Set(record.unit_of_analysis ?? []);
  for (const [unit, normalized] of [
    ['hospital', 'facility'], ['facility', 'facility'], ['county', 'county'], ['state', 'state'],
    ['health_system', 'system'], ['provider', 'organization'],
  ]) if (units.has(unit)) return normalized;
  return 'unknown';
}

function accessClass(record) {
  // Public catalog visibility is not evidence that the dataset payload itself
  // has public or machine-actionable access.
  return record.access?.status === 'public_direct' ? 'public' : 'unknown';
}

function readiness(record) {
  if (!record.retrieval?.machine_actionable) return 'human_only';
  if (record.access?.mechanisms?.includes('api')) return 'api_documented';
  if (record.access?.mechanisms?.includes('download')) return 'downloadable';
  return 'unknown';
}

function timeIntervals(record) {
  const value = record.time_coverage ?? {};
  const start = toDate(value.start, 'start');
  const end = toDate(value.end, 'end');
  if (!start && !end) return [];
  return [{
    start,
    end,
    period_kind: value.state === 'rolling' ? 'rolling' : 'unknown',
    precision: value.temporal_granularity === 'year' ? 'year' : 'unknown',
  }];
}

function recordEvidence(record) {
  const evidenceId = record.evidence?.[0]?.evidence_id ?? `evidence.catalog.${stableHash(record.record_id)}`;
  return {
    evidence_id: evidenceId,
    evidence_class: 'catalog_record',
    public_locator: record.authoritative_url ?? null,
    observed_at: record.freshness_verification.metadata_observed_at,
    evidence_state: 'observed',
    staleness_state: record.freshness_verification.verification_status === 'current_verified' ? 'current' : 'unknown',
    derivation_reference: 'source.catalog-enumeration.v1',
    policy_reference: null,
  };
}

function policyEvidence(canonicalAsOf) {
  return {
    evidence_id: POLICY_EVIDENCE_ID,
    evidence_class: 'maintained_policy',
    public_locator: PUBLIC_POLICY_URL,
    observed_at: canonicalAsOf,
    evidence_state: 'documented',
    staleness_state: 'current',
    derivation_reference: 'policy.direct.v1',
    policy_reference: POLICY_ID,
  };
}

function warning(message = 'This response contains indexed first-party catalog metadata only. It does not contain source-data payloads or analytical results.') {
  return {
    code: 'public_metadata_only',
    message,
    evidence_ids: [POLICY_EVIDENCE_ID],
    copy_policy_version: POLICY_ID,
  };
}

function uniqueEvidence(records, canonicalAsOf) {
  const references = [policyEvidence(canonicalAsOf), ...records.map(recordEvidence)];
  return references.filter((reference, index) => references.findIndex(candidate => candidate.evidence_id === reference.evidence_id) === index);
}

function successCore({ capability, context, result, records = [], resultState = 'complete', warnings = [warning()] }) {
  return {
    tool_contract_version: 'observatory-machine-toolkit.v1.0.0',
    capability,
    ok: true,
    registry_revision: context.registry_revision,
    index_generation: context.index_generation,
    publication_manifest_id: context.publication_manifest_id,
    canonical_as_of: context.canonical_as_of,
    coverage_snapshot_id: context.coverage_snapshot_id,
    result_state: resultState,
    result,
    error: null,
    evidence_references: uniqueEvidence(records, context.canonical_as_of),
    warnings,
    truncated: false,
    omitted_sections: [],
    next_cursor: null,
    continuation_expires_at: null,
    generation_retention_expires_at: context.generation_retention_expires_at,
    restart_required: false,
    rate_limit: context.rate_limit,
    truth_boundary: { ...FALSE_TRUTH_BOUNDARY },
  };
}

function unavailable(capability, input, context, code = 'record_unavailable_in_generation', options = {}) {
  return createDomainErrorCore({ capability, input, context, code, ...options });
}

function generationUnavailable(capability, input, context) {
  if (!input.expected_generation || input.expected_generation === context.index_generation) return null;
  return unavailable(capability, input, context, 'generation_unavailable');
}

function summary(record, mode, whyRelevant = null) {
  const evidenceId = record.evidence[0].evidence_id;
  const relevance = mode === 'search';
  return {
    asset_id: record.record_id,
    title: sourceExcerpt(record.title),
    geography_ids: [],
    grain: grain(record),
    time_intervals: timeIntervals(record),
    access_class: accessClass(record),
    machine_readiness: readiness(record),
    evidence_state: 'observed',
    observed_at: record.freshness_verification.metadata_observed_at,
    staleness_state: record.freshness_verification.verification_status === 'current_verified' ? 'current' : 'unknown',
    evidence_ids: [evidenceId],
    role_candidates: relevance ? (record.capabilities?.topics ?? []).slice(0, 4).map(topic => `role.${topic.id}`) : null,
    why_relevant: relevance ? [sourceExcerpt(whyRelevant ?? 'The indexed title or metadata matches the stated research need.')] : null,
    confidence: relevance ? 'moderate' : null,
    derivation_references: relevance ? ['ranker.metadata-lexical.v1'] : null,
    near_miss_reasons: relevance ? [] : null,
  };
}

function textFor(record) {
  return [record.title, record.description, ...(record.capabilities?.topics ?? []).flatMap(topic => [topic.id, topic.label])]
    .filter(Boolean).join(' ').toLowerCase();
}

function filterRecords(records, filters) {
  return records.filter(record => {
    if (filters.access_classes.length && !filters.access_classes.includes(accessClass(record))) return false;
    if (filters.authority_levels.length && !filters.authority_levels.includes('authoritative')) return false;
    if (filters.machine_readiness.length && !filters.machine_readiness.includes(readiness(record))) return false;
    if (filters.grain.length && !filters.grain.includes(grain(record))) return false;
    const topicIds = new Set((record.capabilities?.topics ?? []).map(topic => topic.id));
    if (filters.subject_ids.length && !filters.subject_ids.some(id => topicIds.has(id) || topicIds.has(id.replace(/^subject\./u, '')))) return false;
    // The harvested catalog entries do not assert asset-level geography. A
    // geography filter therefore cannot be treated as a match.
    if (filters.geography_ids.length) return false;
    if (filters.time_period && timeIntervals(record).length === 0) return false;
    const searchable = textFor(record);
    if (filters.negative_constraints.some(term => searchable.includes(term.toLowerCase()))) return false;
    for (const dimension of filters.dimensions) {
      if (dimension.dimension === 'source' && !dimension.values.includes(record.identity.source.source_id)) return false;
      if (dimension.dimension === 'topic' && !dimension.values.some(value => topicIds.has(value))) return false;
    }
    return true;
  });
}

function sourceCounts(records) {
  const counts = new Map();
  for (const record of records) counts.set(record.identity.source.source_id, (counts.get(record.identity.source.source_id) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function grainCounts(records) {
  const counts = new Map();
  for (const record of records) counts.set(grain(record), (counts.get(grain(record)) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function groupRecords(records, grouping) {
  if (grouping === 'none' || grouping === 'release') return records;
  const seen = new Set();
  return records.filter(record => {
    const key = grouping === 'source' ? record.identity.source.source_id : record.identity.family.family_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareValue(record, dimension) {
  switch (dimension) {
    case 'role': return sourceExcerpt(record.capabilities?.topics?.[0]?.label, 'Unknown');
    case 'authority': return 'authoritative';
    case 'geography': return null;
    case 'time': {
      const intervals = timeIntervals(record);
      return intervals.length ? `${intervals[0].start ?? 'unknown'} through ${intervals[0].end ?? 'unknown'}` : null;
    }
    case 'grain': return grain(record) === 'unknown' ? null : grain(record);
    case 'access': return accessClass(record);
    case 'variables_schema': return null;
    case 'freshness': return record.freshness_verification.verification_status === 'current_verified' ? 'current' : null;
    case 'machine_readiness': return readiness(record);
    case 'operation_kind': return 'none';
    case 'join_evidence': return null;
    case 'join_compatibility': return record.join_compatibility?.state === 'none_known' ? 'none documented' : null;
    default: return null;
  }
}

export function createStaticMachineToolkitRuntime(catalog, { now = new Date() } = {}) {
  const canonicalAsOf = catalog.corpus.publication.observed_at;
  const context = Object.freeze({
    registry_revision: `registry.v${catalog.corpus.corpus_version}`,
    index_generation: catalog.corpus.publication.generation,
    publication_manifest_id: `publication.${String(catalog.corpus.manifest_sha256).slice(0, 32)}`,
    canonical_as_of: canonicalAsOf,
    coverage_snapshot_id: `coverage.${stableHash(catalog.corpus.publication.generation)}`,
    generation_retention_expires_at: null,
    rate_limit: Object.freeze({
      policy_id: 'public-machine-read.v1',
      limit: 60,
      remaining: 59,
      reset_at: new Date(now.getTime() + 60_000).toISOString(),
      retry_after_seconds: null,
    }),
  });
  const recordsById = new Map(catalog.records.map(record => [record.record_id, record]));

  const operations = {
    async searchAssets(input) {
      const generationError = generationUnavailable('search_assets', input, context);
      if (generationError) return generationError;
      if (input.cursor) return unavailable('search_assets', input, context, 'cursor_expired', { restartRequired: true });
      let matched = filterRecords(catalog.records, input.filters);
      let relevance = new Map();
      if (input.mode === 'search') {
        const tokens = [...new Set(input.research_need.toLowerCase().match(/[a-z0-9]{3,}/gu) ?? [])];
        matched = matched.map(record => {
          const searchable = textFor(record);
          const score = tokens.reduce((total, token) => total + (searchable.includes(token) ? 1 : 0), 0);
          relevance.set(record.record_id, score);
          return record;
        }).filter(record => relevance.get(record.record_id) > 0)
          .sort((left, right) => relevance.get(right.record_id) - relevance.get(left.record_id)
            || left.title.localeCompare(right.title) || left.record_id.localeCompare(right.record_id));
      } else if (input.sort === 'publisher_title') {
        matched.sort((left, right) => left.identity.match_fields.publisher.localeCompare(right.identity.match_fields.publisher)
          || left.title.localeCompare(right.title) || left.record_id.localeCompare(right.record_id));
      } else if (input.sort === 'updated_desc') {
        matched.sort((left, right) => right.freshness_verification.metadata_observed_at.localeCompare(left.freshness_verification.metadata_observed_at)
          || left.title.localeCompare(right.title) || left.record_id.localeCompare(right.record_id));
      } else {
        matched.sort((left, right) => left.title.localeCompare(right.title) || left.record_id.localeCompare(right.record_id));
      }
      const grouped = groupRecords(matched, input.grouping);
      const selected = grouped.slice(0, input.limit);
      const evidenceIds = selected.length ? selected.map(record => record.evidence[0].evidence_id) : [POLICY_EVIDENCE_ID];
      const result = {
        mode: input.mode,
        sort: input.mode === 'search' ? 'frozen_rank_tuple' : input.sort,
        ranker_version: input.mode === 'search' ? 'ranker.metadata-lexical.v1' : 'sort.total-order.v1',
        grouping: input.grouping,
        cursor_binding_digest: await snapshotDigest({ generation: context.index_generation, input }),
        summaries: selected.map(record => summary(record, input.mode, input.mode === 'search'
          ? `${relevance.get(record.record_id)} bounded metadata term(s) matched the stated research need.` : null)),
        facet_counts: grainCounts(matched).map(([value, count]) => ({
          dimension: 'grain', value, count, count_state: 'exact',
          denominator_scope: 'Selected immutable generation and normalized filters before grouping.', evidence_ids: [evidenceIds[0]],
        })),
        aggregates: sourceCounts(matched).map(([value, count]) => ({
          dimension: 'source', value, count, count_state: 'exact',
          denominator_scope: 'Selected immutable generation and normalized filters before grouping.', evidence_ids: [evidenceIds[0]],
        })),
        scoped_zero_statement: 'Zero summaries mean only that this bounded generation and filter scope returned none; no corpus-wide or real-world absence claim is made.',
        absence_claim_permitted: false,
      };
      return successCore({ capability: 'search_assets', context, result, records: selected, resultState: selected.length ? 'complete' : 'empty' });
    },

    async getAsset(input) {
      const generationError = generationUnavailable('get_asset', input, context);
      if (generationError) return generationError;
      if (Object.values(input.collection_cursors).some(Boolean)) return unavailable('get_asset', input, context, 'cursor_expired', { restartRequired: true });
      const record = recordsById.get(input.record_id);
      if (!record) return unavailable('get_asset', input, context);
      const evidenceIds = [record.evidence[0].evidence_id];
      return successCore({
        capability: 'get_asset', context, records: [record], resultState: 'partial',
        result: {
          asset: { asset_id: record.record_id, title: sourceExcerpt(record.title), asset_kind: 'dataset', evidence_ids: evidenceIds },
          source: { source_id: record.identity.source.source_id, name: sourceExcerpt(record.identity.source.name), authority_level: 'authoritative', evidence_ids: evidenceIds },
          identity_state: 'source_scoped', family_state: 'not_grouped',
          releases: [], distributions: [], documentation: [], schemas: [],
          collection_completeness: { releases: 'unknown', distributions: 'unknown', documentation: 'unknown', schemas: 'unknown' },
        },
      });
    },

    async getAccessPlan(input) {
      const generationError = generationUnavailable('get_access_plan', input, context);
      if (generationError) return generationError;
      const record = recordsById.get(input.record_id);
      if (!record) return unavailable('get_access_plan', input, context);
      const evidenceIds = [record.evidence[0].evidence_id];
      return successCore({
        capability: 'get_access_plan', context, records: [record],
        warnings: [warning('This asset-level access plan is derived from live catalog metadata. Separate release, distribution, and access-route identities were not established.')],
        result: {
          asset_id: record.record_id,
          release_id: input.release_id ?? relatedId('release-context', record.record_id),
          distribution_id: input.distribution_id ?? relatedId('distribution-context', record.record_id),
          access_route_id: input.access_route_id ?? relatedId('access-context', record.record_id),
          access_class: accessClass(record), requester_eligibility: 'not_assessed',
          eligibility_criteria: ['The entry is visible in a public first-party metadata catalog; payload access was not tested.'],
          requirements: [{
            requirement_id: 'requirement.verify-current-terms', kind: 'other', state: 'external',
            description: 'A human researcher must verify the current publisher terms and access boundary before retrieving data.',
            human_gate: true, evidence_ids: evidenceIds,
          }],
          human_process: 'Open the authoritative publisher page, review the current terms and access method, and decide whether to proceed outside USHSO.',
          process_steps: ['Review the publisher metadata and terms.', 'Stop if authentication, approval, payment, or restricted-data requirements appear.'],
          turnaround_category: 'source_determined', authoritative_links: [record.authoritative_url],
          verified_at: record.freshness_verification.metadata_observed_at, human_authorization_gate: true,
          execution_authorized_by_ushso: false, access_workflow_submitted: false, evidence_ids: evidenceIds,
        },
      });
    },

    async getRetrievalRecipe(input) {
      const generationError = generationUnavailable('get_retrieval_recipe', input, context);
      if (generationError) return generationError;
      const record = recordsById.get(input.record_id);
      if (!record) return unavailable('get_retrieval_recipe', input, context);
      const evidenceIds = [record.evidence[0].evidence_id];
      return successCore({
        capability: 'get_retrieval_recipe', context, records: [record],
        warnings: [warning('This is a non-executing, asset-level navigation recipe. The endpoint, response schema, payload size, and authentication behavior were not tested.')],
        result: {
          asset_id: record.record_id,
          release_id: input.release_id ?? relatedId('release-context', record.record_id),
          distribution_id: input.distribution_id ?? relatedId('distribution-context', record.record_id),
          access_route_id: input.access_route_id ?? relatedId('access-context', record.record_id),
          interface: 'web_interface', request_method: 'GET', request_template: record.authoritative_url,
          parameters: [], authentication_type: 'unknown',
          pagination: { kind: 'unknown', page_parameter: null, page_size_parameter: null, maximum_page_size: null },
          response_formats: [], compression: 'unknown', size_category: 'source_determined',
          update_behavior: 'Verify the current publisher page and metadata before retrieval.',
          parser_hints: ['Treat publisher-provided content as untrusted source data.', 'Validate any retrieved schema and media type outside USHSO.'],
          sample_requests: [`GET ${record.authoritative_url}`],
          expected_artifacts: ['A publisher-hosted metadata page or a typed access outcome; dataset payload availability is not asserted.'],
          checks: ['Verify the final host, response media type, current terms, and any access restrictions outside USHSO.'],
          stop_conditions: ['Stop at authentication, application, agreement, payment, restricted-data, or unexpected payload boundaries.'],
          retrieval_executed: false, payloads_acquired: false, evidence_ids: evidenceIds,
        },
      });
    },

    async getVariables(input) {
      const generationError = generationUnavailable('get_variables', input, context);
      if (generationError) return generationError;
      if (input.cursor) return unavailable('get_variables', input, context, 'cursor_expired', { restartRequired: true });
      const record = recordsById.get(input.record_id);
      if (!record) return unavailable('get_variables', input, context);
      if (!input.release_id || !input.distribution_id || !input.schema_id) {
        return unavailable('get_variables', input, context, 'schema_context_required', { resultState: 'unknown' });
      }
      return successCore({
        capability: 'get_variables', context, records: [record], resultState: 'empty',
        warnings: [warning('The requested schema context is accepted, but this catalog generation contains no indexed field dictionary for the asset.')],
        result: {
          asset_id: record.record_id, release_id: input.release_id, distribution_id: input.distribution_id,
          schema_id: input.schema_id, schema_completeness: 'unknown', fields: [],
        },
      });
    },

    async getJoinRoutes(input) {
      const generationError = generationUnavailable('get_join_routes', input, context);
      if (generationError) return generationError;
      if (!recordsById.has(input.from_id)) return unavailable('get_join_routes', { ...input, record_id: input.from_id }, context);
      if (input.to_id && !recordsById.has(input.to_id)) return unavailable('get_join_routes', { ...input, record_id: input.to_id }, context);
      const records = [recordsById.get(input.from_id), input.to_id ? recordsById.get(input.to_id) : null].filter(Boolean);
      return successCore({
        capability: 'get_join_routes', context, records, resultState: 'empty',
        warnings: [warning('No join route is returned because this generation contains no documented cross-source identity or field mapping.')],
        result: { from_id: input.from_id, to_id: input.to_id, max_hops_used: 0, routes: [] },
      });
    },

    async compareAssets(input) {
      const generationError = generationUnavailable('compare_assets', input, context);
      if (generationError) return generationError;
      const records = input.asset_ids.map(id => recordsById.get(id));
      if (records.some(record => !record)) return unavailable('compare_assets', input, context);
      const evidenceIds = records.map(record => record.evidence[0].evidence_id);
      const dimensions = input.dimensions.map(dimension => {
        const values = records.map(record => {
          const metadataValue = compareValue(record, dimension);
          return { asset_id: record.record_id, metadata_value: metadataValue, state: metadataValue === null ? 'unknown' : 'known' };
        });
        return {
          dimension,
          state: values.every(value => value.state === 'known') ? 'comparable' : 'unknown',
          values,
          explanation: 'Only indexed metadata is compared. Unknown values are preserved and no source values or analytical rankings are produced.',
          evidence_ids: evidenceIds,
        };
      });
      return successCore({
        capability: 'compare_assets', context, records,
        result: { asset_ids: input.asset_ids, dimensions, pairwise_operations: [], ranking_performed: false, source_values_compared: false },
      });
    },

    async getCoverageStatus(input) {
      const generationError = generationUnavailable('get_coverage_status', input, context);
      if (generationError) return generationError;
      if (input.cursor) return unavailable('get_coverage_status', input, context, 'cursor_expired', { restartRequired: true });
      const cells = [];
      for (const [sourceId, count] of Object.entries(catalog.corpus.source_slices)) {
        const sourceClass = SOURCE_CLASS[sourceId] ?? `catalog.${sourceId}`;
        if (input.source_classes.length && !input.source_classes.includes(sourceClass)) continue;
        if (input.geography_ids.length && !input.geography_ids.includes('geo.us')) continue;
        const sourceRecords = catalog.records.filter(record => record.identity.source.source_id === sourceId);
        const digest = await snapshotDigest(sourceRecords.map(record => record.record_id).sort());
        cells.push({
          cell_id: `coverage.${sourceId}`,
          geography_id: 'geo.us', source_class: sourceClass, coverage_cell_state: 'integrated',
          processing_status: 'normalized', completeness_state: 'complete',
          denominator: {
            definition_id: 'denominator.first-party-catalog-enumeration.v1', unit: 'native_item', count,
            status: 'known', bounded_inventory_complete: true, membership_manifest_digest: digest,
          },
          interpretation: 'Complete means the named first-party catalog metadata route was exhaustively enumerated for this snapshot. It does not mean every dataset payload or every possible health-data source was verified.',
          absence_claim_permitted: false, evidence_ids: [POLICY_EVIDENCE_ID],
        });
      }
      const selected = cells.slice(0, input.limit);
      return successCore({
        capability: 'get_coverage_status', context, resultState: selected.length ? 'complete' : 'empty',
        result: {
          federal_baseline: {
            state: 'integrated', source_scope_count: Object.keys(catalog.corpus.source_slices).length,
            description: 'The federal baseline contains three completely enumerated first-party metadata catalogs in this snapshot.',
            evidence_ids: [POLICY_EVIDENCE_ID],
          },
          cells: selected,
          scope_interpretation: 'Coverage is limited to the named catalog metadata routes and must not be interpreted as a census of all U.S. health-data sources or as payload availability.',
          absence_claim_permitted: false,
        },
      });
    },

    async planResearch(input) {
      return unavailable('plan_research', input, context, 'planner_unavailable', { resultState: 'disabled' });
    },
  };

  return Object.freeze({ context, operations: Object.freeze(operations) });
}
