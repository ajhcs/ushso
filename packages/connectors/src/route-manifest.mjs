import { deepClone } from './canonical.mjs';
import { policyFailure } from './errors.mjs';
import { SECRET_QUERY_DENYLIST_ACTIVE, assertPositiveMetadataRouteAllowlist } from './source-route-allowlist.mjs';

export const ALLOWED_PURPOSES = new Set(['catalog_metadata', 'documentation', 'schema', 'access_probe']);
export const REQUIRED_FORBIDDEN_ROUTE_CLASSES = Object.freeze([
  'source_data_payload', 'query_execution', 'data_download', 'archive_member',
  'form_submission', 'login', 'payment', 'authorization_workflow',
]);

const FORBIDDEN_INTENT_PATTERN = /(?:^|[^a-z0-9])(?:source[_-]?data[_-]?payload|payload[_-]?sentinel|execute[_-]?query|query[_-]?execution|sql|soda[_-]?rows?|download[_-]?(?:data|file)|archive[_-]?member|submit[_-]?(?:form|login|payment|dua)|credential)(?:$|[^a-z0-9])/i;
const SECRET_PARAMETER_PATTERN = /(?:^|[_-])(?:api[_-]?key|access[_-]?token|auth|authorization|credential|password|signature|sig|x-amz-(?:credential|signature)|x-goog-(?:credential|signature)|awsaccesskeyid|googleaccessid|key-pair-id|policy|expires)(?:$|[_-])/i;
const BRACKET_PARAMETER_PATTERN = /\[([A-Za-z][A-Za-z0-9_.-]{0,15})\]/gu;
const SECRET_VALUE_PATTERN = /(?:[?&](?:x-amz-(?:credential|signature)|x-goog-(?:credential|signature)|awsaccesskeyid|googleaccessid|key-pair-id|signature|sig|access_token|api_key)=)|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i;

const TOP_LEVEL_KEYS = new Set([
  'contract_version', 'descriptor_id', 'source_id', 'connector_name', 'connector_version',
  'configuration_revision', 'authority_type', 'responsible_organization', 'allowed_hosts',
  'redirect_policy', 'endpoints', 'scopes', 'native_identifier', 'checkpoint_policy',
  'refresh_policy', 'bounds', 'origin_policy', 'credential_secret_locator',
  'supported_object_roles', 'capabilities', 'exclusion_policy', 'legal_review',
  'capture_retention_policy', 'source_state',
]);
const ENDPOINT_KEYS = new Set(['endpoint_id', 'base_url', 'target_class', 'routes']);
const ROUTE_KEYS = new Set(['template_id', 'purpose', 'method', 'path_template', 'allowed_parameters', 'expected_content_classes', 'forbidden_route_classes']);
const SCOPE_KEYS = new Set(['scope_id', 'unit', 'description', 'endpoint_ids', 'denominator', 'completeness_evidence_strategy', 'keyword_search_is_denominator']);
const DENOMINATOR_KEYS = new Set(['unit', 'inclusion_rule', 'unknown_handling', 'exclusions_visible']);
const REQUEST_KEYS = new Set(['endpointId', 'templateId', 'purpose', 'method', 'targetClass', 'pathParameters', 'query']);
const ORGANIZATION_KEYS = new Set(['organization_id', 'name']);
const NATIVE_IDENTIFIER_KEYS = new Set(['namespace', 'case_behavior']);
const CHECKPOINT_POLICY_KEYS = new Set(['strategy', 'opaque_cursor_durability', 'overlap_seconds', 'full_enumeration_interval_seconds']);
const REFRESH_POLICY_KEYS = new Set(['interval_seconds', 'jitter_seconds', 'stale_after_seconds', 'policy_version']);
const BOUNDS_KEYS = new Set(['maximum_pages', 'maximum_response_bytes', 'maximum_decompressed_bytes', 'maximum_run_seconds', 'maximum_redirects']);
const ORIGIN_POLICY_KEYS = new Set(['maximum_concurrency', 'requests_per_second', 'burst', 'minimum_retry_delay_seconds', 'maximum_retry_delay_seconds', 'circuit_policy_version']);
const CAPABILITIES_KEYS = new Set(['schema_metadata', 'documentation', 'access_probe']);
const EXCLUSION_POLICY_KEYS = new Set(['policy_version', 'rules', 'exclusions_visible_upstream']);
const EXCLUSION_RULE_KEYS = new Set(['rule_id', 'reason_code', 'description']);
const LEGAL_REVIEW_KEYS = new Set(['state', 'reviewed_at', 'reviewer_role', 'terms_locator']);
const CAPTURE_RETENTION_KEYS = new Set(['policy_version', 'active_days', 'override_rationale', 'review_at']);
const TARGET_CLASSES = new Set(['catalog_root', 'collection', 'pagination_cursor', 'exact_item', 'exact_distribution', 'documentation']);
const EXPECTED_CONTENT_CLASSES = new Set(['catalog_item_record', 'catalog_collection', 'data_dictionary', 'schema_description', 'documentation_page', 'access_status_headers']);
const SOURCE_STATES = new Set(['active', 'pause_requested', 'draining', 'paused', 'auth_blocked', 'schema_drift', 'retired']);
const PAGINATION_PARAMETERS = new Set(['cursor', 'after', 'start', 'offset', 'page', 'page[number]', 'page_token', 'continuation', 'resumptionToken']);
const SUPPORTED_OBJECT_ROLES = new Set(['asset', 'release', 'distribution', 'documentation', 'schema', 'access_route']);
const OPAQUE_ID_PATTERN = /^[a-z][a-z0-9_]{1,31}_[A-Za-z0-9][A-Za-z0-9._:-]{1,126}$/;
const ROUTE_PAYLOAD_PATTERN = /\/(?:resource|datastore_search|rows?|query|download)(?:\/|$)|\.(?:csv|tsv|parquet|zip|gz|xlsx?|sas7bdat|dta)(?:$|\/)/i;

