import { ZERO_SHA256 } from './common.mjs';

const IDS = Object.freeze({
  organization: 'urn:ushso:organization:cms',
  source: 'urn:ushso:source:data-cms-gov',
  assetFacilities: 'urn:ushso:asset:facility-directory',
  assetUtilization: 'urn:ushso:asset:facility-utilization',
  releaseFacilities: 'urn:ushso:release:facility-directory-2025',
  releaseUtilization: 'urn:ushso:release:facility-utilization-2025',
  distributionFacilities: 'urn:ushso:distribution:facility-directory-2025-csv',
  distributionUtilization: 'urn:ushso:distribution:facility-utilization-2025-csv',
  documentation: 'urn:ushso:documentation:facility-schema-guide-2025',
  schemaFacilities: 'urn:ushso:schema:facility-directory-2025',
  schemaUtilization: 'urn:ushso:schema:facility-utilization-2025',
  fieldFacilitiesCcn: 'urn:ushso:field:facility-directory-2025-ccn',
  fieldUtilizationCcn: 'urn:ushso:field:facility-utilization-2025-ccn',
  routeFacilities: 'urn:ushso:access-route:facility-directory-public',
  routeUtilization: 'urn:ushso:access-route:facility-utilization-application',
  observationFacilities: 'urn:ushso:access-observation:facility-directory-2026-01',
  observationUtilization: 'urn:ushso:access-observation:facility-utilization-2026-01',
  assertionCoverage: 'urn:ushso:assertion:facility-directory-coverage',
  relationshipIdentity: 'urn:ushso:relationship:asset-identity-candidate',
  relationshipFamily: 'urn:ushso:relationship:asset-family-member',
  relationshipJoin: 'urn:ushso:relationship:ccn-join-candidate',
  relationshipPublisher: 'urn:ushso:relationship:asset-publisher',
  evidenceCatalog: 'urn:ushso:evidence:catalog-metadata-2026-01',
  evidenceIdentifier: 'urn:ushso:evidence:identifier-policy-2026-01',
  evidenceDocumentation: 'urn:ushso:evidence:schema-guide-2026-01',
  evidenceSchemaFacilities: 'urn:ushso:evidence:facility-schema-2026-01',
  evidenceSchemaUtilization: 'urn:ushso:evidence:utilization-schema-2026-01',
  evidenceAccessPublic: 'urn:ushso:evidence:public-access-page-2026-01',
  evidenceAccessRestricted: 'urn:ushso:evidence:application-guide-2026-01'
});

const RUN_ID = 'urn:ushso:run:fixture-core-v2';
const FIRST = '2026-01-15T12:00:00Z';
const OBSERVED = '2026-01-15T12:30:00Z';
const RECORDED = '2026-01-15T12:35:00Z';
const RELEASED = '2026-01-10T00:00:00Z';

function clocks(overrides = {}) {
  return {
    first_seen_at: FIRST,
    observed_at: OBSERVED,
    recorded_at: RECORDED,
    publisher_released_at: RELEASED,
    publisher_modified_at: RELEASED,
    superseded_at: null,
    ...overrides
  };
}

function history(overrides = {}) {
  return {
    append_only: true,
    supersedes_revision_ids: [],
    superseded_by_revision_id: null,
    rationale: null,
    ...overrides
  };
}

function evidenceRef(evidenceId, claimPaths, options = {}) {
  return {
    evidence_id: evidenceId,
    claim_paths: claimPaths,
    observed_at: options.observed_at ?? OBSERVED,
    evidence_state: options.evidence_state ?? 'documented',
    staleness_state: options.staleness_state ?? 'current',
    derivation_lineage: options.derivation_lineage ?? [evidenceId],
    review_status: options.review_status ?? 'not_required',
    reviewed_at: options.reviewed_at ?? null
  };
}

function nativeIdentifier(sourceId, namespace, value, entityScope, evidenceId, options = {}) {
  return {
    source_id: sourceId,
    namespace,
    value,
    normalized_value: options.normalized_value ?? value,
    case_behavior: options.case_behavior ?? 'sensitive',
    preservation: 'exact',
    entity_scope: entityScope,
    authority: options.authority ?? 'source_native',
    uniqueness_policy: options.uniqueness_policy ?? 'source_scoped',
    effective_from: options.effective_from ?? null,
    effective_to: options.effective_to ?? null,
    evidence_ids: [evidenceId]
  };
}

