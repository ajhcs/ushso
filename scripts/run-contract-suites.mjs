import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contractsRoot = resolve(repositoryRoot, 'contracts')
const VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const NODE_TEST = /\.test\.(?:cjs|js|mjs)$/u
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024 * 1024
const CHILD_TIMEOUT_MS = 180_000
const sealedArtifactRoots = ['contracts', 'docs/feedback', 'evaluation', 'verification']

const verificationSuiteDefinitions = Object.freeze([
  { alias: 'evaluator-v2', root: 'evaluation/harness', major: 2, scripts: ['test', 'validate'] },
  { alias: 'evaluator-bridge', root: 'evaluation/bridge', scripts: ['test', 'validate'] },
  { alias: 'feedback', root: 'docs/feedback', scripts: ['test', 'validate'] },
  { alias: 'wp0', root: 'verification/wp0', scripts: ['test', 'validate'] },
  { alias: 'wp2', root: 'verification/wp2', scripts: ['test', 'validate'] },
  { alias: 'wp3', root: 'verification/wp3', scripts: ['test', 'validate'] },
  { alias: 'wp4', root: 'verification/wp4', scripts: ['test', 'validate'] },
  { alias: 'wp5', root: 'verification/wp5', scripts: ['test', 'validate'] },
  { alias: 'wp6', root: 'verification/wp6', scripts: ['test', 'validate'] },
  { alias: 'wp7', root: 'verification/wp7', scripts: ['test', 'validate'] },
  { alias: 'wp8', root: 'verification/wp8', scripts: ['test', 'validate'] },
  { alias: 'wp9', root: 'verification/wp9', scripts: ['test', 'validate'] },
  { alias: 'wp10a', root: 'verification/wp10a', scripts: ['test', 'validate'] },
  { alias: 'wp11', root: 'verification/wp11', scripts: ['test', 'validate'] },
  { alias: 'wp12', root: 'verification/wp12', scripts: ['test', 'validate'] },
  { alias: 'wp13', root: 'verification/wp13', scripts: ['test', 'validate'] },
  { alias: 'wp14', root: 'verification/wp14', scripts: ['test', 'validate'] },
  { alias: 'program-verification', root: 'verification/program', scripts: ['test', 'validate'] },
  { alias: 'external-authorization', root: 'verification/external-authorization', scripts: ['test'] },
  { alias: 'ci-verification', root: 'verification/testing/ci', scripts: ['test', 'validate'] },
])

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function repositoryPath(absolutePath) {
  return relative(repositoryRoot, absolutePath).replaceAll('\\', '/')
}

function parseVersion(name) {
  const match = VERSION.exec(name)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

async function readPackageDescriptor(packageRoot) {
  let descriptor
  try {
    descriptor = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'is missing package.json' : `has an invalid package.json: ${error.message}`
    throw new Error(`${repositoryPath(packageRoot)} ${reason}`)
  }
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new Error(`${repositoryPath(packageRoot)} package.json must contain an object`)
  }
  return descriptor
}

async function walkFiles(root, directory = root) {
  const output = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return output
    throw error
  }
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    if (entry.isDirectory() && entry.name === 'node_modules') continue
    const child = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`${repositoryPath(child)}: symlinks are forbidden in test discovery`)
    if (entry.isDirectory()) output.push(...await walkFiles(root, child))
    else if (entry.isFile()) output.push(repositoryPath(child))
  }
  return output
}

export async function discoverNodeTestFiles(packageRoot) {
  return (await walkFiles(resolve(packageRoot, 'tests'))).filter((file) => NODE_TEST.test(file)).sort(compareText)
}

function isSealedArtifact(path) {
  return path.endsWith('.json') && (
    path.includes('/manifests/')
    || path.includes('/receipts/')
    || path.includes('/validation/')
    || /(?:^|\/)(?:package[_-]manifest|validation[_-](?:receipt|report)|[^/]*receipt)[^/]*\.json$/u.test(path)
  )
}

export async function snapshotSealedArtifacts() {
  const files = []
  for (const root of sealedArtifactRoots) files.push(...await walkFiles(resolve(repositoryRoot, root)))
  const snapshot = new Map()
  for (const file of [...new Set(files.filter(isSealedArtifact))].sort(compareText)) {
    const bytes = await readFile(resolve(repositoryRoot, file))
    snapshot.set(file, crypto.createHash('sha256').update(bytes).digest('hex'))
  }
  return snapshot
}

export function diffSealedArtifactSnapshots(before, after) {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort(compareText)
  return paths.filter((path) => before.get(path) !== after.get(path))
}