// These limits are deliberately code-level defaults so existing descriptor and
// deployment manifests remain compatible while every connector path still has
// an explicit structural and cardinality ceiling.
export const DEFAULT_RESPONSE_LIMITS = Object.freeze({
  maximum_response_depth: 32,
  maximum_response_nodes: 20_000,
  maximum_records: 1_000,
  maximum_links: 1_000,
  maximum_observations: 1_000,
});

export class ConnectorResponseLimitError extends TypeError {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'ConnectorResponseLimitError';
    this.reasonCode = reasonCode;
  }
}

export function responseLimitsForDescriptor() {
  return DEFAULT_RESPONSE_LIMITS;
}

export function assertResponseCardinality(value, maximum, label, reasonCode = 'RESPONSE_CARDINALITY_EXCEEDED') {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > maximum) {
    throw new ConnectorResponseLimitError(reasonCode, `${label} exceeds its permitted cardinality.`);
  }
  return value;
}

function assertExactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new TypeError(`${label} has unexpected properties: ${unexpected.sort().join(', ')}`);
  const missing = [...allowed].filter((key) => !Object.hasOwn(value, key));
  if (missing.length) throw new TypeError(`${label} is missing required properties: ${missing.sort().join(', ')}`);
}

function normalizedHost(value) {
  return value.toLowerCase().replace(/\.$/, '');
}

function assertArray(value, label, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER, unique = false } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new TypeError(`${label} must contain ${minimum}..${maximum} items.`);
  if (unique && new Set(value).size !== value.length) throw new TypeError(`${label} must contain unique values.`);
}

