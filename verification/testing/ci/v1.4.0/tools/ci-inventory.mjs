import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  discoverContractPackages,
  discoverVerificationSuites,
  discoverWorkspacePackages,
  repositoryRoot,
} from '../../../../../scripts/run-contract-suites.mjs'

export { repositoryRoot }

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const receiptPath = resolve(packageRoot, 'receipts', 'ci-integration.json')

const requiredContracts = [
  'contracts/core/v2.0.0',
  'contracts/coverage/v1.0.0',
  'contracts/identity/v1.0.0',
  'contracts/ingestion/v1.0.0',
  'contracts/ingestion/v1.1.0',
  'contracts/machine-toolkit/v1.0.0',
  'contracts/publication/v1.0.0',
  'contracts/research-plan/v1.0.0',
  'contracts/tooling/v1.0.0',
]

export const ROOT_SCRIPT_CONTRACT = Object.freeze({
  'test:contracts': 'node scripts/run-contract-suites.mjs --contracts',
  'test:evaluator-v2': 'node scripts/run-contract-suites.mjs --suite evaluator-v2',
  'test:evaluator-bridge': 'node scripts/run-contract-suites.mjs --suite evaluator-bridge',
  'test:feedback': 'node scripts/run-contract-suites.mjs --suite feedback',
  'test:wp0': 'node scripts/run-contract-suites.mjs --suite wp0',
  'test:wp2': 'node scripts/run-contract-suites.mjs --suite wp2',
  'test:program-verification': 'node scripts/run-contract-suites.mjs --suite program-verification',
  'test:external-authorization': 'node scripts/run-contract-suites.mjs --suite external-authorization',
  'test:ci-verification': 'node scripts/run-contract-suites.mjs --suite ci-verification',
  'test:verification': 'node scripts/run-contract-suites.mjs --verification',
  'verify:research-navigator': 'node scripts/run-contract-suites.mjs --all',
  'cf:dry-run:artifact': 'node scripts/run-wrangler.mjs deploy --dry-run --outdir .wrangler-dry-run',
  'cf:dry-run': 'npm run build && npm run cf:dry-run:artifact',
})

export const ORIGINAL_ROOT_TEST_SEQUENCE = Object.freeze([
  'npm run test:retrieval',
  'npm run test:web',
  'npm run test:worker',
  'npm run test:evaluation',
  'npm run validate:evaluation',
  'npm run verify:research-navigator',
])

export const EXTENDED_ROOT_TEST_SEQUENCE = Object.freeze([
  'npm run test:retrieval',
  'npm run test:web',
  'npm run test:worker',
  'npm run test:research-program',
  'npm run test:evaluation',
  'npm run validate:evaluation',
  'npm run verify:research-navigator',
])

export const RESEARCH_PROGRAM_SCRIPT = 'node --test tests/research-program/*.test.mjs'
export const NAVIGATOR_AGGREGATE = 'npm run verify:research-navigator'

