import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import corpus from '../../../../packages/retrieval/versions/v1.2.0/corpus/corpus.json'
import { LiveCatalogPositioning } from '../components/LiveCatalogPositioning'
import { liveCatalogPositioning } from './liveCatalogPositioning'

describe('live catalog positioning', () => {
  it('is derived from the published successor corpus', () => {
    expect(liveCatalogPositioning.recordCount).toBe(corpus.record_count)
    expect(liveCatalogPositioning.generation).toBe(corpus.publication.generation)
    expect(liveCatalogPositioning.allMetadataCurrent).toBe(true)
    expect(liveCatalogPositioning.sources.map(source => source.recordCount)).toEqual([159, 1472, 1803])
    expect(liveCatalogPositioning.sources.reduce((sum, source) => sum + source.recordCount, 0)).toBe(3434)
  })

  it('states both the verification result and its boundary', () => {
    const markup = renderToStaticMarkup(createElement(LiveCatalogPositioning))
    expect(markup).toContain('All 3,434 published records')
    expect(markup).toContain('0 dataset payloads')
    expect(markup).toContain('What it does not mean')
    expect(markup).not.toContain('157 published records')
  })
})
