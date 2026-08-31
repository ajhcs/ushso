import {
  canonicalDigest,
  matrixMembershipPayload,
  membershipManifestDigest,
  snapshotDigest
} from '../../../../../contracts/coverage/v1.0.0/tools/common.mjs';
import {
  AS_OF,
  CANONICAL_COVERAGE_CELL_STATES,
  CONNECTOR_CONFIGURATION_REVISION,
  CONNECTOR_REVISION,
  COVERAGE_MATRIX_ID,
  COVERAGE_SNAPSHOT_ID,
  POLICY_REVISION,
  PUBLIC_POSITIONING,
  REGISTRY_REVISION,
  REPORTING_WINDOW,
  REVISION_PINS,
  SOURCE_SCOPE_REVISION
} from './constants.mjs';

const FEDERAL_RECORDS_SHA256 = '55ab311269ef1da6d8a175fe155f028a134946b427357b705b96babde3d39a83';
const READINESS_SHA256 = '73c555868b1982b972181fb87bf7a4b61d71c487013d0cbec46f53595893b224';

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function slug(value) {
  return String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

function evidenceRef(evidenceId, revision, observedAt = AS_OF) {
  return { evidence_id: evidenceId, revision, observed_at: observedAt };
}

function overlap({ canOverlap = false, additive = true, groupIds = [], note = 'The declared metric cohort is disjoint.' } = {}) {
  return { can_overlap: canOverlap, additive, overlap_group_ids: groupIds, note };
}

export function buildJurisdictionRegistry(readiness) {
  assert(readiness?.schema_version === 'ushso-national-readiness.v0.1.0', 'READINESS_SCHEMA_MISMATCH');
  assert(readiness.summary?.jurisdictions === 51, 'READINESS_JURISDICTION_COUNT_MISMATCH');
  assert(Array.isArray(readiness.states) && readiness.states.length === 51, 'READINESS_STATE_LIST_COUNT_MISMATCH');

  const jurisdictions = readiness.states.map(state => ({
    jurisdiction_id: `jurisdiction:US-${state.postal}`,
    name: state.name,
    postal: state.postal,
    fips: state.fips,
    jurisdiction_type: state.postal === 'DC' ? 'district' : 'state',
    legacy_aggregate_readiness: {
      state_overlay_status: state.state_overlay_status,
      overlay_readiness_status: state.overlay_readiness_status,
      candidate_record_count: state.candidate_record_count,
      published_state_record_count: state.published_state_record_count,
      interpretation: state.interpretation,
      next_step: state.next_step,
      source_grain: 'jurisdiction_aggregate',
      promotable_to_source_class_cell: false
    }
  })).sort((left, right) => compareText(left.postal, right.postal));

  assert(new Set(jurisdictions.map(item => item.jurisdiction_id)).size === 51, 'DUPLICATE_JURISDICTION');
  return {
    schema_version: 'ushso-coverage-jurisdiction-registry.v1.0.0',
    registry_revision: REGISTRY_REVISION,
    evidence: {
      path: 'packages/retrieval/readiness/v0.1.0/state-readiness.json',
      sha256: READINESS_SHA256,
      admissible_grain: 'jurisdiction_registry_membership',
      source_class_promotion_prohibited: true
    },
    configured_jurisdiction_count: jurisdictions.length,
    jurisdictions
  };
}

export function buildFederalSourceRegistry(federalRecords) {
  assert(Array.isArray(federalRecords) && federalRecords.length === 14, 'FEDERAL_RECORD_COUNT_MISMATCH');
  const sources = federalRecords.map(record => {
    const filteringMode = record.geography?.state_filtering?.mode;
    assert(['direct', 'crosswalk_required', 'unknown'].includes(filteringMode), `INVALID_FEDERAL_FILTER_MODE:${record.record_id}`);
    return {
      source_scope_id: `source-scope:${record.record_id}`,
      record_id: record.record_id,
      name: record.asset_identity.name,
      publisher: record.asset_identity.publisher,
      authoritative_url: record.authoritative_url,
      applicability_mode: filteringMode,
      access_status: record.access.status,
      metadata_observed_at: record.freshness.metadata_observed_at,
      metadata_validation_state: 'scoped_route_validated',
      validation_boundary: {
        catalog_or_landing_route_confirmed: true,
        payload_availability_proven: false,
        row_coverage_proven: false,
        schema_completeness_proven: false,
        access_authorization_proven: false,
        research_fitness_proven: false
      }
    };
  }).sort((left, right) => compareText(left.record_id, right.record_id));

  assert(new Set(sources.map(source => source.record_id)).size === 14, 'DUPLICATE_FEDERAL_RECORD');
  const applicability = Object.fromEntries(['direct', 'crosswalk_required', 'unknown'].map(mode => [
    mode,
    sources.filter(source => source.applicability_mode === mode).length
  ]));
  assert(applicability.direct === 11, 'FEDERAL_DIRECT_COUNT_MISMATCH');
  assert(applicability.crosswalk_required === 2, 'FEDERAL_CROSSWALK_COUNT_MISMATCH');
  assert(applicability.unknown === 1, 'FEDERAL_UNKNOWN_COUNT_MISMATCH');

  return {
    schema_version: 'ushso-federal-source-evidence-registry.v1.0.0',
    registry_revision: REGISTRY_REVISION,
    evidence: {
      path: 'packages/retrieval/fixtures/national-federal-v0.1.0/records.jsonl',
      sha256: FEDERAL_RECORDS_SHA256,
      observation_kind: 'metadata_route_only'
    },
    source_count: sources.length,
    applicability,
    sources
  };
}

export function buildSourceScopes(federalRegistry) {
  return federalRegistry.sources.map(source => ({
    source_scope_id: source.source_scope_id,
    registry_revision: REGISTRY_REVISION,
    source_scope_revision: SOURCE_SCOPE_REVISION,
    registry_state: 'unassessed',
    authority_level: 'federal',
    responsible_organization_id: `organization:${slug(source.publisher)}`,
    connector_id: 'connector:evidence-only-import',
    connector_revision: CONNECTOR_REVISION,
    connector_configuration_revision: CONNECTOR_CONFIGURATION_REVISION,
    jurisdiction_ids: ['jurisdiction:US'],
    scope_definition: {
      counting_unit: 'native_item',
      native_id_namespace: source.record_id,
      bounded_scope: `Metadata-only evidence record for ${source.name}; no connector inventory enumeration has been started by the WP9 accounting seed.`,
      completeness_denominator_definition: null,
      authoritative_total_supported: false
    },
    policy_revisions: {
      inclusion: POLICY_REVISION,
      exclusion: POLICY_REVISION,
      cadence: POLICY_REVISION,
      check: POLICY_REVISION
    },
    enumeration: {
      status: 'never_started',
      sealed: false,
      membership_revision: null,
      completed_at: null,
      failure_class: null
    },
    absence_claim_permitted: false,
    absence_reason: 'scope_not_assessed'
  }));
}

export function buildStageFacts(sourceScopes) {
  const sourceEvidence = evidenceRef(
    'evidence:federal-records:v0.1.0',
    `sha256:${FEDERAL_RECORDS_SHA256}`
  );
  return sourceScopes.map(scope => ({
    fact_id: `coverage-fact:registry:${scope.source_scope_id}`,
    fact_version: '1.0.0',
    member_key: {
      unit: 'connector_scope',
      namespace: REGISTRY_REVISION,
      value: scope.source_scope_id
    },
    stage: 'registry',
    outcome: 'unassessed',
    source_scope_id: scope.source_scope_id,
    run_id: null,
    definition_version: 'coverage.configured-scope.numerator/v1',
    observed_at: AS_OF,
    effective_at: AS_OF,
    revision_pins: structuredClone(REVISION_PINS),
    axes: {
      milestone: null,
      inclusion: null,
      pipeline: null,
      freshness: null,
      access: null,
      identity: null
    },
    evidence_refs: [sourceEvidence]
  }));
}

export function buildCellRegistry(jurisdictionRegistry, sourceClassRegistry) {
  assert(sourceClassRegistry?.classes?.length === 6, 'SOURCE_CLASS_COUNT_MISMATCH');
  const cells = [];
  for (const jurisdiction of jurisdictionRegistry.jurisdictions) {
    for (const sourceClass of sourceClassRegistry.classes) {
      cells.push({
        cell_id: `coverage-cell:${jurisdiction.postal}:${sourceClass.source_class_id}`,
        jurisdiction_id: jurisdiction.jurisdiction_id,
        jurisdiction_name: jurisdiction.name,
        jurisdiction_postal: jurisdiction.postal,
        jurisdiction_type: jurisdiction.jurisdiction_type,
        source_class_id: sourceClass.source_class_id,
        source_class_label: sourceClass.label,
        agency_operator: {
          status: 'not_identified',
          organization_id: null,
          display_name: null
        },
        scope: {
          denominator_type: 'coverage_assessment_cell',
          definition: 'One configured jurisdiction and explicit source-class pair under the pinned WP9 registry revision.'
        },
        disposition: {
          connector: 'not_assessed',
          manual_review: 'required_before_state_promotion'
        },
        coverage_cell_state: 'not_assessed',
        state_definition_version: 'coverage-cell-state/v1',
        accounted_at: AS_OF,
        evidence: {
          cell_grain_evidence_state: 'none_in_pinned_repository',
          registry_membership_evidence_id: 'evidence:state-readiness:v0.1.0',
          registry_membership_revision: `sha256:${READINESS_SHA256}`,
          legacy_aggregate_readiness_status: jurisdiction.legacy_aggregate_readiness.overlay_readiness_status,
          legacy_status_promotable_to_cell: false,
          reason: 'The pinned readiness evidence is jurisdiction-level and cannot establish a source-class cell state.'
        },
        last_complete_enumeration: null,
        next_action: 'Identify the authoritative operator and perform a bounded source-class-grain assessment before changing this state.',
        absence_claim_permitted: false,
        absence_reason: 'scope_not_assessed'
      });
    }
  }
  cells.sort((left, right) => compareText(left.cell_id, right.cell_id));
  assert(cells.length === 306, 'COVERAGE_CELL_COUNT_MISMATCH');
  assert(new Set(cells.map(cell => `${cell.jurisdiction_id}\u0000${cell.source_class_id}`)).size === 306, 'DUPLICATE_COVERAGE_CELL');
  assert(cells.every(cell => CANONICAL_COVERAGE_CELL_STATES.includes(cell.coverage_cell_state)), 'INVALID_COVERAGE_CELL_STATE');
  return {
    schema_version: 'ushso-state-source-class-cell-registry.v1.0.0',
    registry_revision: REGISTRY_REVISION,
    jurisdiction_registry_revision: jurisdictionRegistry.registry_revision,
    source_class_registry_revision: sourceClassRegistry.registry_revision,
    configured_cell_count: cells.length,
    generation_rule: 'Cartesian product of the 51 configured jurisdictions and six explicit source classes; exactly one canonical state is stored per cell.',
    evidence_grain_rule: 'Jurisdiction-level legacy readiness cannot promote a jurisdiction/source-class cell.',
    cells
  };
}

export function buildCoverageMatrix(cellRegistry) {
  const cells = cellRegistry.cells.map(cell => ({
    cell_id: cell.cell_id,
    jurisdiction_id: cell.jurisdiction_id,
    jurisdiction_type: cell.jurisdiction_type,
    source_class_id: cell.source_class_id,
    authority_level: 'state',
    coverage_cell_state: cell.coverage_cell_state,
    state_definition_version: 'coverage-cell-state/v1',
    registry_revision: REGISTRY_REVISION,
    source_scope_revision: SOURCE_SCOPE_REVISION,
    policy_revision: POLICY_REVISION,
    assessed_at: AS_OF,
    evidence_refs: [evidenceRef(
      'evidence:state-readiness:v0.1.0',
      `sha256:${READINESS_SHA256}`
    )],
    last_enumeration: null,
    next_action: cell.next_action,
    overlap: overlap({
      canOverlap: true,
      additive: false,
      groupIds: ['overlap:state-source-class-assessments'],
      note: 'Source classes and operators may overlap; assessment-cell counts are not asset or source totals and are not additive across concepts.'
    }),
    absence_claim_permitted: false,
    absence_reason: 'scope_not_assessed'
  }));
  const matrix = {
    matrix_id: COVERAGE_MATRIX_ID,
    matrix_version: '1.0.0',
    coverage_snapshot_id: COVERAGE_SNAPSHOT_ID,
    as_of: AS_OF,
    revision_pins: structuredClone(REVISION_PINS),
    denominator: {
      unit: 'coverage_assessment_cell',
      configured_cell_count: cells.length,
      membership_manifest_hash: '',
      definition: 'The complete Cartesian product of 51 configured jurisdictions and six explicit state source classes under the pinned registry revisions.'
    },
    cells
  };
  matrix.denominator.membership_manifest_hash = canonicalDigest(
    'ushso:coverage-membership-manifest:v1\n',
    matrixMembershipPayload(matrix)
  );
  return matrix;
}

function memberForScope(scope, { inNumerator, denominatorMembership, state }) {
  return {
    member_key: {
      unit: 'connector_scope',
      namespace: REGISTRY_REVISION,
      value: scope.source_scope_id
    },
    source_scope_id: scope.source_scope_id,
    in_numerator: inNumerator,
    denominator_membership: denominatorMembership,
    state,
    unclassified_dimensions: [],
    policy_decision: null,
    overlap_group_ids: [],
    evidence_refs: [evidenceRef(
      'evidence:federal-records:v0.1.0',
      `sha256:${FEDERAL_RECORDS_SHA256}`
    )]
  };
}

export function compileMetric(definition, {
  members = [],
  denominatorStatus,
  enumerationStatus = 'not_applicable',
  membershipRevision = null,
  absenceReason = definition.absence_sensitive ? 'scope_not_assessed' : 'not_an_absence_metric',
  overlapDisclosure = overlap(),
  cohortFilters = []
}) {
  if (members.some(member => member.in_numerator === true && member.denominator_membership !== 'included')) {
    throw new Error(`NUMERATOR_OUTSIDE_DENOMINATOR:${definition.metric_id}`);
  }
  const metricSlug = definition.metric_id.replaceAll('/', ':').replaceAll('.', '-');
  const manifest = {
    manifest_id: `coverage-membership:${metricSlug}:wp9:v1.0.0`,
    manifest_version: '1.0.0',
    metric_id: definition.metric_id,
    metric_version: '1.0.0',
    unit: definition.allowed_units[0],
    as_of: AS_OF,
    reporting_window: structuredClone(REPORTING_WINDOW),
    revision_pins: structuredClone(REVISION_PINS),
    cohort_filters: structuredClone(cohortFilters),
    numerator_definition_version: definition.numerator_definition_version,
    denominator_definition_version: definition.denominator_definition_version,
    denominator_status: denominatorStatus,
    estimate_assertion: null,
    enumeration: {
      status: enumerationStatus,
      sealed: enumerationStatus === 'complete',
      run_ids: [],
      membership_revision: enumerationStatus === 'complete' ? membershipRevision : null,
      source_reported_total_admissible: false
    },
    members: structuredClone(members),
    overlap: structuredClone(overlapDisclosure)
  };

  const denominatorMembers = manifest.members.filter(member => member.denominator_membership === 'included');
  const numeratorCount = manifest.members.filter(member => member.in_numerator).length;
  const denominatorCount = denominatorStatus === 'unknown' ? null : denominatorMembers.length;
  const rate = denominatorStatus === 'known' && denominatorCount > 0
    ? numeratorCount / denominatorCount
    : null;
  const partitionCounts = definition.partition
    ? definition.partition.states.map(state => ({
      state,
      count: denominatorMembers.filter(member => member.state === state).length
    }))
    : null;
  const partialEnumeration = ['incomplete', 'failed'].includes(enumerationStatus) && members.length > 0;

  const metric = {
    metric_instance_id: `coverage-metric:${metricSlug}:wp9:v1.0.0`,
    metric_id: definition.metric_id,
    metric_version: '1.0.0',
    unit: manifest.unit,
    numerator_count: numeratorCount,
    numerator_definition_version: definition.numerator_definition_version,
    denominator_count: denominatorCount,
    denominator_definition: definition.denominator_definition,
    denominator_definition_version: definition.denominator_definition_version,
    denominator_status: denominatorStatus,
    rate,
    estimate_assertion: null,
    unknown_count: manifest.members.filter(member => member.state === 'unknown').length,
    not_applicable_count: manifest.members.filter(member => member.state === 'not_applicable').length,
    excluded_count: manifest.members.filter(member => member.state === 'excluded').length,
    unclassified_count: manifest.members.filter(member => member.state === 'unclassified' || member.unclassified_dimensions.length > 0).length,
    as_of: AS_OF,
    reporting_window: structuredClone(REPORTING_WINDOW),
    revision_pins: structuredClone(REVISION_PINS),
    cohort_filters: structuredClone(cohortFilters),
    membership_manifest_id: manifest.manifest_id,
    membership_manifest_hash: membershipManifestDigest(manifest),
    partition_counts: partitionCounts,
    overlap: structuredClone(overlapDisclosure),
    parent_partition_metric_instance_id: null,
    absence_claim_permitted: false,
    absence_reason: absenceReason,
    partial_enumeration_label: partialEnumeration ? 'observed_processing_yield' : null,
    display: {
      n_of_d: denominatorStatus === 'known'
        ? `${numeratorCount} of ${denominatorCount} ${manifest.unit}`
        : `${numeratorCount} observed; denominator ${denominatorStatus} (${manifest.unit})`,
      unit_label: manifest.unit,
      why_this_denominator: definition.denominator_definition,
      overlap_note: overlapDisclosure.note
    }
  };
  return { manifest, metric };
}

export function buildMetrics(definitionsDocument, sourceScopes) {
  const configuredMembers = sourceScopes.map(scope => memberForScope(scope, {
    inNumerator: true,
    denominatorMembership: 'included',
    state: 'unassessed'
  }));
  const harvestMembers = sourceScopes.map(scope => memberForScope(scope, {
    inNumerator: false,
    denominatorMembership: 'outside_conditional_cohort',
    state: 'unassessed'
  }));

  const compiled = definitionsDocument.definitions.map(definition => {
    if (definition.metric_id === 'coverage.configured_scope_status/v1') {
      return compileMetric(definition, {
        members: configuredMembers,
        denominatorStatus: 'known',
        enumerationStatus: 'complete',
        membershipRevision: 'membership:configured-scopes:wp9:v1.0.0',
        absenceReason: 'not_an_absence_metric'
      });
    }
    if (definition.metric_id === 'coverage.harvest_completion/v1') {
      return compileMetric(definition, {
        members: harvestMembers,
        denominatorStatus: 'known',
        enumerationStatus: 'complete',
        membershipRevision: 'membership:active-due-scopes:wp9:v1.0.0',
        absenceReason: 'scope_not_assessed'
      });
    }
    if (definition.allowed_denominator_status.includes('unknown')) {
      return compileMetric(definition, {
        denominatorStatus: 'unknown',
        enumerationStatus: 'not_applicable',
        absenceReason: definition.absence_sensitive ? 'denominator_unknown' : 'not_an_absence_metric'
      });
    }
    return compileMetric(definition, {
      denominatorStatus: 'known',
      enumerationStatus: 'not_applicable',
      absenceReason: definition.absence_sensitive ? 'scope_not_assessed' : 'not_an_absence_metric'
    });
  });
  return {
    membershipManifests: compiled.map(item => item.manifest),
    metrics: compiled.map(item => item.metric)
  };
}

export function buildCoverageSnapshot({ definitionsDocument, sourceScopes, stageFacts, matrixId = COVERAGE_MATRIX_ID }) {
  const { membershipManifests, metrics } = buildMetrics(definitionsDocument, sourceScopes);
  const snapshot = {
    coverage_snapshot_id: COVERAGE_SNAPSHOT_ID,
    snapshot_version: '1.0.0',
    as_of: AS_OF,
    reporting_window: structuredClone(REPORTING_WINDOW),
    revision_pins: structuredClone(REVISION_PINS),
    metric_definition_registry_hash: canonicalDigest('ushso:canonical-json:v1\n', definitionsDocument),
    source_scope_ids: sourceScopes.map(scope => scope.source_scope_id),
    stage_fact_ids: stageFacts.map(fact => fact.fact_id),
    membership_manifests: membershipManifests,
    metrics,
    matrix_id: matrixId,
    public_positioning: PUBLIC_POSITIONING,
    immutability: {
      sealed: true,
      supersedes_snapshot_id: null,
      digest_algorithm: 'coverage_snapshot_sha256/v1',
      canonical_digest: ''
    }
  };
  snapshot.immutability.canonical_digest = snapshotDigest(snapshot);
  return snapshot;
}

export function buildCorpusPositioningManifest({ corpusRecords, curatedAssetIds, corpusManifest }) {
  assert(corpusRecords.length === 157, 'PRODUCTION_CORPUS_RECORD_COUNT_MISMATCH');
  assert(corpusManifest.corpus_version === '1.1.0', 'PRODUCTION_CORPUS_VERSION_MISMATCH');
  const curated = new Set(curatedAssetIds);
  const members = corpusRecords.map(record => {
    const sourceId = record.identity?.source?.source_id;
    let slice;
    if (sourceId === 'harvard_dataverse') slice = 'harvard_dataverse';
    else if (sourceId === 'datacite') slice = 'datacite';
    else if (sourceId === 'pa-open-data') slice = 'pennsylvania_catalog';
    else if (sourceId?.startsWith('us-federal:source:')) slice = 'federal_baseline';
    else if (curated.has(record.record_id)) slice = 'curated_authoritative_registry';
    else slice = 'canonical_base';
    return {
      member_key: { unit: 'published_record', namespace: 'retrieval-corpus:v1.1.0', value: record.record_id },
      slice,
      source_id: sourceId
    };
  }).sort((left, right) => compareText(left.member_key.value, right.member_key.value));
  assert(new Set(members.map(member => member.member_key.value)).size === 157, 'DUPLICATE_PUBLISHED_RECORD');

  const expected = {
    harvard_dataverse: 52,
    datacite: 50,
    pennsylvania_catalog: 22,
    curated_authoritative_registry: 15,
    federal_baseline: 14,
    canonical_base: 4
  };
  const composition = Object.entries(expected).map(([slice, expectedCount]) => {
    const count = members.filter(member => member.slice === slice).length;
    assert(count === expectedCount, `CORPUS_SLICE_COUNT_MISMATCH:${slice}:${count}`);
    return { slice, count, unit: 'published_record' };
  });

  const membershipPayload = {
    corpus_version: '1.1.0',
    unit: 'published_record',
    members
  };
  return {
    schema_version: 'ushso-corpus-positioning-manifest.v1.0.0',
    corpus_version: '1.1.0',
    corpus_manifest_sha256: '23f704ce3e421a6eb26c2b3677d616a1ae6b4f45226233257b9a1ff676caba2b',
    corpus_content_fingerprint_sha256: corpusManifest.content_fingerprint_sha256,
    unit: 'published_record',
    denominator_definition: 'Every record in the pinned retrieval corpus v1.1.0 records JSONL; this is not a canonical-asset or coverage-completeness denominator.',
    denominator_count: members.length,
    membership_manifest_hash: canonicalDigest('ushso:published-record-membership:v1\n', membershipPayload),
    composition,
    members,
    non_additivity: 'Published records overlap federal source scopes and jurisdiction applicability. Do not add this denominator to the 14-source, 51-jurisdiction, or 306-cell counts.'
  };
}

function metricById(snapshot, metricId) {
  const metric = snapshot.metrics.find(candidate => candidate.metric_id === metricId);
  assert(metric, `MISSING_METRIC:${metricId}`);
  return metric;
}

export function buildPublicCoverageView({
  snapshot,
  matrix,
  federalRegistry,
  jurisdictionRegistry,
  cellRegistry,
  corpusPositioning,
  publicCopy,
  readiness
}) {
  const stateDistribution = Object.fromEntries(CANONICAL_COVERAGE_CELL_STATES.map(state => [
    state,
    matrix.cells.filter(cell => cell.coverage_cell_state === state).length
  ]));
  const legacyDistribution = readiness.summary.overlay_readiness_status_counts;

  return {
    schema_version: 'ushso-public-coverage-view.v1.0.0',
    view_version: '1.0.0',
    coverage_snapshot_id: snapshot.coverage_snapshot_id,
    coverage_snapshot_digest: snapshot.immutability.canonical_digest,
    matrix_id: matrix.matrix_id,
    as_of: snapshot.as_of,
    revisions: structuredClone(snapshot.revision_pins),
    positioning: {
      headline: publicCopy.positioning,
      federal_backbone: publicCopy.federal_backbone,
      jurisdiction_boundary: publicCopy.jurisdiction_boundary,
      corpus_boundary: publicCopy.corpus_boundary,
      zero_result_boundary: publicCopy.zero_result_boundary,
      non_additivity: publicCopy.non_additivity,
      copy_version: publicCopy.copy_version,
      product_owner_review_status: publicCopy.approval_status,
      publication_authorized: publicCopy.publication_authorized
    },
    concepts: [
      {
        concept_id: 'federal-baseline-source-scopes',
        count: federalRegistry.source_count,
        unit: 'federal_source_scope',
        denominator_definition: 'The 14 metadata-only federal source records in the pinned national federal fixture.',
        additive_with_other_concepts: false
      },
      {
        concept_id: 'configured-jurisdictions',
        count: jurisdictionRegistry.configured_jurisdiction_count,
        unit: 'jurisdiction_label',
        denominator_definition: 'The 50 states and District of Columbia configured in the pinned readiness registry.',
        additive_with_other_concepts: false,
        accompanying_cell_distribution: stateDistribution
      },
      {
        concept_id: 'configured-assessment-cells',
        count: cellRegistry.configured_cell_count,
        unit: 'coverage_assessment_cell',
        denominator_definition: matrix.denominator.definition,
        additive_with_other_concepts: false,
        coverage_cell_state_distribution: stateDistribution
      },
      {
        concept_id: 'production-corpus-records',
        count: corpusPositioning.denominator_count,
        unit: 'published_record',
        denominator_definition: corpusPositioning.denominator_definition,
        additive_with_other_concepts: false,
        composition: corpusPositioning.composition
      }
    ],
    federal_applicability: {
      unit: 'federal_source_scope',
      denominator_count: 14,
      direct: federalRegistry.applicability.direct,
      crosswalk_required: federalRegistry.applicability.crosswalk_required,
      unknown: federalRegistry.applicability.unknown,
      note: 'Applicability mode does not assert payload access, row completeness, schema completeness, authorization, or research fitness.'
    },
    matrix_summary: {
      denominator_count: matrix.denominator.configured_cell_count,
      unit: matrix.denominator.unit,
      definition: matrix.denominator.definition,
      membership_manifest_hash: matrix.denominator.membership_manifest_hash,
      coverage_cell_state_distribution: stateDistribution,
      exactly_one_state_per_cell: true,
      absence_claim_permitted_cells: matrix.cells.filter(cell => cell.absence_claim_permitted).length
    },
    legacy_aggregate_readiness: {
      evidence_grain: 'jurisdiction_aggregate',
      canonical_for_source_class_matrix: false,
      promotion_to_cell_state: 'prohibited',
      published_state_overlays: readiness.summary.published_state_overlays,
      distribution: legacyDistribution,
      note: 'These repository-observed legacy labels remain visible for provenance but do not establish any jurisdiction/source-class cell state.'
    },
    panels: [
      {
        panel_id: 'source-operations',
        metric_ids: ['coverage.configured_scope_status/v1', 'coverage.harvest_completion/v1', 'coverage.failed/v1', 'coverage.overdue_not_started/v1']
      },
      {
        panel_id: 'native-inventory',
        metric_ids: ['coverage.discovered_inventory/v1']
      },
      {
        panel_id: 'revision-processing-funnel',
        metric_ids: ['coverage.revision_ingestion/v1', 'coverage.normalized_outcome/v1']
      },
      {
        panel_id: 'canonical-inventory',
        metric_ids: ['coverage.canonical_assets/v1', 'coverage.canonical_releases/v1', 'coverage.canonical_families/v1']
      },
      {
        panel_id: 'operational-health',
        metric_ids: [
          'coverage.schema_indexed/v1',
          'coverage.search_indexed/v1',
          'coverage.current_check_coverage/v1',
          'coverage.due_check_timeliness/v1',
          'coverage.check_pass/v1',
          'coverage.stale/v1',
          'coverage.excluded_native_items/v1',
          'coverage.excluded_canonical_assets/v1'
        ]
      }
    ].map(panel => ({
      ...panel,
      metrics: panel.metric_ids.map(metricId => metricById(snapshot, metricId))
    })),
    warnings: [
      'The WP9 seed imports registry and positioning evidence only; it does not reinterpret 157 published records as canonical assets.',
      'Zero denominators in unpopulated downstream fact cohorts are not absence claims and do not describe all public data.',
      'No legacy jurisdiction-level navigation or evidence-gap label was promoted to a source-class cell.',
      'Public wording remains pending product-owner review and is not authorized for production publication.'
    ]
  };
}

export function assertDenominatorInvariants(fixture) {
  const configured = fixture.configured_scope_states;
  const harvest = fixture.harvest_due_outcomes;
  const normalization = fixture.normalization_outcomes;
  const dueChecks = fixture.due_check_outcomes;
  const result = {
    configured_denominator: configured.length,
    configured_partition_total: ['active', 'paused', 'excluded', 'retired', 'unassessed']
      .reduce((sum, state) => sum + configured.filter(item => item === state).length, 0),
    harvest_due_denominator: harvest.length,
    harvest_complete_numerator: harvest.filter(item => item === 'complete').length,
    normalization_denominator: normalization.length,
    normalization_numerator: normalization.filter(item => item === 'normalized').length,
    due_check_denominator: dueChecks.length,
    due_check_attempted_numerator: dueChecks.filter(item => item !== 'pending').length
  };
  for (const [key, expected] of Object.entries(fixture.expected)) {
    assert(result[key] === expected, `DENOMINATOR_INVARIANT_MISMATCH:${key}:${result[key]}:${expected}`);
  }
  assert(harvest.includes('failed') && result.harvest_due_denominator === harvest.length, 'HARVEST_FAILURE_LAUNDERED');
  assert(dueChecks.includes('failed') && result.due_check_denominator === dueChecks.length, 'DUE_CHECK_FAILURE_LAUNDERED');
  assert(configured.includes('paused') && configured.includes('excluded'), 'CONFIGURED_SCOPE_STATE_LAUNDERED');
  assert(new Set(normalization).size === 6, 'NORMALIZATION_PARTITION_NOT_EXHAUSTIVE');
  return result;
}

export function assessAbsenceClaim({ denominatorStatus, enumerationStatus, sealed, unknownCount = 0, unclassifiedCount = 0 }) {
  if (denominatorStatus !== 'known') return { permitted: false, reason: 'denominator_unknown' };
  if (enumerationStatus !== 'complete' || !sealed) return { permitted: false, reason: 'enumeration_incomplete' };
  if (unknownCount > 0) return { permitted: false, reason: 'unknown_membership' };
  if (unclassifiedCount > 0) return { permitted: false, reason: 'evidence_insufficient' };
  return { permitted: true, reason: null };
}