function assertIntegerRange(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is outside its permitted integer range.`);
}

function assertNumberRange(value, minimumExclusive, maximum, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= minimumExclusive || value > maximum) throw new TypeError(`${label} is outside its permitted numeric range.`);
}

function assertOpaqueId(value, label) {
  if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) throw new TypeError(`${label} is not a bounded opaque identifier.`);
}

function assertSafeHostname(value, label) {
  if (typeof value !== 'string' || value.length > 253 || value.includes('[') || value.includes(']') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    throw new TypeError(`${label} must be a DNS hostname, not an IP literal.`);
  }
  const host = normalizedHost(value);
  if (!host.includes('.') || !host.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part))) {
    throw new TypeError(`${label} is not a bounded public DNS hostname.`);
  }
  return host;
}

function assertSafeRouteTemplate(pathTemplate, label) {
  if (typeof pathTemplate !== 'string' || !pathTemplate.startsWith('/') || pathTemplate.startsWith('//') || pathTemplate.length > 1000 || /[?#]|%2f|%5c|%00/i.test(pathTemplate)) {
    throw new TypeError(`${label} is not a safe bounded path template.`);
  }
  for (const segment of pathTemplate.split('/')) {
    const literal = segment.replace(/\{[A-Za-z][A-Za-z0-9_.-]*\}/g, 'x');
    let decoded;
    try { decoded = decodeURIComponent(literal); } catch { throw new TypeError(`${label} contains invalid percent encoding.`); }
    if (decoded === '.' || decoded === '..' || /[\\/\u0000]/.test(decoded)) throw new TypeError(`${label} contains an unsafe normalized segment.`);
  }
}

function isSecretParameterName(name) {
  if (!SECRET_QUERY_DENYLIST_ACTIVE || typeof name !== 'string') return false;
  if (SECRET_PARAMETER_PATTERN.test(name)) return true;
  return [...name.matchAll(BRACKET_PARAMETER_PATTERN)].some(([, innerName]) => SECRET_PARAMETER_PATTERN.test(innerName));
}

function assertBoundedUrl(url, targetClass) {
  if (url.toString().length > 2000) throw policyFailure('REQUEST_URL_BOUND_EXCEEDED', targetClass);
}

function templatePattern(pathTemplate) {
  const escaped = pathTemplate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\\\{[A-Za-z][A-Za-z0-9_.-]*\\\}/g, '[^/]+')}$`);
}

function routeIndex(descriptor) {
  return descriptor.endpoints.flatMap((endpoint) => endpoint.routes.map((route) => ({ endpoint, route })));
}

