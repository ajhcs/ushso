import { describe, expect, it } from 'vitest'
import { isSafeEvidenceLocator, MAX_EXTERNAL_URL_LENGTH, safeExternalHttpsUrl } from './externalUrls'

describe('external evidence URL boundary', () => {
  it('returns the canonical browser destination for an unambiguous public HTTPS URL', () => {
    const value = 'HTTPS://DATA.CMS.GOV/path with space?titleFilter=Hospital#results'
    const canonical = safeExternalHttpsUrl(value)

    expect(canonical).toBe('https://data.cms.gov/path%20with%20space?titleFilter=Hospital#results')
    expect(new URL(canonical!).href).toBe(canonical)
  })

  it.each([
    'http://data.cms.gov/source',
    '/source',
    'https:/api/contract',
    'https:api/contract',
    'https:\\attacker.test/source',
    'https://attacker.test\\@data.cms.gov/source',
    ' https://data.cms.gov/source',
    'https://data.cms.gov/source ',
    'https://data.cms.gov/\nsource',
    'https://user@data.cms.gov/source',
    'https://user:password@data.cms.gov/source',
  ])('rejects ambiguous syntax, controls, or URL credentials: %s', (value) => {
    expect(safeExternalHttpsUrl(value)).toBeNull()
  })

  it.each([
    'https://data.cms.gov/source?token=secret',
    'https://data.cms.gov/source?api_key=secret',
    'https://data.cms.gov/source?%58-Amz-Signature=secret',
    'https://data.cms.gov/source?%74%6f%6b%65%6e=secret',
    'https://data.cms.gov/source?%2574%256f%256b%2565%256e=secret',
    'https://data.cms.gov/source?X-Goog-Credential=secret',
    'https://data.cms.gov/source?expires=9999999999',
  ])('rejects decoded credential-bearing or signed query keys: %s', (value) => {
    expect(safeExternalHttpsUrl(value)).toBeNull()
  })

  it.each([
    'https://localhost/source',
    'https://sub.localhost/source',
    'https://127.0.0.1/source',
    'https://2130706433/source',
    'https://0x7f000001/source',
    'https://127。0。0。1/source',
    'https://[::1]/source',
    'https://metadata.internal/source',
    'https://device.local/source',
    'https://router.lan/source',
    'https://intranet/source',
    'https://empty..label.gov/source',
  ])('rejects local, private, literal, or non-public destinations: %s', (value) => {
    expect(safeExternalHttpsUrl(value)).toBeNull()
  })

  it('applies the maintained raw and canonical URL length bound', () => {
    const overlong = `https://data.cms.gov/${'a'.repeat(MAX_EXTERNAL_URL_LENGTH)}`
    expect(safeExternalHttpsUrl(overlong)).toBeNull()
  })

  it('allows bounded URNs only as non-navigable evidence locators', () => {
    expect(isSafeEvidenceLocator('urn:ushso:evidence:123')).toBe(true)
    expect(safeExternalHttpsUrl('urn:ushso:evidence:123')).toBeNull()
    expect(isSafeEvidenceLocator('urn:ushso:evidence with space')).toBe(false)
    expect(isSafeEvidenceLocator(`urn:ushso:${'a'.repeat(MAX_EXTERNAL_URL_LENGTH)}`)).toBe(false)
  })
})
