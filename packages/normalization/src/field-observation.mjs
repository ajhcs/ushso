import { canonicalJson, sha256Bytes } from './canonical.mjs';

export const FIELD_OBSERVATION_VERSION = 'ushso.field-observation.v1.0.0';
export const ACCESS_SUMMARY_VERSION = 'ushso.access-summary.v1.0.0';

export const VALUE_STATES = Object.freeze(['known', 'unknown']);
export const EVIDENCE_STATES = Object.freeze(['unknown', 'candidate', 'ambiguous', 'documented', 'observed', 'executed', 'proven', 'disputed']);
export const APPLICABILITY_STATES = Object.freeze(['supported', 'unsupported', 'missing', 'not_applicable', 'conflicting', 'unknown']);
export const ATTEMPT_STATES = Object.freeze(['not_attempted', 'succeeded', 'restricted', 'failed', 'blocked', 'unavailable', 'stale', 'unknown']);
export const FIELD_ROLES = Object.freeze(['identifier', 'dimension', 'measure_description', 'date', 'geography', 'suppression_flag', 'metadata', 'unknown']);
export const OPERATIONS = Object.freeze(['metadata_read', 'payload_read', 'schema_read', 'browser_read', 'other']);

const CORE_CONTRACTS = Object.freeze({
  value: 'observatory-core.assertion.claimValue',
  evidence: 'observatory-core.evidenceReference',
  applicability: 'observatory-core.schemaField.field_role',
  attempt: 'observatory-core.accessObservation'
});

const RFC3339_DATE_TIME = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[Tt](?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d+))?(?<zone>[Zz]|[+-]\d{2}:\d{2})$/u;

function parseRfc3339(value) {
  if (typeof value !== 'string') return null;
  const match = RFC3339_DATE_TIME.exec(value);
  if (!match) return null;
  const { year, month, day, hour, minute, second, fraction = '', zone } = match.groups;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(second);
  const leapYear = yearNumber % 4 === 0 && (yearNumber % 100 !== 0 || yearNumber % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > daysInMonth[monthNumber - 1]
      || hourNumber > 23 || minuteNumber > 59 || secondNumber > 59) return null;
  let offsetSeconds = 0;
  if (zone !== 'Z' && zone !== 'z') {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return null;
    offsetSeconds = (offsetHours * 60 + offsetMinutes) * 60 * (zone[0] === '+' ? 1 : -1);
  }
  const utc = new Date(0);
  utc.setUTCFullYear(yearNumber, monthNumber - 1, dayNumber);
  utc.setUTCHours(hourNumber, minuteNumber, secondNumber, 0);
  const time = utc.getTime();
  if (!Number.isFinite(time)) return null;
  return {
    epochSeconds: BigInt(Math.trunc(time / 1000)) - BigInt(offsetSeconds),
    fraction: fraction.replace(/0+$/u, '')
  };
}

export function isRfc3339DateTime(value) {
  return parseRfc3339(value) !== null;
}

export function compareRfc3339(left, right) {
  const leftParsed = parseRfc3339(left);
  const rightParsed = parseRfc3339(right);
  if (!leftParsed || !rightParsed) throw new TypeError('RFC3339_TIMESTAMP_REQUIRED');
  if (leftParsed.epochSeconds < rightParsed.epochSeconds) return -1;
  if (leftParsed.epochSeconds > rightParsed.epochSeconds) return 1;
  const width = Math.max(leftParsed.fraction.length, rightParsed.fraction.length);
  const leftFraction = leftParsed.fraction.padEnd(width, '0');
  const rightFraction = rightParsed.fraction.padEnd(width, '0');
  return leftFraction < rightFraction ? -1 : leftFraction > rightFraction ? 1 : 0;
}

