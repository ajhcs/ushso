import { describe, expect, it } from 'vitest'
import { briefOriginContext, createSearchReturnContext, datasetDetailsHref, parseReturnContext, resultAnchorId, safeReturnDestination, serializeReturnContext } from './returnContext'

describe('same-origin dataset return context', () => {
  it('round-trips the complete search URL and selected result', () => {
    const context = createSearchReturnContext(
      { pathname: '/search', search: '?q=hospital&sort=title&page=4&filter=source%3Acms' },
      'obs:asset:cms-cost',
      1200,
    )
    const encoded = serializeReturnContext(context)
    expect(parseReturnContext(encoded)).toEqual(context)
    expect(safeReturnDestination(encoded)).toBe('/search?q=hospital&sort=title&page=4&filter=source%3Acms')
    expect(datasetDetailsHref('obs:asset:cms-cost', context)).toContain('/datasets/obs%3Aasset%3Acms-cost?return=')
    expect(resultAnchorId('obs:asset:cms-cost')).toBe('search-result-obs-asset-cms-cost')
  })

  it('rejects malformed and external destinations', () => {
    expect(() => createSearchReturnContext({ pathname: 'https://evil.example/', search: '' }, 'id')).toThrow()
    expect(parseReturnContext('https://evil.example/')).toBeNull()
    expect(safeReturnDestination('https://evil.example/', '/')).toBe('/')
  })

  it('recognizes navigator brief origins without matching catalog records', () => {
    const brief = serializeReturnContext(createSearchReturnContext({ pathname: '/search', search: '?q=county%20uninsured%20SAHIE' }, 'navigator-census-sahie', 0))
    expect(briefOriginContext(brief)).toEqual({ profileId: 'census-sahie', question: 'county uninsured SAHIE' })
    const record = serializeReturnContext(createSearchReturnContext({ pathname: '/search', search: '?q=hospital' }, 'obs:asset:cms-cost', 0))
    expect(briefOriginContext(record)).toBeNull()
    expect(briefOriginContext(null)).toBeNull()
    expect(briefOriginContext('https://evil.example/')).toBeNull()
  })
})
