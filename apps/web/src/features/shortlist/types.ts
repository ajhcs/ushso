export interface SourceCitation {
  capture_id: string
  canonical_url: string
  retrieved_at: string
  content_sha256: string | null
  locator_scheme: string
  locators: (string | {start:number;end:number})[]
}
export interface PublicationPin {
  generation_id: string
  data_manifest_sha256: string
  ranking_version: string
  schema_version: 'ushso.source-selection.v1'
}
export interface SourceSnapshot {
  schema_version: 'ushso.source-selection.v1'
  asset_id: string
  publisher_id: string
  generation_id: string
  title: string
  assertion_ids: string[]
  evidence_ids: string[]
  citations?: SourceCitation[]
  [key: string]: unknown
}
export interface ShortlistItem {
  asset_id: string
  decision: 'include' | 'exclude' | 'consider'
  note: string
  snapshot: SourceSnapshot
}
export interface LocalShortlist {
  schema_version: 'ushso.shortlist.v1'
  id: string
  created_at: string
  updated_at: string
  expires_at: string | null
  storage_consent: { granted_at: string; version: '1' } | null
  pin: PublicationPin
  question?: string
  items: ShortlistItem[]
  revision: number
}