function assertSafeScript(descriptor, scriptName) {
  const command = descriptor.scripts?.[scriptName]
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new Error(`${descriptor.path}: missing ${scriptName} script`)
  }
  for (const hook of [`pre${scriptName}`, `post${scriptName}`]) {
    if (descriptor.scripts?.[hook] !== undefined) throw new Error(`${descriptor.path}: hidden npm lifecycle hook ${hook} is forbidden`)
  }
  const nodeTestCommand = /(?:^|\s)node(?:\.exe)?\s+--test(?:\s|$)/u.test(command)
    || /(?:^|\s)node(?:\.exe)?\s+[^;&|]*\.test\.(?:cjs|js|mjs)(?:\s|$)/u.test(command)
  if (scriptName === 'test' && !nodeTestCommand) {
    throw new Error(`${descriptor.path}: test must execute a discovered Node test directly`)
  }
  const forbidden = [
    /(?:^|\s)--write(?:-|\s|$)/u,
    /(?:^|[\s:&|;])(?:curl|wget|scp|ssh)(?:\s|$)/u,
    /(?:^|[\s:&|;])(?:deploy|publish|push|apply)(?:\s|$)/u,
    /(?:^|[\s:&|;])npm\s+(?:install|ci)(?:\s|$)/u,
  ]
  if (forbidden.some((pattern) => pattern.test(command))) {
    throw new Error(`${descriptor.path}:${scriptName} is not a read-only offline command`)
  }
  return command
}

async function describePackage({ packageRoot, domain, versionName, requiredScripts }) {
  const descriptor = await readPackageDescriptor(packageRoot)
  const parsedVersion = parseVersion(versionName)
  const path = repositoryPath(packageRoot)
  const result = {
    domain,
    version: parsedVersion.join('.'),
    path,
    name: descriptor.name,
    private: descriptor.private,
    package_version: descriptor.version,
    scripts: descriptor.scripts ?? {},
    required_scripts: [...requiredScripts],
    node_test_files: await discoverNodeTestFiles(packageRoot),
  }
  if (result.private !== true) throw new Error(`${path}: contract and verification packages must remain private`)
  if (typeof result.name !== 'string' || result.name.length === 0) throw new Error(`${path}: package name is required`)
  if (result.package_version !== result.version) throw new Error(`${path}: package version must match ${versionName}`)
  for (const script of requiredScripts) assertSafeScript(result, script)
  if (result.node_test_files.length === 0) throw new Error(`${path}: no Node test files discovered`)
  return result
}

