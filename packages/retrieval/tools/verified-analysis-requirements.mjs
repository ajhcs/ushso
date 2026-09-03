import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { PACKAGE_ROOT, sha256Bytes } from './package-common.mjs';

const CONTRACT_ROOT = path.join(PACKAGE_ROOT, 'analysis-use', 'v1.0.0');
const PIN_PATH = path.join('upstream', 'analysis-requirements.pin.json');
const PIN_SCHEMA_PATH = path.join('schemas', 'analysis-requirements-pin.schema.json');
const EXPECTED_CATALOG_PATH = 'upstream/analysis-requirements.v1.0.0.json';
const EXPECTED_CATALOG_SCHEMA_PATH = 'upstream/analysis-requirements.v1.0.0.schema.json';
const EXPECTED_PIN_SCHEMA_ID = 'https://contracts.ushso.org/retrieval/analysis-use/v1.0.0/analysis-requirements-pin.schema.json';
const EXPECTED_CATALOG_SCHEMA_ID = 'https://contracts.ushso.org/hc-metrics/analysis-requirements/v1.0.0/schema.json';
const EXPECTED_AUTHORITY = Object.freeze({
  discovery_guidance_only: true,
  data_access_authorized: false,
  calculation_authorized: false,
  persistence_authorized: false,
  publication_authorized: false,
});
const ANALYSIS_JOIN_ENTITIES = new Set([
  'facility', 'hospital', 'provider', 'county', 'state', 'health_system', 'date', 'event', 'other',
]);
const ANALYSIS_JOIN_CARDINALITIES = new Set(['one_to_one', 'one_to_many', 'many_to_one']);

const verifiedBundles = new WeakMap();

export function createAnalysisRequirementsAjv() {
  // The pinned upstream schema declares conditional `required` members whose
  // properties live in the referenced base object. Ajv cannot prove that
  // cross-$ref relationship for its strictRequired lint, although normal JSON
  // Schema validation still enforces the conditional requirements.
  return new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_JSON: ${label}: ${error.message}`);
  }
}

function assertSchemaValid(validate, value, label) {
  if (!validate(value)) {
    throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_${label}: ${JSON.stringify(validate.errors)}`);
  }
}

function assertFailClosedAuthority(authority, label) {
  if (!authority || Object.keys(EXPECTED_AUTHORITY).length !== Object.keys(authority).length) {
    throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_AUTHORITY: ${label}`);
  }
  for (const [key, expected] of Object.entries(EXPECTED_AUTHORITY)) {
    if (authority[key] !== expected) {
      throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_AUTHORITY: ${label}.${key} must be ${expected}`);
    }
  }
}

function assertExpectedPinContract(pin) {
  const expected = [
    [pin.schema_version, 'observatory-analysis-requirements-pin.v1.0.0', 'schema_version'],
    [pin.source.project_id, 'ajhcs/healthcare-toolkit', 'source.project_id'],
    [pin.source.origin_verified, false, 'source.origin_verified'],
    [pin.source.tracking_bead, 'healthcare-toolkit-672v', 'source.tracking_bead'],
    [pin.source.catalog_path, 'packages/hc-metrics/src/hc_metrics/data/analysis-requirements.v1.0.0.json', 'source.catalog_path'],
    [pin.source.schema_path, 'packages/hc-metrics/src/hc_metrics/schemas/analysis-requirements.v1.0.0.schema.json', 'source.schema_path'],
    [pin.catalog.path, EXPECTED_CATALOG_PATH, 'catalog.path'],
    [pin.catalog.schema_version, 'hc-metrics.analysis-requirements.v1.0.0', 'catalog.schema_version'],
    [pin.catalog.catalog_version, '1.0.0', 'catalog.catalog_version'],
    [pin.schema.path, EXPECTED_CATALOG_SCHEMA_PATH, 'schema.path'],
    [pin.schema.id, EXPECTED_CATALOG_SCHEMA_ID, 'schema.id'],
  ];
  for (const [actual, required, label] of expected) {
    if (actual !== required) {
      throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_PIN_CONTRACT: ${label}`);
    }
  }
  if (!/^[a-f0-9]{40}$/.test(pin.source.revision)) {
    throw new Error('INVALID_ANALYSIS_REQUIREMENTS_PIN_CONTRACT: source.revision');
  }
  for (const field of ['catalog_blob_oid', 'schema_blob_oid']) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pin.source[field])) {
      throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_PIN_CONTRACT: source.${field}`);
    }
  }
}

function assertUniqueIds(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`DUPLICATE_ANALYSIS_REQUIREMENTS_ID: ${label}:${value}`);
    seen.add(value);
  }
}

