import crypto from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStrictJson } from '../../../contracts/tooling/v1.0.0/tools/strict-json.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(moduleDirectory, '../../..');

const IMPLEMENTED = 'implemented_local';
const PENDING_DATABASE = 'pending_database';
const PENDING_LIVE = 'pending_live';
const PENDING_HUMAN = 'pending_human';
const PENDING_AUTHORIZATION = 'pending_authorization';

export const STRATEGY_CONFIGS = Object.freeze({
  contracts: Object.freeze({
    section: '22.1',
    controlIds: Object.freeze(['T22.1-01', 'T22.1-02', 'T22.1-03', 'T22.1-04', 'T22.1-05', 'T22.1-06']),
    statuses: Object.freeze([IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED]),
    scopes: Object.freeze(['contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture']),
    releaseBlockers: Object.freeze([
      'database:semantic-referential-integration',
      'live:public-runtime-contract-conformance',
      'authorization:AUTH-12'
    ])
  }),
  connectors: Object.freeze({
    section: '22.2',
    controlIds: Object.freeze(['T22.2-01', 'T22.2-02', 'T22.2-03', 'T22.2-04', 'T22.2-05', 'T22.2-06', 'T22.2-07', 'T22.2-08']),
    statuses: Object.freeze([IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, PENDING_AUTHORIZATION, PENDING_AUTHORIZATION]),
    scopes: Object.freeze(['local_unit', 'local_integration', 'local_integration', 'local_integration', 'local_integration', 'local_integration', 'external_gate_record', 'external_gate_record']),
    releaseBlockers: Object.freeze([
      'authorization:AUTH-04',
      'live:metadata-smoke',
      'live:shadow-and-canary'
    ])
  }),
  'control-plane': Object.freeze({
    section: '22.3',
    controlIds: Object.freeze(['T22.3-01', 'T22.3-02', 'T22.3-03', 'T22.3-04', 'T22.3-05', 'T22.3-06', 'T22.3-07', 'T22.3-08', 'T22.3-09']),
    statuses: Object.freeze([PENDING_DATABASE, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, PENDING_LIVE, PENDING_AUTHORIZATION]),
    scopes: Object.freeze(['local_database_receipt', 'local_integration', 'local_integration', 'local_integration', 'local_integration', 'local_integration', 'local_integration', 'external_gate_record', 'external_gate_record']),
    releaseBlockers: Object.freeze([
      'database:managed-postgresql-integration',
      'authorization:AUTH-03',
      'authorization:AUTH-05',
      'live:backup-restore-and-outage-recovery'
    ])
  }),
  search: Object.freeze({
    section: '22.4',
    controlIds: Object.freeze(['T22.4-01', 'T22.4-02', 'T22.4-03', 'T22.4-04', 'T22.4-05', 'T22.4-06', 'T22.4-07', 'T22.4-08']),
    statuses: Object.freeze([IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, PENDING_DATABASE, PENDING_AUTHORIZATION, IMPLEMENTED, PENDING_LIVE, IMPLEMENTED]),
    scopes: Object.freeze(['local_unit', 'local_unit', 'local_unit', 'local_static', 'external_gate_record', 'local_unit', 'external_gate_record', 'local_unit']),
    releaseBlockers: Object.freeze([
      'database:migration-0010',
      'authorization:AUTH-13',
      'live:production-like-load'
    ])
  }),
  planner: Object.freeze({
    section: '22.5',
    controlIds: Object.freeze(['T22.5-01', 'T22.5-02', 'T22.5-03', 'T22.5-04', 'T22.5-05', 'T22.5-06', 'T22.5-07', 'T22.5-08', 'T22.5-09', 'T22.5-10', 'T22.5-11', 'T22.5-12', 'T22.5-13', 'T22.5-14', 'T22.5-15']),
    statuses: Object.freeze(Array.from({ length: 15 }, () => PENDING_AUTHORIZATION)),
    scopes: Object.freeze(['contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'local_integration', 'local_integration', 'contract_fixture']),
    releaseBlockers: Object.freeze([
      'authorization:AUTH-12',
      'human:planner-usefulness-study',
      'live:canonical-planner-runtime'
    ])
  }),
  web: Object.freeze({
    section: '22.6',
    controlIds: Object.freeze(['T22.6-01', 'T22.6-02', 'T22.6-03', 'T22.6-04', 'T22.6-05', 'T22.6-06', 'T22.6-07']),
    statuses: Object.freeze([PENDING_HUMAN, IMPLEMENTED, IMPLEMENTED, PENDING_HUMAN, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED]),
    scopes: Object.freeze(['local_unit', 'local_unit', 'local_unit', 'local_integration', 'local_integration', 'local_integration', 'local_integration']),
    releaseBlockers: Object.freeze([
      'human:researcher-task-study',
      'authorization:AUTH-06',
      'authorization:AUTH-07',
      'live:public-crawler-smoke'
    ])
  }),
  'machine-interfaces': Object.freeze({
    section: '22.7',
    controlIds: Object.freeze(['T22.7-01', 'T22.7-02', 'T22.7-03', 'T22.7-04', 'T22.7-05', 'T22.7-06', 'T22.7-07', 'T22.7-08', 'T22.7-09', 'T22.7-10', 'T22.7-11', 'T22.7-12', 'T22.7-13', 'T22.7-14', 'T22.7-15', 'T22.7-16', 'T22.7-17', 'T22.7-18']),
    statuses: Object.freeze([IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, PENDING_LIVE, PENDING_AUTHORIZATION, PENDING_AUTHORIZATION, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, IMPLEMENTED, PENDING_LIVE, IMPLEMENTED, PENDING_LIVE]),
    scopes: Object.freeze(['contract_fixture', 'local_integration', 'local_integration', 'local_integration', 'local_static', 'local_integration', 'local_integration', 'external_gate_record', 'external_gate_record', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'contract_fixture', 'local_integration', 'local_integration', 'local_integration', 'contract_fixture', 'external_gate_record']),
    releaseBlockers: Object.freeze([
      'authorization:AUTH-06',
      'authorization:AUTH-07',
      'authorization:AUTH-12',
      'live:public-interface-conformance'
    ])
  })
});

const ROOT_KEYS = Object.freeze(['schema_version', 'strategy_key', 'plan_section', 'structural_status', 'release_readiness', 'release_blockers', 'execution_policy', 'controls']);
const CONTROL_KEYS = Object.freeze(['id', 'statement', 'evidence_status', 'evidence_scope', 'evidence']);
const EVIDENCE_KEYS = Object.freeze(['kind', 'path', 'sha256']);
const POLICY_KEYS = Object.freeze(['offline', 'repository_writes', 'receipt_writes', 'network_calls', 'external_actions']);
const EVIDENCE_KINDS = new Set(['test', 'fixture', 'schema', 'receipt']);
const EVIDENCE_STATUSES = new Set([IMPLEMENTED, PENDING_DATABASE, PENDING_LIVE, PENDING_HUMAN, PENDING_AUTHORIZATION]);
const EVIDENCE_SCOPES = new Set(['contract_fixture', 'local_unit', 'local_integration', 'local_static', 'local_database_receipt', 'external_gate_record']);
const ALLOWED_EVIDENCE_PREFIXES = new Set(['apps', 'contracts', 'docs', 'evaluation', 'packages', 'verification', 'worker']);
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}

function assertExactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
}

