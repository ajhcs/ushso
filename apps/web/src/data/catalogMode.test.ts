import { describe, expect, it } from 'vitest'
import baselineCorpus from '../../../../packages/retrieval/versions/v1.2.0/corpus/corpus.json'
import candidateCorpus from '../../../../packages/retrieval/versions/v1.3.0/corpus/corpus.json'
import { ApiDiscoveryProvider } from '../providers/discoveryProvider'
import { CANDIDATE_ADDITIVE_RECORD_COUNT, CANDIDATE_BASELINE_RECORD_COUNT, CANDIDATE_CORPUS_VERSION, CANDIDATE_ENTRIES, CANDIDATE_GENERATION, CANDIDATE_PARENT_GENERATION, CANDIDATE_RECORD_COUNT, candidateEntryForRecordId, isCandidateRecordId } from './candidateCatalog'
import { BASELINE_CORPUS_VERSION, BASELINE_GENERATION, BASELINE_RECORD_COUNT, CATALOG_API_PATH, CATALOG_GENERATION, CATALOG_MODE, CATALOG_RECORD_COUNT, CATALOG_VERSION, CANDIDATE_DISCOVERY_API_PATH, BASELINE_DISCOVERY_API_PATH, DATASET_API_PATH_PREFIX, DISCOVERY_API_PATH, IS_CANDIDATE_MODE, catalogApiPathForMode, datasetApiPathPrefixForMode, discoveryApiPathForMode, resolveCatalogMode } from './catalogMode'

