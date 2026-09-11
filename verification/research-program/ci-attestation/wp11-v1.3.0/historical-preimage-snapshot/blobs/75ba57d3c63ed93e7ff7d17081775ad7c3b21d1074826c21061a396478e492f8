import { describe, expect, it } from 'vitest'
import { createSearchReturnContext, datasetDetailsHref, parseReturnContext, resultAnchorId, safeReturnDestination, serializeReturnContext } from './returnContext'

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
})
