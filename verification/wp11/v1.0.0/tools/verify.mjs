import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '../../..');

const implementationPaths = [
  'apps/web/src/App.tsx',
  'apps/web/src/components/CanonicalPlanView.tsx',
  'apps/web/src/components/CoveragePositioning.tsx',
  'apps/web/src/components/PlanJsonExport.tsx',
  'apps/web/src/components/ResearcherDecisionSummary.tsx',
  'apps/web/src/components/ResultCard.test.ts',
  'apps/web/src/components/ResultCard.tsx',
  'apps/web/src/data/coveragePositioning.test.ts',
  'apps/web/src/data/coveragePositioning.ts',
  'apps/web/src/data/liveVerificationOverlay.test.ts',
  'apps/web/src/data/liveVerificationOverlay.ts',
  'apps/web/src/lib/catalogAdapter.ts',
  'apps/web/src/lib/externalUrls.test.ts',
  'apps/web/src/lib/externalUrls.ts',
  'apps/web/src/lib/planExport.test.ts',
  'apps/web/src/lib/planExport.ts',
  'apps/web/src/lib/researchPlanContract.ts',
  'apps/web/src/lib/researcherGuidance.test.tsx',
  'apps/web/src/lib/researcherGuidance.ts',
  'apps/web/src/pages/DatasetDetailsPage.tsx',
  'apps/web/src/pages/PlanPage.test.tsx',
  'apps/web/src/pages/PlanPage.tsx',
  'apps/web/src/pages/SourcesPage.tsx',
  'apps/web/src/pages/modeSeparation.test.ts',
  'apps/web/src/providers/discoveryProvider.test.ts',
  'apps/web/src/providers/discoveryProvider.ts',
  'apps/web/src/providers/planApiAdapter.test.ts',
  'apps/web/src/providers/planApiAdapter.ts',
  'apps/web/src/styles.css',
  'apps/web/src/types/researchPlan.ts',
  'apps/web/tsconfig.app.json',
  'docs/WP11_PUBLIC_UI_FOUNDATION.md',
  'verification/wp11/v1.0.0/README.md',
  'verification/wp11/v1.0.0/evidence-ledger.json',
  'verification/wp11/v1.0.0/governance/decision-summary-review.json',
  'verification/wp11/v1.0.0/governance/result-card-researcher-study.json',
  'verification/wp11/v1.0.0/package.json',
  'verification/wp11/v1.0.0/tests/wp11-verification.test.mjs',
  'verification/wp11/v1.0.0/tools/verify.mjs'
];

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function digest(prefix, value) {
  return crypto.createHash('sha256').update(prefix).update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
}

async function read(relative) {
  return fs.readFile(path.join(REPO, relative), 'utf8');
}

async function readJson(relative) {
  return JSON.parse(await read(relative));
}

async function sha256File(relative) {
  return digest('', await fs.readFile(path.join(REPO, relative)));
}

async function exists(relative) {
  try {
    await fs.access(path.join(REPO, relative));
    return true;
  } catch {
    return false;
  }
}

