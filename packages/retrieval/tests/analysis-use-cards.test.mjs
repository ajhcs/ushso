import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  compileAnalysisUseCard,
  compileAnalysisUseCards,
  recommendResearchSets,
  validateAnalysisUseCard,
} from '../tools/analysis-use-cards.mjs';
import {
  getVerifiedAnalysisRequirement,
  getVerifiedAnalysisRequirementsDigest,
  getVerifiedAnalysisRequirementsMetadata,
  loadVerifiedAnalysisRequirements,
} from '../tools/verified-analysis-requirements.mjs';
import { sha256Bytes, stableJson } from '../tools/package-common.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractRoot = path.join(packageRoot, 'analysis-use', 'v1.0.0');
const readBytes = relative => fs.readFileSync(path.join(contractRoot, relative));
const readJson = relative => JSON.parse(readBytes(relative).toString('utf8'));
const clone = value => structuredClone(value);
const sha256 = bytes => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

function reidentify(card) {
  const body = clone(card);
  delete body.use_card_id;
  card.use_card_id = `obs:analysis-use-card:${card.analysis_id}:${sha256Bytes(stableJson(body)).slice(0, 16)}`;
  return card;
}

const expectedAnalysisIds = [
  'market_share',
  'market_concentration_hhi',
  'effective_local_market_share',
  'health_system_scale',
  'financial_operating_margin',
  'financial_days_cash_on_hand',
  'financial_debt_to_capitalization',
  'financial_cost_per_adjusted_discharge',
  'financial_fte_per_adjusted_occupied_bed',
  'financial_supply_cost_ratio',
  'financial_strength',
  'quality_reliability',
  'service_line_analysis',
  'demand_forecasting',
  'sdoh',
];

const pin = readJson('upstream/analysis-requirements.pin.json');
const catalog = readJson(pin.catalog.path);
const profiles = readJson('fixtures/hhi-analysis-input-profiles.json');
const compatibilityAssertions = readJson('fixtures/hhi-analysis-compatibility.json');
const semanticJoins = readJson('fixtures/hhi-semantic-joins.json');
const joinRoutes = readJson('fixtures/hhi-join-routes.json');
const verifiedRequirements = await loadVerifiedAnalysisRequirements({ contractRoot });
const analysisId = 'market_concentration_hhi';
const common = {
  verifiedRequirements,
  analysisId,
  semanticJoins,
  compatibilityAssertions,
  joinRoutes,
};

