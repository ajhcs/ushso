const TERMINAL_RUN_STATES = new Set(['succeeded', 'succeeded_with_optional_degradation', 'partial_unpublished', 'failed', 'cancelled']);
const REQUIRED_PUBLICATION_FLAGS = [
  'enumerations_complete_and_sealed', 'membership_checkpoint_committed', 'w1_revision_manifest_sealed',
  'references_resolved', 'checksums_verified', 'visibility_verified', 'coverage_reconciled'
];
const RETRY_LIMITS = new Map([
  ['harvest_page', 6], ['normalize_record', 5], ['enrich_schema', 4], ['access_check', 4], ['project_index', 5]
]);
const STAGE_POLICIES = new Map([
  ['harvest_page', [6, 5, 5, 900, 'durable_dlq_and_partial_unpublished']],
  ['normalize_record', [5, 4, 2, 300, 'quarantine_and_durable_dlq']],
  ['enrich_schema', [4, 3, 10, 1800, 'quarantine_and_durable_dlq']],
  ['access_check', [4, 3, 30, 1800, 'typed_stale_or_failed_observation_and_durable_dlq']],
  ['project_index', [5, 4, 2, 300, 'reject_generation_and_durable_dlq']]
]);
const FAILURE_RULES = new Map([
  ['rate_limited', ['retry', 'retry', 'retry', 'consume_shared_budget', true]],
  ['upstream_5xx', ['retry', 'retry', 'retry', 'consume_shared_budget', true]],
  ['timeout', ['retry', 'retry', 'retry', 'consume_shared_budget', true]],
  ['dns_failure', ['retry', 'retry', 'retry', 'consume_shared_budget', true]],
  ['tls_failure', ['retry', 'retry', 'retry', 'consume_shared_budget', true]],
  ['catalog_auth_misconfigured', ['pause_source', 'pause_source', 'pause_source', 'open_source_circuit', false]],
  ['expected_access_restriction', ['typed_observation', 'fail_enumeration', 'typed_observation', 'none', false]],
  ['not_found', ['typed_observation', 'fail_enumeration', 'typed_observation', 'none', false]],
  ['gone', ['typed_observation', 'fail_enumeration', 'typed_observation', 'none', false]],
  ['redirect_unapproved', ['quarantine', 'quarantine', 'quarantine', 'none', false]],
  ['schema_drift', ['quarantine', 'quarantine', 'quarantine', 'open_source_circuit', false]],
  ['parse_failure', ['quarantine', 'quarantine', 'quarantine', 'none', false]],
  ['unexpected_content_type', ['quarantine', 'quarantine', 'quarantine', 'none', false]],
  ['response_too_large', ['quarantine', 'quarantine', 'quarantine', 'none', false]],
  ['policy_blocked', ['pause_source', 'pause_source', 'pause_source', 'open_source_circuit', false]],
  ['canonical_invariant_failure', ['quarantine', 'quarantine', 'quarantine', 'none', false]],
  ['internal_failure', ['retry', 'retry', 'retry', 'consume_shared_budget', true]],
  ['cursor_expired', ['fail_enumeration', 'fail_enumeration', 'quarantine', 'none', false]]
]);

const STATES = {
  run: ['scheduled', 'starting', 'enumerating', 'enumerated', 'normalizing', 'projecting', 'published', 'succeeded', 'succeeded_with_optional_degradation', 'partial_unpublished', 'failed', 'cancelled'],
  job: ['pending', 'leased', 'succeeded', 'retry_wait', 'quarantined', 'dead'],
  outbox: ['pending', 'leased', 'published', 'retry_wait', 'dead'],
  source: ['active', 'pause_requested', 'draining', 'paused', 'auth_blocked', 'schema_drift', 'retired']
};

const BASE_TRANSITIONS = {
  run: new Set([
    'scheduled>starting', 'starting>enumerating', 'enumerating>enumerated', 'enumerated>normalizing',
    'normalizing>projecting', 'projecting>published', 'published>succeeded', 'published>succeeded_with_optional_degradation',
    'scheduled>failed', 'scheduled>cancelled', 'starting>failed', 'starting>cancelled', 'enumerating>failed',
    'enumerating>cancelled', 'enumerating>partial_unpublished', 'enumerated>failed', 'enumerated>cancelled',
    'enumerated>partial_unpublished', 'normalizing>failed', 'normalizing>cancelled', 'normalizing>partial_unpublished',
    'projecting>failed', 'projecting>cancelled', 'projecting>partial_unpublished', 'published>failed', 'published>cancelled'
  ]),
  job: new Set(['pending>leased', 'leased>succeeded', 'leased>retry_wait', 'leased>quarantined', 'leased>dead', 'leased>pending', 'retry_wait>pending']),
  outbox: new Set(['pending>leased', 'leased>published', 'leased>retry_wait', 'leased>dead', 'leased>pending', 'retry_wait>pending']),
  source: new Set([
    'active>pause_requested', 'active>auth_blocked', 'active>schema_drift', 'active>retired',
    'pause_requested>draining', 'draining>paused', 'paused>active', 'paused>retired',
    'auth_blocked>pause_requested', 'auth_blocked>active', 'schema_drift>pause_requested', 'schema_drift>active'
  ])
};

