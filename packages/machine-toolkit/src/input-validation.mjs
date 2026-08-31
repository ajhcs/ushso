import { serializedBytes } from './json.mjs';
import { TOOL_BY_CAPABILITY } from './manifest.mjs';

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._~:/-]*$/u;
const CURSOR = /^[A-Za-z0-9._~-]+$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

const authorityLevels = ['authoritative', 'official_mirror', 'maintainer', 'secondary', 'candidate', 'unknown'];
const accessClasses = ['public', 'registration', 'application', 'dua', 'licensed', 'paid', 'report_only', 'unknown'];
const grains = ['facility', 'campus', 'organization', 'system', 'county', 'state', 'national', 'mixed', 'unknown'];
const machineReadiness = ['human_only', 'downloadable', 'api_documented', 'schema_indexed', 'retrieval_ready', 'join_ready', 'unknown'];
const comparisonDimensions = ['role', 'authority', 'geography', 'time', 'grain', 'access', 'variables_schema', 'freshness', 'machine_readiness', 'operation_kind', 'join_evidence', 'join_compatibility'];

function issue(path, message) {
  return { path, message };
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectShape(value, required, allowed, path, issues) {
  if (!isObject(value)) {
    issues.push(issue(path, 'must be a JSON object'));
    return false;
  }
  for (const key of required) if (!Object.hasOwn(value, key)) issues.push(issue(`${path}/${key}`, 'is required'));
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(issue(`${path}/${key}`, 'is not allowed'));
  return true;
}

function stringValue(value, path, issues, { min = 1, max, pattern } = {}) {
  const characters = typeof value === 'string' ? [...value].length : -1;
  if (typeof value !== 'string' || characters < min || (max !== undefined && characters > max) || (pattern && !pattern.test(value))) {
    issues.push(issue(path, 'is not a valid bounded string'));
    return false;
  }
  return true;
}

function stableId(value, path, issues, nullable = false) {
  if (nullable && value === null) return true;
  return stringValue(value, path, issues, { min: 1, max: 128, pattern: STABLE_ID });
}

function cursor(value, path, issues, nullable = true) {
  if (nullable && value === null) return true;
  return stringValue(value, path, issues, { min: 16, max: 2048, pattern: CURSOR });
}

function integer(value, path, issues, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    issues.push(issue(path, `must be an integer from ${min} through ${max}`));
    return false;
  }
  return true;
}

function bool(value, path, issues) {
  if (typeof value !== 'boolean') {
    issues.push(issue(path, 'must be boolean'));
    return false;
  }
  return true;
}

function enumeration(value, path, issues, values, nullable = false) {
  if (nullable && value === null) return true;
  if (!values.includes(value)) {
    issues.push(issue(path, 'is not an allowed value'));
    return false;
  }
  return true;
}

function array(value, path, issues, { min = 0, max, unique = false, item } = {}) {
  if (!Array.isArray(value) || value.length < min || (max !== undefined && value.length > max)) {
    issues.push(issue(path, 'is not a valid bounded array'));
    return false;
  }
  if (unique) {
    const seen = new Set(value.map((entry) => JSON.stringify(entry)));
    if (seen.size !== value.length) issues.push(issue(path, 'must contain unique items'));
  }
  if (item) value.forEach((entry, index) => item(entry, `${path}/${index}`, issues));
  return true;
}

function stableIdArray(value, path, issues, max = 20) {
  return array(value, path, issues, { max, unique: true, item: (entry, at, target) => stableId(entry, at, target) });
}

function enumArray(value, path, issues, values, max = 20, min = 0) {
  return array(value, path, issues, { min, max, unique: true, item: (entry, at, target) => enumeration(entry, at, target, values) });
}

function nullableText(value, path, issues, max = 4000) {
  if (value === null) return true;
  return stringValue(value, path, issues, { max });
}

function timePeriod(value, path, issues, nullable = true) {
  if (nullable && value === null) return true;
  if (!objectShape(value, ['start', 'end', 'period_kind', 'precision'], ['start', 'end', 'period_kind', 'precision'], path, issues)) return false;
  for (const name of ['start', 'end']) if (value[name] !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(value[name])) issues.push(issue(`${path}/${name}`, 'must be a full date or null'));
  enumeration(value.period_kind, `${path}/period_kind`, issues, ['calendar', 'fiscal', 'rolling', 'point_in_time', 'mixed', 'unknown']);
  enumeration(value.precision, `${path}/precision`, issues, ['day', 'month', 'quarter', 'year', 'interval', 'unknown']);
  return true;
}