export function validateDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new TypeError('Connector descriptor must be an object.');
  }
  assertExactKeys(descriptor, TOP_LEVEL_KEYS, 'Connector descriptor');
  if (descriptor.contract_version !== 'ingestion.v1.1.0') throw new TypeError('Source descriptors require ingestion.v1.1.0.');
  assertExactKeys(descriptor.responsible_organization, ORGANIZATION_KEYS, 'Responsible organization');
  assertExactKeys(descriptor.native_identifier, NATIVE_IDENTIFIER_KEYS, 'Native identifier');
  assertExactKeys(descriptor.checkpoint_policy, CHECKPOINT_POLICY_KEYS, 'Checkpoint policy');
  assertExactKeys(descriptor.refresh_policy, REFRESH_POLICY_KEYS, 'Refresh policy');
  assertExactKeys(descriptor.bounds, BOUNDS_KEYS, 'Request bounds');
  assertExactKeys(descriptor.origin_policy, ORIGIN_POLICY_KEYS, 'Origin policy');
  assertExactKeys(descriptor.capabilities, CAPABILITIES_KEYS, 'Capabilities');
  assertExactKeys(descriptor.exclusion_policy, EXCLUSION_POLICY_KEYS, 'Exclusion policy');
  assertExactKeys(descriptor.legal_review, LEGAL_REVIEW_KEYS, 'Legal review');
  assertExactKeys(descriptor.capture_retention_policy, CAPTURE_RETENTION_KEYS, 'Capture retention policy');
  assertOpaqueId(descriptor.descriptor_id, 'descriptor_id');
  assertOpaqueId(descriptor.source_id, 'source_id');
  assertOpaqueId(descriptor.responsible_organization.organization_id, 'responsible organization_id');
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(descriptor.connector_name) || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(descriptor.connector_version)) throw new TypeError('Connector name or semantic version is invalid.');
  assertIntegerRange(descriptor.configuration_revision, 1, Number.MAX_SAFE_INTEGER, 'configuration_revision');
  assertArray(descriptor.allowed_hosts, 'allowed_hosts', { unique: true });
  const allowedHosts = new Set(descriptor.allowed_hosts.map((host) => assertSafeHostname(host, 'allowed_hosts entry')));
  if (allowedHosts.size !== descriptor.allowed_hosts.length) throw new TypeError('allowed_hosts must be unique after normalization.');
  if (!['deny', 'same_origin', 'allowlisted_hosts'].includes(descriptor.redirect_policy)) throw new TypeError('Unsupported redirect policy.');
  if (!SOURCE_STATES.has(descriptor.source_state)) throw new TypeError('Unsupported source state.');
  if (descriptor.source_state === 'active' && !['approved', 'approved_with_conditions'].includes(descriptor.legal_review.state)) throw new TypeError('An active source requires an approved legal review.');
  if (SECRET_VALUE_PATTERN.test(JSON.stringify({
    responsible_organization: descriptor.responsible_organization,
    legal_review: descriptor.legal_review,
    capture_retention_policy: descriptor.capture_retention_policy,
  }))) throw new TypeError('Descriptor metadata contains credential or signed-locator material.');
  if (descriptor.credential_secret_locator !== null && !/^(?:secret|cloudflare-secret):\/\/[A-Za-z0-9][A-Za-z0-9/_-]{2,190}$/.test(descriptor.credential_secret_locator)) {
    throw new TypeError('Credential configuration must be a secret locator, never a secret value.');
  }
  if (!['modified_at_native_id', 'opaque_cursor', 'full_snapshot'].includes(descriptor.checkpoint_policy.strategy)) throw new TypeError('Unsupported checkpoint strategy.');
  if (!['run_local', 'source_guaranteed'].includes(descriptor.checkpoint_policy.opaque_cursor_durability)) throw new TypeError('Unsupported opaque cursor durability.');
  if (descriptor.checkpoint_policy.strategy === 'opaque_cursor' && descriptor.checkpoint_policy.opaque_cursor_durability !== 'source_guaranteed') {
    throw new TypeError('A global opaque-cursor checkpoint requires source-guaranteed cursor durability.');
  }
  assertIntegerRange(descriptor.checkpoint_policy.overlap_seconds, 0, 604800, 'checkpoint overlap_seconds');
  assertIntegerRange(descriptor.checkpoint_policy.full_enumeration_interval_seconds, 3600, 31536000, 'checkpoint full_enumeration_interval_seconds');
  assertIntegerRange(descriptor.refresh_policy.interval_seconds, 300, 31536000, 'refresh interval_seconds');
  assertIntegerRange(descriptor.refresh_policy.jitter_seconds, 0, 86400, 'refresh jitter_seconds');
  assertIntegerRange(descriptor.refresh_policy.stale_after_seconds, 300, 63072000, 'refresh stale_after_seconds');
  assertIntegerRange(descriptor.bounds.maximum_pages, 1, 100000, 'bounds maximum_pages');
  assertIntegerRange(descriptor.bounds.maximum_response_bytes, 1, 52428800, 'bounds maximum_response_bytes');
  assertIntegerRange(descriptor.bounds.maximum_decompressed_bytes, 1, 104857600, 'bounds maximum_decompressed_bytes');
  assertIntegerRange(descriptor.bounds.maximum_run_seconds, 1, 86400, 'bounds maximum_run_seconds');
  assertIntegerRange(descriptor.bounds.maximum_redirects, 0, 5, 'bounds maximum_redirects');
  assertIntegerRange(descriptor.origin_policy.maximum_concurrency, 1, 32, 'origin maximum_concurrency');
  assertNumberRange(descriptor.origin_policy.requests_per_second, 0, 100, 'origin requests_per_second');
  assertIntegerRange(descriptor.origin_policy.burst, 1, 100, 'origin burst');
  assertIntegerRange(descriptor.origin_policy.minimum_retry_delay_seconds, 1, 3600, 'origin minimum_retry_delay_seconds');
  assertIntegerRange(descriptor.origin_policy.maximum_retry_delay_seconds, 1, 86400, 'origin maximum_retry_delay_seconds');
  if (descriptor.origin_policy.maximum_retry_delay_seconds < descriptor.origin_policy.minimum_retry_delay_seconds) throw new TypeError('Origin retry delay bounds are inverted.');
  assertArray(descriptor.endpoints, 'endpoints');
  assertArray(descriptor.scopes, 'scopes');
  assertArray(descriptor.supported_object_roles, 'supported_object_roles', { unique: true });
  if (descriptor.supported_object_roles.some((role) => !SUPPORTED_OBJECT_ROLES.has(role))) throw new TypeError('supported_object_roles contains an unknown role.');
  if (Object.values(descriptor.capabilities).some((value) => typeof value !== 'boolean')) throw new TypeError('Connector capabilities must be booleans.');
  assertArray(descriptor.exclusion_policy.rules, 'exclusion policy rules', { minimum: 0, maximum: 100 });
  for (const rule of descriptor.exclusion_policy.rules) assertExactKeys(rule, EXCLUSION_RULE_KEYS, `Exclusion rule ${rule?.rule_id ?? '(unknown)'}`);
  const templateIds = new Set();
  const endpointIds = new Set();
  for (const { endpoint, route } of routeIndex(descriptor)) {
    assertExactKeys(endpoint, ENDPOINT_KEYS, `Endpoint ${endpoint.endpoint_id ?? '(unknown)'}`);
    assertExactKeys(route, ROUTE_KEYS, `Route ${route.template_id ?? '(unknown)'}`);
    const base = new URL(endpoint.base_url);
    if (base.protocol !== 'https:' || base.username || base.password || (base.port && base.port !== '443') || base.pathname !== '/' || base.search || base.hash) throw new TypeError(`Unsafe base URL for ${endpoint.endpoint_id}.`);
    assertSafeHostname(base.hostname, `Endpoint host for ${endpoint.endpoint_id}`);
    assertOpaqueId(endpoint.endpoint_id, 'endpoint_id');
    if (!allowedHosts.has(normalizedHost(base.hostname))) throw new TypeError(`Endpoint host is absent from allowed_hosts: ${base.hostname}`);
    if (!TARGET_CLASSES.has(endpoint.target_class) || endpoint.target_class === 'pagination_cursor') throw new TypeError(`Unsafe configured endpoint target class: ${endpoint.target_class}`);
    if (!endpointIds.has(endpoint.endpoint_id)) endpointIds.add(endpoint.endpoint_id);
    assertArray(endpoint.routes, `Routes for ${endpoint.endpoint_id}`);
    if (templateIds.has(route.template_id)) throw new TypeError(`Duplicate route template ID: ${route.template_id}`);
    assertOpaqueId(route.template_id, 'template_id');
    templateIds.add(route.template_id);
    if (!ALLOWED_PURPOSES.has(route.purpose)) throw new TypeError(`Unsupported route purpose: ${route.purpose}`);
    if (!['GET', 'HEAD'].includes(route.method)) throw new TypeError(`Unsafe route method: ${route.method}`);
    if ((route.purpose === 'access_probe') !== (route.method === 'HEAD')) throw new TypeError(`${route.template_id} must use HEAD only and exactly for access probes.`);
    assertSafeRouteTemplate(route.path_template, `Route ${route.template_id}`);
    if ((route.purpose === 'catalog_metadata' || route.purpose === 'schema') && ROUTE_PAYLOAD_PATTERN.test(route.path_template)) {
      throw new TypeError(`${route.template_id} resembles a source-data or query route.`);
    }
    assertArray(route.allowed_parameters, `${route.template_id} allowed_parameters`, { minimum: 0, unique: true });
    assertArray(route.expected_content_classes, `${route.template_id} expected_content_classes`, { unique: true });
    assertArray(route.forbidden_route_classes, `${route.template_id} forbidden_route_classes`, { unique: true });
    if (route.expected_content_classes.some((value) => !EXPECTED_CONTENT_CLASSES.has(value))) throw new TypeError(`${route.template_id} declares an unknown content class.`);
    for (const required of REQUIRED_FORBIDDEN_ROUTE_CLASSES) {
      if (!route.forbidden_route_classes.includes(required)) throw new TypeError(`${route.template_id} does not explicitly forbid ${required}.`);
    }
    for (const parameter of route.allowed_parameters) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,47}(?:\[[A-Za-z][A-Za-z0-9_.-]{0,15}\])?$/.test(parameter) || isSecretParameterName(parameter) || FORBIDDEN_INTENT_PATTERN.test(parameter)) throw new TypeError(`${route.template_id} allows an unsafe query parameter.`);
    }
  }
  if (endpointIds.size !== descriptor.endpoints.length) throw new TypeError('Endpoint IDs must be unique.');
  assertPositiveMetadataRouteAllowlist(descriptor);
  for (const scope of descriptor.scopes) {
    assertExactKeys(scope, SCOPE_KEYS, `Scope ${scope.scope_id ?? '(unknown)'}`);
    assertExactKeys(scope.denominator, DENOMINATOR_KEYS, `Scope denominator ${scope.scope_id ?? '(unknown)'}`);
    assertOpaqueId(scope.scope_id, 'scope_id');
    assertArray(scope.endpoint_ids, `Scope endpoints ${scope.scope_id ?? '(unknown)'}`, { unique: true });
    if (scope.endpoint_ids.some((endpointId) => !endpointIds.has(endpointId))) throw new TypeError(`${scope.scope_id} references an unknown endpoint.`);
    if (scope.keyword_search_is_denominator !== false || scope.denominator.unknown_handling !== 'preserve_unknown' || scope.denominator.exclusions_visible !== true) {
      throw new TypeError(`${scope.scope_id} violates denominator truth requirements.`);
    }
  }
  return deepClone(descriptor);
}

