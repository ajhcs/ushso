import { normalizeText } from './question-parser.mjs';

const SUBJECT_ALIASES = {
  geography_access: 'geography_access'
};
const RESTRICTED = new Set(['registration_required', 'application_required', 'dua_required', 'licensed_paid', 'controlled']);
const sentence = (value) => String(value).replaceAll('_', ' ');

function capability(subjectId, vocabulary, evidenceId, index) {
  const normalized = SUBJECT_ALIASES[subjectId] ?? subjectId;
  const definition = vocabulary.subjects.find((subject) => subject.id === normalized);
  if (!definition) throw new Error(`UNKNOWN_NATIONAL_SUBJECT:${subjectId}`);
  return {
    id: `topic:${normalized.replaceAll('_', '-')}`,
    label: definition.label,
    fitness: index < 2 ? 'primary' : 'supporting',
    rationale: `The accepted federal backbone identifies this asset as supporting ${definition.label.toLowerCase()}; source-specific analytical fitness still requires release and field review.`,
    evidence_state: 'source_asserted',
    evidence_ids: [evidenceId]
  };
}

function retrievalSteps(source) {
  const restricted = RESTRICTED.has(source.access.status);
  const steps = source.retrieval.instructions.map((instruction, index) => ({
    sequence: index + 1,
    action: index === 0 ? 'open' : 'inspect_metadata',
    url: index === 0 ? source.authoritative_url : null,
    requires_human: restricted,
    instruction,
    expected_result: 'A version-specific first-party metadata, documentation, access, or typed infrastructure outcome.'
  }));
  if (restricted) {
    steps.push({
      sequence: steps.length + 1,
      action: 'stop_and_report',
      url: null,
      requires_human: true,
      instruction: 'Stop before authentication, enrollment changes, form submission, agreement acceptance, or restricted transfer and obtain explicit human authorization.',
      expected_result: 'A human decision and preserved source-specific access outcome.'
    });
  }
  return steps;
}

