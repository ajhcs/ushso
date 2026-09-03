const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,127}$/u;
const CURSOR = /^[A-Za-z0-9._~-]{16,2048}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

const CAPABILITIES = new Set([
  'search_assets',
  'get_asset',
  'get_access_plan',
  'get_retrieval_recipe',
  'get_variables',
  'get_join_routes',
  'compare_assets',
  'get_coverage_status',
  'plan_research',
]);
const RESULT_STATES = new Set(['complete', 'partial', 'empty', 'unknown', 'unavailable', 'gated', 'disabled']);
const RESULT_STATE_BY_CAPABILITY = Object.freeze({
  search_assets: new Set(['complete', 'partial', 'empty']),
  get_asset: new Set(['complete', 'partial']),
  get_access_plan: new Set(['complete']),
  get_retrieval_recipe: new Set(['complete']),
  get_variables: new Set(['complete', 'partial', 'empty']),
  get_join_routes: new Set(['complete', 'partial', 'empty']),
  compare_assets: new Set(['complete']),
  get_coverage_status: new Set(['complete', 'partial', 'empty']),
  plan_research: new Set([]),
});
const ERROR_STATES = new Set(['unknown', 'unavailable', 'gated', 'disabled']);
const ERROR_CODES = new Set([
  'invalid_input',
  'record_unavailable_in_generation',
  'schema_context_required',
  'generation_mismatch',
  'generation_unavailable',
  'cursor_expired',
  'clarification_token_invalid',
  'clarification_expired',
  'coverage_unknown',
  'route_not_documented',
  'comparison_limit_exceeded',
  'response_limit_exceeded',
  'planner_unavailable',
  'rate_limited',
  'service_unavailable',
]);

const ENUMS = Object.freeze({
  grain: new Set(['facility', 'campus', 'organization', 'system', 'county', 'state', 'national', 'mixed', 'unknown']),
  accessClass: new Set(['public', 'registration', 'application', 'dua', 'licensed', 'paid', 'report_only', 'unknown']),
  machineReadiness: new Set(['human_only', 'downloadable', 'api_documented', 'schema_indexed', 'retrieval_ready', 'join_ready', 'unknown']),
  evidenceState: new Set(['unknown', 'candidate', 'ambiguous', 'documented', 'observed', 'executed', 'proven']),
  stalenessState: new Set(['current', 'stale', 'unknown', 'not_applicable']),
  lifecycleState: new Set(['active', 'inactive', 'superseded', 'withdrawn', 'retired', 'excluded', 'unknown']),
  assetKind: new Set(['dataset', 'product', 'report_series', 'registry', 'collection', 'crosswalk', 'methodology', 'other']),
  identityState: new Set(['source_scoped', 'authoritatively_resolved', 'review_pending', 'conflicted', 'unknown']),
  familyState: new Set(['not_grouped', 'candidate', 'accepted', 'conflicted', 'unknown']),
  completeness: new Set(['complete', 'partial', 'unknown', 'unavailable']),
  interface: new Set(['download', 'api', 'query_service', 'web_interface', 'application', 'unknown']),
  requestMethod: new Set(['GET', 'HEAD', 'POST', 'SOURCE_DEFINED', 'unknown']),
  authenticationType: new Set(['none', 'api_key', 'oauth', 'session', 'application_approval', 'source_defined', 'unknown']),
  compression: new Set(['none', 'gzip', 'zip', 'source_defined', 'unknown']),
  sizeCategory: new Set(['small', 'medium', 'large', 'very_large', 'source_determined', 'unknown']),
  parameterLocation: new Set(['path', 'query', 'header', 'body', 'form']),
  paginationKind: new Set(['none', 'page', 'offset', 'cursor', 'link_header', 'source_defined', 'unknown']),
  semanticRole: new Set(['identifier', 'dimension', 'measure_description', 'date', 'geography', 'suppression_flag', 'metadata', 'unknown']),
  coverageCellState: new Set(['integrated', 'candidate', 'navigation_only', 'evidence_gap', 'inaccessible', 'unknown', 'not_assessed']),
  processingStatus: new Set(['normalized', 'pending', 'failed', 'excluded', 'not_applicable', 'unknown']),
  comparisonDimension: new Set(['role', 'authority', 'geography', 'time', 'grain', 'access', 'variables_schema', 'freshness', 'machine_readiness', 'operation_kind', 'join_evidence', 'join_compatibility']),
  comparisonState: new Set(['comparable', 'incomparable', 'unknown', 'unavailable']),
  valueState: new Set(['known', 'unknown', 'unavailable', 'not_applicable']),
  operationKind: new Set(['join', 'crosswalk', 'aggregate', 'filter', 'temporal_alignment', 'measure_harmonization', 'none', 'unknown']),
  compatibility: new Set(['compatible', 'conditional', 'incompatible', 'unknown']),
  requirementKind: new Set(['registration', 'application', 'dua', 'fee', 'license', 'institutional_approval', 'identity_verification', 'crosswalk', 'aggregation', 'normalization', 'authorization', 'temporal_alignment', 'measure_harmonization', 'other']),
  requirementState: new Set(['satisfied', 'unsatisfied', 'external', 'not_applicable', 'unknown']),
  blockerKind: new Set(['missing_crosswalk', 'identity_uncertain', 'coverage_gap', 'authorization_required', 'incompatible_grain', 'evidence_missing', 'evidence_stale', 'other']),
  blockerState: new Set(['open', 'resolved', 'external', 'unknown']),
  unit: new Set(['connector_scope', 'native_item', 'native_item_revision', 'asset', 'release', 'distribution', 'endpoint', 'check_target', 'work_item', 'cohort_cell']),
  denominatorStatus: new Set(['known', 'estimated', 'unknown']),
  federalState: new Set(['integrated', 'partial', 'unknown', 'unavailable']),
});
const JOIN_OPERATION_KIND = new Set(['join', 'crosswalk', 'aggregate', 'filter', 'temporal_alignment', 'measure_harmonization']);

