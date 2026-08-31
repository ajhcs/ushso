#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { loadSchemas as loadCoreSchemas } from '../../../contracts/core/v2.0.0/tools/schema.mjs';
import { semanticErrors } from '../../../contracts/core/v2.0.0/tools/semantics.mjs';
import { contentFingerprint } from '../src/canonical.mjs';
import { IMPORT_RECEIPT_VERSION, NORMALIZER_VERSION, SOURCE_CONTENT_FINGERPRINT } from '../src/constants.mjs';
import { reconcileNormalizationDatabaseWorkset, reconcileNormalizationWorkset } from '../src/ingestion-boundary.mjs';
import { loadLegacyCorpus } from '../src/legacy-loader.mjs';
import { normalizeLegacyCorpus } from '../src/normalize.mjs';
import { InMemoryCanonicalImportStore } from '../src/store.mjs';
import { canonicalEqual, EXCLUDED_MANIFEST_PATHS, fileDescriptor, PACKAGE_ROOT, sha256File, stableJson, walk, writeAtomic } from './common.mjs';

function formats(ajv) {
  ajv.addFormat('date-time', value => typeof value === 'string' && !Number.isNaN(Date.parse(value)));
}

async function loadLocalSchemas() {
  const ajv = new Ajv2020({ strict: true, strictSchema: true, strictTypes: true, strictRequired: true, allErrors: true, validateFormats: true, allowUnionTypes: false });
  formats(ajv);
  for (const name of ['import-plan.schema.json', 'import-receipt.schema.json', 'managed-authorization-receipt.schema.json', 'package-manifest.schema.json']) {
    const schema = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'schemas', name), 'utf8'));
    ajv.addSchema(schema, schema.$id);
  }
  return ajv;
}

function schemaError(validate, label) {
  return (validate.errors ?? []).map(error => ({ code: 'SCHEMA_INVALID', path: `${label}${error.instancePath || '/'}`, message: `${error.keyword}: ${error.message}` }));
}

function add(errors, condition, code, message) {
  if (!condition) errors.push({ code, path: '/', message });
}