async function validateSources() {
  const resultCard = await read('apps/web/src/components/ResultCard.tsx');
  const regions = [...resultCard.matchAll(/data-result-region="([^"]+)"/g)].map(match => match[1]);
  assert(canonical(regions) === canonical(['title', 'description', 'why-match', 'geo-grain-time', 'access-evidence', 'details-action']), 'RESULT_CARD_SIX_REGION_DRIFT');
  assert(resultCard.includes('Scoped metadata route checked'), 'VERIFICATION_TARGET_MISSING');
  assert(!resultCard.includes("'Live verified'"), 'GENERIC_VERIFIED_LABEL_PRESENT');

  const contract = await read('apps/web/src/lib/researchPlanContract.ts');
  let position = -1;
  for (const section of ['lead-answer', 'source-roles', 'coverage-gaps', 'operation-map', 'acquisition-instructions', 'downstream-support', 'limitations-and-pins', 'json-export']) {
    const next = contract.indexOf(`'${section}'`);
    assert(next > position, `PLAN_SECTION_ORDER_${section}`);
    position = next;
  }
  assert(contract.includes("'/api/contracts/research-plan/v1.0.0'"), 'PLAN_CONTRACT_ENDPOINT_DRIFT');
  assert(contract.includes("'/api/plan'"), 'PLAN_ENDPOINT_DRIFT');

  const planView = await read('apps/web/src/components/CanonicalPlanView.tsx');
  for (const field of ['operation_kind', 'evidence_state', 'compatibility', 'requirements', 'blockers']) {
    assert(planView.includes(`data-operation-field="${field}"`), `OPERATION_FIELD_${field}_MISSING`);
  }
  assert(planView.includes('You need these sources.'), 'PLAN_LEAD_DRIFT');
  assert(planView.includes('Product-owner approval for this public wording remains pending.'), 'AUTH15_PENDING_LABEL_MISSING');

  const planPage = await read('apps/web/src/pages/PlanPage.tsx');
  assert(!/<form|<input|<textarea/.test(planPage), 'PLAN_PAGE_COLLECTS_QUESTION');
  assert(planPage.includes('data-plan-api-enabled={BLOCKED_PLAN_FEATURE_GATE.apiPlanEnabled}'), 'PLAN_BLOCKED_STATE_MISSING');
  const app = await read('apps/web/src/App.tsx');
  assert(app.includes('<Route path="/plan" element={<PlanPage />} />'), 'PLAN_ROUTE_MISSING');

  const adapter = await read('apps/web/src/providers/planApiAdapter.ts');
  for (const pin of ['apiPlanEnabled: false', 'contractEndpointEnabled: false', 'compilerRuntimeAuthorized: false', "authorizationRequirementId: 'AUTH-12'"]) {
    assert(adapter.includes(pin), `PLAN_GATE_DRIFT_${pin}`);
  }
  assert(!adapter.includes('transport('), 'BLOCKED_ADAPTER_TRANSPORT_REACHABLE');
  assert(!adapter.includes('JSON.stringify(request'), 'BLOCKED_ADAPTER_SERIALIZES_REQUEST');

  for (const relative of [
    'apps/web/src/pages/SearchResultsPage.tsx',
    'apps/web/src/pages/LandingPage.tsx',
    'apps/web/src/providers/DiscoveryProviderContext.tsx',
    'apps/web/src/providers/discoveryProvider.ts'
  ]) {
    const source = await read(relative);
    assert(!/\/api\/plan|requestPlan|planResearch|plan_research|planApiAdapter/.test(source), `DISCOVERY_PLANNER_LEAK_${relative}`);
  }

  const productionWp11 = [
    'apps/web/src/components/CanonicalPlanView.tsx',
    'apps/web/src/components/PlanJsonExport.tsx',
    'apps/web/src/components/ResearcherDecisionSummary.tsx',
    'apps/web/src/lib/planExport.ts',
    'apps/web/src/lib/researchPlanContract.ts',
    'apps/web/src/lib/researcherGuidance.ts',
    'apps/web/src/pages/PlanPage.tsx',
    'apps/web/src/providers/planApiAdapter.ts'
  ];
  for (const relative of productionWp11) {
    const source = await read(relative);
    assert(!/valid-plans\.json|localStorage|sessionStorage|indexedDB|sendBeacon/.test(source), `RUNTIME_FIXTURE_OR_PERSISTENCE_${relative}`);
  }

  const exportSource = await read('apps/web/src/lib/planExport.ts');
  assert(exportSource.includes('256 * 1024'), 'JSON_EXPORT_BOUND_MISSING');
  assert(exportSource.includes('assertCanonicalResearchPlanSurface(plan)'), 'JSON_EXPORT_CONTRACT_GUARD_MISSING');

  const css = await read('apps/web/src/styles.css');
  assert(/@media \(max-width: 820px\)[\s\S]*\.plan-coverage-grid[\s\S]*grid-template-columns: 1fr/.test(css), 'TABLET_PLAN_COLLAPSE_MISSING');
  assert(/@media \(max-width: 560px\)[\s\S]*\.plan-export__actions/.test(css), 'PHONE_EXPORT_COLLAPSE_MISSING');

  const publicRuntime = await read('worker/index.mjs');
  assert(!publicRuntime.includes("url.pathname === '/api/plan'"), 'PLAN_SERVER_ROUTE_ACTIVATED');
  assert(!publicRuntime.includes("url.pathname === '/api/contracts/research-plan/v1.0.0'"), 'PLAN_CONTRACT_ROUTE_ACTIVATED');

  const externalUrls = await read('apps/web/src/lib/externalUrls.ts');
  for (const boundary of ["parsed.protocol !== 'https:'", 'parsed.username', 'parsed.password', 'ASCII_CONTROL', 'ABSOLUTE_HTTPS_PREFIX', 'MAX_EXTERNAL_URL_LENGTH', 'SIGNED_QUERY_NAME', 'NON_PUBLIC_HOST_SUFFIX', 'isPublicHostname', 'isSignedQueryName', 'return canonical.length']) {
    assert(externalUrls.includes(boundary), `EXTERNAL_URL_BOUNDARY_MISSING_${boundary}`);
  }
  const externalUrlTests = await read('apps/web/src/lib/externalUrls.test.ts');
  for (const adversarialCase of ['%58-Amz-Signature', '%74%6f%6b%65%6e', '%2574%256f%256b%2565%256e', '2130706433', '0x7f000001', '127。0。0。1', '[::1]', 'https:/api/contract', 'MAX_EXTERNAL_URL_LENGTH']) {
    assert(externalUrlTests.includes(adversarialCase), `EXTERNAL_URL_ADVERSARIAL_CASE_MISSING_${adversarialCase}`);
  }
  const discoveryProvider = await read('apps/web/src/providers/discoveryProvider.ts');
  assert(discoveryProvider.includes('safeExternalHttpsUrl(step.url)'), 'RETRIEVAL_URL_CONTRACT_GUARD_MISSING');
  assert(discoveryProvider.includes('isSafeEvidenceLocator(source.locator)'), 'PROVENANCE_LOCATOR_CONTRACT_GUARD_MISSING');
  const overlay = await read('apps/web/src/data/liveVerificationOverlay.ts');
  assert(overlay.includes('safeExternalHttpsUrl(record.authoritative_url)'), 'OVERLAY_AUTHORITATIVE_URL_GUARD_MISSING');
  assert(overlay.includes('record.additional_evidence_urls.some((url) => safeExternalHttpsUrl(url) === null)'), 'OVERLAY_EVIDENCE_URL_GUARD_MISSING');
  const detailsPage = await read('apps/web/src/pages/DatasetDetailsPage.tsx');
  assert(detailsPage.includes('href={canonicalLocator}'), 'EVIDENCE_SINK_DOES_NOT_USE_CANONICAL_URL');
  assert(detailsPage.includes('href={codebookUrl}'), 'CODEBOOK_SINK_DOES_NOT_USE_CANONICAL_URL');
}

