#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestEvidence } from '../../../scripts/research-program/ingest-evidence.mjs';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const REVIEW_AUTHORITY = Object.freeze({
  can_grant_owner_authority: false,
  can_accept_requirements: false,
  can_issue_release_qualification: false,
  can_change_production: false,
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function freeze(value) {
  return Object.freeze(value);
}

function loadJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function req(id, { result, witnesses, remaining, closed = false }) {
  return freeze({
    id,
    accepted: false,
    result,
    closed,
    witnesses,
    remaining_limitation: remaining,
    missing_witness_keeps_open: true,
  });
}

function finding(id, { status, witnesses, remaining, closed = false }) {
  return freeze({
    id,
    closed,
    status,
    witnesses,
    remaining_limitation: remaining,
    no_longer_reproduces: closed === true,
  });
}

export function assembleAcceptanceIndex({
  data = loadJson('verification/research-program/acceptance/requirement-results.json'),
  usability = loadJson('evaluation/research-program/usability/score-result.json'),
  ledger = loadJson('docs/research-program/execution-ledger.json'),
  ingestion = ingestEvidence(),
} = {}) {
  if (data.generation !== LAST_GOOD_GENERATION) fail('LAST_GOOD_GENERATION_CHANGED');
  if (usability.r12.accepted === true) fail('R12_ACCEPTED_WITHOUT_PARTICIPANTS');
  const planned = ledger.tasks.filter((t) => t.status === 'planned').map((t) => t.pr_id);
  const integrated = ledger.tasks.filter((t) => t.status === 'integrated');
  const requirements = freeze([
    req('R01', { result: ingestion.attempts.r01.result, witnesses: ['scripts/research-program/ingest-evidence.mjs', 'verification/research-program/evidence/history/requirement-results-pr079.json'], remaining: ingestion.attempts.r01.evidence }),
    req('R02', { result: 'unverified', witnesses: ['docs/research-program/acceptance.md'], remaining: 'Full-catalog factual-field evidence was not re-measured as a pass.' }),
    req('R03', { result: ingestion.attempts.r03.result, witnesses: ['scripts/research-program/ingest-evidence.mjs', 'verification/research-program/evidence/history/requirement-results-pr079.json'], remaining: ingestion.attempts.r03.evidence }),
    req('R04', { result: 'fail', witnesses: ['evaluation/research-program/review/core-qualification-receipt.json'], remaining: 'Failed 100-product matrix retained. Unknown cells are not supported.' }),
    req('R05', { result: 'fail', witnesses: ['docs/research-program/restricted-routes.md'], remaining: 'Restricted/manual routes remain unverified.' }),
    req('R06', { result: 'fail', witnesses: ['docs/research-program/deterministic-results.md'], remaining: 'Dictionary/unit/key residuals remain.' }),
    req('R07', { result: 'fail', witnesses: ['docs/research-program/core-acceptance.md'], remaining: 'Failing retrieval domains still need bounded remediation.' }),
    req('R08', { result: 'fail', witnesses: ['packages/registry/qualified-join-routes.mjs'], remaining: '15 documented routes; 0 independently qualified. CCN is never NPI.' }),
    req('R09', { result: 'unverified', witnesses: ['evaluation/research-program/cohorts.json'], remaining: 'Twelve families are identity-frozen, not scientifically accepted.' }),
    req('R10', { result: 'unverified', witnesses: ['evaluation/research-program/cohorts.json'], remaining: '25/10 MRF directory IDs frozen; locators not materialized.' }),
    req('R11', { result: 'unverified', witnesses: ['docs/research-program/join-evidence.md'], remaining: 'Tiny samples cannot report universal match rates.' }),
    req('R12', { result: usability.r12.result, witnesses: ['evaluation/research-program/usability/score-result.json', 'docs/research-program/usability-results.md'], remaining: `Actual participants novice=${usability.r12.novice.actual_participants}/8 advanced=${usability.r12.advanced.actual_participants}/8. Implementer self-tests cannot satisfy R12.` }),
    req('R13', { result: 'unverified', witnesses: ['docs/research-program/mcp-setup.md', 'apps/web/src/pages/LearnPage.tsx', 'apps/web/src/pages/AboutPage.tsx'], remaining: 'Guides exist as engineering artifacts; R13 remains unaccepted pending documented usability of the named set.' }),
    req('R14', { result: 'unverified', witnesses: ['docs/research-program/acceptance.md'], remaining: 'Held-out claim precision, spend ledger, and residual scientific-claim sample are not materialized.' }),
    req('R15', { result: ingestion.observation.result === 'observed' ? 'observed' : 'fail', witnesses: ['scripts/research-program/ingest-evidence.mjs', 'verification/research-program/operations/observe.mjs'], remaining: ingestion.observation.technical_success ? 'Technical observation thresholds were calculated from validated receipts. Scientific approval remains separate.' : 'Two authorized scheduled cycles and 14 elapsed observation days remain absent, or observation was not on a reviewed deployed product.' }),
    req('R16', { result: 'fail', witnesses: ['verification/research-program/release/qualification.json'], remaining: 'PR-082 rejected independent exact release qualification. PR-083 did not deploy. Production truth does not match an independently qualified artifact.' }),
  ]);
  if (requirements.length !== 16) fail('REQUIREMENT_COUNT_NOT_16');
  if (requirements.some((row) => row.accepted === true || row.closed === true)) fail('REQUIREMENT_CLOSED_OR_ACCEPTED');

  const findings = freeze([
    finding('F01', { status: 'open', witnesses: ['docs/master-plan/2026-09-10/TRACEABILITY.md'], remaining: 'Release packet and independent qualification remain PR-082–084.' }),
    finding('F02', { status: 'open', witnesses: ['docs/research-program/source-cards.md'], remaining: 'Source-card completeness is not R04 scientific acceptance.' }),
    finding('F03', { status: 'open', witnesses: ['tests/research-program/http-outcomes.test.mjs'], remaining: 'HTTP 200 is not payload access or a completed research task.' }),
    finding('F04', { status: 'open', witnesses: ['docs/research-program/grain-and-time.md'], remaining: 'Grain/time confusion remains a documented risk, not a closed human-study result.' }),
    finding('F05', { status: 'open', witnesses: ['docs/research-program/core-acceptance.md'], remaining: 'Unknown essential fields cannot count as supported.' }),
    finding('F06', { status: 'open', witnesses: ['docs/research-program/identifier-systems.md'], remaining: 'CCN/NPI interchange remains forbidden and untested as a human critical-misunderstanding study.' }),
    finding('F07', { status: 'open', witnesses: ['docs/research-program/operations.md'], remaining: 'Stale-source visibility is fixture-documented; two authorized cycles remain unrun.' }),
    finding('F08', { status: 'open', witnesses: ['docs/research-program/relevance.md'], remaining: 'Retrieval quality remains unaccepted (R07).' }),
    finding('F09', { status: 'open', witnesses: ['docs/research-program/deterministic-results.md'], remaining: 'Dictionary residuals remain.' }),
    finding('F10', { status: 'open', witnesses: ['docs/research-program/measure-semantics.md'], remaining: 'Measure semantics are documented, not scientifically accepted.' }),
    finding('F11', { status: 'open', witnesses: ['docs/research-program/price-semantics.md'], remaining: 'Gross/cash/negotiated/allowed-amount remain distinct; human misunderstanding study unrun.' }),
    finding('F12', { status: 'open', witnesses: ['docs/research-program/example-packets.md'], remaining: 'Examples are not payload tests.' }),
    finding('F13', { status: 'open', witnesses: ['packages/connectors/src/content-classifier.mjs'], remaining: 'Destination-role mismatch remains a dated fixture, not live source success.' }),
    finding('F14', { status: 'open', witnesses: ['packages/registry/qualified-join-routes.mjs'], remaining: 'Independently qualified joins remain 0.' }),
    finding('F15', { status: 'open', witnesses: ['docs/research-program/named-sources.md'], remaining: 'Twelve families remain identity-frozen.' }),
    finding('F16', { status: 'open', witnesses: ['docs/research-program/core-readiness.md'], remaining: 'Core readiness engineering is not R04 acceptance.' }),
    finding('F17', { status: 'open', witnesses: ['docs/research-program/source-coverage.md'], remaining: 'Coverage accounting remains a documented bound, not a closed scientific result.' }),
    finding('F18', { status: 'open', witnesses: ['docs/research-program/join-evidence.md'], remaining: 'Join evidence is not 15 independently qualified routes.' }),
    finding('F19', { status: 'open', witnesses: ['scripts/research-program/verify-machine.mjs'], remaining: 'Machine protocol success is not research success. Native WebMCP untested.' }),
    finding('F20', { status: 'open', witnesses: ['docs/research-program/mcp-setup.md'], remaining: 'MCP setup exists; native WebMCP remains untested.' }),
    finding('F21', { status: 'open', witnesses: ['packages/machine-toolkit/src/manifest.mjs'], remaining: 'plan_research remains disabled.' }),
    finding('F22', { status: 'open', witnesses: ['docs/research-program/acceptance.md'], remaining: 'Program completeness is not implied by merged PR count.' }),
    finding('F23', { status: 'open', witnesses: ['apps/web/src/pages/LearnPage.tsx', 'docs/research-program/usability-results.md'], remaining: 'Beginner route exists; R12 unverified without 8+8 actual participants.' }),
    finding('F24', { status: 'open', witnesses: ['docs/research-program/usability-results.md'], remaining: 'Internal-label usability remains untested with real novices.' }),
    finding('F25', { status: 'open', witnesses: ['tests/research-program/browser-matrix.mjs'], remaining: 'Live Chromium/Firefox/WebKit remain untested. NVDA/VoiceOver/JAWS remain untested.' }),
    finding('F26', { status: 'open', witnesses: ['apps/web/src/pages/AboutPage.tsx'], remaining: 'Unsupplied About disclosures remain unsupplied. Frontend acceptance not issued.' }),
    finding('F27', { status: 'open', witnesses: ['docs/research-program/usability-results.md'], remaining: 'Research shortlist/comparison workflow remains untested with real humans.' }),
    finding('F28', { status: 'open', witnesses: ['docs/research-program/usability-results.md'], remaining: 'Citation/export usability remains untested with real humans.' }),
    finding('F29', { status: 'open', witnesses: ['tests/research-program/browser-matrix.mjs'], remaining: 'Native WebMCP untested in unsupported browsers.' }),
    finding('F30', { status: 'open', witnesses: ['docs/research-program/costs.md'], remaining: 'Fixture 1x/2x is not production capacity. C-009-1 unresolved.' }),
    finding('F31', { status: 'open', witnesses: ['docs/research-program/operations.md', 'apps/web/public/_headers'], remaining: 'Insights disabled under CSP. Fresh browser captures remain untested. 2026-09-10 F31 console record is historical.' }),
    finding('F32', { status: 'open', witnesses: ['docs/research-program/operations.md'], remaining: 'Two complete scheduled cycles remain unrun until authorized.' }),
    finding('F33', { status: 'open', witnesses: ['docs/research-program/mrf-methods.md'], remaining: 'Directory identity is not payload, parse, or TiC reporting-entity proof.' }),
  ]);
  if (findings.length !== 33) fail('FINDING_COUNT_NOT_33');
  if (findings.some((row) => row.closed === true)) fail('FINDING_CLOSED_WITHOUT_WITNESS');

  return freeze({
    format: 'ushso.pr081-acceptance-index.v1',
    generation: LAST_GOOD_GENERATION,
    candidate: freeze({
      research_head_at_bind: 'e5267e6821cfe07a729197121c6dc37443874ae1',
      last_good_generation: LAST_GOOD_GENERATION,
      catalog_manifest_sha256: data.catalog_manifest_sha256,
    }),
    authority: REVIEW_AUTHORITY,
    readiness_is_not_commit_count: true,
    integrated_pr_count: integrated.length,
    planned_remaining: freeze(planned),
    fully_evidenced_candidate: false,
    proceeds_to_release_preparation: false,
    owner_authority_granted_by_this_review: false,
    requirements,
    findings,
    documentation_closure: freeze({
      handoff_packets_present_for_integrated_work: true,
      orphan_artifact_hidden: false,
      undeclared_exception_hidden: false,
      stale_dependency_hidden: false,
      missing_review_note_hidden: false,
      unsupplied_about_disclosures_remain_unsupplied: true,
      public_contact: 'info@ushso.org',
      notes: [
        'PR-082, PR-083, and PR-084 remain planned. Their packets are not claimed complete.',
        'Full 21 MiB local-gate receipts stay off-tree as hashed pointers.',
      ],
    }),
    outstanding_decisions: freeze([
      'Obtain 8 actual novice and 8 actual advanced participants distinct from implementers, or keep R12 unverified.',
      'Do not issue R01-R16 acceptance from merged engineering PRs.',
      'Keep C-009-1 unresolved without actual account terms and measured production cost.',
      'Do not start PR-082 release preparation until a fully evidenced candidate exists.',
      'Production/spend decisions remain separately owner-authorized and are not granted by this review.',
    ]),
    production_spend_decisions: freeze({
      separate_from_this_review: true,
      production_changed: false,
      numeric_budget_usd: null,
    }),
    c0091: 'unresolved',
    http_200_is_completed_research_task: false,
    passing_schema_is_scientific_approval: false,
    last_good_generation_changed: false,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(assembleAcceptanceIndex(), null, 2)}\n`);
}
