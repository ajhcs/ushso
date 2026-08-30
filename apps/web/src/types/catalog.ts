import type { DiscoveryJoinRoute, DiscoveryResult, DiscoveryResultItem } from './discovery'

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

export interface DatasetFamily {
  id: string
  rank: number
  title: string
  description: string
  familyStatus: 'Family' | 'Single-record family'
  familySiblingCount: number
  relevance: Relevance
  relationship: Relationship
  whyMatched: string
  recordType: string
  geographicApplicability: string
  reportingUnit: string
  populationFacilityScope: string
  availableYears: string
  latestVerifiedRelease: string
  variablesCodebook: string
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