function issue(code, pointer, detail) {
  return { code, pointer, detail };
}

function time(value) {
  return value === null || value === undefined ? null : Date.parse(value);
}

function validateFourClocks(clocks, pointer = '/clocks') {
  const issues = [];
  const coverage = clocks.data_coverage;
  if (coverage.state === 'known') {
    if (coverage.start === null || coverage.end === null || ['unknown', 'not_applicable'].includes(coverage.semantics)) issues.push(issue('FOUR_CLOCK_COVERAGE_INCOMPLETE', `${pointer}/data_coverage`, 'known coverage needs explicit bounds and semantics'));
    else if (coverage.start > coverage.end) issues.push(issue('FOUR_CLOCK_COVERAGE_REVERSED', `${pointer}/data_coverage`, 'coverage start is after end'));
  } else {
    const expected = coverage.state === 'unknown' ? 'unknown' : 'not_applicable';
    if (coverage.start !== null || coverage.end !== null || coverage.semantics !== expected) issues.push(issue('FOUR_CLOCK_COVERAGE_STATE_MISMATCH', `${pointer}/data_coverage`, 'unknown/not-applicable coverage cannot borrow publisher or observation time'));
  }
  const publisher = clocks.publisher_time;
  if (publisher.state === 'known' && publisher.released_at === null && publisher.modified_at === null) issues.push(issue('FOUR_CLOCK_PUBLISHER_TIME_MISSING', `${pointer}/publisher_time`, 'known publisher time needs release or modification time'));
  if (publisher.state !== 'known' && (publisher.released_at !== null || publisher.modified_at !== null)) issues.push(issue('FOUR_CLOCK_PUBLISHER_STATE_MISMATCH', `${pointer}/publisher_time`, 'unknown/not-applicable publisher time must remain null'));
  if (time(clocks.recorded_at) < time(clocks.observed_at)) issues.push(issue('FOUR_CLOCK_SYSTEM_BEFORE_OBSERVATION', `${pointer}/recorded_at`, 'system recording cannot precede observation'));
  if (clocks.superseded_at !== null && time(clocks.superseded_at) < time(clocks.recorded_at)) issues.push(issue('FOUR_CLOCK_SUPERSESSION_BEFORE_RECORD', `${pointer}/superseded_at`, 'supersession cannot precede recording'));
  return issues;
}

