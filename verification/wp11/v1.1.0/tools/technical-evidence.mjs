import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listFiles } from '../../../successor-support.mjs';

export async function buildTechnicalEvidence({ repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..') } = {}) {
const REPO = path.resolve(repoRoot);
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
  assert(planView.includes('Product-owner approval of this historical WP9 coverage wording remains pending (AUTH-15); this reference is not approved current coverage wording.'), 'AUTH15_PENDING_LABEL_MISSING');

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
  assert(externalUrls.includes("packages/retrieval/tools/external-url-policy.mjs") && externalUrls.includes('return sharedSafeExternalHttpsUrl(value)'), 'SHARED_URL_POLICY_DELEGATION_MISSING');
  const externalUrlTests = await read('apps/web/src/lib/externalUrls.test.ts');
  for (const adversarialCase of ['%58-Amz-Signature', '%74%6f%6b%65%6e', '%2574%256f%256b%2565%256e', '2130706433', '0x7f000001', '127。0。0。1', '[::1]', 'https:/api/contract', 'MAX_EXTERNAL_URL_LENGTH']) {
    assert(externalUrlTests.includes(adversarialCase), `EXTERNAL_URL_ADVERSARIAL_CASE_MISSING_${adversarialCase}`);
  }
  const discoveryProvider = await read('apps/web/src/providers/discoveryProvider.ts');
  assert(discoveryProvider.includes('safeExternalHttpsUrl(step.url)'), 'RETRIEVAL_URL_CONTRACT_GUARD_MISSING');
  assert(discoveryProvider.includes('browserRecordErrors(item.record)'), 'PROVENANCE_LOCATOR_CONTRACT_GUARD_MISSING');
  const overlay = await read('apps/web/src/data/liveVerificationOverlay.ts');
  assert(overlay.includes('safeExternalHttpsUrl(record.authoritative_url)'), 'OVERLAY_AUTHORITATIVE_URL_GUARD_MISSING');
  assert(overlay.includes('record.additional_evidence_urls.some((url) => safeExternalHttpsUrl(url) === null)'), 'OVERLAY_EVIDENCE_URL_GUARD_MISSING');
  const detailsPage = await read('apps/web/src/pages/DatasetDetailsPage.tsx');
  assert(detailsPage.includes('href={source.locator}'), 'EVIDENCE_LOCATOR_SINK_MISSING');
  assert(detailsPage.includes('safeExternalHttpsUrl(step.url)'), 'DETAIL_NAVIGATION_GUARD_MISSING');
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
    'contracts/research-plan/v1.0.0/manifests/package-manifest.json': '377d4aa94ecea767495d6d0f18edd5aad4ee963574b2069e08040b05d3c3aa17',
    'packages/planner/planner-repository.mjs': '2a9ae257ebc32bfd8b61b86f474505ab3e357f2ffaac1bf5f2cadd82a567c617',
    'packages/planner/static-planner-repository.mjs': '03fca3f7cbafeeda762b1ef34bf899ac110c4983d30a3a1f3039e08e6245eae3',
    'packages/coverage/coverage-repository.mjs': '619598389eed36f01f06e0292ecd206ce9b0ee7379f9570e7ae71220b49088a6',
    'packages/coverage/static-coverage-repository.mjs': '6742ced209743f0f00f5db8a5b04f0cc4462a821e1f60442a94dc30f8e78ecf0',
    'evaluation/planner/v1.0.0/manifests/package-manifest.json': '1043366e6a74d97c1dc4f622ea31214db76e4e360d8af53905f5586fa9d629a3'
  };
  for (const [relative, expected] of Object.entries(frozenPins)) assert(await sha256File(relative) === expected, `FROZEN_PIN_DRIFT_${relative}`);
  return { view, frozenPins };
}

