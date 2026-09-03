import { canonicalSha256 } from '../../../../contracts/tooling/v1.0.0/src/digests.mjs';
import {
  digest,
  membershipMaterial,
} from '../../../../contracts/publication/v1.0.0/tools/common.mjs';
import {
  SEARCH_PROJECTION_TYPES,
  buildProjectionGeneration,
  sealProjectionGeneration,
} from '../../../../packages/search/projection-v2.mjs';

const PROJECTED_AT = '2026-08-30T22:00:00.000Z';
const RETAINED_UNTIL = '2026-10-01T00:00:00.000Z';

function sha(character) {
  return character.repeat(64);
}

function truthRefs(suffix) {
  return {
    evidence: [`evidence:${suffix}`],
    assertions: [`assertion:${suffix}`],
    access_observations: [`access-observation:${suffix}`],
    documentation: [`documentation:${suffix}`],
    relationships: [`relationship:${suffix}`],
  };
}

const members = [
  {
    object_type: 'asset',
    canonical_id: 'asset:pa-hospital-finance',
    revision_id: 'revision:asset:pa-hospital-finance:v1',
    revision_sha256: sha('1'),
    visibility_state: 'public',
    projection_obligations: ['asset_search', 'coverage', 'seo'],
  },
  {
    object_type: 'asset',
    canonical_id: 'asset:pa-hospital-finance-candidate',
    revision_id: 'revision:asset:pa-hospital-finance-candidate:v1',
    revision_sha256: sha('7'),
    visibility_state: 'public',
    projection_obligations: ['asset_search'],
  },
  {
    object_type: 'asset',
    canonical_id: 'asset:quarantined-fixture',
    revision_id: 'revision:asset:quarantined-fixture:v1',
    revision_sha256: sha('2'),
    visibility_state: 'quarantined',
    projection_obligations: ['asset_search'],
  },
  {
    object_type: 'distribution',
    canonical_id: 'distribution:pa-hospital-finance:csv',
    revision_id: 'revision:distribution:pa-hospital-finance:csv:v1',
    revision_sha256: sha('3'),
    visibility_state: 'public',
    projection_obligations: ['release_distribution_search'],
  },
  {
    object_type: 'field',
    canonical_id: 'field:pa-hospital-finance:facility-id',
    revision_id: 'revision:field:pa-hospital-finance:facility-id:v1',
    revision_sha256: sha('4'),
    visibility_state: 'public',
    projection_obligations: ['schema_field_search'],
  },
  {
    object_type: 'relationship',
    canonical_id: 'relationship:pa-facility-id-to-ccn',
    revision_id: 'revision:relationship:pa-facility-id-to-ccn:v1',
    revision_sha256: sha('5'),
    visibility_state: 'public',
    projection_obligations: ['join_edge_search'],
  },
  {
    object_type: 'source',
    canonical_id: 'source:pa-open-data',
    revision_id: 'revision:source:pa-open-data:v1',
    revision_sha256: sha('6'),
    visibility_state: 'public',
    projection_obligations: ['source_search'],
  },
].sort((left, right) => left.canonical_id < right.canonical_id ? -1 : 1);

export function createCanonicalManifest() {
  const manifest = {
    manifest_version: 'canonical-revision-membership.v1',
    manifest_id: 'canonical-manifest:wp8-fixture:w1',
    selection_model: 'exact_immutable_revision_membership',
    canonical_as_of: '2026-08-30T21:55:00.000Z',
    sealed_at: '2026-08-30T21:56:00.000Z',
    member_order: 'canonical_id_then_revision_id_unicode_ascending',
    revision_count: members.length,
    projection_obligation_count: members.reduce((sum, member) => sum + member.projection_obligations.length, 0),
    members: structuredClone(members),
    membership_digest: null,
    immutable: true,
  };
  manifest.membership_digest = digest('canonical_revision_membership', membershipMaterial(manifest));
  return manifest;
}