function validateSourceDescriptor(value) {
  const issues = [];
  const endpointIds = value.endpoints.map(item => item.endpoint_id);
  if (new Set(endpointIds).size !== endpointIds.length) issues.push(issue('ENDPOINT_ID_DUPLICATE', '/endpoints', 'endpoint IDs must be unique'));
  const allowedHosts = new Set(value.allowed_hosts.map(host => host.toLowerCase()));
  for (const [index, endpoint] of value.endpoints.entries()) {
    const parsed = new URL(endpoint.base_url);
    if (!allowedHosts.has(parsed.hostname.toLowerCase())) issues.push(issue('ENDPOINT_HOST_NOT_ALLOWLISTED', `/endpoints/${index}/base_url`, parsed.hostname));
    const routeIds = endpoint.routes.map(route => route.template_id);
    if (new Set(routeIds).size !== routeIds.length) issues.push(issue('ROUTE_TEMPLATE_ID_DUPLICATE', `/endpoints/${index}/routes`, 'route template IDs must be unique per endpoint'));
    for (const [routeIndex, route] of endpoint.routes.entries()) {
      for (const required of ['source_data_payload', 'query_execution', 'data_download', 'form_submission', 'login']) {
        if (!route.forbidden_route_classes.includes(required)) issues.push(issue('ROUTE_FORBIDDEN_CLASS_MISSING', `/endpoints/${index}/routes/${routeIndex}/forbidden_route_classes`, required));
      }
      if (route.purpose === 'access_probe' && route.method !== 'HEAD') issues.push(issue('ACCESS_PROBE_METHOD_OVERBROAD', `/endpoints/${index}/routes/${routeIndex}/method`, 'access probes are HEAD-only in v1'));
    }
  }
  const endpointSet = new Set(endpointIds);
  const scopeIds = value.scopes.map(item => item.scope_id);
  if (new Set(scopeIds).size !== scopeIds.length) issues.push(issue('SCOPE_ID_DUPLICATE', '/scopes', 'scope IDs must be unique'));
  for (const [index, scope] of value.scopes.entries()) for (const endpointId of scope.endpoint_ids) {
    if (!endpointSet.has(endpointId)) issues.push(issue('SCOPE_ENDPOINT_UNRESOLVED', `/scopes/${index}/endpoint_ids`, endpointId));
  }
  if (value.origin_policy.minimum_retry_delay_seconds > value.origin_policy.maximum_retry_delay_seconds) issues.push(issue('RETRY_DELAY_BOUNDS_REVERSED', '/origin_policy', 'minimum exceeds maximum'));
  if (value.refresh_policy.jitter_seconds >= value.refresh_policy.interval_seconds) issues.push(issue('REFRESH_JITTER_UNBOUNDED', '/refresh_policy/jitter_seconds', 'jitter must be shorter than refresh interval'));
  if (value.refresh_policy.stale_after_seconds < value.refresh_policy.interval_seconds) issues.push(issue('STALE_WINDOW_TOO_SHORT', '/refresh_policy/stale_after_seconds', 'staleness cannot precede the next scheduled refresh'));
  if (value.source_state === 'active' && !['approved', 'approved_with_conditions'].includes(value.legal_review.state)) issues.push(issue('ACTIVE_SOURCE_LEGAL_REVIEW_INCOMPLETE', '/legal_review/state', value.legal_review.state));
  if (value.capture_retention_policy.active_days !== 90 && (!value.capture_retention_policy.override_rationale || !value.capture_retention_policy.review_at)) issues.push(issue('CAPTURE_RETENTION_OVERRIDE_UNREVIEWED', '/capture_retention_policy', 'non-default retention requires rationale and review date'));
  return issues;
}

function validateHarvestPlan(value) {
  const issues = [];
  if ((value.prior_checkpoint_id === null) !== (value.prior_checkpoint_digest === null)) issues.push(issue('CHECKPOINT_PIN_INCOMPLETE', '/prior_checkpoint_id', 'checkpoint ID and digest must be paired'));
  if (value.conditional_http.enabled && value.conditional_http.validator_source === 'none') issues.push(issue('CONDITIONAL_HTTP_VALIDATOR_SOURCE_MISSING', '/conditional_http/validator_source', 'enabled conditional requests need a validator source'));
  if (!value.conditional_http.enabled && value.conditional_http.validator_source !== 'none') issues.push(issue('CONDITIONAL_HTTP_DISABLED_WITH_SOURCE', '/conditional_http/validator_source', 'disabled conditional requests cannot name a validator source'));
  if (time(value.bounded_by.deadline_at) <= time(value.created_at)) issues.push(issue('HARVEST_PLAN_DEADLINE_INVALID', '/bounded_by/deadline_at', 'deadline must follow plan creation'));
  return issues;
}

function validateFailurePolicy(value) {
  const issues = [];
  const stages = new Map();
  for (const [index, policy] of value.stage_policies.entries()) {
    if (stages.has(policy.stage)) issues.push(issue('FAILURE_POLICY_STAGE_DUPLICATE', `/stage_policies/${index}/stage`, policy.stage));
    stages.set(policy.stage, policy);
    const expected = STAGE_POLICIES.get(policy.stage);
    const observed = [policy.maximum_delivery_attempts, policy.transport_max_retries, policy.minimum_delay_seconds, policy.maximum_delay_seconds, policy.exhausted_outcome];
    if (!expected || expected.some((part, partIndex) => part !== observed[partIndex])) issues.push(issue('FAILURE_POLICY_STAGE_MISMATCH', `/stage_policies/${index}`, policy.stage));
    if (policy.transport_max_retries !== policy.maximum_delivery_attempts - 1) issues.push(issue('TRANSPORT_RETRY_COUNT_MISMATCH', `/stage_policies/${index}/transport_max_retries`, policy.stage));
  }
  for (const stage of STAGE_POLICIES.keys()) if (!stages.has(stage)) issues.push(issue('FAILURE_POLICY_STAGE_MISSING', '/stage_policies', stage));
  const rules = new Map();
  for (const [index, rule] of value.failure_rules.entries()) {
    if (rules.has(rule.failure_type)) issues.push(issue('FAILURE_POLICY_RULE_DUPLICATE', `/failure_rules/${index}/failure_type`, rule.failure_type));
    rules.set(rule.failure_type, rule);
    const expected = FAILURE_RULES.get(rule.failure_type);
    const observed = [rule.default_disposition, rule.catalog_enumeration_disposition, rule.exact_target_disposition, rule.circuit_effect, rule.transport_retry_allowed];
    if (!expected || expected.some((part, partIndex) => part !== observed[partIndex])) issues.push(issue('FAILURE_POLICY_DISPOSITION_MISMATCH', `/failure_rules/${index}`, rule.failure_type));
  }
  for (const failureType of FAILURE_RULES.keys()) if (!rules.has(failureType)) issues.push(issue('FAILURE_POLICY_RULE_MISSING', '/failure_rules', failureType));
  return issues;
}

