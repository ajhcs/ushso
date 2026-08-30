export type EvidenceState =
  | 'verified_first_party'
  | 'source_asserted'
  | 'inferred'
  | 'unresolved'
  | 'unavailable'

export interface DiscoveryQuery {
  question: string
  geography?: { codes?: string[]; levels?: string[] }
  subjects?: string[]
  units_of_analysis?: string[]
  access_statuses?: string[]
  include_restricted?: boolean
  time_window?: { start_year?: number; end_year?: number }
  limit?: number
}

export interface ConceptMatch {
  id: string
  label: string
  kind: string
  matched_aliases: string[]
  evidence: 'controlled_vocabulary' | 'explicit_filter'
}

export interface ObservatoryCapability {
  id: string
  label: string
  fitness: 'primary' | 'supporting' | 'context_only' | 'unknown'
  rationale: string
  evidence_state: EvidenceState
  evidence_ids: string[]
}

export interface ObservatoryRetrievalStep {
  sequence: number
  action: 'open' | 'download' | 'call_api' | 'submit_request' | 'accept_license' | 'authenticate' | 'inspect_metadata' | 'contact_owner' | 'stop_and_report'
  url: string | null
  requires_human: boolean
  instruction: string
  expected_result: string
}

export type VariableDocumentationStatus = 'documented' | 'partial' | 'not_captured' | 'unavailable' | 'unknown'

export interface ObservatoryVariable {
  name: string
  label: string | null
  description: string
  data_type: string | null
  unit: string | null
  allowed_values: string[]
  evidence_state: EvidenceState
  evidence_ids: string[]
}

export interface ObservatoryVariableDocumentation {
  status: VariableDocumentationStatus
  summary: string | null
  variable_count: number | null
  variables: ObservatoryVariable[]
  codebook: { title: string; url: string } | null
  evidence_state: EvidenceState
  evidence_ids: string[]
  limitations: string[]
}

export interface ObservatoryRecord {
  schema_version: 'observatory-record.v1.0.0'
  record_id: string
  record_type: 'dataset_asset'
  identity: {
    source: { source_id: string; name: string }
    family: {
      family_id: string
      name: string
      resolution_state: 'source_asserted' | 'exact' | 'provisional' | 'ambiguous' | 'unresolved'
      evidence_ids: string[]
      candidate_family_ids: string[]
    }
    asset: {
      asset_id: string
      name: string
      asset_type: 'dataset' | 'table' | 'file' | 'api' | 'catalog_record' | 'codebook' | 'survey' | 'other'
      version_state: 'versioned' | 'rolling' | 'unversioned' | 'unknown'
      version_label: string | null
    }
    match_fields: {
      normalized_url: string | null
      canonical_url: string | null
      doi: string | null
      source_id: string | null
      publisher: string | null
      normalized_title: string | null
      source_portal: string | null
    }
    identity_index_binding: {
      state: 'exact' | 'ambiguous' | 'unresolved' | 'not_bound_fixture'
      identity_record_id: string | null
      rationale: string
    }
  }
  title: string
  description: string
  authoritative_url?: string
  geography: {
    coverage_level: 'national' | 'multi_state' | 'state' | 'county' | 'facility' | 'mixed' | 'unknown'
    jurisdictions: string[]
    rurality_support: 'direct' | 'derivable' | 'none' | 'unknown'
    evidence_state: EvidenceState
    evidence_ids: string[]
  }
  time_coverage: {
    state: 'bounded' | 'rolling' | 'point_in_time' | 'unknown' | 'not_applicable'
    start: string | null
    end: string | null
    temporal_granularity: 'event_date' | 'day' | 'month' | 'quarter' | 'year' | 'release' | 'mixed' | 'unknown' | 'not_applicable'
    evidence_state: EvidenceState
    evidence_ids: string[]
  }
  unit_of_analysis: string[]
  variable_documentation?: ObservatoryVariableDocumentation
  capabilities: { topics: ObservatoryCapability[]; use_cases: ObservatoryCapability[] }
  access: {
    status: 'public_direct' | 'public_catalog' | 'registration_required' | 'application_required' | 'dua_required' | 'licensed_paid' | 'controlled' | 'temporarily_unavailable' | 'unavailable' | 'unknown'
    mechanisms: string[]
    requirements: string[]
    infrastructure_state: 'not_tested_offline' | 'available' | 'degraded' | 'blocked' | 'unreachable' | 'unknown'
    evidence_state: EvidenceState
    evidence_ids: string[]
    restriction_note: string | null
  }
  provenance: Array<{
    provenance_id: string
    kind: 'first_party_page' | 'catalog_metadata' | 'documentation' | 'fixture_note' | 'other'
    locator: string
    observed_at: string
    capture_state: 'captured_hashed' | 'fixture_only' | 'locator_only' | 'unavailable'
    content_sha256: string | null
  }>
  evidence: Array<{
    evidence_id: string
    claim: string
    state: EvidenceState
    provenance_ids: string[]
    limitations: string[]
  }>
  freshness_verification: {
    metadata_observed_at: string
    data_through: string | null
    update_frequency: 'continuous' | 'monthly' | 'quarterly' | 'annual' | 'irregular' | 'one_time' | 'unknown'
    verification_status: 'current_verified' | 'stale' | 'not_live_verified' | 'unknown'
    verification_method: 'first_party_live' | 'captured_evidence' | 'offline_fixture' | 'unknown'
    next_review_due: string | null
  }
  retrieval: {
    machine_actionable: boolean
    preferred_interface: 'download' | 'api' | 'portal' | 'request_workflow' | 'license_workflow' | 'unknown'
    instructions: ObservatoryRetrievalStep[]
    expected_artifacts: string[]
    failure_policy: string
  }
  join_compatibility: {
    state: 'documented' | 'candidate' | 'ambiguous' | 'none_known' | 'unknown'
    keys: unknown[]
    notes: string[]
  }
}