function assertExactArray(actual, expected, code) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) fail(code);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizedPlanBullets(markdown, section) {
  const heading = `### ${section}`;
  const start = markdown.indexOf(heading);
  if (start < 0 || (start > 0 && markdown[start - 1] !== '\n')) fail('PLAN_SECTION_MISSING', section);
  const afterHeading = markdown.indexOf('\n', start);
  const nextHeading = markdown.indexOf('\n### ', afterHeading + 1);
  const lines = markdown.slice(afterHeading + 1, nextHeading < 0 ? markdown.length : nextHeading).split(/\r?\n/u);
  const bullets = [];
  for (const line of lines) {
    if (line.startsWith('- ')) bullets.push(line.slice(2).trim());
    else if (/^  \S/u.test(line) && bullets.length > 0) bullets[bullets.length - 1] += ` ${line.trim()}`;
    else if (line.trim() !== '' && bullets.length > 0) fail('PLAN_BULLET_SHAPE_UNSUPPORTED', section);
  }
  if (bullets.length === 0) fail('PLAN_BULLETS_MISSING', section);
  return bullets;
}

export function parseStrategyManifestText(text) {
  return parseStrictJson(text, { maxBytes: 512 * 1024, maxDepth: 32, maxNodes: 10_000, maxStringCodeUnits: 8_192 });
}

