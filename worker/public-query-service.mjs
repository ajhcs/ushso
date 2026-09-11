import { assertCoverageRepository } from '../packages/coverage/coverage-repository.mjs';
import { assertPlannerRepository } from '../packages/planner/planner-repository.mjs';
import { assertCatalogRepository } from '../packages/registry/catalog-repository.mjs';
import { assertPublicationReadContext } from '../packages/registry/publication-read-context.mjs';
import {
  accessDimensions,
  auditEvidence,
  dateDimensions,
  descriptionQuality,
  metadataDimensions,
  retrievalPlan
} from '../packages/retrieval/tools/catalog-contract.mjs';
import { projectFreshness } from '../packages/retrieval/tools/retrieval-core-v1.2.mjs';
import { assertSearchBackend } from '../packages/search/search-backend.mjs';

function retrievalId(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  const hex = number => (number >>> 0).toString(16).padStart(8, '0');
  return `retrieval-${hex(first)}${hex(second)}`;
}

function queryFromIntent(intent, filters = {}) {
  return {
    question: intent.original_question,
    normalized_question: intent.normalized_question,
    interpretation: intent.interpretation,
    filters
  };
}

function directResult(record, whyRelevant, evaluatedAt = null) {
  const result = {
    rank: 1,
    score: 1,
    record_id: record.record_id,
    relevance: {
      matched_subjects: [],
      matched_geographies: [],
      matched_units: [],
      matched_terms: [],
      score_components: [{
        kind: 'direct_record_lookup',
        value: 1,
        reason: whyRelevant,
        evidence_state: 'verified_first_party'
      }],
      why_relevant: [whyRelevant]
    },
    record: structuredClone(record)
  };
  if (!evaluatedAt) return result;
  return {
    ...result,
    metadata: {
      dimensions: metadataDimensions(record),
      dates: dateDimensions(record),
      access: accessDimensions(record),
      freshness: projectFreshness(record, evaluatedAt),
      description_quality: descriptionQuality(record),
      claim_evidence: auditEvidence(record),
      retrieval_plan: retrievalPlan(record),
      named_source_role: 'not_applicable',
      geographic_compatibility: 'not_requested',
      observation_time_compatibility: 'not_requested',
      access_compatibility: 'not_requested'
    }
  };
}

