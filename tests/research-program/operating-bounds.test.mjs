import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  APPROVED_SOURCE_DESCRIPTOR_TEMPLATES,
  DESCRIPTOR_TEMPLATE_ACTIVATION,
  contractValidationTarget,
  routeManifestInventory,
  validateDescriptor,
} from '../../packages/connectors/src/index.mjs';
import { DEFAULT_RESPONSE_LIMITS } from '../../packages/connectors/src/route-manifest.mjs';
import { STAGE_POLICIES, retryBudget } from '../../packages/ingestion/src/index.mjs';
import { DLQ_SINK_TRANSPORT_POLICY } from '../../packages/ingestion/src/dlq-sink-policy.mjs';
import { validateIngestionRecord } from '../../contracts/ingestion/v1.0.0/tools/index.mjs';
import {
  EVIDENCE_RECEIPT_SCHEMA_PATH,
  EVIDENCE_RECEIPT_VERSION,
  OPERATING_BOUNDS_POLICY_VERSION,
  composeEvidenceReceipt,
  inspectOperatingBoundsModuleSource,
  validateEvidenceReceipt,
  validateOperatingBoundsPolicy,
} from '../../scripts/research-program/operating-bounds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const POLICY_PATH = path.join(ROOT, 'scripts/research-program/policy.json');
const MODULE_PATH = path.join(ROOT, 'scripts/research-program/operating-bounds.mjs');
const FIXTURE_DIR = path.join(ROOT, 'tests/research-program/fixtures/pr009-census-negative');
const VALID_FIXTURES_PATH = path.join(ROOT, 'contracts/ingestion/v1.0.0/fixtures/valid-fixtures.json');

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));