export function adaptNationalBackbone({ records, observations, vocabulary, importReceiptSha256 }) {
  const observationsByRecord = new Map(observations.map((row) => [row.record_id, row]));
  return records.flatMap((source) => {
    const observation = observationsByRecord.get(source.record_id);
    if (!observation) throw new Error(`NATIONAL_OBSERVATION_MISSING:${source.record_id}`);
    if (observation.promotion_eligibility !== 'eligible') return [];
    const evidenceId = `ev:national-federal:${source.asset_identity.asset_id}`;
    const packageProvenanceId = `prov:national-package:${source.asset_identity.asset_id}`;
    const liveProvenanceId = `prov:national-live:${source.asset_identity.asset_id}`;
    const restricted = RESTRICTED.has(source.access.status);
    const subjectLabels = source.subjects.map(sentence).join(', ');
    const unitLabels = source.unit_of_analysis.map(sentence).join(', ');
    const useLabels = source.use_cases.join('; ');
    const filter = source.geography.state_filtering;
    const description = `${source.asset_identity.name} is a national ${sentence(source.asset_identity.asset_type)} published by ${source.asset_identity.publisher}. It contains ${subjectLabels} information at ${unitLabels} grain. Use it for ${useLabels}. State filtering is ${sentence(filter.mode)}: ${filter.field_or_route}`;
    return [{
      schema_version: 'observatory-record.v1.0.0',
      record_id: source.record_id,
      record_type: 'dataset_asset',
      identity: {
        source: {
          source_id: `us-federal:source:${normalizeText(source.asset_identity.publisher).replaceAll(' ', '-')}`,
          name: source.asset_identity.publisher
        },
        family: {
          family_id: `us-federal:family:${source.asset_identity.asset_id}`,
          name: `${source.asset_identity.name} source family`,
          resolution_state: 'source_asserted',
          evidence_ids: [evidenceId],
          candidate_family_ids: []
        },
        asset: {
          asset_id: source.record_id,
          name: source.asset_identity.name,
          asset_type: source.asset_identity.asset_type,
          version_state: source.temporal_coverage.state === 'versioned' ? 'versioned' : source.temporal_coverage.state === 'historical_series' ? 'rolling' : 'unknown',
          version_label: null
        },
        match_fields: {
          normalized_url: source.authoritative_url,
          canonical_url: source.authoritative_url,
          doi: null,
          source_id: source.asset_identity.native_id,
          publisher: source.asset_identity.publisher,
          normalized_title: normalizeText(source.asset_identity.name),
          source_portal: new URL(source.authoritative_url).hostname
        },
        identity_index_binding: {
          state: 'not_bound_fixture',
          identity_record_id: null,
          rationale: 'This promotion preserves the federal backbone identity and does not read, merge, or rebuild the shared identity index.'
        }
      },
      title: source.asset_identity.name,
      description,
      authoritative_url: source.authoritative_url,
      geography: {
        coverage_level: 'national',
        jurisdictions: ['US'],
        rurality_support: source.subjects.includes('geography_access') ? 'derivable' : 'unknown',
        evidence_state: 'source_asserted',
        evidence_ids: [evidenceId]
      },
      time_coverage: {
        state: source.temporal_coverage.state === 'historical_series' ? 'rolling' : source.temporal_coverage.state === 'versioned' ? 'rolling' : 'unknown',
        start: source.temporal_coverage.start,
        end: source.temporal_coverage.end,
        temporal_granularity: source.temporal_coverage.granularity?.includes('year') ? 'year' : source.temporal_coverage.granularity?.includes('month') ? 'month' : 'release',
        evidence_state: 'source_asserted',
        evidence_ids: [evidenceId]
      },
      unit_of_analysis: source.unit_of_analysis,
      capabilities: {
        topics: source.subjects.map((subject, index) => capability(subject, vocabulary, evidenceId, index)),
        use_cases: source.use_cases.map((useCase, index) => ({
          id: `use-case:national-${source.asset_identity.asset_id}:${index + 1}`,
          label: useCase,
          fitness: index === 0 ? 'primary' : 'supporting',
          rationale: `The accepted federal backbone documents this use: ${useCase}. Confirm the selected release, fields, and grain before analysis.`,
          evidence_state: 'source_asserted',
          evidence_ids: [evidenceId]
        }))
      },
      access: {
        status: source.access.status,
        mechanisms: source.access.mechanisms,
        requirements: source.access.requirements,
        infrastructure_state: 'available',
        evidence_state: 'verified_first_party',
        evidence_ids: [evidenceId],
        restriction_note: restricted
          ? 'The authoritative metadata route responded successfully, but the source-specific registration or access boundary still applies.'
          : 'The authoritative metadata route responded successfully. Underlying files, APIs, schemas, and current releases were not downloaded or fully exercised.'
      },
      provenance: [
        {
          provenance_id: packageProvenanceId,
          kind: 'other',
          locator: `urn:sha256:${importReceiptSha256}`,
          observed_at: observation.observed_at,
          capture_state: 'captured_hashed',
          content_sha256: importReceiptSha256
        },
        {
          provenance_id: liveProvenanceId,
          kind: 'first_party_page',
          locator: observation.final_url ?? source.authoritative_url,
          observed_at: observation.observed_at,
          capture_state: 'locator_only',
          content_sha256: null
        }
      ],
      evidence: [{
        evidence_id: evidenceId,
        claim: `The accepted federal backbone describes this authoritative asset and a bounded live check received HTTP ${observation.status_code} from its metadata route.`,
        state: 'verified_first_party',
        provenance_ids: [packageProvenanceId, liveProvenanceId],
        limitations: [
          ...source.limitations,
          ...source.explicit_unknowns,
          observation.limitation,
          'No dataset payload, account action, form submission, identity merge, or inferred join was performed.'
        ]
      }],
      freshness_verification: {
        metadata_observed_at: observation.observed_at,
        data_through: source.temporal_coverage.end,
        update_frequency: 'unknown',
        verification_status: 'not_live_verified',
        verification_method: 'first_party_live',
        next_review_due: null
      },
      retrieval: {
        machine_actionable: !restricted,
        preferred_interface: source.access.mechanisms.includes('api') ? 'api' : source.access.mechanisms.some((value) => value.includes('download')) ? 'download' : restricted ? 'request_workflow' : 'portal',
        instructions: retrievalSteps(source),
        expected_artifacts: ['versioned source metadata', 'source-specific documentation or schema', 'typed access outcome', 'content hash only after separately authorized acquisition'],
        failure_policy: source.retrieval.failure_policy
      },
      join_compatibility: {
        state: 'unknown',
        keys: [],
        notes: ['Use only separately published join-route objects. State-filter routes and identifier mentions do not establish an executable cross-source join.']
      }
    }];
  });
}
