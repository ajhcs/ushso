import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { PACKAGE_ROOT, sha256Bytes, stableJson } from './package-common.mjs';
import {
  getVerifiedAnalysisRequirement,
  getVerifiedAnalysisRequirementsDigest,
} from './verified-analysis-requirements.mjs';

const COUNTED_AVAILABILITY = new Set(['source_reported', 'derivable']);
const COMPILER_VERSION = 'observatory-analysis-use-compiler.v1.0.0';
const AVAILABILITY_RANK = { source_reported: 0, derivable: 1 };
const SUPPORT_RANK = { supported: 0, partial: 1, unsupported: 2 };
const SCHEMA_ROOT = path.join(PACKAGE_ROOT, 'analysis-use', 'v1.0.0', 'schemas');

function schemaValidator(filePath) {
  const schema = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

const validateProfileSchema = schemaValidator(path.join(SCHEMA_ROOT, 'analysis-input-profile.schema.json'));
const validateCompatibilitySchema = schemaValidator(path.join(SCHEMA_ROOT, 'analysis-compatibility.schema.json'));
const validateSemanticJoinSchema = schemaValidator(path.join(SCHEMA_ROOT, 'semantic-join.schema.json'));
const validateUseCardSchema = schemaValidator(path.join(SCHEMA_ROOT, 'analysis-use-card.schema.json'));
const validateJoinRouteSchema = schemaValidator(path.join(PACKAGE_ROOT, 'schemas', 'join-route.schema.json'));

function unique(values) {
  return [...new Set(values)].sort();
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortedSet(values) {
  return [...new Set(values)].sort();
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertSchema(validate, value, label) {
  if (!validate(value)) throw new TypeError(`${label} failed its strict schema: ${JSON.stringify(validate.errors)}`);
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`);
}

function canonicalPair(left, right) {
  return [left, right].sort().join('\u0000');
}

function requirementDigest(requirement) {
  return `sha256:${sha256Bytes(stableJson(requirement))}`;
}

function requiredDomainConstraints(required) {
  return {
    allowed_values: [...(required.allowed_values ?? [])],
    conditional_ranges: (required.conditional_ranges ?? []).map(range => ({ ...range })),
  };
}

function inputMappingQualifies(mapping, required) {
  return COUNTED_AVAILABILITY.has(mapping.availability)
    && (mapping.availability === 'derivable'
      ? mapping.derivation && typeof mapping.derivation === 'object'
      : mapping.derivation == null)
    && mapping.domain_compatibility === 'documented'
    && mapping.value_kind === required.value_kind
    && mapping.measurement_unit === required.measurement_unit
    && required.observation_grains.includes(mapping.observation_grain);
}

function validateInputs({
  requirement,
  requirementCatalogSha256,
  requirementSha256,
  datasetProfiles,
  semanticJoins,
  compatibilityAssertions,
  joinRoutes,
}) {
  if (!Array.isArray(datasetProfiles) || !datasetProfiles.length) throw new TypeError('datasetProfiles must be a non-empty array');
  if (datasetProfiles.length > 3) throw new TypeError('an analysis Use Card is limited to three dataset profiles');
  for (const [label, value] of [
    ['semanticJoins', semanticJoins],
    ['compatibilityAssertions', compatibilityAssertions],
    ['joinRoutes', joinRoutes],
  ]) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  }
  const inputIds = new Set(requirement.required_inputs.map(input => input.input_id));
  const inputRequirementsById = new Map(requirement.required_inputs
    .map(input => [input.input_id, input]));
  const propertyIds = new Set(requirement.required_properties.map(property => property.property_id));
  const joinIds = new Set(requirement.join_requirements.map(join => join.join_id));
  const joinsById = new Map(requirement.join_requirements.map(join => [join.join_id, join]));
  const profilesByRecordId = new Map();

  assertUnique(datasetProfiles.map(profile => profile.profile_id), 'dataset profile_id values');
  assertUnique(datasetProfiles.map(profile => profile.record_id), 'dataset record_id values');
  for (const profile of datasetProfiles) {
    assertSchema(validateProfileSchema, profile, `profile ${profile.profile_id ?? '<unknown>'}`);
    if (profile.analysis_id !== requirement.analysis_id) throw new TypeError(`profile analysis_id mismatch: ${profile.profile_id}`);
    if (profile.requirement_catalog_sha256 !== requirementCatalogSha256 || profile.requirement_sha256 !== requirementSha256) {
      throw new TypeError(`profile requirement digest mismatch: ${profile.profile_id}`);
    }
    assertUnique(profile.inputs.map(input => input.input_id), `profile input_id values: ${profile.profile_id}`);
    assertUnique(profile.properties.map(property => property.property_id), `profile property_id values: ${profile.profile_id}`);
    for (const input of profile.inputs) {
      if (!inputIds.has(input.input_id)) throw new TypeError(`profile maps unknown input_id: ${profile.profile_id}:${input.input_id}`);
    }
    for (const property of profile.properties) {
      if (!propertyIds.has(property.property_id)) throw new TypeError(`profile maps unknown property_id: ${profile.profile_id}:${property.property_id}`);
    }
    profilesByRecordId.set(profile.record_id, profile);
  }

  assertUnique(compatibilityAssertions.map(item => item.assertion_id), 'compatibility assertion_id values');
  const compatibilityKeys = [];
  for (const assertion of compatibilityAssertions) {
    assertSchema(validateCompatibilitySchema, assertion, `compatibility assertion ${assertion.assertion_id ?? '<unknown>'}`);
    if (assertion.analysis_id !== requirement.analysis_id || !propertyIds.has(assertion.property_id)) {
      throw new TypeError(`compatibility assertion is out of scope: ${assertion.assertion_id}`);
    }
    if (assertion.requirement_catalog_sha256 !== requirementCatalogSha256 || assertion.requirement_sha256 !== requirementSha256) {
      throw new TypeError(`compatibility assertion requirement digest mismatch: ${assertion.assertion_id}`);
    }
    compatibilityKeys.push(`${assertion.analysis_id}\u0000${assertion.property_id}\u0000${[...assertion.record_ids].sort().join('\u0000')}`);
  }
  assertUnique(compatibilityKeys, 'compatibility semantic keys');

  assertUnique(joinRoutes.map(route => route.route_id), 'join route_id values');
  const routesById = new Map();
  for (const route of joinRoutes) {
    assertSchema(validateJoinRouteSchema, route, `join route ${route.route_id ?? '<unknown>'}`);
    if (route.from_record_id === route.to_record_id) {
      throw new TypeError(`join route cannot join a record to itself: ${route.route_id}`);
    }
    routesById.set(route.route_id, route);
  }

  assertUnique(semanticJoins.map(item => item.semantic_join_id), 'semantic join_id values');
  const semanticKeys = [];
  for (const join of semanticJoins) {
    assertSchema(validateSemanticJoinSchema, join, `semantic join ${join.semantic_join_id ?? '<unknown>'}`);
    if (join.analysis_id !== requirement.analysis_id || !joinIds.has(join.join_requirement_id)) {
      throw new TypeError(`semantic join is out of scope: ${join.semantic_join_id}`);
    }
    if (join.requirement_catalog_sha256 !== requirementCatalogSha256 || join.requirement_sha256 !== requirementSha256) {
      throw new TypeError(`semantic join requirement digest mismatch: ${join.semantic_join_id}`);
    }
    const joinRequirement = joinsById.get(join.join_requirement_id);
    const alternative = joinRequirement.alternatives.find(item =>
      item.alternative_id === join.join_alternative_id);
    if (!alternative) {
      throw new TypeError(`semantic join alternative is not declared by the requirement: ${join.semantic_join_id}`);
    }
    const route = routesById.get(join.route_id);
    if (!route) throw new TypeError(`semantic join route is missing: ${join.semantic_join_id}:${join.route_id}`);
    if (route.from_record_id !== join.from_record_id || route.to_record_id !== join.to_record_id) {
      throw new TypeError(`semantic join endpoints disagree with route: ${join.semantic_join_id}`);
    }
    if (route.entity !== alternative.entity) {
      throw new TypeError(`semantic join route entity is not allowed by the requirement: ${join.semantic_join_id}`);
    }
    const fromKeyInputIds = [...join.from_key_input_ids].sort();
    const toKeyInputIds = [...join.to_key_input_ids].sort();
    const requiredKeyInputIds = [...alternative.key_input_set].sort();
    if (!sameSet(fromKeyInputIds, toKeyInputIds)
      || !sameSet(fromKeyInputIds, requiredKeyInputIds)) {
      throw new TypeError(`semantic join input bindings are not an allowed requirement key set: ${join.semantic_join_id}`);
    }
    const matchingKeyPairs = route.key_pairs.filter(pair => sameSet(
      [...join.from_field_refs].sort(),
      [...pair.from_fields].sort(),
    ) && sameSet(
      [...join.to_field_refs].sort(),
      [...pair.to_fields].sort(),
    ));
    if (matchingKeyPairs.length !== 1) {
      throw new TypeError(`semantic join fields must match exactly one route key pair: ${join.semantic_join_id}`);
    }
    for (const [recordId, keyInputIds, fieldRefs] of [
      [join.from_record_id, join.from_key_input_ids, join.from_field_refs],
      [join.to_record_id, join.to_key_input_ids, join.to_field_refs],
    ]) {
      const profile = profilesByRecordId.get(recordId);
      if (!profile) continue;
      const qualifiedFields = [];
      for (const inputId of keyInputIds) {
        const mapping = profile.inputs.find(input => input.input_id === inputId);
        const required = inputRequirementsById.get(inputId);
        if (!mapping || !required || !inputMappingQualifies(mapping, required)) {
          throw new TypeError(`semantic join key input is not a counted documented mapping: ${join.semantic_join_id}:${recordId}:${inputId}`);
        }
        qualifiedFields.push(...mapping.field_refs);
      }
      if (!sameSet(unique(qualifiedFields), [...fieldRefs].sort())) {
        throw new TypeError(`semantic join fields disagree with qualified input mappings: ${join.semantic_join_id}:${recordId}`);
      }
    }
    if (alternative.cardinality_orientation === 'left_to_right') {
      const leftRecordId = join.from_logical_endpoint === 'left'
        ? join.from_record_id : join.to_record_id;
      const rightRecordId = join.from_logical_endpoint === 'right'
        ? join.from_record_id : join.to_record_id;
      const leftProfile = profilesByRecordId.get(leftRecordId);
      const rightProfile = profilesByRecordId.get(rightRecordId);
      if (leftProfile && rightProfile) {
        const profileSupplies = (profile, inputIds) => inputIds.every(inputId => {
          const mapping = profile.inputs.find(input => input.input_id === inputId);
          return mapping && inputMappingQualifies(mapping, inputRequirementsById.get(inputId));
        });
        const direct = profileSupplies(leftProfile, alternative.left_discriminator_input_ids)
          && profileSupplies(rightProfile, alternative.right_discriminator_input_ids);
        const reverse = profileSupplies(leftProfile, alternative.right_discriminator_input_ids)
          && profileSupplies(rightProfile, alternative.left_discriminator_input_ids);
        if (!direct || reverse) {
          throw new TypeError(`semantic join endpoint discriminator binding is invalid or ambiguous: ${join.semantic_join_id}`);
        }
      }
    }
    semanticKeys.push(`${join.analysis_id}\u0000${join.requirement_sha256}\u0000${join.join_requirement_id}\u0000${join.join_alternative_id}\u0000${canonicalPair(join.from_record_id, join.to_record_id)}`);
  }
  assertUnique(semanticKeys, 'semantic join relationship keys');
  return routesById;
}

function selectInputBindings(requirement, datasetProfiles) {
  const selected = [];
  const missing = [];
  const unverified = [];
  for (const required of requirement.required_inputs) {
    const all = datasetProfiles.flatMap(profile => profile.inputs
      .filter(input => input.input_id === required.input_id)
      .map(input => ({ ...input, record_id: profile.record_id, profile_id: profile.profile_id })));
    const candidates = all
      .filter(input => inputMappingQualifies(input, required))
      .sort((left, right) => (AVAILABILITY_RANK[left.availability] - AVAILABILITY_RANK[right.availability])
        || compareText(left.record_id, right.record_id)
        || compareText(stableJson(left.field_refs), stableJson(right.field_refs)));
    if (!candidates.length) {
      missing.push(required.input_id);
      if (all.length) unverified.push(required.input_id);
      continue;
    }
    const binding = candidates[0];
    selected.push({
      input_id: required.input_id,
      record_id: binding.record_id,
      profile_id: binding.profile_id,
      availability: binding.availability,
      field_refs: [...binding.field_refs].sort(),
      observation_grain: binding.observation_grain,
      value_kind: binding.value_kind,
      measurement_unit: binding.measurement_unit,
      domain_compatibility: binding.domain_compatibility,
      domain_constraints: requiredDomainConstraints(required),
      derivation: binding.derivation ?? null,
      evidence_ids: unique(binding.evidence_ids),
      limitations: unique(binding.limitations),
    });
  }
  return { selected, missing, unverified };
}

function propertyCoverage(requirement, datasetProfiles, compatibilityAssertions) {
  const selectedIds = datasetProfiles.map(profile => profile.record_id).sort();
  return requirement.required_properties.map(property => {
    const candidates = selectedIds.length === 1
      ? datasetProfiles[0].properties.filter(item => item.property_id === property.property_id)
      : compatibilityAssertions.filter(item => item.analysis_id === requirement.analysis_id
        && item.property_id === property.property_id
        && sameSet([...item.record_ids].sort(), selectedIds));
    const item = candidates[0];
    return {
      property_id: property.property_id,
      state: item?.state ?? 'missing',
      evidence_ids: unique(item?.evidence_ids ?? []),
      limitations: unique(item?.limitations ?? [property.description]),
    };
  });
}

function graphConnected(nodes, edges) {
  if (nodes.length <= 1) return true;
  const graph = new Map(nodes.map(node => [node, new Set()]));
  for (const edge of edges) {
    if (!graph.has(edge.from_record_id) || !graph.has(edge.to_record_id)) continue;
    graph.get(edge.from_record_id).add(edge.to_record_id);
    graph.get(edge.to_record_id).add(edge.from_record_id);
  }
  const visited = new Set([nodes[0]]);
  const pending = [nodes[0]];
  while (pending.length) {
    for (const next of graph.get(pending.pop()) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      pending.push(next);
    }
  }
  return visited.size === nodes.length;
}

function routeHasDocumentedEvidence(route) {
  if (route.compatibility_state !== 'documented'
    || route.blocked_reason != null
    || ['many_to_many', 'unknown'].includes(route.cardinality)
    || !['exact_key', 'normalized_key', 'derived_geography'].includes(route.match_strategy)) {
    return false;
  }
  const endpoints = new Set([route.from_record_id, route.to_record_id]);
  return [...endpoints].every(recordId => route.evidence_refs.some(reference =>
    reference.record_id === recordId
      && ['verified_first_party', 'source_asserted'].includes(reference.state)
      && reference.evidence_ids.length > 0
      && reference.provenance_ids.length > 0));
}

function invertCardinality(cardinality) {
  if (cardinality === 'one_to_many') return 'many_to_one';
  if (cardinality === 'many_to_one') return 'one_to_many';
  return cardinality;
}

function semanticJoinMatchesAlternative(item, alternative, bindingByInput) {
  if (item.route.entity !== alternative.entity) return false;
  const directionAllowsCanonicalTraversal = item.from_logical_endpoint === 'left'
    ? ['bidirectional', 'from_to'].includes(item.route.direction)
    : ['bidirectional', 'to_from'].includes(item.route.direction);
  if (!directionAllowsCanonicalTraversal) return false;
  if (alternative.cardinality_orientation === 'symmetric') {
    return item.route.cardinality === 'one_to_one';
  }
  const leftRecordId = item.from_logical_endpoint === 'left'
    ? item.from_record_id : item.to_record_id;
  const rightRecordId = item.from_logical_endpoint === 'right'
    ? item.from_record_id : item.to_record_id;
  const selectedFromRecord = (inputIds, recordId) => inputIds.every(inputId =>
    bindingByInput.get(inputId)?.record_id === recordId);
  if (!selectedFromRecord(alternative.left_discriminator_input_ids, leftRecordId)
    || !selectedFromRecord(alternative.right_discriminator_input_ids, rightRecordId)) {
    return false;
  }
  const canonicalCardinality = item.from_logical_endpoint === 'left'
    ? item.route.cardinality : invertCardinality(item.route.cardinality);
  return canonicalCardinality === alternative.cardinality;
}

function joinCoverage(requirement, selectedBindings, missingInputs, semanticJoins, routesById) {
  const bindingByInput = new Map(selectedBindings.map(binding => [binding.input_id, binding]));
  return requirement.join_requirements.map(join => {
    if (join.input_ids.some(inputId => missingInputs.includes(inputId))) {
      return {
        join_id: join.join_id,
        state: 'missing',
        supporting_edges: [],
        route_ids: [],
        evidence_ids: [],
        limitations: [join.description],
      };
    }
    const relevantIds = unique(join.input_ids.map(inputId => bindingByInput.get(inputId)?.record_id).filter(Boolean));
    if (relevantIds.length <= 1) {
      return {
        join_id: join.join_id,
        state: 'not_required',
        supporting_edges: [],
        route_ids: [],
        evidence_ids: [],
        limitations: [],
      };
    }
    const candidates = semanticJoins.filter(item => item.join_requirement_id === join.join_id
      && relevantIds.includes(item.from_record_id)
      && relevantIds.includes(item.to_record_id))
      .map(item => ({
        ...item,
        route: routesById.get(item.route_id),
        alternative: join.alternatives.find(alternative =>
          alternative.alternative_id === item.join_alternative_id),
      }));
    const periodApproved = item => join.period_alignment === 'required'
      ? item.period_alignment === 'documented'
      : ['documented', 'not_applicable'].includes(item.period_alignment);
    const routeApproved = item => routeHasDocumentedEvidence(item.route)
      && semanticJoinMatchesAlternative(item, item.alternative, bindingByInput);
    const documented = candidates.filter(item => routeApproved(item) && periodApproved(item));
    const routeStates = candidates.map(item => item.route.compatibility_state === 'documented'
      && !routeApproved(item) ? 'candidate' : item.route.compatibility_state);
    let state = 'missing';
    if (graphConnected(relevantIds, documented)) state = 'documented';
    else if (routeStates.includes('incompatible')) state = 'incompatible';
    else if (routeStates.includes('ambiguous')) state = 'ambiguous';
    else if (routeStates.includes('candidate') || candidates.some(item => !periodApproved(item))) state = 'candidate';
    else if (routeStates.includes('unknown')) state = 'unknown';
    const reportedCandidates = state === 'documented' ? documented : candidates;
    const supportingEdgesByKey = new Map((state === 'documented' ? documented : []).map(item => [
      `${item.route_id}\u0000${item.join_alternative_id}`,
      {
        route_id: item.route_id,
        alternative_id: item.join_alternative_id,
        from_record_id: item.from_record_id,
        to_record_id: item.to_record_id,
      },
    ]));
    return {
      join_id: join.join_id,
      state,
      supporting_edges: [...supportingEdgesByKey.values()]
        .sort((left, right) => compareText(stableJson(left), stableJson(right))),
      route_ids: unique(reportedCandidates.map(item => item.route_id)),
      evidence_ids: unique(reportedCandidates.flatMap(item => item.evidence_ids
        .concat(item.route.evidence_refs.flatMap(ref => ref.evidence_ids)))),
      limitations: unique(reportedCandidates.flatMap(item => item.limitations
        .concat(item.route.preconditions, item.route.caveats))
        .concat(state === 'documented' ? [] : [join.description])),
    };
  });
}

function researchSetRows(datasetProfiles, selectedBindings) {
  return datasetProfiles.map(profile => ({
    record_id: profile.record_id,
    profile_id: profile.profile_id,
    supplied_input_ids: unique(selectedBindings.filter(binding => binding.record_id === profile.record_id).map(binding => binding.input_id)),
    limitations: unique(profile.limitations),
  })).sort((left, right) => compareText(left.record_id, right.record_id));
}

function evidenceDigest({ datasetProfiles, semanticJoins, compatibilityAssertions, joinRoutes }) {
  return `sha256:${sha256Bytes(stableJson(canonicalEvidenceValue({
    compatibility_assertions: compatibilityAssertions,
    dataset_profiles: datasetProfiles,
    join_routes: joinRoutes,
    semantic_joins: semanticJoins,
  })))}`;
}

function canonicalEvidenceValue(value, parentKey = null) {
  if (Array.isArray(value)) {
    const nested = value.map(item => canonicalEvidenceValue(item));
    return parentKey === 'normalization_steps'
      ? nested
      : nested.sort((left, right) => compareText(stableJson(left), stableJson(right)));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .map(([key, nested]) => [key, canonicalEvidenceValue(nested, key)]));
}

function relevantEvidence(datasetProfiles, semanticJoins, compatibilityAssertions, joinRoutes) {
  const recordIds = datasetProfiles.map(profile => profile.record_id).sort();
  const selected = new Set(recordIds);
  const relevantCompatibility = compatibilityAssertions.filter(assertion =>
    sameSet([...assertion.record_ids].sort(), recordIds));
  const relevantJoins = semanticJoins.filter(join =>
    selected.has(join.from_record_id) && selected.has(join.to_record_id));
  const relevantRouteIds = new Set(relevantJoins.map(join => join.route_id));
  return {
    datasetProfiles,
    semanticJoins: relevantJoins,
    compatibilityAssertions: relevantCompatibility,
    joinRoutes: joinRoutes.filter(route => relevantRouteIds.has(route.route_id)),
  };
}

export function validateAnalysisUseCard({ verifiedRequirements, card } = {}) {
  assertSchema(validateUseCardSchema, card, `analysis Use Card ${card?.use_card_id ?? '<unknown>'}`);
  const requirement = getVerifiedAnalysisRequirement(verifiedRequirements, card.analysis_id);
  const catalogDigest = getVerifiedAnalysisRequirementsDigest(verifiedRequirements);
  const expectedRequirementDigest = requirementDigest(requirement);
  const exactRequirementFields = {
    analysis_family: requirement.analysis_family,
    label: requirement.label,
    methodology: requirement.methodology,
    implementation_methodology: requirement.implementation_methodology,
    question_patterns: requirement.question_patterns,
    acceptable_grains: requirement.acceptable_grains,
    upstream_analysis_ids: requirement.upstream_analysis_ids,
  };
  for (const [field, expected] of Object.entries(exactRequirementFields)) {
    if (stableJson(card[field]) !== stableJson(expected)) {
      throw new TypeError(`analysis Use Card ${field} disagrees with its verified requirement`);
    }
  }
  if (card.requirement_catalog_sha256 !== catalogDigest
    || card.requirement_sha256 !== expectedRequirementDigest) {
    throw new TypeError('analysis Use Card requirement digest disagrees with its verified requirement');
  }

  const coverage = card.input_coverage;
  const covered = sortedSet(coverage.covered_input_ids);
  const missing = sortedSet(coverage.missing_input_ids);
  const requiredInputIds = requirement.required_inputs.map(input => input.input_id);
  const requiredInputsById = new Map(requirement.required_inputs.map(input => [input.input_id, input]));
  if (coverage.required_count !== requiredInputIds.length
    || !sameSet(sortedSet(covered.concat(missing)), [...requiredInputIds].sort())) {
    throw new TypeError('analysis Use Card inputs do not match its verified requirement');
  }
  const unverified = new Set(coverage.unverified_input_ids);
  const bindings = sortedSet(coverage.bindings.map(binding => binding.input_id));
  assertUnique(coverage.bindings.map(binding => binding.input_id), 'Use Card binding input_id values');
  assertUnique(card.property_coverage.map(item => item.property_id), 'Use Card property_id values');
  assertUnique(card.join_coverage.map(item => item.join_id), 'Use Card join_id values');
  if (coverage.covered_count !== covered.length || coverage.covered_count !== coverage.bindings.length) {
    throw new TypeError('analysis Use Card covered_count disagrees with its bindings');
  }
  if (!sameSet(covered, bindings)) throw new TypeError('analysis Use Card covered inputs disagree with its bindings');
  if (covered.some(inputId => missing.includes(inputId))
    || coverage.required_count !== covered.length + missing.length) {
    throw new TypeError('analysis Use Card covered and missing inputs do not partition the requirement');
  }
  if ([...unverified].some(inputId => !missing.includes(inputId))) {
    throw new TypeError('analysis Use Card unverified inputs must be missing inputs');
  }
  for (const binding of coverage.bindings) {
    const required = requiredInputsById.get(binding.input_id);
    if (!required || !inputMappingQualifies(binding, required)) {
      throw new TypeError(`analysis Use Card binding disagrees with its verified input requirement: ${binding.input_id}`);
    }
    if (stableJson(binding.domain_constraints) !== stableJson(requiredDomainConstraints(required))) {
      throw new TypeError(`analysis Use Card domain constraints disagree with its verified input requirement: ${binding.input_id}`);
    }
  }
  const requiredPropertyIds = requirement.required_properties.map(item => item.property_id).sort();
  if (!sameSet(sortedSet(card.property_coverage.map(item => item.property_id)), requiredPropertyIds)) {
    throw new TypeError('analysis Use Card properties do not match its verified requirement');
  }
  const requiredJoinsById = new Map(requirement.join_requirements.map(item => [item.join_id, item]));
  if (!sameSet(
    sortedSet(card.join_coverage.map(item => item.join_id)),
    [...requiredJoinsById.keys()].sort(),
  )) {
    throw new TypeError('analysis Use Card joins do not match its verified requirement');
  }
  for (const join of card.join_coverage) {
    const requiredJoin = requiredJoinsById.get(join.join_id);
    const alternativesById = new Map(requiredJoin.alternatives
      .map(alternative => [alternative.alternative_id, alternative]));
    const alternativeIds = new Set(alternativesById.keys());
    if (join.supporting_edges.some(edge => !alternativeIds.has(edge.alternative_id))) {
      throw new TypeError(`analysis Use Card names an unknown satisfied join alternative: ${join.join_id}`);
    }
    if (join.state !== 'documented' && join.supporting_edges.length > 0) {
      throw new TypeError(`analysis Use Card has supporting edges for an unresolved join: ${join.join_id}`);
    }
    if (join.state === 'documented') {
      const endpointPairByRouteId = new Map();
      for (const edge of join.supporting_edges) {
        const endpointPair = `${edge.from_record_id}\u0000${edge.to_record_id}`;
        const previousPair = endpointPairByRouteId.get(edge.route_id);
        if (previousPair !== undefined && previousPair !== endpointPair) {
          throw new TypeError(
            `analysis Use Card reuses a route with inconsistent endpoints: ${join.join_id}:${edge.route_id}`,
          );
        }
        endpointPairByRouteId.set(edge.route_id, endpointPair);
      }
      assertUnique(join.supporting_edges.map(edge =>
        `${edge.route_id}\u0000${edge.alternative_id}`),
      `analysis Use Card route and alternative pairs: ${join.join_id}`);
      const edgeRouteIds = sortedSet(join.supporting_edges.map(edge => edge.route_id));
      if (!sameSet(edgeRouteIds, sortedSet(join.route_ids))) {
        throw new TypeError(`analysis Use Card supporting edges disagree with documented routes: ${join.join_id}`);
      }
    }
    const joinHasMissingInput = requiredJoin.input_ids.some(inputId => missing.includes(inputId));
    const relevantRecordIds = new Set(requiredJoin.input_ids
      .map(inputId => coverage.bindings.find(binding => binding.input_id === inputId)?.record_id)
      .filter(Boolean));
    if (join.supporting_edges.some(edge => edge.from_record_id === edge.to_record_id
      || !relevantRecordIds.has(edge.from_record_id)
      || !relevantRecordIds.has(edge.to_record_id))) {
      throw new TypeError(`analysis Use Card supporting edge endpoints are out of scope: ${join.join_id}`);
    }
    for (const edge of join.supporting_edges) {
      const alternative = alternativesById.get(edge.alternative_id);
      if (alternative.cardinality_orientation !== 'left_to_right') continue;
      const supplierFor = inputId => coverage.bindings
        .find(binding => binding.input_id === inputId)?.record_id;
      const leftSuppliers = alternative.left_discriminator_input_ids.map(supplierFor);
      const rightSuppliers = alternative.right_discriminator_input_ids.map(supplierFor);
      const direct = leftSuppliers.every(recordId => recordId === edge.from_record_id)
        && rightSuppliers.every(recordId => recordId === edge.to_record_id);
      const reverse = leftSuppliers.every(recordId => recordId === edge.to_record_id)
        && rightSuppliers.every(recordId => recordId === edge.from_record_id);
      if (direct === reverse) {
        throw new TypeError(
          `analysis Use Card supporting edge discriminator suppliers are invalid or ambiguous: ${join.join_id}:${edge.route_id}`,
        );
      }
    }
    if (joinHasMissingInput) {
      if (join.state !== 'missing'
        || join.supporting_edges.length > 0
        || join.route_ids.length > 0
        || join.evidence_ids.length > 0
        || !join.limitations.includes(requiredJoin.description)) {
        throw new TypeError(`analysis Use Card join state disagrees with missing inputs: ${join.join_id}`);
      }
    } else if (relevantRecordIds.size <= 1) {
      if (join.state !== 'not_required'
        || join.supporting_edges.length > 0
        || join.route_ids.length > 0
        || join.evidence_ids.length > 0
        || join.limitations.length > 0) {
        throw new TypeError(`analysis Use Card join state disagrees with co-located inputs: ${join.join_id}`);
      }
    } else if (join.state === 'not_required') {
      throw new TypeError(`analysis Use Card join state ignores a cross-record requirement: ${join.join_id}`);
    } else if (join.state === 'documented'
      && !graphConnected([...relevantRecordIds], join.supporting_edges)) {
      throw new TypeError(`analysis Use Card supporting edges do not connect required records: ${join.join_id}`);
    }
  }
  const expectedPeriodInputIds = requirement.required_inputs
    .filter(input => input.role === 'period').map(input => input.input_id);
  const expectedSamePeriodRequired = requirement.required_properties
    .some(property => property.property_id === 'same_period')
    || requirement.join_requirements.some(join => join.period_alignment === 'required');
  if (stableJson(card.temporal_requirements.period_input_ids) !== stableJson(expectedPeriodInputIds)
    || card.temporal_requirements.same_period_required !== expectedSamePeriodRequired) {
    throw new TypeError('analysis Use Card temporal requirements disagree with its verified requirement');
  }
  if (requirement.limitations.some(limitation => !card.limitations.includes(limitation))) {
    throw new TypeError('analysis Use Card omits a verified requirement limitation');
  }
  assertUnique(card.research_set.map(item => item.record_id), 'Use Card research-set record_id values');
  assertUnique(card.research_set.map(item => item.profile_id), 'Use Card research-set profile_id values');
  const supplied = sortedSet(card.research_set.flatMap(item => item.supplied_input_ids));
  if (!sameSet(covered, supplied)) throw new TypeError('analysis Use Card research set disagrees with covered inputs');
  if (card.research_set.reduce((count, item) => count + item.supplied_input_ids.length, 0) !== covered.length) {
    throw new TypeError('analysis Use Card inputs must be supplied by exactly one research-set row');
  }
  for (const binding of coverage.bindings) {
    const row = card.research_set.find(item => item.record_id === binding.record_id
      && item.profile_id === binding.profile_id);
    if (!row?.supplied_input_ids.includes(binding.input_id)) {
      throw new TypeError('analysis Use Card binding is absent from its research-set row');
    }
  }
  const wouldBeSupported = missing.length === 0
    && card.property_coverage.every(item => item.state === 'documented')
    && card.join_coverage.every(item => ['documented', 'not_required'].includes(item.state))
    && card.research_set.every(item => item.supplied_input_ids.length > 0);
  if ((card.support_status === 'supported') !== wouldBeSupported) {
    throw new TypeError('analysis Use Card support_status disagrees with its evidence coverage');
  }
  if (card.support_status === 'partial' && covered.length === 0) {
    throw new TypeError('a partial analysis Use Card must cover at least one input');
  }
  if (card.support_status === 'unsupported' && covered.length !== 0) {
    throw new TypeError('an unsupported analysis Use Card cannot contain covered inputs');
  }
  if (card.support_status === 'supported') {
    if (coverage.bindings.some(binding => binding.evidence_ids.length === 0)
      || card.property_coverage.some(item => item.evidence_ids.length === 0)
      || card.join_coverage.some(item => item.state === 'documented'
        && (item.route_ids.length === 0 || item.evidence_ids.length === 0))) {
      throw new TypeError('a supported analysis Use Card requires evidence for every supporting claim');
    }
  }
  const { use_card_id: ignoredUseCardId, ...cardBody } = card;
  const expectedId = `obs:analysis-use-card:${card.analysis_id}:${sha256Bytes(stableJson(cardBody)).slice(0, 16)}`;
  if (card.use_card_id !== expectedId) {
    throw new TypeError('analysis Use Card identity disagrees with its canonical card body');
  }
  return true;
}

export function compileAnalysisUseCard({
  verifiedRequirements,
  analysisId,
  datasetProfiles,
  semanticJoins = [],
  compatibilityAssertions = [],
  joinRoutes = [],
}) {
  const requirement = getVerifiedAnalysisRequirement(verifiedRequirements, analysisId);
  const requirementCatalogSha256 = getVerifiedAnalysisRequirementsDigest(verifiedRequirements);
  const requirementSha256 = requirementDigest(requirement);
  const routesById = validateInputs({
    requirement,
    requirementCatalogSha256,
    requirementSha256,
    datasetProfiles,
    semanticJoins,
    compatibilityAssertions,
    joinRoutes,
  });
  const { selected, missing, unverified } = selectInputBindings(requirement, datasetProfiles);
  const properties = propertyCoverage(requirement, datasetProfiles, compatibilityAssertions);
  const joins = joinCoverage(requirement, selected, missing, semanticJoins, routesById);
  const researchSet = researchSetRows(datasetProfiles, selected);
  const inputsComplete = missing.length === 0;
  const propertiesComplete = properties.every(item => item.state === 'documented');
  const joinsComplete = joins.every(item => ['documented', 'not_required'].includes(item.state));
  const sourcesContribute = researchSet.every(item => item.supplied_input_ids.length > 0);
  const supportStatus = inputsComplete && propertiesComplete && joinsComplete && sourcesContribute
    ? 'supported'
    : selected.length > 0 ? 'partial' : 'unsupported';
  const evidenceSha256 = evidenceDigest(relevantEvidence(
    datasetProfiles,
    semanticJoins,
    compatibilityAssertions,
    joinRoutes,
  ));
  const limitations = unique([
    ...requirement.limitations,
    ...researchSet.flatMap(item => item.limitations),
    ...selected.flatMap(item => item.limitations),
    ...properties.flatMap(item => item.limitations),
    ...joins.flatMap(item => item.limitations),
  ]);
  const cardBody = {
    schema_version: 'observatory-analysis-use-card.v1.0.0',
    compiler_version: COMPILER_VERSION,
    analysis_id: requirement.analysis_id,
    analysis_family: requirement.analysis_family,
    label: requirement.label,
    methodology: requirement.methodology,
    implementation_methodology: requirement.implementation_methodology,
    question_patterns: [...requirement.question_patterns],
    acceptable_grains: [...requirement.acceptable_grains],
    upstream_analysis_ids: [...requirement.upstream_analysis_ids],
    requirement_catalog_sha256: requirementCatalogSha256,
    requirement_sha256: requirementSha256,
    evidence_sha256: evidenceSha256,
    support_status: supportStatus,
    research_set: researchSet,
    input_coverage: {
      required_count: requirement.required_inputs.length,
      covered_count: selected.length,
      covered_input_ids: selected.map(binding => binding.input_id),
      missing_input_ids: missing,
      unverified_input_ids: unverified,
      bindings: selected,
    },
    property_coverage: properties,
    join_coverage: joins,
    temporal_requirements: {
      period_input_ids: requirement.required_inputs.filter(input => input.role === 'period').map(input => input.input_id),
      same_period_required: requirement.required_properties.some(property => property.property_id === 'same_period')
        || requirement.join_requirements.some(join => join.period_alignment === 'required'),
    },
    limitations,
    truth_boundary: {
      assertion_type: 'requirement_derived_analytical_fit_not_source_truth',
      source_truth_separate: true,
      field_inference_allowed: false,
      data_access_authorized: false,
      calculation_authorized: false,
      persistence_authorized: false,
      publication_authorized: false,
    },
  };
  const card = {
    schema_version: cardBody.schema_version,
    use_card_id: `obs:analysis-use-card:${requirement.analysis_id}:${sha256Bytes(stableJson(cardBody)).slice(0, 16)}`,
    ...Object.fromEntries(Object.entries(cardBody).filter(([key]) => key !== 'schema_version')),
  };
  validateAnalysisUseCard({ verifiedRequirements, card });
  return card;
}

function combinations(values, size, start = 0, selected = [], result = []) {
  if (selected.length === size) {
    result.push([...selected]);
    return result;
  }
  for (let index = start; index <= values.length - (size - selected.length); index += 1) {
    selected.push(values[index]);
    combinations(values, size, index + 1, selected, result);
    selected.pop();
  }
  return result;
}

export function compileAnalysisUseCards({ maxSources = 3, datasetProfiles, ...shared }) {
  if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > 3) throw new TypeError('maxSources must be an integer from 1 through 3');
  if (datasetProfiles.length > 20) throw new TypeError('datasetProfiles exceeds the bounded compiler limit of 20');
  const ordered = [...datasetProfiles].sort((left, right) => compareText(left.record_id, right.record_id));
  const byId = new Map();
  for (let size = 1; size <= Math.min(maxSources, ordered.length); size += 1) {
    for (const subset of combinations(ordered, size)) {
      const card = compileAnalysisUseCard({ ...shared, datasetProfiles: subset });
      byId.set(card.use_card_id, card);
    }
  }
  return [...byId.values()].sort((left, right) => SUPPORT_RANK[left.support_status] - SUPPORT_RANK[right.support_status]
    || right.input_coverage.covered_count - left.input_coverage.covered_count
    || left.research_set.length - right.research_set.length
    || compareText(left.use_card_id, right.use_card_id));
}

function subsetOf(left, right) {
  const rightIds = new Set(right.research_set.map(item => item.record_id));
  return left.research_set.every(item => rightIds.has(item.record_id));
}

const PROPERTY_READINESS = {
  not_satisfied: 0,
  missing: 1,
  unknown: 2,
  candidate: 3,
  documented: 4,
};
const JOIN_READINESS = {
  incompatible: 0,
  missing: 1,
  ambiguous: 2,
  unknown: 3,
  candidate: 4,
  documented: 5,
  not_required: 5,
};

function evidenceStatesNoWorse(candidateItems, cardItems, idKey, ranks) {
  const candidateById = new Map(candidateItems.map(item => [item[idKey], item.state]));
  return cardItems.every(item => ranks[candidateById.get(item[idKey])] >= ranks[item.state]);
}

function readinessDominates(candidate, card) {
  const candidateCovered = new Set(candidate.input_coverage.covered_input_ids);
  const coversEveryInput = card.input_coverage.covered_input_ids.every(inputId =>
    candidateCovered.has(inputId));
  const candidateBindings = new Map(candidate.input_coverage.bindings
    .map(binding => [binding.input_id, binding]));
  const availabilityNoWorse = card.input_coverage.bindings.every(binding => {
    const candidateBinding = candidateBindings.get(binding.input_id);
    return candidateBinding
      && AVAILABILITY_RANK[candidateBinding.availability] <= AVAILABILITY_RANK[binding.availability];
  });
  const candidateSourcesContribute = candidate.research_set.every(item => item.supplied_input_ids.length > 0);
  const cardSourcesContribute = card.research_set.every(item => item.supplied_input_ids.length > 0);
  return candidate.research_set.length < card.research_set.length
    && subsetOf(candidate, card)
    && coversEveryInput
    && availabilityNoWorse
    && evidenceStatesNoWorse(candidate.property_coverage, card.property_coverage, 'property_id', PROPERTY_READINESS)
    && evidenceStatesNoWorse(candidate.join_coverage, card.join_coverage, 'join_id', JOIN_READINESS)
    && Number(candidateSourcesContribute) >= Number(cardSourcesContribute);
}

export function recommendResearchSets(options) {
  const cards = compileAnalysisUseCards(options);
  const supported = cards.filter(card => card.support_status === 'supported');
  const pool = supported.length ? supported : cards.filter(card => card.support_status === 'partial');
  return pool.filter((card, index) => !pool.some((candidate, candidateIndex) =>
    candidateIndex !== index && readinessDominates(candidate, card)));
}