export interface ScoreComponent {
  kind: string
  value: number
  reason: string
  evidence_state: EvidenceState
}

export interface DiscoveryResultItem {
  rank: number
  score: number
  record_id: string
  relevance: {
    matched_subjects: string[]
    matched_geographies: string[]
    matched_units: string[]
    matched_terms: string[]
    score_components: ScoreComponent[]
    why_relevant: string[]
  }
  record: ObservatoryRecord
}

export interface DiscoveryJoinRoute {
  route_id: string
  from_record_id: string
  to_record_id: string
  direction: 'bidirectional' | 'from_to' | 'to_from'
  entity: string
  match_strategy: string
  key_pairs: Array<{
    from_fields: string[]
    to_fields: string[]
    from_namespace: string
    to_namespace: string
    normalization_steps: string[]
  }>
  cardinality: string
  compatibility_state: 'documented' | 'candidate' | 'ambiguous' | 'incompatible' | 'unknown'
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  preconditions: string[]
  caveats: string[]
  evidence_refs: Array<{
    record_id: string
    evidence_ids: string[]
    provenance_ids: string[]
    state: EvidenceState
  }>
  blocked_reason?: string | null
}

export interface DiscoveryResult {
  contract_version: 'observatory-discovery-result.v1.0.0'
  retrieval_id: string
  evidence_mode: 'published_offline_evidence'
  corpus: {
    corpus_id: string
    corpus_version: string
    record_count: number
    search_document_count?: number
    join_route_count: number
    manifest_sha256?: string | null
    source_slices?: Record<string, number>
  }
  query: {
    question: string
    normalized_question: string
    interpretation: {
      geographies: ConceptMatch[]
      subjects: ConceptMatch[]
      units_of_analysis: ConceptMatch[]
      time_window: { start_year: number | null; end_year: number | null; match_basis: string } | null
      access_intent: {
        include_restricted: boolean
        public_only: boolean
        accepts_restricted: boolean
        match_basis: string
      }
    }
    filters: Record<string, unknown>
  }
  result_count: number
  results: DiscoveryResultItem[]
  join_routes: DiscoveryJoinRoute[]
  warnings: string[]
}