const ISO_DATE_TIME = isRfc3339DateTime;
const nullableIso = value => value === null || ISO_DATE_TIME(value);

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function error(code, message, path = '/') {
  return { code, message, path };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unique(values) {
  return new Set(values).size === values.length;
}

function validateClaimValue(value, path = '/value') {
  const errors = [];
  if (!isObject(value)) return [error('value_shape', 'value must be a claim-value object', path)];
  if (typeof value.kind !== 'string') return [error('value_kind', 'value.kind is required', `${path}/kind`)];
  if (!own(value, 'value')) errors.push(error('value_member', 'value.value is required', path));
  if (Object.keys(value).some(key => !['kind', 'value'].includes(key))) errors.push(error('value_property', 'claim values contain only kind and value', path));
  const knownKinds = new Set(['string', 'identifier', 'date', 'integer', 'number', 'boolean', 'string_list']);
  if (value.kind === 'unknown') {
    if (value.value !== null) errors.push(error('unknown_value_not_null', 'unknown values must use null', `${path}/value`));
    return errors;
  }
  if (!knownKinds.has(value.kind)) {
    errors.push(error('value_kind', `unsupported value kind: ${value.kind}`, `${path}/kind`));
    return errors;
  }
  if (value.kind === 'string' || value.kind === 'identifier') {
    if (typeof value.value !== 'string' || value.value.length === 0) errors.push(error('value_string', 'string values must be non-empty strings', `${path}/value`));
  } else if (value.kind === 'date') {
    if (!validCalendarDate(value.value)) errors.push(error('value_date', 'date values must be valid YYYY-MM-DD dates', `${path}/value`));
  } else if (value.kind === 'integer') {
    if (!Number.isSafeInteger(value.value)) errors.push(error('value_integer', 'integer values must be safe integers', `${path}/value`));
  } else if (value.kind === 'number') {
    if (typeof value.value !== 'number' || !Number.isFinite(value.value)) errors.push(error('value_number', 'number values must be finite numbers', `${path}/value`));
  } else if (value.kind === 'boolean') {
    if (typeof value.value !== 'boolean') errors.push(error('value_boolean', 'boolean values must be booleans', `${path}/value`));
  } else if (value.kind === 'string_list') {
    if (!Array.isArray(value.value) || value.value.length === 0 || !value.value.every(item => typeof item === 'string' && item.length > 0) || !unique(value.value)) errors.push(error('value_string_list', 'string lists must be non-empty and unique', `${path}/value`));
  }
  return errors;
}

function validateEvidenceRef(value, path) {
  const errors = [];
  if (!isObject(value)) return [error('evidence_shape', 'evidence references must be objects', path)];
  const required = ['evidence_id', 'evidence_state', 'observed_at', 'source_locator', 'claim_paths', 'staleness_state'];
  for (const key of required) if (!own(value, key)) errors.push(error('evidence_required', `${key} is required`, `${path}/${key}`));
  if (typeof value.evidence_id !== 'string' || value.evidence_id.length < 3) errors.push(error('evidence_id', 'evidence_id must be a non-empty identifier', `${path}/evidence_id`));
  if (!EVIDENCE_STATES.includes(value.evidence_state)) errors.push(error('evidence_state', 'unknown evidence state', `${path}/evidence_state`));
  if (!ISO_DATE_TIME(value.observed_at)) errors.push(error('evidence_time', 'evidence observed_at must be an ISO timestamp', `${path}/observed_at`));
  if (!(value.source_locator === null || (typeof value.source_locator === 'string' && value.source_locator.length > 0))) errors.push(error('evidence_locator', 'source_locator must be a string or null', `${path}/source_locator`));
  if (!Array.isArray(value.claim_paths) || value.claim_paths.length === 0 || !value.claim_paths.every(item => typeof item === 'string' && item.length > 0) || !unique(value.claim_paths)) errors.push(error('evidence_claim_paths', 'claim_paths must be a non-empty unique string list', `${path}/claim_paths`));
  if (!['current', 'stale', 'unknown', 'not_applicable'].includes(value.staleness_state)) errors.push(error('evidence_staleness', 'unknown evidence staleness state', `${path}/staleness_state`));
  return errors;
}

function validateEndpointScope(value, path = '/endpoint_scope') {
  const errors = [];
  if (!isObject(value)) return [error('endpoint_scope_shape', 'endpoint_scope must be an object', path)];
  for (const key of ['endpoint_id', 'resource']) {
    if (!(value[key] === null || (typeof value[key] === 'string' && value[key].length >= (key === 'resource' ? 1 : 3)))) errors.push(error('endpoint_scope_value', `${key} must be a string or null`, `${path}/${key}`));
  }
  if (!OPERATIONS.includes(value.operation)) errors.push(error('endpoint_operation', 'unknown endpoint operation', `${path}/operation`));
  return errors;
}


function orderError(errors, later, earlier, code, message, path) {
  if (ISO_DATE_TIME(later) && ISO_DATE_TIME(earlier) && compareRfc3339(later, earlier) > 0) errors.push(error(code, message, path));
}

function validateEvidenceTimes(refs, maximum, path, errors) {
  if (!Array.isArray(refs)) return;
  for (const [index, ref] of refs.entries()) {
    if (isObject(ref)) orderError(errors, ref.observed_at, maximum, 'future_evidence_time', 'evidence observed_at cannot be later than its containing observation', path + '/' + index + '/observed_at');
  }
}

function validateTemporalOrdering(value, path = '') {
  const errors = [];
  orderError(errors, value.source_observed_at, value.observed_at, 'source_after_observation', 'source_observed_at cannot be later than observed_at', path + '/source_observed_at');
  orderError(errors, value.observed_at, value.recorded_at, 'observation_after_recording', 'observed_at cannot be later than recorded_at', path + '/observed_at');
  orderError(errors, value.attempted_at, value.recorded_at, 'attempt_after_recording', 'attempted_at cannot be later than recorded_at', path + '/attempted_at');
  orderError(errors, value.observed_at, value.stale_at, 'stale_before_observation', 'stale_at cannot be earlier than observed_at', path + '/stale_at');
  orderError(errors, value.attempted_at, value.stale_at, 'stale_before_attempt', 'stale_at cannot be earlier than attempted_at', path + '/stale_at');
  orderError(errors, value.recorded_at, value.stale_at, 'stale_before_recording', 'stale_at cannot be earlier than recorded_at', path + '/stale_at');
  validateEvidenceTimes(value.evidence_refs, value.recorded_at, path + '/evidence_refs', errors);
  const access = value.access_facts;
  if (isObject(access)) {
    orderError(errors, access.observed_at, value.recorded_at, 'access_after_recording', 'access facts observed_at cannot be later than recorded_at', path + '/access_facts/observed_at');
    validateEvidenceTimes(access.evidence_refs, access.observed_at, path + '/access_facts/evidence_refs', errors);
    for (const [index, requirement] of (Array.isArray(access.credential_requirements) ? access.credential_requirements.entries() : [])) {
      if (!isObject(requirement)) continue;
      orderError(errors, requirement.observed_at, access.observed_at, 'credential_after_access', 'credential requirement observed_at cannot be later than access facts', path + '/access_facts/credential_requirements/' + index + '/observed_at');
      validateEvidenceTimes(requirement.evidence_refs, requirement.observed_at, path + '/access_facts/credential_requirements/' + index + '/evidence_refs', errors);
    }
    for (const [key, code] of [['cost', 'cost_after_access'], ['usage_limit', 'usage_after_access']]) {
      const facts = access[key];
      if (!isObject(facts)) continue;
      orderError(errors, facts.observed_at, access.observed_at, code, key + ' observed_at cannot be later than access facts', path + '/access_facts/' + key + '/observed_at');
      validateEvidenceTimes(facts.evidence_refs, facts.observed_at, path + '/access_facts/' + key + '/evidence_refs', errors);
    }
  }
  if (Array.isArray(value.browser_observations)) {
    for (const [index, browser] of value.browser_observations.entries()) {
      if (!isObject(browser)) continue;
      orderError(errors, browser.observed_at, value.recorded_at, 'browser_after_recording', 'browser observation observed_at cannot be later than recorded_at', path + '/browser_observations/' + index + '/observed_at');
      validateEvidenceTimes(browser.evidence_refs, browser.observed_at, path + '/browser_observations/' + index + '/evidence_refs', errors);
    }
  }
  return errors;
}

function validateEndpointOutcome(value, path = '') {
  const errors = [];
  const attemptedStates = new Set(['succeeded', 'restricted', 'failed', 'blocked', 'unavailable', 'stale', 'unknown']);
  if (attemptedStates.has(value.attempt_state)) {
    const endpoint = value.endpoint_scope;
    if (!isObject(endpoint) || typeof endpoint.endpoint_id !== 'string' || typeof endpoint.resource !== 'string' || endpoint.operation === 'other') {
      errors.push(error('attempt_scope_required', 'attempted outcomes require an endpoint, resource and operation scope', path + '/endpoint_scope'));
    } else if (typeof value.field_id === 'string' && value.field_id.startsWith('payload.') && endpoint.operation !== 'payload_read') {
      errors.push(error('payload_operation_scope', 'payload fields require payload_read operation scope', path + '/endpoint_scope/operation'));
    } else if (typeof value.field_id === 'string' && value.field_id.startsWith('schema.') && endpoint.operation !== 'schema_read') {
      errors.push(error('schema_operation_scope', 'schema fields require schema_read operation scope', path + '/endpoint_scope/operation'));
    }
  }
  return errors;
}

function validateBrowserObservations(value, path) {
  const errors = [];
  if (!Array.isArray(value)) {
    errors.push(error('browser_observations', 'browser_observations must be an array', path));
    return errors;
  }
  for (const [index, browser] of value.entries()) {
    const browserPath = path + '/' + index;
    if (!isObject(browser)) {
      errors.push(error('browser_observation_shape', 'browser observations must be objects', browserPath));
      continue;
    }
    if (!['succeeded', 'failed', 'blocked', 'not_tested', 'unknown'].includes(browser.state)) errors.push(error('browser_observation_state', 'unknown browser observation state', browserPath + '/state'));
    errors.push(...validateEndpointScope(browser.endpoint_scope, browserPath + '/endpoint_scope'));
    const endpoint = browser.endpoint_scope;
    if (!isObject(endpoint) || typeof endpoint.endpoint_id !== 'string' || typeof endpoint.resource !== 'string' || endpoint.operation !== 'browser_read') errors.push(error('browser_scope_required', 'browser observations require an endpoint/resource with browser_read operation', browserPath + '/endpoint_scope'));
    if (!ISO_DATE_TIME(browser.observed_at)) errors.push(error('browser_observation_time', 'browser observation observed_at must be an ISO timestamp', browserPath + '/observed_at'));
    if (!Array.isArray(browser.evidence_refs) || browser.evidence_refs.length === 0) errors.push(error('browser_observation_evidence', 'browser observations require evidence', browserPath + '/evidence_refs'));
    else for (const [evidenceIndex, ref] of browser.evidence_refs.entries()) errors.push(...validateEvidenceRef(ref, browserPath + '/evidence_refs/' + evidenceIndex));
    if (!Array.isArray(browser.reason_codes) || browser.reason_codes.length === 0 || !browser.reason_codes.every(item => typeof item === 'string' && /^[a-z][a-z0-9_.-]{1,119}$/u.test(item))) errors.push(error('browser_observation_reason', 'browser observations require reason codes', browserPath + '/reason_codes'));
  }
  return errors;
}

function credentialSecretLike(name) {
  return !/^[A-Za-z][A-Za-z0-9_.:/ -]{1,119}$/u.test(name) || /(?:password|secret|bearer|api[_ -]?key)\s*[:=]/iu.test(name) || /^(?:sk|pk)-[A-Za-z0-9_-]{16,}$/u.test(name);
}

function validateAccessFacts(value, path = '/access_facts') {
  const errors = [];
  if (!isObject(value)) return [error('access_facts_shape', 'access_facts must be an object', path)];
  for (const key of ['credential_requirements', 'cost', 'usage_limit', 'evidence_refs', 'observed_at']) if (!own(value, key)) errors.push(error('access_facts_required', `${key} is required`, `${path}/${key}`));
  if (!Array.isArray(value.credential_requirements)) errors.push(error('credential_requirements', 'credential_requirements must be an array', `${path}/credential_requirements`));
  else for (const [index, requirement] of value.credential_requirements.entries()) {
    const itemPath = `${path}/credential_requirements/${index}`;
    if (!isObject(requirement)) { errors.push(error('credential_requirement_shape', 'credential requirements must be objects', itemPath)); continue; }
    for (const key of ['requirement_id', 'kind', 'name', 'state', 'evidence_refs', 'observed_at']) if (!own(requirement, key)) errors.push(error('credential_requirement_required', `${key} is required`, `${itemPath}/${key}`));
    if (typeof requirement.requirement_id !== 'string' || requirement.requirement_id.length < 3) errors.push(error('credential_requirement_id', 'requirement_id must be a non-empty identifier', `${itemPath}/requirement_id`));
    if (!['credential', 'registration', 'application', 'dua', 'license', 'payment', 'authorization', 'rate_limit', 'other'].includes(requirement.kind)) errors.push(error('credential_requirement_kind', 'unknown credential requirement kind', `${itemPath}/kind`));
    if (typeof requirement.name !== 'string' || requirement.name.length < 2 || credentialSecretLike(requirement.name)) errors.push(error('credential_secret', 'credential requirements contain names/placeholders only', `${itemPath}/name`));
    if (!['required', 'not_required', 'unknown', 'conflicting'].includes(requirement.state)) errors.push(error('credential_requirement_state', 'unknown credential requirement state', `${itemPath}/state`));
    if (!Array.isArray(requirement.evidence_refs) || requirement.evidence_refs.length === 0) errors.push(error('credential_requirement_evidence', 'credential requirements require evidence', `${itemPath}/evidence_refs`));
    else for (const [evidenceIndex, ref] of requirement.evidence_refs.entries()) errors.push(...validateEvidenceRef(ref, `${itemPath}/evidence_refs/${evidenceIndex}`));
    if (!ISO_DATE_TIME(requirement.observed_at)) errors.push(error('credential_requirement_time', 'credential requirement observed_at must be an ISO timestamp', `${itemPath}/observed_at`));
  }
  if (!isObject(value.cost)) errors.push(error('cost_shape', 'cost must be an object', `${path}/cost`));
  else {
    const cost = value.cost;
    if (!['documented_free', 'payment_required', 'unknown', 'conflicting'].includes(cost.state)) errors.push(error('cost_state', 'unknown cost state', `${path}/cost/state`));
    if (!(cost.amount === null || (typeof cost.amount === 'number' && Number.isFinite(cost.amount) && cost.amount >= 0))) errors.push(error('cost_amount', 'cost amount must be a non-negative number or null', `${path}/cost/amount`));
    if (['unknown', 'conflicting'].includes(cost.state) && cost.amount !== null) errors.push(error('cost_unknown_amount', 'unknown or conflicting cost cannot carry an amount', `${path}/cost/amount`));
    if (cost.state === 'documented_free' && cost.amount !== null && cost.amount !== 0) errors.push(error('cost_free_amount', 'documented free cost cannot carry a non-zero amount', `${path}/cost/amount`));
    if (!(cost.currency === null || (typeof cost.currency === 'string' && /^[A-Z]{3}$/u.test(cost.currency)))) errors.push(error('cost_currency', 'currency must be an ISO-like three-letter code or null', `${path}/cost/currency`));
    if (!Array.isArray(cost.evidence_refs) || cost.evidence_refs.length === 0) errors.push(error('cost_evidence', 'cost requires evidence', `${path}/cost/evidence_refs`));
    else for (const [index, ref] of cost.evidence_refs.entries()) errors.push(...validateEvidenceRef(ref, `${path}/cost/evidence_refs/${index}`));
    if (!ISO_DATE_TIME(cost.observed_at)) errors.push(error('cost_time', 'cost observed_at must be an ISO timestamp', `${path}/cost/observed_at`));
  }
  if (!isObject(value.usage_limit)) errors.push(error('usage_limit_shape', 'usage_limit must be an object', `${path}/usage_limit`));
  else {
    const limit = value.usage_limit;
    if (!['documented', 'unknown', 'conflicting', 'not_applicable'].includes(limit.state)) errors.push(error('usage_limit_state', 'unknown usage-limit state', `${path}/usage_limit/state`));
    if (!(limit.limit === null || Number.isSafeInteger(limit.limit) && limit.limit >= 0)) errors.push(error('usage_limit_value', 'usage limits must be non-negative safe integers or null', `${path}/usage_limit/limit`));
    if (['unknown', 'conflicting', 'not_applicable'].includes(limit.state) && limit.limit !== null) errors.push(error('usage_limit_unknown_value', 'unknown, conflicting or inapplicable usage limits cannot carry a limit', `${path}/usage_limit/limit`));
    if (!(limit.unit === null || (typeof limit.unit === 'string' && limit.unit.length > 0))) errors.push(error('usage_limit_unit', 'usage-limit unit must be a string or null', `${path}/usage_limit/unit`));
    if (!Array.isArray(limit.evidence_refs) || limit.evidence_refs.length === 0) errors.push(error('usage_limit_evidence', 'usage limits require evidence', `${path}/usage_limit/evidence_refs`));
    else for (const [index, ref] of limit.evidence_refs.entries()) errors.push(...validateEvidenceRef(ref, `${path}/usage_limit/evidence_refs/${index}`));
    if (!ISO_DATE_TIME(limit.observed_at)) errors.push(error('usage_limit_time', 'usage-limit observed_at must be an ISO timestamp', `${path}/usage_limit/observed_at`));
  }
  if (!Array.isArray(value.evidence_refs) || value.evidence_refs.length === 0) errors.push(error('access_evidence', 'access facts require evidence', `${path}/evidence_refs`));
  else for (const [index, ref] of value.evidence_refs.entries()) errors.push(...validateEvidenceRef(ref, `${path}/evidence_refs/${index}`));
  if (!ISO_DATE_TIME(value.observed_at)) errors.push(error('access_time', 'access facts observed_at must be an ISO timestamp', `${path}/observed_at`));
  return errors;
}

function validateHistoryItem(value, path) {
  const errors = [];
  if (!isObject(value)) return [error('history_shape', 'history entries must be objects', path)];
  const required = ['revision_id', 'record_id', 'source_id', 'field_id', 'field_role', 'unit', 'value', 'value_state', 'evidence_state', 'applicability_state', 'attempt_state', 'endpoint_scope', 'evidence_refs', 'reason_codes', 'source_observed_at', 'observed_at', 'recorded_at', 'attempted_at', 'stale_at', 'access_facts', 'browser_observations', 'core_contracts'];
  for (const key of required) if (!own(value, key)) errors.push(error('history_required', key + ' is required', path + '/' + key));
  if (typeof value.revision_id !== 'string' || value.revision_id.length < 3) errors.push(error('history_revision', 'history revision_id must be a non-empty identifier', path + '/revision_id'));
  for (const key of ['record_id', 'source_id']) if (typeof value[key] !== 'string' || value[key].length < 3) errors.push(error('history_identifier', key + ' must be a non-empty identifier', path + '/' + key));
  if (typeof value.field_id !== 'string' || !/^[a-z][a-z0-9._-]{1,119}$/u.test(value.field_id)) errors.push(error('history_field_id', 'history field_id must be stable', path + '/field_id'));
  if (!FIELD_ROLES.includes(value.field_role)) errors.push(error('history_field_role', 'unknown history field role', path + '/field_role'));
  if (!(value.unit === null || typeof value.unit === 'string' && value.unit.length > 0)) errors.push(error('history_unit', 'history unit must be a string or null', path + '/unit'));
  if (value.field_role === 'identifier' && value.unit !== null) errors.push(error('history_identifier_unit', 'history identifier fields cannot have a physical unit', path + '/unit'));
  errors.push(...validateClaimValue(value.value, path + '/value'));
  if (!VALUE_STATES.includes(value.value_state)) errors.push(error('history_value_state', 'unknown history value state', path + '/value_state'));
  if (!EVIDENCE_STATES.includes(value.evidence_state)) errors.push(error('history_evidence_state', 'unknown history evidence state', path + '/evidence_state'));
  if (!APPLICABILITY_STATES.includes(value.applicability_state)) errors.push(error('history_applicability_state', 'unknown history applicability state', path + '/applicability_state'));
  if (!ATTEMPT_STATES.includes(value.attempt_state)) errors.push(error('history_attempt_state', 'unknown history attempt state', path + '/attempt_state'));
  if (value.value_state === 'unknown' && value.value?.kind !== 'unknown') errors.push(error('history_unknown_value', 'unknown history values must use the unknown claim kind', path + '/value'));
  if (value.value_state === 'known' && value.value?.kind === 'unknown') errors.push(error('history_known_value', 'known history values cannot use the unknown claim kind', path + '/value'));
  errors.push(...validateEndpointScope(value.endpoint_scope, path + '/endpoint_scope'));
  if (!Array.isArray(value.evidence_refs) || value.evidence_refs.length === 0 || !unique(value.evidence_refs.map(item => item?.evidence_id))) errors.push(error('history_evidence_refs', 'history evidence_refs must be a non-empty unique list', path + '/evidence_refs'));
  else for (const [index, ref] of value.evidence_refs.entries()) errors.push(...validateEvidenceRef(ref, path + '/evidence_refs/' + index));
  if (!Array.isArray(value.reason_codes) || value.reason_codes.length === 0 || !unique(value.reason_codes) || !value.reason_codes.every(item => typeof item === 'string' && /^[a-z][a-z0-9_.-]{1,119}$/u.test(item))) errors.push(error('history_reason_codes', 'history reason_codes must be a non-empty unique code list', path + '/reason_codes'));
  if (!nullableIso(value.source_observed_at)) errors.push(error('history_source_time', 'history source_observed_at must be an ISO timestamp or null', path + '/source_observed_at'));
  if (!ISO_DATE_TIME(value.observed_at)) errors.push(error('history_observed_time', 'history observed_at must be an ISO timestamp', path + '/observed_at'));
  if (!ISO_DATE_TIME(value.recorded_at)) errors.push(error('history_recorded_time', 'history recorded_at must be an ISO timestamp', path + '/recorded_at'));
  if (!nullableIso(value.attempted_at)) errors.push(error('history_attempt_time', 'history attempted_at must be an ISO timestamp or null', path + '/attempted_at'));
  if (!nullableIso(value.stale_at)) errors.push(error('history_stale_time', 'history stale_at must be an ISO timestamp or null', path + '/stale_at'));
  if (value.attempt_state === 'not_attempted' && value.attempted_at !== null) errors.push(error('history_not_attempted_time', 'not-attempted history entries cannot carry attempted_at', path + '/attempted_at'));
  if (value.attempt_state !== 'not_attempted' && !ISO_DATE_TIME(value.attempted_at)) errors.push(error('history_attempt_time_required', 'attempted history entries require attempted_at', path + '/attempted_at'));
  errors.push(...validateAccessFacts(value.access_facts, path + '/access_facts'));
  errors.push(...validateBrowserObservations(value.browser_observations, path + '/browser_observations'));
  errors.push(...validateEndpointOutcome(value, path));
  errors.push(...validateTemporalOrdering(value, path));
  if (!isObject(value.core_contracts) || JSON.stringify(value.core_contracts) !== JSON.stringify(CORE_CONTRACTS)) errors.push(error('history_core_contracts', 'history entries must preserve core contracts', path + '/core_contracts'));
  return errors;
}

export function validateFieldObservation(value) {
  const errors = [];
  if (!isObject(value)) return [error('observation_shape', 'field observations must be objects')];
  const required = ['schema_version', 'observation_id', 'record_id', 'source_id', 'field_id', 'field_role', 'unit', 'value', 'value_state', 'evidence_state', 'applicability_state', 'attempt_state', 'endpoint_scope', 'evidence_refs', 'reason_codes', 'source_observed_at', 'observed_at', 'recorded_at', 'attempted_at', 'stale_at', 'access_facts', 'browser_observations', 'history', 'core_contracts'];
  for (const key of required) if (!own(value, key)) errors.push(error('observation_required', `${key} is required`, `/${key}`));
  if (value.schema_version !== FIELD_OBSERVATION_VERSION) errors.push(error('schema_version', `schema_version must be ${FIELD_OBSERVATION_VERSION}`, '/schema_version'));
  for (const key of ['observation_id', 'record_id', 'source_id']) if (typeof value[key] !== 'string' || value[key].length < 3) errors.push(error('identifier', `${key} must be a non-empty identifier`, `/${key}`));
  if (typeof value.field_id !== 'string' || !/^[a-z][a-z0-9._-]{1,119}$/u.test(value.field_id)) errors.push(error('field_id', 'field_id must be a stable lower-case field identifier', '/field_id'));
  if (!FIELD_ROLES.includes(value.field_role)) errors.push(error('field_role', 'unknown field role', '/field_role'));
  if (!(value.unit === null || typeof value.unit === 'string' && value.unit.length > 0)) errors.push(error('unit', 'unit must be a string or null', '/unit'));
  if (value.field_role === 'identifier' && value.unit !== null) errors.push(error('identifier_unit', 'identifier fields cannot have a physical unit', '/unit'));
  errors.push(...validateClaimValue(value.value));
  if (!VALUE_STATES.includes(value.value_state)) errors.push(error('value_state', 'unknown value state', '/value_state'));
  if (!EVIDENCE_STATES.includes(value.evidence_state)) errors.push(error('evidence_state', 'unknown evidence state', '/evidence_state'));
  if (!APPLICABILITY_STATES.includes(value.applicability_state)) errors.push(error('applicability_state', 'unknown applicability state', '/applicability_state'));
  if (!ATTEMPT_STATES.includes(value.attempt_state)) errors.push(error('attempt_state', 'unknown attempt state', '/attempt_state'));
  if (value.value_state === 'unknown' && value.value?.kind !== 'unknown') errors.push(error('unknown_value', 'unknown values must use the unknown claim kind', '/value'));
  if (value.value_state === 'known' && value.value?.kind === 'unknown') errors.push(error('known_value', 'known values cannot use the unknown claim kind', '/value'));
  errors.push(...validateEndpointScope(value.endpoint_scope));
  errors.push(...validateEndpointOutcome(value));
  if (!Array.isArray(value.evidence_refs) || value.evidence_refs.length === 0 || !unique(value.evidence_refs.map(item => item?.evidence_id))) errors.push(error('evidence_refs', 'evidence_refs must be a non-empty unique list', '/evidence_refs'));
  else for (const [index, ref] of value.evidence_refs.entries()) errors.push(...validateEvidenceRef(ref, `/evidence_refs/${index}`));
  if (!Array.isArray(value.reason_codes) || value.reason_codes.length === 0 || !unique(value.reason_codes) || !value.reason_codes.every(item => typeof item === 'string' && /^[a-z][a-z0-9_.-]{1,119}$/u.test(item))) errors.push(error('reason_codes', 'reason_codes must be a non-empty unique code list', '/reason_codes'));
  if (!nullableIso(value.source_observed_at)) errors.push(error('source_observed_time', 'source_observed_at must be an ISO timestamp or null', '/source_observed_at'));
  if (!ISO_DATE_TIME(value.observed_at)) errors.push(error('observed_time', 'observed_at must be an ISO timestamp', '/observed_at'));
  if (!ISO_DATE_TIME(value.recorded_at)) errors.push(error('recorded_time', 'recorded_at must be an ISO timestamp', '/recorded_at'));
  if (!nullableIso(value.attempted_at)) errors.push(error('attempted_time', 'attempted_at must be an ISO timestamp or null', '/attempted_at'));
  if (!nullableIso(value.stale_at)) errors.push(error('stale_time', 'stale_at must be an ISO timestamp or null', '/stale_at'));
  if (value.attempt_state === 'not_attempted' && value.attempted_at !== null) errors.push(error('not_attempted_time', 'not-attempted observations cannot carry attempted_at', '/attempted_at'));
  if (value.attempt_state !== 'not_attempted' && !ISO_DATE_TIME(value.attempted_at)) errors.push(error('attempt_time_required', 'attempted observations require attempted_at', '/attempted_at'));
  errors.push(...validateAccessFacts(value.access_facts));
  errors.push(...validateBrowserObservations(value.browser_observations, '/browser_observations'));
  if (!Array.isArray(value.history)) errors.push(error('history', 'history must be an array', '/history'));
  else {
    const historyIds = new Set([value.observation_id]);
    let previous = null;
    for (const [index, item] of value.history.entries()) {
      const historyPath = '/history/' + index;
      errors.push(...validateHistoryItem(item, historyPath));
      if (!isObject(item)) continue;
      if (historyIds.has(item.revision_id)) errors.push(error('history_revision_duplicate', 'history revision IDs must be unique and cannot reuse the current observation ID', historyPath + '/revision_id'));
      historyIds.add(item.revision_id);
      for (const key of ['record_id', 'source_id', 'field_id']) if (item[key] !== value[key]) errors.push(error('history_key_drift', 'history keys must match the containing observation', historyPath + '/' + key));
      if (previous) {
        orderError(errors, previous.observed_at, item.observed_at, 'history_order', 'history revisions must be ordered by observation time', historyPath + '/observed_at');
        orderError(errors, previous.recorded_at, item.recorded_at, 'history_recording_order', 'history revisions must be ordered by recording time', historyPath + '/recorded_at');
      }
      orderError(errors, item.observed_at, value.observed_at, 'history_after_current', 'history observations cannot be later than the containing observation', historyPath + '/observed_at');
      orderError(errors, item.recorded_at, value.recorded_at, 'history_recording_after_current', 'history recordings cannot be later than the containing observation', historyPath + '/recorded_at');
      previous = item;
    }
  }
  errors.push(...validateTemporalOrdering(value));
  if (!isObject(value.core_contracts) || JSON.stringify(value.core_contracts) !== JSON.stringify(CORE_CONTRACTS)) errors.push(error('core_contracts', 'field observations must identify the core value/evidence/applicability/attempt contracts', '/core_contracts'));
  return errors;
}

export function assertFieldObservation(value) {
  const errors = validateFieldObservation(value);
  if (errors.length > 0) {
    const issue = new TypeError(`FIELD_OBSERVATION_INVALID:${errors[0].code}`);
    issue.code = 'field_observation_invalid';
    issue.details = errors;
    throw issue;
  }
  return deepFreeze(clone(value));
}

function stableObservationId({ recordId, sourceId, fieldId, observedAt, attemptedAt, attemptState }) {
  const payload = canonicalJson({ record_id: recordId, source_id: sourceId, field_id: fieldId, observed_at: observedAt, attempted_at: attemptedAt, attempt_state: attemptState });
  return `urn:ushso:field-observation:${sha256Bytes(payload).slice(0, 40)}`;
}

function evidenceRefsOrThrow(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('FIELD_OBSERVATION_EVIDENCE_REQUIRED');
  return clone(value);
}

function defaultAccessFacts(evidenceRefs, observedAt) {
  const refs = clone(evidenceRefs);
  return {
    credential_requirements: [],
    cost: { state: 'unknown', amount: null, currency: null, evidence_refs: clone(refs), observed_at: observedAt },
    usage_limit: { state: 'unknown', limit: null, unit: null, evidence_refs: clone(refs), observed_at: observedAt },
    evidence_refs: clone(refs),
    observed_at: observedAt
  };
}

export function createFieldObservation(input) {
  if (!isObject(input)) throw new TypeError('FIELD_OBSERVATION_INPUT_REQUIRED');
  const observedAt = input.observed_at;
  if (!ISO_DATE_TIME(observedAt)) throw new TypeError('FIELD_OBSERVATION_OBSERVED_AT_REQUIRED');
  const evidenceRefs = evidenceRefsOrThrow(input.evidence_refs);
  const attemptState = input.attempt_state ?? 'not_attempted';
  const value = input.value ?? { kind: 'unknown', value: null };
  const valueState = input.value_state ?? (value.kind === 'unknown' ? 'unknown' : 'known');
  const attemptedAt = attemptState === 'not_attempted' ? null : input.attempted_at;
  const output = {
    schema_version: FIELD_OBSERVATION_VERSION,
    observation_id: input.observation_id ?? stableObservationId({ recordId: input.record_id, sourceId: input.source_id, fieldId: input.field_id, observedAt, attemptedAt, attemptState }),
    record_id: input.record_id,
    source_id: input.source_id,
    field_id: input.field_id,
    field_role: input.field_role ?? 'unknown',
    unit: input.unit ?? null,
    value: clone(value),
    value_state: valueState,
    evidence_state: input.evidence_state ?? 'unknown',
    applicability_state: input.applicability_state ?? 'unknown',
    attempt_state: attemptState,
    endpoint_scope: clone(input.endpoint_scope ?? { endpoint_id: null, resource: null, operation: 'other' }),
    evidence_refs: clone(evidenceRefs),
    reason_codes: [...(input.reason_codes ?? [])],
    source_observed_at: own(input, 'source_observed_at') ? input.source_observed_at : observedAt,
    observed_at: observedAt,
    recorded_at: input.recorded_at ?? observedAt,
    attempted_at: attemptedAt,
    stale_at: input.stale_at ?? null,
    access_facts: clone(input.access_facts ?? defaultAccessFacts(evidenceRefs, observedAt)),
    browser_observations: clone(input.browser_observations ?? []),
    history: clone(input.history ?? []),
    core_contracts: clone(CORE_CONTRACTS)
  };
  return assertFieldObservation(output);
}

function historySnapshot(observation) {
  return {
    revision_id: observation.observation_id,
    record_id: observation.record_id,
    source_id: observation.source_id,
    field_id: observation.field_id,
    field_role: observation.field_role,
    unit: observation.unit,
    value: clone(observation.value),
    value_state: observation.value_state,
    evidence_state: observation.evidence_state,
    applicability_state: observation.applicability_state,
    attempt_state: observation.attempt_state,
    endpoint_scope: clone(observation.endpoint_scope),
    evidence_refs: clone(observation.evidence_refs),
    reason_codes: [...observation.reason_codes],
    source_observed_at: observation.source_observed_at,
    observed_at: observation.observed_at,
    recorded_at: observation.recorded_at,
    attempted_at: observation.attempted_at,
    stale_at: observation.stale_at,
    access_facts: clone(observation.access_facts),
    browser_observations: clone(observation.browser_observations),
    core_contracts: clone(observation.core_contracts)
  };
}

export function appendFieldObservationRevision(previous, next) {
  const prior = assertFieldObservation(previous);
  if (!isObject(next)) throw new TypeError('FIELD_OBSERVATION_NEXT_REQUIRED');
  for (const key of ['record_id', 'source_id', 'field_id']) if (next[key] !== prior[key]) throw new TypeError(`FIELD_OBSERVATION_KEY_CHANGED:${key}`);
  if (next.observation_id === prior.observation_id) throw new TypeError('FIELD_OBSERVATION_REVISION_ID_REUSED');
  const history = [...prior.history, historySnapshot(prior), ...(next.history ?? [])];
  return createFieldObservation({ ...clone(next), history });
}

function sortNewest(left, right) {
  return compareRfc3339(right.observed_at, left.observed_at)
    || compareRfc3339(right.recorded_at, left.recorded_at)
    || String(right.observation_id).localeCompare(String(left.observation_id));
}

function compareOptionalNewest(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return compareRfc3339(right, left);
}

function sortNewestAttempt(left, right) {
  return compareOptionalNewest(left.attempted_at, right.attempted_at)
    || sortNewest(left, right);
}

function revisionIdentity(item, revisionId = item.observation_id) {
  return `${item.record_id}\u0000${item.source_id}\u0000${item.field_id}\u0000${revisionId}`;
}

function revisionConflict(identity) {
  const issue = new TypeError(`FIELD_OBSERVATION_REVISION_CONFLICT:${identity}`);
  issue.code = 'field_observation_revision_conflict';
  throw issue;
}

function expandObservationHistory(observations) {
  const byIdentity = new Map();
  const add = candidate => {
    const identity = revisionIdentity(candidate);
    const existing = byIdentity.get(identity);
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(candidate)) revisionConflict(identity);
      return;
    }
    byIdentity.set(identity, candidate);
  };
  for (const raw of observations) {
    const current = assertFieldObservation(raw);
    add(current);
    for (const item of current.history) {
      const historical = observationFromHistory(item);
      add(historical);
    }
  }
  return [...byIdentity.values()];
}