export function createProjectionRecords() {
  return [
    {
      canonical_id: 'asset:pa-hospital-finance',
      revision_id: 'revision:asset:pa-hospital-finance:v1',
      document_id: 'document:asset:pa-hospital-finance',
      document_type: 'asset_search',
      projection_input_refs: ['asset:pa-hospital-finance', 'source:pa-open-data'],
      truth_refs: truthRefs('asset-pa-hospital-finance'),
      content: {
        asset_id: 'asset:pa-hospital-finance',
        title: 'Pennsylvania hospital financial reports',
        titles: ['Pennsylvania hospital financial reports'],
        aliases: ['PA hospital finance'],
        abbreviations: ['PHC4'],
        description: 'Public metadata describing hospital financial report releases.',
        publisher: { organization_id: 'organization:phc4', title: 'Pennsylvania Health Care Cost Containment Council' },
        source: { source_id: 'source:pa-open-data', title: 'Pennsylvania Open Data' },
        authority_tier: 'first_party',
        native_ids: [{ namespace: 'pa-open-data-dataset', value: 'hospital-finance' }],
        subjects: ['finance', 'hospitals'],
        constructs: ['hospital financial reporting'],
        use_cases: ['source discovery'],
        researcher_roles: ['financial context source'],
        geographies: ['US-PA'],
        unit_grain: { entity: 'facility', temporal: 'fiscal_year' },
        population: 'Pennsylvania hospitals represented by the published source scope.',
        temporal_envelope: { start: '2024-01-01', end: '2024-12-31', basis: 'fiscal_year' },
        access_summary: { access_class: 'public_download', execution_performed: false },
        freshness_summary: { state: 'observed', observed_at: '2026-08-30T00:00:00Z' },
        family_state: 'accepted_exact_policy_cluster',
        identity_resolution_state: 'accepted',
        schema_concepts: ['facility identifier', 'reporting period'],
        identifier_namespaces: ['ccn'],
        use_card_summary: { fitness: 'metadata-discovery-only', source_of_truth: false },
      },
    },
    {
      canonical_id: 'asset:quarantined-fixture',
      revision_id: 'revision:asset:quarantined-fixture:v1',
      exclusion_evidence_refs: ['evidence:quarantine-decision'],
    },
    {
      canonical_id: 'asset:pa-hospital-finance-candidate',
      revision_id: 'revision:asset:pa-hospital-finance-candidate:v1',
      document_id: 'document:asset:pa-hospital-finance-candidate',
      document_type: 'asset_search',
      projection_input_refs: ['asset:pa-hospital-finance-candidate', 'source:pa-open-data'],
      truth_refs: truthRefs('asset-pa-hospital-finance-candidate'),
      content: {
        asset_id: 'asset:pa-hospital-finance-candidate',
        title: 'Pennsylvania hospital financial reports candidate identity',
        publisher: { organization_id: 'organization:phc4', title: 'Pennsylvania Health Care Cost Containment Council' },
        source: { source_id: 'source:pa-open-data', title: 'Pennsylvania Open Data' },
        authority_tier: 'first_party',
        native_ids: [{ namespace: 'pa-open-data-dataset', value: 'hospital-finance-candidate' }],
        subjects: ['finance', 'hospitals'],
        geographies: ['US-PA'],
        unit_grain: { entity: 'facility', temporal: 'fiscal_year' },
        family_state: 'candidate_unresolved',
        identity_resolution_state: 'open_candidate',
        identifier_namespaces: ['ccn'],
        use_card_summary: { fitness: 'metadata-discovery-only', source_of_truth: false },
      },
    },
    {
      canonical_id: 'distribution:pa-hospital-finance:csv',
      revision_id: 'revision:distribution:pa-hospital-finance:csv:v1',
      document_id: 'document:distribution:pa-hospital-finance:csv',
      document_type: 'release_distribution_search',
      projection_input_refs: ['asset:pa-hospital-finance', 'distribution:pa-hospital-finance:csv'],
      truth_refs: truthRefs('distribution-pa-hospital-finance'),
      content: {
        asset_id: 'asset:pa-hospital-finance',
        release_id: 'release:pa-hospital-finance:2024',
        distribution_id: 'distribution:pa-hospital-finance:csv',
        time_coverage: { start: '2024-01-01', end: '2024-12-31', basis: 'fiscal_year' },
        release_date: '2025-07-01',
        format: 'text/csv',
        interface: 'download',
        access_route_ids: ['access-route:pa-hospital-finance:csv'],
        current_access_observation_id: 'access-observation:distribution-pa-hospital-finance',
        documentation_ids: ['documentation:distribution-pa-hospital-finance'],
        schema_snapshot_id: 'schema-snapshot:pa-hospital-finance:2024',
        freshness_policy: { policy_version: '1.0.0', state: 'observed' },
        title: '2024 Pennsylvania hospital financial report CSV',
        description: 'Metadata for the public CSV distribution.',
        geographies: ['US-PA'],
        unit_grain: { entity: 'facility', temporal: 'fiscal_year' },
        identifier_namespaces: ['ccn'],
      },
    },
    {
      canonical_id: 'field:pa-hospital-finance:facility-id',
      revision_id: 'revision:field:pa-hospital-finance:facility-id:v1',
      document_id: 'document:field:pa-hospital-finance:facility-id',
      document_type: 'schema_field_search',
      projection_input_refs: ['field:pa-hospital-finance:facility-id', 'schema-snapshot:pa-hospital-finance:2024'],
      truth_refs: truthRefs('field-pa-hospital-finance'),
      content: {
        field_id: 'field:pa-hospital-finance:facility-id',
        native_name: 'facility_id',
        label: 'Facility identifier',
        description: 'Source-native facility identifier documented by the pinned schema.',
        aliases: ['provider number'],
        data_type: 'text',
        unit: null,
        code_system: 'source_native',
        entity_grain: 'facility',
        semantic_roles: ['identifier'],
        identifier_namespace: 'pa_facility_id',
        schema_snapshot_id: 'schema-snapshot:pa-hospital-finance:2024',
        release_id: 'release:pa-hospital-finance:2024',
        distribution_id: 'distribution:pa-hospital-finance:csv',
        asset_id: 'asset:pa-hospital-finance',
      },
    },
    {
      canonical_id: 'relationship:pa-facility-id-to-ccn',
      revision_id: 'revision:relationship:pa-facility-id-to-ccn:v1',
      document_id: 'document:join:pa-facility-id-to-ccn',
      document_type: 'join_edge_search',
      projection_input_refs: ['field:pa-hospital-finance:facility-id', 'relationship:pa-facility-id-to-ccn'],
      truth_refs: truthRefs('join-pa-facility-id-to-ccn'),
      content: {
        join_edge_id: 'relationship:pa-facility-id-to-ccn',
        left_field_ref: 'field:pa-hospital-finance:facility-id',
        right_field_ref: 'field:cms-provider:ccn',
        left_namespace: 'pa_facility_id',
        right_namespace: 'ccn',
        normalization: { kind: 'documented_crosswalk', execution_performed: false },
        cardinality: 'many_to_one',
        applicability: { start: '2024-01-01', end: '2024-12-31' },
        operation_kind: 'crosswalk',
        evidence_state: 'documented',
        compatibility: 'conditional',
        requirements: ['Use the documented crosswalk for the pinned release.'],
        blockers: [],
        temporal_rules: { identity_snapshot: '2024' },
        confidence: { band: 'high', value: 0.95 },
        evidence_refs: ['evidence:join-pa-facility-id-to-ccn'],
        caveats: ['Crosswalk is not an aggregation.'],
      },
    },
    {
      canonical_id: 'source:pa-open-data',
      revision_id: 'revision:source:pa-open-data:v1',
      document_id: 'document:source:pa-open-data',
      document_type: 'source_search',
      projection_input_refs: ['source:pa-open-data'],
      truth_refs: truthRefs('source-pa-open-data'),
      content: {
        source_id: 'source:pa-open-data',
        title: 'Pennsylvania Open Data',
        description: 'First-party public catalog metadata.',
        organization_id: 'organization:commonwealth-pa',
        authority_tier: 'first_party',
        native_ids: [{ namespace: 'catalog', value: 'pa-open-data' }],
        connector_state: { state: 'fixture_offline', source_requests_made: 0 },
        coverage_scope: { geography: 'US-PA', state: 'partial_enumeration' },
        source_specific_coverage: { claim: 'metadata_fixture_only', absence_claim_permitted: false },
        subjects: ['health data'],
        geographies: ['US-PA'],
      },
    },
  ];
}