function canonicalAlternativeSignature(alternative) {
  const base = {
    entity: alternative.entity,
    key_input_set: [...alternative.key_input_set].sort(),
  };
  if (alternative.cardinality_orientation === 'symmetric') {
    return JSON.stringify({ ...base, orientation: 'symmetric', cardinality: 'one_to_one' });
  }
  const [leftMultiplicity, rightMultiplicity] = {
    one_to_one: ['one', 'one'],
    one_to_many: ['one', 'many'],
    many_to_one: ['many', 'one'],
  }[alternative.cardinality];
  const endpoints = [
    JSON.stringify({ input_ids: [...alternative.left_discriminator_input_ids].sort(), multiplicity: leftMultiplicity }),
    JSON.stringify({ input_ids: [...alternative.right_discriminator_input_ids].sort(), multiplicity: rightMultiplicity }),
  ].sort();
  return JSON.stringify({ ...base, orientation: 'directed', endpoints });
}

export function validateAnalysisRequirementsCatalogSemantics(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new TypeError('analysis requirements catalog must be an object');
  }
  if (catalog.schema_version !== 'hc-metrics.analysis-requirements.v1.0.0'
    || catalog.catalog_id !== 'hc-metrics:analysis-requirements'
    || catalog.catalog_version !== '1.0.0') {
    throw new Error('INVALID_ANALYSIS_REQUIREMENTS_CATALOG_IDENTITY');
  }
  assertFailClosedAuthority(catalog.authority, 'catalog');

  const analysisIds = catalog.requirements.map(requirement => requirement.analysis_id);
  assertUniqueIds(analysisIds, 'analysis_id');
  const knownAnalysisIds = new Set(analysisIds);
  const methodologyByKey = new Map();

  for (const requirement of catalog.requirements) {
    const prefix = requirement.analysis_id;
    const inputIds = requirement.required_inputs.map(input => input.input_id);
    const propertyIds = requirement.required_properties.map(property => property.property_id);
    const joinIds = requirement.join_requirements.map(join => join.join_id);
    assertUniqueIds(inputIds, `${prefix}.input_id`);
    assertUniqueIds(propertyIds, `${prefix}.property_id`);
    assertUniqueIds(joinIds, `${prefix}.join_id`);

    const knownInputIds = new Set(inputIds);
    const inputsById = new Map(requirement.required_inputs.map(input => [input.input_id, input]));
    for (const input of requirement.required_inputs) {
      if (input.allowed_values) {
        assertUniqueIds(input.allowed_values, `${prefix}.${input.input_id}.allowed_value`);
      }
      const conditionalKeys = [];
      for (const range of input.conditional_ranges ?? []) {
        const selector = inputsById.get(range.when_input_id);
        if (!selector) {
          throw new Error(`UNKNOWN_ANALYSIS_REQUIREMENTS_RANGE_SELECTOR: ${prefix}.${input.input_id}:${range.when_input_id}`);
        }
        if (!selector.allowed_values?.includes(range.equals)) {
          throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_RANGE_SELECTOR_VALUE: ${prefix}.${input.input_id}:${range.equals}`);
        }
        if (range.minimum > range.maximum) {
          throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_RANGE_BOUNDS: ${prefix}.${input.input_id}:${range.equals}`);
        }
        conditionalKeys.push(`${range.when_input_id}\u0000${range.equals}`);
      }
      assertUniqueIds(conditionalKeys, `${prefix}.${input.input_id}.conditional_range`);
    }

    for (const join of requirement.join_requirements) {
      for (const inputId of join.input_ids) {
        if (!knownInputIds.has(inputId)) {
          throw new Error(`UNKNOWN_ANALYSIS_REQUIREMENTS_JOIN_INPUT: ${prefix}.${join.join_id}:${inputId}`);
        }
      }
      if (!sameStringSet(join.input_ids, inputIds)) {
        throw new Error(`INCOMPLETE_ANALYSIS_REQUIREMENTS_JOIN_INPUTS: ${prefix}.${join.join_id}`);
      }
      const alternativeIds = join.alternatives.map(alternative => alternative.alternative_id);
      assertUniqueIds(alternativeIds, `${prefix}.${join.join_id}.alternative_id`);
      const alternativeSignatures = [];
      for (const alternative of join.alternatives) {
        if (!ANALYSIS_JOIN_ENTITIES.has(alternative.entity)) {
          throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_JOIN_ENTITY: ${prefix}.${join.join_id}:${alternative.alternative_id}`);
        }
        if (!ANALYSIS_JOIN_CARDINALITIES.has(alternative.cardinality)) {
          throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_JOIN_CARDINALITY: ${prefix}.${join.join_id}:${alternative.alternative_id}`);
        }
        const keyInputSet = alternative.key_input_set;
        assertUniqueIds(keyInputSet, `${prefix}.${join.join_id}.key_input`);
        if (!keyInputSet.length || keyInputSet.some(inputId => !knownInputIds.has(inputId))) {
          throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_JOIN_KEY_SET: ${prefix}.${join.join_id}`);
        }
        if (keyInputSet.some(inputId => ['measure', 'denominator', 'period'].includes(inputsById.get(inputId).role))) {
          throw new Error(`UNSAFE_ANALYSIS_REQUIREMENTS_JOIN_KEY_ROLE: ${prefix}.${join.join_id}`);
        }
        if (alternative.cardinality_orientation === 'left_to_right') {
          const leftInputIds = alternative.left_discriminator_input_ids;
          const rightInputIds = alternative.right_discriminator_input_ids;
          assertUniqueIds(leftInputIds, `${prefix}.${join.join_id}.left_required_input_id`);
          assertUniqueIds(rightInputIds, `${prefix}.${join.join_id}.right_required_input_id`);
          if (!leftInputIds.length || !rightInputIds.length
            || leftInputIds.some(inputId => !knownInputIds.has(inputId))
            || rightInputIds.some(inputId => !knownInputIds.has(inputId))) {
            throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_JOIN_ENDPOINT_INPUTS: ${prefix}.${join.join_id}:${alternative.alternative_id}`);
          }
          const keyIds = new Set(keyInputSet);
          const leftIds = new Set(leftInputIds);
          if (leftInputIds.some(inputId => keyIds.has(inputId))
            || rightInputIds.some(inputId => keyIds.has(inputId))
            || rightInputIds.some(inputId => leftIds.has(inputId))) {
            throw new Error(`OVERLAPPING_ANALYSIS_REQUIREMENTS_JOIN_ENDPOINT_INPUTS: ${prefix}.${join.join_id}:${alternative.alternative_id}`);
          }
          if (leftInputIds.concat(rightInputIds).some(inputId => inputsById.get(inputId).role === 'period')) {
            throw new Error(`UNSAFE_ANALYSIS_REQUIREMENTS_JOIN_ENDPOINT_ROLE: ${prefix}.${join.join_id}:${alternative.alternative_id}`);
          }
        } else if (alternative.cardinality_orientation === 'symmetric') {
          if (alternative.cardinality !== 'one_to_one'
            || alternative.left_discriminator_input_ids !== undefined
            || alternative.right_discriminator_input_ids !== undefined) {
            throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_SYMMETRIC_JOIN: ${prefix}.${join.join_id}:${alternative.alternative_id}`);
          }
        } else {
          throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_JOIN_ORIENTATION: ${prefix}.${join.join_id}:${alternative.alternative_id}`);
        }
        alternativeSignatures.push(canonicalAlternativeSignature(alternative));
      }
      if (!alternativeSignatures.length) {
        throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_JOIN_ALTERNATIVES: ${prefix}.${join.join_id}`);
      }
      assertUniqueIds(alternativeSignatures, `${prefix}.${join.join_id}.semantic_alternative`);
    }

    for (const upstreamId of requirement.upstream_analysis_ids) {
      if (!knownAnalysisIds.has(upstreamId)) {
        throw new Error(`UNKNOWN_ANALYSIS_REQUIREMENTS_UPSTREAM: ${prefix}:${upstreamId}`);
      }
      if (upstreamId === requirement.analysis_id) {
        throw new Error(`SELF_REFERENTIAL_ANALYSIS_REQUIREMENTS_UPSTREAM: ${prefix}`);
      }
    }

    const expectedMethodology = `hc-metrics:${requirement.methodology_key}:${requirement.methodology_version}`;
    if (requirement.methodology !== expectedMethodology) {
      throw new Error(`INCONSISTENT_ANALYSIS_REQUIREMENTS_METHODOLOGY: ${prefix}:${requirement.methodology}`);
    }
    const methodologyContract = JSON.stringify({
      implementation_methodology: requirement.implementation_methodology,
      methodology: requirement.methodology,
      methodology_version: requirement.methodology_version,
    });
    const existingMethodology = methodologyByKey.get(requirement.methodology_key);
    if (existingMethodology && existingMethodology !== methodologyContract) {
      throw new Error(`INCONSISTENT_ANALYSIS_REQUIREMENTS_METHODOLOGY_KEY: ${requirement.methodology_key}`);
    }
    methodologyByKey.set(requirement.methodology_key, methodologyContract);
  }
}

function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  const rightValues = new Set(right);
  return left.every(value => rightValues.has(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function assertVerified(verified) {
  if (!verified || typeof verified !== 'object' || !verifiedBundles.has(verified)) {
    throw new TypeError('verifiedRequirements must be returned by loadVerifiedAnalysisRequirements');
  }
  return verifiedBundles.get(verified);
}

function verifyPinnedBytes(bytes, pin, label) {
  if (bytes.length !== pin.bytes) {
    throw new Error(`ANALYSIS_REQUIREMENTS_BYTE_LENGTH_MISMATCH: ${label}: expected ${pin.bytes}, received ${bytes.length}`);
  }
  const digest = `sha256:${sha256Bytes(bytes)}`;
  if (digest !== pin.sha256) {
    throw new Error(`ANALYSIS_REQUIREMENTS_SHA256_MISMATCH: ${label}: expected ${pin.sha256}, received ${digest}`);
  }
}

function createVerifiedBundle({ pin, catalog }) {
  const requirementsById = Object.create(null);
  for (const requirement of catalog.requirements) {
    requirementsById[requirement.analysis_id] = requirement;
  }
  const metadata = {
    schema_version: catalog.schema_version,
    catalog_id: catalog.catalog_id,
    catalog_version: catalog.catalog_version,
    catalog_schema_id: pin.schema.id,
    source: pin.source,
    authority: catalog.authority,
    analysis_ids: catalog.requirements.map(requirement => requirement.analysis_id),
    analysis_count: catalog.requirements.length,
  };
  const internal = deepFreeze({
    digest: pin.catalog.sha256,
    metadata,
    requirementsById,
  });
  const verified = deepFreeze({
    schema_version: 'observatory-verified-analysis-requirements.v1.0.0',
  });
  verifiedBundles.set(verified, internal);
  return verified;
}

export async function loadVerifiedAnalysisRequirements({ contractRoot = CONTRACT_ROOT } = {}) {
  if (typeof contractRoot !== 'string' || !contractRoot.length) {
    throw new TypeError('contractRoot must be a non-empty path string');
  }
  const root = path.resolve(contractRoot);
  const [pinBytes, pinSchemaBytes] = await Promise.all([
    fs.readFile(path.join(root, PIN_PATH)),
    fs.readFile(path.join(root, PIN_SCHEMA_PATH)),
  ]);
  const pin = parseJson(pinBytes, PIN_PATH);
  const pinSchema = parseJson(pinSchemaBytes, PIN_SCHEMA_PATH);
  if (pinSchema.$id !== EXPECTED_PIN_SCHEMA_ID) {
    throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_PIN_SCHEMA_ID: ${pinSchema.$id}`);
  }
  const pinAjv = createAnalysisRequirementsAjv();
  assertSchemaValid(pinAjv.compile(pinSchema), pin, 'PIN');
  assertExpectedPinContract(pin);
  assertFailClosedAuthority(pin.authority, 'pin');

  const [catalogBytes, catalogSchemaBytes] = await Promise.all([
    fs.readFile(path.join(root, pin.catalog.path)),
    fs.readFile(path.join(root, pin.schema.path)),
  ]);
  verifyPinnedBytes(catalogBytes, pin.catalog, 'catalog');
  verifyPinnedBytes(catalogSchemaBytes, pin.schema, 'schema');

  const catalog = parseJson(catalogBytes, pin.catalog.path);
  const catalogSchema = parseJson(catalogSchemaBytes, pin.schema.path);
  if (catalogSchema.$id !== pin.schema.id || catalogSchema.$id !== EXPECTED_CATALOG_SCHEMA_ID) {
    throw new Error(`INVALID_ANALYSIS_REQUIREMENTS_CATALOG_SCHEMA_ID: ${catalogSchema.$id}`);
  }
  const catalogAjv = createAnalysisRequirementsAjv();
  assertSchemaValid(catalogAjv.compile(catalogSchema), catalog, 'CATALOG');
  if (catalog.schema_version !== pin.catalog.schema_version || catalog.catalog_version !== pin.catalog.catalog_version) {
    throw new Error('ANALYSIS_REQUIREMENTS_PIN_CATALOG_METADATA_MISMATCH');
  }
  assertFailClosedAuthority(catalog.authority, 'catalog');
  validateAnalysisRequirementsCatalogSemantics(catalog);
  return createVerifiedBundle({ pin, catalog });
}

export function getVerifiedAnalysisRequirement(verifiedRequirements, analysisId) {
  const bundle = assertVerified(verifiedRequirements);
  if (typeof analysisId !== 'string' || !/^[a-z][a-z0-9_]*$/.test(analysisId)) {
    throw new TypeError('analysisId must be a canonical analysis identifier');
  }
  if (!Object.hasOwn(bundle.requirementsById, analysisId)) {
    throw new RangeError(`unknown analysis_id: ${analysisId}`);
  }
  const requirement = bundle.requirementsById[analysisId];
  return structuredClone(requirement);
}

export function getVerifiedAnalysisRequirementsDigest(verifiedRequirements) {
  return assertVerified(verifiedRequirements).digest;
}

export function getVerifiedAnalysisRequirementsMetadata(verifiedRequirements) {
  return structuredClone(assertVerified(verifiedRequirements).metadata);
}
