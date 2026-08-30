import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZERO_RESULT_STATEMENT } from '../../../harness/v1.0.0/tools/evaluator.mjs';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, '..', '..', '..');

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function readJsonl(filePath) {
  return (await fs.readFile(filePath, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function sourceRecordId(record, benchmarkSourceIds) {
  const candidates = [record.record_id, record.identity?.match_fields?.source_id].filter(Boolean);
  return candidates.find(candidate => benchmarkSourceIds.has(candidate)) ?? record.record_id;
}

function compileObservedIntent(questionId, discoveryResult) {
  const interpretation = discoveryResult.query.interpretation;
  const geographies = interpretation.geographies.map(item => item.id);
  const units = interpretation.units_of_analysis.map(item => item.id);
  const subjects = interpretation.subjects.map(item => item.label);
  const window = interpretation.time_window;
  const clarificationNeeded = subjects.length === 0 || geographies.length === 0;
  return {
    question_id: questionId,
    research_intent: {
      task: discoveryResult.query.question,
      decision_context: 'Deterministically compiled from controlled vocabulary and lexical evidence in the offline MVP.'
    },
    required_measures: subjects,
    excluded_measures: [],
    geography: {
      requested_scope: interpretation.geographies.map(item => item.label).join(', ') || 'Not resolved',
      jurisdictions: geographies.length ? geographies : ['unknown'],
      rationale: geographies.length ? 'Resolved from the controlled geography vocabulary.' : 'No geography concept resolved from the question.'
    },
    geographic_granularity: geographies.some(value => /^US-[A-Z]{2}$/.test(value)) ? 'state' : geographies.includes('US') ? 'national' : 'unknown',
    time_period: {
      requested: window ? `${window.start_year ?? 'open'}-${window.end_year ?? 'open'}` : 'Not stated',
      start: window?.start_year === null || window?.start_year === undefined ? null : String(window.start_year),
      end: window?.end_year === null || window?.end_year === undefined ? null : String(window.end_year),
      granularity: window ? 'year' : 'unknown',
      semantics: 'Source-native temporal semantics remain authoritative.'
    },
    unit_of_analysis: {
      primary: units[0] ?? 'unknown',
      acceptable: units,
      forbidden: []
    },
    required_access: {
      level: interpretation.access_intent.public_only ? 'public_anonymous' : 'public_or_restricted_disclosed',
      account_required: null,
      application_allowed: interpretation.access_intent.include_restricted,
      anonymous_only: interpretation.access_intent.public_only,
      rationale: 'Compiled from explicit public/restricted language and the default disclosure policy.'
    },
    authoritative_source_requirement: {
      required: true,
      publisher_scope: 'Source-native authoritative routes represented by evidence-backed records.',
      reject_catalog_only: false,
      acceptable_evidence_states: ['verified_first_party', 'source_asserted', 'inferred'],
      rationale: 'Discovery metadata must retain its evidence state and authoritative locator.'
    },
    expected_response_type: discoveryResult.result_count > 1 ? 'multi_source_bundle' : discoveryResult.result_count === 1 ? 'single_source' : clarificationNeeded ? 'clarification_required' : 'unsupported_or_incomplete',
    clarification_needed: clarificationNeeded
  };
}

function resultProvenance(record) {
  const evidenceId = record.evidence?.[0]?.evidence_id;
  return [{
    artifact_path: 'observatory/retrieval/v1.0.1/corpus/records.jsonl',
    locator: `$[?(@.record_id==${JSON.stringify(record.record_id)})]`,
    ...(evidenceId ? { evidence_id: evidenceId } : {})
  }];
}

function resultAccess(record) {
  const status = record.access?.status ?? 'unknown';
  const note = record.access?.restriction_note ?? 'No additional source-specific access note is present in the indexed record.';
  return `${status}: ${note}`;
}

function routeStatus(route) {
  return {
    exact: 'join_proven',
    documented: 'join_documented',
    candidate: 'join_candidate',
    requires_crosswalk: 'join_requires_crosswalk',
    incompatible: 'unknown',
    unknown: 'unknown'
  }[route.compatibility_state] ?? 'unknown';
}

function adaptRoutes(routes, sourceIdByRecordId) {
  return routes.flatMap(route => {
    const sourceIds = [...new Set([sourceIdByRecordId.get(route.from_record_id), sourceIdByRecordId.get(route.to_record_id)].filter(Boolean))];
    if (sourceIds.length !== 2) return [];
    const crosswalkIds = /crosswalk/.test(route.match_strategy ?? '') ? [route.route_id] : [];
    return [{
      source_record_ids: sourceIds,
      status: routeStatus(route),
      crosswalk_ids: crosswalkIds,
      provenance_references: [{
        artifact_path: 'observatory/retrieval/v1.0.1/corpus/join-routes.jsonl',
        locator: `$[?(@.route_id==${JSON.stringify(route.route_id)})]`
      }]
    }];
  });
}

function restrictions(results) {
  return [...new Set(results.flatMap(item => [
    item.record.access?.restriction_note,
    ...(item.record.evidence ?? []).flatMap(evidence => evidence.limitations ?? [])
  ]).filter(Boolean))].slice(0, 100);
}

export function adaptCase(question, discoveryResult, benchmarkSourceIds) {
  const sourceIdByRecordId = new Map(discoveryResult.results.map(item => [item.record.record_id, sourceRecordId(item.record, benchmarkSourceIds)]));
  const seen = new Set();
  const results = discoveryResult.results.flatMap(item => {
    const sourceId = sourceIdByRecordId.get(item.record.record_id);
    if (seen.has(sourceId)) return [];
    seen.add(sourceId);
    return [{
      rank: seen.size,
      source_record_id: sourceId,
      recommendation_state: 'recommended',
      access_implications: resultAccess(item.record),
      provenance_references: resultProvenance(item.record)
    }];
  });
  const zero = results.length === 0;
  return {
    question_id: question.question_id,
    intent_compilation: compileObservedIntent(question.question_id, discoveryResult),
    result_bundle: {
      result_state: zero ? 'zero_results' : 'results',
      results,
      important_restrictions: restrictions(discoveryResult.results),
      join_routes: adaptRoutes(discoveryResult.join_routes, sourceIdByRecordId),
      zero_result: zero ? {
        reason_code: 'no_match_in_evaluated_result_set',
        scope: 'evaluated_result_set_only',
        corpus_absence_claimed: false,
        statement: ZERO_RESULT_STATEMENT
      } : null
    }
  };
}
