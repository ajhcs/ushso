import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY_ROOT, ROOT, canonicalJson, exists, readJson, sha256File, writeAtomic } from './common.mjs';
import { packageDigest, packageFileRows } from './build-manifest.mjs';
import { auditPublicSchemaBounds } from './bounds-audit.mjs';
import { loadSchemas, schemaErrors } from './schema.mjs';
import { runAdversarialCases, validateConformanceBundle, validateToolkitManifest } from './semantic-validator.mjs';

const IDS = Object.freeze({
  manifest: 'https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas/toolkit-manifest.schema.json',
  digest: 'https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas/digest-taxonomy.schema.json',
  dependency: 'https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas/dependency-pin.schema.json',
  fixtures: 'https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas/fixture-bundle.schema.json',
  adversarial: 'https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas/adversarial-cases.schema.json',
  packageManifest: 'https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas/package-manifest.schema.json',
  receipt: 'https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas/validation-receipt.schema.json'
});

const CHECKS = Object.freeze([
  'draft_2020_12_schema_compilation',
  'strict_public_schema_bounds',
  'nine_capability_manifest',
  'legacy_alias_disabled_pending_audit',
  'input_and_output_byte_caps',
  'cardinality_limits',
  'response_schema_conformance',
  'json_api_webmcp_parity',
  'snapshot_digest_integrity',
  'generation_and_cursor_pinning',
  'evidence_resolution',
  'typed_unknown_and_unavailable',
  'truth_boundary_zero_action',
  'credential_and_locator_redaction',
  'source_payload_prohibition',
  'analysis_prohibition',
  'safety_atomic_failure',
  'coverage_absence_invariant',
  'planner_gate_invariant',
  'error_privacy',
  'rate_limit_envelope',
  'research_plan_dependency_pin',
  'adversarial_fail_closed'
]);

function validateDocument(ajv, id, data, label) {
  const validate = ajv.getSchema(id);
  if (!validate) return [{ code: 'SCHEMA_VALIDATOR_MISSING', path: label, message: id }];
  return validate(data) ? [] : schemaErrors(validate, label);
}