function validateHarvestRun(value) {
  const issues = [];
  const expectedKey = `run:${value.endpoint_id}:${value.scheduled_slot}:${value.mode}:r${value.source_configuration_revision}`;
  if (value.run_idempotency_key !== expectedKey) issues.push(issue('RUN_IDEMPOTENCY_KEY_MISMATCH', '/run_idempotency_key', expectedKey));
  const expectedWorkflow = `harvest-${value.run_id}-${value.active_attempt}`;
  if (value.workflow.instance_id !== expectedWorkflow) issues.push(issue('WORKFLOW_INSTANCE_ID_MISMATCH', '/workflow/instance_id', expectedWorkflow));
  if (time(value.workflow.retention_expires_at) <= time(value.workflow.created_at)) issues.push(issue('WORKFLOW_RETENTION_INVALID', '/workflow/retention_expires_at', 'retention must expire after instance creation'));
  const terminal = TERMINAL_RUN_STATES.has(value.state);
  if (terminal !== (value.terminal_at !== null)) issues.push(issue('RUN_TERMINAL_TIME_MISMATCH', '/terminal_at', 'terminal states require terminal_at; active states forbid it'));
  if (['enumerated', 'normalizing', 'projecting', 'published', 'succeeded', 'succeeded_with_optional_degradation'].includes(value.state) && value.enumeration_seal_id === null) issues.push(issue('RUN_ENUMERATION_SEAL_MISSING', '/enumeration_seal_id', value.state));
  if (['published', 'succeeded', 'succeeded_with_optional_degradation'].includes(value.state) && value.candidate_publication_id === null) issues.push(issue('RUN_PUBLICATION_ID_MISSING', '/candidate_publication_id', value.state));
  if (value.mode === 'operator_replay' && (value.replay_of_run_id === null || value.replay_of_run_id === value.run_id)) issues.push(issue('RUN_REPLAY_LINEAGE_MISSING', '/replay_of_run_id', 'operator replay requires a distinct terminal parent run'));
  if (value.mode !== 'operator_replay' && value.replay_of_run_id !== null) issues.push(issue('RUN_REPLAY_LINEAGE_UNEXPECTED', '/replay_of_run_id', value.mode));
  return issues;
}

function expectedJobKey(value) {
  const identity = value.identity;
  switch (value.job_type) {
    case 'harvest_page': return identity.cursor_sha256 ? `page:${value.run_id}:${identity.cursor_sha256}` : null;
    case 'normalize_record': return identity.capture_sha256 && identity.normalizer_version ? `normalize:${identity.capture_sha256}:${identity.normalizer_version}` : null;
    case 'enrich_schema': return identity.canonical_revision_id && identity.recipe_version ? `schema:${identity.canonical_revision_id}:${identity.recipe_version}` : null;
    case 'access_check': return identity.distribution_id && identity.recipe_version && identity.scheduled_slot ? `access:${identity.distribution_id}:${identity.recipe_version}:${identity.scheduled_slot}` : null;
    case 'project_index': return identity.canonical_id && identity.canonical_revision_id && identity.projection_version ? `projection:${identity.canonical_id}:${identity.canonical_revision_id}:${identity.projection_version}` : null;
    default: return null;
  }
}

