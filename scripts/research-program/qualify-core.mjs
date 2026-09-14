import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAST_GOOD_GENERATION } from '../../packages/coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';
import { evaluateCoreReadiness, loadCohort, PRODUCT_DENOMINATOR } from '../../packages/coverage/research-program/v1.0.0/src/core-readiness.mjs';
import { refuseSelfApproval } from './qualify-mrf.mjs';

export const QUALIFY_CORE_FORMAT = 'ushso.core-scientific-completeness.v1';
export const HUMAN_RESEARCH_REVIEWER = 'named-human-research-reviewer';
export { LAST_GOOD_GENERATION, PRODUCT_DENOMINATOR };

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function defaultCohortPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../evaluation/research-program/cohorts.json');
}

export function refuseUnknownCellAsSupported(cell) {
  if ((cell?.status === 'unknown' || cell?.supported == null) && cell?.supported === true) {
    fail('UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED');
  }
  if (cell?.unknown === true && cell?.supported === true) fail('UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED');
  return freeze({ supported: false, unknown: cell?.unknown === true || cell?.status === 'unknown' });
}

export function essentialOutcomes(product) {
  const anchor = product.anchor ?? {};
  const catalog = anchor.status === 'resolved_catalog_record';
  const intake = anchor.status === 'named_intake';
  const restricted = ['restricted_or_manual_route', 'pending_source_intake', 'mixed_public_and_restricted'].includes(product.access_expectation);
  const cells = freeze({
    catalog_record: freeze({ status: catalog ? 'resolved' : (intake ? 'named_intake' : 'unknown'), supported: catalog, unknown: !catalog }),
    release_distinction: freeze({ status: product.product_release_distinction ? 'documented' : 'unknown', supported: Boolean(product.product_release_distinction), unknown: !product.product_release_distinction }),
    access_expectation: freeze({ status: product.access_expectation ?? 'unknown', supported: false, unknown: product.access_expectation == null, note: 'access_expectation_is_not_proof' }),
    publisher_access: freeze({ status: 'unknown', supported: false, unknown: true }),
    schema_qualification: freeze({ status: 'unknown', supported: false, unknown: true }),
    join_route: freeze({ status: 'unknown', supported: false, unknown: true }),
    unit_grain_date_denominator: freeze({ status: 'unknown', supported: false, unknown: true }),
  });
  for (const cell of Object.values(cells)) {
    if (cell.unknown && cell.supported) fail('UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED');
  }
  const unsupported = Object.entries(cells).filter(([, cell]) => cell.supported !== true).map(([field, cell]) => freeze({ field, ...cell }));
  return freeze({
    product_key: product.product_key,
    title: product.title,
    domain: product.domain,
    publisher: product.publisher ?? null,
    access_expectation: product.access_expectation,
    restricted_or_manual: restricted,
    source_context: freeze({
      anchor_status: anchor.status ?? 'unknown',
      record_id: anchor.representative?.record_id ?? null,
      authoritative_url: anchor.representative?.authoritative_url ?? anchor.intake?.official_discovery_url ?? null,
      access_expectation_is_not_proof: anchor.access_expectation_is_not_proof !== false,
    }),
    cells,
    unsupported_claims: freeze(unsupported),
    conflicts: freeze([...(product.conflicts ?? [])]),
    example_ids: freeze([]),
    citations: freeze([anchor.representative?.authoritative_url ?? anchor.intake?.official_discovery_url].filter(Boolean)),
    follow_up: unsupported.length
      ? freeze({ id: `follow-up:${product.product_key}`, kind: 'bounded_core_remediation', replacement_allowed: false })
      : null,
  });
}