const ERROR_KEYS = Object.freeze(['code', 'safe_message', 'retryable', 'generation', 'scope', 'corrective_guidance', 'retry_after_seconds']);
const SCOPE_KEYS = Object.freeze(['capability', 'record_id', 'query_scope_id']);
const RATE_LIMIT_KEYS = Object.freeze(['policy_id', 'limit', 'remaining', 'reset_at', 'retry_after_seconds']);
const TRUTH_KEYS = Object.freeze([
  'source_requests_made',
  'execution_authorized_by_ushso',
  'retrieval_executed',
  'payloads_acquired',
  'analysis_executed',
  'identity_merges_performed',
]);

function pathFor(base, key) {
  return `${base}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function issue(issues, path, message = 'response does not conform to the capability schema') {
  issues.push({ code: 'RESPONSE_SCHEMA_INVALID', path, message });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value, path, { required = [], fields = {} }, issues) {
  if (!isObject(value)) {
    issue(issues, path, 'object required');
    return false;
  }
  const allowed = new Set(Object.keys(fields));
  for (const key of required) if (!Object.hasOwn(value, key)) issue(issues, pathFor(path, key), 'required property missing');
  for (const key of Object.keys(value)) if (!allowed.has(key)) issue(issues, pathFor(path, key), 'additional property is not permitted');
  for (const [key, validate] of Object.entries(fields)) if (Object.hasOwn(value, key)) validate(value[key], pathFor(path, key), issues);
  return true;
}

function string(value, path, issues, { pattern = null, min = 0, max = Infinity, enumValues = null } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || (pattern && !pattern.test(value)) || (enumValues && !enumValues.has(value))) {
    issue(issues, path, 'bounded string expected');
    return false;
  }
  return true;
}

function stableId(value, path, issues) {
  return string(value, path, issues, { pattern: STABLE_ID, min: 1, max: 128 });
}

function maintainedText(value, path, issues) {
  return string(value, path, issues, { min: 1, max: 4000 });
}

function sourceExcerpt(value, path, issues) {
  return string(value, path, issues, { min: 1, max: 2000 });
}

function shortText(value, path, issues) {
  return string(value, path, issues, { min: 1, max: 512 });
}

function dateTime(value, path, issues) {
  if (!string(value, path, issues, { pattern: DATE_TIME, min: 20, max: 35 })) return false;
  if (Number.isNaN(Date.parse(value))) issue(issues, path, 'valid UTC date-time required');
  return true;
}

function nullable(validate) {
  return (value, path, issues) => {
    if (value !== null) validate(value, path, issues);
  };
}

function boolean(value, path, issues) {
  if (typeof value !== 'boolean') issue(issues, path, 'boolean required');
}

function integer(value, path, issues, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) issue(issues, path, 'bounded integer required');
}

function number(value, path, issues, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) issue(issues, path, 'bounded number required');
}

function array(value, path, { min = 0, max = Infinity, unique = false, item = null } = {}, issues) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    issue(issues, path, 'bounded array required');
    return false;
  }
  if (unique) {
    const seen = new Set(value.map(entry => JSON.stringify(entry)));
    if (seen.size !== value.length) issue(issues, path, 'array items must be unique');
  }
  if (item) value.forEach((entry, index) => item(entry, pathFor(path, index), issues));
  return true;
}

function enumValue(value, path, issues, values) {
  string(value, path, issues, { enumValues: values, min: 1 });
}

function parseIpv4(address) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(address)) return null;
  const octets = address.split('.').map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function expandIpv6(address) {
  let input = address.toLowerCase();
  if (!input.includes(':')) return null;
  const ipv4Tail = input.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1];
  if (ipv4Tail) {
    const octets = parseIpv4(ipv4Tail);
    if (!octets) return null;
    const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    input = `${input.slice(0, input.length - ipv4Tail.length)}${replacement}`;
  }
  if ((input.match(/::/gu) ?? []).length > 1) return null;
  const [leftRaw, rightRaw] = input.split('::');
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  if (![...left, ...right].every((part) => /^[0-9a-f]{1,4}$/u.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (!input.includes('::') && missing !== 0) || (input.includes('::') && missing < 1)) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right].map((part) => Number.parseInt(part, 16));
  return parts.length === 8 ? parts : null;
}

function isPrivateIpv4(octets) {
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && [0, 168].includes(second))
    || (first === 198 && [18, 19].includes(second));
}

export function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (host === 'localhost' || host === 'metadata.google.internal' || /\.(?:localhost|local|internal|home\.arpa|onion)$/u.test(host)) return true;
  const ipv4 = parseIpv4(host);
  if (ipv4) return isPrivateIpv4(ipv4);
  const ipv6 = expandIpv6(host);
  if (!ipv6) return false;
  if (ipv6.slice(0, 5).every((part) => part === 0) && ipv6[5] === 0xffff) {
    const mappedIpv4 = [ipv6[6] >> 8, ipv6[6] & 0xff, ipv6[7] >> 8, ipv6[7] & 0xff];
    return isPrivateIpv4(mappedIpv4);
  }
  return ipv6.every((part) => part === 0)
    || (ipv6.slice(0, 7).every((part) => part === 0) && ipv6[7] === 1)
    || (ipv6[0] & 0xfe00) === 0xfc00
    || (ipv6[0] & 0xffc0) === 0xfe80;
}

function uri(value, path, issues) {
  if (!string(value, path, issues, { min: 1, max: 2048 })) return;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) issue(issues, path, 'public HTTP(S) URI without credentials required');
    if (isPrivateHost(parsed.hostname)) issue(issues, path, 'private or non-public locator is not permitted');
  } catch {
    issue(issues, path, 'valid URI required');
  }
}

function nullableUri(value, path, issues) {
  if (value !== null) uri(value, path, issues);
}

function digest(value, path, issues) {
  string(value, path, issues, { pattern: DIGEST, min: 71, max: 71 });
}

function nullableStableId(value, path, issues) {
  if (value !== null) stableId(value, path, issues);
}

function idList(value, path, issues, { min = 1, max = 20 } = {}) {
  array(value, path, { min, max, unique: true, item: stableId }, issues);
}

function timePeriod(value, path, issues) {
  object(value, path, {
    required: ['start', 'end', 'period_kind', 'precision'],
    fields: {
      start: nullable(stringDate),
      end: nullable(stringDate),
      period_kind: (entry, at, errors) => enumValue(entry, at, errors, new Set(['calendar', 'fiscal', 'rolling', 'point_in_time', 'mixed', 'unknown'])),
      precision: (entry, at, errors) => enumValue(entry, at, errors, new Set(['day', 'month', 'quarter', 'year', 'interval', 'unknown'])),
    },
  }, issues);
}

function stringDate(value, path, issues) {
  string(value, path, issues, { pattern: /^\d{4}-\d{2}-\d{2}$/u, min: 10, max: 10 });
  if (typeof value === 'string' && Number.isNaN(Date.parse(`${value}T00:00:00Z`))) issue(issues, path, 'valid calendar date required');
}

function evidenceReference(value, path, issues) {
  object(value, path, {
    required: ['evidence_id', 'evidence_class', 'public_locator', 'observed_at', 'evidence_state', 'staleness_state', 'derivation_reference', 'policy_reference'],
    fields: {
      evidence_id: stableId,
      evidence_class: (entry, at, errors) => enumValue(entry, at, errors, new Set(['authoritative_identifier', 'publisher_metadata', 'catalog_record', 'documentation', 'schema_observation', 'access_check', 'review_decision', 'controlled_test', 'external_execution_record', 'maintained_policy'])),
      public_locator: nullableUri,
      observed_at: dateTime,
      evidence_state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.evidenceState),
      staleness_state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.stalenessState),
      derivation_reference: stableId,
      policy_reference: nullableStableId,
    },
  }, issues);
}

function evidenceIds(value, path, issues) {
  idList(value, path, issues, { min: 1, max: 20 });
}

function warning(value, path, issues) {
  object(value, path, {
    required: ['code', 'message', 'evidence_ids', 'copy_policy_version'],
    fields: {
      code: stableId,
      message: maintainedText,
      evidence_ids: (entry, at, errors) => idList(entry, at, errors, { min: 0, max: 20 }),
      copy_policy_version: stableId,
    },
  }, issues);
}

function requirement(value, path, issues) {
  object(value, path, {
    required: ['requirement_id', 'kind', 'state', 'description', 'human_gate', 'evidence_ids'],
    fields: {
      requirement_id: stableId,
      kind: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.requirementKind),
      state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.requirementState),
      description: maintainedText,
      human_gate: boolean,
      evidence_ids: evidenceIds,
    },
  }, issues);
}

function blocker(value, path, issues) {
  object(value, path, {
    required: ['blocker_id', 'kind', 'state', 'description', 'evidence_ids'],
    fields: {
      blocker_id: stableId,
      kind: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.blockerKind),
      state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.blockerState),
      description: maintainedText,
      evidence_ids: evidenceIds,
    },
  }, issues);
}

function assetSummary(value, path, issues) {
  object(value, path, {
    required: ['asset_id', 'title', 'geography_ids', 'grain', 'time_intervals', 'access_class', 'machine_readiness', 'evidence_state', 'observed_at', 'staleness_state', 'evidence_ids', 'role_candidates', 'why_relevant', 'confidence', 'derivation_references', 'near_miss_reasons'],
    fields: {
      asset_id: stableId,
      title: sourceExcerpt,
      geography_ids: (entry, at, errors) => idList(entry, at, errors, { min: 0, max: 20 }),
      grain: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.grain),
      time_intervals: (entry, at, errors) => array(entry, at, { max: 20, item: timePeriod }, errors),
      access_class: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.accessClass),
      machine_readiness: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.machineReadiness),
      evidence_state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.evidenceState),
      observed_at: dateTime,
      staleness_state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.stalenessState),
      evidence_ids: evidenceIds,
      role_candidates: nullable((entry, at, errors) => idList(entry, at, errors, { min: 0, max: 20 })),
      why_relevant: nullable((entry, at, errors) => array(entry, at, { min: 1, max: 20, item: sourceExcerpt }, errors)),
      confidence: nullable((entry, at, errors) => enumValue(entry, at, errors, new Set(['low', 'moderate', 'high', 'unknown']))),
      derivation_references: nullable((entry, at, errors) => idList(entry, at, errors, { min: 0, max: 20 })),
      near_miss_reasons: nullable((entry, at, errors) => array(entry, at, { max: 20, item: sourceExcerpt }, errors)),
    },
  }, issues);
}

function facetCount(value, path, issues) {
  object(value, path, {
    required: ['dimension', 'value', 'count', 'count_state', 'denominator_scope', 'evidence_ids'],
    fields: {
      dimension: stableId,
      value: stableId,
      count: (entry, at, errors) => integer(entry, at, errors, { min: 0, max: 1_000_000_000 }),
      count_state: (entry, at, errors) => enumValue(entry, at, errors, new Set(['exact', 'estimated', 'unknown'])),
      denominator_scope: shortText,
      evidence_ids: evidenceIds,
    },
  }, issues);
}

function searchResult(value, path, issues) {
  object(value, path, {
    required: ['mode', 'sort', 'ranker_version', 'grouping', 'cursor_binding_digest', 'summaries', 'facet_counts', 'aggregates', 'scoped_zero_statement', 'absence_claim_permitted'],
    fields: {
      mode: (entry, at, errors) => enumValue(entry, at, errors, new Set(['browse', 'search'])),
      sort: (entry, at, errors) => enumValue(entry, at, errors, new Set(['title_asc', 'publisher_title', 'updated_desc', 'frozen_rank_tuple'])),
      ranker_version: stableId,
      grouping: (entry, at, errors) => enumValue(entry, at, errors, new Set(['none', 'family', 'source', 'release'])),
      cursor_binding_digest: digest,
      summaries: (entry, at, errors) => array(entry, at, { max: 20, item: assetSummary }, errors),
      facet_counts: (entry, at, errors) => array(entry, at, { max: 100, item: facetCount }, errors),
      aggregates: (entry, at, errors) => array(entry, at, { max: 100, item: facetCount }, errors),
      scoped_zero_statement: maintainedText,
      absence_claim_permitted: (entry, at, errors) => { if (entry !== false) issue(errors, at, 'absence claims must remain disabled'); },
    },
  }, issues);
}

function nestedRecord(value, path, issues) {
  object(value, path, {
    required: ['record_id', 'record_type', 'label', 'lifecycle_state', 'evidence_ids'],
    fields: {
      record_id: stableId,
      record_type: (entry, at, errors) => enumValue(entry, at, errors, new Set(['release', 'distribution', 'documentation', 'schema'])),
      label: sourceExcerpt,
      lifecycle_state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.lifecycleState),
      evidence_ids: evidenceIds,
    },
  }, issues);
}

function assetResult(value, path, issues) {
  const asset = (entry, at, errors) => object(entry, at, {
    required: ['asset_id', 'title', 'asset_kind', 'evidence_ids'],
    fields: {
      asset_id: stableId,
      title: sourceExcerpt,
      asset_kind: (child, childAt, childErrors) => enumValue(child, childAt, childErrors, ENUMS.assetKind),
      evidence_ids: evidenceIds,
    },
  }, errors);
  const source = (entry, at, errors) => object(entry, at, {
    required: ['source_id', 'name', 'authority_level', 'evidence_ids'],
    fields: {
      source_id: stableId,
      name: sourceExcerpt,
      authority_level: (child, childAt, childErrors) => enumValue(child, childAt, childErrors, new Set(['authoritative', 'official_mirror', 'maintainer', 'secondary', 'candidate', 'unknown'])),
      evidence_ids: evidenceIds,
    },
  }, errors);
  const completeness = (entry, at, errors) => object(entry, at, {
    required: ['releases', 'distributions', 'documentation', 'schemas'],
    fields: Object.fromEntries(['releases', 'distributions', 'documentation', 'schemas'].map(key => [key, (child, childAt, childErrors) => enumValue(child, childAt, childErrors, ENUMS.completeness)])),
  }, errors);
  object(value, path, {
    required: ['asset', 'source', 'identity_state', 'family_state', 'releases', 'distributions', 'documentation', 'schemas', 'collection_completeness'],
    fields: {
      asset,
      source,
      identity_state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.identityState),
      family_state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.familyState),
      releases: (entry, at, errors) => array(entry, at, { max: 50, item: nestedRecord }, errors),
      distributions: (entry, at, errors) => array(entry, at, { max: 50, item: nestedRecord }, errors),
      documentation: (entry, at, errors) => array(entry, at, { max: 50, item: nestedRecord }, errors),
      schemas: (entry, at, errors) => array(entry, at, { max: 50, item: nestedRecord }, errors),
      collection_completeness: completeness,
    },
  }, issues);
}

function accessPlanResult(value, path, issues) {
  object(value, path, {
    required: ['asset_id', 'release_id', 'distribution_id', 'access_route_id', 'access_class', 'requester_eligibility', 'eligibility_criteria', 'requirements', 'human_process', 'process_steps', 'turnaround_category', 'authoritative_links', 'verified_at', 'human_authorization_gate', 'execution_authorized_by_ushso', 'access_workflow_submitted', 'evidence_ids'],
    fields: {
      asset_id: stableId,
      release_id: stableId,
      distribution_id: stableId,
      access_route_id: stableId,
      access_class: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.accessClass),
      requester_eligibility: (entry, at, errors) => { if (entry !== 'not_assessed') issue(errors, at, 'requester eligibility must remain unassessed'); },
      eligibility_criteria: (entry, at, errors) => array(entry, at, { max: 50, item: sourceExcerpt }, errors),
      requirements: (entry, at, errors) => array(entry, at, { max: 50, item: requirement }, errors),
      human_process: maintainedText,
      process_steps: (entry, at, errors) => array(entry, at, { max: 50, item: maintainedText }, errors),
      turnaround_category: (entry, at, errors) => enumValue(entry, at, errors, new Set(['immediate_if_eligible', 'days', 'weeks', 'months', 'source_determined', 'unknown'])),
      authoritative_links: (entry, at, errors) => array(entry, at, { max: 50, unique: true, item: uri }, errors),
      verified_at: dateTime,
      human_authorization_gate: boolean,
      execution_authorized_by_ushso: (entry, at, errors) => { if (entry !== false) issue(errors, at, 'execution authorization must remain false'); },
      access_workflow_submitted: (entry, at, errors) => { if (entry !== false) issue(errors, at, 'access workflow submission must remain false'); },
      evidence_ids: evidenceIds,
    },
  }, issues);
}

function recipeParameter(value, path, issues) {
  object(value, path, {
    required: ['name', 'location', 'required', 'description', 'example_value'],
    fields: {
      name: stableId,
      location: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.parameterLocation),
      required: boolean,
      description: sourceExcerpt,
      example_value: nullable(sourceExcerpt),
    },
  }, issues);
}

function pagination(value, path, issues) {
  object(value, path, {
    required: ['kind', 'page_parameter', 'page_size_parameter', 'maximum_page_size'],
    fields: {
      kind: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.paginationKind),
      page_parameter: nullableStableId,
      page_size_parameter: nullableStableId,
      maximum_page_size: (entry, at, errors) => { if (entry !== null) integer(entry, at, errors, { min: 1, max: 1_000_000 }); },
    },
  }, issues);
}

function retrievalRecipeResult(value, path, issues) {
  object(value, path, {
    required: ['asset_id', 'release_id', 'distribution_id', 'access_route_id', 'interface', 'request_method', 'request_template', 'parameters', 'authentication_type', 'pagination', 'response_formats', 'compression', 'size_category', 'update_behavior', 'parser_hints', 'sample_requests', 'expected_artifacts', 'checks', 'stop_conditions', 'retrieval_executed', 'payloads_acquired', 'evidence_ids'],
    fields: {
      asset_id: stableId,
      release_id: stableId,
      distribution_id: stableId,
      access_route_id: stableId,
      interface: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.interface),
      request_method: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.requestMethod),
      request_template: nullableUri,
      parameters: (entry, at, errors) => array(entry, at, { max: 100, item: recipeParameter }, errors),
      authentication_type: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.authenticationType),
      pagination,
      response_formats: (entry, at, errors) => array(entry, at, { max: 20, unique: true, item: stableId }, errors),
      compression: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.compression),
      size_category: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.sizeCategory),
      update_behavior: sourceExcerpt,
      parser_hints: (entry, at, errors) => array(entry, at, { max: 100, item: sourceExcerpt }, errors),
      sample_requests: (entry, at, errors) => array(entry, at, { max: 10, item: (child, childAt, childErrors) => string(child, childAt, childErrors, { min: 1, max: 2048 }) }, errors),
      expected_artifacts: (entry, at, errors) => array(entry, at, { max: 50, item: sourceExcerpt }, errors),
      checks: (entry, at, errors) => array(entry, at, { max: 50, item: maintainedText }, errors),
      stop_conditions: (entry, at, errors) => array(entry, at, { max: 50, item: maintainedText }, errors),
      retrieval_executed: (entry, at, errors) => { if (entry !== false) issue(errors, at, 'retrieval must remain unexecuted'); },
      payloads_acquired: (entry, at, errors) => { if (entry !== false) issue(errors, at, 'payload acquisition must remain false'); },
      evidence_ids: evidenceIds,
    },
  }, issues);
}

function variableField(value, path, issues) {
  object(value, path, {
    required: ['schema_field_id', 'label', 'description', 'native_name', 'data_type', 'unit', 'allowed_values', 'code_system', 'semantic_role', 'identifier_namespace', 'evidence_ids', 'limitations'],
    fields: {
      schema_field_id: stableId,
      label: sourceExcerpt,
      description: nullable(sourceExcerpt),
      native_name: sourceExcerpt,
      data_type: stableId,
      unit: nullableStableId,
      allowed_values: (entry, at, errors) => array(entry, at, { max: 100, item: sourceExcerpt }, errors),
      code_system: nullableStableId,
      semantic_role: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.semanticRole),
      identifier_namespace: nullableStableId,
      evidence_ids: evidenceIds,
      limitations: (entry, at, errors) => array(entry, at, { max: 50, item: maintainedText }, errors),
    },
  }, issues);
}

function variablesResult(value, path, issues) {
  object(value, path, {
    required: ['asset_id', 'release_id', 'distribution_id', 'schema_id', 'schema_completeness', 'fields'],
    fields: {
      asset_id: stableId,
      release_id: stableId,
      distribution_id: stableId,
      schema_id: stableId,
      schema_completeness: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.completeness),
      fields: (entry, at, errors) => array(entry, at, { max: 100, item: variableField }, errors),
    },
  }, issues);
}

function joinRoute(value, path, issues) {
  object(value, path, {
    required: ['route_id', 'from_field_id', 'to_field_id', 'from_namespace', 'to_namespace', 'entity_scope', 'direction', 'cardinality', 'temporal_applicability', 'normalization', 'operation_kind', 'evidence_state', 'compatibility', 'requirements', 'blockers', 'caveats', 'evidence_ids', 'hop_count'],
    fields: {
      route_id: stableId,
      from_field_id: stableId,
      to_field_id: stableId,
      from_namespace: nullableStableId,
      to_namespace: nullableStableId,
      entity_scope: (entry, at, errors) => enumValue(entry, at, errors, new Set(['facility', 'campus', 'organization', 'system', 'legal_entity', 'unknown'])),
      direction: (entry, at, errors) => enumValue(entry, at, errors, new Set(['unidirectional', 'bidirectional'])),
      cardinality: (entry, at, errors) => enumValue(entry, at, errors, new Set(['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many', 'unknown'])),
      temporal_applicability: timePeriod,
      normalization: maintainedText,
      operation_kind: (entry, at, errors) => enumValue(entry, at, errors, JOIN_OPERATION_KIND),
      evidence_state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.evidenceState),
      compatibility: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.compatibility),
      requirements: (entry, at, errors) => array(entry, at, { max: 50, item: requirement }, errors),
      blockers: (entry, at, errors) => array(entry, at, { max: 50, item: blocker }, errors),
      caveats: (entry, at, errors) => array(entry, at, { max: 50, item: maintainedText }, errors),
      evidence_ids: evidenceIds,
      hop_count: (entry, at, errors) => integer(entry, at, errors, { min: 1, max: 2 }),
    },
  }, issues);
}

function joinRoutesResult(value, path, issues) {
  object(value, path, {
    required: ['from_id', 'to_id', 'max_hops_used', 'routes'],
    fields: {
      from_id: stableId,
      to_id: nullableStableId,
      max_hops_used: (entry, at, errors) => integer(entry, at, errors, { min: 0, max: 2 }),
      routes: (entry, at, errors) => array(entry, at, { max: 50, item: joinRoute }, errors),
    },
  }, issues);
}

function comparisonDimension(value, path, issues) {
  const comparisonValue = (entry, at, errors) => object(entry, at, {
    required: ['asset_id', 'metadata_value', 'state'],
    fields: {
      asset_id: stableId,
      metadata_value: nullable(sourceExcerpt),
      state: (child, childAt, childErrors) => enumValue(child, childAt, childErrors, ENUMS.valueState),
    },
  }, errors);
  object(value, path, {
    required: ['dimension', 'state', 'values', 'explanation', 'evidence_ids'],
    fields: {
      dimension: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.comparisonDimension),
      state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.comparisonState),
      values: (entry, at, errors) => array(entry, at, { min: 2, max: 5, item: comparisonValue }, errors),
      explanation: maintainedText,
      evidence_ids: evidenceIds,
    },
  }, issues);
}

function pairwiseOperation(value, path, issues) {
  object(value, path, {
    required: ['left_asset_id', 'right_asset_id', 'operation_kind', 'evidence_state', 'compatibility', 'requirements', 'blockers', 'evidence_ids'],
    fields: {
      left_asset_id: stableId,
      right_asset_id: stableId,
      operation_kind: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.operationKind),
      evidence_state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.evidenceState),
      compatibility: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.compatibility),
      requirements: (entry, at, errors) => array(entry, at, { max: 50, item: requirement }, errors),
      blockers: (entry, at, errors) => array(entry, at, { max: 50, item: blocker }, errors),
      evidence_ids: evidenceIds,
    },
  }, issues);
}

function compareResult(value, path, issues) {
  object(value, path, {
    required: ['asset_ids', 'dimensions', 'pairwise_operations', 'ranking_performed', 'source_values_compared'],
    fields: {
      asset_ids: (entry, at, errors) => idList(entry, at, errors, { min: 2, max: 5 }),
      dimensions: (entry, at, errors) => array(entry, at, { min: 1, max: 12, item: comparisonDimension }, errors),
      pairwise_operations: (entry, at, errors) => array(entry, at, { max: 10, item: pairwiseOperation }, errors),
      ranking_performed: (entry, at, errors) => { if (entry !== false) issue(errors, at, 'ranking must remain disabled'); },
      source_values_compared: (entry, at, errors) => { if (entry !== false) issue(errors, at, 'source-value comparison must remain disabled'); },
    },
  }, issues);
}

function denominator(value, path, issues) {
  object(value, path, {
    required: ['definition_id', 'unit', 'count', 'status', 'bounded_inventory_complete', 'membership_manifest_digest'],
    fields: {
      definition_id: stableId,
      unit: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.unit),
      count: (entry, at, errors) => { if (entry !== null) integer(entry, at, errors, { min: 0, max: 1_000_000_000 }); },
      status: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.denominatorStatus),
      bounded_inventory_complete: boolean,
      membership_manifest_digest: (entry, at, errors) => { if (entry !== null) digest(entry, at, errors); },
    },
  }, issues);
}

function coverageCell(value, path, issues) {
  object(value, path, {
    required: ['cell_id', 'geography_id', 'source_class', 'coverage_cell_state', 'processing_status', 'completeness_state', 'denominator', 'interpretation', 'absence_claim_permitted', 'evidence_ids'],
    fields: {
      cell_id: stableId,
      geography_id: stableId,
      source_class: stableId,
      coverage_cell_state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.coverageCellState),
      processing_status: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.processingStatus),
      completeness_state: (entry, at, errors) => enumValue(entry, at, errors, ENUMS.completeness),
      denominator,
      interpretation: maintainedText,
      absence_claim_permitted: boolean,
      evidence_ids: evidenceIds,
    },
  }, issues);
}

function coverageResult(value, path, issues) {
  const federalBaseline = (entry, at, errors) => object(entry, at, {
    required: ['state', 'source_scope_count', 'description', 'evidence_ids'],
    fields: {
      state: (child, childAt, childErrors) => enumValue(child, childAt, childErrors, ENUMS.federalState),
      source_scope_count: (child, childAt, childErrors) => { if (child !== null) integer(child, childAt, childErrors, { min: 0, max: 1_000_000 }); },
      description: maintainedText,
      evidence_ids: evidenceIds,
    },
  }, errors);
  object(value, path, {
    required: ['federal_baseline', 'cells', 'scope_interpretation', 'absence_claim_permitted'],
    fields: {
      federal_baseline: federalBaseline,
      cells: (entry, at, errors) => array(entry, at, { max: 100, item: coverageCell }, errors),
      scope_interpretation: maintainedText,
      absence_claim_permitted: boolean,
    },
  }, issues);
}

const RESULT_VALIDATORS = Object.freeze({
  search_assets: searchResult,
  get_asset: assetResult,
  get_access_plan: accessPlanResult,
  get_retrieval_recipe: retrievalRecipeResult,
  get_variables: variablesResult,
  get_join_routes: joinRoutesResult,
  compare_assets: compareResult,
  get_coverage_status: coverageResult,
});

function errorObject(value, path, issues) {
  object(value, path, {
    required: ERROR_KEYS,
    fields: {
      code: (entry, at, errors) => enumValue(entry, at, errors, ERROR_CODES),
      safe_message: maintainedText,
      retryable: boolean,
      generation: nullableStableId,
      scope: (entry, at, errors) => {
        if (entry === null) return;
        object(entry, at, {
          required: SCOPE_KEYS,
          fields: { capability: stableId, record_id: nullableStableId, query_scope_id: nullableStableId },
        }, errors);
      },
      corrective_guidance: maintainedText,
      retry_after_seconds: (entry, at, errors) => { if (entry !== null) integer(entry, at, errors, { min: 0, max: 86400 }); },
    },
  }, issues);
}

function rateLimit(value, path, issues) {
  object(value, path, {
    required: RATE_LIMIT_KEYS,
    fields: {
      policy_id: stableId,
      limit: (entry, at, errors) => integer(entry, at, errors, { min: 1, max: 100000 }),
      remaining: (entry, at, errors) => integer(entry, at, errors, { min: 0, max: 100000 }),
      reset_at: dateTime,
      retry_after_seconds: (entry, at, errors) => { if (entry !== null) integer(entry, at, errors, { min: 0, max: 86400 }); },
    },
  }, issues);
}

function truthBoundary(value, path, issues) {
  object(value, path, {
    required: TRUTH_KEYS,
    fields: Object.fromEntries(TRUTH_KEYS.map(key => [key, (entry, at, errors) => { if (entry !== false) issue(errors, at, 'truth boundary must remain false'); }])),
  }, issues);
}

function responseResult(value, capability, path, issues) {
  if (capability === 'plan_research') {
    issue(issues, path, 'planner success responses are not enabled');
    return;
  }
  if (!RESULT_VALIDATORS[capability]) {
    issue(issues, path, 'capability result schema is unavailable');
    return;
  }
  RESULT_VALIDATORS[capability](value, path, issues);
}

export function responseSchemaIssues(core, capability) {
  const issues = [];
  if (!isObject(core)) {
    issue(issues, '/');
    return issues;
  }
  for (const key of [
    'tool_contract_version', 'capability', 'ok', 'registry_revision', 'index_generation',
    'publication_manifest_id', 'canonical_as_of', 'coverage_snapshot_id', 'result_state',
    'result', 'error', 'evidence_references', 'warnings', 'truncated', 'omitted_sections',
    'next_cursor', 'continuation_expires_at', 'generation_retention_expires_at',
    'restart_required', 'rate_limit', 'truth_boundary',
  ]) if (!Object.hasOwn(core, key)) issue(issues, pathFor('', key), 'required property missing');
  const allowedCore = new Set([
    'tool_contract_version', 'capability', 'ok', 'registry_revision', 'index_generation',
    'publication_manifest_id', 'canonical_as_of', 'coverage_snapshot_id', 'result_state',
    'result', 'error', 'evidence_references', 'warnings', 'truncated', 'omitted_sections',
    'next_cursor', 'continuation_expires_at', 'generation_retention_expires_at',
    'restart_required', 'rate_limit', 'truth_boundary',
  ]);
  for (const key of Object.keys(core)) if (!allowedCore.has(key)) issue(issues, pathFor('', key), 'transport or unknown field is not permitted in the canonical core');
  string(core.tool_contract_version, '/tool_contract_version', issues, { min: 1, max: 128 });
  enumValue(core.capability, '/capability', issues, CAPABILITIES);
  boolean(core.ok, '/ok', issues);
  stableId(core.registry_revision, '/registry_revision', issues);
  stableId(core.index_generation, '/index_generation', issues);
  stableId(core.publication_manifest_id, '/publication_manifest_id', issues);
  dateTime(core.canonical_as_of, '/canonical_as_of', issues);
  nullableStableId(core.coverage_snapshot_id, '/coverage_snapshot_id', issues);
  enumValue(core.result_state, '/result_state', issues, RESULT_STATES);
  if (core.ok === true) {
    if (capability === 'plan_research') issue(issues, '/ok', 'planner success responses are not enabled');
    if (core.result === null || !isObject(core.result)) issue(issues, '/result', 'successful responses require an object result');
    else if (RESULT_STATE_BY_CAPABILITY[capability] && !RESULT_STATE_BY_CAPABILITY[capability].has(core.result_state)) issue(issues, '/result_state', 'success result state is not valid for this capability');
    else responseResult(core.result, capability, '/result', issues);
    if (core.error !== null) issue(issues, '/error', 'successful responses require a null error');
  } else if (core.ok === false) {
    if (core.result !== null) issue(issues, '/result', 'error responses require a null result');
    if (core.error === null || !isObject(core.error)) issue(issues, '/error', 'error responses require a structured error');
    else errorObject(core.error, '/error', issues);
    if (!ERROR_STATES.has(core.result_state)) issue(issues, '/result_state', 'error result state is invalid');
  }
  array(core.evidence_references, '/evidence_references', { max: 200, unique: true, item: evidenceReference }, issues);
  array(core.warnings, '/warnings', { max: 50, item: warning }, issues);
  boolean(core.truncated, '/truncated', issues);
  array(core.omitted_sections, '/omitted_sections', { max: 50, unique: true, item: stableId }, issues);
  if (core.next_cursor !== null) string(core.next_cursor, '/next_cursor', issues, { pattern: CURSOR, min: 16, max: 2048 });
  if (core.continuation_expires_at !== null) dateTime(core.continuation_expires_at, '/continuation_expires_at', issues);
  if (core.generation_retention_expires_at !== null) dateTime(core.generation_retention_expires_at, '/generation_retention_expires_at', issues);
  boolean(core.restart_required, '/restart_required', issues);
  rateLimit(core.rate_limit, '/rate_limit', issues);
  truthBoundary(core.truth_boundary, '/truth_boundary', issues);
  return issues;
}