function validateIngestJob(value) {
  const issues = [];
  const expectedKey = expectedJobKey(value);
  if (expectedKey === null) issues.push(issue('JOB_IDEMPOTENCY_INPUT_MISSING', '/identity', value.job_type));
  else if (value.idempotency_key !== expectedKey) issues.push(issue('JOB_IDEMPOTENCY_KEY_MISMATCH', '/idempotency_key', expectedKey));
  if (value.maximum_delivery_attempts !== RETRY_LIMITS.get(value.job_type)) issues.push(issue('JOB_RETRY_LIMIT_MISMATCH', '/maximum_delivery_attempts', `${value.job_type}:${RETRY_LIMITS.get(value.job_type)}`));
  if (value.attempt_count > value.maximum_delivery_attempts) issues.push(issue('JOB_RETRY_BUDGET_EXCEEDED', '/attempt_count', 'attempt count exceeds budget'));
  if (value.delivery_fence.run_attempt !== value.active_run_attempt) issues.push(issue('STALE_RUN_ATTEMPT', '/delivery_fence/run_attempt', `active:${value.active_run_attempt}`));
  if (value.state === 'leased') {
    if (value.lease === null) issues.push(issue('LEASE_REQUIRED', '/lease', 'leased job needs a lease'));
    else {
      if (value.delivery_fence.lease_epoch !== value.lease.epoch) issues.push(issue('STALE_LEASE_EPOCH', '/delivery_fence/lease_epoch', `active:${value.lease.epoch}`));
      if (time(value.lease.expires_at) <= time(value.lease.acquired_at)) issues.push(issue('LEASE_WINDOW_INVALID', '/lease/expires_at', 'lease expiry must follow acquisition'));
    }
  } else if (value.lease !== null) issues.push(issue('LEASE_PRESENT_OUTSIDE_LEASED_STATE', '/lease', value.state));
  if ((value.attempt_count === 0) !== (value.first_attempt_at === null)) issues.push(issue('JOB_FIRST_ATTEMPT_TIME_MISMATCH', '/first_attempt_at', 'zero attempts iff first_attempt_at is null'));
  if (value.state === 'retry_wait' && value.next_eligible_at === null) issues.push(issue('RETRY_ELIGIBILITY_MISSING', '/next_eligible_at', 'retry_wait needs next eligible time'));
  return issues;
}

function validateIngestAttempt(value) {
  const issues = [];
  if (value.delivery_attempt > value.maximum_delivery_attempts) issues.push(issue('ATTEMPT_RETRY_BUDGET_EXCEEDED', '/delivery_attempt', 'delivery attempt exceeds policy'));
  if (time(value.started_at) < time(value.first_attempt_at)) issues.push(issue('ATTEMPT_BEFORE_FIRST_ATTEMPT', '/started_at', 'attempt precedes first attempt'));
  if (value.finished_at !== null && time(value.finished_at) < time(value.started_at)) issues.push(issue('ATTEMPT_TIME_REVERSED', '/finished_at', 'finish precedes start'));
  const retryAction = value.transport_action === 'retry_after_rollback';
  const reledgerAction = value.transport_action === 'ack_reledgered_after_commit';
  if ((retryAction || reledgerAction) && value.failure === null) issues.push(issue('RETRY_WITHOUT_FAILURE', '/failure', value.transport_action));
  if (retryAction && value.database_transaction_committed) issues.push(issue('TRANSPORT_RETRY_AFTER_COMMIT', '/transport_action', 'direct retry is only valid after rollback/no effect'));
  if (reledgerAction && (!value.database_transaction_committed || value.next_eligible_at === null)) issues.push(issue('RELEDGER_RETRY_NOT_DURABLE', '/transport_action', 'ack-reledger requires commit and next eligibility'));
  if (value.transport_action === 'ack_after_commit' && !value.database_transaction_committed) issues.push(issue('ACK_BEFORE_DATABASE_COMMIT', '/database_transaction_committed', 'ack requires committed transaction'));
  if (value.durable_dead_letter_id !== null && (!value.database_transaction_committed || value.transport_action !== 'ack_after_commit')) issues.push(issue('DEAD_LETTER_NOT_DURABLE_BEFORE_ACK', '/durable_dead_letter_id', 'dead letter must commit before ack'));
  return issues;
}

function validateCheckpoint(value) {
  const issues = [];
  const position = value.position;
  const fields = [position.publisher_modified_at, position.native_id, position.opaque_cursor_ref_id, position.full_enumeration_sequence].filter(item => item !== null);
  if (fields.length === 0) issues.push(issue('CHECKPOINT_POSITION_EMPTY', '/position', value.strategy));
  if (value.strategy === 'modified_at_native_id' && (position.publisher_modified_at === null || position.native_id === null)) issues.push(issue('CHECKPOINT_MODIFIED_NATIVE_ID_INCOMPLETE', '/position', 'strategy requires both values'));
  if (value.strategy === 'opaque_cursor' && position.opaque_cursor_ref_id === null) issues.push(issue('CHECKPOINT_CURSOR_REFERENCE_MISSING', '/position/opaque_cursor_ref_id', 'opaque cursors are referenced, never embedded'));
  if (value.strategy === 'full_snapshot' && position.full_enumeration_sequence === null) issues.push(issue('CHECKPOINT_FULL_SEQUENCE_MISSING', '/position/full_enumeration_sequence', 'full snapshot needs sequence'));
  if (value.state === 'committed' && (!value.downstream_outbox_committed || value.committed_at === null)) issues.push(issue('CHECKPOINT_COMMIT_NOT_ATOMIC_WITH_OUTBOX', '/', 'committed checkpoint requires durable downstream work and commit time'));
  if (value.state === 'proposed' && (value.downstream_outbox_committed || value.committed_at !== null)) issues.push(issue('CHECKPOINT_PROPOSAL_ALREADY_COMMITTED', '/', 'proposal cannot claim durable commit'));
  return issues;
}