function validatorFromPath(filePath) {
  const schema = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

function contractValidator(relative) {
  return validatorFromPath(path.join(contractRoot, relative));
}

function assertValid(validate, value) {
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}

function compile(datasetProfiles, overrides = {}) {
  return compileAnalysisUseCard({
    ...common,
    datasetProfiles,
    ...overrides,
  });
}

function singleInputProfile({ inputId, profileId, recordId }) {
  const profile = clone(profiles[0]);
  const input = profile.inputs.find(item => item.input_id === inputId);
  assert.ok(input, `fixture is missing ${inputId}`);
  profile.profile_id = profileId;
  profile.record_id = recordId;
  profile.inputs = [input];
  profile.properties = [];
  return profile;
}

function exactSetCompatibility(datasetProfiles, suffix) {
  const recordIds = datasetProfiles.map(profile => profile.record_id).sort();
  return compatibilityAssertions.map(assertion => ({
    ...clone(assertion),
    assertion_id: `${assertion.assertion_id}:${suffix}`,
    record_ids: recordIds,
  }));
}

function withInputMutation(inputId, mutate) {
  const changed = clone(profiles);
  const input = changed[0].inputs.find(item => item.input_id === inputId);
  assert.ok(input, `fixture is missing ${inputId}`);
  mutate(input);
  return changed;
}

test('pinned Toolkit catalog is byte-intact, strict, and exposes all fifteen analyses', () => {
  const validatePin = contractValidator('schemas/analysis-requirements-pin.schema.json');
  const validateCatalog = new Ajv2020({ allErrors: true, strict: true, strictRequired: false })
    .compile(readJson(pin.schema.path));
  assertValid(validatePin, pin);
  assertValid(validateCatalog, catalog);

  for (const artifact of [pin.catalog, pin.schema]) {
    const bytes = readBytes(artifact.path);
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(sha256(bytes), artifact.sha256);
  }

  assert.deepEqual(catalog.requirements.map(item => item.analysis_id), expectedAnalysisIds);
  assert.equal(pin.source.revision, '8700a2fffbd067da1c52818cce3b7c546b423296');
  assert.match(pin.source.revision, /^[a-f0-9]{40}$/);
  assert.deepEqual(catalog.authority, {
    discovery_guidance_only: true,
    data_access_authorized: false,
    calculation_authorized: false,
    persistence_authorized: false,
    publication_authorized: false,
  });

  const metadata = getVerifiedAnalysisRequirementsMetadata(verifiedRequirements);
  assert.equal(metadata.analysis_count, 15);
  assert.deepEqual(metadata.analysis_ids, expectedAnalysisIds);
  assert.equal(getVerifiedAnalysisRequirementsDigest(verifiedRequirements), pin.catalog.sha256);
});

test('profiles, compatibility, semantic joins, and canonical join routes validate strictly', () => {
  const contracts = [
    ['profile', contractValidator('schemas/analysis-input-profile.schema.json'), profiles[0]],
    ['compatibility', contractValidator('schemas/analysis-compatibility.schema.json'), compatibilityAssertions[0]],
    ['semantic join', contractValidator('schemas/semantic-join.schema.json'), semanticJoins[0]],
    ['join route', validatorFromPath(path.join(packageRoot, 'schemas', 'join-route.schema.json')), joinRoutes[0]],
  ];

  for (const [label, validate, value] of contracts) {
    assertValid(validate, value);
    assert.equal(
      validate({ ...clone(value), unexpected_contract_field: label }),
      false,
      `${label} schema must reject unknown fields`,
    );
  }
});

test('one utilization source yields an honest four-of-five partial HHI card with a missing join', () => {
  const card = compile([profiles[0]]);
  assert.equal(card.support_status, 'partial');
  assert.equal(card.input_coverage.required_count, 5);
  assert.equal(card.input_coverage.covered_count, 4);
  assert.deepEqual(card.input_coverage.missing_input_ids, ['system_id']);
  assert.deepEqual(card.input_coverage.unverified_input_ids, ['system_id']);
  assert.deepEqual(card.join_coverage.map(item => item.state), ['missing']);
  assertValid(contractValidator('schemas/analysis-use-card.schema.json'), card);
});

test('two reviewed sources support HHI with exact compatibility and a documented canonical route', () => {
  const card = compile(profiles);
  assertValid(contractValidator('schemas/analysis-use-card.schema.json'), card);
  assert.equal(card.support_status, 'supported');
  assert.equal(card.methodology, 'hc-metrics:hhi:1.0.0');
  assert.equal(card.implementation_methodology, 'hhi');
  assert.deepEqual(card.upstream_analysis_ids, ['market_share']);
  assert.equal(card.input_coverage.covered_count, 5);
  assert.deepEqual(card.input_coverage.missing_input_ids, []);
  assert.deepEqual(card.input_coverage.unverified_input_ids, []);
  assert.ok(card.property_coverage.every(item => item.state === 'documented'));
  assert.deepEqual(card.join_coverage.map(item => item.state), ['documented']);
  assert.deepEqual(card.join_coverage[0].supporting_edges, [{
    route_id: joinRoutes[0].route_id,
    alternative_id: 'facility_utilization_to_system_membership_many_to_one',
    from_record_id: semanticJoins[0].from_record_id,
    to_record_id: semanticJoins[0].to_record_id,
  }]);
  assert.equal(card.temporal_requirements.same_period_required, true);
  assert.deepEqual(card.temporal_requirements.period_input_ids, ['period']);
  assert.ok(card.limitations.some(item => item.includes('Outpatient')));
  assert.deepEqual(card.truth_boundary, {
    assertion_type: 'requirement_derived_analytical_fit_not_source_truth',
    source_truth_separate: true,
    field_inference_allowed: false,
    data_access_authorized: false,
    calculation_authorized: false,
    persistence_authorized: false,
    publication_authorized: false,
  });
});

test('logical join orientation accepts a correctly inverted stored route and enforces direction', () => {
  const reversedJoins = clone(semanticJoins);
  const reversedRoutes = clone(joinRoutes);
  const semanticJoin = reversedJoins[0];
  const route = reversedRoutes[0];
  [semanticJoin.from_record_id, semanticJoin.to_record_id] = [
    semanticJoin.to_record_id,
    semanticJoin.from_record_id,
  ];
  [semanticJoin.from_logical_endpoint, semanticJoin.to_logical_endpoint] = ['right', 'left'];
  [semanticJoin.from_key_input_ids, semanticJoin.to_key_input_ids] = [
    semanticJoin.to_key_input_ids,
    semanticJoin.from_key_input_ids,
  ];
  [semanticJoin.from_field_refs, semanticJoin.to_field_refs] = [
    semanticJoin.to_field_refs,
    semanticJoin.from_field_refs,
  ];
  [route.from_record_id, route.to_record_id] = [route.to_record_id, route.from_record_id];
  route.cardinality = 'one_to_many';
  route.direction = 'to_from';
  for (const pair of route.key_pairs) {
    [pair.from_fields, pair.to_fields] = [pair.to_fields, pair.from_fields];
    [pair.from_namespace, pair.to_namespace] = [pair.to_namespace, pair.from_namespace];
  }

  const reversed = compile(profiles, { semanticJoins: reversedJoins, joinRoutes: reversedRoutes });
  assert.equal(reversed.support_status, 'supported');
  assert.deepEqual(reversed.join_coverage.map(item => item.state), ['documented']);

  reversedRoutes[0].direction = 'from_to';
  const wrongDirection = compile(profiles, { semanticJoins: reversedJoins, joinRoutes: reversedRoutes });
  assert.equal(wrongDirection.support_status, 'partial');
  assert.deepEqual(wrongDirection.join_coverage.map(item => item.state), ['candidate']);
});

test('hospital routes require an explicitly declared hospital alternative', () => {
  const hospitalJoins = clone(semanticJoins);
  const hospitalRoutes = clone(joinRoutes);
  hospitalJoins[0].join_alternative_id = 'hospital_utilization_to_system_membership_many_to_one';
  hospitalRoutes[0].entity = 'hospital';
  assert.equal(
    compile(profiles, { semanticJoins: hospitalJoins, joinRoutes: hospitalRoutes }).support_status,
    'supported',
  );

  hospitalJoins[0].join_alternative_id = 'facility_utilization_to_system_membership_many_to_one';
  assert.throws(
    () => compile(profiles, { semanticJoins: hospitalJoins, joinRoutes: hospitalRoutes }),
    /route entity is not allowed/,
  );
});

test('semantic joins must bind a declared alternative to unambiguous endpoint discriminators', () => {
  const unknownAlternative = clone(semanticJoins);
  unknownAlternative[0].join_alternative_id = 'not_declared';
  assert.throws(
    () => compile(profiles, { semanticJoins: unknownAlternative }),
    /alternative is not declared/,
  );

  const reversedRoles = clone(semanticJoins);
  [reversedRoles[0].from_logical_endpoint, reversedRoles[0].to_logical_endpoint] = ['right', 'left'];
  assert.throws(
    () => compile(profiles, { semanticJoins: reversedRoles }),
    /endpoint discriminator binding is invalid or ambiguous/,
  );

  const ambiguousProfiles = clone(profiles);
  const utilizationSystem = ambiguousProfiles[0].inputs.find(item => item.input_id === 'system_id');
  Object.assign(utilizationSystem, {
    availability: 'source_reported',
    field_refs: ['system_id'],
    domain_compatibility: 'documented',
  });
  ambiguousProfiles[1].inputs.push(clone(
    ambiguousProfiles[0].inputs.find(item => item.input_id === 'utilization_volume'),
  ));
  assert.throws(
    () => compile(ambiguousProfiles),
    /endpoint discriminator binding is invalid or ambiguous/,
  );
});

test('multi-source properties remain missing without exact-set compatibility evidence', () => {
  const card = compile(profiles, { compatibilityAssertions: [] });
  assert.equal(card.support_status, 'partial');
  assert.equal(card.input_coverage.covered_count, 5);
  assert.ok(card.property_coverage.every(item => item.state === 'missing'));
  assert.deepEqual(card.join_coverage.map(item => item.state), ['documented']);
});

test('candidate routes and unapproved period alignment fail closed', () => {
  const candidateRoutes = clone(joinRoutes);
  candidateRoutes[0].compatibility_state = 'candidate';
  const candidateRouteCard = compile(profiles, { joinRoutes: candidateRoutes });
  assert.equal(candidateRouteCard.support_status, 'partial');
  assert.deepEqual(candidateRouteCard.join_coverage.map(item => item.state), ['candidate']);

  for (const periodAlignment of ['candidate', 'not_applicable']) {
    const changedJoins = clone(semanticJoins);
    changedJoins[0].period_alignment = periodAlignment;
    const card = compile(profiles, { semanticJoins: changedJoins });
    assert.equal(card.support_status, 'partial');
    assert.deepEqual(card.join_coverage.map(item => item.state), ['candidate']);
  }
});

test('a fully documented join path is not downgraded by an unused incompatible alternative', () => {
  const extraJoin = clone(semanticJoins[0]);
  extraJoin.semantic_join_id = `${extraJoin.semantic_join_id}:incompatible-one-to-one`;
  extraJoin.join_alternative_id = 'facility_utilization_to_system_membership_one_to_one';
  extraJoin.route_id = `${extraJoin.route_id}:incompatible-one-to-one`;
  const extraRoute = clone(joinRoutes[0]);
  extraRoute.route_id = extraJoin.route_id;
  extraRoute.cardinality = 'one_to_one';
  extraRoute.compatibility_state = 'incompatible';
  extraRoute.blocked_reason = 'The alternative is included only to test non-supporting route isolation.';

  const card = compile(profiles, {
    semanticJoins: [...semanticJoins, extraJoin],
    joinRoutes: [...joinRoutes, extraRoute],
  });
  assert.equal(card.support_status, 'supported');
  assert.deepEqual(card.join_coverage[0].route_ids, [joinRoutes[0].route_id]);
  assert.deepEqual(card.join_coverage[0].supporting_edges, [{
    route_id: joinRoutes[0].route_id,
    alternative_id: 'facility_utilization_to_system_membership_many_to_one',
    from_record_id: semanticJoins[0].from_record_id,
    to_record_id: semanticJoins[0].to_record_id,
  }]);
});

test('value-kind, unit, and domain mismatches cannot count as covered inputs', () => {
  const wrongKind = withInputMutation('service_line', input => {
    input.value_kind = 'decimal';
  });
  const wrongKindCard = compile(wrongKind);
  assert.equal(wrongKindCard.support_status, 'partial');
  assert.deepEqual(wrongKindCard.input_coverage.missing_input_ids, ['service_line']);
  assert.deepEqual(wrongKindCard.input_coverage.unverified_input_ids, ['service_line']);

  const wrongUnit = withInputMutation('service_line', input => {
    input.measurement_unit = 'classification_code';
  });
  const wrongUnitCard = compile(wrongUnit);
  assert.equal(wrongUnitCard.support_status, 'partial');
  assert.deepEqual(wrongUnitCard.input_coverage.missing_input_ids, ['service_line']);

  const incompatibleDomain = withInputMutation('service_line', input => {
    input.availability = 'proxy_only';
    input.domain_compatibility = 'incompatible';
  });
  const incompatibleDomainCard = compile(incompatibleDomain);
  assert.equal(incompatibleDomainCard.support_status, 'partial');
  assert.deepEqual(incompatibleDomainCard.input_coverage.missing_input_ids, ['service_line']);

  const malformedCountedDomain = withInputMutation('service_line', input => {
    input.domain_compatibility = 'incompatible';
  });
  assert.throws(() => compile(malformedCountedDomain), /failed its strict schema/);
});

test('raw or fabricated requirements cannot override the opaque verified handle', () => {
  const fabricatedRequirement = getVerifiedAnalysisRequirement(verifiedRequirements, analysisId);
  fabricatedRequirement.methodology = 'hc-metrics:hhi:999.0.0';
  fabricatedRequirement.required_inputs = fabricatedRequirement.required_inputs.slice(0, 1);

  const card = compileAnalysisUseCard({
    ...common,
    datasetProfiles: profiles,
    requirement: fabricatedRequirement,
  });
  assert.equal(card.methodology, 'hc-metrics:hhi:1.0.0');
  assert.equal(card.input_coverage.required_count, 5);

  const fabricatedHandle = Object.freeze({
    schema_version: 'observatory-verified-analysis-requirements.v1.0.0',
  });
  assert.throws(
    () => compileAnalysisUseCard({ ...common, verifiedRequirements: fabricatedHandle, datasetProfiles: profiles }),
    /must be returned by loadVerifiedAnalysisRequirements/,
  );
});

test('malformed or unresolved evidence is rejected before support can be claimed', () => {
  const badProfileEvidence = clone(profiles);
  badProfileEvidence[0].inputs[0].evidence_ids = [];
  assert.throws(() => compile(badProfileEvidence), /profile .*failed its strict schema/);

  const badCompatibilityEvidence = clone(compatibilityAssertions);
  badCompatibilityEvidence[0].evidence_ids = [];
  assert.throws(
    () => compile(profiles, { compatibilityAssertions: badCompatibilityEvidence }),
    /compatibility assertion .*failed its strict schema/,
  );

  const badSemanticEvidence = clone(semanticJoins);
  badSemanticEvidence[0].evidence_ids = [];
  assert.throws(
    () => compile(profiles, { semanticJoins: badSemanticEvidence }),
    /semantic join .*failed its strict schema/,
  );

  const badRouteEvidence = clone(joinRoutes);
  badRouteEvidence[0].evidence_refs = [];
  assert.throws(
    () => compile(profiles, { joinRoutes: badRouteEvidence }),
    /join route .*failed its strict schema/,
  );

  assert.throws(
    () => compile(profiles, { joinRoutes: [] }),
    /semantic join route is missing/,
  );

  const unresolvedRouteEvidence = clone(joinRoutes);
  unresolvedRouteEvidence[0].evidence_refs[0].state = 'unresolved';
  const unresolvedCard = compile(profiles, { joinRoutes: unresolvedRouteEvidence });
  assert.equal(unresolvedCard.support_status, 'partial');
  assert.deepEqual(unresolvedCard.join_coverage.map(item => item.state), ['candidate']);

  const incompleteRouteEvidence = clone(joinRoutes);
  incompleteRouteEvidence[0].evidence_refs.pop();
  const incompleteCard = compile(profiles, { joinRoutes: incompleteRouteEvidence });
  assert.equal(incompleteCard.support_status, 'partial');
  assert.deepEqual(incompleteCard.join_coverage.map(item => item.state), ['candidate']);

  for (const cardinality of ['one_to_many', 'many_to_many']) {
    const unsafeCardinalityRoute = clone(joinRoutes);
    unsafeCardinalityRoute[0].cardinality = cardinality;
    const unsafeCardinalityCard = compile(profiles, { joinRoutes: unsafeCardinalityRoute });
    assert.equal(unsafeCardinalityCard.support_status, 'partial');
    assert.deepEqual(unsafeCardinalityCard.join_coverage.map(item => item.state), ['candidate']);
  }

  const partialCompoundKey = clone(semanticJoins);
  partialCompoundKey[0].from_field_refs.push('reporting_year');
  assert.throws(
    () => compile(profiles, { semanticJoins: partialCompoundKey }),
    /semantic join fields must match exactly one route key pair/,
  );

  const ambiguousRouteKeys = clone(joinRoutes);
  ambiguousRouteKeys[0].key_pairs.push(clone(ambiguousRouteKeys[0].key_pairs[0]));
  assert.throws(
    () => compile(profiles, { joinRoutes: ambiguousRouteKeys }),
    /semantic join fields must match exactly one route key pair/,
  );
});

test('duplicate compatibility and join semantic keys are rejected', () => {
  const duplicateCompatibility = clone(compatibilityAssertions);
  duplicateCompatibility.push({
    ...clone(duplicateCompatibility[0]),
    assertion_id: `${duplicateCompatibility[0].assertion_id}:duplicate`,
    state: 'not_satisfied',
  });
  assert.throws(
    () => compile(profiles, { compatibilityAssertions: duplicateCompatibility }),
    /compatibility semantic keys must be unique/,
  );

  const duplicateJoins = clone(semanticJoins);
  duplicateJoins.push({
    ...clone(duplicateJoins[0]),
    semantic_join_id: `${duplicateJoins[0].semantic_join_id}:duplicate`,
  });
  assert.throws(
    () => compile(profiles, { semanticJoins: duplicateJoins }),
    /semantic join relationship keys must be unique/,
  );
});

test('disconnected contributing and unused extra sources cannot produce supported cards', () => {
  const disconnected = singleInputProfile({
    inputId: 'service_line',
    profileId: 'example:analysis-input-profile:a-service-lines:hhi',
    recordId: 'example:dataset:a-service-lines',
  });
  const disconnectedProfiles = [...profiles, disconnected];
  const disconnectedCard = compile(disconnectedProfiles, {
    compatibilityAssertions: exactSetCompatibility(disconnectedProfiles, 'disconnected'),
  });
  assert.equal(disconnectedCard.input_coverage.covered_count, 5);
  assert.ok(disconnectedCard.property_coverage.every(item => item.state === 'documented'));
  assert.ok(disconnectedCard.research_set.every(item => item.supplied_input_ids.length > 0));
  assert.equal(disconnectedCard.support_status, 'partial');
  assert.deepEqual(disconnectedCard.join_coverage.map(item => item.state), ['missing']);

  const unused = singleInputProfile({
    inputId: 'service_line',
    profileId: 'example:analysis-input-profile:zz-unused-service-lines:hhi',
    recordId: 'example:dataset:zz-unused-service-lines',
  });
  const profilesWithUnused = [...profiles, unused];
  const unusedCard = compile(profilesWithUnused, {
    compatibilityAssertions: exactSetCompatibility(profilesWithUnused, 'unused'),
  });
  assert.equal(unusedCard.input_coverage.covered_count, 5);
  assert.ok(unusedCard.property_coverage.every(item => item.state === 'documented'));
  assert.deepEqual(unusedCard.join_coverage.map(item => item.state), ['documented']);
  assert.deepEqual(
    unusedCard.research_set.find(item => item.record_id === unused.record_id).supplied_input_ids,
    [],
  );
  assert.equal(unusedCard.support_status, 'partial');
});

test('evidence changes alter both the evidence digest and Use Card identity', () => {
  const original = compile(profiles);
  const amendedProfiles = clone(profiles);
  amendedProfiles[0].inputs[0].evidence_ids.push('example:evidence:amended-field-review');
  const amended = compile(amendedProfiles);

  assert.equal(original.support_status, 'supported');
  assert.equal(amended.support_status, 'supported');
  assert.equal(original.requirement_sha256, amended.requirement_sha256);
  assert.notEqual(original.evidence_sha256, amended.evidence_sha256);
  assert.notEqual(original.use_card_id, amended.use_card_id);

  const reorderedProfiles = clone(profiles);
  reorderedProfiles[0].limitations.reverse();
  reorderedProfiles[0].inputs[0].evidence_ids.reverse();
  reorderedProfiles.reverse();
  const reordered = compile(reorderedProfiles);
  assert.equal(reordered.evidence_sha256, original.evidence_sha256);
  assert.equal(reordered.use_card_id, original.use_card_id);

  const reorderedNormalization = clone(joinRoutes);
  reorderedNormalization[0].key_pairs[0].normalization_steps.reverse();
  const changedProcedure = compile(profiles, { joinRoutes: reorderedNormalization });
  assert.notEqual(changedProcedure.evidence_sha256, original.evidence_sha256);
  assert.notEqual(changedProcedure.use_card_id, original.use_card_id);
});

test('compiler and recommendations are deterministic and match the immutable fixture', () => {
  const options = { ...common, datasetProfiles: profiles, maxSources: 2 };
  const cards = compileAnalysisUseCards(options);
  const reversedCards = compileAnalysisUseCards({
    ...options,
    datasetProfiles: [...profiles].reverse(),
  });
  assert.deepEqual(cards, reversedCards);

  const recommendations = recommendResearchSets(options);
  assert.deepEqual(
    recommendations,
    recommendResearchSets({ ...options, datasetProfiles: [...profiles].reverse() }),
  );
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].support_status, 'supported');
  assert.deepEqual(recommendations[0].research_set.map(item => item.record_id), [
    'example:dataset:facility-system-crosswalk',
    'example:dataset:pa-inpatient-utilization',
  ]);

  const expectedFixture = [compile([profiles[0]]), ...recommendations];
  const generatedFixture = readJson('fixtures/hhi-use-cards.json');
  assert.deepEqual(generatedFixture, expectedFixture);
  const validateCard = contractValidator('schemas/analysis-use-card.schema.json');
  generatedFixture.forEach(card => assertValid(validateCard, card));
});