export function createReferenceInventory(records = createProjectionRecords()) {
  const inventory = {
    evidence: new Set(['evidence:quarantine-decision']),
    assertions: new Set(),
    access_observations: new Set(),
    documentation: new Set(),
    relationships: new Set(),
  };
  for (const record of records) {
    for (const [kind, ids] of Object.entries(record.truth_refs ?? {})) for (const id of ids) inventory[kind].add(id);
  }
  return inventory;
}

export function buildSearchComponents({ suffix = 'a', records = createProjectionRecords() } = {}) {
  const canonicalManifest = createCanonicalManifest();
  const canonicalManifestRef = { manifest_id: canonicalManifest.manifest_id, digest: canonicalManifest.membership_digest };
  const referenceInventory = createReferenceInventory(records);
  const projectorFingerprint = canonicalSha256({
    projector: 'packages/search/projection-v2.mjs',
    version: '1.0.0-untuned',
    tuning_performed: false,
  }).value;
  const output = {};
  for (const componentKind of SEARCH_PROJECTION_TYPES) {
    const build = buildProjectionGeneration({
      generationId: `generation:${componentKind}:${suffix}`,
      componentKind,
      canonicalManifest,
      records,
      projectedAt: PROJECTED_AT,
    });
    output[componentKind] = sealProjectionGeneration({
      build,
      canonicalManifestRef,
      referenceInventory,
      canonicalManifest,
      projectorFingerprint,
      sealedAt: PROJECTED_AT,
      retainedUntil: RETAINED_UNTIL,
    });
  }
  return { canonicalManifest, canonicalManifestRef, referenceInventory, records, components: output, projectorFingerprint };
}

export function externalValidatedComponent({ kind, suffix, canonicalManifestRef }) {
  const generationId = `generation:${kind}:${suffix}`;
  return {
    manifest_version: 'component-generation-manifest.v1',
    generation_id: generationId,
    component_kind: kind,
    sealed_state: 'validated',
    canonical_manifest_ref: structuredClone(canonicalManifestRef),
    component_checksum: digest('component_generation', {
      component_kind: kind,
      canonical_manifest_ref: canonicalManifestRef,
      fixture_only: true,
    }),
    sealed_at: PROJECTED_AT,
    retention: { retained_until: RETAINED_UNTIL },
  };
}

export function fixtureBuildReceiptDigest(suffix) {
  return digest('full_snapshot_build', {
    build_strategy: 'complete_as_of_exact_revision_manifest',
    fixture_suffix: suffix,
    offline_rehearsal: true,
  });
}

export const fixtureTimes = Object.freeze({ PROJECTED_AT, RETAINED_UNTIL });