function base(entityType, entityId, revisionSuffix, evidenceRefs, overrides = {}) {
  return {
    contract_version: 'observatory-core.v2.0.0',
    entity_type: entityType,
    entity_id: entityId,
    revision_id: `urn:ushso:revision:${revisionSuffix}`,
    schema_version: '2.0.0',
    lifecycle_state: 'active',
    canonical_content_fingerprint: ZERO_SHA256,
    native_identifiers: [],
    legacy_aliases: [],
    clocks: clocks(),
    coverage_intervals: [],
    evidence_refs: evidenceRefs,
    assertion_refs: [],
    lineage: {
      connector_run_id: RUN_ID,
      normalizer: { name: 'core-fixture-normalizer', version: '2.0.0' },
      import_id: null,
      derivation_parent_ids: []
    },
    history: history(),
    ...overrides
  };
}

function evidence(evidenceId, revisionSuffix, evidenceClass, locator, description, digestSeed) {
  return base('Evidence', evidenceId, revisionSuffix, [], {
    evidence_id: evidenceId,
    source_id: IDS.source,
    evidence_class: evidenceClass,
    locator,
    captured_content_digest: `sha256:${digestSeed.repeat(64)}`,
    media_type: 'application/json',
    availability_state: 'available',
    description,
    payload_included: false
  });
}

const calendar2025 = Object.freeze({
  start: '2025-01-01',
  end: '2025-12-31',
  period_basis: 'calendar',
  fiscal_year_end_month: null,
  precision: 'day',
  status: 'known'
});