async function validateCoverageAndContracts() {
  const view = await readJson('packages/coverage/accounting/v1.0.0/artifacts/public-coverage-view.json');
  const projection = await read('apps/web/src/data/coveragePositioning.ts');
  for (const value of [
    view.coverage_snapshot_id,
    view.coverage_snapshot_digest,
    view.matrix_summary.membership_manifest_hash,
    view.as_of,
    view.positioning.headline,
    view.positioning.federal_backbone,
    view.positioning.jurisdiction_boundary,
    view.positioning.corpus_boundary,
    view.positioning.zero_result_boundary,
    view.positioning.non_additivity,
    view.positioning.product_owner_review_status
  ]) assert(projection.includes(value), `COVERAGE_PROJECTION_DRIFT_${value}`);
  assert(view.positioning.publication_authorized === false, 'WP9_COPY_UNEXPECTEDLY_AUTHORIZED');
  assert(projection.includes("authorizationRequirementId: 'AUTH-15'"), 'AUTH15_REFERENCE_MISSING');

  const fixtures = await readJson('contracts/research-plan/v1.0.0/fixtures/valid-plans.json');
  assert(canonical([...new Set(fixtures.plans.map(plan => plan.plan_status))].sort()) === canonical(['clarification_required', 'incomplete', 'ready', 'ready_with_constraints', 'unsupported']), 'PLAN_STATUS_FIXTURE_COVERAGE_DRIFT');
  for (const plan of fixtures.plans) {
    assert(plan.contract_version === 'observatory-research-plan.v1.0.0', 'PLAN_FIXTURE_CONTRACT_DRIFT');
    for (const value of Object.values(plan.truth_boundary)) assert(value === false, 'PLAN_FIXTURE_ACTION_BOUNDARY_DRIFT');
    for (const operation of plan.operations) {
      assert(operation.executed === false, 'PLAN_FIXTURE_OPERATION_EXECUTED');
      assert(Array.isArray(operation.requirements) && Array.isArray(operation.blockers), 'PLAN_FIXTURE_OPERATION_ORTHOGONALITY_DRIFT');
    }
  }

  const frozenPins = {
    'contracts/research-plan/v1.0.0/manifests/package-manifest.json': '426bae96a6194fb1ea75c1c297bc76f44d40a32cd8bc9914f56886cb83193595',
    'packages/planner/planner-repository.mjs': '2a9ae257ebc32bfd8b61b86f474505ab3e357f2ffaac1bf5f2cadd82a567c617',
    'packages/planner/static-planner-repository.mjs': '03fca3f7cbafeeda762b1ef34bf899ac110c4983d30a3a1f3039e08e6245eae3',
    'packages/coverage/coverage-repository.mjs': '619598389eed36f01f06e0292ecd206ce9b0ee7379f9570e7ae71220b49088a6',
    'packages/coverage/static-coverage-repository.mjs': '6742ced209743f0f00f5db8a5b04f0cc4462a821e1f60442a94dc30f8e78ecf0',
    'evaluation/planner/v1.0.0/manifests/package-manifest.json': '061ea1d0850791fd999f8d91b46dcd2c226fba32e0bd73947ffbfacb14ada2d0'
  };
  for (const [relative, expected] of Object.entries(frozenPins)) assert(await sha256File(relative) === expected, `FROZEN_PIN_DRIFT_${relative}`);
  return { view, frozenPins };
}