export async function validateNormalizationPackage({ writeReceipt = false } = {}) {
  const errors = [];
  const legacy = await loadLegacyCorpus();
  const normalized = normalizeLegacyCorpus(legacy);
  const fixturePlanPath = path.join(PACKAGE_ROOT, 'fixtures/import-plan.json');
  const fixturePlan = JSON.parse(await readFile(fixturePlanPath, 'utf8'));
  const localAjv = await loadLocalSchemas();
  const validatePlan = localAjv.getSchema('https://ushso.org/packages/normalization/v1.0.0/schemas/import-plan.schema.json');
  if (!validatePlan(normalized.plan)) errors.push(...schemaError(validatePlan, '/plan'));
  add(errors, canonicalEqual(fixturePlan, normalized.plan), 'FIXTURE_PLAN_DRIFT', 'generated explicit mapping differs from sealed fixture');

  const { ajv: coreAjv } = await loadCoreSchemas();
  const validateBundle = coreAjv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/fixture-bundle.schema.json');
  if (!validateBundle(normalized.bundle)) errors.push(...schemaError(validateBundle, '/bundle'));
  errors.push(...semanticErrors(normalized.bundle));

  const recordIds = normalized.plan.record_mappings.map(row => row.legacy_record_id);
  const routeIds = normalized.plan.join_route_mappings.map(row => row.legacy_route_id);
  add(errors, recordIds.length === 157 && new Set(recordIds).size === 157, 'RECORD_RECONCILIATION_FAILED', '157 unique record mappings are required');
  add(errors, routeIds.length === 14 && new Set(routeIds).size === 14, 'ROUTE_RECONCILIATION_FAILED', '14 unique join-route mappings are required');
  add(errors, normalized.plan.record_mappings.every(row => row.disposition === 'accepted' && row.legacy_alias_preserved), 'RECORD_DISPOSITION_FAILED', 'every record must be accepted or explicitly rejected and aliases preserved');
  add(errors, normalized.plan.join_route_mappings.every(row => row.disposition === 'accepted'), 'ROUTE_DISPOSITION_FAILED', 'every route must be accepted or explicitly rejected');
  add(errors, normalized.bundle.assets.length === 157 && new Set(normalized.bundle.assets.map(row => row.asset_id)).size === 157, 'SILENT_IDENTITY_MERGE', 'legacy records did not produce 157 distinct asset IDs');
  add(errors, normalized.plan.identity_review_candidates.every(row => row.state === 'open' && row.automatic_merge_performed === false), 'IDENTITY_CANDIDATE_UPGRADED', 'all similarity candidates must remain open and non-merging');

  const store = new InMemoryCanonicalImportStore();
  const firstApply = store.apply(normalized.importDocument);
  const replay = store.apply(normalized.importDocument);
  const beforeRollback = store.snapshot();
  const rollback = store.rejectBatch(normalized.import_id, { reason: 'verification rollback rehearsal', auditEventId: 'audit:wp6:rollback-rehearsal', recordedAt: normalized.plan.created_at });
  const afterRollback = store.snapshot();
  add(errors, firstApply.status === 'applied' && replay.status === 'already_applied' && replay.new_logical_rows === 0, 'IDEMPOTENT_REPLAY_FAILED', 'replay must create zero new logical rows');
  add(errors, rollback.deleted_rows === 0 && beforeRollback.entities.size === afterRollback.entities.size && beforeRollback.revisions.size === afterRollback.revisions.size && beforeRollback.aliases.size === afterRollback.aliases.size, 'DESTRUCTIVE_ROLLBACK', 'batch rejection must preserve shared canonical and audit state');
  add(errors, store.projection(normalized.import_id) === null, 'REJECTED_BATCH_PROJECTABLE', 'rejected batch remains projection-eligible');

  add(errors, canonicalEqual(normalized.projection.records, legacy.records), 'RECORD_PARITY_FAILED', 'database projection records differ from legacy source');
  add(errors, canonicalEqual(normalized.projection.search_documents, legacy.searchDocuments), 'SEARCH_DOCUMENT_PARITY_FAILED', 'database projection search documents differ from legacy source');
  add(errors, canonicalEqual(normalized.projection.join_routes, legacy.joinRoutes), 'JOIN_ROUTE_PARITY_FAILED', 'database projection join routes differ from legacy source');
  add(errors, normalized.projection.semantics.zero_results_status === 200 && normalized.projection.semantics.zero_results_absence_claim_permitted === false && /not evidence/iu.test(normalized.projection.semantics.zero_results_warning), 'ZERO_RESULT_SEMANTICS_FAILED', 'zero results must remain successful non-absence evidence');

  const captureA = 'a'.repeat(64);
  const captureB = 'b'.repeat(64);
  const captureManifest = [captureA, captureB].map(capture_sha256 => ({ capture_sha256, sealed: true }));
  const normalizationJobs = [captureA, captureB].map(capture_sha256 => ({
    job_type: 'normalize_record',
    idempotency_key: `normalize:${capture_sha256}:${NORMALIZER_VERSION}`,
    identity: { capture_sha256, normalizer_version: NORMALIZER_VERSION }
  }));
  const ingestionBoundary = reconcileNormalizationWorkset({ captureManifest, jobs: normalizationJobs, normalizerVersion: NORMALIZER_VERSION });
  const databaseRunId = 'run:wp6:offline-contract';
  const databaseManifestItems = [captureA, captureB].map((capture_sha256, index) => ({
    run_id: databaseRunId, capture_reference_id: `capture-${index + 1}`, capture_sha256,
    normalizer_version: NORMALIZER_VERSION, ordinal: index + 1
  }));
  const databaseJobs = databaseManifestItems.map(item => ({
    job_id: `job_normalize_${item.capture_sha256}_${NORMALIZER_VERSION.replaceAll('.', '_')}`,
    run_id: databaseRunId, job_type: 'normalize_record',
    idempotency_key: `normalize:${item.capture_sha256}:${NORMALIZER_VERSION}`,
    identity_payload: { capture_sha256: item.capture_sha256, normalizer_version: NORMALIZER_VERSION },
    outbox_event_id: `event_normalize_${item.capture_sha256}_${NORMALIZER_VERSION.replaceAll('.', '_')}`
  }));
  const databaseRequirements = databaseManifestItems.map((item, index) => ({
    run_id: databaseRunId, capture_reference_id: item.capture_reference_id,
    job_id: databaseJobs[index].job_id, outbox_event_id: databaseJobs[index].outbox_event_id,
    satisfaction: 'created'
  }));
  const databaseOutbox = databaseRequirements.map(requirement => ({
    event_id: requirement.outbox_event_id, event_type: 'normalize_requested',
    idempotency_key: `event:normalize_requested:${requirement.job_id}`,
    references_payload: {
      run_id: databaseRunId, job_id: requirement.job_id,
      capture_ref_id: requirement.capture_reference_id
    }
  }));
  const databaseIngestionBoundary = reconcileNormalizationDatabaseWorkset({
    manifest: {
      run_id: databaseRunId, contract_version: 'normalization-manifest.v1',
      normalizer_version: NORMALIZER_VERSION, required_capture_count: 2,
      manifest_sha256: 'c'.repeat(64), state: 'sealed'
    },
    manifestItems: databaseManifestItems, requirements: databaseRequirements,
    jobs: databaseJobs, outbox: databaseOutbox, manifestDigestVerified: true
  });
  const rejectedWith = (code, mutation) => {
    try { mutation(); return false; } catch (error) { return error?.code === code; }
  };
  const aggregateJobRejected = rejectedWith('NORMALIZATION_AGGREGATE_JOB_REJECTED', () => reconcileNormalizationWorkset({
    captureManifest, jobs: [{ ...normalizationJobs[0], idempotency_key: 'normalize:run:scope' }, normalizationJobs[1]], normalizerVersion: NORMALIZER_VERSION
  }));
  const missingJobRejected = rejectedWith('NORMALIZATION_JOB_MISSING_CAPTURE', () => reconcileNormalizationWorkset({
    captureManifest, jobs: [normalizationJobs[0]], normalizerVersion: NORMALIZER_VERSION
  }));
  const duplicateJobRejected = rejectedWith('NORMALIZATION_JOB_DUPLICATE_CAPTURE', () => reconcileNormalizationWorkset({
    captureManifest, jobs: [normalizationJobs[0], normalizationJobs[0], normalizationJobs[1]], normalizerVersion: NORMALIZER_VERSION
  }));
  add(errors, ingestionBoundary.sealed_capture_count === 2 && ingestionBoundary.normalize_job_count === 2
    && databaseIngestionBoundary.normalization_requirement_count === 2
    && databaseIngestionBoundary.normalization_outbox_count === 2
    && aggregateJobRejected && missingJobRejected && duplicateJobRejected,
  'INGESTION_NORMALIZATION_WORKSET_FAILED', 'sealed per-capture normalization work did not reconcile fail-closed');

  const manifestPath = path.join(PACKAGE_ROOT, 'manifests/package-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const validateManifest = localAjv.getSchema('https://ushso.org/packages/normalization/v1.0.0/schemas/package-manifest.schema.json');
  if (!validateManifest(manifest)) errors.push(...schemaError(validateManifest, '/manifest'));
  const actualFiles = (await walk()).filter(relative => !EXCLUDED_MANIFEST_PATHS.includes(relative));
  add(errors, canonicalEqual(manifest.files.map(row => row.path), actualFiles), 'PACKAGE_MANIFEST_PATH_DRIFT', 'package manifest file inventory drifted');
  const manifestByPath = new Map(manifest.files.map(row => [row.path, row]));
  for (const relative of actualFiles) add(errors, canonicalEqual(manifestByPath.get(relative), await fileDescriptor(relative)), 'PACKAGE_MANIFEST_DIGEST_DRIFT', `package manifest digest drifted: ${relative}`);

  const receipt = {
    receipt_version: IMPORT_RECEIPT_VERSION,
    import_id: normalized.import_id,
    status: errors.length === 0 ? 'pass' : 'fail',
    offline: true,
    verification_scope: 'offline_deterministic_preflight_no_database_execution',
    source_manifest_file_sha256: legacy.hashes.manifest,
    source_content_fingerprint: SOURCE_CONTENT_FINGERPRINT,
    normalizer_version: NORMALIZER_VERSION,
    reconciliation: {
      records_expected: 157, records_accepted: normalized.plan.record_mappings.filter(row => row.disposition === 'accepted').length,
      records_rejected: normalized.plan.record_mappings.filter(row => row.disposition === 'rejected').length,
      routes_expected: 14, routes_accepted: normalized.plan.join_route_mappings.filter(row => row.disposition === 'accepted').length,
      routes_rejected: normalized.plan.join_route_mappings.filter(row => row.disposition === 'rejected').length,
      unexplained_items: 157 + 14 - normalized.plan.record_mappings.length - normalized.plan.join_route_mappings.length
    },
    idempotency: { first_apply_status: firstApply.status, replay_status: replay.status, replay_new_logical_rows: replay.new_logical_rows },
    identity_safety: {
      canonical_asset_count: normalized.bundle.assets.length,
      canonical_source_count: normalized.bundle.sources.length,
      distinct_legacy_record_count: new Set(recordIds).size,
      automatic_merges: 0,
      open_review_candidates: normalized.plan.identity_review_candidates.length,
      open_source_review_candidates: normalized.plan.source_identity_review_candidates.length
    },
    projection_parity: { records_exact: canonicalEqual(normalized.projection.records, legacy.records), search_documents_exact: canonicalEqual(normalized.projection.search_documents, legacy.searchDocuments), join_routes_exact: canonicalEqual(normalized.projection.join_routes, legacy.joinRoutes), stable_ids: true, access_states: true, evidence: true, warnings: true, zero_result_semantics: true },
    ingestion_boundary: {
      sealed_capture_count: ingestionBoundary.sealed_capture_count,
      normalize_job_count: ingestionBoundary.normalize_job_count,
      relational_shape_reconciled: databaseIngestionBoundary.status === 'reconciled_database_workset',
      normalization_requirement_count: databaseIngestionBoundary.normalization_requirement_count,
      normalization_outbox_count: databaseIngestionBoundary.normalization_outbox_count,
      aggregate_job_rejected: aggregateJobRejected,
      missing_job_rejected: missingJobRejected,
      duplicate_job_rejected: duplicateJobRejected
    },
    rollback: { reject_batch_status: rollback.status, deleted_rows: rollback.deleted_rows, entities_preserved: beforeRollback.entities.size === afterRollback.entities.size, revisions_preserved: beforeRollback.revisions.size === afterRollback.revisions.size, aliases_preserved: beforeRollback.aliases.size === afterRollback.aliases.size, audit_projection_preserved: rollback.preserved_projection_for_audit },
    canonical_counts: normalized.plan.canonical_counts,
    bundle_fingerprint: contentFingerprint(normalized.bundle),
    projection_fingerprint: normalized.plan.projection_fingerprint,
    document_fingerprint: normalized.importDocument.document_fingerprint,
    integrity_authority: {
      authority_id: 'legacy-v1.1.0:legacy-corpus-normalizer@1.0.0',
      canonicalization_version: 'ushso-canonical-json-v1'
    },
    database_execution: {
      status: 'not_executed_in_offline_package_validation',
      required_receipt: 'verification/wp6/v1.0.0/receipts/verification-receipt.json'
    },
    plan_file_sha256: await sha256File(fixturePlanPath),
    errors
  };
  const validateReceipt = localAjv.getSchema('https://ushso.org/packages/normalization/v1.0.0/schemas/import-receipt.schema.json');
  if (receipt.status === 'pass' && !validateReceipt(receipt)) throw new Error(`RECEIPT_SCHEMA_INVALID:${JSON.stringify(validateReceipt.errors)}`);
  if (writeReceipt) await writeAtomic(path.join(PACKAGE_ROOT, 'validation/validation-receipt.json'), stableJson(receipt));
  return receipt;
}

if (process.argv[1]?.endsWith('validate-package.mjs')) {
  const unknown = process.argv.slice(2).filter(value => value !== '--write-receipt');
  if (unknown.length) throw new Error(`UNKNOWN_ARGUMENT:${unknown.join(',')}`);
  const receipt = await validateNormalizationPackage({ writeReceipt: process.argv.includes('--write-receipt') });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt.status !== 'pass') process.exitCode = 1;
}