function validateCapture(value) {
  const issues = validateFourClocks(value.clocks);
  const keyHash = value.r2_key.split('/').at(-1);
  const keyPrefix = value.r2_key.split('/').at(-2);
  if (keyHash !== value.raw_sha256 || keyPrefix !== value.raw_sha256.slice(0, 2)) issues.push(issue('CAPTURE_CONTENT_ADDRESS_MISMATCH', '/r2_key', value.raw_sha256));
  const locator = new URL(value.source_locator.redacted_locator);
  if (locator.search || locator.username || locator.password) issues.push(issue('CAPTURE_LOCATOR_SECRET_RISK', '/source_locator/redacted_locator', 'query/userinfo must be redacted'));
  if (locator.hostname.toLowerCase() !== value.source_locator.final_host.toLowerCase()) issues.push(issue('CAPTURE_FINAL_HOST_MISMATCH', '/source_locator/final_host', locator.hostname));
  if (value.safe_response_headers.content_length !== null && value.safe_response_headers.content_length !== value.compressed_bytes) issues.push(issue('CAPTURE_CONTENT_LENGTH_MISMATCH', '/safe_response_headers/content_length', `${value.compressed_bytes}`));
  if (value.decompressed_bytes < value.compressed_bytes && value.media_type !== 'application/json') issues.push(issue('CAPTURE_BYTE_ACCOUNTING_INVALID', '/decompressed_bytes', 'decompressed bytes cannot be smaller for this fixture class'));
  if (value.captured_at !== value.clocks.observed_at) issues.push(issue('CAPTURE_OBSERVATION_CLOCK_MISMATCH', '/captured_at', value.clocks.observed_at));
  return issues;
}

function validateMetadataFetch(value) {
  const issues = [];
  const validatorsPresent = value.request_validators.etag !== null || value.request_validators.last_modified !== null;
  if (value.outcome === 'not_modified') {
    if (!validatorsPresent || value.response_status !== 304 || value.reused_capture_ref_id === null || value.capture_ref_id !== null || value.failure !== null || value.response_bytes !== 0 || value.decompressed_bytes !== 0) issues.push(issue('CONDITIONAL_304_INVALID', '/', '304 needs request validators, zero body, and one reused capture'));
  } else if (value.outcome === 'captured') {
    if (value.response_status !== 200 || value.capture_ref_id === null || value.reused_capture_ref_id !== null || value.failure !== null || value.response_bytes < 1 || value.decompressed_bytes < 1) issues.push(issue('CAPTURED_FETCH_INVALID', '/', 'captured fetch needs 200, bytes, and a new capture reference'));
  } else if (value.capture_ref_id !== null || value.reused_capture_ref_id !== null || value.failure === null) issues.push(issue('TYPED_FAILURE_FETCH_INVALID', '/', 'typed failure cannot create/reuse a capture'));
  if (['not_found', 'gone'].includes(value.failure?.failure_type) && ['catalog_root', 'collection', 'pagination_cursor'].includes(value.target_class) && value.failure.retry_class !== 'enumeration_terminal') issues.push(issue('COLLECTION_ABSENCE_MISCLASSIFIED', '/failure/retry_class', 'root/list/cursor absence must fail enumeration'));
  return issues;
}

function validateEventLedger(value) {
  const issues = [];
  if (value.record_kind === 'outbox_event') {
    if (value.attempt_count > value.maximum_delivery_attempts) issues.push(issue('OUTBOX_RETRY_BUDGET_EXCEEDED', '/attempt_count', 'attempt count exceeds budget'));
    if (value.state === 'leased') {
      if (value.lease === null) issues.push(issue('LEASE_REQUIRED', '/lease', 'leased outbox needs lease'));
      else if (time(value.lease.expires_at) <= time(value.lease.acquired_at)) issues.push(issue('LEASE_WINDOW_INVALID', '/lease/expires_at', 'lease expiry must follow acquisition'));
    } else if (value.lease !== null) issues.push(issue('LEASE_PRESENT_OUTSIDE_LEASED_STATE', '/lease', value.state));
    if (value.state === 'published' && value.published_at === null) issues.push(issue('OUTBOX_PUBLISHED_TIME_MISSING', '/published_at', 'published event needs time'));
    if (value.state !== 'published' && value.published_at !== null) issues.push(issue('OUTBOX_PUBLISHED_TIME_UNEXPECTED', '/published_at', value.state));
  } else if (value.record_kind === 'durable_dead_letter') {
    if (value.failure === null) issues.push(issue('DEAD_LETTER_FAILURE_MISSING', '/failure', 'durable dead letter needs typed failure'));
    if (value.transport_delivery_attempts < value.database_attempts) issues.push(issue('DEAD_LETTER_ATTEMPT_ACCOUNTING_INVALID', '/database_attempts', 'DB attempts cannot exceed deliveries'));
  } else if (value.record_kind === 'replay_lineage') {
    if (value.new_run_id === value.original_run_id || value.new_event_id === value.original_event_id) issues.push(issue('DLQ_REPLAY_RESETS_HISTORY', '/', 'replay must allocate new run and event IDs'));
  }
  return issues;
}