function findRoute(descriptor, endpointId, templateId) {
  const endpoint = descriptor.endpoints.find((candidate) => candidate.endpoint_id === endpointId);
  const route = endpoint?.routes.find((candidate) => candidate.template_id === templateId);
  if (!endpoint || !route) throw policyFailure('ROUTE_NOT_MANIFESTED', endpoint?.target_class ?? 'collection');
  return { endpoint, route };
}

function substitutePath(pathTemplate, pathParameters, allowedParameters, targetClass) {
  const placeholders = [...pathTemplate.matchAll(/\{([A-Za-z][A-Za-z0-9_.-]*)\}/g)].map((match) => match[1]);
  const provided = Object.keys(pathParameters ?? {});
  if (provided.some((name) => !placeholders.includes(name)) || placeholders.some((name) => !(name in (pathParameters ?? {})))) {
    throw policyFailure('ROUTE_PATH_PARAMETER_MISMATCH', targetClass);
  }
  for (const name of placeholders) {
    if (!allowedParameters.includes(name)) throw policyFailure('ROUTE_PATH_PARAMETER_NOT_ALLOWED', targetClass);
  }
  return pathTemplate.replace(/\{([A-Za-z][A-Za-z0-9_.-]*)\}/g, (_, name) => {
    const value = String(pathParameters[name]);
    if (!value || value.length > 512 || /[\\/\u0000]/.test(value) || value === '.' || value === '..' || FORBIDDEN_INTENT_PATTERN.test(value) || SECRET_VALUE_PATTERN.test(value)) throw policyFailure('FORBIDDEN_ROUTE_INTENT', targetClass);
    return encodeURIComponent(value);
  });
}