test('partial recommendation pruning preserves better property and join readiness', () => {
  const unused = singleInputProfile({
    inputId: 'service_line',
    profileId: 'example:analysis-input-profile:zz-readiness:hhi',
    recordId: 'example:dataset:zz-readiness',
  });
  const expandedProfiles = [...profiles, unused];
  const recommendations = recommendResearchSets({
    ...common,
    datasetProfiles: expandedProfiles,
    compatibilityAssertions: exactSetCompatibility(expandedProfiles, 'readiness'),
    maxSources: 3,
  });
  const reviewedExactSet = recommendations.find(card => card.research_set.length === 3);

  assert.ok(reviewedExactSet, 'a smaller subset with missing properties must not suppress the reviewed exact set');
  assert.equal(reviewedExactSet.support_status, 'partial');
  assert.ok(reviewedExactSet.property_coverage.every(item => item.state === 'documented'));
  assert.ok(reviewedExactSet.join_coverage.every(item => item.state === 'documented'));
});

test('partial recommendation pruning does not prefer derived inputs over direct inputs', () => {
  const derived = clone(profiles[0]);
  derived.profile_id = 'example:analysis-input-profile:derived-all:hhi';
  derived.record_id = 'example:dataset:derived-all';
  derived.inputs = derived.inputs.filter(item => item.input_id !== 'system_id');
  derived.inputs.push(clone(profiles[1].inputs.find(item => item.input_id === 'system_id')));
  for (const input of derived.inputs) {
    input.availability = 'derivable';
    input.domain_compatibility = 'documented';
    input.derivation = {
      derivation_id: `example:derivation:${input.input_id}`,
      description: `Synthetic derivation for ${input.input_id}.`,
      evidence_ids: ['example:evidence:derived-input-review'],
    };
  }
  for (const property of derived.properties) property.state = 'candidate';

  const direct = clone(derived);
  direct.profile_id = 'example:analysis-input-profile:direct-all:hhi';
  direct.record_id = 'example:dataset:direct-all';
  direct.properties = [];
  for (const input of direct.inputs) {
    input.availability = 'source_reported';
    delete input.derivation;
  }
  const exactSetAssertions = exactSetCompatibility([derived, direct], 'availability')
    .map(assertion => ({ ...assertion, state: 'candidate' }));
  const recommendations = recommendResearchSets({
    ...common,
    datasetProfiles: [derived, direct],
    compatibilityAssertions: exactSetAssertions,
    semanticJoins: [],
    joinRoutes: [],
    maxSources: 2,
  });
  const directExactSet = recommendations.find(card => card.research_set.length === 2);

  assert.ok(directExactSet, 'a derived one-source card must not suppress a direct-input exact set');
  assert.ok(directExactSet.input_coverage.bindings.every(binding =>
    binding.availability === 'source_reported'));
});