function validateEnumerationControl(value) {
  const issues = [];
  if (value.record_kind === 'enumeration_seal') {
    if (value.pages_committed > value.pages_discovered || value.discoveries_committed > value.items_discovered) issues.push(issue('ENUMERATION_COMMIT_COUNT_EXCEEDS_DISCOVERY', '/', 'committed counts exceed discovered counts'));
    if (value.status === 'sealed') {
      if (value.pages_discovered !== value.pages_committed || value.items_discovered !== value.discoveries_committed || value.page_dead_letter_count !== 0 || value.cursor_expired || value.population_digest === null || value.completeness_evidence_ref_id === null || value.sealed_at === null) issues.push(issue('ENUMERATION_SEAL_INCOMPLETE', '/', 'sealed enumeration must be complete, evidenced, and free of page DLQs/cursor expiry'));
    } else if (value.sealed_at !== null) issues.push(issue('ENUMERATION_SEALED_AT_UNEXPECTED', '/sealed_at', value.status));
    if (value.status === 'cursor_expired' && !value.cursor_expired) issues.push(issue('CURSOR_EXPIRY_STATE_MISMATCH', '/cursor_expired', 'expired state requires cursor_expired=true'));
  } else if (value.record_kind === 'publication_barrier') {
    const publicationOutcome = ['published', 'succeeded', 'succeeded_with_optional_degradation'].includes(value.run_outcome);
    const allFlags = REQUIRED_PUBLICATION_FLAGS.every(field => value[field]);
    const countsMatch = value.normalization_terminal_count === value.observed_revision_count && value.projection_acknowledgement_count === value.eligible_projection_count;
    if (publicationOutcome && (!allFlags || !countsMatch || value.required_dead_letter_count !== 0 || value.candidate_publication_id === null)) issues.push(issue('PUBLICATION_BARRIER_INCOMPLETE', '/', 'publication requires every seal, decision, acknowledgement, reference, checksum, visibility, and coverage barrier'));
    if (value.run_outcome === 'succeeded' && value.optional_degradations.length > 0) issues.push(issue('OPTIONAL_DEGRADATION_OUTCOME_MISMATCH', '/optional_degradations', 'plain success cannot contain degradation'));
    if (value.run_outcome === 'succeeded_with_optional_degradation' && value.optional_degradations.length === 0) issues.push(issue('OPTIONAL_DEGRADATION_EVIDENCE_MISSING', '/optional_degradations', 'degraded success needs policy-bound details'));
    if (!publicationOutcome && value.active_publication_id !== value.last_known_good_publication_id) issues.push(issue('LAST_KNOWN_GOOD_REPLACED_BY_INCOMPLETE_RUN', '/active_publication_id', value.last_known_good_publication_id));
  } else if (value.record_kind === 'source_control') {
    const transition = validateTransition('source', value.previous_state, value.state, {
      lease_expired: false,
      retry_due: false,
      drain_reconciled: value.in_flight_work_count === 0,
      audit_present: value.requested_by_audit_event_id !== null,
      remediation_present: value.remediation_evidence_ref_id !== null,
      new_configuration_revision: value.configuration_revision > 1
    });
    if (!transition.allowed) issues.push(issue(transition.code, '/state', `${value.previous_state}>${value.state}`));
    if (value.state === 'paused' && (value.drain_completed_at === null || value.in_flight_work_count !== 0 || value.new_fetches_after_pause_effective !== 0)) issues.push(issue('PAUSE_DRAIN_INCOMPLETE', '/', 'paused requires completed drain, zero in-flight work, and zero new fetches'));
    if (['pause_requested', 'draining', 'paused'].includes(value.state) && value.pause_requested_at === null) issues.push(issue('PAUSE_AUDIT_TIME_MISSING', '/pause_requested_at', value.state));
  }
  return issues;
}