export function fixtureBundleTemplate() {
  const organizations = [base('Organization', IDS.organization, 'organization-cms-r1', [evidenceRef(IDS.evidenceCatalog, ['/display_name', '/organization_roles'])], {
    organization_id: IDS.organization,
    display_name: 'Centers for Medicare & Medicaid Services',
    organization_roles: ['publisher', 'regulator'],
    jurisdiction_codes: ['US'],
    identity_resolution_state: 'source_scoped',
    native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.organization', 'cms', 'organization', IDS.evidenceIdentifier)]
  })];

  const sources = [base('Source', IDS.source, 'source-data-cms-r1', [evidenceRef(IDS.evidenceCatalog, ['/name', '/canonical_locator', '/authority_level'])], {
    source_id: IDS.source,
    name: 'Data.CMS.gov',
    operator_organization_id: IDS.organization,
    source_kind: 'catalog',
    authority_level: 'authoritative',
    canonical_locator: 'https://data.cms.gov/',
    harvestable: true,
    native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.source', 'data.cms.gov', 'source', IDS.evidenceIdentifier)]
  })];

  const assets = [
    base('Asset', IDS.assetFacilities, 'asset-facility-directory-r1', [evidenceRef(IDS.evidenceCatalog, ['/title', '/summary', '/asset_kind'])], {
      asset_id: IDS.assetFacilities,
      source_id: IDS.source,
      responsible_organization_id: IDS.organization,
      title: 'Synthetic Facility Directory Fixture',
      asset_kind: 'dataset',
      summary: 'Metadata-only fixture for a facility directory; it contains no healthcare rows.',
      identity_resolution_state: 'source_scoped',
      family_resolution_state: 'accepted',
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.asset', 'fixture-facility-directory', 'asset', IDS.evidenceCatalog)]
    }),
    base('Asset', IDS.assetUtilization, 'asset-facility-utilization-r1', [evidenceRef(IDS.evidenceCatalog, ['/title', '/summary', '/asset_kind'])], {
      asset_id: IDS.assetUtilization,
      source_id: IDS.source,
      responsible_organization_id: IDS.organization,
      title: 'Synthetic Facility Utilization Metadata Fixture',
      asset_kind: 'dataset',
      summary: 'Metadata-only fixture describing a related restricted product; no values or measures are included.',
      identity_resolution_state: 'review_pending',
      family_resolution_state: 'accepted',
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.asset', 'fixture-facility-utilization', 'asset', IDS.evidenceCatalog)]
    })
  ];

  const releases = [
    base('Release', IDS.releaseFacilities, 'release-facility-directory-2025-r1', [evidenceRef(IDS.evidenceCatalog, ['/release_label', '/coverage_intervals'])], {
      release_id: IDS.releaseFacilities,
      asset_id: IDS.assetFacilities,
      release_label: '2025 fixture edition',
      release_kind: 'edition',
      publisher_version: '2025',
      cadence: 'annual',
      immutable: true,
      coverage_intervals: [calendar2025],
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.release', 'fixture-facility-directory-2025', 'release', IDS.evidenceCatalog)]
    }),
    base('Release', IDS.releaseUtilization, 'release-facility-utilization-2025-r1', [evidenceRef(IDS.evidenceCatalog, ['/release_label', '/coverage_intervals'])], {
      release_id: IDS.releaseUtilization,
      asset_id: IDS.assetUtilization,
      release_label: '2025 fixture edition',
      release_kind: 'edition',
      publisher_version: '2025',
      cadence: 'annual',
      immutable: true,
      coverage_intervals: [calendar2025],
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.release', 'fixture-facility-utilization-2025', 'release', IDS.evidenceCatalog)]
    })
  ];

  const distributions = [
    base('Distribution', IDS.distributionFacilities, 'distribution-facility-directory-r1', [evidenceRef(IDS.evidenceCatalog, ['/title', '/format', '/machine_readiness'])], {
      distribution_id: IDS.distributionFacilities,
      release_id: IDS.releaseFacilities,
      title: 'Facility directory CSV representation',
      distribution_kind: 'download',
      format: 'CSV',
      media_type: 'text/csv',
      access_route_ids: [IDS.routeFacilities],
      machine_readiness: {
        label: 'schema_indexed',
        human_readable: 'yes',
        direct_download: 'yes',
        documented_api: 'no',
        indexed_schema: 'yes',
        verified_recipe: 'unknown',
        join_guidance: 'unknown',
        evidence_ids: [IDS.evidenceCatalog, IDS.evidenceSchemaFacilities],
        observed_at: OBSERVED
      },
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.distribution', 'fixture-facility-directory-2025-csv', 'distribution', IDS.evidenceCatalog)]
    }),
    base('Distribution', IDS.distributionUtilization, 'distribution-facility-utilization-r1', [evidenceRef(IDS.evidenceCatalog, ['/title', '/format', '/machine_readiness'])], {
      distribution_id: IDS.distributionUtilization,
      release_id: IDS.releaseUtilization,
      title: 'Facility utilization CSV representation',
      distribution_kind: 'download',
      format: 'CSV',
      media_type: 'text/csv',
      access_route_ids: [IDS.routeUtilization],
      machine_readiness: {
        label: 'schema_indexed',
        human_readable: 'yes',
        direct_download: 'unknown',
        documented_api: 'no',
        indexed_schema: 'yes',
        verified_recipe: 'unknown',
        join_guidance: 'unknown',
        evidence_ids: [IDS.evidenceCatalog, IDS.evidenceSchemaUtilization],
        observed_at: OBSERVED
      },
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.distribution', 'fixture-facility-utilization-2025-csv', 'distribution', IDS.evidenceCatalog)]
    })
  ];

  const documentation = [base('Documentation', IDS.documentation, 'documentation-facility-schema-guide-r1', [evidenceRef(IDS.evidenceDocumentation, ['/title', '/locator', '/documentation_type'])], {
    documentation_id: IDS.documentation,
    subject_id: IDS.distributionFacilities,
    documentation_type: 'schema',
    title: 'Synthetic facility schema guide',
    locator: 'https://data.cms.gov/example/schema-guide',
    native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.documentation', 'fixture-schema-guide', 'documentation', IDS.evidenceDocumentation)]
  })];

  const schemaSnapshots = [
    base('SchemaSnapshot', IDS.schemaFacilities, 'schema-facility-directory-r1', [evidenceRef(IDS.evidenceSchemaFacilities, ['/schema_digest', '/field_ids'])], {
      schema_snapshot_id: IDS.schemaFacilities,
      release_id: IDS.releaseFacilities,
      distribution_id: IDS.distributionFacilities,
      schema_digest: `sha256:${'1'.repeat(64)}`,
      field_ids: [IDS.fieldFacilitiesCcn],
      immutable: true,
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.schema', 'fixture-facility-directory-schema-2025', 'schema', IDS.evidenceSchemaFacilities)]
    }),
    base('SchemaSnapshot', IDS.schemaUtilization, 'schema-facility-utilization-r1', [evidenceRef(IDS.evidenceSchemaUtilization, ['/schema_digest', '/field_ids'])], {
      schema_snapshot_id: IDS.schemaUtilization,
      release_id: IDS.releaseUtilization,
      distribution_id: IDS.distributionUtilization,
      schema_digest: `sha256:${'2'.repeat(64)}`,
      field_ids: [IDS.fieldUtilizationCcn],
      immutable: true,
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.schema', 'fixture-facility-utilization-schema-2025', 'schema', IDS.evidenceSchemaUtilization)]
    })
  ];

  const schemaFields = [
    base('SchemaField', IDS.fieldFacilitiesCcn, 'field-facility-directory-ccn-r1', [evidenceRef(IDS.evidenceSchemaFacilities, ['/source_name', '/identifier_namespace', '/field_role'])], {
      schema_field_id: IDS.fieldFacilitiesCcn,
      schema_snapshot_id: IDS.schemaFacilities,
      source_name: 'CCN',
      ordinal: 0,
      source_data_type: 'string',
      description: 'Source-described facility certification identifier field.',
      identifier_namespace: 'cms.ccn',
      field_role: 'identifier',
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.field', 'fixture-facility-directory-schema-2025/CCN', 'field', IDS.evidenceSchemaFacilities)]
    }),
    base('SchemaField', IDS.fieldUtilizationCcn, 'field-facility-utilization-ccn-r1', [evidenceRef(IDS.evidenceSchemaUtilization, ['/source_name', '/identifier_namespace', '/field_role'])], {
      schema_field_id: IDS.fieldUtilizationCcn,
      schema_snapshot_id: IDS.schemaUtilization,
      source_name: 'FACILITY_CCN',
      ordinal: 0,
      source_data_type: 'string',
      description: 'Source-described facility certification identifier field.',
      identifier_namespace: 'cms.ccn',
      field_role: 'identifier',
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.field', 'fixture-facility-utilization-schema-2025/FACILITY_CCN', 'field', IDS.evidenceSchemaUtilization)]
    })
  ];

  const accessRoutes = [
    base('AccessRoute', IDS.routeFacilities, 'access-route-facility-directory-r1', [evidenceRef(IDS.evidenceAccessPublic, ['/access_class', '/locator', '/requirements'])], {
      access_route_id: IDS.routeFacilities,
      distribution_id: IDS.distributionFacilities,
      route_kind: 'download',
      access_class: 'public',
      locator: 'https://data.cms.gov/example/facility-directory',
      human_authorization_gate: false,
      requirements: [],
      stop_conditions: ['Stop if the maintained source no longer identifies this exact release.'],
      execution_state: 'not_executed',
      access_workflow_submitted: false,
      payloads_acquired: false,
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.access-route', 'fixture-facility-directory-public', 'access_route', IDS.evidenceAccessPublic)]
    }),
    base('AccessRoute', IDS.routeUtilization, 'access-route-facility-utilization-r1', [evidenceRef(IDS.evidenceAccessRestricted, ['/access_class', '/human_authorization_gate', '/requirements'])], {
      access_route_id: IDS.routeUtilization,
      distribution_id: IDS.distributionUtilization,
      route_kind: 'application',
      access_class: 'application',
      locator: 'https://data.cms.gov/example/application-guide',
      human_authorization_gate: true,
      requirements: [{
        kind: 'application',
        description: 'An external researcher must submit the publisher-described application.',
        satisfaction_state: 'unsatisfied',
        human_gate: true,
        evidence_ids: [IDS.evidenceAccessRestricted]
      }],
      stop_conditions: ['Stop if eligibility or required institutional approval is unresolved.'],
      execution_state: 'not_executed',
      access_workflow_submitted: false,
      payloads_acquired: false,
      native_identifiers: [nativeIdentifier(IDS.source, 'data.cms.gov.access-route', 'fixture-facility-utilization-application', 'access_route', IDS.evidenceAccessRestricted)]
    })
  ];

  const accessObservations = [
    base('AccessObservation', IDS.observationFacilities, 'access-observation-facility-directory-r1', [evidenceRef(IDS.evidenceAccessPublic, ['/catalog_visibility_state', '/payload_access_state', '/check_method'])], {
      observation_id: IDS.observationFacilities,
      access_route_id: IDS.routeFacilities,
      catalog_visibility_state: 'visible',
      payload_access_state: 'not_tested',
      authorization_state: 'not_required',
      infrastructure_state: 'not_tested',
      requirement_state: 'none',
      freshness_state: 'current',
      stale_at: '2026-02-15T12:30:00Z',
      check_method: 'offline_fixture',
      access_workflow_submitted: false,
      payloads_acquired: false,
      raw_payload_stored: false
    }),
    base('AccessObservation', IDS.observationUtilization, 'access-observation-facility-utilization-r1', [evidenceRef(IDS.evidenceAccessRestricted, ['/catalog_visibility_state', '/payload_access_state', '/authorization_state'])], {
      observation_id: IDS.observationUtilization,
      access_route_id: IDS.routeUtilization,
      catalog_visibility_state: 'visible',
      payload_access_state: 'restricted',
      authorization_state: 'required',
      infrastructure_state: 'authentication_required',
      requirement_state: 'documented',
      freshness_state: 'current',
      stale_at: '2026-02-15T12:30:00Z',
      check_method: 'metadata_review',
      access_workflow_submitted: false,
      payloads_acquired: false,
      raw_payload_stored: false
    })
  ];

  const evidenceRows = [
    evidence(IDS.evidenceCatalog, 'evidence-catalog-r1', 'catalog_record', 'https://data.cms.gov/example/catalog-record', 'Synthetic catalog metadata locator only.', '3'),
    evidence(IDS.evidenceIdentifier, 'evidence-identifier-r1', 'authoritative_identifier', 'https://data.cms.gov/example/identifier-policy', 'Synthetic source identifier policy metadata.', '4'),
    evidence(IDS.evidenceDocumentation, 'evidence-documentation-r1', 'documentation', 'https://data.cms.gov/example/schema-guide', 'Synthetic schema documentation metadata.', '5'),
    evidence(IDS.evidenceSchemaFacilities, 'evidence-schema-facilities-r1', 'schema_observation', 'https://data.cms.gov/example/facility-schema', 'Synthetic facility schema observation metadata.', '6'),
    evidence(IDS.evidenceSchemaUtilization, 'evidence-schema-utilization-r1', 'schema_observation', 'https://data.cms.gov/example/utilization-schema', 'Synthetic utilization schema observation metadata.', '7'),
    evidence(IDS.evidenceAccessPublic, 'evidence-access-public-r1', 'documentation', 'https://data.cms.gov/example/facility-directory', 'Synthetic public access documentation metadata; access was not executed.', '8'),
    evidence(IDS.evidenceAccessRestricted, 'evidence-access-restricted-r1', 'documentation', 'https://data.cms.gov/example/application-guide', 'Synthetic application documentation metadata; no application was submitted.', '9')
  ];

  const oldAssertionRevision = base('Assertion', IDS.assertionCoverage, 'assertion-facility-coverage-r1', [evidenceRef(IDS.evidenceCatalog, ['/claim_value', '/effective_to'])], {
    assertion_id: IDS.assertionCoverage,
    subject_id: IDS.releaseFacilities,
    predicate: 'coverage.calendar_year',
    claim_value: { kind: 'integer', value: 2024 },
    claim_class: 'coverage',
    epistemic_state: 'documented',
    effective_from: '2025-01-10T00:00:00Z',
    effective_to: '2026-01-10T00:00:00Z',
    lifecycle_state: 'superseded',
    clocks: clocks({
      first_seen_at: '2025-01-15T12:00:00Z',
      observed_at: '2025-01-15T12:30:00Z',
      recorded_at: '2025-01-15T12:35:00Z',
      publisher_released_at: '2025-01-10T00:00:00Z',
      publisher_modified_at: '2025-01-10T00:00:00Z',
      superseded_at: '2026-01-15T12:35:00Z'
    }),
    history: history({
      superseded_by_revision_id: 'urn:ushso:revision:assertion-facility-coverage-r2',
      rationale: 'Publisher metadata advanced to the next documented coverage year.'
    })
  });
  const currentAssertionRevision = base('Assertion', IDS.assertionCoverage, 'assertion-facility-coverage-r2', [evidenceRef(IDS.evidenceCatalog, ['/claim_value', '/effective_from'])], {
    assertion_id: IDS.assertionCoverage,
    subject_id: IDS.releaseFacilities,
    predicate: 'coverage.calendar_year',
    claim_value: { kind: 'integer', value: 2025 },
    claim_class: 'coverage',
    epistemic_state: 'documented',
    effective_from: '2026-01-10T00:00:00Z',
    effective_to: null,
    clocks: clocks({ first_seen_at: '2025-01-15T12:00:00Z' }),
    history: history({
      supersedes_revision_ids: ['urn:ushso:revision:assertion-facility-coverage-r1'],
      rationale: 'Publisher metadata advanced to the next documented coverage year.'
    })
  });

  const relationships = [
    base('Relationship', IDS.relationshipIdentity, 'relationship-identity-candidate-r1', [evidenceRef(IDS.evidenceCatalog, ['/relationship_kind', '/identity_semantics'], { evidence_state: 'candidate' })], {
      relationship_id: IDS.relationshipIdentity,
      subject_id: IDS.assetFacilities,
      object_id: IDS.assetUtilization,
      relationship_domain: 'identity',
      relationship_kind: 'same_identity_candidate',
      match_score_micros: 620000,
      epistemic_confidence: 'low',
      identity_semantics: {
        state: 'candidate',
        resolution_basis: 'algorithmic_candidate',
        auto_resolved: false,
        authoritative_namespace: null,
        effective_overlap: null,
        conflicting_identifier: false
      },
      family_semantics: null,
      join_semantics: null,
      lifecycle_state: 'pending_review'
    }),
    base('Relationship', IDS.relationshipFamily, 'relationship-family-member-r1', [evidenceRef(IDS.evidenceDocumentation, ['/relationship_kind', '/family_semantics'])], {
      relationship_id: IDS.relationshipFamily,
      subject_id: IDS.assetUtilization,
      object_id: IDS.assetFacilities,
      relationship_domain: 'family',
      relationship_kind: 'family_member',
      match_score_micros: null,
      epistemic_confidence: 'high',
      identity_semantics: null,
      family_semantics: { family_kind: 'collection', state: 'accepted', identity_equality: false },
      join_semantics: null
    }),
    base('Relationship', IDS.relationshipJoin, 'relationship-join-candidate-r1', [evidenceRef(IDS.evidenceSchemaFacilities, ['/relationship_kind', '/join_semantics'], { evidence_state: 'candidate' }), evidenceRef(IDS.evidenceSchemaUtilization, ['/join_semantics'], { evidence_state: 'candidate' })], {
      relationship_id: IDS.relationshipJoin,
      subject_id: IDS.fieldFacilitiesCcn,
      object_id: IDS.fieldUtilizationCcn,
      relationship_domain: 'join',
      relationship_kind: 'join_route',
      match_score_micros: 700000,
      epistemic_confidence: 'moderate',
      identity_semantics: null,
      family_semantics: null,
      join_semantics: {
        operation_kind: 'crosswalk',
        source_field_id: IDS.fieldFacilitiesCcn,
        target_field_id: IDS.fieldUtilizationCcn,
        source_grain: 'Medicare-certified facility',
        target_grain: 'reporting facility record',
        identifier_namespace: 'cms.ccn',
        direction: 'unidirectional',
        cardinality: 'unknown',
        lossiness: 'unknown',
        evidence_state: 'candidate',
        compatibility: 'conditional',
        requirements: [{
          kind: 'crosswalk',
          description: 'A time-valid authoritative crosswalk is required before recommending this route.',
          satisfaction_state: 'unsatisfied',
          human_gate: false,
          evidence_ids: [IDS.evidenceSchemaFacilities, IDS.evidenceSchemaUtilization]
        }],
        blockers: [{
          code: 'AUTHORITATIVE_CROSSWALK_MISSING',
          description: 'Matching field labels alone do not establish a valid join.',
          resolution_state: 'open',
          evidence_ids: [IDS.evidenceSchemaFacilities, IDS.evidenceSchemaUtilization]
        }]
      }
    }),
    base('Relationship', IDS.relationshipPublisher, 'relationship-asset-publisher-r1', [evidenceRef(IDS.evidenceCatalog, ['/relationship_kind', '/subject_id', '/object_id'])], {
      relationship_id: IDS.relationshipPublisher,
      subject_id: IDS.assetFacilities,
      object_id: IDS.organization,
      relationship_domain: 'provenance',
      relationship_kind: 'published_by',
      match_score_micros: null,
      epistemic_confidence: 'high',
      identity_semantics: null,
      family_semantics: null,
      join_semantics: null
    })
  ];

  return {
    bundle_version: 'observatory-core-fixture-bundle.v2.0.0',
    organizations,
    sources,
    assets,
    releases,
    distributions,
    documentation,
    schema_snapshots: schemaSnapshots,
    schema_fields: schemaFields,
    access_routes: accessRoutes,
    access_observations: accessObservations,
    evidence: evidenceRows,
    assertions: [oldAssertionRevision, currentAssertionRevision],
    relationships
  };
}

export { IDS };
