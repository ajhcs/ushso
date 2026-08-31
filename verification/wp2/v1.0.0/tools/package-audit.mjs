import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PROJECT_ROOT,
  canonicalJson,
  pathExists,
  readJson,
  sha256Bytes,
  sha256File,
  walkFiles
} from './common.mjs';

function manifestEntrySha256(entry) {
  const candidates = [
    entry.sha256,
    entry.file_sha256,
    entry.raw_file_sha256,
    entry.byte_sha256,
    entry.byte_digest?.value
  ];
  return candidates.find(value => typeof value === 'string') ?? null;
}

function manifestEntries(manifest) {
  if (Array.isArray(manifest?.files)) return { key: 'files', entries: manifest.files };
  if (Array.isArray(manifest?.artifacts)) return { key: 'artifacts', entries: manifest.artifacts };
  return { key: null, entries: [] };
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, output);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      output.push(key);
      collectStrings(item, output);
    }
  }
  return output;
}

const ZERO_OR_FALSE_KEYS = new Set([
  'external_requests',
  'external_request_count',
  'source_payload_downloads',
  'source_payloads_accessed',
  'payload_downloads',
  'analyses_executed',
  'analysis_executed',
  'analysis_execution',
  'database_writes',
  'publication_pointer_writes',
  'network_requests',
  'source_requests_made',
  'retrieval_executed',
  'payloads_acquired',
  'identity_merges',
  'identity_merges_performed',
  'ranking_optimization_performed',
  'ranking_optimization',
  'tuning_performed',
  'tuning_started',
  'llm_used',
  'llm_use',
  'source_payload_access',
  'identity_merge',
  'coverage_executions',
  'paid_actions',
  'execution_allowed',
  'authorization_present'
]);

function collectBoundaryAssertions(value, jsonPath = '', assertions = [], violations = []) {
  if (!value || typeof value !== 'object') return { assertions, violations };
  for (const [key, item] of Object.entries(value)) {
    const current = `${jsonPath}/${key}`;
    if (ZERO_OR_FALSE_KEYS.has(key)) {
      const safe = item === 0 || item === false;
      assertions.push({ path: current, value: item, safe });
      if (!safe) violations.push(`${current}=${JSON.stringify(item)}`);
    }
    if (item && typeof item === 'object') collectBoundaryAssertions(item, current, assertions, violations);
  }
  return { assertions, violations };
}

function receiptPasses(receipt) {
  if ('valid' in receipt && receipt.valid !== true) return false;
  if ('status' in receipt && !['PASS', 'pass'].includes(receipt.status)) return false;
  if (Array.isArray(receipt.errors) && receipt.errors.length !== 0) return false;
  if ('failed_count' in receipt && receipt.failed_count !== 0) return false;
  return true;
}

const ZERO_ACTION_ATTESTATIONS = new Set([
  'NO_ANALYSIS_OR_PAYLOADS',
  'NO_EXTERNAL_ACTIONS',
  'ZERO_ACTION_BOUNDARY',
  'truth_boundary_zero_action'
]);

function hasExplicitZeroActionAttestation(receipt) {
  const assertions = [receipt?.validated_requirements, receipt?.checks]
    .filter(Array.isArray)
    .flat();
  return assertions.some(requirement => ZERO_ACTION_ATTESTATIONS.has(requirement));
}

function isSafeManifestPath(relative) {
  return typeof relative === 'string'
    && relative.length > 0
    && !path.isAbsolute(relative)
    && !relative.split('/').includes('..')
    && !relative.includes('\\');
}