function observationFromHistory(item) {
  return createFieldObservation({
    observation_id: item.revision_id,
    record_id: item.record_id,
    source_id: item.source_id,
    field_id: item.field_id,
    field_role: item.field_role,
    unit: item.unit,
    value: item.value,
    value_state: item.value_state,
    evidence_state: item.evidence_state,
    applicability_state: item.applicability_state,
    attempt_state: item.attempt_state,
    endpoint_scope: item.endpoint_scope,
    evidence_refs: item.evidence_refs,
    reason_codes: item.reason_codes,
    source_observed_at: item.source_observed_at,
    observed_at: item.observed_at,
    recorded_at: item.recorded_at,
    attempted_at: item.attempted_at,
    stale_at: item.stale_at,
    access_facts: item.access_facts,
    browser_observations: item.browser_observations,
    history: []
  });
}

function eligibleAtAsOf(item, asOf) {
  return compareRfc3339(item.observed_at, asOf) <= 0
    && compareRfc3339(item.recorded_at, asOf) <= 0
    && (!item.source_observed_at || compareRfc3339(item.source_observed_at, asOf) <= 0)
    && (!item.attempted_at || compareRfc3339(item.attempted_at, asOf) <= 0);
}

export function deriveFieldObservation({ recordId, sourceId, fieldId, observations, asOf }) {
  if (!ISO_DATE_TIME(asOf)) throw new TypeError('FIELD_OBSERVATION_AS_OF_REQUIRED');
  if (!Array.isArray(observations)) throw new TypeError('FIELD_OBSERVATION_LIST_REQUIRED');
  const candidates = expandObservationHistory(observations)
    .filter(item => (recordId === undefined || item.record_id === recordId)
      && (sourceId === undefined || item.source_id === sourceId)
      && (fieldId === undefined || item.field_id === fieldId)
      && eligibleAtAsOf(item, asOf))
    .sort(sortNewest);
  const latestOriginal = candidates[0] ?? null;
  const historicalSuccess = candidates.filter(item => item.attempt_state === 'succeeded').sort(sortNewest)[0] ?? null;
  let latest = latestOriginal ? clone(latestOriginal) : null;
  if (latestOriginal?.stale_at && compareRfc3339(latestOriginal.stale_at, asOf) <= 0) {
    latest = {
      ...latest,
      attempt_state: 'stale',
      reason_codes: [...new Set([...latestOriginal.reason_codes, 'observation_expired'])].sort()
    };
  }
  if (latest) {
    const historyByIdentity = new Map(latest.history.map(item => [revisionIdentity(item, item.revision_id), item]));
    for (const candidate of candidates) {
      const identity = revisionIdentity(candidate);
      if (identity === revisionIdentity(latestOriginal)) continue;
      if (!historyByIdentity.has(identity)) historyByIdentity.set(identity, historySnapshot(candidate));
    }
    latest.history = [...historyByIdentity.values()].sort((left, right) => {
      return compareRfc3339(left.observed_at, right.observed_at)
        || compareRfc3339(left.recorded_at, right.recorded_at)
        || String(left.revision_id).localeCompare(String(right.revision_id));
    });
    latest = assertFieldObservation(latest);
  }
  return deepFreeze({
    schema_version: FIELD_OBSERVATION_VERSION,
    record_id: recordId ?? latest?.record_id ?? null,
    source_id: sourceId ?? latest?.source_id ?? null,
    field_id: fieldId ?? latest?.field_id ?? null,
    as_of: asOf,
    current_observation: latest ? clone(latest) : null,
    current_state: latest?.attempt_state ?? 'unknown',
    current_value_state: latest?.value_state ?? 'unknown',
    historical_success: historicalSuccess ? clone(historicalSuccess) : null,
    historical_success_retained: Boolean(latest && historicalSuccess && (latestOriginal.observation_id !== historicalSuccess.observation_id || latest.attempt_state !== 'succeeded')),
    derivation: latest ? 'latest_observation_at_or_before_as_of' : 'no_observation_at_or_before_as_of'
  });
}