test('Use Cards cannot contain calculation outputs', () => {
  const card = compile(profiles);
  const forbidden = [
    'calculation',
    'calculation_result',
    'metric_value',
    'hhi_value',
    'result_value',
  ];
  for (const field of forbidden) assert.equal(Object.hasOwn(card, field), false);

  const validateCard = contractValidator('schemas/analysis-use-card.schema.json');
  assert.equal(validateCard({ ...clone(card), hhi_value: 1234 }), false);

  const impossibleCoverage = clone(card);
  impossibleCoverage.input_coverage.covered_count = 0;
  assert.throws(
    () => validateAnalysisUseCard({ verifiedRequirements, card: impossibleCoverage }),
    /covered_count disagrees with its bindings/,
  );

  const alteredBody = clone(card);
  alteredBody.limitations.push('A post-compilation mutation.');
  assert.throws(
    () => validateAnalysisUseCard({ verifiedRequirements, card: alteredBody }),
    /identity disagrees with its canonical card body/,
  );

  const omittedProperty = clone(card);
  omittedProperty.property_coverage.pop();
  reidentify(omittedProperty);
  assert.throws(
    () => validateAnalysisUseCard({ verifiedRequirements, card: omittedProperty }),
    /properties do not match its verified requirement/,
  );

  const forgedNotRequired = clone(card);
  Object.assign(forgedNotRequired.join_coverage[0], {
    state: 'not_required',
    supporting_edges: [],
    route_ids: [],
    evidence_ids: [],
    limitations: [],
  });
  reidentify(forgedNotRequired);
  assert.throws(
    () => validateAnalysisUseCard({ verifiedRequirements, card: forgedNotRequired }),
    /join state ignores a cross-record requirement/,
  );

  const missingDerivation = clone(card);
  missingDerivation.input_coverage.bindings[0].availability = 'derivable';
  missingDerivation.input_coverage.bindings[0].derivation = null;
  reidentify(missingDerivation);
  assert.throws(
    () => validateAnalysisUseCard({ verifiedRequirements, card: missingDerivation }),
    /failed its strict schema/,
  );

  const forgedDomain = clone(card);
  forgedDomain.input_coverage.bindings[0].domain_constraints.allowed_values = ['fabricated'];
  reidentify(forgedDomain);
  assert.throws(
    () => validateAnalysisUseCard({ verifiedRequirements, card: forgedDomain }),
    /domain constraints disagree with its verified input requirement/,
  );
});