export async function loadStrategyManifest(strategyKey) {
  if (!Object.hasOwn(STRATEGY_CONFIGS, strategyKey)) fail('STRATEGY_KEY_UNKNOWN', strategyKey);
  const manifestPath = path.join(repositoryRoot, 'verification', 'testing', strategyKey, 'v1.0.0', 'strategy-evidence.json');
  return parseStrategyManifestText(await readFile(manifestPath, 'utf8'));
}

function assertSafeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length < 3 || relativePath.length > 320) fail('EVIDENCE_PATH_INVALID');
  if (relativePath.includes('\\') || relativePath.includes('\0') || path.posix.isAbsolute(relativePath)) fail('EVIDENCE_PATH_UNSAFE', relativePath);
  const segments = relativePath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) fail('EVIDENCE_PATH_UNSAFE', relativePath);
  if (!ALLOWED_EVIDENCE_PREFIXES.has(segments[0])) fail('EVIDENCE_PATH_PREFIX_FORBIDDEN', relativePath);
  const resolved = path.resolve(repositoryRoot, ...segments);
  if (resolved === repositoryRoot || !resolved.startsWith(`${repositoryRoot}${path.sep}`)) fail('EVIDENCE_PATH_ESCAPE', relativePath);
  return { resolved, segments };
}

async function validateEvidencePath(row) {
  assertExactKeys(row, EVIDENCE_KEYS, 'EVIDENCE_KEYS_INVALID');
  if (!EVIDENCE_KINDS.has(row.kind)) fail('EVIDENCE_KIND_INVALID', row.kind);
  if (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha256)) fail('EVIDENCE_HASH_INVALID', row.path);
  const { resolved, segments } = assertSafeRelativePath(row.path);
  let cursor = repositoryRoot;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    let stats;
    try {
      stats = await lstat(cursor);
    } catch {
      fail('EVIDENCE_PATH_MISSING', row.path);
    }
    if (stats.isSymbolicLink()) fail('EVIDENCE_SYMLINK_FORBIDDEN', row.path);
  }
  const stats = await lstat(resolved);
  if (!stats.isFile()) fail('EVIDENCE_NOT_FILE', row.path);
  if (stats.size === 0 || stats.size > MAX_EVIDENCE_BYTES) fail('EVIDENCE_FILE_SIZE_INVALID', row.path);
  const rootReal = await realpath(repositoryRoot);
  const evidenceReal = await realpath(resolved);
  if (!evidenceReal.startsWith(`${rootReal}${path.sep}`)) fail('EVIDENCE_REALPATH_ESCAPE', row.path);
  const kindShape = {
    test: /(?:^|\/)(?:tests?|[^/]+\.test\.)/u,
    fixture: /(?:^|\/)fixtures?(?:\/|$)/u,
    schema: /(?:^|\/)schemas?(?:\/|$)/u,
    receipt: /(?:^|\/)(?:receipts?|validation)(?:\/|$)/u
  };
  if (!kindShape[row.kind].test(row.path)) fail('EVIDENCE_KIND_PATH_MISMATCH', row.path);
  const actual = sha256(await readFile(resolved));
  if (actual !== row.sha256) fail('EVIDENCE_HASH_STALE', row.path);
}