async function versionDirectories(root, { major } = {}) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${repositoryPath(root)}: package root is missing`)
    throw error
  }
  const malformed = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('v') && !VERSION.test(entry.name))
  if (malformed.length > 0) throw new Error(`${repositoryPath(root)}: malformed version directories: ${malformed.map((entry) => entry.name).join(', ')}`)
  return entries
    .filter((entry) => entry.isDirectory() && VERSION.test(entry.name))
    .map((entry) => ({ entry, parsed: parseVersion(entry.name) }))
    .filter(({ parsed }) => major === undefined || parsed[0] === major)
    .sort((left, right) => compareVersions(left.parsed, right.parsed))
}

export async function discoverContractPackages() {
  const domainEntries = (await readdir(contractsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => compareText(left.name, right.name))
  const packages = []
  for (const domain of domainEntries) {
    const domainRoot = resolve(contractsRoot, domain.name)
    const versions = await versionDirectories(domainRoot)
    for (const { entry: version } of versions) {
      packages.push(await describePackage({
        packageRoot: resolve(domainRoot, version.name),
        domain: domain.name,
        versionName: version.name,
        requiredScripts: ['test', 'validate'],
      }))
    }
  }
  if (packages.length === 0) throw new Error('No versioned contract packages discovered')
  const keys = packages.map((item) => `${item.domain}@${item.version}`)
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate contract domain/version package')
  if (new Set(packages.map((item) => item.name)).size !== packages.length) throw new Error('Duplicate contract npm package name')
  return packages.sort((left, right) => compareText(left.path, right.path))
}

async function discoverVersionedRoots(parentRoot) {
  const roots = []
  const domains = (await readdir(parentRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => compareText(left.name, right.name))
  for (const domain of domains) {
    const domainRoot = resolve(parentRoot, domain.name)
    for (const { entry: version } of await versionDirectories(domainRoot)) roots.push(resolve(domainRoot, version.name))
  }
  return roots
}

export async function discoverWorkspacePackages() {
  const packageDescriptors = (await walkFiles(resolve(repositoryRoot, 'packages')))
    .filter((file) => file.endsWith('/package.json'))
  const roots = [
    resolve(repositoryRoot, 'apps/web'),
    ...packageDescriptors.map((file) => dirname(resolve(repositoryRoot, file))),
  ]
  roots.push(...await discoverVersionedRoots(resolve(repositoryRoot, 'contracts')))
  roots.push(...await discoverVersionedRoots(resolve(repositoryRoot, 'evaluation')))
  roots.push(...await discoverVersionedRoots(resolve(repositoryRoot, 'verification')))
  for (const { entry: version } of await versionDirectories(resolve(repositoryRoot, 'docs/feedback'))) roots.push(resolve(repositoryRoot, 'docs/feedback', version.name))
  roots.push(...await discoverVersionedRoots(resolve(repositoryRoot, 'verification/testing')))

  const packages = []
  for (const root of [...new Set(roots.map((item) => resolve(item)))].sort(compareText)) {
    let descriptor
    try {
      descriptor = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw new Error(`${repositoryPath(root)} has an invalid workspace package.json: ${error.message}`)
    }
    if (typeof descriptor.name !== 'string' || descriptor.name.length === 0) throw new Error(`${repositoryPath(root)}: workspace package name is required`)
    packages.push({ path: repositoryPath(root), name: descriptor.name, version: descriptor.version, private: descriptor.private })
  }
  const duplicates = packages.filter((item, index) => packages.findIndex((candidate) => candidate.name === item.name) !== index)
  if (duplicates.length > 0) throw new Error(`Duplicate workspace package names: ${[...new Set(duplicates.map((item) => item.name))].join(', ')}`)
  return packages
}

async function discoverLatestSuite(definition) {
  const root = resolve(repositoryRoot, definition.root)
  const versions = await versionDirectories(root, { major: definition.major })
  if (versions.length === 0) throw new Error(`${definition.root}: no compatible versioned package discovered`)
  const selected = versions.at(-1).entry
  return {
    alias: definition.alias,
    ...await describePackage({
      packageRoot: resolve(root, selected.name),
      domain: definition.alias,
      versionName: selected.name,
      requiredScripts: definition.scripts,
    }),
  }
}

export async function discoverVerificationSuites() {
  const suites = []
  for (const definition of verificationSuiteDefinitions) suites.push(await discoverLatestSuite(definition))
  if (new Set(suites.map((suite) => suite.path)).size !== suites.length) throw new Error('Verification suite package paths overlap')
  return suites
}

export function parseNodeTestCount(output) {
  const matches = [...String(output).matchAll(/^(?:#\s*|ℹ\s*)tests\s+(\d+)\s*$/gmu)]
  if (matches.length === 0) return 0
  return Number(matches.at(-1)[1])
}

export function assertSuccessfulChildExecution(execution, label) {
  if (execution.signal) throw new Error(`${label}: terminated by ${execution.signal}`)
  const hasNumericStatus = Number.isInteger(execution.status)
  if (hasNumericStatus && execution.status !== 0) throw new Error(`${label}: exit ${execution.status}`)
  if (execution.error && !(execution.error.code === 'EPERM' && execution.status === 0)) {
    throw new Error(`${label}: ${execution.error.message}`)
  }
  if (!hasNumericStatus) throw new Error(`${label}: child process returned no numeric exit status`)
}

function offlineEnvironment() {
  const environment = {}
  for (const name of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (process.env[name] !== undefined) environment[name] = process.env[name]
  }
  return {
    ...environment,
    CI: '1',
    TZ: 'UTC',
    NO_COLOR: '1',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_OFFLINE: 'true',
    NPM_CONFIG_USERCONFIG: process.platform === 'win32' ? 'NUL' : '/dev/null',
    USHSO_LIVE_SOURCE_REQUESTS: 'forbidden',
    USHSO_ALLOW_LIVE_SOURCE_REQUESTS: '0',
    USHSO_NETWORK_POLICY: 'authoritative-sources-forbidden',
    USHSO_ALLOW_RECEIPT_WRITES: '0',
    USHSO_RECEIPT_MODE: 'verify-only',
  }
}

function spawnWithBoundedFileCapture(command, arguments_, options) {
  const captureRoot = mkdtempSync(join(tmpdir(), 'ushso-contract-suite-'))
  const stdoutPath = resolve(captureRoot, 'stdout.log')
  const stderrPath = resolve(captureRoot, 'stderr.log')
  let stdoutFd
  let stderrFd
  let execution
  try {
    try {
      stdoutFd = openSync(stdoutPath, 'wx', 0o600)
      stderrFd = openSync(stderrPath, 'wx', 0o600)
      execution = spawnSync(command, arguments_, {
        ...options,
        encoding: undefined,
        stdio: ['ignore', stdoutFd, stderrFd],
      })
    } finally {
      if (stdoutFd !== undefined) closeSync(stdoutFd)
      if (stderrFd !== undefined) closeSync(stderrFd)
    }
    const outputBytes = statSync(stdoutPath).size + statSync(stderrPath).size
    if (outputBytes > MAX_CHILD_OUTPUT_BYTES) throw new Error(`child output exceeded ${MAX_CHILD_OUTPUT_BYTES} bytes`)
    return {
      ...execution,
      stdout: readFileSync(stdoutPath, 'utf8'),
      stderr: readFileSync(stderrPath, 'utf8'),
    }
  } finally {
    rmSync(captureRoot, { recursive: true, force: true })
  }
}

function executePackageScript(descriptor, scriptName) {
  assertSafeScript(descriptor, scriptName)
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const execution = spawnWithBoundedFileCapture(npmCommand, ['run', scriptName, '--prefix', descriptor.path], {
    cwd: repositoryRoot,
    env: offlineEnvironment(),
    timeout: CHILD_TIMEOUT_MS,
    windowsHide: true,
  })
  if (execution.stdout) process.stdout.write(execution.stdout)
  if (execution.stderr) process.stderr.write(execution.stderr)
  assertSuccessfulChildExecution(execution, `${descriptor.path}:${scriptName}`)
  const parsedTestCount = scriptName === 'test' ? parseNodeTestCount(`${execution.stdout ?? ''}\n${execution.stderr ?? ''}`) : null
  if (scriptName === 'test' && parsedTestCount <= 0) throw new Error(`${descriptor.path}: Node test output reported zero parsed tests`)
  return { script: scriptName, status: 'PASS', parsed_test_count: parsedTestCount }
}

export async function runPackageSuites(descriptors) {
  const results = []
  const failures = []
  for (const descriptor of descriptors) {
    const executions = []
    for (const script of descriptor.required_scripts) {
      console.log(`\n[verify] ${descriptor.path} :: ${script}`)
      const sealedBefore = await snapshotSealedArtifacts()
      let executionResult
      let executionError
      try {
        executionResult = executePackageScript(descriptor, script)
      } catch (error) {
        executionError = error
      }
      const sealedAfter = await snapshotSealedArtifacts()
      const changedArtifacts = diffSealedArtifactSnapshots(sealedBefore, sealedAfter)
      if (changedArtifacts.length > 0) {
        const mutationError = new Error(`${descriptor.path}:${script}: sealed artifacts changed: ${changedArtifacts.join(', ')}`)
        executionError = executionError ?? mutationError
      }
      if (executionError) {
        failures.push(executionError.message)
        executions.push({ script, status: 'FAIL', error: executionError.message, parsed_test_count: 0 })
      } else {
        executions.push(executionResult)
      }
    }
    results.push({ path: descriptor.path, executions })
  }
  return { ok: failures.length === 0, package_count: descriptors.length, results, failures }
}

function parseCliArguments(argv) {
  const options = { mode: null, suites: [], format: 'text' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--contracts') options.mode = 'contracts'
    else if (value === '--verification') options.mode = 'verification'
    else if (value === '--all') options.mode = 'all'
    else if (value === '--list') options.format = 'list'
    else if (value === '--json') options.format = 'json'
    else if (value === '--suite') {
      const alias = argv[index + 1]
      if (!alias || alias.startsWith('--')) throw new Error('--suite requires an alias')
      options.suites.push(alias)
      index += 1
    } else throw new Error(`Unknown argument: ${value}`)
  }
  if (options.suites.length > 0 && options.mode) throw new Error('--suite cannot be combined with a mode flag')
  if (options.suites.length === 0 && !options.mode) options.mode = 'contracts'
  return options
}

async function selectPackages(options) {
  const contracts = options.mode === 'contracts' || options.mode === 'all' ? await discoverContractPackages() : []
  const allVerification = options.mode === 'verification' || options.mode === 'all' || options.suites.length > 0
    ? await discoverVerificationSuites()
    : []
  let verification = allVerification
  if (options.suites.length > 0) {
    const requested = new Set(options.suites)
    verification = allVerification.filter((suite) => requested.has(suite.alias))
    const missing = [...requested].filter((alias) => !verification.some((suite) => suite.alias === alias))
    if (missing.length > 0) throw new Error(`Unknown verification suites: ${missing.join(', ')}`)
  }
  return [...contracts, ...verification]
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  try {
    const options = parseCliArguments(process.argv.slice(2))
    const descriptors = await selectPackages(options)
    if (options.format === 'json') {
      console.log(JSON.stringify(descriptors, null, 2))
    } else if (options.format === 'list') {
      console.log(descriptors.map((item) => item.path).join('\n'))
    } else {
      const result = await runPackageSuites(descriptors)
      if (!result.ok) {
        console.error(`\nVerification failures:\n${result.failures.join('\n')}`)
        process.exitCode = 1
      } else {
        console.log(`\nVerified ${result.package_count} package suites with live authoritative-source requests forbidden.`)
      }
    }
  } catch (error) {
    console.error(`Verification discovery failed closed: ${error.message}`)
    process.exitCode = 1
  }
}