test('requirement-bound validation rejects disconnected and physically reused supporting edges', () => {
  const disconnected = clone(compile(profiles));
  const serviceLine = disconnected.input_coverage.bindings
    .find(binding => binding.input_id === 'service_line');
  const previousRow = disconnected.research_set.find(row =>
    row.record_id === serviceLine.record_id && row.profile_id === serviceLine.profile_id);
  previousRow.supplied_input_ids = previousRow.supplied_input_ids
    .filter(inputId => inputId !== 'service_line');
  serviceLine.record_id = 'example:dataset:third-service-line-source';
  serviceLine.profile_id = 'example:analysis-input-profile:third-service-line-source:hhi';
  disconnected.research_set.push({
    record_id: serviceLine.record_id,
    profile_id: serviceLine.profile_id,
    supplied_input_ids: ['service_line'],
    limitations: [],
  });
  disconnected.research_set.sort((left, right) =>
    left.record_id < right.record_id ? -1 : left.record_id > right.record_id ? 1 : 0);
  reidentify(disconnected);
  assert.throws(
    () => validateAnalysisUseCard({ verifiedRequirements, card: disconnected }),
    /supporting edges do not connect required records/,
  );

  const reusedRoute = clone(disconnected);
  reusedRoute.join_coverage[0].supporting_edges.push({
    route_id: reusedRoute.join_coverage[0].supporting_edges[0].route_id,
    alternative_id: 'facility_utilization_to_system_membership_one_to_one',
    from_record_id: semanticJoins[0].to_record_id,
    to_record_id: serviceLine.record_id,
  });
  reidentify(reusedRoute);
  assert.throws(
    () => validateAnalysisUseCard({ verifiedRequirements, card: reusedRoute }),
    /reuses a route with inconsistent endpoints/,
  );

  const metadataOnlyEdge = clone(disconnected);
  metadataOnlyEdge.join_coverage[0].supporting_edges.push({
    route_id: 'obs:join-route:invented-third-source',
    alternative_id: 'facility_utilization_to_system_membership_one_to_one',
    from_record_id: semanticJoins[0].to_record_id,
    to_record_id: serviceLine.record_id,
  });
  metadataOnlyEdge.join_coverage[0].route_ids.push('obs:join-route:invented-third-source');
  metadataOnlyEdge.join_coverage[0].route_ids.sort();
  reidentify(metadataOnlyEdge);
  assert.throws(
    () => validateAnalysisUseCard({ verifiedRequirements, card: metadataOnlyEdge }),
    /supporting edge discriminator suppliers are invalid or ambiguous/,
  );
});