function scopeKey(scope) {
  return JSON.stringify([scope.endpoint_id ?? null, scope.resource ?? null, scope.operation]);
}

function checkSummary(observation) {
  return {
    revision_id: observation.observation_id,
    observation_id: observation.observation_id,
    record_id: observation.record_id,
    source_id: observation.source_id,
    field_id: observation.field_id,
    attempt_state: observation.attempt_state,
    attempted_at: observation.attempted_at,
    observed_at: observation.observed_at,
    source_observed_at: observation.source_observed_at,
    recorded_at: observation.recorded_at,
    endpoint_scope: clone(observation.endpoint_scope),
    evidence_state: observation.evidence_state,
    evidence_refs: clone(observation.evidence_refs),
    reason_codes: [...observation.reason_codes]
  };
}

function mergeEvidence(refs) {
  const byId = new Map();
  for (const ref of refs) if (!byId.has(ref.evidence_id)) byId.set(ref.evidence_id, clone(ref));
  return [...byId.values()].sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
}

function latestFacts(observations, key, asOf) {
  return observations
    .map(item => ({ item, facts: item.access_facts[key] }))
    .filter(({ facts }) => facts && compareRfc3339(facts.observed_at, asOf) <= 0)
    .sort((left, right) => compareRfc3339(right.facts.observed_at, left.facts.observed_at) || right.item.observation_id.localeCompare(left.item.observation_id));
}

