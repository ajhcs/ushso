import {
  FALSE_TRUTH_BOUNDARY,
  createDomainErrorCore,
  snapshotDigest,
} from '../packages/machine-toolkit/src/index.mjs';
import { createMachineCursorSigner } from './machine-cursor.mjs';
import { collectAssetContext } from '../packages/registry/asset-context-collections.mjs';
import { buildAccessPlan, buildRetrievalRecipe, matchQualifiedRoute } from '../packages/registry/qualified-access-routes.mjs';
import { filterQualifiedFields, matchQualifiedVariableContext } from '../packages/registry/qualified-variable-contexts.mjs';
import { comparisonDimensionState, comparisonExplanation, comparisonFact } from '../packages/registry/comparison-dimensions.mjs';
import { inspectJoinRoutes } from '../packages/registry/qualified-join-routes.mjs';

const POLICY_ID = 'policy.public-metadata-only.v1';
const POLICY_EVIDENCE_ID = 'evidence.policy.public-metadata-only.v1';
const PUBLIC_POLICY_URL = 'https://ushso.org/agents';
const SOURCE_CLASS = Object.freeze({
  'cms-data-catalog': 'catalog.cms',
  'cdc-socrata': 'catalog.cdc',
  'census-api': 'catalog.census',
});

function compareText(left, right) {
  const a = String(left), b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

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

export function toDate(value, edge) {
  if (typeof value !== 'string') return null;
  if (/^\d{4}$/u.test(value)) return `${value}-${edge === 'start' ? '01-01' : '12-31'}`;
  if (/^\d{4}-\d{2}$/u.test(value)) {
    const [year,month]=value.split('-').map(Number);
    if(month<1||month>12)return null;
    const leap=year%4===0&&(year%100!==0||year%400===0);
    const last=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
    return `${value}-${edge==='start'?'01':last}`;
  }
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(value))return null;
  const last=toDate(value.slice(0,7),'end');
  return last&&value.slice(8)>='01'&&value<=last?value:null;
}