async function validateGovernance() {
  const register = await readJson('verification/external-authorization/v1.0.0/register.json');
  const auth12 = register.entries.find(entry => entry.id === 'AUTH-12');
  const auth15 = register.entries.find(entry => entry.id === 'AUTH-15');
  const auth16 = register.entries.find(entry => entry.id === 'AUTH-16');
  const auth17 = register.entries.find(entry => entry.id === 'AUTH-17');
  for (const authorization of [auth12, auth15, auth16, auth17]) {
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
  return { auth12, auth15, auth16, auth17, resultStudy, summaryReview };
}


assert(await sha256File('verification/wp11/v1.0.0/receipts/implementation-file-manifest.json') === 'd388972dca800318aa8ad31ddca2975c0eb3d2761fdb28e82aa7545cb76576aa', 'WP11_PREDECESSOR_MANIFEST_DRIFT');
assert(await sha256File('verification/wp11/v1.0.0/receipts/wp11-verification.json') === '0e75b70dc65c3b05a324d34cbe55bb90d6a7f5b7f90bc810a0770a3a44dabf60', 'WP11_PREDECESSOR_RECEIPT_DRIFT');
await validateSources();
const { view, frozenPins } = await validateCoverageAndContracts();
await validateGovernance();
const ledger = await readJson('verification/wp11/v1.0.0/evidence-ledger.json');
assert(new Set(ledger.entries.map(e=>e.requirement_id)).size===ledger.entries.length,'DUPLICATE_LEDGER_ID');
assert(ledger.entries.every(e=>e.implementation.length&&e.verification.length),'INCOMPLETE_LEDGER_ENTRY');
const policy = await import(pathToFileURL(path.join(REPO,'packages/retrieval/tools/external-url-policy.mjs')).href);
const contract = await import(pathToFileURL(path.join(REPO,'packages/retrieval/tools/catalog-contract.mjs')).href);
await verifyBehavior(policy, contract, JSON.parse((await read('packages/retrieval/corpus/records.jsonl')).trim().split(/\r?\n/)[0]));
const scope = JSON.parse(await fs.readFile(new URL('../scope-paths.json',import.meta.url),'utf8'));
const files=[];
for(const relative of [...new Set([...implementationPaths,...scope,
 'verification/successor-support.mjs', 'package.json', 'package-lock.json',
 ...await listFiles(REPO,'verification/wp11/v1.1.0'),
 ...await listFiles(REPO,'apps/web/src'), ...await listFiles(REPO,'packages/retrieval/tools'),
 ...await listFiles(REPO,'packages/retrieval/schemas')])].sort()){
 const bytes=await fs.readFile(path.join(REPO,relative));
 files.push({path:relative,bytes:bytes.length,sha256:digest('',bytes)});
}
return {status:'PASS',schema_version:'ushso-wp11-technical-evidence.v1.1.0',work_package:'WP11',
 technical_foundation_status:'pass',work_package_acceptance_status:'blocked_external_dependencies_and_human_studies',
 approval_status:'pending_authorized_review',approved:false,publication_authorized:false,deployment_authorized:false,
 planner_runtime_status:'disabled',coverage_copy_status:'historical_reference_owner_approval_pending',
 predecessor_manifest_sha256:await sha256File('verification/wp11/v1.0.0/receipts/implementation-file-manifest.json'),
 predecessor_receipt_sha256:await sha256File('verification/wp11/v1.0.0/receipts/wp11-verification.json'),
 files,file_set_sha256:digest('ushso:wp11-implementation-file-set:v1.1\n',files),
 frozen_pins:frozenPins,coverage_snapshot_id:view.coverage_snapshot_id,
 checks:['predecessor_source_invariants_adapted_for_shared_modules','shared_url_adversarial_behavior','malformed_record_peer_isolation','frozen_contract_pins','pending_governance','historical_coverage_parity'],
 evidence_limitations:['Technical checks are not reviewer approval, human studies, or complete release gate evidence.']};
}
export async function verifyBehavior(policy,contract,valid){
 if(policy.safeExternalHttpsUrl('https://example.com/data')!=='https://example.com/data')throw new Error('URL_POSITIVE_CONTROL_FAILED');
 for(const bad of ['https:/example.com/data','https:example.com/data','http://example.com','https://user:pass@example.com','https://127.0.0.1','https://localhost','https://example.com/?%74%6f%6b%65%6e=secret','https://example.com/?%2574%256f%256b%2565%256e=secret','https://example.com/?X-Amz-Signature=x','https://example.com/\\x',' https://example.com','https://example.com/'+ 'a'.repeat(2048)]){
  if(policy.safeExternalHttpsUrl(bad)!==null)throw new Error('UNSAFE_URL_ACCEPTED:'+bad);
 }
 if(contract.browserRecordErrors(valid).length)throw new Error('VALID_RECORD_CONTROL_FAILED');
 for(const key of ['provenance','evidence','retrieval.instructions']){
  const bad=structuredClone(valid);bad.record_id='malformed-fixture';if(key.includes('.'))bad.retrieval.instructions={};else bad[key]={};
  const result=contract.validateCatalogRecords([bad,valid]);
  if(result.valid.length!==1||result.invalid.length!==1||result.invalid[0].code!=='invalid_catalog_record')throw new Error('MALFORMED_PEER_NOT_ISOLATED:'+key);
 }
 const bad=structuredClone(valid);bad.provenance[0].locator='https://example.com/?token=secret';
 if(!contract.browserRecordErrors(bad).length)throw new Error('UNSAFE_PROVENANCE_ACCEPTED');
}
export async function validateCandidateEvidence(evidence,{repoRoot}={}){
 if(evidence.approved!==false||evidence.approval_status!=='pending_authorized_review')throw new Error('TECHNICAL_EVIDENCE_APPROVAL_OVERCLAIM');
 const current=await buildTechnicalEvidence({repoRoot});
 if(JSON.stringify(evidence)!==JSON.stringify(current))throw new Error('WP11_CANDIDATE_EVIDENCE_STALE');
 return {status:'technical_evidence_valid',approval_status:'pending_authorized_review'};
}