function documentedCost(observations, asOf) {
  const rows = latestFacts(observations, 'cost', asOf);
  if (rows.length === 0) return null;
  const fingerprints = new Set(rows.map(({ facts }) => JSON.stringify([facts.state, facts.amount, facts.currency])));
  if (fingerprints.size > 1) return { state: 'conflicting', amount: null, currency: null, evidence_refs: mergeEvidence(rows.flatMap(({ facts }) => facts.evidence_refs)), observed_at: rows[0].facts.observed_at };
  return clone(rows[0].facts);
}

function documentedUsageLimit(observations, asOf) {
  const rows = latestFacts(observations, 'usage_limit', asOf);
  if (rows.length === 0) return null;
  const fingerprints = new Set(rows.map(({ facts }) => JSON.stringify([facts.state, facts.limit, facts.unit])));
  if (fingerprints.size > 1) return { state: 'conflicting', limit: null, unit: null, evidence_refs: mergeEvidence(rows.flatMap(({ facts }) => facts.evidence_refs)), observed_at: rows[0].facts.observed_at };
  return clone(rows[0].facts);
}

function compareRequirementRows(left, right) {
  return compareRfc3339(right.observed_at, left.observed_at)
    || String(right._observation_id).localeCompare(String(left._observation_id))
    || String(right.requirement_id).localeCompare(String(left.requirement_id));
}