describe('catalog build-mode single source', function () {
  it('defaults to approved baseline production', function () {
    expect(resolveCatalogMode({})).toBe('baseline')
    expect(resolveCatalogMode({ VITE_DISCOVERY_API_PATH: '/api/discover' })).toBe('baseline')
    expect(CATALOG_MODE).toBe('baseline')
    expect(IS_CANDIDATE_MODE).toBe(false)
    expect(DISCOVERY_API_PATH).toBe('/api/discover')
    expect(DISCOVERY_API_PATH).toBe(BASELINE_DISCOVERY_API_PATH)
  })
  it('selects candidate only on explicit mode', function () {
    expect(resolveCatalogMode({ VITE_CATALOG_MODE: 'candidate' })).toBe('candidate')
    expect(resolveCatalogMode({ VITE_DISCOVERY_API_PATH: '/api/candidate/discover' })).toBe('candidate')
    expect(resolveCatalogMode({ VITE_CATALOG_MODE: 'candidate', VITE_DISCOVERY_API_PATH: '/api/candidate/discover' })).toBe('candidate')
    expect(discoveryApiPathForMode('candidate')).toBe('/api/candidate/discover')
    expect(discoveryApiPathForMode('candidate')).toBe(CANDIDATE_DISCOVERY_API_PATH)
    expect(discoveryApiPathForMode('baseline')).toBe('/api/discover')
  })
  it('fails loudly on mode disagreement, never silently mixing', function () {
    expect(function () { resolveCatalogMode({ VITE_CATALOG_MODE: 'baseline', VITE_DISCOVERY_API_PATH: '/api/candidate/discover' }) }).toThrow()
    expect(function () { resolveCatalogMode({ VITE_CATALOG_MODE: 'candidate', VITE_DISCOVERY_API_PATH: '/api/discover' }) }).toThrow()
    expect(function () { resolveCatalogMode({ VITE_CATALOG_MODE: 'preview' }) }).toThrow()
    expect(function () { resolveCatalogMode({ VITE_DISCOVERY_API_PATH: '/api/unknown/discover' }) }).toThrow()
  })
  it('derives baseline facts from the frozen manifest', function () {
    expect(BASELINE_CORPUS_VERSION).toBe('1.2.0')
    expect(BASELINE_RECORD_COUNT).toBe(3434)
    expect(BASELINE_GENERATION).toBe('live-2026-09-03-85b50522b420')
    expect(BASELINE_CORPUS_VERSION).toBe(baselineCorpus.corpus_version)
    expect(BASELINE_RECORD_COUNT).toBe(baselineCorpus.record_count)
    expect(BASELINE_GENERATION).toBe(baselineCorpus.publication.generation)
  })
  it('derives candidate facts from the candidate manifest', function () {
    expect(CANDIDATE_CORPUS_VERSION).toBe('1.3.0-candidate')
    expect(CANDIDATE_RECORD_COUNT).toBe(3436)
    expect(CANDIDATE_BASELINE_RECORD_COUNT).toBe(3434)
    expect(CANDIDATE_ADDITIVE_RECORD_COUNT).toBe(2)
    expect(CANDIDATE_RECORD_COUNT).toBe(CANDIDATE_BASELINE_RECORD_COUNT + CANDIDATE_ADDITIVE_RECORD_COUNT)
    expect(CANDIDATE_CORPUS_VERSION).toBe(candidateCorpus.corpus_version)
    expect(CANDIDATE_RECORD_COUNT).toBe(candidateCorpus.record_count)
    expect(CANDIDATE_GENERATION).toBe(candidateCorpus.publication.generation)
    expect(CANDIDATE_PARENT_GENERATION).toBe('live-2026-09-03-85b50522b420')
    expect(CANDIDATE_ENTRIES.length).toBe(CANDIDATE_ADDITIVE_RECORD_COUNT)
  })
  it('keeps candidate entries additive and documented-not-verified', function () {
    for (const entry of CANDIDATE_ENTRIES) {
      expect(isCandidateRecordId(entry.recordId)).toBe(true)
      expect(candidateEntryForRecordId(entry.recordId)).not.toBeNull()
      expect(candidateEntryForRecordId(entry.routeId)).not.toBeNull()
      expect(entry.packetUrl.indexOf('/corpus-candidate-v1.3.0/evidence-packets/')).toBe(0)
      expect(entry.whatItIs.length).toBeGreaterThan(10)
      expect(entry.whyItHelps.length).toBeGreaterThan(10)
      expect(entry.whatIsDocumented.length).toBeGreaterThan(10)
      expect(entry.whatWasChecked.length).toBeGreaterThan(10)
      expect(entry.nextSteps.length).toBeGreaterThan(10)
    }
    expect(isCandidateRecordId('obs:asset:cms-data-catalog:data')).toBe(false)
    expect(candidateEntryForRecordId('obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17')).toBeNull()
  })
  it('keeps discover, catalog, and datasets routes on one mode prefix', function () {
    for (const mode of ['baseline', 'candidate'] as const) {
      const discover = discoveryApiPathForMode(mode)
      const prefix = discover.replace(/\/discover$/, '')
      expect(catalogApiPathForMode(mode)).toBe(prefix + '/catalog')
      expect(datasetApiPathPrefixForMode(mode)).toBe(prefix + '/datasets')
    }
    expect(catalogApiPathForMode('baseline')).toBe('/api/catalog')
    expect(datasetApiPathPrefixForMode('baseline')).toBe('/api/datasets')
    expect(catalogApiPathForMode('candidate')).toBe('/api/candidate/catalog')
    expect(datasetApiPathPrefixForMode('candidate')).toBe('/api/candidate/datasets')
    expect(CATALOG_API_PATH).toBe(IS_CANDIDATE_MODE ? '/api/candidate/catalog' : '/api/catalog')
    expect(DATASET_API_PATH_PREFIX).toBe(IS_CANDIDATE_MODE ? '/api/candidate/datasets' : '/api/datasets')
  })
  it('uses the same catalog for notice, search, details, agents docs, and exports', async function () {
    const provider = new ApiDiscoveryProvider()
    expect(provider).toBeDefined()
    const noticeSource = await readWebSource('src/components/CandidateCatalogNotice.tsx')
    const landingSource = await readWebSource('src/pages/LandingPage.tsx')
    const sourcesSource = await readWebSource('src/pages/SourcesPage.tsx')
    const detailsSource = await readWebSource('src/pages/DatasetDetailsPage.tsx')
    const providerSource = await readWebSource('src/providers/discoveryProvider.ts')
    const agentsSource = await readWebSource('src/pages/AgentsPage.tsx')
    expect(agentsSource.indexOf('catalogMode') !== -1).toBe(true)
    expect(agentsSource.indexOf('CATALOG_API_PATH') !== -1).toBe(true)
    expect(agentsSource.indexOf('DATASET_API_PATH_PREFIX') !== -1).toBe(true)
    expect(agentsSource.indexOf('/api/discover') === -1 || agentsSource.indexOf('DISCOVERY_API_PATH') !== -1).toBe(true)
    expect(noticeSource.indexOf('catalogMode') !== -1).toBe(true)
    expect(noticeSource.indexOf('IS_CANDIDATE_MODE') !== -1).toBe(true)
    expect(landingSource.indexOf('catalogMode') !== -1).toBe(true)
    expect(sourcesSource.indexOf('catalogMode') !== -1).toBe(true)
    expect(detailsSource.indexOf('catalogMode') !== -1).toBe(true)
    expect(providerSource.indexOf('catalogMode') !== -1).toBe(true)
    expect(providerSource.indexOf('DISCOVERY_API_PATH') !== -1).toBe(true)
    expect(CATALOG_VERSION).toBe(IS_CANDIDATE_MODE ? CANDIDATE_CORPUS_VERSION : BASELINE_CORPUS_VERSION)
    expect(CATALOG_GENERATION).toBe(IS_CANDIDATE_MODE ? CANDIDATE_GENERATION : BASELINE_GENERATION)
    expect(CATALOG_RECORD_COUNT).toBe(IS_CANDIDATE_MODE ? CANDIDATE_RECORD_COUNT : BASELINE_RECORD_COUNT)
    expect(DISCOVERY_API_PATH).toBe(IS_CANDIDATE_MODE ? CANDIDATE_DISCOVERY_API_PATH : BASELINE_DISCOVERY_API_PATH)
  })
})

async function readWebSource(relative: string): Promise<string> {
  const fs = await import('node:fs/promises')
  const url = await import('node:url')
  const root = url.fileURLToPath(new url.URL('../../../', import.meta.url))
  void root
  const webRoot = new url.URL('../../', import.meta.url)
  const absolute = url.fileURLToPath(new url.URL(relative, webRoot))
  return fs.readFile(absolute, 'utf8')
}