function grain(record) {
  // This generation has inferred unit tags, not approved observation-grain
  // claims. Do not turn those tags into a scientific facet or filter match.
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
    precision: value.temporal_granularity === 'year' ? 'year' : /^\d{4}-\d{2}$/u.test(value.start??'')&&/^\d{4}-\d{2}$/u.test(value.end??'')?'month':'unknown',
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

function successCore({ capability, context, result, records = [], extraEvidence = [], resultState = 'complete', warnings = [warning()] }) {
  return {
    tool_contract_version: 'observatory-machine-toolkit.v1.1.0',
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
    evidence_references: uniqueEvidence(records, context.canonical_as_of).concat(extraEvidence).filter((reference, index, list) => list.findIndex(candidate => candidate.evidence_id === reference.evidence_id) === index),
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
  return [...counts.entries()].sort(([left], [right]) => compareText(left, right));
}

function grainCounts(records) {
  const counts = new Map();
  for (const record of records) counts.set(grain(record), (counts.get(grain(record)) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => compareText(left, right));
}

function groupRecords(records, grouping) {
  if (grouping === 'none') return records;
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

export function createStaticMachineToolkitRuntime(catalog, { now = new Date(), cursorSigner = createMachineCursorSigner() } = {}) {
  const canonicalAsOf = catalog.corpus.publication.observed_at;
  const context = Object.freeze({
    tool_contract_version: 'observatory-machine-toolkit.v1.1.0',
    registry_revision: `registry.v${catalog.corpus.corpus_version}`,
    index_generation: catalog.corpus.publication.generation,
    publication_manifest_id: `publication.${String(catalog.corpus.manifest_sha256).slice(0, 32)}`,
    canonical_as_of: canonicalAsOf,
    coverage_snapshot_id: `coverage.${stableHash(catalog.corpus.publication.generation)}`,
    generation_retention_expires_at: null,
    rate_limit: Object.freeze({
      state: 'unknown', policy_id: null, limit: null, remaining: null, reset_at: null, retry_after_seconds: null,
    }),
  });
  const recordsById = new Map(catalog.records.map(record => [record.record_id, record]));
  async function page(capability, input, items, section) {
    try {
      return await cursorSigner.page({ capability, input, items, section, generation: context.index_generation, manifest: catalog.corpus.manifest_sha256 });
    } catch (error) {
      if (error.message !== 'MACHINE_CURSOR_RESTART_REQUIRED') throw error;
      return { error: unavailable(capability, input, context, 'cursor_expired', { restartRequired: true }) };
    }
  }
  function withPagination(response, pagination) {
    Object.assign(response, pagination.envelope);
    if (pagination.envelope.truncated && cursorSigner.ephemeral) response.warnings.push({
      ...warning('Continuation is signed for this Worker instance. A different isolate or restart may require traversal to restart; shared signing-key provisioning is not established.'),
      code: 'cursor_instance_limited',
    });
    return response;
  }

  const operations = {
    async searchAssets(input) {
      const generationError = generationUnavailable('search_assets', input, context);
      if (generationError) return generationError;
      if (input.grouping === 'release') {
        const response = unavailable('search_assets', input, context, 'coverage_unknown', { resultState: 'unknown' });
        response.warnings = [warning('Release grouping is unavailable: this generation does not establish publisher release identities. Asset ordering is not a substitute for release grouping.')];
        response.evidence_references = [policyEvidence(canonicalAsOf)];
        return response;
      }
      if(input.filters.dimensions.some(d=>!['source','topic'].includes(d.dimension)))return unavailable('search_assets',input,context,'invalid_input');
      if(input.filters.geography_ids.length||input.filters.time_period||input.filters.grain.some(value=>value!=='unknown')){
        const response=unavailable('search_assets',input,context,'coverage_unknown',{resultState:'unknown'});
        response.evidence_references=[policyEvidence(canonicalAsOf)];
        response.warnings=[warning('Requested geography, time or observation-grain filtering cannot be evaluated from this generation. Inferred unit tags are not grain evidence. No zero-coverage or absence conclusion is permitted.')];
        return response;
      }
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
            || compareText(left.title, right.title) || compareText(left.record_id, right.record_id));
      } else if (input.sort === 'publisher_title') {
        matched.sort((left, right) => compareText(left.identity.match_fields.publisher, right.identity.match_fields.publisher)
          || compareText(left.title, right.title) || compareText(left.record_id, right.record_id));
      } else if (input.sort === 'updated_desc') {
        matched.sort((left, right) => compareText(right.freshness_verification.metadata_observed_at, left.freshness_verification.metadata_observed_at)
          || compareText(left.title, right.title) || compareText(left.record_id, right.record_id));
      } else {
        matched.sort((left, right) => compareText(left.title, right.title) || compareText(left.record_id, right.record_id));
      }
      const grouped = groupRecords(matched, input.grouping);
      const pagination = await page('search_assets', input, grouped, 'summaries');
      if (pagination.error) return pagination.error;
      const selected = pagination.selected;
      const evidenceIds = selected.length ? selected.map(record => record.evidence[0].evidence_id) : [POLICY_EVIDENCE_ID];
      const result = {
        mode: input.mode,
        sort: input.mode === 'search' ? 'frozen_rank_tuple' : input.sort,
        ranker_version: input.mode === 'search' ? 'ranker.metadata-lexical.code-unit.v2' : 'sort.code-unit-total-order.v2',
        grouping: input.grouping,
        cursor_binding_digest: pagination.binding,
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
      return withPagination(successCore({ capability: 'search_assets', context, result, records: selected, resultState: pagination.resultState }), pagination);
    },

    async getAsset(input) {
      const generationError = generationUnavailable('get_asset', input, context);
      if (generationError) return generationError;
      const record = recordsById.get(input.record_id);
      if (!record) return unavailable('get_asset', input, context);
      const collections = collectAssetContext(record);
      const evidenceIds = [record.evidence[0].evidence_id];
      const sections = ['releases', 'distributions', 'documentation', 'schemas'];
      const paged = {};
      const completeness = {};
      let truncated = false;
      const omitted = [];
      let nextCursor = null;
      let continuationExpires = null;
      for (const section of sections) {
        const collection = collections[section];
        const cursor = input.collection_cursors?.[section] ?? null;
        if (!collection.resolved) {
          if (cursor) return unavailable('get_asset', input, context, 'cursor_expired', { restartRequired: true });
          paged[section] = [];
          completeness[section] = 'unknown';
          continue;
        }
        const pagingInput = {
          contract_version: input.contract_version,
          record_id: input.record_id,
          expected_generation: input.expected_generation,
          collection_limits: input.collection_limits,
          collection_section: section,
          limit: input.collection_limits[section],
          cursor,
        };
        const pagination = await page('get_asset', pagingInput, [...collection.items], section);
        if (pagination.error) return pagination.error;
        paged[section] = pagination.selected;
        if (pagination.envelope.truncated) {
          completeness[section] = 'partial';
          truncated = true;
          omitted.push(section);
          if (!nextCursor) {
            nextCursor = pagination.envelope.next_cursor;
            continuationExpires = pagination.envelope.continuation_expires_at;
          }
        } else {
          completeness[section] = collection.completeness;
        }
      }
      const response = successCore({
        capability: 'get_asset', context, records: [record], resultState: truncated ? 'partial' : 'complete',
        result: {
          asset: { asset_id: record.record_id, title: sourceExcerpt(record.title), asset_kind: 'dataset', evidence_ids: evidenceIds },
          source: { source_id: record.identity.source.source_id, name: sourceExcerpt(record.identity.source.name), authority_level: 'authoritative', evidence_ids: evidenceIds },
          identity_state: 'source_scoped', family_state: 'not_grouped',
          releases: paged.releases, distributions: paged.distributions, documentation: paged.documentation, schemas: paged.schemas,
          collection_completeness: completeness,
        },
      });
      response.truncated = truncated;
      response.omitted_sections = omitted;
      response.next_cursor = nextCursor;
      response.continuation_expires_at = continuationExpires;
      return response;
    },

    async getAccessPlan(input) {
      const generationError = generationUnavailable('get_access_plan', input, context);
      if (generationError) return generationError;
      const record = recordsById.get(input.record_id);
      if (!record) return unavailable('get_access_plan', input, context);
      const route = matchQualifiedRoute(input);
      if (!route) {
        const response = unavailable('get_access_plan', input, context, 'route_not_documented', { resultState: 'unknown' });
        response.warnings = [warning('No verified release, distribution or access-route identity is documented for these identifiers. Call get_asset for documented collection IDs, or inspect the publisher documentation. Do not retry the same undocumented identifiers.')];
        response.evidence_references = uniqueEvidence([record], canonicalAsOf);
        return response;
      }
      return successCore({
        capability: 'get_access_plan', context, records: [record], resultState: 'complete',
        result: buildAccessPlan(route),
      });
    },

    async getRetrievalRecipe(input) {
      const generationError = generationUnavailable('get_retrieval_recipe', input, context);
      if (generationError) return generationError;
      const record = recordsById.get(input.record_id);
      if (!record) return unavailable('get_retrieval_recipe', input, context);
      const route = matchQualifiedRoute(input);
      if (!route) {
        const response = unavailable('get_retrieval_recipe', input, context, 'route_not_documented', { resultState: 'unknown' });
        response.warnings = [warning('No verified release, distribution or access-route identity is documented for these identifiers. Call get_asset for documented collection IDs, or inspect the publisher documentation. Do not retry the same undocumented identifiers.')];
        response.evidence_references = uniqueEvidence([record], canonicalAsOf);
        return response;
      }
      return successCore({
        capability: 'get_retrieval_recipe', context, records: [record], resultState: 'complete',
        result: buildRetrievalRecipe(route),
      });
    },

    async getVariables(input) {
      const generationError = generationUnavailable('get_variables', input, context);
      if (generationError) return generationError;
      const record = recordsById.get(input.record_id);
      if (!record) return unavailable('get_variables', input, context);
      const qualified = matchQualifiedVariableContext(input);
      if (!qualified) {
        const response = unavailable('get_variables', input, context, 'schema_context_required', { resultState: 'unknown' });
        response.warnings = [warning('A supplied schema identifier does not establish dictionary applicability. Call get_asset for documented collection IDs, then request get_variables with those exact IDs. Unapproved dictionary documentation is not a canonical schema.')];
        response.evidence_references = uniqueEvidence([record], canonicalAsOf);
        return response;
      }
      const fields = [...filterQualifiedFields(qualified, { semantic_query: input.semantic_query, filters: input.filters })];
      const pagination = await page('get_variables', input, fields, 'fields');
      if (pagination.error) return pagination.error;
      return withPagination(successCore({
        capability: 'get_variables', context, records: [record],
        resultState: pagination.resultState === 'empty' ? 'empty' : (pagination.envelope.truncated ? 'partial' : 'complete'),
        result: {
          asset_id: qualified.record_id,
          release_id: qualified.release_id,
          distribution_id: qualified.distribution_id,
          schema_id: qualified.schema_id,
          schema_completeness: pagination.envelope.truncated ? 'partial' : qualified.schema_completeness,
          fields: pagination.selected,
        },
      }), pagination);
    },

    async getJoinRoutes(input) {
      const generationError = generationUnavailable('get_join_routes', input, context);
      if (generationError) return generationError;
      if (!recordsById.has(input.from_id)) return unavailable('get_join_routes', { ...input, record_id: input.from_id }, context);
      if (input.to_id && !recordsById.has(input.to_id)) return unavailable('get_join_routes', { ...input, record_id: input.to_id }, context);
      const records = [recordsById.get(input.from_id), input.to_id ? recordsById.get(input.to_id) : null].filter(Boolean);
      const inspected = inspectJoinRoutes(input);
      if (!inspected.routes.length) {
        return successCore({
          capability: 'get_join_routes', context, records, resultState: 'empty',
          warnings: [warning('No join route is returned because this generation contains no documented cross-source identity or field mapping.')],
          result: { from_id: input.from_id, to_id: input.to_id, max_hops_used: 0, routes: [] },
        });
      }
      return successCore({
        capability: 'get_join_routes', context, records, resultState: 'complete',
        extraEvidence: [{
          evidence_id: 'evidence.join-fixture.priority-routes.v1',
          evidence_class: 'documentation',
          public_locator: null,
          observed_at: context.canonical_as_of,
          evidence_state: 'documented',
          staleness_state: 'current',
          derivation_reference: 'policy.direct.v1',
          policy_reference: POLICY_ID,
        }],
        warnings: [warning('Reviewed join fixtures are inspectable metadata. An individually documented pair of joins is not a valid combined path. CCN and NPI are never interchangeable.')],
        result: { from_id: inspected.from_id, to_id: inspected.to_id, max_hops_used: inspected.max_hops_used, routes: inspected.routes },
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
          const overlay = comparisonFact(record, dimension);
          const metadataValue = overlay.metadata_value ?? compareValue(record, dimension);
          const state = overlay.metadata_value != null ? overlay.state : (metadataValue === null ? 'unknown' : 'known');
          return { asset_id: record.record_id, metadata_value: metadataValue, state };
        });
        const state = comparisonDimensionState(values);
        return {
          dimension,
          state,
          values,
          explanation: comparisonExplanation(dimension, values, state),
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
      if(input.subject_ids.length||input.time_period||input.geography_ids.some(id=>id!=='geo.us')){
        const response=unavailable('get_coverage_status',input,context,'coverage_unknown',{resultState:'unknown'});
        response.evidence_references=[policyEvidence(canonicalAsOf)];
        response.warnings=[warning('Requested subject, time or subnational geography coverage is not indexed in this generation. No absence conclusion is permitted.')];
        return response;
      }
      const cells = [];
      for (const [sourceId, count] of Object.entries(catalog.corpus.source_slices).sort(([a], [b]) => compareText(a, b))) {
        if(input.authority_levels.length&&!input.authority_levels.includes('authoritative'))continue;
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
            definition_id: 'denominator.accepted-catalog-records.v2', unit: 'native_item', count: sourceRecords.length,
            status: 'known', bounded_inventory_complete: true, membership_manifest_digest: digest,
          },
          interpretation: `Complete describes membership in this immutable accepted-record inventory only: ${sourceRecords.length} accepted records of ${count} source inventory records; ${Math.max(0, count - sourceRecords.length)} excluded from this service. Publisher-route enumeration completeness, scientific coverage and payload availability are not established by these counts.`,
          absence_claim_permitted: false, evidence_ids: [POLICY_EVIDENCE_ID],
        });
      }
      const pagination = await page('get_coverage_status', input, cells, 'cells');
      if (pagination.error) return pagination.error;
      const selected = pagination.selected;
      return withPagination(successCore({
        capability: 'get_coverage_status', context, resultState: pagination.resultState,
        result: {
          federal_baseline: {
            state: 'integrated', source_scope_count: Object.keys(catalog.corpus.source_slices).length,
            description: `This snapshot represents ${Object.keys(catalog.corpus.source_slices).length} first-party catalog source inventories. Integration does not establish exhaustive publisher-route enumeration or scientific completeness.`,
            evidence_ids: [POLICY_EVIDENCE_ID],
          },
          cells: selected,
          scope_interpretation: 'Coverage is limited to the named catalog metadata routes and must not be interpreted as a census of all U.S. health-data sources or as payload availability.',
          absence_claim_permitted: false,
        },
      }), pagination);
    },

    async planResearch(input) {
      return unavailable('plan_research', input, context, 'planner_unavailable', { resultState: 'disabled' });
    },
  };

  return Object.freeze({ context, operations: Object.freeze(operations) });
}