function documentedCredentials(observations, asOf) {
  const rows = observations.flatMap(item => item.access_facts.credential_requirements
    .filter(requirement => compareRfc3339(requirement.observed_at, asOf) <= 0)
    .map(requirement => ({ ...clone(requirement), _observation_id: item.observation_id })));
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.requirement_id)) grouped.set(row.requirement_id, []);
    grouped.get(row.requirement_id).push(row);
  }
  const resolved = [];
  for (const requirementRows of grouped.values()) {
    const sorted = [...requirementRows].sort(compareRequirementRows);
    const latest = sorted[0];
    const states = new Set(sorted.map(row => row.state));
    const output = clone(latest);
    if (states.size > 1 || states.has('conflicting')) {
      output.state = 'conflicting';
      output.evidence_refs = mergeEvidence(sorted.flatMap(row => row.evidence_refs));
    }
    delete output._observation_id;
    resolved.push(output);
  }
  return resolved.sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));
}

function compactEvidenceObject(value) {
  const output = clone(value);
  if (Array.isArray(output.evidence_refs)) {
    output.evidence_ids = output.evidence_refs.map(ref => ref.evidence_id);
    delete output.evidence_refs;
  }
  return output;
}

function compactAccessSummary(summary) {
  const output = clone(summary);
  output.endpoint_scopes = output.endpoint_scopes.map(scope => ({
    ...scope,
    documented: {
      ...scope.documented,
      credential_requirements: scope.documented.credential_requirements.map(compactEvidenceObject),
      cost: scope.documented.cost ? compactEvidenceObject(scope.documented.cost) : null,
      usage_limit: scope.documented.usage_limit ? compactEvidenceObject(scope.documented.usage_limit) : null,
      evidence_ids: scope.documented.evidence_refs.map(ref => ref.evidence_id)
    },
    latest_successful_check: scope.latest_successful_check ? compactEvidenceObject(scope.latest_successful_check) : null,
    latest_attempt: scope.latest_attempt ? compactEvidenceObject(scope.latest_attempt) : null,
    revision_history: scope.revision_history.map(compactEvidenceObject),
    browser_observations: scope.browser_observations.map(compactEvidenceObject)
  }));
  for (const scope of output.endpoint_scopes) delete scope.documented.evidence_refs;
  return output;
}

