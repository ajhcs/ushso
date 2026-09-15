import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAST_GOOD_GENERATION } from '../../packages/coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';
import { evaluateCoreReadiness, loadCohort, PRODUCT_DENOMINATOR, PUBLIC_SAMPLE_TARGET } from '../../packages/coverage/research-program/v1.0.0/src/core-readiness.mjs';
import { refuseSelfApproval } from './qualify-mrf.mjs';
import { ingestEvidence } from './ingest-evidence.mjs';

export const QUALIFY_CORE_FORMAT = 'ushso.core-scientific-completeness.v1';
export const HUMAN_RESEARCH_REVIEWER = 'named-human-research-reviewer';
export { LAST_GOOD_GENERATION, PRODUCT_DENOMINATOR, PUBLIC_SAMPLE_TARGET };

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

export function essentialOutcomes(product, { cellEvidence = {} } = {}) {
  const anchor = product.anchor ?? {};
  const catalog = anchor.status === 'resolved_catalog_record';
  const intake = anchor.status === 'named_intake';
  const restricted = ['restricted_or_manual_route', 'pending_source_intake', 'mixed_public_and_restricted'].includes(product.access_expectation);
  const cells = freeze({
    catalog_record: freeze({
      status: catalog ? 'resolved' : (intake ? 'named_intake' : 'unknown'),
      supported: catalog,
      unknown: !catalog && !intake,
    }),
    release_distinction: freeze({ status: product.product_release_distinction ? 'documented' : 'unknown', supported: Boolean(product.product_release_distinction), unknown: !product.product_release_distinction }),
    access_expectation: freeze({ status: product.access_expectation ?? 'unknown', supported: false, unknown: product.access_expectation == null, note: 'access_expectation_is_not_proof' }),
    publisher_access: evidenceCell(cellEvidence.publisher_access, 'unknown'),
    schema_qualification: evidenceCell(cellEvidence.schema_qualification, 'unknown'),
    join_route: evidenceCell(cellEvidence.join_route, 'unknown'),
    unit_grain_date_denominator: evidenceCell(cellEvidence.unit_grain_date_denominator, 'unknown'),
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

function evidenceCell(evidence, fallbackStatus) {
  if (!evidence) return freeze({ status: fallbackStatus, supported: false, unknown: true });
  if (evidence.unknown === true && evidence.supported === true) fail('UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED');
  return freeze({
    status: evidence.status ?? (evidence.supported ? 'evidenced' : fallbackStatus),
    supported: evidence.supported === true,
    unknown: evidence.unknown === true,
    receipt_id: evidence.receipt_id ?? null,
    recipe: evidence.recipe ?? null,
    limitation: evidence.limitation ?? null,
  });
}

export function payloadSampleCountsFromReceipts(receipts = [], products = []) {
  const samples = new Set();
  const verifiedRoutes = new Set();
  for (const receipt of receipts.filter((row) => row.kind === 'core_cell')) {
    const payload = receipt.payload ?? {};
    if (payload.field !== 'publisher_access') continue;
    if (payload.catalog_membership_as_sample === true) fail('CATALOG_MEMBERSHIP_IS_NOT_PAYLOAD_SAMPLE');
    if (payload.vintage_substitution === true) fail('VINTAGE_SUBSTITUTION_FORBIDDEN');
    if ((payload.fictional === true || payload.synthetic === true) && payload.bounded_sample === true) {
      fail('FICTIONAL_WALKTHROUGH_IS_NOT_LIVE_SAMPLE');
    }
    if (payload.family_workflow_as_verified_route === true) fail('FAMILY_WORKFLOW_IS_NOT_VERIFIED_ROUTE');
    const realSample = payload._derived_payload_sample === true
      && payload._derived_from_frozen_requirements === true
      && payload.live_http === true
      && payload.supported === true
      && payload.bounded_sample === true
      && payload.payload_success === true
      && payload.fictional !== true
      && payload.synthetic !== true
      && payload.catalog_membership_as_sample !== true
      && payload.vintage_substitution !== true
      && payload._release_check?.status === 'verified'
      && Number.isSafeInteger(payload._derived_row_count)
      && payload._derived_row_count > 0;
    const realRoute = payload.supported === true
      && payload.verified_route === true
      && typeof payload.route_evidence === 'string'
      && payload.family_workflow_as_verified_route !== true
      && payload.fictional !== true
      && payload._evidence_kind !== 'family_registry';
    if (realSample) samples.add(payload.product_key);
    if (realRoute) verifiedRoutes.add(payload.product_key);
  }
  const publicEligible = products.filter((product) => product.access_expectation === 'public_sample_eligible');
  const publicComplete = publicEligible.filter((product) => samples.has(product.product_key)).length;
  const restricted = products.filter((product) => ['restricted_or_manual_route', 'pending_source_intake', 'mixed_public_and_restricted'].includes(product.access_expectation));
  const restrictedComplete = restricted.filter((product) => verifiedRoutes.has(product.product_key)).length;
  return freeze({
    catalog_membership_is_not_payload_sample: true,
    public_sample_complete: publicComplete,
    public_sample_target: PUBLIC_SAMPLE_TARGET,
    public_sample_eligible: publicEligible.length,
    restricted_route_complete: restrictedComplete,
    r04_engineering_target_met: publicComplete >= PUBLIC_SAMPLE_TARGET,
    r05_restricted_routes_verified: restricted.length > 0 && restrictedComplete === restricted.length,
  });
}

export function coreCellEvidenceFromReceipts(receipts = []) {
  const byProduct = {};
  for (const receipt of receipts.filter((row) => row.kind === 'core_cell')) {
    const productKey = receipt.payload.product_key;
    if (!byProduct[productKey]) byProduct[productKey] = {};
    byProduct[productKey][receipt.payload.field] = freeze({
      supported: receipt.payload.supported === true,
      unknown: receipt.payload.unknown === true,
      status: receipt.payload.status ?? (receipt.payload.supported ? 'evidenced' : 'unknown'),
      receipt_id: receipt.receipt_id,
      recipe: receipt.payload.recipe,
      limitation: receipt.payload.limitation ?? null,
    });
  }
  return freeze(byProduct);
}

export function assembleCoreMatrix(cohorts, { cellEvidenceByProduct = {} } = {}) {
  const products = cohorts?.products ?? [];
  if (products.length !== PRODUCT_DENOMINATOR) fail('PRODUCT_DENOMINATOR_NOT_100', String(products.length));
  const rows = products.map((product) => essentialOutcomes(product, { cellEvidence: cellEvidenceByProduct[product.product_key] ?? {} }));
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
  const sealedReadiness = evaluateCoreReadiness(cohorts, options.readinessExtras ?? {});
  const ingestion = options.ingestion ?? ingestEvidence();
  const receipts = ingestion.receipts ?? [];
  const cellEvidenceByProduct = options.cellEvidenceByProduct ?? coreCellEvidenceFromReceipts(receipts);
  const matrix = assembleCoreMatrix(cohorts, { cellEvidenceByProduct });
  const review = independentSemanticReview(matrix, options);
  const payloadCounts = payloadSampleCountsFromReceipts(receipts, cohorts.products ?? []);
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
      r04_engineering_target_met: payloadCounts.r04_engineering_target_met,
      r05_restricted_routes_verified: payloadCounts.r05_restricted_routes_verified,
      public_sample_complete: payloadCounts.public_sample_complete,
      public_sample_target: payloadCounts.public_sample_target,
      catalog_membership_is_not_payload_sample: true,
      sealed_catalog_membership_count: sealedReadiness.public_sample_complete,
      incomplete: sealedReadiness.incomplete,
    }),
    remaining_limits: freeze([
      'Unknown essential fields and unnamed intake records cannot count as supported.',
      'Catalog-metadata receipts are not bounded payload samples. Dataset contents were not executed.',
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