export async function validateManifestDocument(manifest, strategyKey, { verifyEvidence = true } = {}) {
  const config = STRATEGY_CONFIGS[strategyKey];
  if (!config) fail('STRATEGY_KEY_UNKNOWN', strategyKey);
  assertExactKeys(manifest, ROOT_KEYS, 'MANIFEST_KEYS_INVALID');
  if (manifest.schema_version !== 'ushso-test-strategy-evidence.v1.0.0') fail('MANIFEST_SCHEMA_VERSION_INVALID');
  if (manifest.strategy_key !== strategyKey) fail('MANIFEST_STRATEGY_KEY_MISMATCH');
  if (manifest.plan_section !== `§${config.section}`) fail('MANIFEST_PLAN_SECTION_MISMATCH');
  if (manifest.structural_status !== 'PASS') fail('STRUCTURAL_STATUS_MUST_PASS');
  if (manifest.release_readiness !== 'BLOCKED') fail('FALSE_RELEASE_READINESS');
  assertExactArray(manifest.release_blockers, config.releaseBlockers, 'RELEASE_BLOCKERS_MISMATCH');
  if (new Set(manifest.release_blockers).size !== manifest.release_blockers.length) fail('RELEASE_BLOCKER_DUPLICATE');
  for (const blocker of manifest.release_blockers) {
    if (!/^(?:database|live|human|authorization):[A-Za-z0-9][A-Za-z0-9._-]{1,95}$/u.test(blocker)) fail('RELEASE_BLOCKER_UNBOUNDED', blocker);
  }
  assertExactKeys(manifest.execution_policy, POLICY_KEYS, 'EXECUTION_POLICY_KEYS_INVALID');
  if (manifest.execution_policy.offline !== true) fail('OFFLINE_POLICY_REQUIRED');
  for (const key of ['repository_writes', 'receipt_writes', 'network_calls', 'external_actions']) {
    if (manifest.execution_policy[key] !== 0) fail(`${key.toUpperCase()}_MUST_BE_ZERO`);
  }

  if (!Array.isArray(manifest.controls) || manifest.controls.length !== config.controlIds.length) fail('CONTROL_COUNT_MISMATCH');
  const ids = manifest.controls.map((control) => control?.id);
  if (new Set(ids).size !== ids.length) fail('CONTROL_ID_DUPLICATE');
  assertExactArray(ids, config.controlIds, 'CONTROL_IDS_MISMATCH');

  const planText = await readFile(path.join(repositoryRoot, 'docs', 'RESEARCH_NAVIGATOR_IMPLEMENTATION_PLAN.md'), 'utf8');
  const bullets = normalizedPlanBullets(planText, config.section);
  if (bullets.length !== config.controlIds.length) fail('PLAN_CONTROL_COUNT_MISMATCH', config.section);

  for (let index = 0; index < manifest.controls.length; index += 1) {
    const control = manifest.controls[index];
    assertExactKeys(control, CONTROL_KEYS, 'CONTROL_KEYS_INVALID');
    if (control.statement !== bullets[index]) fail('CONTROL_STATEMENT_MISMATCH', control.id);
    if (typeof control.statement !== 'string' || control.statement.length < 15 || control.statement.length > 600 || /[\r\n]/u.test(control.statement)) fail('CONTROL_STATEMENT_UNBOUNDED', control.id);
    if (/\b(?:etc\.?|as needed|where applicable|representative subset|best effort)\b/iu.test(control.statement)) fail('CONTROL_STATEMENT_EVASIVE', control.id);
    if (!EVIDENCE_STATUSES.has(control.evidence_status) || control.evidence_status !== config.statuses[index]) fail('CONTROL_EVIDENCE_STATUS_MISMATCH', control.id);
    if (!EVIDENCE_SCOPES.has(control.evidence_scope) || control.evidence_scope !== config.scopes[index]) fail('CONTROL_EVIDENCE_SCOPE_MISMATCH', control.id);
    if (!Array.isArray(control.evidence) || control.evidence.length < 1 || control.evidence.length > 4) fail('CONTROL_EVIDENCE_CARDINALITY', control.id);
    const paths = control.evidence.map((row) => row?.path);
    if (new Set(paths).size !== paths.length) fail('CONTROL_EVIDENCE_DUPLICATE', control.id);
    if (verifyEvidence) {
      for (const row of control.evidence) await validateEvidencePath(row);
    }
  }
  return Object.freeze({
    status: 'PASS',
    strategy_key: strategyKey,
    plan_section: `§${config.section}`,
    control_count: manifest.controls.length,
    structural_status: 'PASS',
    release_readiness: 'BLOCKED',
    release_blocker_count: manifest.release_blockers.length,
    external_actions: 0
  });
}

async function recursiveFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) fail('PACKAGE_SYMLINK_FORBIDDEN', target);
    if (entry.isDirectory()) files.push(...await recursiveFiles(target));
    else if (entry.isFile()) files.push(target);
    else fail('PACKAGE_SPECIAL_FILE_FORBIDDEN', target);
  }
  return files;
}