export function buildAccessSummary({ observations, asOf, compact = false }) {
  if (!Array.isArray(observations)) throw new TypeError('ACCESS_SUMMARY_OBSERVATIONS_REQUIRED');
  if (!ISO_DATE_TIME(asOf)) throw new TypeError('ACCESS_SUMMARY_AS_OF_REQUIRED');
  const eligible = expandObservationHistory(observations)
    .filter(item => eligibleAtAsOf(item, asOf))
    .filter(item => item.attempt_state !== 'not_attempted' || (typeof item.endpoint_scope?.endpoint_id === 'string' && typeof item.endpoint_scope?.resource === 'string'));
  const groups = new Map();
  for (const observation of eligible) {
    const key = scopeKey(observation.endpoint_scope);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(observation);
  }
  const endpointScopes = [...groups.values()].map(rows => {
    const sorted = [...rows].sort(sortNewest);
    const attempts = sorted.filter(item => item.attempt_state !== 'not_attempted').sort(sortNewestAttempt);
    const successes = attempts.filter(item => item.attempt_state === 'succeeded').sort(sortNewestAttempt);
    const browser = rows.flatMap(item => item.browser_observations.filter(value => compareRfc3339(value.observed_at, asOf) <= 0).map(value => ({ ...clone(value), observation_id: item.observation_id })));
    return {
      endpoint_scope: clone(sorted[0].endpoint_scope),
      documented: {
        credential_requirements: documentedCredentials(rows, asOf),
        cost: documentedCost(rows, asOf),
        usage_limit: documentedUsageLimit(rows, asOf),
        evidence_refs: mergeEvidence(rows.flatMap(item => item.access_facts.evidence_refs)),
        observed_at: [...rows].sort((left, right) => compareRfc3339(right.access_facts.observed_at, left.access_facts.observed_at))[0].access_facts.observed_at
      },
      latest_successful_check: successes[0] ? checkSummary(successes[0]) : null,
      latest_attempt: attempts[0] ? checkSummary(attempts[0]) : null,
      revision_history: attempts.map(checkSummary),
      browser_observations: browser.sort((left, right) => compareRfc3339(right.observed_at, left.observed_at)),
      boundaries: {
        metadata_reachability_is_not_payload_access: true,
        server_success_does_not_imply_browser_usability: true,
        browser_observations_are_contextual: true
      }
    };
  }).sort((left, right) => scopeKey(left.endpoint_scope).localeCompare(scopeKey(right.endpoint_scope)));
  const summary = {
    schema_version: ACCESS_SUMMARY_VERSION,
    as_of: asOf,
    endpoint_scopes: endpointScopes,
    boundaries: {
      documented_requirements_are_separate_from_observations: true,
      unknown_cost_is_not_free: true,
      unknown_usage_limit_is_not_unlimited: true,
      payload_access_requires_endpoint_scoped_attempt_evidence: true
    }
  };
  return deepFreeze(compact ? compactAccessSummary(summary) : summary);
}