function dimensions(value, path, issues) {
  return array(value, path, issues, {
    max: 20,
    item(entry, at, target) {
      if (!objectShape(entry, ['dimension', 'values'], ['dimension', 'values'], at, target)) return;
      stableId(entry.dimension, `${at}/dimension`, target);
      stableIdArray(entry.values, `${at}/values`, target);
    }
  });
}

function filters(value, path, issues) {
  const keys = ['geography_ids', 'subject_ids', 'grain', 'access_classes', 'authority_levels', 'machine_readiness', 'time_period', 'negative_constraints', 'dimensions'];
  if (!objectShape(value, keys, keys, path, issues)) return;
  stableIdArray(value.geography_ids, `${path}/geography_ids`, issues);
  stableIdArray(value.subject_ids, `${path}/subject_ids`, issues);
  enumArray(value.grain, `${path}/grain`, issues, grains);
  enumArray(value.access_classes, `${path}/access_classes`, issues, accessClasses);
  enumArray(value.authority_levels, `${path}/authority_levels`, issues, authorityLevels);
  enumArray(value.machine_readiness, `${path}/machine_readiness`, issues, machineReadiness);
  timePeriod(value.time_period, `${path}/time_period`, issues);
  array(value.negative_constraints, `${path}/negative_constraints`, issues, { max: 20, unique: true, item: (entry, at, target) => stringValue(entry, at, target, { max: 2000 }) });
  dimensions(value.dimensions, `${path}/dimensions`, issues);
}

function contract(value, expected, issues) {
  if (value !== expected) issues.push(issue('/contract_version', `must equal ${expected}`));
}

function searchAssets(input, issues) {
  const common = ['contract_version', 'mode', 'filters', 'grouping', 'limit', 'cursor', 'expected_generation'];
  const browse = input?.mode === 'browse';
  const required = browse ? [...common, 'sort'] : [...common, 'research_need'];
  if (!objectShape(input, required, required, '', issues)) return;
  contract(input.contract_version, 'observatory.machine.search-assets.input.v1.0.0', issues);
  enumeration(input.mode, '/mode', issues, ['browse', 'search']);
  filters(input.filters, '/filters', issues);
  enumeration(input.grouping, '/grouping', issues, ['none', 'family', 'source', 'release']);
  integer(input.limit, '/limit', issues, 1, 20);
  cursor(input.cursor, '/cursor', issues);
  stableId(input.expected_generation, '/expected_generation', issues, true);
  if (browse) enumeration(input.sort, '/sort', issues, ['title_asc', 'publisher_title', 'updated_desc']);
  else stringValue(input.research_need, '/research_need', issues, { max: 4000 });
}

function getAsset(input, issues) {
  const keys = ['contract_version', 'record_id', 'expected_generation', 'collection_limits', 'collection_cursors'];
  if (!objectShape(input, keys, keys, '', issues)) return;
  contract(input.contract_version, 'observatory.machine.get-asset.input.v1.0.0', issues);
  stableId(input.record_id, '/record_id', issues);
  stableId(input.expected_generation, '/expected_generation', issues, true);
  const nested = ['releases', 'distributions', 'documentation', 'schemas'];
  if (objectShape(input.collection_limits, nested, nested, '/collection_limits', issues)) for (const key of nested) integer(input.collection_limits[key], `/collection_limits/${key}`, issues, 1, 50);
  if (objectShape(input.collection_cursors, nested, nested, '/collection_cursors', issues)) for (const key of nested) cursor(input.collection_cursors[key], `/collection_cursors/${key}`, issues);
}

function accessLike(input, issues, capability) {
  const keys = ['contract_version', 'record_id', 'release_id', 'distribution_id', 'access_route_id', 'expected_generation'];
  if (!objectShape(input, keys, keys, '', issues)) return;
  contract(input.contract_version, `observatory.machine.${capability === 'get_access_plan' ? 'get-access-plan' : 'get-retrieval-recipe'}.input.v1.0.0`, issues);
  stableId(input.record_id, '/record_id', issues);
  for (const key of ['release_id', 'distribution_id', 'access_route_id', 'expected_generation']) stableId(input[key], `/${key}`, issues, true);
}

