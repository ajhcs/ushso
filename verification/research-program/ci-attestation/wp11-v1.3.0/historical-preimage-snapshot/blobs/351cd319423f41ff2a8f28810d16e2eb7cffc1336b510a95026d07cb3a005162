import { normalizeText } from './question-parser.mjs';

const OBSERVED_AT = '2026-08-29T00:00:00Z';
const FAILURE_POLICY = 'Preserve typed access and infrastructure failure; never convert failure or unresolved state to not_found.';
const RESTRICTED = new Set(['registration_required', 'application_required', 'dua_required', 'licensed_paid', 'controlled']);

function slug(value) {
  return String(value)
    .toLowerCase()
    .replaceAll('_', '-')
    .replace(/[^a-z0-9:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function registryEvidenceKey(spec, duplicateRegistryKeys) {
  const base = slug(spec.registry_key);
  if (!duplicateRegistryKeys.has(spec.registry_key)) return base;
  return `${base}:${slug(spec.record_id.replace(/^obs:asset:/, ''))}`;
}

function capability(subject, vocabulary, evidenceId, index) {
  const definition = vocabulary.subjects.find(item => item.id === subject);
  if (!definition) throw new Error(`UNKNOWN_CURATED_SUBJECT: ${subject}`);
  return {
    id: `topic:${subject.replaceAll('_', '-')}`,
    label: definition.label,
    fitness: index < 2 ? 'primary' : 'supporting',
    rationale: `The captured source-registry description explicitly supports discovery for ${definition.label.toLowerCase()}; analytic fitness still requires source-specific review.`,
    evidence_state: 'source_asserted',
    evidence_ids: [evidenceId]
  };
}

function retrievalInstructions(spec, restricted) {
  const instructions = [{
    sequence: 1,
    action: 'open',
    url: spec.authoritative_url,
    requires_human: false,
    instruction: 'Open the authoritative source route and confirm the selected asset, release, documentation, and access terms before requesting data.',
    expected_result: 'A first-party asset page or a preserved typed access or infrastructure outcome.'
  }];
  if (restricted) {
    instructions.push({
      sequence: 2,
      action: 'stop_and_report',
      url: null,
      requires_human: true,
      instruction: 'Stop before account creation, application submission, agreement acceptance, payment, or controlled transfer and obtain explicit human authorization.',
      expected_result: 'A human decision on whether and how to proceed under the source-specific terms.'
    });
    return instructions;
  }
  if (spec.retrieval_urls.length) {
    instructions.push({
      sequence: 2,
      action: 'inspect_metadata',
      url: spec.retrieval_urls[0],
      requires_human: false,
      instruction: 'Inspect the published download, API, methodology, or documentation route; select and record a specific release before acquisition.',
      expected_result: 'Versioned retrieval metadata or a preserved typed access or infrastructure outcome.'
    });
  }
  return instructions;
}

export function adaptCuratedAssets({ fixture, sourceRegistry, vocabulary }) {
  const counts = new Map();
  for (const spec of fixture.assets) counts.set(spec.registry_key, (counts.get(spec.registry_key) ?? 0) + 1);
  const duplicateRegistryKeys = new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
  const registryByKey = new Map(sourceRegistry.sources.map(entry => [entry.key, entry]));
  return fixture.assets.map(spec => {
    const source = registryByKey.get(spec.registry_key);
    if (!source) throw new Error(`CURATED_SOURCE_NOT_IN_REGISTRY: ${spec.registry_key}`);
    const firstPartyUrls = new Set(source.first_party_urls ?? []);
    for (const url of [spec.authoritative_url, ...spec.retrieval_urls]) {
      if (!firstPartyUrls.has(url)) throw new Error(`CURATED_URL_NOT_EVIDENCED: ${spec.record_id}: ${url}`);
    }
    const key = registryEvidenceKey(spec, duplicateRegistryKeys);
    const evidenceId = `ev:registry:${key}`;
    const registryProvenanceId = `prov:registry:${key}`;
    const pageProvenanceId = `prov:first-party:${key}`;
    const restricted = RESTRICTED.has(spec.access.status);
    const restrictionNote = restricted
      ? `${source.access} Current terms and availability were not live tested in this offline build.`
      : `The source registry describes this route as public. Current endpoint availability and release metadata were not live tested in this offline build.`;
    return {
      schema_version: 'observatory-record.v1.0.0',
      record_id: spec.record_id,
      record_type: 'dataset_asset',
      identity: {
        source: { source_id: spec.source_id, name: spec.source_name },
        family: {
          family_id: spec.family_id,
          name: spec.family_name,
          resolution_state: 'source_asserted',
          evidence_ids: [evidenceId],
          candidate_family_ids: []
        },
        asset: {
          asset_id: spec.record_id,
          name: spec.title,
          asset_type: spec.asset_type,
          version_state: spec.version_state,
          version_label: spec.version_label
        },
        match_fields: {
          normalized_url: spec.authoritative_url,
          canonical_url: spec.authoritative_url,
          doi: null,
          source_id: spec.registry_key,
          publisher: spec.publisher,
          normalized_title: normalizeText(spec.title),
          source_portal: new URL(spec.authoritative_url).hostname
        },
        identity_index_binding: {
          state: 'not_bound_fixture',
          identity_record_id: null,
          rationale: 'The offline adapter preserves the source-registry identity and does not query, write, or rebuild the shared identity index.'
        }
      },
      title: spec.title,
      description: spec.description,
      authoritative_url: spec.authoritative_url,
      geography: {
        ...spec.geography,
        evidence_state: 'source_asserted',
        evidence_ids: [evidenceId]
      },
      time_coverage: {
        state: spec.time_coverage.state,
        start: spec.time_coverage.start,
        end: spec.time_coverage.end,
        temporal_granularity: spec.time_coverage.temporal_granularity,
        evidence_state: 'source_asserted',
        evidence_ids: [evidenceId]
      },
      unit_of_analysis: spec.unit_of_analysis,
      capabilities: {
        topics: spec.subjects.map((subject, index) => capability(subject, vocabulary, evidenceId, index)),
        use_cases: [{
          id: 'use-case:question-to-source-discovery',
          label: 'Question-to-source discovery and access routing',
          fitness: 'supporting',
          rationale: 'The asset record is intended for evidence-bound source discovery and retrieval routing, not as an assertion that data were acquired or are analytically sufficient.',
          evidence_state: 'inferred',
          evidence_ids: [evidenceId]
        }]
      },
      access: {
        status: spec.access.status,
        mechanisms: spec.access.mechanisms,
        requirements: spec.access.requirements,
        infrastructure_state: 'not_tested_offline',
        evidence_state: 'source_asserted',
        evidence_ids: [evidenceId],
        restriction_note: restrictionNote
      },
      provenance: [
        {
          provenance_id: registryProvenanceId,
          kind: 'other',
          locator: `urn:sha256:${fixture.source_registry.sha256}`,
          observed_at: OBSERVED_AT,
          capture_state: 'captured_hashed',
          content_sha256: fixture.source_registry.sha256
        },
        {
          provenance_id: pageProvenanceId,
          kind: 'first_party_page',
          locator: spec.authoritative_url,
          observed_at: OBSERVED_AT,
          capture_state: 'locator_only',
          content_sha256: null
        }
      ],
      evidence: [{
        evidence_id: evidenceId,
        claim: `The captured discovery source registry describes ${source.ecosystem} at the authoritative first-party route and supports this asset-level discovery record.`,
        state: 'source_asserted',
        provenance_ids: [registryProvenanceId, pageProvenanceId],
        limitations: [
          ...spec.limitations,
          'This adapter performed no network request, payload acquisition, entity resolution, family merge, or live availability test.',
          `Source-registry project status was ${source.project_status}; discovery evidence is not acquisition proof.`
        ]
      }],
      freshness_verification: {
        metadata_observed_at: OBSERVED_AT,
        data_through: spec.time_coverage.data_through,
        update_frequency: spec.version_state === 'rolling' ? 'continuous' : spec.time_coverage.temporal_granularity === 'month' ? 'monthly' : spec.time_coverage.temporal_granularity === 'quarter' ? 'quarterly' : 'annual',
        verification_status: 'not_live_verified',
        verification_method: 'offline_fixture',
        next_review_due: null
      },
      retrieval: {
        machine_actionable: !restricted,
        preferred_interface: spec.access.preferred_interface,
        instructions: retrievalInstructions(spec, restricted),
        expected_artifacts: restricted
          ? ['source-specific access decision', 'typed restriction outcome', 'authorized retrieval receipt if later approved']
          : ['versioned source metadata', 'typed access or infrastructure outcome', 'content hash if data are later acquired'],
        failure_policy: FAILURE_POLICY
      },
      join_compatibility: {
        state: 'unknown',
        keys: [],
        notes: ['Use only separately published explicit join-route objects; do not infer identity or compatibility from titles, publishers, URLs, or family labels.']
      }
    };
  });
}