function appendQuery(url, query, allowedParameters, targetClass) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw policyFailure('QUERY_OBJECT_REQUIRED', targetClass);
  let valueCount = 0;
  for (const [name, rawValue] of Object.entries(query ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!allowedParameters.includes(name)) throw policyFailure('QUERY_PARAMETER_NOT_MANIFESTED', targetClass);
    if (isSecretParameterName(name)) throw policyFailure('SECRET_QUERY_PARAMETER_BLOCKED', targetClass);
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      valueCount += 1;
      if (valueCount > 50 || value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value)) || !['string', 'number', 'boolean'].includes(typeof value)) throw policyFailure('QUERY_VALUE_INVALID_OR_EXCESSIVE', targetClass);
      const text = String(value);
      if (text.length > 512 || FORBIDDEN_INTENT_PATTERN.test(`${name}=${text}`) || SECRET_VALUE_PATTERN.test(text)) throw policyFailure('FORBIDDEN_ROUTE_INTENT', targetClass);
      url.searchParams.append(name, text);
    }
  }
}

function targetClassForRequest(endpoint, request) {
  const requested = request.targetClass ?? endpoint.target_class;
  if (requested === endpoint.target_class) return requested;
  const declaredPagination = endpoint.target_class === 'collection' && requested === 'pagination_cursor' &&
    Object.keys(request.query ?? {}).some((name) => PAGINATION_PARAMETERS.has(name));
  if (!declaredPagination) throw policyFailure('TARGET_CLASS_MISMATCH', endpoint.target_class);
  return requested;
}