function getVariables(input, issues) {
  const keys = ['contract_version', 'record_id', 'release_id', 'distribution_id', 'schema_id', 'semantic_query', 'filters', 'limit', 'cursor', 'expected_generation'];
  if (!objectShape(input, keys, keys, '', issues)) return;
  contract(input.contract_version, 'observatory.machine.get-variables.input.v1.0.0', issues);
  stableId(input.record_id, '/record_id', issues);
  for (const key of ['release_id', 'distribution_id', 'schema_id', 'expected_generation']) stableId(input[key], `/${key}`, issues, true);
  nullableText(input.semantic_query, '/semantic_query', issues);
  dimensions(input.filters, '/filters', issues);
  integer(input.limit, '/limit', issues, 1, 100);
  cursor(input.cursor, '/cursor', issues);
}

function getJoinRoutes(input, issues) {
  const keys = ['contract_version', 'from_id', 'to_id', 'from_release_id', 'to_release_id', 'research_purpose', 'include_indirect', 'max_hops', 'limit', 'expected_generation'];
  if (!objectShape(input, keys, keys, '', issues)) return;
  contract(input.contract_version, 'observatory.machine.get-join-routes.input.v1.0.0', issues);
  stableId(input.from_id, '/from_id', issues);
  for (const key of ['to_id', 'from_release_id', 'to_release_id', 'expected_generation']) stableId(input[key], `/${key}`, issues, true);
  nullableText(input.research_purpose, '/research_purpose', issues);
  bool(input.include_indirect, '/include_indirect', issues);
  integer(input.max_hops, '/max_hops', issues, 1, 2);
  integer(input.limit, '/limit', issues, 1, 50);
}

function compareAssets(input, issues) {
  const keys = ['contract_version', 'asset_ids', 'dimensions', 'expected_generation'];
  if (!objectShape(input, keys, keys, '', issues)) return;
  contract(input.contract_version, 'observatory.machine.compare-assets.input.v1.0.0', issues);
  array(input.asset_ids, '/asset_ids', issues, { min: 2, max: 5, unique: true, item: (entry, at, target) => stableId(entry, at, target) });
  enumArray(input.dimensions, '/dimensions', issues, comparisonDimensions, 12, 1);
  stableId(input.expected_generation, '/expected_generation', issues, true);
}

function getCoverageStatus(input, issues) {
  const keys = ['contract_version', 'geography_ids', 'subject_ids', 'source_classes', 'time_period', 'authority_levels', 'limit', 'cursor', 'expected_generation'];
  if (!objectShape(input, keys, keys, '', issues)) return;
  contract(input.contract_version, 'observatory.machine.get-coverage-status.input.v1.0.0', issues);
  stableIdArray(input.geography_ids, '/geography_ids', issues);
  stableIdArray(input.subject_ids, '/subject_ids', issues);
  stableIdArray(input.source_classes, '/source_classes', issues);
  timePeriod(input.time_period, '/time_period', issues);
  enumArray(input.authority_levels, '/authority_levels', issues, authorityLevels);
  integer(input.limit, '/limit', issues, 1, 100);
  cursor(input.cursor, '/cursor', issues);
  stableId(input.expected_generation, '/expected_generation', issues, true);
}

function planConstraints(value, issues) {
  const path = '/constraints';
  const keys = ['geography_ids', 'time_period', 'grain', 'access_classes', 'machine_access_required', 'intended_analyses'];
  if (!objectShape(value, keys, keys, path, issues)) return;
  stableIdArray(value.geography_ids, `${path}/geography_ids`, issues);
  timePeriod(value.time_period, `${path}/time_period`, issues);
  enumeration(value.grain, `${path}/grain`, issues, grains.filter((grain) => !['mixed', 'unknown'].includes(grain)), true);
  enumArray(value.access_classes, `${path}/access_classes`, issues, accessClasses);
  bool(value.machine_access_required, `${path}/machine_access_required`, issues);
  array(value.intended_analyses, `${path}/intended_analyses`, issues, { max: 20, unique: true, item: (entry, at, target) => stringValue(entry, at, target, { max: 128 }) });
}

