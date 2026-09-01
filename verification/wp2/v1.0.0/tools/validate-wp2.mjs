import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKAGE_ROOT,
  PROJECT_ROOT,
  canonicalSha256,
  pathExists,
  readJson,
  sha256Bytes,
  sha256File,
  sleep,
  walkFiles,
  writeJson
} from './common.mjs';
import { auditAllPackages } from './package-audit.mjs';
import { auditSchemas, validateReceiptSchema } from './schema-audit.mjs';
import { auditCrossContractSemantics, auditEvaluatorFreeze } from './cross-contract-audit.mjs';
import { runPublicCommands } from './command-runner.mjs';

const STABILIZATION_SAMPLES = 3;
const STABILIZATION_INTERVAL_MS = 500;

async function samplePackageJsonStability(registry) {
  const hashes = new Map(registry.packages.map(item => [item.package_id, {
    packageJson: [],
    manifest: [],
    receipt: []
  }]));
  const hashIfPresent = async file => await pathExists(file) ? await sha256File(file) : 'MISSING';
  for (let sample = 0; sample < STABILIZATION_SAMPLES; sample += 1) {
    for (const packageDefinition of registry.packages) {
      const packageRoot = path.join(PROJECT_ROOT, packageDefinition.path);
      const packageHashes = hashes.get(packageDefinition.package_id);
      packageHashes.packageJson.push(await hashIfPresent(path.join(packageRoot, 'package.json')));
      packageHashes.manifest.push(await hashIfPresent(path.join(packageRoot, packageDefinition.manifest_path)));
      packageHashes.receipt.push(await hashIfPresent(path.join(packageRoot, packageDefinition.receipt_path)));
    }
    if (sample < STABILIZATION_SAMPLES - 1) await sleep(STABILIZATION_INTERVAL_MS);
  }
  const packages = registry.packages.map(item => {
    const packageHashes = hashes.get(item.package_id);
    const allPresent = [...packageHashes.packageJson, ...packageHashes.manifest, ...packageHashes.receipt]
      .every(hash => hash !== 'MISSING');
    const stable = allPresent
      && new Set(packageHashes.packageJson).size === 1
      && new Set(packageHashes.manifest).size === 1
      && new Set(packageHashes.receipt).size === 1;
    return {
      package_id: item.package_id,
      package_json_hashes: packageHashes.packageJson,
      manifest_hashes: packageHashes.manifest,
      receipt_hashes: packageHashes.receipt,
      all_release_artifacts_present: allPresent,
      stable
    };
  });
  return {
    sample_count: STABILIZATION_SAMPLES,
    interval_ms: STABILIZATION_INTERVAL_MS,
    stable: packages.every(item => item.stable),
    packages
  };
}

async function verifySelfManifest() {
  const errors = [];
  const manifestPath = path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json');
  if (!await pathExists(manifestPath)) return { errors: ['WP2_VERIFICATION_MANIFEST_MISSING'], sha256: null };
  const manifest = await readJson(manifestPath);
  const excluded = new Set(['manifests/package-manifest.json', 'validation/validation-receipt.json']);
  const physical = (await walkFiles(PACKAGE_ROOT)).filter(file => !excluded.has(file));
  if (manifest.file_count !== manifest.files?.length || manifest.files?.length !== physical.length) errors.push('WP2_VERIFICATION_MANIFEST_COUNT_MISMATCH');
  if (JSON.stringify(manifest.files?.map(file => file.path)) !== JSON.stringify(physical)) errors.push('WP2_VERIFICATION_MANIFEST_FILE_SET_MISMATCH');
  let payloadBytes = 0;
  for (const entry of manifest.files ?? []) {
    const absolute = path.join(PACKAGE_ROOT, entry.path);
    if (!await pathExists(absolute)) { errors.push(`WP2_VERIFICATION_MANIFEST_FILE_MISSING:${entry.path}`); continue; }
    const bytes = await fs.readFile(absolute);
    payloadBytes += bytes.length;
    if (entry.bytes !== bytes.length || entry.sha256 !== sha256Bytes(bytes)) errors.push(`WP2_VERIFICATION_MANIFEST_FILE_MISMATCH:${entry.path}`);
  }
  if (manifest.payload_bytes !== payloadBytes) errors.push('WP2_VERIFICATION_MANIFEST_PAYLOAD_MISMATCH');
  return { errors, sha256: await sha256File(manifestPath) };
}

