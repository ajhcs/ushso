import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assertSuccessfulChildExecution,
  discoverContractPackages,
  discoverVerificationSuites,
  discoverWorkspacePackages,
  diffSealedArtifactSnapshots,
  parseNodeTestCount,
  repositoryRoot,
} from '../scripts/run-contract-suites.mjs'

import { auditWorkspaceLock } from '../verification/testing/ci/v1.0.0/tools/ci-inventory.mjs'

const requiredContracts = new Set([
  'contracts/core/v2.0.0',
  'contracts/coverage/v1.0.0',
  'contracts/identity/v1.0.0',
  'contracts/ingestion/v1.0.0',
  'contracts/ingestion/v1.1.0',
  'contracts/machine-toolkit/v1.0.0',
  'contracts/publication/v1.0.0',
  'contracts/research-plan/v1.0.0',
  'contracts/tooling/v1.0.0',
])

const requiredVerificationAliases = new Set([
  'evaluator-v2',
  'evaluator-bridge',
  'feedback',
  'wp0',
  'wp2',
  'wp3',
  'wp4',
  'wp5',
  'wp6',
  'wp7',
  'wp8',
  'wp9',
  'wp10a',
  'wp11',
  'wp12',
  'wp13',
  'wp14',
  'program-verification',
  'external-authorization',
  'ci-verification',
])

const requiredWorkspacePatterns = [
  'apps/web',
  'packages/*',
  'packages/*/*/v*',
  'contracts/*/v*',
  'docs/feedback/v*',
  'evaluation/*/v*',
  'verification/*/v*',
  'verification/testing/*/v*',
]

test('every versioned contract package is private, unique, and independently verifiable', async () => {
  const packages = await discoverContractPackages()
  assert.ok(packages.length >= requiredContracts.size)
  assert.deepEqual([...requiredContracts].filter((path) => !packages.some((item) => item.path === path)), [])
  assert.equal(new Set(packages.map((item) => `${item.domain}@${item.version}`)).size, packages.length)
  assert.equal(new Set(packages.map((item) => item.name)).size, packages.length)
  for (const descriptor of packages) {
    assert.equal(descriptor.private, true, `${descriptor.path} must remain private`)
    assert.equal(descriptor.package_version, descriptor.version, `${descriptor.path} version mismatch`)
    assert.equal(typeof descriptor.scripts.test, 'string', `${descriptor.path} needs a test script`)
    assert.equal(typeof descriptor.scripts.validate, 'string', `${descriptor.path} needs a validate script`)
    assert.ok(descriptor.node_test_files.length > 0, `${descriptor.path} needs discovered Node tests`)
  }
})

test('all required evaluation and verification packages are dynamically discoverable', async () => {
  const suites = await discoverVerificationSuites()
  assert.deepEqual(
    [...requiredVerificationAliases].filter((alias) => !suites.some((suite) => suite.alias === alias)),
    [],
  )
  assert.equal(new Set(suites.map((suite) => suite.alias)).size, suites.length)
  for (const suite of suites) {
    assert.ok(suite.node_test_files.length > 0, `${suite.alias} has no Node tests`)
    for (const script of suite.required_scripts) assert.equal(typeof suite.scripts[script], 'string', `${suite.alias} missing ${script}`)
  }
})

test('all workspace package names are unique across contracts, evaluation, and verification', async () => {
  const packages = await discoverWorkspacePackages()
  assert.ok(packages.length >= 20)
  assert.equal(new Set(packages.map((item) => item.name)).size, packages.length)
})

test('package-lock is structurally consistent with every discovered workspace', async () => {
  const result = await auditWorkspaceLock()
  assert.deepEqual(result, {
    status: 'PASS',
    lockfile_version: 3,
    root_workspace_patterns: requiredWorkspacePatterns,
    workspace_entry_count: result.workspace_link_count,
    workspace_link_count: result.workspace_entry_count,
  })
  assert.ok(result.workspace_entry_count >= 20)
})

test('Node 22 and Node 24 test summaries both parse to nonzero counts', () => {
  assert.equal(parseNodeTestCount('# tests 17\n# pass 17\n'), 17)
  assert.equal(parseNodeTestCount('ℹ tests 4\nℹ pass 4\n'), 4)
  assert.equal(parseNodeTestCount('# tests 0\n'), 0)
  assert.equal(parseNodeTestCount('no test summary'), 0)
})