export async function auditPackage(packageDefinition) {
  const errors = [];
  const packageRoot = path.join(PROJECT_ROOT, packageDefinition.path);
  const packageJsonPath = path.join(packageRoot, 'package.json');
  if (!await pathExists(packageJsonPath)) return { package_id: packageDefinition.package_id, errors: [`PACKAGE_JSON_MISSING:${packageDefinition.package_id}`] };
  const packageJson = await readJson(packageJsonPath);
  if (packageJson.name !== packageDefinition.expected_name) errors.push(`PACKAGE_NAME_MISMATCH:${packageDefinition.package_id}:${packageJson.name}`);
  if (packageJson.version !== packageDefinition.expected_version) errors.push(`PACKAGE_VERSION_MISMATCH:${packageDefinition.package_id}:${packageJson.version}`);
  for (const script of ['test', 'validate']) if (typeof packageJson.scripts?.[script] !== 'string' || packageJson.scripts[script].length === 0) errors.push(`PUBLIC_SCRIPT_MISSING:${packageDefinition.package_id}:${script}`);

  const manifestPath = path.join(packageRoot, packageDefinition.manifest_path);
  const receiptPath = path.join(packageRoot, packageDefinition.receipt_path);
  if (!await pathExists(manifestPath)) errors.push(`PACKAGE_MANIFEST_MISSING:${packageDefinition.package_id}`);
  if (!await pathExists(receiptPath)) errors.push(`PACKAGE_RECEIPT_MISSING:${packageDefinition.package_id}`);
  const manifest = await pathExists(manifestPath) ? await readJson(manifestPath) : null;
  const receipt = await pathExists(receiptPath) ? await readJson(receiptPath) : null;
  if (receipt && !receiptPasses(receipt)) errors.push(`PACKAGE_RECEIPT_NOT_PASSING:${packageDefinition.package_id}`);

  let manifestEntryCount = 0;
  let manifestPayloadBytes = 0;
  if (manifest) {
    const { key: entryKey, entries } = manifestEntries(manifest);
    if (entries.length === 0) errors.push(`PACKAGE_MANIFEST_FILES_EMPTY:${packageDefinition.package_id}`);
    else {
      manifestEntryCount = entries.length;
      if (new Set(entries.map(entry => entry.path)).size !== entries.length) errors.push(`PACKAGE_MANIFEST_DUPLICATE_PATH:${packageDefinition.package_id}`);
      for (const entry of entries) {
        if (!isSafeManifestPath(entry.path)) { errors.push(`PACKAGE_MANIFEST_UNSAFE_PATH:${packageDefinition.package_id}:${entry.path}`); continue; }
        const absolute = path.join(packageRoot, entry.path);
        if (!await pathExists(absolute)) { errors.push(`PACKAGE_MANIFEST_FILE_MISSING:${packageDefinition.package_id}:${entry.path}`); continue; }
        const bytes = await fs.readFile(absolute);
        manifestPayloadBytes += bytes.length;
        if (entry.bytes !== bytes.length) errors.push(`PACKAGE_MANIFEST_BYTE_MISMATCH:${packageDefinition.package_id}:${entry.path}`);
        const expectedDigest = manifestEntrySha256(entry);
        if (!expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest)) errors.push(`PACKAGE_MANIFEST_BYTE_DIGEST_MISSING:${packageDefinition.package_id}:${entry.path}`);
        else if (expectedDigest !== sha256Bytes(bytes)) errors.push(`PACKAGE_MANIFEST_BYTE_DIGEST_MISMATCH:${packageDefinition.package_id}:${entry.path}`);
      }
      if ('file_count' in manifest && manifest.file_count !== entries.length) errors.push(`PACKAGE_MANIFEST_COUNT_MISMATCH:${packageDefinition.package_id}`);
      if ('artifact_count' in manifest && manifest.artifact_count !== entries.length) errors.push(`PACKAGE_MANIFEST_COUNT_MISMATCH:${packageDefinition.package_id}`);
      if ('payload_bytes' in manifest && manifest.payload_bytes !== manifestPayloadBytes) errors.push(`PACKAGE_MANIFEST_PAYLOAD_BYTES_MISMATCH:${packageDefinition.package_id}:${manifest.payload_bytes}:${manifestPayloadBytes}`);
      if (!entries.some(entry => entry.path === 'package.json')) errors.push(`PACKAGE_JSON_NOT_MANIFESTED:${packageDefinition.package_id}`);
      if (entryKey === 'artifacts' && manifest.artifact_hash_kind !== 'raw_file_bytes') errors.push(`PACKAGE_MANIFEST_ARTIFACT_HASH_KIND_INVALID:${packageDefinition.package_id}`);
    }
  }

  let digestTaxonomyVerified = false;
  if (manifest && packageDefinition.digest_mode === 'contract_taxonomy') {
    const externalTaxonomy = path.join(packageRoot, 'contracts', 'digest-taxonomy.json');
    const digestMaterial = await pathExists(externalTaxonomy)
      ? { taxonomy: await readJson(externalTaxonomy), package_manifest: manifest }
      : manifest;
    const strings = collectStrings(digestMaterial).map(value => value.toLowerCase());
    const digestLabels = [...new Set(strings.filter(value => value.includes('sha256') || value.includes('sha-256')))];
    const hasSha256 = digestLabels.length > 0;
    const hasCanonical = strings.some(value => value.includes('canonical'));
    const hasExactBytes = strings.some(value => value.includes('exact') || value.includes('byte_') || value.includes('byte ') || value.includes('raw_file'));
    digestTaxonomyVerified = hasSha256 && hasCanonical && hasExactBytes;
    if (!digestTaxonomyVerified) errors.push(`DIGEST_TAXONOMY_INCOMPLETE:${packageDefinition.package_id}`);
  } else if (manifest && packageDefinition.digest_mode === 'exact-pin-manifest') {
    digestTaxonomyVerified = manifestEntries(manifest).entries.every(entry => /^[a-f0-9]{64}$/.test(manifestEntrySha256(entry) ?? ''));
    if (!digestTaxonomyVerified) errors.push(`EXACT_PIN_MANIFEST_INCOMPLETE:${packageDefinition.package_id}`);
  }

  const boundary = collectBoundaryAssertions({ manifest, receipt });
  const offlineBoundary = packageDefinition.boundary_mode === 'offline-boundary-check'
    && receipt?.offline === true
    && Array.isArray(receipt?.checks)
    && receipt.checks.some(check => /metadata-only|no-analysis|boundary/.test(check));
  const explicitBoundaryAttestation = hasExplicitZeroActionAttestation(receipt);
  if (boundary.violations.length > 0) errors.push(...boundary.violations.map(item => `ZERO_ACTION_BOUNDARY_VIOLATION:${packageDefinition.package_id}:${item}`));
  if (boundary.assertions.length === 0 && !offlineBoundary && !explicitBoundaryAttestation) errors.push(`ZERO_ACTION_BOUNDARY_UNATTESTED:${packageDefinition.package_id}`);

  const files = await walkFiles(packageRoot);
  const testFiles = files.filter(relative => /(^|\/)tests\/.*\.(?:test|spec)\.(?:mjs|js|cjs)$/.test(relative));
  let declaredTestCaseCount = 0;
  for (const relative of testFiles) {
    const text = await fs.readFile(path.join(packageRoot, relative), 'utf8');
    declaredTestCaseCount += (text.match(/\b(?:test|it)\s*\(/g) ?? []).length;
  }
  if (testFiles.length === 0) errors.push(`TEST_FILE_SET_EMPTY:${packageDefinition.package_id}`);
  if (declaredTestCaseCount === 0) errors.push(`DECLARED_TEST_CASE_COUNT_ZERO:${packageDefinition.package_id}`);

  return {
    package_id: packageDefinition.package_id,
    path: packageDefinition.path,
    name: packageJson.name,
    version: packageJson.version,
    package_json_sha256: await sha256File(packageJsonPath),
    manifest_path: packageDefinition.manifest_path,
    manifest_sha256: manifest ? await sha256File(manifestPath) : null,
    manifest_entry_count: manifestEntryCount,
    manifest_payload_bytes: manifestPayloadBytes,
    receipt_path: packageDefinition.receipt_path,
    receipt_sha256: receipt ? await sha256File(receiptPath) : null,
    digest_taxonomy_verified: digestTaxonomyVerified,
    zero_action_assertion_count: boundary.assertions.length + (offlineBoundary ? 1 : 0) + (explicitBoundaryAttestation ? 1 : 0),
    test_file_count: testFiles.length,
    declared_test_case_count: declaredTestCaseCount,
    public_scripts: {
      test: packageJson.scripts?.test ?? null,
      validate: packageJson.scripts?.validate ?? null
    },
    errors
  };
}

export async function auditAllPackages(registry) {
  const results = [];
  for (const packageDefinition of registry.packages) results.push(await auditPackage(packageDefinition));
  return { results, errors: results.flatMap(result => result.errors) };
}