export function validateTransition(machine, from, to, context = {}) {
  if (!Object.hasOwn(STATES, machine)) return { allowed: false, code: 'STATE_MACHINE_UNKNOWN' };
  if (!STATES[machine].includes(from) || !STATES[machine].includes(to)) return { allowed: false, code: 'STATE_UNKNOWN' };
  if (!BASE_TRANSITIONS[machine].has(`${from}>${to}`)) return { allowed: false, code: 'STATE_TRANSITION_INVALID' };
  if ((machine === 'job' || machine === 'outbox') && from === 'leased' && to === 'pending' && context.lease_expired !== true) return { allowed: false, code: 'LEASE_NOT_EXPIRED' };
  if ((machine === 'job' || machine === 'outbox') && from === 'retry_wait' && to === 'pending' && context.retry_due !== true) return { allowed: false, code: 'RETRY_NOT_DUE' };
  if (machine === 'source' && from === 'draining' && to === 'paused' && (context.drain_reconciled !== true || context.audit_present !== true)) return { allowed: false, code: 'PAUSE_DRAIN_INCOMPLETE' };
  if (machine === 'source' && from === 'paused' && to === 'active' && (context.drain_reconciled !== true || context.audit_present !== true)) return { allowed: false, code: 'SOURCE_RESUME_UNAUDITED' };
  if (machine === 'source' && ['auth_blocked', 'schema_drift'].includes(from) && to === 'active' && (context.remediation_present !== true || context.new_configuration_revision !== true || context.audit_present !== true)) return { allowed: false, code: 'SOURCE_REMEDIATION_MISSING' };
  return { allowed: true, code: 'ALLOWED' };
}

export function stateDefinitions() {
  return structuredClone(STATES);
}

const HANDLERS = new Map([
  ['source-descriptor.schema.json', validateSourceDescriptor],
  ['failure-policy.schema.json', validateFailurePolicy],
  ['harvest-plan.schema.json', validateHarvestPlan],
  ['harvest-run.schema.json', validateHarvestRun],
  ['ingest-job.schema.json', validateIngestJob],
  ['ingest-attempt.schema.json', validateIngestAttempt],
  ['checkpoint.schema.json', validateCheckpoint],
  ['capture-reference.schema.json', validateCapture],
  ['metadata-fetch.schema.json', validateMetadataFetch],
  ['event-ledger.schema.json', validateEventLedger],
  ['enumeration-control.schema.json', validateEnumerationControl]
]);

export function validateRecordSemantics(schemaName, value) {
  const handler = HANDLERS.get(schemaName);
  if (!handler) return [issue('SEMANTIC_VALIDATOR_MISSING', '/', schemaName)];
  return handler(value);
}

export function validateRecordSet(records) {
  const issues = [];
  const processed = records.filter(record => record.schema === 'event-ledger.schema.json' && record.value.record_kind === 'processed_event');
  const seenProcessed = new Map();
  for (const record of processed) {
    const key = `${record.value.consumer_name}:${record.value.event_id}`;
    const prior = seenProcessed.get(key);
    if (prior && (prior.business_effect_digest !== record.value.business_effect_digest || prior.effect_idempotency_key !== record.value.effect_idempotency_key)) issues.push(issue('DUPLICATE_DELIVERY_EFFECT_CONFLICT', '/', key));
    else seenProcessed.set(key, record.value);
  }
  const seals = new Map(records.filter(record => record.schema === 'enumeration-control.schema.json' && record.value.record_kind === 'enumeration_seal').map(record => [record.value.enumeration_seal_id, record.value]));
  for (const record of records.filter(record => record.schema === 'checkpoint.schema.json' && record.value.state === 'committed')) {
    const seal = seals.get(record.value.enumeration_seal_id);
    if (!seal || seal.status !== 'sealed') issues.push(issue('CHECKPOINT_ADVANCES_WITHOUT_SEALED_ENUMERATION', '/enumeration_seal_id', record.value.enumeration_seal_id));
  }
  const deadLetters = new Map(records.filter(record => record.schema === 'event-ledger.schema.json' && record.value.record_kind === 'durable_dead_letter').map(record => [record.value.dead_letter_id, record.value]));
  for (const record of records.filter(record => record.schema === 'event-ledger.schema.json' && record.value.record_kind === 'replay_lineage')) {
    const dead = deadLetters.get(record.value.original_dead_letter_id);
    if (!dead || dead.original_event_id !== record.value.original_event_id || dead.run_id !== record.value.original_run_id || dead.retry_policy_version !== record.value.original_retry_policy_version) issues.push(issue('DLQ_REPLAY_LINEAGE_UNRESOLVED', '/', record.value.replay_id));
  }
  return issues;
}

export const semantics = Object.freeze({ validateRecordSemantics, validateRecordSet, validateTransition, stateDefinitions });