function registryErrors(registry) {
  const errors = [];
  if (registry.required_package_count !== 10 || registry.packages.length !== 10) errors.push(`WP2_PACKAGE_COUNT_INVALID:${registry.packages.length}`);
  for (const key of ['package_id', 'path', 'expected_name']) {
    if (new Set(registry.packages.map(item => item[key])).size !== registry.packages.length) errors.push(`WP2_PACKAGE_REGISTRY_DUPLICATE:${key}`);
  }
  return errors;
}

export async function validateWp2() {
  const registryPath = path.join(PACKAGE_ROOT, 'contracts', 'package-registry.json');
  const [registry, probe] = await Promise.all([
    readJson(registryPath),
    readJson(path.join(PACKAGE_ROOT, 'fixtures', 'unexpected-property-probe.json'))
  ]);
  const errors = registryErrors(registry);
  const stabilization = await samplePackageJsonStability(registry);
  if (!stabilization.stable) errors.push('WP2_RELEASE_ARTIFACTS_NOT_PRESENT_OR_STABLE');
  const selfManifest = await verifySelfManifest();
  errors.push(...selfManifest.errors);

  const packageAudit = await auditAllPackages(registry);
  errors.push(...packageAudit.errors);
  const schemaAudit = await auditSchemas(registry, probe);
  errors.push(...schemaAudit.errors);
  const crossContract = await auditCrossContractSemantics();
  errors.push(...crossContract.errors);
  const evaluatorFreeze = await auditEvaluatorFreeze();
  errors.push(...evaluatorFreeze.errors);

  if (errors.length > 0) {
    return {
      receipt: null,
      preliminary_failure: {
        receipt_version: 'ushso-wp2-aggregate-verification.v1.0.0',
        generated_at: new Date().toISOString(),
        status: 'FAIL',
        errors: [...new Set(errors)].sort()
      }
    };
  }

  const commands = await runPublicCommands(registry);
  errors.push(...commands.errors);
  const packageResults = [];
  for (const packageDefinition of registry.packages) {
    const staticResult = packageAudit.results.find(item => item.package_id === packageDefinition.package_id);
    const schemaResult = schemaAudit.packageResults.get(packageDefinition.package_id);
    const commandResults = commands.commandResults.get(packageDefinition.package_id);
    const sourceIntegrity = commands.sourceIntegrity.get(packageDefinition.package_id);
    const packageErrors = [
      ...staticResult.errors,
      ...schemaAudit.errors.filter(error => error.includes(`:${packageDefinition.package_id}:`) || error.endsWith(`:${packageDefinition.package_id}`)),
      ...commands.errors.filter(error => error.includes(`:${packageDefinition.package_id}:`) || error.endsWith(`:${packageDefinition.package_id}`))
    ];
    const passed = packageErrors.length === 0
      && schemaResult.schema_count === schemaResult.compiled_schema_count
      && schemaResult.root_object_schema_count === schemaResult.unexpected_property_probe_count
      && commandResults.every(result => result.passed)
      && sourceIntegrity.tree_unchanged
      && sourceIntegrity.receipts_unchanged;
    packageResults.push({
      ...staticResult,
      source_tree_sha256: sourceIntegrity.tree_sha256_before,
      schema_count: schemaResult.schema_count,
      compiled_schema_count: schemaResult.compiled_schema_count,
      root_object_schema_count: schemaResult.root_object_schema_count,
      unexpected_property_probe_count: schemaResult.unexpected_property_probe_count,
      schema_ids_sha256: canonicalSha256(schemaResult.schema_ids_sha256_material),
      commands: commandResults,
      source_integrity: sourceIntegrity,
      status: passed ? 'PASS' : 'FAIL',
      errors: [...new Set(packageErrors)].sort()
    });
  }
  const aggregate = {
    schema_count: packageResults.reduce((sum, item) => sum + item.schema_count, 0),
    compiled_schema_count: packageResults.reduce((sum, item) => sum + item.compiled_schema_count, 0),
    root_object_schema_count: packageResults.reduce((sum, item) => sum + item.root_object_schema_count, 0),
    unexpected_property_probes_rejected: packageResults.reduce((sum, item) => sum + item.unexpected_property_probe_count, 0),
    test_file_count: packageResults.reduce((sum, item) => sum + item.test_file_count, 0),
    declared_test_case_count: packageResults.reduce((sum, item) => sum + item.declared_test_case_count, 0),
    public_command_count: packageResults.reduce((sum, item) => sum + item.commands.length, 0),
    public_commands_passed: packageResults.flatMap(item => item.commands).filter(item => item.passed).length,
    sealed_artifact_commands_read_only: packageResults.flatMap(item => item.commands).filter(item => item.sealed_artifacts_unchanged).length,
    node_tests_reported: packageResults.reduce((sum, item) => sum + (item.commands.find(command => command.script === 'test')?.node_test_count ?? 0), 0),
    manifest_entry_count: packageResults.reduce((sum, item) => sum + item.manifest_entry_count, 0),
    zero_action_assertion_count: packageResults.reduce((sum, item) => sum + item.zero_action_assertion_count, 0)
  };
  const sourcePackagesMutated = packageResults.filter(item => !item.source_integrity.tree_unchanged).length;
  const sourceReceiptsMutated = packageResults.filter(item => !item.source_integrity.receipts_unchanged).length;
  const mirrorSealedArtifactMutations = packageResults.flatMap(item => item.commands).filter(item => !item.sealed_artifacts_unchanged).length
    + (commands.mirrorSealedArtifactsGloballyUnchanged ? 0 : 1);
  const pass = errors.length === 0
    && packageResults.every(item => item.status === 'PASS')
    && aggregate.public_commands_passed === 20
    && aggregate.sealed_artifact_commands_read_only === 20
    && crossContract.passed
    && evaluatorFreeze.passed
    && sourcePackagesMutated === 0
    && sourceReceiptsMutated === 0
    && commands.mirrorSealedArtifactsGloballyUnchanged
    && mirrorSealedArtifactMutations === 0;
  const receipt = {
    receipt_version: 'ushso-wp2-aggregate-verification.v1.0.0',
    generated_at: new Date().toISOString(),
    status: pass ? 'PASS' : 'FAIL',
    wp2_gate_pass: pass,
    package_registry_sha256: await sha256File(registryPath),
    verification_package_manifest_sha256: selfManifest.sha256,
    stabilization,
    required_package_count: registry.packages.length,
    packages: packageResults,
    aggregate,
    cross_contract: crossContract,
    evaluator_freeze: evaluatorFreeze,
    execution_boundary: {
      external_requests: 0,
      paid_actions: 0,
      source_packages_mutated: sourcePackagesMutated,
      source_receipts_mutated: sourceReceiptsMutated,
      sealed_artifact_mutations_in_temporary_mirror: mirrorSealedArtifactMutations,
      sealed_artifacts_globally_unchanged_in_temporary_mirror: commands.mirrorSealedArtifactsGloballyUnchanged,
      commands_executed_in_temporary_mirror: true
    },
    errors: [...new Set(errors)].sort()
  };
  const schemaValidation = await validateReceiptSchema(receipt);
  if (!schemaValidation.valid) {
    return {
      receipt: null,
      preliminary_failure: {
        receipt_version: 'ushso-wp2-aggregate-verification.v1.0.0',
        generated_at: new Date().toISOString(),
        status: 'FAIL',
        errors: schemaValidation.errors.map(error => `AGGREGATE_RECEIPT_SCHEMA:${error.instancePath || '/'}:${error.message}`)
      }
    };
  }
  return { receipt, preliminary_failure: null };
}

async function main() {
  const { receipt, preliminary_failure: failure } = await validateWp2();
  const output = receipt ?? failure;
  if (receipt && process.argv.includes('--write-receipt')) await writeJson(path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json'), receipt);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!receipt || receipt.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
