#!/usr/bin/env node
// PR-003 slice C-003-3 — bounded local checker for PR guidance and test discovery.
//
// Usage:
//   node verification/research-program/pr-003/verify-pr-guidance.mjs
//
// It is deliberately local and read-only. It proves three things without a
// network, GitHub API or package install:
//   1. .github/pull_request_template.md carries every required PR body field,
//      the EXECUTION.md review states and the draft-PR / no-auto-merge rules;
//   2. the filled example body (verification/research-program/pr-003/
//      draft-pr-body.example.md) resolves every placeholder, so an intern can
//      submit a draft body from the template;
//   3. package.json registers `test:research-program` as
//      `node --test tests/research-program/*.test.mjs`, keeps every pre-existing
//      test script, includes it in the root `test` chain, and the glob actually
//      selects tests/research-program/handoff.test.mjs.
//
// Exit codes: 0 all checks passed, 1 a check failed, 2 usage/operational error.
// A passing result is producer-side package/guidance validation, not
// independent review and not an `npm test` end-to-end run.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repository root, derived from this script's location. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const FORMAT = 'ushso.pr003.c003-3.pr-guidance-check.v1';

export const RESEARCH_PROGRAM_SCRIPT = 'node --test tests/research-program/*.test.mjs';

/**
 * Required PR body fields, each mapped to a literal anchor that appears in
 * both the template and the filled example body. The anchors intentionally
 * avoid the template's own placeholders so the same field list can prove the
 * example has no unresolved token.
 */
const REQUIRED_BODY_FIELDS = {
  assignment: '## Assignment',
  base_sha: 'Integration base SHA',
  head_sha: 'Exact candidate head SHA',
  dependency_shas: 'Dependency merge SHAs',
  source_identities: 'Source / corpus / schema / model identities affected',
  handoff_link: 'Task handoff:',
  evidence_link: 'Sanitized evidence index:',
  resulting_behavior: '## Resulting behavior',
  verification: '## Verification',
  decisive_check: 'Decisive check for independent replay',
  failures_and_limits: '## Failures, skipped checks and remaining limits',
  rollback: '## Rollback or compatibility impact',
  github_submission: '## GitHub submission',
  review_state: '## Review state'
};

/** Template-only anchors: the sanitized handoff and evidence link shapes. */
const TEMPLATE_LINK_ANCHORS = {
  handoff_path: 'docs/research-program/handoffs/PR-xxx.json',
  evidence_directory: 'verification/research-program/pr-xxx/'
};

/** Required review-state guidance phrases, each a literal template anchor. */
const REQUIRED_GUIDANCE = {
  draft_body_file: '--body-file',
  draft_command: 'gh pr create --draft',
  remains_draft: 'remains a draft',
  producer_checks: 'producer checks',
  handoff_validation: 'handoff validation',
  astra_replay: 'Astra independently replays the decisive check',
  no_auto_merge: 'no automatic merge or deployment',
  no_self_merge: 'never self-merges',
  no_secret_interpolation: 'Never interpolate credentials'
};

/** EXECUTION.md explicit review states the template must enumerate. */
const REVIEW_STATES = [
  'planned',
  'ready',
  'in_progress',
  'producer_checked',
  'draft_pr',
  'independent_review',
  'changes_requested',
  'independently_verified',
  'merged',
  'integrated',
  'qualified',
  'blocked'
];

/** Pre-existing scripts that must be preserved byte-for-byte. */
const PRESERVED_SCRIPTS = {
  'test:retrieval': 'npm test --workspace @ushso/observatory-retrieval',
  'test:web': 'npm test --workspace @ushso/observatory-web',
  'test:worker': 'node --test tests/*.test.mjs',
  'test:evaluation': 'node --test evaluation/baseline/v0.1.0/tests/*.test.mjs',
  'validate:evaluation': 'node evaluation/baseline/v0.1.0/tools/validate-baseline.mjs',
  'verify:research-navigator': 'node scripts/run-contract-suites.mjs --all'
};

function addFailure(failures, id, detail) {
  failures.push({ id, detail });
}