function planResearch(input, issues) {
  const initial = input?.mode === 'initial';
  const required = initial
    ? ['contract_version', 'mode', 'research_need', 'constraints', 'expected_generation']
    : ['contract_version', 'mode', 'prior_request_hash', 'prior_plan_id', 'clarification_token', 'clarification_answers', 'constraints', 'expected_generation'];
  if (!objectShape(input, required, required, '', issues)) return;
  contract(input.contract_version, 'observatory.machine.plan-research.input.v1.0.0', issues);
  enumeration(input.mode, '/mode', issues, ['initial', 'clarification']);
  planConstraints(input.constraints, issues);
  stableId(input.expected_generation, '/expected_generation', issues, initial);
  if (initial) stringValue(input.research_need, '/research_need', issues, { max: 4000 });
  else {
    stringValue(input.prior_request_hash, '/prior_request_hash', issues, { min: 71, max: 71, pattern: DIGEST });
    if (input.prior_plan_id !== null) stringValue(input.prior_plan_id, '/prior_plan_id', issues, { min: 71, max: 71, pattern: DIGEST });
    stringValue(input.clarification_token, '/clarification_token', issues, { min: 32, max: 2048, pattern: TOKEN });
    array(input.clarification_answers, '/clarification_answers', issues, {
      min: 1,
      max: 20,
      item(entry, at, target) {
        if (!objectShape(entry, ['question_id', 'answer'], ['question_id', 'answer'], at, target)) return;
        stableId(entry.question_id, `${at}/question_id`, target);
        stringValue(entry.answer, `${at}/answer`, target, { max: 2000 });
      }
    });
  }
}

const validators = Object.freeze({
  search_assets: searchAssets,
  get_asset: getAsset,
  get_access_plan: (input, issues) => accessLike(input, issues, 'get_access_plan'),
  get_retrieval_recipe: (input, issues) => accessLike(input, issues, 'get_retrieval_recipe'),
  get_variables: getVariables,
  get_join_routes: getJoinRoutes,
  compare_assets: compareAssets,
  get_coverage_status: getCoverageStatus,
  plan_research: planResearch
});

export function validateInput(capability, input) {
  const tool = TOOL_BY_CAPABILITY.get(capability);
  if (!tool || !validators[capability]) return [issue('/', 'unknown capability')];
  let bytes;
  try {
    bytes = serializedBytes(input);
  } catch {
    return [issue('/', 'must be finite acyclic JSON')];
  }
  if (bytes > tool.inputMaxBytes) return [issue('/', `decoded input exceeds ${tool.inputMaxBytes} bytes`)];
  const issues = [];
  validators[capability](input, issues);
  return issues;
}

export function validateLegacyInput(input) {
  let bytes;
  try { bytes = serializedBytes(input); } catch { return [issue('/', 'must be finite acyclic JSON')]; }
  if (bytes > 20480) return [issue('/', 'decoded input exceeds 20480 bytes')];
  const issues = [];
  const allowed = ['question', 'geography', 'subjects', 'units_of_analysis', 'access_statuses', 'include_restricted', 'time_window', 'limit'];
  if (!objectShape(input, ['question'], allowed, '', issues)) return issues;
  stringValue(input.question, '/question', issues, { min: 3, max: 500 });
  if (input.limit !== undefined) integer(input.limit, '/limit', issues, 1, 20);
  for (const name of ['subjects', 'units_of_analysis', 'access_statuses']) if (input[name] !== undefined) array(input[name], `/${name}`, issues, { max: 20, unique: true, item: (entry, at, target) => stringValue(entry, at, target, { max: 80 }) });
  if (input.include_restricted !== undefined) bool(input.include_restricted, '/include_restricted', issues);
  if (input.geography !== undefined) {
    if (objectShape(input.geography, [], ['codes', 'levels'], '/geography', issues)) {
      if (input.geography.codes !== undefined) array(input.geography.codes, '/geography/codes', issues, { max: 20, unique: true, item: (entry, at, target) => stringValue(entry, at, target, { min: 2, max: 20 }) });
      if (input.geography.levels !== undefined) enumArray(input.geography.levels, '/geography/levels', issues, ['national', 'multi_state', 'state', 'county', 'facility', 'mixed', 'unknown']);
    }
  }
  if (input.time_window !== undefined && objectShape(input.time_window, [], ['start_year', 'end_year'], '/time_window', issues)) {
    for (const key of ['start_year', 'end_year']) if (input.time_window[key] !== undefined) integer(input.time_window[key], `/time_window/${key}`, issues, 1800, 2200);
  }
  return issues;
}
