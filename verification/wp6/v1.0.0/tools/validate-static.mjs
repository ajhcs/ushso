#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { verifyMigrations } from '../../../../db/tools/verify-migrations.mjs';
import { repositoryRoot } from '../../../../db/tools/common.mjs';
import { validateNormalizationPackage } from '../../../../packages/normalization/tools/validate-package.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrations = await verifyMigrations({});
assert.equal(migrations.files.length >= 7, true);
assert.equal(migrations.files.find(row => row.id === '0001').byte_sha256, '7cd5d8cf2fbdb5a87d9344ad5218329c3d793b093ba674ffd00c4660c491a1f6');
assert.deepEqual(migrations.files.slice(0, 7).map(row => row.id), ['0001', '0002', '0003', '0004', '0005', '0006', '0007']);

const receipt = await validateNormalizationPackage();
assert.equal(receipt.status, 'pass', JSON.stringify(receipt.errors));
assert.equal(receipt.reconciliation.records_accepted, 157);
assert.equal(receipt.reconciliation.routes_accepted, 14);
assert.equal(receipt.identity_safety.automatic_merges, 0);

const migrationSql = await Promise.all(['0004_catalog_objects_identifiers_evidence.sql', '0005_assets_releases_distributions_documentation.sql', '0006_schema_snapshots_fields_access.sql', '0007_assertions_relationships_temporal_history.sql'].map(name => readFile(path.join(repositoryRoot, 'db/migrations', name), 'utf8')));
const joined = migrationSql.join('\n');
assert.match(joined, /security definer/iu);
assert.match(joined, /REJECTED_IMPORT_CANNOT_BE_REAPPLIED/u);
assert.match(joined, /zero_results_absence_claim_permitted/iu);
assert.match(joined, /DOCUMENT_FINGERPRINT_MISMATCH/u);
assert.match(joined, /NORMALIZATION_IMPORT_NOT_AUTHORIZED/u);
assert.match(joined, /COLLECTION_TYPE_MISMATCH/u);
assert.match(joined, /REFERENCE_TYPE_MISMATCH/u);
assert.match(joined, /EVIDENCE_DERIVATION_PARENT_MISSING/u);
assert.match(joined, /REVISION_SELECTION_AUDIT_MISMATCH/u);
assert.match(joined, /rejected_import_no_eligible_predecessor/u);
assert.doesNotMatch(joined, /drop\s+(?:table|schema)|truncate\s+/iu);

const evidenceLedger = JSON.parse(await readFile(path.join(packageRoot, 'requirements/evidence-ledger.json'), 'utf8'));
const evidenceLedgerSchema = JSON.parse(await readFile(path.join(packageRoot, 'schemas/evidence-ledger.schema.json'), 'utf8'));
const ajv = new Ajv2020({ strict: true, strictSchema: true, allErrors: true });
const validateEvidenceLedger = ajv.compile(evidenceLedgerSchema);
assert.equal(validateEvidenceLedger(evidenceLedger), true, JSON.stringify(validateEvidenceLedger.errors));
assert.equal(new Set(evidenceLedger.requirements.map(row => row.id)).size, evidenceLedger.requirements.length);
for (const requirement of evidenceLedger.requirements) {
  for (const relative of requirement.implementation_paths) await readFile(path.join(repositoryRoot, relative));
}

process.stdout.write(`${JSON.stringify({
  status: 'pass', offline: true, migration_count: migrations.files.length,
  normalization_receipt: { records: 157, routes: 14, automatic_merges: 0 },
  foundation_migration_0001_hash_preserved: true,
  evidence_ledger_requirements: evidenceLedger.requirements.length,
  external_requests: 0, payloads_acquired: 0, analyses_executed: 0,
  package_root: path.relative(repositoryRoot, packageRoot)
}, null, 2)}\n`);