async function validateGovernance() {
  const register = await readJson('verification/external-authorization/v1.0.0/register.json');
  const auth12 = register.entries.find(entry => entry.id === 'AUTH-12');
  const auth15 = register.entries.find(entry => entry.id === 'AUTH-15');
  for (const authorization of [auth12, auth15]) {
    assert(authorization && authorization.status === 'not_requested' && authorization.authorized === false, `${authorization?.id ?? 'AUTH'}_UNEXPECTEDLY_AUTHORIZED`);
  }
  const resultStudy = await readJson('verification/wp11/v1.0.0/governance/result-card-researcher-study.json');
  const summaryReview = await readJson('verification/wp11/v1.0.0/governance/decision-summary-review.json');
  assert(resultStudy.status === 'pending_external_researcher_study' && resultStudy.publication_authorized === false, 'RESULT_STUDY_OVERCLAIM');
  assert(resultStudy.participant_floor === 5 && resultStudy.time_limit_seconds === 30 && resultStudy.acceptance.intended_source_selection_rate_minimum === 0.8 && resultStudy.acceptance.analytics_result_misinterpretations_allowed === 0, 'RESULT_STUDY_TARGET_DRIFT');
  assert(summaryReview.status === 'pending_external_reviewer_study' && summaryReview.publication_authorized === false, 'SUMMARY_REVIEW_OVERCLAIM');
  assert(summaryReview.asset_floor === 12 && summaryReview.reviewer_floor === 2 && summaryReview.acceptance.critical_field_accuracy === 1, 'SUMMARY_REVIEW_TARGET_DRIFT');
  assert(!await exists('verification/wp11/v1.0.0/governance/result-card-researcher-study.receipt.json'), 'UNEXPECTED_RESULT_STUDY_RECEIPT');
  assert(!await exists('verification/wp11/v1.0.0/governance/decision-summary-review.receipt.json'), 'UNEXPECTED_SUMMARY_REVIEW_RECEIPT');
  return { auth12, auth15, resultStudy, summaryReview };
}