function assertManifestOrigin(url, endpoint, targetClass) {
  const endpointUrl = new URL(endpoint.base_url);
  if (url.origin !== endpointUrl.origin) throw policyFailure('REQUEST_ORIGIN_NOT_ALLOWED', targetClass);
}

function assertRawRedirectPath(value, targetClass) {
  const raw = String(value).split(/[?#]/, 1)[0];
  const authority = raw.match(/^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^/]*/)?.[0] ?? '';
  for (const segment of raw.slice(authority.length).split('/')) {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { throw policyFailure('REDIRECT_PATH_ENCODING_INVALID', targetClass); }
    if (decoded === '.' || decoded === '..' || /[\\/\u0000]/.test(decoded)) throw policyFailure('REDIRECT_UNSAFE_PATH_SEGMENT', targetClass);
  }
}

export function compileManifestRequest(descriptorInput, request) {
  const descriptor = validateDescriptor(descriptorInput);
  assertExactKeys(request, REQUEST_KEYS, 'Manifest request');
  const { endpoint, route } = findRoute(descriptor, request.endpointId, request.templateId);
  const targetClass = targetClassForRequest(endpoint, request);
  if (request.purpose && request.purpose !== route.purpose) throw policyFailure('ROUTE_PURPOSE_MISMATCH', targetClass);
  if (request.method && request.method !== route.method) throw policyFailure('ROUTE_METHOD_MISMATCH', targetClass);
  if (FORBIDDEN_INTENT_PATTERN.test(JSON.stringify({ purpose: route.purpose, pathParameters: request.pathParameters, query: request.query }))) {
    throw policyFailure('FORBIDDEN_ROUTE_INTENT', targetClass);
  }
  const path = substitutePath(route.path_template, request.pathParameters ?? {}, route.allowed_parameters, targetClass);
  const url = new URL(path, endpoint.base_url);
  assertManifestOrigin(url, endpoint, targetClass);
  appendQuery(url, request.query ?? {}, route.allowed_parameters, targetClass);
  assertBoundedUrl(url, targetClass);
  return {
    descriptor,
    endpoint: deepClone(endpoint),
    route: deepClone(route),
    url,
    method: route.method,
    purpose: route.purpose,
    targetClass,
  };
}

export function matchManifestRedirect(descriptorInput, candidateUrl, { purpose, method, targetClass }) {
  const descriptor = validateDescriptor(descriptorInput);
  assertRawRedirectPath(candidateUrl, targetClass);
  const url = new URL(candidateUrl);
  assertBoundedUrl(url, targetClass);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw policyFailure('REDIRECT_SCHEME_OR_PORT_BLOCKED', targetClass);
  if (/%2f|%5c|%00/i.test(url.pathname)) throw policyFailure('REDIRECT_ENCODED_PATH_SEPARATOR_BLOCKED', targetClass);
  for (const segment of url.pathname.split('/')) {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { throw policyFailure('REDIRECT_PATH_ENCODING_INVALID', targetClass); }
    if (decoded === '.' || decoded === '..' || /[\\/\u0000]/.test(decoded)) throw policyFailure('REDIRECT_UNSAFE_PATH_SEGMENT', targetClass);
  }
  const host = normalizedHost(url.hostname);
  if (!descriptor.allowed_hosts.map(normalizedHost).includes(host)) throw policyFailure('REDIRECT_HOST_NOT_ALLOWED', targetClass);
  const queryEntries = [...url.searchParams];
  if (queryEntries.length > 50 || queryEntries.some(([name, value]) => name.length > 64 || value.length > 512)) throw policyFailure('REDIRECT_QUERY_BOUND_EXCEEDED', targetClass);
  const candidates = routeIndex(descriptor).filter(({ endpoint, route }) => {
    const endpointHost = normalizedHost(new URL(endpoint.base_url).hostname);
    return endpointHost === host && route.purpose === purpose && route.method === method && templatePattern(route.path_template).test(url.pathname);
  });
  const matches = candidates.filter(({ route }) => queryEntries.every(([name, value]) => route.allowed_parameters.includes(name) && !isSecretParameterName(name) && !SECRET_VALUE_PATTERN.test(value)));
  if (matches.length !== 1) throw policyFailure(matches.length ? 'REDIRECT_ROUTE_AMBIGUOUS' : 'REDIRECT_ROUTE_NOT_MANIFESTED', targetClass);
  if (queryEntries.some(([name, value]) => FORBIDDEN_INTENT_PATTERN.test(`${name}=${value}`))) throw policyFailure('FORBIDDEN_ROUTE_INTENT', targetClass);
  const matched = matches[0];
  const redirectedTargetClass = matched.endpoint.target_class === 'collection' && queryEntries.some(([name]) => PAGINATION_PARAMETERS.has(name))
    ? 'pagination_cursor'
    : matched.endpoint.target_class;
  const compatibleTarget = redirectedTargetClass === targetClass || (targetClass === 'collection' && redirectedTargetClass === 'pagination_cursor');
  if (!compatibleTarget) throw policyFailure('REDIRECT_TARGET_CLASS_MISMATCH', targetClass);
  return { descriptor, endpoint: deepClone(matched.endpoint), route: deepClone(matched.route), url, method, purpose, targetClass: redirectedTargetClass };
}

export function redactedLocator(urlInput) {
  const url = new URL(urlInput);
  url.username = '';
  url.password = '';
  for (const name of [...url.searchParams.keys()]) {
    if (isSecretParameterName(name) || url.searchParams.getAll(name).some((value) => SECRET_VALUE_PATTERN.test(value))) url.searchParams.delete(name);
  }
  url.hash = '';
  return url.toString();
}

export function routeManifestInventory(descriptor) {
  return routeIndex(validateDescriptor(descriptor)).map(({ endpoint, route }) => ({
    endpoint_id: endpoint.endpoint_id,
    template_id: route.template_id,
    purpose: route.purpose,
    method: route.method,
    target_class: endpoint.target_class,
    path_template: route.path_template,
    expected_content_classes: [...route.expected_content_classes],
    forbidden_route_classes: [...route.forbidden_route_classes],
  }));
}
