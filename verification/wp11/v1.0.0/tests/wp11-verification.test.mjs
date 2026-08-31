import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '../../..');

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function digest(prefix, value) {
  return crypto.createHash('sha256').update(prefix).update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
}

async function read(relative) {
  return JSON.parse(await fs.readFile(path.join(ROOT, relative), 'utf8'));
}

test('WP11 receipt is canonical, technically passing, and honestly blocked', async () => {
  const receipt = await read('receipts/wp11-verification.json');
  const payload = structuredClone(receipt);
  delete payload.receipt_sha256;
  assert.equal(receipt.receipt_sha256, digest('ushso:wp11-verification-receipt:v1\n', payload));
  assert.equal(receipt.technical_foundation_status, 'pass');
  assert.equal(receipt.work_package_acceptance_status, 'blocked_external_dependencies_and_human_studies');
  assert.equal(receipt.planner_runtime_status, 'disabled');
  assert.equal(receipt.plan_api_route_status, 'not_implemented_dependency_blocked');
  assert.equal(receipt.coverage_copy_status, 'implemented_preview_owner_approval_pending');
  for (const field of ['network_access', 'production_actions', 'database_actions', 'source_requests_made', 'raw_user_queries_persisted', 'payloads_acquired', 'analysis_executed', 'browser_plugin_validation_claimed']) assert.equal(receipt[field], false, field);
});

test('implementation manifest seals every scoped file and its canonical set', async () => {
  const manifest = await read('receipts/implementation-file-manifest.json');
  assert.equal(manifest.file_set_sha256, digest('ushso:wp11-implementation-file-set:v1\n', manifest.files));
  for (const entry of manifest.files) {
    const bytes = await fs.readFile(path.join(REPO, entry.path));
    assert.equal(bytes.byteLength, entry.bytes, entry.path);
    assert.equal(digest('', bytes), entry.sha256, entry.path);
  }
  for (const suffix of ['CanonicalPlanView.tsx', 'ResearcherDecisionSummary.tsx', 'externalUrls.test.ts', 'externalUrls.ts', 'coveragePositioning.ts', 'planApiAdapter.ts', 'WP11_PUBLIC_UI_FOUNDATION.md']) assert.ok(manifest.files.some(entry => entry.path.endsWith(suffix)), suffix);
});

test('all plan statuses and immutable no-action boundaries remain covered by frozen fixtures', async () => {
  const fixtures = JSON.parse(await fs.readFile(path.join(REPO, 'contracts/research-plan/v1.0.0/fixtures/valid-plans.json'), 'utf8'));
  assert.deepEqual([...new Set(fixtures.plans.map(plan => plan.plan_status))].sort(), ['clarification_required', 'incomplete', 'ready', 'ready_with_constraints', 'unsupported']);
  for (const plan of fixtures.plans) {
    assert.equal(plan.contract_version, 'observatory-research-plan.v1.0.0');
    assert.ok(Object.values(plan.truth_boundary).every(value => value === false));
    assert.ok(plan.operations.every(operation => operation.executed === false && Array.isArray(operation.requirements) && Array.isArray(operation.blockers)));
  }
});

test('browse and discovery source paths contain no planner invocation', async () => {
  for (const relative of ['apps/web/src/pages/SearchResultsPage.tsx', 'apps/web/src/pages/LandingPage.tsx', 'apps/web/src/providers/DiscoveryProviderContext.tsx', 'apps/web/src/providers/discoveryProvider.ts']) {
    const source = await fs.readFile(path.join(REPO, relative), 'utf8');
    assert.doesNotMatch(source, /\/api\/plan|requestPlan|planResearch|plan_research|planApiAdapter/, relative);
  }
  const adapter = await fs.readFile(path.join(REPO, 'apps/web/src/providers/planApiAdapter.ts'), 'utf8');
  assert.match(adapter, /apiPlanEnabled: false/);
  assert.doesNotMatch(adapter, /transport\(/);
});

test('coverage projection carries sealed WP9 truth and pending AUTH-15 state', async () => {
  const view = JSON.parse(await fs.readFile(path.join(REPO, 'packages/coverage/accounting/v1.0.0/artifacts/public-coverage-view.json'), 'utf8'));
  const projection = await fs.readFile(path.join(REPO, 'apps/web/src/data/coveragePositioning.ts'), 'utf8');
  for (const value of [view.coverage_snapshot_id, view.coverage_snapshot_digest, view.matrix_summary.membership_manifest_hash, view.positioning.headline, view.positioning.non_additivity, view.positioning.product_owner_review_status]) assert.ok(projection.includes(value), value);
  assert.equal(view.positioning.publication_authorized, false);
  assert.match(projection, /authorizationRequirementId: 'AUTH-15'/);
});

test('AUTH-12, AUTH-15, and both human studies remain pending with no fabricated receipts', async () => {
  const register = JSON.parse(await fs.readFile(path.join(REPO, 'verification/external-authorization/v1.0.0/register.json'), 'utf8'));
  for (const id of ['AUTH-12', 'AUTH-15']) {
    const entry = register.entries.find(candidate => candidate.id === id);
    assert.equal(entry.status, 'not_requested');
    assert.equal(entry.authorized, false);
  }
  for (const [packetPath, receiptPath] of [
    ['governance/result-card-researcher-study.json', 'governance/result-card-researcher-study.receipt.json'],
    ['governance/decision-summary-review.json', 'governance/decision-summary-review.receipt.json']
  ]) {
    const packet = await read(packetPath);
    assert.match(packet.status, /^pending_external_/);
    assert.equal(packet.publication_authorized, false);
    await assert.rejects(fs.access(path.join(ROOT, receiptPath)));
  }
});

test('evidence ledger maps every requirement to implementation and verification', async () => {
  const ledger = await read('evidence-ledger.json');
  assert.equal(new Set(ledger.entries.map(entry => entry.requirement_id)).size, ledger.entries.length);
  assert.ok(ledger.entries.length >= 20);
  assert.ok(ledger.entries.every(entry => entry.implementation.length > 0 && entry.verification.length > 0));
  for (const id of ['WP11-RESULT-CARD-SIX-REGIONS', 'WP11-USE-CARD', 'WP11-ACCESS-PLAN', 'WP11-RETRIEVAL-RECIPE', 'WP11-PLAN-SECTION-ORDER', 'WP11-BROWSE-NEVER-PLANS', 'WP11-ADAPTER-GATE', 'WP11-WP9-COVERAGE-PARITY', 'WP11-EXTERNAL-URL-TRUST-BOUNDARY', 'WP11-A11Y-RESPONSIVE', 'WP11-AUTH-12', 'WP11-AUTH-15']) assert.ok(ledger.entries.some(entry => entry.requirement_id === id), id);
});