function sameSequence(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function parseRootTestSequence(value) {
  requireCondition(typeof value === 'string' && value.trim().length > 0, 'root npm test sequence is missing')
  const sequence = value.split('&&').map((item) => item.trim())
  requireCondition(sequence.every((item) => item.length > 0), 'root npm test sequence contains an empty stage')
  return sequence
}

/**
 * Validate the only two root npm test chains accepted by this inventory.
 * The PR-003 extension is accepted as a fixture-compatible chain only when
 * its registered script is exact and occurs once immediately after worker.
 */
export function validateRootTestSequence(rootPackageLike) {
  const scripts = rootPackageLike?.scripts ?? rootPackageLike ?? {}
  const sequence = parseRootTestSequence(scripts.test)
  const legacy = ORIGINAL_ROOT_TEST_SEQUENCE.filter((stage) => stage !== NAVIGATOR_AGGREGATE)
  for (const stage of legacy) {
    requireCondition(sequence.filter((item) => item === stage).length === 1, `root npm test must include exactly one ${stage}`)
  }
  requireCondition(sequence.filter((item) => item === NAVIGATOR_AGGREGATE).length === 1, 'root npm test must invoke the aggregate exactly once')
  const hasResearchStage = sequence.includes('npm run test:research-program')
  const registeredResearchScript = scripts['test:research-program']
  if (registeredResearchScript !== undefined) {
    requireCondition(registeredResearchScript === RESEARCH_PROGRAM_SCRIPT, 'root test:research-program script does not match registration')
    requireCondition(sequence.filter((item) => item === 'npm run test:research-program').length === 1, 'declared research-program stage must run exactly once')
  }
  if (hasResearchStage) {
    requireCondition(registeredResearchScript === RESEARCH_PROGRAM_SCRIPT, 'root research-program stage is not registered with the reviewed command')
    const workerIndex = sequence.indexOf('npm run test:worker')
    requireCondition(sequence[workerIndex + 1] === 'npm run test:research-program', 'research-program stage must immediately follow worker')
    requireCondition(sameSequence(sequence, EXTENDED_ROOT_TEST_SEQUENCE), 'root npm test extended sequence changed')
  } else {
    requireCondition(registeredResearchScript === undefined, 'unrun research-program registration is not permitted')
    requireCondition(sameSequence(sequence, ORIGINAL_ROOT_TEST_SEQUENCE), 'root npm test sequence changed')
  }
  return {
    chain: hasResearchStage ? 'pr003-root-chain' : 'original-root-chain',
    sequence,
    research_program: {
      declared: registeredResearchScript !== undefined,
      command: registeredResearchScript ?? null,
      stage_count: sequence.filter((item) => item === 'npm run test:research-program').length,
    },
  }
}

const requiredWorkspacePatterns = Object.freeze([
  'apps/web',
  'packages/*',
  'packages/*/*/v*',
  'contracts/*/v*',
  'docs/feedback/v*',
  'evaluation/*/v*',
  'verification/*/v*',
  'verification/testing/*/v*',
])

const lockDescriptorFields = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'bundledDependencies',
  'engines',
  'bin',
  'os',
  'cpu',
])

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function normalizedJson(value) {
  if (Array.isArray(value)) return value.map(normalizedJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizedJson(value[key])]))
  }
  return value
}

function jsonEquals(left, right) {
  return JSON.stringify(normalizedJson(left)) === JSON.stringify(normalizedJson(right))
}

function assertLockedDescriptor(path, descriptor, lockEntry) {
  requireCondition(lockEntry && typeof lockEntry === 'object' && !Array.isArray(lockEntry), `${path}: package-lock workspace entry is missing`)
  requireCondition(lockEntry.name === descriptor.name, `${path}: package-lock name does not match package.json`)
  requireCondition(lockEntry.version === descriptor.version, `${path}: package-lock version does not match package.json`)
  for (const field of lockDescriptorFields) {
    requireCondition(jsonEquals(lockEntry[field], descriptor[field]), `${path}: package-lock ${field} does not match package.json`)
  }
}

export async function auditWorkspaceLock({ rootPackage, workspacePackages } = {}) {
  const resolvedRootPackage = rootPackage ?? JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
  const resolvedWorkspacePackages = workspacePackages ?? await discoverWorkspacePackages()
  const lock = JSON.parse(await readFile(resolve(repositoryRoot, 'package-lock.json'), 'utf8'))

  requireCondition(lock.lockfileVersion === 3, 'package-lock.json must use lockfileVersion 3')
  requireCondition(lock.packages && typeof lock.packages === 'object' && !Array.isArray(lock.packages), 'package-lock.json packages map is missing')
  assertLockedDescriptor('package.json', resolvedRootPackage, lock.packages[''])
  requireCondition(jsonEquals(lock.packages[''].workspaces, resolvedRootPackage.workspaces), 'package-lock root workspaces do not match package.json')

  const expectedPaths = new Set(resolvedWorkspacePackages.map((workspace) => workspace.path))
  const linkedWorkspaces = Object.entries(lock.packages)
    .filter(([path, entry]) => path.startsWith('node_modules/') && entry?.link === true)
    .map(([path, entry]) => ({ path, resolved: entry.resolved }))
  requireCondition(new Set(linkedWorkspaces.map((entry) => entry.resolved)).size === linkedWorkspaces.length, 'package-lock contains duplicate workspace link targets')
  const linkedPaths = new Set(linkedWorkspaces.map((entry) => entry.resolved))
  const missingLinks = [...expectedPaths].filter((path) => !linkedPaths.has(path)).sort()
  const staleLinks = [...linkedPaths].filter((path) => !expectedPaths.has(path)).sort()
  requireCondition(
    missingLinks.length === 0 && staleLinks.length === 0,
    `package-lock workspace links differ; missing: ${missingLinks.join(', ') || 'none'}; stale: ${staleLinks.join(', ') || 'none'}`,
  )
  requireCondition(linkedWorkspaces.length === expectedPaths.size, `package-lock workspace link count ${linkedWorkspaces.length} does not match discovered count ${expectedPaths.size}`)

  for (const workspace of resolvedWorkspacePackages) {
    const descriptor = JSON.parse(await readFile(resolve(repositoryRoot, workspace.path, 'package.json'), 'utf8'))
    assertLockedDescriptor(workspace.path, descriptor, lock.packages[workspace.path])
    const linkPath = `node_modules/${workspace.name}`
    const link = lock.packages[linkPath]
    requireCondition(link?.link === true, `${linkPath}: package-lock workspace link is missing`)
    requireCondition(link.resolved === workspace.path, `${linkPath}: package-lock workspace link resolves to ${link.resolved ?? 'nothing'}, expected ${workspace.path}`)
  }

  return {
    status: 'PASS',
    lockfile_version: lock.lockfileVersion,
    root_workspace_patterns: [...resolvedRootPackage.workspaces],
    workspace_entry_count: resolvedWorkspacePackages.length,
    workspace_link_count: linkedWorkspaces.length,
  }
}