export function assembleCoreMatrix(cohorts) {
  const products = cohorts?.products ?? [];
  if (products.length !== PRODUCT_DENOMINATOR) fail('PRODUCT_DENOMINATOR_NOT_100', String(products.length));
  const rows = products.map(essentialOutcomes);
  const byDomain = {};
  for (const row of rows) {
    const domain = row.domain ?? 'unknown';
    if (!byDomain[domain]) byDomain[domain] = { domain, product_count: 0, unsupported_count: 0, unknown_cells: 0, supported_cells: 0 };
    byDomain[domain].product_count += 1;
    byDomain[domain].unsupported_count += row.unsupported_claims.length;
    for (const cell of Object.values(row.cells)) {
      if (cell.unknown) byDomain[domain].unknown_cells += 1;
      if (cell.supported) byDomain[domain].supported_cells += 1;
    }
  }
  return freeze({
    format: QUALIFY_CORE_FORMAT,
    generation: LAST_GOOD_GENERATION,
    product_count: rows.length,
    rows: freeze(rows),
    domain_totals: freeze(Object.values(byDomain).map((row) => freeze(row))),
    unknown_cells_counted_as_supported: false,
    last_good_generation_changed: false,
  });
}

export function independentSemanticReview(matrix, { actor = 'implementer', role = 'implementer', approved = false, namedHuman = HUMAN_RESEARCH_REVIEWER } = {}) {
  refuseSelfApproval({ actor, role, approved });
  const failed = matrix.rows.filter((row) => row.unsupported_claims.length > 0);
  const unresolvedJudgments = failed.map((row) => freeze({
    product_key: row.product_key,
    domain: row.domain,
    routed_to: namedHuman,
    accepted_values: freeze([]),
    status: 'unresolved_pending_named_human',
    follow_up: row.follow_up,
  }));
  return freeze({
    format: QUALIFY_CORE_FORMAT,
    reviewer: 'Astra/root',
    implementer_self_approved: false,
    scientific_output_approved: false,
    named_human_research_reviewer: namedHuman,
    failed_visible: failed.length,
    unresolved_domain_judgments: freeze(unresolvedJudgments),
    bounded_follow_up_prs: freeze(failed.map((row) => row.follow_up)),
    exact_accepted_values: freeze([]),
  });
}

export function issueCoreQualificationReceipt(cohorts = loadCohort(defaultCohortPath()), options = {}) {
  const readiness = evaluateCoreReadiness(cohorts);
  const matrix = assembleCoreMatrix(cohorts);
  const review = independentSemanticReview(matrix, options);
  const r04 = false;
  const r05 = false;
  const r07 = false;
  const r08 = false;
  const passed = r04 && r05 && r07 && r08;
  if (passed !== true && options.forcePass === true) fail('FAILED_MATRIX_CANNOT_BE_FORCED_PASS');
  return freeze({
    format: QUALIFY_CORE_FORMAT,
    generation: LAST_GOOD_GENERATION,
    recorded_at: options.recordedAt ?? new Date().toISOString(),
    reviewer_scope: freeze({
      independent_reviewer: 'Astra/root',
      named_human_research_reviewer: HUMAN_RESEARCH_REVIEWER,
      implementer_cannot_self_approve: true,
    }),
    product_count: matrix.product_count,
    unknown_cells_counted_as_supported: false,
    r04_accepted: r04,
    r05_accepted: r05,
    r07_accepted: r07,
    r08_accepted: r08,
    scientific_completeness_pass: false,
    failed_matrix_retained: true,
    engineering_readiness: freeze({
      r04_engineering_target_met: readiness.r04_engineering_target_met === true,
      r05_restricted_routes_verified: readiness.r05_restricted_routes_verified === true,
      public_sample_complete: readiness.public_sample_complete,
      incomplete: readiness.incomplete,
    }),
    remaining_limits: freeze([
      'Unknown essential fields and unnamed intake records cannot count as supported.',
      'R07 remains incomplete until failing retrieval domains have bounded remediation.',
      'R08 remains incomplete below 15 independently qualified routes.',
      'Restricted/manual products remain incomplete until verified routes exist.',
      'C0091 measured topology remains unresolved.',
    ]),
    matrix,
    review,
    last_good_generation_changed: false,
  });
}

export { refuseSelfApproval, loadCohort, evaluateCoreReadiness };