export async function validatePackage() {
  const { ajv, localRows, dependencyRows } = await loadSchemas();
  const toolkitManifest = await readJson(path.join(ROOT, 'contracts', 'toolkit-manifest.json'));
  const digestTaxonomy = await readJson(path.join(ROOT, 'contracts', 'digest-taxonomy.json'));
  const dependencyPin = await readJson(path.join(ROOT, 'contracts', 'dependency-pin.json'));
  const fixtures = await readJson(path.join(ROOT, 'fixtures', 'conformance.json'));
  const adversarial = await readJson(path.join(ROOT, 'fixtures', 'adversarial-cases.json'));
  const packageManifest = await readJson(path.join(ROOT, 'contracts', 'package-manifest.json'));
  const issues = [];

  issues.push(...validateDocument(ajv, IDS.manifest, toolkitManifest, '/contracts/toolkit-manifest.json'));
  issues.push(...validateDocument(ajv, IDS.digest, digestTaxonomy, '/contracts/digest-taxonomy.json'));
  issues.push(...validateDocument(ajv, IDS.dependency, dependencyPin, '/contracts/dependency-pin.json'));
  issues.push(...validateDocument(ajv, IDS.fixtures, fixtures, '/fixtures/conformance.json'));
  issues.push(...validateDocument(ajv, IDS.adversarial, adversarial, '/fixtures/adversarial-cases.json'));
  issues.push(...validateDocument(ajv, IDS.packageManifest, packageManifest, '/contracts/package-manifest.json'));
  issues.push(...validateToolkitManifest(toolkitManifest));

  const bounds = auditPublicSchemaBounds(localRows);
  issues.push(...bounds.findings);
  issues.push(...validateConformanceBundle(fixtures, toolkitManifest, ajv));
  const adversarialReceipts = runAdversarialCases(adversarial, fixtures, toolkitManifest, ajv);
  for (const row of adversarialReceipts) if (!row.rejected) issues.push({ code: 'ADVERSARIAL_CASE_NOT_REJECTED', path: `/fixtures/adversarial-cases/${row.case_id}`, message: `${row.expected_failure_code}; found ${row.finding_codes.join(',')}` });

  const dependencyPath = path.join(REPOSITORY_ROOT, dependencyPin.schema_path);
  const actualDependencySha = await sha256File(dependencyPath);
  if (actualDependencySha !== dependencyPin.schema_file_sha256) issues.push({ code: 'DEPENDENCY_PIN_MISMATCH', path: '/contracts/dependency-pin.json/schema_file_sha256', message: `${dependencyPin.schema_file_sha256} != ${actualDependencySha}` });

  const actualFiles = await packageFileRows();
  if (canonicalJson(actualFiles) !== canonicalJson(packageManifest.files)) issues.push({ code: 'PACKAGE_FILE_MANIFEST_MISMATCH', path: '/contracts/package-manifest.json/files', message: 'Run npm run manifest after every package change.' });
  const actualPackageDigest = packageDigest(actualFiles);
  if (actualPackageDigest !== packageManifest.package_content_digest) issues.push({ code: 'PACKAGE_CONTENT_DIGEST_MISMATCH', path: '/contracts/package-manifest.json/package_content_digest', message: `${packageManifest.package_content_digest} != ${actualPackageDigest}` });

  const receiptPath = path.join(ROOT, 'receipts', 'validation.json');
  if (await exists(receiptPath)) {
    const priorReceipt = await readJson(receiptPath);
    issues.push(...validateDocument(ajv, IDS.receipt, priorReceipt, '/receipts/validation.json'));
    if (priorReceipt.validated_package_content_digest !== packageManifest.package_content_digest) issues.push({ code: 'VALIDATION_RECEIPT_STALE', path: '/receipts/validation.json/validated_package_content_digest', message: 'Regenerate the validation receipt.' });
  }

  const counts = {
    local_schemas: localRows.length,
    dependency_schemas: dependencyRows.length,
    tools: toolkitManifest.tools.length,
    conformance_cases: fixtures.conformance_cases.length,
    adversarial_cases: adversarial.cases.length,
    semantic_checks: fixtures.conformance_cases.length * 3 + fixtures.gate_cases.length + fixtures.legacy_compatibility_cases.length + adversarial.cases.length,
    parity_cases: fixtures.conformance_cases.length,
    bound_findings: bounds.findings.length,
    validation_errors: issues.length
  };
  return { ok: issues.length === 0, issues, counts, packageManifest, dependencyPin, checks: [...CHECKS], adversarialReceipts };
}

export function createReceipt(result) {
  if (!result.ok) throw new Error('VALIDATION_RECEIPT_REQUIRES_PASS');
  return {
    contract_version: 'observatory-machine-toolkit-validation-receipt.v1.0.0',
    status: 'pass',
    validated_package_content_digest: result.packageManifest.package_content_digest,
    dependency_schema_file_sha256: result.dependencyPin.schema_file_sha256,
    commands: ['npm run build:fixtures', 'npm run manifest', 'npm test', 'npm run validate'],
    counts: result.counts,
    checks: result.checks
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let result = await validatePackage();
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify({ status: 'failed', counts: result.counts, issues: result.issues }, null, 2)}\n`);
    process.exitCode = 1;
  } else if (process.argv.includes('--write-receipt')) {
    const receipt = createReceipt(result);
    await writeAtomic(path.join(ROOT, 'receipts', 'validation.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    result = await validatePackage();
    if (!result.ok) {
      process.stderr.write(`${JSON.stringify({ status: 'failed_after_receipt', counts: result.counts, issues: result.issues }, null, 2)}\n`);
      process.exitCode = 1;
    } else process.stdout.write(`${JSON.stringify({ status: 'pass', receipt: 'receipts/validation.json', counts: result.counts, package_content_digest: result.packageManifest.package_content_digest })}\n`);
  } else process.stdout.write(`${JSON.stringify({ status: 'pass', counts: result.counts, package_content_digest: result.packageManifest.package_content_digest })}\n`);
}