test('spawnSync EPERM is tolerated only with a successful numeric exit status', () => {
  const permissionError = Object.assign(new Error('spawnSync npm EPERM'), { code: 'EPERM' })
  const timeoutError = Object.assign(new Error('spawnSync npm ETIMEDOUT'), { code: 'ETIMEDOUT' })
  assert.doesNotThrow(() => assertSuccessfulChildExecution({ status: 0, signal: null, error: permissionError }, 'fixture'))
  assert.throws(() => assertSuccessfulChildExecution({ status: null, signal: null, error: permissionError }, 'fixture'), /EPERM/u)
  assert.throws(() => assertSuccessfulChildExecution({ status: 1, signal: null, error: permissionError }, 'fixture'), /exit 1/u)
  assert.throws(() => assertSuccessfulChildExecution({ status: 0, signal: null, error: timeoutError }, 'fixture'), /ETIMEDOUT/u)
  assert.throws(() => assertSuccessfulChildExecution({ status: 0, signal: 'SIGTERM', error: permissionError }, 'fixture'), /SIGTERM/u)
})

test('sealed receipt snapshot changes fail closed', () => {
  const before = new Map([['verification/example/receipts/a.json', 'aaa']])
  assert.deepEqual(diffSealedArtifactSnapshots(before, new Map(before)), [])
  assert.deepEqual(diffSealedArtifactSnapshots(before, new Map([['verification/example/receipts/a.json', 'bbb']])), ['verification/example/receipts/a.json'])
  assert.deepEqual(diffSealedArtifactSnapshots(before, new Map()), ['verification/example/receipts/a.json'])
})

test('root npm test preserves legacy gates and invokes the navigator aggregate exactly once', async () => {
  const rootPackage = JSON.parse(await readFile(`${repositoryRoot}/package.json`, 'utf8'))
  for (const workspace of requiredWorkspacePatterns) {
    assert.ok(rootPackage.workspaces.includes(workspace), `missing reproducible workspace pattern ${workspace}`)
  }
  for (const name of ['test:retrieval', 'test:web', 'test:worker', 'test:evaluation', 'validate:evaluation']) {
    assert.match(rootPackage.scripts.test, new RegExp(`npm run ${name}`, 'u'))
  }
  assert.equal(rootPackage.scripts.test, 'npm run test:retrieval && npm run test:web && npm run test:worker && npm run test:evaluation && npm run validate:evaluation && npm run verify:research-navigator')
  assert.equal((rootPackage.scripts.test.match(/npm run verify:research-navigator/gu) ?? []).length, 1)
  for (const name of [
    'test:contracts', 'test:evaluator-v2', 'test:evaluator-bridge', 'test:feedback', 'test:wp0', 'test:wp2',
    'test:program-verification', 'test:external-authorization', 'test:ci-verification', 'test:verification',
    'verify:research-navigator',
  ]) assert.equal(typeof rootPackage.scripts[name], 'string', `missing root script ${name}`)
})

test('CI is least-privilege, bounded, Node 22 compatible, and contains no external mutations', async () => {
  const workflow = await readFile(`${repositoryRoot}/.github/workflows/ci.yml`, 'utf8')
  assert.match(workflow, /^permissions:\n  contents: read$/mu)
  assert.match(workflow, /^concurrency:/mu)
  assert.ok((workflow.match(/timeout-minutes:/gu) ?? []).length >= 2)
  assert.match(workflow, /node-version: ['"]22\.12\.0['"]/u)
  assert.match(workflow, /npm run build/u)
  assert.match(workflow, /^\s*- run: npm run cf:dry-run:artifact$/mu)
  assert.equal((workflow.match(/^\s*- run: npm run build$/gmu) ?? []).length, 1)
  assert.doesNotMatch(workflow, /^\s*- run: npm run cf:dry-run$/mu)
  assert.match(workflow, /persist-credentials: false/u)
  assert.doesNotMatch(workflow, /(?:wrangler\s+deploy(?![^\n]*--dry-run)|terraform\s+apply|npm\s+publish|git\s+push)/u)
  assert.doesNotMatch(workflow, /secrets\./u)
})