test('compiler enforces per-card, enumeration, and corpus source bounds', () => {
  const extraA = singleInputProfile({
    inputId: 'service_line',
    profileId: 'example:analysis-input-profile:extra-a:hhi',
    recordId: 'example:dataset:extra-a',
  });
  const extraB = singleInputProfile({
    inputId: 'period',
    profileId: 'example:analysis-input-profile:extra-b:hhi',
    recordId: 'example:dataset:extra-b',
  });
  assert.throws(
    () => compile([...profiles, extraA, extraB]),
    /limited to three dataset profiles/,
  );

  for (const maxSources of [0, 4]) {
    assert.throws(
      () => compileAnalysisUseCards({ ...common, datasetProfiles: profiles, maxSources }),
      /maxSources must be an integer from 1 through 3/,
    );
  }

  const tooManyProfiles = Array.from({ length: 21 }, (_, index) => singleInputProfile({
    inputId: 'service_line',
    profileId: `example:analysis-input-profile:bounded-${index}:hhi`,
    recordId: `example:dataset:bounded-${index}`,
  }));
  assert.throws(
    () => compileAnalysisUseCards({ ...common, datasetProfiles: tooManyProfiles, maxSources: 1 }),
    /datasetProfiles exceeds the bounded compiler limit of 20/,
  );
});