function clone(value) {
  return structuredClone(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function compileReceiptSchema(schema) {
  const ajv = new Ajv2020({
    strict: true,
    strictSchema: true,
    allErrors: true,
    validateFormats: false,
  });
  ajv.addFormat('date-time', (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  const validate = ajv.compile(schema);
  return (receipt) => {
    const valid = validate(receipt);
    return {
      valid,
      detail: valid ? 'ok' : (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; '),
    };
  };
}

async function policyContext() {
  return {
    descriptors: APPROVED_SOURCE_DESCRIPTOR_TEMPLATES,
    defaultResponseLimits: DEFAULT_RESPONSE_LIMITS,
    stagePolicies: STAGE_POLICIES,
    retryBudget,
    dlqPolicy: DLQ_SINK_TRANSPORT_POLICY,
    validateDescriptor,
    routeManifestInventory,
  };
}

async function receiptContext() {
  const schema = await readJson(EVIDENCE_RECEIPT_SCHEMA_PATH);
  return {
    validateReceiptSchema: compileReceiptSchema(schema),
    validateIngestionRecord,
  };
}

function codes(result) {
  return result.issues.map((issue) => issue.code);
}

async function validRecords() {
  const bundle = await readJson(VALID_FIXTURES_PATH);
  const byId = Object.fromEntries(bundle.records.map((record) => [record.fixture_id, record.value]));
  return byId;
}

test('default policy accepts current paused descriptors and existing retry bounds', async () => {
  const policy = await readJson(POLICY_PATH);
  const result = await validateOperatingBoundsPolicy(policy, await policyContext());
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
  assert.equal(policy.policy_version, OPERATING_BOUNDS_POLICY_VERSION);
  assert.equal(policy.lifecycle, DESCRIPTOR_TEMPLATE_ACTIVATION.lifecycle);
  assert.equal(policy.external_authorization_gate, 'AUTH-04');
  assert.equal(policy.activation.live_network, false);
  assert.equal(policy.descriptor_identity.hash_basis, 'ushso-canonical-json.v1');
  assert.equal(policy.sources.length, APPROVED_SOURCE_DESCRIPTOR_TEMPLATES.length);
});

test('policy rejects missing context, foreign identities, URLs, activation and unbounded limits', async () => {
  const policy = await readJson(POLICY_PATH);
  const context = await policyContext();

  const missingContext = await validateOperatingBoundsPolicy(policy, {});
  assert.equal(missingContext.valid, false);
  assert.ok(codes(missingContext).includes('CONTEXT_FIELD_MISSING'));

  const foreign = clone(policy);
  foreign.sources[0].source_id = 'source_not_in_registry';
  const foreignResult = await validateOperatingBoundsPolicy(foreign, context);
  assert.equal(foreignResult.valid, false);
  assert.ok(codes(foreignResult).includes('FOREIGN_SOURCE_ID'));

  const urlPolicy = clone(policy);
  urlPolicy.sources[0].homepage = 'https://example.invalid/data.json';
  const urlResult = await validateOperatingBoundsPolicy(urlPolicy, context);
  assert.equal(urlResult.valid, false);
  assert.ok(codes(urlResult).includes('ARBITRARY_URL_IN_POLICY'));

  const activated = clone(policy);
  activated.activation.live_network = true;
  const activatedResult = await validateOperatingBoundsPolicy(activated, context);
  assert.equal(activatedResult.valid, false);
  assert.ok(codes(activatedResult).includes('ACTIVATION_NOT_FALSE'));

  const unbounded = clone(policy);
  unbounded.global_bounds.timeout_seconds = 0;
  unbounded.sources[0].bounds.maximum_response_bytes = policy.sources[0].bounds.maximum_response_bytes + 1;
  const unboundedResult = await validateOperatingBoundsPolicy(unbounded, context);
  assert.equal(unboundedResult.valid, false);
  assert.ok(codes(unboundedResult).includes('TIMEOUT_UNBOUNDED'));
  assert.ok(codes(unboundedResult).includes('SOURCE_BOUND_LOOSER'));

  const retention = clone(policy);
  retention.sources[0].retention.active_days = 7;
  retention.sources[0].retention.override = null;
  const retentionResult = await validateOperatingBoundsPolicy(retention, context);
  assert.equal(retentionResult.valid, false);
  assert.ok(codes(retentionResult).includes('RETENTION_OVERRIDE_INCOMPLETE'));

  const classChange = clone(policy);
  classChange.sources[0].retention.class = 'source_payload';
  const classResult = await validateOperatingBoundsPolicy(classChange, context);
  assert.equal(classResult.valid, false);
  assert.ok(codes(classResult).includes('UNAUTHORIZED_RETENTION_CLASS'));
});

test('pure module has no transport, database, queue or fetch side effects', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');
  const result = inspectOperatingBoundsModuleSource(source);
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
  assert.match(source, /export async function validateOperatingBoundsPolicy/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});

test('underlying ingestion fixtures still validate independently of receipt composition', async () => {
  const records = await validRecords();
  const captured = await validateIngestionRecord('metadata-fetch.schema.json', records.valid_fetch_captured);
  const reused = await validateIngestionRecord('metadata-fetch.schema.json', records.valid_fetch_not_modified);
  const capture = await validateIngestionRecord('capture-reference.schema.json', records.valid_capture_reference);
  assert.equal(captured.valid, true, JSON.stringify(captured.issues));
  assert.equal(reused.valid, true, JSON.stringify(reused.issues));
  assert.equal(capture.valid, true, JSON.stringify(capture.issues));
  assert.equal(contractValidationTarget('metadata_fetch', 'ingestion.v1.0.0').schema_file, 'metadata-fetch.schema.json');
});

test('compose captured, 304 reuse, access-only, pre-egress, failure and truncation separately', async () => {
  const records = await validRecords();
  const context = await receiptContext();

  const captured = await composeEvidenceReceipt({
    receipt_id: 'receipt_capture_cms_page_001',
    request_type: 'catalog_metadata',
    source_id: 'source_cms_catalog',
    descriptor_id: 'descriptor_cms_catalog_v1',
    endpoint_id: 'endpoint_cms_catalog',
    template_id: 'route_cms_catalog_page',
    configuration_revision: 1,
    descriptor_hash: {
      algorithm: 'sha256',
      hash_basis: 'ushso-canonical-json.v1',
      hash_version: 'ushso-canonical-json.v1',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    purpose: 'catalog_metadata',
    expected_content_classes: ['catalog_collection', 'catalog_item_record'],
    safe_final_host: 'data.cms.gov',
    safe_final_path: '/data-api/v1/dataset/page-1',
    redirect_count: 0,
    observed_status: 200,
    observed_media_type: 'application/json',
    observed_bytes: 512,
    truncated: false,
    metadata_fetch: records.valid_fetch_captured,
    capture_reference: records.valid_capture_reference,
    parser_state: 'not_run',
    connector_name: 'dcat-catalog',
    connector_version: '1.0.0',
    attempt_outcome: 'captured',
    schema_validated: true,
    next_action: 'none',
    observed_at: '2026-08-30T00:01:03.000Z',
  }, context);
  assert.equal(captured.valid, true, JSON.stringify(captured.issues, null, 2));
  assert.equal(captured.receipt.attempt_outcome, 'captured');
  assert.equal(captured.receipt.capture.raw_sha256, records.valid_capture_reference.raw_sha256);

  const reused = await composeEvidenceReceipt({
    receipt_id: 'receipt_reuse_cms_page_304',
    request_type: 'catalog_metadata',
    source_id: 'source_cms_catalog',
    descriptor_id: 'descriptor_cms_catalog_v1',
    endpoint_id: 'endpoint_cms_catalog',
    template_id: 'route_cms_catalog_page',
    configuration_revision: 1,
    descriptor_hash: {
      algorithm: 'sha256',
      hash_basis: 'ushso-canonical-json.v1',
      hash_version: 'ushso-canonical-json.v1',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    purpose: 'catalog_metadata',
    expected_content_classes: ['catalog_collection', 'catalog_item_record'],
    safe_final_host: 'data.cms.gov',
    safe_final_path: '/data-api/v1/dataset/page-1',
    redirect_count: 0,
    observed_status: 304,
    observed_media_type: null,
    observed_bytes: 0,
    truncated: false,
    metadata_fetch: records.valid_fetch_not_modified,
    capture_reference: records.valid_capture_reference,
    parser_state: 'not_run',
    connector_name: 'dcat-catalog',
    connector_version: '1.0.0',
    attempt_outcome: 'not_modified',
    schema_validated: false,
    next_action: 'reuse_capture',
    observed_at: '2026-08-30T01:01:03.000Z',
  }, context);
  assert.equal(reused.valid, true, JSON.stringify(reused.issues, null, 2));
  assert.equal(reused.receipt.capture.capture_ref_id, records.valid_fetch_not_modified.reused_capture_ref_id);

  const accessOnly = await composeEvidenceReceipt({
    receipt_id: 'receipt_access_probe_cms_001',
    request_type: 'access_probe',
    source_id: 'source_cms_provider_data',
    descriptor_id: 'descriptor_cms_provider_data_fixture_v1',
    endpoint_id: 'endpoint_cms_provider_access',
    template_id: 'route_cms_provider_access_probe',
    configuration_revision: 1,
    descriptor_hash: {
      algorithm: 'sha256',
      hash_basis: 'ushso-canonical-json.v1',
      hash_version: 'ushso-canonical-json.v1',
      sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    purpose: 'access_probe',
    expected_content_classes: ['access_status_headers'],
    safe_final_host: 'data.cms.gov',
    safe_final_path: '/provider-data/sites/default/files/example',
    redirect_count: 0,
    observed_status: 200,
    observed_media_type: null,
    observed_bytes: 0,
    truncated: false,
    parser_state: 'not_run',
    connector_name: 'dcat-data-json',
    connector_version: '1.0.0',
    attempt_outcome: 'access_only',
    next_action: 'typed_observation',
    observed_at: '2026-08-30T00:10:00.000Z',
  }, context);
  assert.equal(accessOnly.valid, true, JSON.stringify(accessOnly.issues, null, 2));
  assert.equal(accessOnly.receipt.capture.raw_sha256, null);

  const preEgress = await composeEvidenceReceipt({
    receipt_id: 'receipt_pre_egress_block_001',
    request_type: 'pre_egress',
    source_id: 'source_census_metadata',
    descriptor_id: 'descriptor_census_metadata_fixture_v1',
    endpoint_id: 'endpoint_census_metadata',
    template_id: 'route_census_dataset_inventory',
    configuration_revision: 1,
    descriptor_hash: {
      algorithm: 'sha256',
      hash_basis: 'ushso-canonical-json.v1',
      hash_version: 'ushso-canonical-json.v1',
      sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    },
    purpose: 'catalog_metadata',
    expected_content_classes: ['catalog_collection', 'catalog_item_record'],
    safe_final_host: null,
    safe_final_path: null,
    redirect_count: null,
    observed_status: null,
    observed_media_type: null,
    observed_bytes: null,
    truncated: false,
    parser_state: 'not_run',
    connector_name: 'dcat-data-json',
    connector_version: '1.0.0',
    attempt_outcome: 'pre_egress_blocked',
    next_action: 'pause_source',
    observed_at: '2026-09-12T00:00:00.000Z',
  }, context);
  assert.equal(preEgress.valid, true, JSON.stringify(preEgress.issues, null, 2));
  assert.equal(preEgress.receipt.route_match, 'pre_egress_block');

  const truncated = await composeEvidenceReceipt({
    receipt_id: 'receipt_truncated_cms_page_001',
    request_type: 'catalog_metadata',
    source_id: 'source_cms_catalog',
    descriptor_id: 'descriptor_cms_catalog_v1',
    endpoint_id: 'endpoint_cms_catalog',
    template_id: 'route_cms_catalog_page',
    configuration_revision: 1,
    descriptor_hash: {
      algorithm: 'sha256',
      hash_basis: 'ushso-canonical-json.v1',
      hash_version: 'ushso-canonical-json.v1',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    purpose: 'catalog_metadata',
    expected_content_classes: ['catalog_collection', 'catalog_item_record'],
    safe_final_host: 'data.cms.gov',
    safe_final_path: '/data-api/v1/dataset/page-1',
    redirect_count: 0,
    observed_status: 200,
    observed_media_type: 'application/json',
    observed_bytes: 64,
    truncated: true,
    parser_state: 'not_run',
    connector_name: 'dcat-catalog',
    connector_version: '1.0.0',
    attempt_outcome: 'truncated_incomplete',
    schema_validated: true,
    next_action: 'retry',
    observed_at: '2026-08-30T00:01:03.000Z',
  }, context);
  assert.equal(truncated.valid, true, JSON.stringify(truncated.issues, null, 2));
  assert.equal(truncated.receipt.schema_validated, false);
  assert.equal(truncated.receipt.attempt_outcome, 'truncated_incomplete');

  const typedFailure = await composeEvidenceReceipt({
    receipt_id: 'receipt_typed_failure_unexpected_html',
    request_type: 'catalog_metadata',
    source_id: 'source_cms_catalog',
    descriptor_id: 'descriptor_cms_catalog_v1',
    endpoint_id: 'endpoint_cms_catalog',
    template_id: 'route_cms_catalog_page',
    configuration_revision: 1,
    descriptor_hash: {
      algorithm: 'sha256',
      hash_basis: 'ushso-canonical-json.v1',
      hash_version: 'ushso-canonical-json.v1',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    purpose: 'catalog_metadata',
    expected_content_classes: ['catalog_collection', 'catalog_item_record'],
    safe_final_host: 'data.cms.gov',
    safe_final_path: '/data-api/v1/dataset/page-1',
    redirect_count: 0,
    observed_status: 200,
    observed_media_type: 'text/html',
    observed_bytes: 128,
    truncated: false,
    observed_rejected_body_sha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    parser_state: 'not_run',
    connector_name: 'dcat-catalog',
    connector_version: '1.0.0',
    attempt_outcome: 'typed_failure',
    next_action: 'quarantine',
    observed_at: '2026-08-30T00:01:03.000Z',
  }, context);
  assert.equal(typedFailure.valid, true, JSON.stringify(typedFailure.issues, null, 2));
  assert.equal(typedFailure.receipt.payload_access_verified, false);
});

test('Census unmatched historical HTML is an access failure with unknown redirect count', async () => {
  const manifest = await readJson(path.join(FIXTURE_DIR, 'manifest.json'));
  const body = await readFile(path.join(FIXTURE_DIR, 'sample-census-acs.html'));
  const gz = await readFile(path.join(FIXTURE_DIR, 'sample-census-acs.html.gz'));
  const retained = await readJson(path.join(FIXTURE_DIR, 'sample-census-acs.receipt.json'));
  assert.equal(sha256(body), 'c2f4687e09b80676de7f68dec92ebea395209616dbc6f895520e547c5f68c0f5');
  assert.equal(sha256(gz), 'df6a615ab36472bb4e7bbf47e77f9603192f236c05a7266f3726549c9b9d09d3');
  assert.equal(body.byteLength, 8531);
  assert.equal(retained.sha256, manifest.files['sample-census-acs.html'].sha256);
  assert.equal(retained.observed_status, 200);
  assert.equal(retained.safe_final_path, '/data/missing_key.html');
  assert.equal(retained.redirect_count, null);
  assert.equal(retained.historical_query_omitted, true);
  assert.doesNotMatch(JSON.stringify(manifest), /B27001_001E|acs5\?get=/);
  assert.doesNotMatch(JSON.stringify(retained), /B27001_001E|acs5\?get=/);

  const context = await receiptContext();
  const composed = await composeEvidenceReceipt({
    receipt_id: 'receipt_census_historical_sample_acs',
    request_type: 'historical_observation',
    observation_label: 'sample-census-acs',
    safe_final_host: manifest.safe_final_host,
    safe_final_path: manifest.safe_final_path,
    observed_status: 200,
    observed_media_type: 'text/html',
    observed_bytes: body.byteLength,
    truncated: false,
    observed_rejected_body_sha256: sha256(body),
    parser_state: 'not_run',
    attempt_outcome: 'typed_failure',
    next_action: 'pause_source',
    observed_at: '2026-09-10T14:01:05.543Z',
  }, context);
  assert.equal(composed.valid, true, JSON.stringify(composed.issues, null, 2));
  assert.equal(composed.receipt.contract_version, EVIDENCE_RECEIPT_VERSION);
  assert.equal(composed.receipt.route_match, 'unmatched_historical_observation');
  assert.equal(composed.receipt.redirect_count, null);
  assert.equal(composed.receipt.source_id, null);
  assert.equal(composed.receipt.template_id, null);
  assert.equal(composed.receipt.parser.state, 'not_run');
  assert.equal(composed.receipt.schema_validated, false);
  assert.equal(composed.receipt.payload_access_verified, false);
  assert.equal(composed.receipt.capture.capture_ref_id, null);
  assert.equal(composed.receipt.safe_final_locator.path, '/data/missing_key.html');
  assert.doesNotMatch(JSON.stringify(composed.receipt), /B27001_001E|acs5\?get=/);

  const zeroRedirects = clone(composed.receipt);
  zeroRedirects.redirect_count = 0;
  const zeroResult = await validateEvidenceReceipt(zeroRedirects, context);
  assert.equal(zeroResult.valid, false);
  assert.ok(codes(zeroResult).includes('HISTORICAL_REDIRECT_COUNT_FABRICATED'));

  const fabricatedRoute = clone(composed.receipt);
  fabricatedRoute.source_id = 'source_census_metadata';
  fabricatedRoute.descriptor_id = 'descriptor_census_metadata_fixture_v1';
  fabricatedRoute.endpoint_id = 'endpoint_census_metadata';
  fabricatedRoute.template_id = 'route_census_dataset_inventory';
  fabricatedRoute.configuration_revision = 1;
  fabricatedRoute.purpose = 'catalog_metadata';
  const fabricatedResult = await validateEvidenceReceipt(fabricatedRoute, context);
  assert.equal(fabricatedResult.valid, false);
  assert.ok(codes(fabricatedResult).includes('HISTORICAL_IDENTITY_FABRICATED'));

  const captureClaim = clone(composed.receipt);
  captureClaim.capture.raw_sha256 = sha256(body);
  const captureResult = await validateEvidenceReceipt(captureClaim, context);
  assert.equal(captureResult.valid, false);
  assert.ok(codes(captureResult).includes('HISTORICAL_CAPTURE_CLAIMED'));
});

test('version strings do not substitute for injected schema validation', async () => {
  const records = await validRecords();
  const context = await receiptContext();
  const missingValidator = await composeEvidenceReceipt({
    receipt_id: 'receipt_capture_cms_page_001',
    request_type: 'catalog_metadata',
    source_id: 'source_cms_catalog',
    descriptor_id: 'descriptor_cms_catalog_v1',
    endpoint_id: 'endpoint_cms_catalog',
    template_id: 'route_cms_catalog_page',
    configuration_revision: 1,
    descriptor_hash: {
      algorithm: 'sha256',
      hash_basis: 'ushso-canonical-json.v1',
      hash_version: 'ushso-canonical-json.v1',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    purpose: 'catalog_metadata',
    expected_content_classes: ['catalog_collection', 'catalog_item_record'],
    safe_final_host: 'data.cms.gov',
    safe_final_path: '/data-api/v1/dataset/page-1',
    redirect_count: 0,
    observed_status: 200,
    observed_media_type: 'application/json',
    observed_bytes: 512,
    truncated: false,
    metadata_fetch: records.valid_fetch_captured,
    capture_reference: records.valid_capture_reference,
    parser_state: 'not_run',
    connector_name: 'dcat-catalog',
    connector_version: '1.0.0',
    attempt_outcome: 'captured',
    schema_validated: true,
    next_action: 'none',
    observed_at: '2026-08-30T00:01:03.000Z',
  }, { validateReceiptSchema: context.validateReceiptSchema });
  assert.equal(missingValidator.valid, false);
  assert.ok(codes(missingValidator).includes('INGESTION_VALIDATOR_MISSING'));

  const unnamedHash = clone(await readJson(POLICY_PATH));
  unnamedHash.descriptor_identity.hash_basis = 'registry_field_shape_only';
  const unnamedResult = await validateOperatingBoundsPolicy(unnamedHash, await policyContext());
  assert.equal(unnamedResult.valid, false);
  assert.ok(codes(unnamedResult).includes('DESCRIPTOR_HASH_BASIS_UNNAMED'));
});