async function main() {
  for (const flag of ['--web-tests-passed', '--web-typecheck-passed', '--web-build-passed']) assert(process.argv.includes(flag), `ATTESTATION_REQUIRED_${flag}`);
  await validateSources();
  const { view, frozenPins } = await validateCoverageAndContracts();
  const { auth12, auth15 } = await validateGovernance();
  const ledger = await readJson('verification/wp11/v1.0.0/evidence-ledger.json');
  assert(new Set(ledger.entries.map(entry => entry.requirement_id)).size === ledger.entries.length, 'DUPLICATE_LEDGER_ID');
  assert(ledger.entries.every(entry => entry.implementation.length > 0 && entry.verification.length > 0), 'INCOMPLETE_LEDGER_ENTRY');

  const files = [];
  for (const relative of [...implementationPaths].sort()) {
    const bytes = await fs.readFile(path.join(REPO, relative));
    files.push({ path: relative, bytes: bytes.byteLength, sha256: digest('', bytes) });
  }
  const implementationManifest = {
    schema_version: 'ushso-wp11-implementation-file-manifest.v1.0.0',
    generated_at: '2026-08-30T00:00:00Z',
    files,
    file_set_sha256: digest('ushso:wp11-implementation-file-set:v1\n', files)
  };
  await fs.mkdir(path.join(ROOT, 'receipts'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'receipts/implementation-file-manifest.json'), `${JSON.stringify(implementationManifest, null, 2)}\n`);

  const pending = ledger.entries.filter(entry => /pending|blocked/.test(entry.status));
  const receipt = {
    schema_version: 'ushso-wp11-verification-receipt.v1.0.0',
    work_package: 'WP11',
    generated_at: '2026-08-30T00:00:00Z',
    technical_foundation_status: 'pass',
    work_package_acceptance_status: 'blocked_external_dependencies_and_human_studies',
    planner_runtime_status: 'disabled',
    plan_api_route_status: 'not_implemented_dependency_blocked',
    plan_contract_endpoint_status: 'not_implemented_dependency_blocked',
    coverage_copy_status: 'implemented_preview_owner_approval_pending',
    network_access: false,
    production_actions: false,
    database_actions: false,
    source_requests_made: false,
    raw_user_queries_persisted: false,
    payloads_acquired: false,
    analysis_executed: false,
    browser_plugin_available: false,
    browser_plugin_validation_claimed: false,
    implemented_capabilities: [
      'six-region ResultCard with target-specific verification and bounded match rationale',
      'evidence-backed Use Card, Access Plan, incomplete technical Retrieval Recipe, and machine-readiness presentation',
      'WP9-pinned coverage preview with snapshot, as-of, exact units, non-additivity, and pending-owner wording state',
      'all-state canonical research-plan renderer in the required eight-section order',
      'orthogonal operation evidence and bounded canonical JSON export',
      'disabled no-egress /api/plan and contract endpoint adapter seams',
      'canonical public-HTTPS browser navigation boundary excluding credentials, signed queries, local/private destinations, and ambiguous URL syntax'
    ],
    deterministic_seals: {
      implementation_file_set_sha256: implementationManifest.file_set_sha256,
      research_plan_manifest_byte_sha256: frozenPins['contracts/research-plan/v1.0.0/manifests/package-manifest.json'],
      planner_repository_sha256: frozenPins['packages/planner/planner-repository.mjs'],
      static_planner_repository_sha256: frozenPins['packages/planner/static-planner-repository.mjs'],
      planner_benchmark_package_manifest_sha256: frozenPins['evaluation/planner/v1.0.0/manifests/package-manifest.json'],
      wp9_public_view_file_sha256: await sha256File('packages/coverage/accounting/v1.0.0/artifacts/public-coverage-view.json'),
      wp9_coverage_snapshot_sha256: view.coverage_snapshot_digest,
      wp9_matrix_membership_sha256: view.matrix_summary.membership_manifest_hash
    },
    test_receipts: [
      { command: 'npm test --prefix apps/web', status: 'pass', scope: 'component, contract, route, SSR accessibility, responsive CSS, no-egress, mode-separation, export, and coverage parity tests' },
      { command: 'npm run typecheck --prefix apps/web', status: 'pass', scope: 'strict browser and test TypeScript' },
      { command: 'npm run build --prefix apps/web', status: 'pass', scope: 'production Vite build and existing generated example compatibility' },
      { command: 'npm test --prefix verification/wp11/v1.0.0', status: 'pass_after_receipt', scope: 'deterministic seals, frozen boundaries, pending governance, and source invariants' }
    ],
    requirement_ledger: {
      path: 'verification/wp11/v1.0.0/evidence-ledger.json',
      entry_count: ledger.entries.length,
      pending_entries: pending.map(entry => ({ requirement_id: entry.requirement_id, status: entry.status }))
    },
    external_gates: [
      { authorization_id: 'AUTH-12', status: auth12.status, authorized: auth12.authorized, blocks: ['WP10B compiler implementation', '/api/plan activation', 'research-plan contract endpoint activation', 'live compiled-plan UI injection'] },
      { authorization_id: 'AUTH-15', status: auth15.status, authorized: auth15.authorized, blocks: ['approved/public WP9 coverage wording claim'] },
      { gate_id: 'WP11-RESULT-CARD-RESEARCHER-STUDY-01', status: 'pending_external_researcher_study', blocks: ['beta ResultCard comprehension claim'] },
      { gate_id: 'WP11-DECISION-SUMMARY-REVIEW-01', status: 'pending_external_reviewer_study', blocks: ['beta decision-summary critical-field claim'] }
    ],
    compatibility: {
      existing_v1_routes_changed_by_wp11: false,
      discover_plan_mode_added: false,
      browse_invokes_plan_generation: false,
      public_plan_server_route_activated: false,
      canonical_contract_version: 'observatory-research-plan.v1.0.0'
    },
    rollback: {
      current_state: 'No production, server-route, database, source, payload, or planner-runtime activation occurred.',
      ui_rollback: 'Remove the /plan route and WP11 presentation imports; restore the prior ResultCard, details, sources, and WP11 stylesheet additions.',
      future_activation_rollback: 'Disable the plan feature gate before changing routes or artifacts; retain canonical plans and receipts for audit.',
      immutable_inputs: 'Do not delete or rewrite frozen research-plan, WP9 coverage, WP10A benchmark, or WP1 repository artifacts.'
    },
    receipt_digest_algorithm: 'ushso_wp11_receipt_sha256/v1',
    receipt_sha256: ''
  };
  const payload = structuredClone(receipt);
  delete payload.receipt_sha256;
  receipt.receipt_sha256 = digest('ushso:wp11-verification-receipt:v1\n', payload);
  await fs.writeFile(path.join(ROOT, 'receipts/wp11-verification.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: receipt.technical_foundation_status, work_package_acceptance_status: receipt.work_package_acceptance_status, receipt_sha256: receipt.receipt_sha256, implementation_file_set_sha256: implementationManifest.file_set_sha256 })}\n`);
}

await main();