export function resolveRequestEvaluationTime({ now, request } = {}) {
  if (now != null && now !== '') {
    const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    if (Number.isNaN(date.valueOf())) throw new TypeError('evaluation time is invalid');
    return date.toISOString();
  }
  const header = typeof request?.headers?.get === 'function' ? request.headers.get('date') : null;
  if (header) {
    const parsed = new Date(header);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function searchInvocation(session) {
  return {
    publication: session.publication,
    request: session.request,
    env: session.env,
    signal: session.signal,
    now: session.evaluatedAt ?? null
  };
}

function resultBounds(totalMatches, returnedCount) {
  return {
    result_count: returnedCount,
    returned_count: returnedCount,
    total_matches: totalMatches,
    has_more: totalMatches > returnedCount
  };
}

export class PublicQueryService {
  constructor({ publicationResolver, catalogRepository, searchBackend, coverageRepository, plannerRepository }) {
    if (!publicationResolver || typeof publicationResolver.resolve !== 'function') throw new TypeError('publicationResolver.resolve() is required');
    this.publicationResolver = publicationResolver;
    this.catalogRepository = assertCatalogRepository(catalogRepository);
    this.searchBackend = assertSearchBackend(searchBackend);
    this.coverageRepository = assertCoverageRepository(coverageRepository);
    this.plannerRepository = assertPlannerRepository(plannerRepository);
  }

  async openRequest({ request, env, now } = {}) {
    const publication = assertPublicationReadContext(await this.publicationResolver.resolve({ request, env, signal: request.signal }));
    return Object.freeze({
      publication,
      request,
      env,
      signal: request.signal,
      evaluatedAt: resolveRequestEvaluationTime({ now, request })
    });
  }

  async health(session) {
    const intent = await this.searchBackend.interpret({
      publication: session.publication,
      request: session.request,
      env: session.env,
      signal: session.signal,
      query: { question: 'health check' }
    });
    return { status: 'ok', service: 'ushso-discovery', contract_version: 'observatory-discovery-result.v1.0.0', compiler: intent.compiler };
  }

  async browse(session, options = 20) {
    const traversal = typeof options === 'number' ? { page_size: Math.min(options, 200) } : options;
    const question = 'Browse published health systems data';
    if (typeof options !== 'number' && typeof this.searchBackend.browseAssets === 'function') {
      const result = await this.searchBackend.browseAssets({
        ...searchInvocation(session),
        query: { question, ...traversal }
      });
      if (result) {
        result.query.filters = { ...result.query.filters, mode: 'catalog_browse' };
        return result;
      }
    }
    const limit = traversal.page_size ?? 20;
    const intent = await this.searchBackend.interpret({
      ...searchInvocation(session),
      query: { question, limit: Math.min(limit, 50) }
    });
    const [records, corpus, joinRoutes] = await Promise.all([
      this.catalogRepository.browseAssets({ ...session, limit }),
      this.catalogRepository.getCatalogSummary(session),
      this.catalogRepository.getJoinRoutes(session)
    ]);
    return {
      contract_version: 'observatory-discovery-result.v1.0.0',
      retrieval_id: retrievalId(`browse:${corpus.corpus_id}:${corpus.corpus_version}:${limit}`),
      evidence_mode: 'published_offline_evidence',
      corpus,
      query: queryFromIntent(intent, { mode: 'catalog_browse', limit }),
      ...resultBounds(corpus.record_count, records.length),
      results: records.map((record, index) => ({
        ...directResult(record, 'Included in the published catalog browse view.'),
        rank: index + 1
      })),
      join_routes: joinRoutes,
      warnings: [
        'Browse mode shows the validated federal baseline first, then other published metadata; order does not imply question relevance or quality.',
        'Records describe indexed metadata and retrieval routes; they do not prove current endpoint availability or authorize access.'
      ]
    };
  }

  async dataset(session, publicId) {
    const record = await this.catalogRepository.getAsset({ ...session, publicId });
    if (!record) return null;
    const question = `Open dataset ${record.record_id}`;
    const [intent, familySize, corpus, joinRoutes] = await Promise.all([
      this.searchBackend.interpret({
        ...searchInvocation(session),
        query: { question }
      }),
      this.catalogRepository.getFamilySize({ ...session, familyId: record.identity?.family?.family_id }),
      this.catalogRepository.getCatalogSummary(session),
      this.catalogRepository.getJoinRoutes({ ...session, recordId: record.record_id })
    ]);
    return {
      contract_version: 'observatory-discovery-result.v1.0.0',
      retrieval_id: retrievalId(`dataset:${corpus.corpus_id}:${record.record_id}`),
      evidence_mode: 'published_offline_evidence',
      corpus,
      query: queryFromIntent(intent, {
        mode: 'stable_dataset_dereference',
        record_id: record.record_id,
        family_sibling_count: Math.max(0, familySize - 1)
      }),
      ...resultBounds(1, 1),
      results: [directResult(record, 'Opened by its stable published record identifier.', session.evaluatedAt)],
      join_routes: joinRoutes,
      warnings: ['This page describes indexed metadata and retrieval routes; it does not prove current endpoint availability or authorize access.']
    };
  }

  async discover(session, query) {
    return this.searchBackend.searchAssets({
      ...searchInvocation(session),
      query
    });
  }

  async getCoverageStatus(session, scope = {}) {
    return this.coverageRepository.getCoverageStatus({ publication: session.publication, scope, signal: session.signal });
  }

  async planResearch(session, request) {
    return this.plannerRepository.planResearch({ publication: session.publication, request, signal: session.signal });
  }
}
