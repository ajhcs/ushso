import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OPERATING_BOUNDS_POLICY_VERSION = 'ushso.research-program.operating-bounds.v1.0.0';
export const EVIDENCE_RECEIPT_VERSION = 'ushso.research-program.evidence-receipt.v1.0.0';
export const EVIDENCE_RECEIPT_SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'receipts',
  'v1.0.0',
  'evidence-receipt.schema.json',
);

const REQUIRED_ACTIVATION_FLAGS = [
  'live_network',
  'receipt_writes',
  'database_writes',
  'queue_activation',
  'workflow_activation',
  'deletion_activation',
  'source_egress',
  'activation_authorized',
];

const REQUIRED_FORBIDDEN_CLASSES = [
  'source_data_payload',
  'query_execution',
  'data_download',
  'archive_member',
  'form_submission',
  'login',
  'payment',
  'authorization_workflow',
  'arbitrary_url',
  'secret_in_policy_or_receipt',
  'unbounded_file',
  'unapproved_redirect',
];

const SECRET_OR_BODY_PATTERN = /(?:https?:\/\/[^\s"'<>]*[?&](?:x-amz-(?:credential|signature)|x-goog-(?:credential|signature)|awsaccesskeyid|googleaccessid|key-pair-id|signature|access_token|api_key)=)|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|(?:<!doctype\s+html|<html\b|<body\b)/i;
const URL_PATTERN = /https?:\/\//i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OPAQUE_ID_PATTERN = /^[a-z][a-z0-9_]{1,31}_[A-Za-z0-9][A-Za-z0-9._:-]{1,126}$/;
const FORBIDDEN_IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\s[\s\S]*?\sfrom\s+['"](?:node:http|node:https|node:net|node:tls|node:dgram|node:dns|node:child_process|pg|pg-promise|postgres|ioredis|bullmq|@aws-sdk\/client-s3|wrangler)['"]|(?:^|\n)\s*(?:import|require)\s*\(\s*['"](?:node:http|node:https|node:net|node:tls|fetch)['"]/;

const ATTEMPT_OUTCOMES = new Set([
  'captured',
  'not_modified',
  'access_only',
  'pre_egress_blocked',
  'typed_failure',
  'truncated_incomplete',
]);

function issue(code, pointer, detail) {
  return { code, pointer, detail };
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function walkStrings(value, visit, pointer = '/') {
  if (typeof value === 'string') {
    visit(value, pointer);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, visit, `${pointer}${index}/`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    walkStrings(child, visit, `${pointer}${key}/`);
  }
}

function requireContext(options, keys) {
  const issues = [];
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return [issue('CONTEXT_MISSING', '/', 'injected validation context is required')];
  }
  for (const key of keys) {
    if (options[key] === undefined || options[key] === null) {
      issues.push(issue('CONTEXT_FIELD_MISSING', `/${key}`, `injected ${key} is required and must not be inferred`));
    }
  }
  return issues;
}

function descriptorMap(descriptors) {
  const bySource = new Map();
  const byDescriptor = new Map();
  for (const descriptor of descriptors ?? []) {
    bySource.set(descriptor.source_id, descriptor);
    byDescriptor.set(descriptor.descriptor_id, descriptor);
  }
  return { bySource, byDescriptor };
}

function sameLimits(left, right) {
  if (!left || !right) return false;
  return Object.keys(left).length === Object.keys(right).length
    && Object.entries(left).every(([key, value]) => right[key] === value);
}

export function inspectOperatingBoundsModuleSource(sourceText) {
  const issues = [];
  if (typeof sourceText !== 'string') {
    return { valid: false, issues: [issue('MODULE_SOURCE_MISSING', '/', 'module source text is required')] };
  }
  if (FORBIDDEN_IMPORT_PATTERN.test(sourceText) || /(?:^|\n)\s*fetch\s*\(/.test(sourceText)) {
    issues.push(issue('SIDE_EFFECT_IMPORT', '/', 'operating-bounds module must not import transport, database, queue, R2, or fetch'));
  }
  return { valid: issues.length === 0, issues };
}

export async function validateOperatingBoundsPolicy(policy, options = {}) {
  const issues = requireContext(options, [
    'descriptors',
    'defaultResponseLimits',
    'stagePolicies',
    'retryBudget',
    'dlqPolicy',
    'validateDescriptor',
    'routeManifestInventory',
  ]);
  if (issues.length) return { valid: false, issues };

  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return { valid: false, issues: [issue('POLICY_NOT_OBJECT', '/', 'policy must be an object')] };
  }
  if (policy.policy_version !== OPERATING_BOUNDS_POLICY_VERSION) {
    issues.push(issue('POLICY_VERSION_MISMATCH', '/policy_version', OPERATING_BOUNDS_POLICY_VERSION));
  }
  if (policy.lifecycle !== 'fixture_only') {
    issues.push(issue('LIFECYCLE_NOT_FIXTURE_ONLY', '/lifecycle', 'policy lifecycle must remain fixture_only'));
  }
  if (policy.external_authorization_gate !== 'AUTH-04') {
    issues.push(issue('AUTHORIZATION_GATE_MISMATCH', '/external_authorization_gate', 'AUTH-04'));
  }

  const activation = policy.activation ?? {};
  for (const flag of REQUIRED_ACTIVATION_FLAGS) {
    if (activation[flag] !== false) {
      issues.push(issue('ACTIVATION_NOT_FALSE', `/activation/${flag}`, 'activation flags must be false'));
    }
  }

  const identity = policy.descriptor_identity ?? {};
  if (identity.hash_basis !== 'ushso-canonical-json.v1' || identity.hash_version !== 'ushso-canonical-json.v1') {
    issues.push(issue('DESCRIPTOR_HASH_BASIS_UNNAMED', '/descriptor_identity', 'hash_basis and hash_version must be ushso-canonical-json.v1'));
  }
  if (identity.hash_algorithm !== 'sha256') {
    issues.push(issue('DESCRIPTOR_HASH_ALGORITHM_UNSUPPORTED', '/descriptor_identity/hash_algorithm', 'sha256'));
  }
  if (identity.distinct_from_exact_published_bytes !== true) {
    issues.push(issue('DESCRIPTOR_HASH_CLAIMS_COLLAPSED', '/descriptor_identity/distinct_from_exact_published_bytes', 'exact published bytes remain a distinct unresolved claim'));
  }

  const forbidden = new Set(policy.forbidden_operation_classes ?? []);
  for (const required of REQUIRED_FORBIDDEN_CLASSES) {
    if (!forbidden.has(required)) {
      issues.push(issue('FORBIDDEN_CLASS_MISSING', '/forbidden_operation_classes', required));
    }
  }

  walkStrings(policy, (value, pointer) => {
    if (URL_PATTERN.test(value)) {
      issues.push(issue('ARBITRARY_URL_IN_POLICY', pointer, 'policy entries must not contain caller URLs'));
    }
    if (SECRET_OR_BODY_PATTERN.test(value)) {
      issues.push(issue('SECRET_OR_BODY_IN_POLICY', pointer, 'policy must not contain secrets or body content'));
    }
  });

  const global = policy.global_bounds ?? {};
  if (!Number.isInteger(global.timeout_seconds) || global.timeout_seconds <= 0 || global.timeout_seconds > 120) {
    issues.push(issue('TIMEOUT_UNBOUNDED', '/global_bounds/timeout_seconds', 'timeout must be a bounded positive integer'));
  }
  if (global.maximum_redirects !== 1) {
    issues.push(issue('REDIRECT_LIMIT_MISMATCH', '/global_bounds/maximum_redirects', 'global redirect limit must equal the current descriptor default of 1'));
  }
  if (!sameLimits(global.structural_response_limits, options.defaultResponseLimits)) {
    issues.push(issue('STRUCTURAL_LIMITS_MISMATCH', '/global_bounds/structural_response_limits', 'structural limits must equal DEFAULT_RESPONSE_LIMITS'));
  }

  const harvest = options.stagePolicies.harvest_page;
  const harvestBudget = options.retryBudget('harvest_page', 0);
  const retry = global.retry ?? {};
  if (
    retry.stage !== 'harvest_page'
    || retry.maximum_delivery_attempts !== harvest.maximumDeliveryAttempts
    || retry.transport_max_retries !== harvestBudget.transportMaxRetries
    || retry.minimum_delay_seconds !== harvest.minimumDelaySeconds
    || retry.maximum_delay_seconds !== harvest.maximumDelaySeconds
    || retry.exhausted_outcome !== harvest.exhaustedOutcome
  ) {
    issues.push(issue('RETRY_POLICY_MISMATCH', '/global_bounds/retry', 'retry bounds must equal existing harvest_page stage policy'));
  }

  const dlq = global.dlq ?? {};
  const expectedDlq = options.dlqPolicy;
  if (
    dlq.policy_version !== expectedDlq.policyVersion
    || dlq.maximum_delivery_attempts !== expectedDlq.maximumDeliveryAttempts
    || dlq.transport_max_retries !== expectedDlq.transportMaxRetries
    || dlq.maximum_batch_size !== expectedDlq.maximumBatchSize
    || dlq.minimum_delay_seconds !== expectedDlq.minimumDelaySeconds
    || dlq.maximum_delay_seconds !== expectedDlq.maximumDelaySeconds
    || dlq.second_dead_letter_queue_allowed !== expectedDlq.secondDeadLetterQueueAllowed
  ) {
    issues.push(issue('DLQ_POLICY_MISMATCH', '/global_bounds/dlq', 'DLQ transport bounds must equal existing DLQ_SINK_TRANSPORT_POLICY'));
  }

  const retention = global.retention ?? {};
  if (retention.raw_metadata_documentation_active_days !== 90) {
    issues.push(issue('RAW_RETENTION_DEFAULT_MISMATCH', '/global_bounds/retention/raw_metadata_documentation_active_days', '90-day default'));
  }
  if (retention.security_and_audit_receipt_days !== 365) {
    issues.push(issue('AUDIT_RETENTION_MISMATCH', '/global_bounds/retention/security_and_audit_receipt_days', '365-day security/audit minimum'));
  }
  if (retention.queue_transport_days !== 4) {
    issues.push(issue('QUEUE_RETENTION_MISMATCH', '/global_bounds/retention/queue_transport_days', '4-day queue transport retention'));
  }
  if (retention.hashes_and_lineage_outlive_raw !== true) {
    issues.push(issue('LINEAGE_RETENTION_MISMATCH', '/global_bounds/retention/hashes_and_lineage_outlive_raw', 'hashes and lineage must outlive raw retention'));
  }
  if (global.aggregate_sample_store !== 'disabled_pending_rights_and_privacy_review') {
    issues.push(issue('AGGREGATE_STORE_NOT_DISABLED', '/global_bounds/aggregate_sample_store', 'aggregate/sample store remains a separate rights decision'));
  }

  if (!Array.isArray(options.descriptors) || options.descriptors.length === 0) {
    issues.push(issue('DESCRIPTOR_CONTEXT_EMPTY', '/descriptors', 'injected descriptors are required'));
    return { valid: false, issues };
  }

  const validatedDescriptors = [];
  for (const [index, candidate] of options.descriptors.entries()) {
    try {
      validatedDescriptors.push(options.validateDescriptor(candidate));
    } catch (error) {
      issues.push(issue('DESCRIPTOR_INVALID', `/descriptors/${index}`, error.message));
    }
  }
  if (issues.some((entry) => entry.code === 'DESCRIPTOR_INVALID')) {
    return { valid: false, issues };
  }

  const { bySource, byDescriptor } = descriptorMap(validatedDescriptors);
  const sources = policy.sources ?? [];
  if (!Array.isArray(sources) || sources.length === 0) {
    issues.push(issue('SOURCES_MISSING', '/sources', 'policy must enumerate paused descriptor sources'));
  }

  const seenSources = new Set();
  for (const [index, source] of sources.entries()) {
    const pointer = `/sources/${index}`;
    if (seenSources.has(source.source_id)) {
      issues.push(issue('SOURCE_DUPLICATE', `${pointer}/source_id`, source.source_id));
    }
    seenSources.add(source.source_id);
    const descriptor = bySource.get(source.source_id);
    if (!descriptor) {
      issues.push(issue('FOREIGN_SOURCE_ID', `${pointer}/source_id`, source.source_id));
      continue;
    }
    if (source.descriptor_id !== descriptor.descriptor_id || byDescriptor.get(source.descriptor_id) !== descriptor) {
      issues.push(issue('FOREIGN_DESCRIPTOR_ID', `${pointer}/descriptor_id`, source.descriptor_id));
    }
    if (source.configuration_revision !== descriptor.configuration_revision) {
      issues.push(issue('CONFIGURATION_REVISION_MISMATCH', `${pointer}/configuration_revision`, String(descriptor.configuration_revision)));
    }
    if (source.source_state !== 'paused' || descriptor.source_state !== 'paused') {
      issues.push(issue('SOURCE_NOT_PAUSED', `${pointer}/source_state`, 'policy sources remain paused'));
    }

    const bounds = source.bounds ?? {};
    if (bounds.timeout_seconds > global.timeout_seconds) {
      issues.push(issue('SOURCE_TIMEOUT_LOOSER', `${pointer}/bounds/timeout_seconds`, 'source timeout cannot exceed global timeout'));
    }
    if (bounds.maximum_redirects > descriptor.bounds.maximum_redirects || bounds.maximum_redirects > global.maximum_redirects) {
      issues.push(issue('SOURCE_REDIRECTS_LOOSER', `${pointer}/bounds/maximum_redirects`, 'source redirects cannot exceed descriptor or global limits'));
    }
    for (const key of ['maximum_pages', 'maximum_response_bytes', 'maximum_decompressed_bytes', 'maximum_run_seconds']) {
      if (!Number.isInteger(bounds[key]) || bounds[key] > descriptor.bounds[key] || bounds[key] < 1) {
        issues.push(issue('SOURCE_BOUND_LOOSER', `${pointer}/bounds/${key}`, `must be a positive integer no looser than descriptor ${descriptor.bounds[key]}`));
      }
    }

    const origin = source.origin_policy ?? {};
    if (origin.maximum_concurrency > descriptor.origin_policy.maximum_concurrency) {
      issues.push(issue('SOURCE_CONCURRENCY_LOOSER', `${pointer}/origin_policy/maximum_concurrency`, 'concurrency cannot exceed the descriptor'));
    }
    if (origin.requests_per_second > descriptor.origin_policy.requests_per_second) {
      issues.push(issue('SOURCE_RATE_LOOSER', `${pointer}/origin_policy/requests_per_second`, 'rate cannot exceed the descriptor'));
    }
    if (origin.burst > descriptor.origin_policy.burst) {
      issues.push(issue('SOURCE_BURST_LOOSER', `${pointer}/origin_policy/burst`, 'burst cannot exceed the descriptor'));
    }

    const sourceRetention = source.retention ?? {};
    if (sourceRetention.class !== 'raw_metadata_documentation') {
      issues.push(issue('UNAUTHORIZED_RETENTION_CLASS', `${pointer}/retention/class`, 'raw_metadata_documentation'));
    }
    if (sourceRetention.active_days === 90) {
      if (sourceRetention.override !== null) {
        issues.push(issue('DEFAULT_RETENTION_HAS_OVERRIDE', `${pointer}/retention/override`, 'default 90-day retention has no override object'));
      }
    } else {
      const override = sourceRetention.override ?? {};
      for (const field of ['owner', 'rationale', 'review_at', 'audit_event_id', 'legal_rights_recovery_evidence']) {
        if (typeof override[field] !== 'string' || override[field].length === 0) {
          issues.push(issue('RETENTION_OVERRIDE_INCOMPLETE', `${pointer}/retention/override/${field}`, 'non-default retention requires owner, rationale, review date, audit event, and rights/recovery evidence'));
        }
      }
    }

    const inventory = options.routeManifestInventory(descriptor);
    const policyRoutes = source.routes ?? [];
    const inventoryKeys = new Set(inventory.map((route) => `${route.endpoint_id}:${route.template_id}`));
    const policyKeys = new Set();
    for (const [routeIndex, route] of policyRoutes.entries()) {
      const routePointer = `${pointer}/routes/${routeIndex}`;
      const key = `${route.endpoint_id}:${route.template_id}`;
      policyKeys.add(key);
      const expected = inventory.find((candidate) => candidate.endpoint_id === route.endpoint_id && candidate.template_id === route.template_id);
      if (!expected) {
        issues.push(issue('FOREIGN_ROUTE_IDENTITY', routePointer, key));
        continue;
      }
      if (
        route.purpose !== expected.purpose
        || route.method !== expected.method
        || route.target_class !== expected.target_class
        || route.path_template !== expected.path_template
        || JSON.stringify(route.expected_content_classes) !== JSON.stringify(expected.expected_content_classes)
      ) {
        issues.push(issue('ROUTE_CONTRACT_MISMATCH', routePointer, key));
      }
    }
    for (const key of inventoryKeys) {
      if (!policyKeys.has(key)) {
        issues.push(issue('ROUTE_COVERAGE_INCOMPLETE', `${pointer}/routes`, key));
      }
    }
  }

  for (const descriptor of validatedDescriptors) {
    if (!seenSources.has(descriptor.source_id)) {
      issues.push(issue('DESCRIPTOR_UNLISTED', '/sources', descriptor.source_id));
    }
  }

  return { valid: issues.length === 0, issues };
}

function nullIdentityForHistorical(receipt, issues) {
  for (const field of ['source_id', 'descriptor_id', 'endpoint_id', 'template_id', 'configuration_revision', 'descriptor_hash', 'purpose']) {
    if (receipt[field] !== null) {
      issues.push(issue('HISTORICAL_IDENTITY_FABRICATED', `/${field}`, 'unmatched historical observations cannot mint approved route identities'));
    }
  }
}

async function validateUnderlyingRecord(kind, record, options, issues, pointer) {
  if (record === null || record === undefined) return;
  if (typeof options.validateIngestionRecord !== 'function') {
    issues.push(issue('INGESTION_VALIDATOR_MISSING', pointer, 'injected validateIngestionRecord is required to qualify underlying records'));
    return;
  }
  const result = await options.validateIngestionRecord(kind, record);
  if (!result?.valid) {
    const detail = (result?.issues ?? []).map((entry) => entry.code ?? entry.detail).join(', ') || 'invalid';
    issues.push(issue('UNDERLYING_RECORD_INVALID', pointer, detail));
  }
}

export async function validateEvidenceReceipt(receipt, options = {}) {
  const issues = requireContext(options, ['validateReceiptSchema']);
  if (issues.length) return { valid: false, issues };
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { valid: false, issues: [issue('RECEIPT_NOT_OBJECT', '/', 'receipt must be an object')] };
  }

  const schemaResult = options.validateReceiptSchema(receipt);
  if (!schemaResult?.valid) {
    const detail = schemaResult?.detail ?? 'schema invalid';
    issues.push(issue('RECEIPT_SCHEMA_INVALID', '/', detail));
    return { valid: false, issues };
  }

  walkStrings(receipt, (value, pointer) => {
    if (SECRET_OR_BODY_PATTERN.test(value) && pointer !== '/observation_label/') {
      issues.push(issue('SECRET_OR_BODY_IN_RECEIPT', pointer, 'receipt must not contain secrets or body content'));
    }
    if (pointer.includes('query') || /[?&]get=/.test(value)) {
      issues.push(issue('QUERY_IN_RECEIPT', pointer, 'receipt must not copy historical query URLs'));
    }
  });

  if (receipt.contract_version !== EVIDENCE_RECEIPT_VERSION) {
    issues.push(issue('RECEIPT_VERSION_MISMATCH', '/contract_version', EVIDENCE_RECEIPT_VERSION));
  }
  if (receipt.payload_access_verified !== false) {
    issues.push(issue('PAYLOAD_ACCESS_CLAIMED', '/payload_access_verified', 'metadata receipts never verify payload access'));
  }
  if (receipt.truth_boundaries?.http_status_is_not_content_success !== true) {
    issues.push(issue('HTTP_STATUS_TRUTH_BOUNDARY_MISSING', '/truth_boundaries/http_status_is_not_content_success', 'HTTP status is not content success'));
  }
  if (receipt.truncated === true && receipt.schema_validated !== false) {
    issues.push(issue('TRUNCATION_IMPLIES_SCHEMA', '/schema_validated', 'truncated bytes never imply complete schema validation'));
  }
  if (!ATTEMPT_OUTCOMES.has(receipt.attempt_outcome)) {
    issues.push(issue('ATTEMPT_OUTCOME_UNKNOWN', '/attempt_outcome', String(receipt.attempt_outcome)));
  }

  const capture = receipt.capture ?? {};
  const fetchRecord = receipt.underlying_records?.metadata_fetch ?? null;
  const captureRecord = receipt.underlying_records?.capture_reference ?? null;
  await validateUnderlyingRecord('metadata-fetch.schema.json', fetchRecord, options, issues, '/underlying_records/metadata_fetch');
  await validateUnderlyingRecord('capture-reference.schema.json', captureRecord, options, issues, '/underlying_records/capture_reference');

  if (receipt.route_match === 'matched_descriptor_route') {
    const hash = receipt.descriptor_hash;
    if (!hash || hash.hash_basis !== 'ushso-canonical-json.v1' || hash.hash_version !== 'ushso-canonical-json.v1') {
      issues.push(issue('DESCRIPTOR_HASH_BASIS_UNNAMED', '/descriptor_hash', 'matched routes must name ushso-canonical-json.v1'));
    }
    if (hash?.hash_basis === 'exact_published_bytes') {
      issues.push(issue('EXACT_PUBLISHED_BYTES_UNRESOLVED', '/descriptor_hash/hash_basis', 'exact published descriptor bytes remain a distinct unresolved claim'));
    }
    if (hash?.sha256 && !SHA256_PATTERN.test(hash.sha256)) {
      issues.push(issue('DESCRIPTOR_HASH_INVALID', '/descriptor_hash/sha256', 'lowercase 64-hex'));
    }
  }

  if (receipt.request_type === 'historical_observation') {
    if (receipt.route_match !== 'unmatched_historical_observation') {
      issues.push(issue('HISTORICAL_ROUTE_MATCH_INVALID', '/route_match', 'unmatched_historical_observation'));
    }
    nullIdentityForHistorical(receipt, issues);
    if (receipt.redirect_count !== null) {
      issues.push(issue('HISTORICAL_REDIRECT_COUNT_FABRICATED', '/redirect_count', 'unknown redirect count must remain null, not zero'));
    }
    if (receipt.parser?.state !== 'not_run') {
      issues.push(issue('HISTORICAL_PARSER_RAN', '/parser/state', 'not_run'));
    }
    if (receipt.attempt_outcome !== 'typed_failure') {
      issues.push(issue('HISTORICAL_OUTCOME_NOT_FAILURE', '/attempt_outcome', 'typed_failure'));
    }
    if (receipt.schema_validated !== false) {
      issues.push(issue('HISTORICAL_SCHEMA_SUCCESS', '/schema_validated', 'rejected HTML is not schema success'));
    }
    if (capture.capture_ref_id !== null || capture.raw_sha256 !== null || capture.semantic_sha256 !== null) {
      issues.push(issue('HISTORICAL_CAPTURE_CLAIMED', '/capture', 'rejected body hash is not a capture reference'));
    }
    if (receipt.next_action !== 'pause_source') {
      issues.push(issue('HISTORICAL_NEXT_ACTION_INVALID', '/next_action', 'pause_source'));
    }
    if (typeof receipt.observed_rejected_body_sha256 === 'string' && !SHA256_PATTERN.test(receipt.observed_rejected_body_sha256)) {
      issues.push(issue('REJECTED_BODY_HASH_INVALID', '/observed_rejected_body_sha256', 'lowercase 64-hex'));
    }
  }

  if (receipt.request_type === 'pre_egress') {
    if (receipt.route_match !== 'pre_egress_block' || receipt.attempt_outcome !== 'pre_egress_blocked') {
      issues.push(issue('PRE_EGRESS_OUTCOME_INVALID', '/attempt_outcome', 'pre_egress_blocked'));
    }
    if (receipt.observed_status !== null || receipt.redirect_count !== null) {
      issues.push(issue('PRE_EGRESS_NETWORK_OBSERVATION', '/observed_status', 'pre-egress blocks have no transport observation'));
    }
  }

  if (receipt.attempt_outcome === 'captured') {
    if (fetchRecord?.outcome !== 'captured' || !captureRecord) {
      issues.push(issue('CAPTURE_WITHOUT_UNDERLYING_RECORDS', '/underlying_records', 'captured receipts require valid metadata-fetch and capture-reference records'));
    }
    if (capture.raw_sha256 !== captureRecord?.raw_sha256 || capture.semantic_sha256 !== captureRecord?.semantic_sha256) {
      issues.push(issue('CAPTURE_HASH_MISMATCH', '/capture', 'raw/semantic hashes must copy the capture reference'));
    }
    if (receipt.observed_rejected_body_sha256 !== null) {
      issues.push(issue('CAPTURE_HAS_REJECTED_BODY_HASH', '/observed_rejected_body_sha256', 'accepted capture does not use a rejected-body hash'));
    }
    if (receipt.truncated === true) {
      issues.push(issue('CAPTURE_TRUNCATED', '/truncated', 'truncated bytes are not a complete capture'));
    }
  }

  if (receipt.attempt_outcome === 'not_modified') {
    if (fetchRecord?.outcome !== 'not_modified' || fetchRecord?.response_status !== 304) {
      issues.push(issue('NOT_MODIFIED_FETCH_MISMATCH', '/underlying_records/metadata_fetch', '304 reuse requires not_modified metadata-fetch'));
    }
    if (fetchRecord?.response_bytes !== 0 || fetchRecord?.decompressed_bytes !== 0) {
      issues.push(issue('NOT_MODIFIED_HAS_NEW_BYTES', '/underlying_records/metadata_fetch', '304 reuse has zero new bytes'));
    }
    if (capture.capture_ref_id !== fetchRecord?.reused_capture_ref_id) {
      issues.push(issue('NOT_MODIFIED_REUSE_MISMATCH', '/capture/capture_ref_id', '304 reuse must name the reused capture reference'));
    }
  }

  if (receipt.attempt_outcome === 'access_only') {
    if (receipt.purpose !== 'access_probe') {
      issues.push(issue('ACCESS_ONLY_PURPOSE_MISMATCH', '/purpose', 'access_probe'));
    }
    if (capture.raw_sha256 !== null || capture.semantic_sha256 !== null || receipt.observed_rejected_body_sha256 !== null) {
      issues.push(issue('ACCESS_ONLY_HAS_BODY_HASH', '/capture', 'access probes do not capture bodies'));
    }
  }

  if (receipt.attempt_outcome === 'truncated_incomplete' && receipt.schema_validated !== false) {
    issues.push(issue('TRUNCATION_SCHEMA_SUCCESS', '/schema_validated', 'incomplete bytes cannot complete schema validation'));
  }

  if (['captured', 'not_modified'].includes(receipt.attempt_outcome) && receipt.schema_validated === true && receipt.truncated !== false) {
    issues.push(issue('SCHEMA_SUCCESS_WITHOUT_COMPLETE_BYTES', '/schema_validated', 'schema validation requires complete captured bytes'));
  }

  return { valid: issues.length === 0, issues };
}

function copyCapture(captureReference) {
  if (!captureReference) {
    return {
      capture_ref_id: null,
      raw_sha256: null,
      semantic_sha256: null,
      compressed_bytes: null,
      decompressed_bytes: null,
      classification: null,
    };
  }
  return {
    capture_ref_id: captureReference.capture_ref_id,
    raw_sha256: captureReference.raw_sha256,
    semantic_sha256: captureReference.semantic_sha256,
    compressed_bytes: captureReference.compressed_bytes,
    decompressed_bytes: captureReference.decompressed_bytes,
    classification: captureReference.classification,
  };
}

export async function composeEvidenceReceipt(input = {}, options = {}) {
  const issues = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, receipt: null, issues: [issue('RECEIPT_INPUT_NOT_OBJECT', '/', 'composeEvidenceReceipt requires an object')] };
  }

  const requestType = input.request_type;
  const historical = requestType === 'historical_observation';
  const receipt = {
    contract_version: EVIDENCE_RECEIPT_VERSION,
    receipt_id: input.receipt_id ?? 'receipt_composed_pending',
    request_type: requestType,
    route_match: historical
      ? 'unmatched_historical_observation'
      : requestType === 'pre_egress'
        ? 'pre_egress_block'
        : 'matched_descriptor_route',
    observation_label: input.observation_label ?? null,
    source_id: historical ? null : input.source_id ?? null,
    descriptor_id: historical ? null : input.descriptor_id ?? null,
    endpoint_id: historical ? null : input.endpoint_id ?? null,
    template_id: historical ? null : input.template_id ?? null,
    configuration_revision: historical ? null : input.configuration_revision ?? null,
    descriptor_hash: historical ? null : input.descriptor_hash ?? null,
    purpose: historical ? null : input.purpose ?? null,
    expected_content_classes: historical ? [] : [...(input.expected_content_classes ?? [])],
    safe_final_locator: {
      host: input.safe_final_host ?? null,
      path: input.safe_final_path ?? null,
    },
    redirect_count: historical ? null : input.redirect_count ?? null,
    observed_status: input.observed_status ?? null,
    observed_media_type: input.observed_media_type ?? null,
    observed_bytes: input.observed_bytes ?? null,
    truncated: input.truncated === true,
    observed_rejected_body_sha256: input.observed_rejected_body_sha256 ?? null,
    capture: copyCapture(input.capture_reference),
    underlying_records: {
      metadata_fetch: input.metadata_fetch ?? null,
      capture_reference: input.capture_reference ?? null,
    },
    parser: {
      state: input.parser_state ?? 'not_run',
      identity: input.parser_identity ?? null,
    },
    connector_identity: {
      connector_name: historical ? null : input.connector_name ?? null,
      connector_version: historical ? null : input.connector_version ?? null,
    },
    attempt_outcome: input.attempt_outcome,
    payload_access_verified: false,
    schema_validated: input.truncated === true || historical || requestType === 'pre_egress' || input.attempt_outcome === 'typed_failure' || input.attempt_outcome === 'access_only'
      ? false
      : input.schema_validated === true,
    next_action: input.next_action,
    observed_at: input.observed_at,
    truth_boundaries: {
      http_status_is_not_content_success: true,
      catalog_membership_is_not_payload_access: true,
      truncated_bytes_do_not_imply_schema_success: true,
    },
  };

  if (historical) {
    receipt.capture = copyCapture(null);
    receipt.underlying_records.metadata_fetch = null;
    receipt.underlying_records.capture_reference = null;
  }

  if (receipt.receipt_id === 'receipt_composed_pending') {
    receipt.receipt_id = `receipt_${requestType ?? 'unknown'}_${String(input.observed_at ?? 'none').replace(/[^0-9A-Za-z]/g, '').slice(0, 24) || 'pending'}`;
    if (!OPAQUE_ID_PATTERN.test(receipt.receipt_id)) {
      receipt.receipt_id = 'receipt_evidence_composed_v1';
    }
  }

  const validated = await validateEvidenceReceipt(receipt, options);
  issues.push(...validated.issues);
  if (!validated.valid) return { valid: false, receipt: freezeDeep(receipt), issues };
  return { valid: true, receipt: freezeDeep(receipt), issues };
}