function auditReadOnlySource(source, sourcePath, allowedLocalImports) {
  const label = path.relative(repositoryRoot, sourcePath);
  const allowedNodeImports = new Set(['node:assert/strict', 'node:crypto', 'node:fs/promises', 'node:path', 'node:test', 'node:url']);
  for (const match of source.matchAll(/\b(?:from\s+|import\s*)['"]([^'"]+)['"]/gu)) {
    const specifier = match[1];
    if (specifier.startsWith('node:') && !allowedNodeImports.has(specifier)) fail('SOURCE_IMPORT_FORBIDDEN', `${label}:${specifier}`);
    else if (specifier.startsWith('.')) {
      const resolved = path.resolve(path.dirname(sourcePath), specifier);
      if (!allowedLocalImports.has(resolved)) fail('SOURCE_LOCAL_IMPORT_FORBIDDEN', `${label}:${specifier}`);
    } else if (!specifier.startsWith('node:')) fail('SOURCE_PACKAGE_IMPORT_FORBIDDEN', `${label}:${specifier}`);
  }
  if (/\bimport\s*\(/u.test(source) || /\brequire\s*\(/u.test(source)) fail('SOURCE_DYNAMIC_LOAD_FORBIDDEN', label);
  const forbiddenCalls = ['appendFile', 'appendFileSync', 'chmod', 'chown', 'createWriteStream', 'execFile', 'fork', 'link', 'mkdir', 'mkdtemp', 'rename', 'rm', 'rmdir', 'spawn', 'symlink', 'truncate', 'unlink', 'writeFile', 'writeFileSync'];
  for (const call of forbiddenCalls) {
    if (new RegExp(`\\b${call}\\s*\\(`, 'u').test(source)) fail('SOURCE_MUTATION_OR_PROCESS_API_FORBIDDEN', `${label}:${call}`);
  }
  const networkCalls = ['fetch', 'WebSocket', 'XMLHttpRequest'];
  for (const call of networkCalls) {
    if (new RegExp(`\\b${call}\\s*\\(`, 'u').test(source)) fail('SOURCE_NETWORK_API_FORBIDDEN', `${label}:${call}`);
  }
  if (/\bprocess\s*\.\s*(?:binding|dlopen|kill)\s*\(/u.test(source)) fail('SOURCE_PROCESS_ESCAPE_FORBIDDEN', label);
}

async function validatePackageBoundary(strategyKey) {
  const packageRoot = path.join(repositoryRoot, 'verification', 'testing', strategyKey, 'v1.0.0');
  const packageJson = parseStrategyManifestText(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  assertExactKeys(packageJson, ['name', 'version', 'private', 'type', 'description', 'engines', 'scripts'], 'PACKAGE_JSON_KEYS_INVALID');
  if (packageJson.name !== `@ushso/testing-${strategyKey}-evidence` || packageJson.version !== '1.0.0' || packageJson.private !== true || packageJson.type !== 'module') fail('PACKAGE_IDENTITY_INVALID');
  assertExactKeys(packageJson.engines, ['node'], 'PACKAGE_ENGINES_INVALID');
  if (packageJson.engines.node !== '>=22.12.0') fail('PACKAGE_NODE_VERSION_INVALID');
  assertExactKeys(packageJson.scripts, ['test', 'validate'], 'PACKAGE_SCRIPTS_INVALID');
  if (packageJson.scripts.test !== 'node --test tests/*.test.mjs' || packageJson.scripts.validate !== 'node tools/validate-package.mjs') fail('PACKAGE_SCRIPT_NOT_DIRECT_READ_ONLY');

  const files = await recursiveFiles(packageRoot);
  if (files.some((file) => /(?:^|[\\/])receipts?(?:[\\/]|$)/u.test(file))) fail('PACKAGE_RECEIPT_PATH_FORBIDDEN');
  const sharedFiles = ['strategy-evidence.mjs', 'strategy-evidence-test-kit.mjs'].map((file) => path.join(moduleDirectory, file));
  const strictJsonFile = path.join(repositoryRoot, 'contracts', 'tooling', 'v1.0.0', 'tools', 'strict-json.mjs');
  const sourceFiles = [...files.filter((file) => file.endsWith('.mjs')), ...sharedFiles, strictJsonFile];
  const allowedLocalImports = new Set(sourceFiles.map((file) => path.resolve(file)));
  for (const file of sourceFiles) auditReadOnlySource(await readFile(file, 'utf8'), file, allowedLocalImports);
  return packageRoot;
}

export async function validateStrategyPackage(strategyKey) {
  await validatePackageBoundary(strategyKey);
  return validateManifestDocument(await loadStrategyManifest(strategyKey), strategyKey);
}

export async function runStrategyCli(strategyKey, moduleUrl) {
  if (!process.argv[1] || path.resolve(process.argv[1]) !== fileURLToPath(moduleUrl)) return;
  const summary = await validateStrategyPackage(strategyKey);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