async function pin(repositoryRelativePath) {
  const bytes = await readFile(resolve(repositoryRoot, repositoryRelativePath))
  return { path: repositoryRelativePath, bytes: bytes.length, byte_sha256: digest(bytes) }
}

function compactDescriptor(descriptor) {
  return {
    path: descriptor.path,
    name: descriptor.name,
    version: descriptor.version,
    required_scripts: descriptor.required_scripts,
    node_test_file_count: descriptor.node_test_files.length,
    node_test_files: descriptor.node_test_files,
  }
}

export async function buildCiIntegrationReceipt() {
  const [contracts, verificationSuites, workspacePackages, rootPackageBytes, workflowBytes, runnerBytes] = await Promise.all([
    discoverContractPackages(),
    discoverVerificationSuites(),
    discoverWorkspacePackages(),
    readFile(resolve(repositoryRoot, 'package.json')),
    readFile(resolve(repositoryRoot, '.github/workflows/ci.yml')),
    readFile(resolve(repositoryRoot, 'scripts/run-contract-suites.mjs')),
  ])
  const rootPackage = JSON.parse(rootPackageBytes.toString('utf8'))
  const workflow = workflowBytes.toString('utf8')
  const runner = runnerBytes.toString('utf8')
  const packageLock = await auditWorkspaceLock({ rootPackage, workspacePackages })

  for (const path of requiredContracts) requireCondition(contracts.some((item) => item.path === path), `required contract not discovered: ${path}`)
  for (const workspace of requiredWorkspacePatterns) requireCondition(rootPackage.workspaces?.includes(workspace), `workspace pattern missing: ${workspace}`)
  for (const [name, command] of Object.entries(ROOT_SCRIPT_CONTRACT)) requireCondition(rootPackage.scripts?.[name] === command, `root script changed: ${name}`)
  const rootTestContract = validateRootTestSequence(rootPackage)

  requireCondition(/^permissions:\n  contents: read$/mu.test(workflow), 'CI permissions are not least privilege')
  requireCondition(/^concurrency:/mu.test(workflow), 'CI concurrency control is missing')
  requireCondition((workflow.match(/timeout-minutes:/gu) ?? []).length >= 2, 'CI job timeouts are missing')
  requireCondition(/node-version: ['"]22\.15\.0['"]/u.test(workflow), 'required Node 22.15 compatibility lane is missing')
  requireCondition((workflow.match(/npm install --global npm@11\.19\.1[^\n]*\n\s*- run: npm ci/gu) ?? []).length === 2, 'pinned npm toolchain must precede both locked CI installs')
  requireCondition(workflow.includes('persist-credentials: false'), 'checkout credentials remain persisted')
  requireCondition((workflow.match(/^\s*- run: npm run build$/gmu) ?? []).length === 1, 'CI must invoke the repository build exactly once')
  requireCondition(/^\s*- run: npm run cf:dry-run:artifact$/mu.test(workflow), 'artifact-only Wrangler dry-run gate is missing')
  requireCondition(!/^\s*- run: npm run cf:dry-run$/mu.test(workflow), 'CI calls the local compatibility wrapper and would rebuild')
  requireCondition(!/(?:wrangler\s+deploy(?![^\n]*--dry-run)|terraform\s+apply|npm\s+publish|git\s+push)/u.test(workflow), 'external mutation command found in CI')
  requireCondition(!workflow.includes('secrets.'), 'CI references secrets')
  requireCondition(runner.includes("USHSO_LIVE_SOURCE_REQUESTS: 'forbidden'"), 'runner does not forbid live source requests')
  requireCondition(runner.includes("NPM_CONFIG_USERCONFIG: process.platform === 'win32' ? 'NUL' : '/dev/null'"), 'runner does not isolate user npm configuration')
  requireCondition(runner.includes('hidden npm lifecycle hook'), 'runner does not reject hidden npm lifecycle hooks')
  requireCondition(runner.includes('Node test output reported zero parsed tests'), 'runner does not fail on zero parsed tests')
  requireCondition(!/writeFile|appendFile|rename\(/u.test(runner), 'aggregate runner contains a filesystem write')
  requireCondition(runner.includes("mkdtempSync(join(tmpdir(), 'ushso-contract-suite-'))"), 'runner does not use an isolated temporary output capture')
  requireCondition(runner.includes('if (outputBytes > MAX_CHILD_OUTPUT_BYTES)'), 'runner does not bound captured child output')
  requireCondition(runner.includes('rmSync(captureRoot, { recursive: true, force: true })'), 'runner does not remove temporary output captures')
  requireCondition(runner.includes('usesReviewedCiV14CurrentAttestation'), 'runner does not expose the reviewed CI v1.4 route')
  requireCondition(runner.includes("verification: 'ci-v14-current-attestation'"), 'runner does not label the CI v1.4 route')

  const inputs = await Promise.all([
    'package.json',
    'package-lock.json',
    '.nvmrc',
    '.github/workflows/ci.yml',
    'scripts/run-contract-suites.mjs',
    'scripts/verify-ci-attestation.mjs',
    'tests/contract-package-inventory.test.mjs',
    'tests/ci-attestation.test.mjs',
    'verification/testing/ci/v1.4.0/README.md',
    'verification/testing/ci/v1.4.0/package.json',
    'verification/testing/ci/v1.4.0/tests/ci-integration.test.mjs',
    'verification/testing/ci/v1.4.0/tools/ci-inventory.mjs',
    'verification/testing/ci/v1.4.0/tools/validate-package.mjs',
  ].map(pin))

  return {
    receipt_version: 'ushso.ci-integration-receipt.v1.4',
    package_version: '1.4.0',
    status: 'PASS',
    contract_package_count: contracts.length,
    contract_packages: contracts.map(compactDescriptor),
    verification_suite_count: verificationSuites.length,
    verification_suites: verificationSuites.map((suite) => ({ alias: suite.alias, ...compactDescriptor(suite) })),
    root_test_chain: rootTestContract.chain,
    root_test_sequence: rootTestContract.sequence,
    root_test_research_program: rootTestContract.research_program,
    discovered_node_test_file_count: [...contracts, ...verificationSuites].reduce((sum, item) => sum + item.node_test_files.length, 0),
    parsed_test_count_policy: 'required-greater-than-zero-per-test-script',
    child_output_capture: 'bounded-temporary-files-removed-after-each-script',
    local_execution_constraint: {
      environment: 'Codex workspace sandbox',
      symptom: 'nested spawnSync may report EPERM even when it carries numeric status zero',
      affected_local_fixture: 'contracts/core/v1.0.0/tests/core-contract.test.mjs',
      policy: 'no bypass or skip; rerun the full aggregate where nested process creation is permitted',
      github_actions_expected_impact: 'none',
    },
    workspace_patterns: [...requiredWorkspacePatterns],
    workspace_package_count: workspacePackages.length,
    workspace_packages: workspacePackages,
    package_lock: packageLock,
    node_compatibility: { minimum: '22.15.0', build_pin_file: '.nvmrc' },
    live_source_requests: 'forbidden',
    receipt_mode: 'verify-only',
    sealed_receipts_mutated: false,
    external_requests: 0,
    external_mutations: 0,
    inputs,
    immutable: true,
  }
}

export function repositoryRelativePath(absolutePath) {
  return relative(repositoryRoot, absolutePath).replaceAll('\\', '/')
}

export const buildTechnicalEvidence = buildCiIntegrationReceipt
