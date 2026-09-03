import corpusJson from '../../../../packages/retrieval/versions/v1.2.0/corpus/corpus.json'

const sourceDetails = Object.freeze({
  'cms-data-catalog': Object.freeze({
    name: 'Centers for Medicare & Medicaid Services Data Catalog',
    catalogUrl: 'https://data.cms.gov/data.json',
  }),
  'cdc-socrata': Object.freeze({
    name: 'Centers for Disease Control and Prevention Data Catalog',
    catalogUrl: 'https://data.cdc.gov/api/views/metadata/v1',
  }),
  'census-api': Object.freeze({
    name: 'U.S. Census Bureau API Catalog',
    catalogUrl: 'https://api.census.gov/data.json',
  }),
})

type SourceId = keyof typeof sourceDetails

const corpus = corpusJson as {
  corpus_id: string
  corpus_version: string
  record_count: number
  source_slices: Record<SourceId, number>
  publication: {
    generation: string
    observed_at: string
    all_public_records_live_verified: boolean
  }
  build_boundary: {
    external_requests: number
    payload_downloads: number
  }
}

export const liveCatalogPositioning = Object.freeze({
  corpusId: corpus.corpus_id,
  corpusVersion: corpus.corpus_version,
  generation: corpus.publication.generation,
  observedAt: corpus.publication.observed_at,
  recordCount: corpus.record_count,
  sourceCount: Object.keys(corpus.source_slices).length,
  metadataRequests: corpus.build_boundary.external_requests,
  payloadDownloads: corpus.build_boundary.payload_downloads,
  allMetadataCurrent: corpus.publication.all_public_records_live_verified,
  sources: Object.freeze((Object.keys(sourceDetails) as SourceId[]).map(id => Object.freeze({
    id,
    ...sourceDetails[id],
    recordCount: corpus.source_slices[id],
  }))),
})
