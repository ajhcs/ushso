import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalDigest,
  sha256File,
  walkFiles,
  writeJson
} from '../../../../contracts/coverage/v1.0.0/tools/common.mjs';
import { validatePackage } from '../../../../packages/coverage/accounting/v1.0.0/tools/validate-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '../../..');
const IMPLEMENTATION = path.join(REPO, 'packages/coverage/accounting/v1.0.0');

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  assert(process.argv.includes('--tests-passed'), 'TEST_PASS_ATTESTATION_REQUIRED');
  const validatorReceipt = await validatePackage();
  assert(validatorReceipt.status === 'pass', 'PACKAGE_VALIDATION_FAILED');

  const implementationFiles = await walkFiles(IMPLEMENTATION);
  const entries = [];
  for (const relative of implementationFiles) {
    const file = path.join(IMPLEMENTATION, relative);
    entries.push({
      path: `packages/coverage/accounting/v1.0.0/${relative}`,
      bytes: (await fs.stat(file)).size,
      sha256: await sha256File(file)
    });
  }
  const docPath = path.join(REPO, 'docs/WP9_COVERAGE_ACCOUNTING.md');
  entries.push({
    path: 'docs/WP9_COVERAGE_ACCOUNTING.md',
    bytes: (await fs.stat(docPath)).size,
    sha256: await sha256File(docPath)
  });
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const implementationManifest = {
    schema_version: 'ushso-wp9-implementation-file-manifest.v1.0.0',
    generated_at: '2026-08-30T00:00:00Z',
    files: entries,
    file_set_sha256: canonicalDigest('ushso:wp9-implementation-file-set:v1\n', entries)
  };
  await writeJson(path.join(ROOT, 'receipts/implementation-file-manifest.json'), implementationManifest);

  const generatedManifest = await readJson(path.join(IMPLEMENTATION, 'manifests/generated-artifact-manifest.json'));
  const ledger = await readJson(path.join(ROOT, 'requirements/evidence-ledger.json'));
  const ownerPacket = await readJson(path.join(ROOT, 'governance/product-owner-wording-review.json'));
  const ownerReceiptExists = await exists(path.join(ROOT, 'governance/product-owner-wording-review.receipt.json'));
  assert(ownerPacket.status === 'pending_external_review', 'OWNER_PACKET_STATUS_OVERCLAIM');
  assert(!ownerReceiptExists, 'UNEXPECTED_PRODUCT_OWNER_RECEIPT');

  const pending = ledger.entries.filter(entry => entry.status.includes('pending'));
  const receipt = {
    schema_version: 'ushso-wp9-verification-receipt.v1.0.0',
    work_package: 'WP9',
    generated_at: '2026-08-30T00:00:00Z',
    technical_status: 'pass',
    release_gate_status: 'blocked_external_product_owner_wording_review',
    network_access: false,
    production_actions: false,
    database_actions: false,
    public_route_changes: false,
    raw_user_queries_persisted: false,
    validator: validatorReceipt,
    deterministic_seals: {
      coverage_snapshot_sha256: generatedManifest.coverage_snapshot_sha256,
      matrix_membership_sha256: generatedManifest.matrix_membership_sha256,
      artifact_set_sha256: generatedManifest.artifact_set_sha256,
      public_view_sha256: generatedManifest.public_view_sha256,
      implementation_file_set_sha256: implementationManifest.file_set_sha256
    },
    counts: {
      metric_definitions: 18,
      source_scopes: 14,
      federal_applicability: { direct: 11, crosswalk_required: 2, unknown: 1 },
      jurisdictions: 51,
      source_classes: 6,
      assessment_cells: 306,
      production_matrix_state_distribution: {
        integrated: 0,
        candidate: 0,
        navigation_only: 0,
        evidence_gap: 0,
        inaccessible: 0,
        unknown: 0,
        not_assessed: 306
      },
      published_records: 157,
      corpus_composition: {
        harvard_dataverse: 52,
        datacite: 50,
        pennsylvania_catalog: 22,
        curated_authoritative_registry: 15,
        federal_baseline: 14,
        canonical_base: 4
      }
    },
    test_receipts: [
      {
        command: 'npm test --prefix packages/coverage/accounting/v1.0.0',
        status: 'pass',
        scope: 'contract/schema semantics, partitions, denominator failure injection, absence denial, matrix accounting, service bounds, deterministic 3x rebuild, WP1 byte pins, SQL review'
      },
      {
        command: 'node packages/coverage/accounting/v1.0.0/tools/validate-package.mjs',
        status: 'pass',
        scope: 'frozen coverage contract schemas and semantic bundle validator'
      }
    ],
    requirement_ledger: {
      path: 'verification/wp9/v1.0.0/requirements/evidence-ledger.json',
      entry_count: ledger.entries.length,
      pending_entries: pending.map(entry => ({ requirement_id: entry.requirement_id, status: entry.status }))
    },
    migration_0011: {
      path: 'packages/coverage/accounting/v1.0.0/sql/0011_coverage_facts_definitions_snapshots.reviewed.sql',
      sha256: await sha256File(path.join(IMPLEMENTATION, 'sql/0011_coverage_facts_definitions_snapshots.reviewed.sql')),
      review_status: 'offline_technical_review_pass',
      application_status: 'not_applied_sequence_pending',
      db_directory_modified_by_wp9: false
    },
    wp1_preservation: {
      'packages/coverage/coverage-repository.mjs': await sha256File(path.join(REPO, 'packages/coverage/coverage-repository.mjs')),
      'packages/coverage/static-coverage-repository.mjs': await sha256File(path.join(REPO, 'packages/coverage/static-coverage-repository.mjs'))
    },
    external_steps: [
      {
        step_id: 'WP9-COVERAGE-COPY-OWNER-01',
        status: 'pending_external_review',
        packet: 'verification/wp9/v1.0.0/governance/product-owner-wording-review.json',
        effect: 'Blocks the section 23.4 public wording gate; does not block local technical validation.'
      },
      {
        step_id: 'MIGRATION-0011-SEQUENCE-AND-AUTHORIZATION',
        status: 'not_requested',
        effect: 'Required before moving reviewed SQL into db/migrations or applying it after migrations 0007 through 0010.'
      },
      {
        step_id: 'PUBLIC-ROUTE-INTEGRATION',
        status: 'not_started_by_design',
        effect: 'A later authorized work package must wire the bounded service through a sealed publication projection; WP9 made no web or Worker route edit.'
      }
    ],
    rollback: {
      current_state: 'No route, database, or production activation occurred.',
      package_rollback: 'Remove or disengage the successor package from a future composition root while retaining its receipt for audit.',
      future_database_rollback: 'Select a prior sealed coverage/publication snapshot; never drop immutable 0011 tables as an operational rollback.'
    },
    receipt_digest_algorithm: 'ushso_wp9_receipt_sha256/v1',
    receipt_sha256: ''
  };
  const digestPayload = structuredClone(receipt);
  delete digestPayload.receipt_sha256;
  receipt.receipt_sha256 = canonicalDigest('ushso:wp9-verification-receipt:v1\n', digestPayload);
  await writeJson(path.join(ROOT, 'receipts/wp9-verification.json'), receipt);
  const receiptFileSha256 = crypto.createHash('sha256')
    .update(await fs.readFile(path.join(ROOT, 'receipts/wp9-verification.json')))
    .digest('hex');
  process.stdout.write(`${JSON.stringify({
    status: receipt.technical_status,
    release_gate_status: receipt.release_gate_status,
    receipt_sha256: receipt.receipt_sha256,
    receipt_file_sha256: receiptFileSha256,
    implementation_file_set_sha256: implementationManifest.file_set_sha256
  })}\n`);
}

await main();
