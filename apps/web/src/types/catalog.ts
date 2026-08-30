import type {
  DiscoveryJoinRoute,
  DiscoveryResult,
  DiscoveryResultItem,
  EvidenceState,
  ObservatoryCapability,
  ObservatoryVariable,
  VariableDocumentationStatus,
} from './discovery'

export type Relevance = 'High' | 'Medium' | 'Low' | 'Browse'
export type Relationship = 'Confirmed family' | 'Possible relation' | 'Standalone record'
export type GroupMode = 'family' | 'record'
export type SortMode = 'best' | 'title' | 'newest'

export interface AccessOption {
  id: string
  label: string
  description: string
  kind: 'report' | 'download' | 'api' | 'request'
  href?: string
  requirements: string[]
}

export interface DatasetEvidenceSource {
  provenanceId: string
  kind: 'first_party_page' | 'catalog_metadata' | 'documentation' | 'fixture_note' | 'other'
  locator: string
  observedAt: string
  captureState: 'captured_hashed' | 'fixture_only' | 'locator_only' | 'unavailable'
  contentSha256: string | null
}

export interface DatasetVerificationEvidence {
  evidenceId: string
  claim: string
  state: EvidenceState
  limitations: string[]
  sources: DatasetEvidenceSource[]
}

export interface DatasetVerification {
  status: 'current_verified' | 'stale' | 'not_live_verified' | 'unknown'
  method: 'first_party_live' | 'captured_evidence' | 'offline_fixture' | 'unknown'
  metadataObservedAt: string
  dataThrough: string | null
  nextReviewDue: string | null
  liveVerified: boolean
  evidence: DatasetVerificationEvidence[]
}

export interface DatasetVariableDetails {
  status: VariableDocumentationStatus
  summary: string | null
  variableCount: number | null
  variables: ObservatoryVariable[]
  codebook: { title: string; url: string } | null
  unitsOfAnalysis: string[]
  topics: ObservatoryCapability[]
  useCases: ObservatoryCapability[]
  expectedArtifacts: string[]
  evidenceState: EvidenceState
  evidenceIds: string[]
  limitations: string[]
}

export interface DatasetFamily {
  id: string
  rank: number
  title: string
  description: string
  familyStatus: 'Family' | 'Single-record family'
  familySiblingCount: number
  relevance: Relevance
  relationship: Relationship
  recordType: string
  geographicApplicability: string
  reportingUnit: string
  populationFacilityScope: string
  availableYears: string
  latestVerifiedRelease: string
  variablesCodebook: string
  verification: DatasetVerification
  variableDetails: DatasetVariableDetails
  accessOptions: AccessOption[]
  categories: string[]
  sourceName: string
  sourceUrl?: string
  detailsUrl: string
  facetValues: Record<string, string[]>
  canonicalResult: DiscoveryResultItem
  joinRoutes: DiscoveryJoinRoute[]
}

export interface DatasetRecord extends DatasetFamily {
  parentFamilyId?: string
}

export interface FacetOption {
  value: string
  label: string
  count: number
  disabled?: boolean
}

export interface FacetSectionConfig {
  id: string
  label: string
  options: FacetOption[]
  collapsed?: boolean
  expandable?: boolean
}

export interface CatalogSearchResponse {
  query: string
  totals: {
    families: number
    records: number
    sources: number
  }
  families: DatasetFamily[]
  records: DatasetRecord[]
  facets: FacetSectionConfig[]
  canonicalResponse: DiscoveryResult
}