export function checkPrGuidance(repoRoot = REPO_ROOT) {
  const failures = [];
  const observations = {};
  const templatePath = path.join(repoRoot, '.github', 'pull_request_template.md');
  const examplePath = path.join(
    repoRoot,
    'verification',
    'research-program',
    'pr-003',
    'draft-pr-body.example.md'
  );
  const packagePath = path.join(repoRoot, 'package.json');
  const suiteDir = path.join(repoRoot, 'tests', 'research-program');

  // 1. Template content.
  let template = null;
  try {
    template = readFileSync(templatePath, 'utf8');
  } catch (error) {
    addFailure(failures, 'template_missing', `cannot read ${templatePath}: ${error.message}`);
  }
  if (template !== null) {
    const missingFields = Object.entries(REQUIRED_BODY_FIELDS)
      .filter(([, anchor]) => !template.includes(anchor))
      .map(([id]) => id);
    const missingLinks = Object.entries(TEMPLATE_LINK_ANCHORS)
      .filter(([, anchor]) => !template.includes(anchor))
      .map(([id]) => id);
    const missingGuidance = Object.entries(REQUIRED_GUIDANCE)
      .filter(([, anchor]) => !template.includes(anchor))
      .map(([id]) => id);
    const missingStates = REVIEW_STATES.filter(state => !template.includes(state));
    observations.template_fields_present = Object.keys(REQUIRED_BODY_FIELDS).length - missingFields.length;
    observations.template_fields_total = Object.keys(REQUIRED_BODY_FIELDS).length;
    observations.template_guidance_present = Object.keys(REQUIRED_GUIDANCE).length - missingGuidance.length;
    observations.template_guidance_total = Object.keys(REQUIRED_GUIDANCE).length;
    observations.template_review_states_present = REVIEW_STATES.length - missingStates.length;
    observations.template_review_states_total = REVIEW_STATES.length;
    if (missingFields.length > 0) {
      addFailure(failures, 'template_missing_body_fields', `missing: ${missingFields.join(', ')}`);
    }
    if (missingLinks.length > 0) {
      addFailure(failures, 'template_missing_link_anchors', `missing: ${missingLinks.join(', ')}`);
    }
    if (missingGuidance.length > 0) {
      addFailure(failures, 'template_missing_review_guidance', `missing: ${missingGuidance.join(', ')}`);
    }
    if (missingStates.length > 0) {
      addFailure(failures, 'template_missing_review_states', `missing: ${missingStates.join(', ')}`);
    }
  }

  // 2. Filled example body: every field present, no unresolved placeholder.
  let example = null;
  try {
    example = readFileSync(examplePath, 'utf8');
  } catch (error) {
    addFailure(failures, 'example_body_missing', `cannot read ${examplePath}: ${error.message}`);
  }
  if (example !== null) {
    const missingFields = Object.entries(REQUIRED_BODY_FIELDS)
      .filter(([, anchor]) => !example.includes(anchor))
      .map(([id]) => id);
    const placeholders = [
      { rule: 'pr_xxx_token', match: example.match(/PR-xxx/g) },
      { rule: 'angle_bracket_placeholder', match: example.match(/<[^>\n]+>/g) },
      { rule: 'todo_token', match: example.match(/\b(TODO|TBD)\b/g) }
    ].filter(entry => entry.match !== null);
    observations.example_fields_present = Object.keys(REQUIRED_BODY_FIELDS).length - missingFields.length;
    observations.example_fields_total = Object.keys(REQUIRED_BODY_FIELDS).length;
    observations.example_placeholder_rules_hit = placeholders.map(entry => entry.rule);
    if (missingFields.length > 0) {
      addFailure(failures, 'example_body_missing_fields', `missing: ${missingFields.join(', ')}`);
    }
    if (placeholders.length > 0) {
      addFailure(
        failures,
        'example_body_unresolved_placeholder',
        placeholders
          .map(entry => `${entry.rule}: ${[...new Set(entry.match)].join(', ')}`)
          .join('; ')
      );
    }
  }

  // 3. package.json registration and preservation.
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch (error) {
    addFailure(failures, 'package_json_unreadable', `cannot parse ${packagePath}: ${error.message}`);
  }
  if (pkg !== null) {
    const scripts = pkg.scripts ?? {};
    observations.test_research_program = scripts['test:research-program'] ?? null;
    if (scripts['test:research-program'] !== RESEARCH_PROGRAM_SCRIPT) {
      addFailure(
        failures,
        'test_research_program_script_mismatch',
        `expected ${JSON.stringify(RESEARCH_PROGRAM_SCRIPT)} got ${JSON.stringify(scripts['test:research-program'] ?? null)}`
      );
    }
    const rootChain = typeof scripts.test === 'string' ? scripts.test.split(' && ').map(part => part.trim()) : [];
    observations.root_test_chain = rootChain;
    if (!rootChain.includes('npm run test:research-program')) {
      addFailure(
        failures,
        'root_test_chain_missing_research_program',
        'the root test script does not invoke npm run test:research-program'
      );
    }
    const drifted = Object.entries(PRESERVED_SCRIPTS)
      .filter(([name, value]) => scripts[name] !== value)
      .map(([name]) => name);
    observations.preserved_scripts_ok = Object.keys(PRESERVED_SCRIPTS).length - drifted.length;
    observations.preserved_scripts_total = Object.keys(PRESERVED_SCRIPTS).length;
    if (drifted.length > 0) {
      addFailure(failures, 'preserved_test_script_changed', `changed: ${drifted.join(', ')}`);
    }
  }

  // 4. The glob actually selects the handoff test.
  let selected = [];
  try {
    selected = readdirSync(suiteDir)
      .filter(name => name.endsWith('.test.mjs'))
      .sort();
  } catch (error) {
    addFailure(failures, 'suite_directory_missing', `cannot read ${suiteDir}: ${error.message}`);
  }
  observations.selected_test_files = selected;
  if (!selected.includes('handoff.test.mjs')) {
    addFailure(
      failures,
      'handoff_test_not_selected',
      'tests/research-program/handoff.test.mjs is not matched by tests/research-program/*.test.mjs'
    );
  }

  return {
    format: FORMAT,
    tool: 'verification/research-program/pr-003/verify-pr-guidance.mjs',
    ok: failures.length === 0,
    checks: {
      template_fields: !failures.some(f => f.id.startsWith('template_missing')),
      example_body_resolved: !failures.some(f => f.id.startsWith('example_body_')),
      package_registration: !failures.some(f => f.id.startsWith('test_research_program') || f.id.startsWith('root_test_chain') || f.id.startsWith('preserved_test')),
      test_glob_selection: !failures.some(f => f.id === 'handoff_test_not_selected')
    },
    observations,
    failures,
    independent_review: {
      status: 'not_claimed',
      detail:
        'Local package/guidance validation only. It is not an npm test end-to-end run and not independent verification.'
    }
  };
}

function main() {
  try {
    const report = checkPrGuidance();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.ok ? 0 : 1);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify(
        {
          format: FORMAT,
          tool: 'verification/research-program/pr-003/verify-pr-guidance.mjs',
          ok: false,
          outcome: 'error',
          failures: [
            { id: 'operational_error', detail: error instanceof Error ? error.message : String(error) }
          ]
        },
        null,
        2
      )}\n`
    );
    process.exit(2);
  }
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedDirectly) {
  main();
}
