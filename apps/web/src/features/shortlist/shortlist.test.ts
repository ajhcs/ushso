import { describe, expect, it } from 'vitest'
import { parseShortlist, samePin } from './validation'
import { canonicalJson, importBrief, selectionBrief } from './export'
import type { LocalShortlist } from './types'
const pin = {generation_id:'a'.repeat(64),data_manifest_sha256:'a'.repeat(64),ranking_version:'ranking.v1',schema_version:'ushso.source-selection.v1' as const}
const fixture = (): LocalShortlist => ({schema_version:'ushso.shortlist.v1',id:'synthetic',created_at:'2026-11-13T00:00:00Z',updated_at:'2026-11-13T00:00:00Z',expires_at:null,storage_consent:null,pin:{...pin},question:'Synthetic private question',revision:0,items:[{asset_id:'synthetic:a',decision:'consider',note:'Synthetic note',snapshot:{schema_version:pin.schema_version,asset_id:'synthetic:a',publisher_id:'synthetic:p',generation_id:pin.generation_id,title:'Synthetic source',assertion_ids:['synthetic:assertion'],evidence_ids:['synthetic:evidence'],geography:{status:'unresolved',value:null,assertion_ids:[],evidence_ids:[]}}}]})
describe('shortlist boundaries',()=>{
  it('rejects mixed pins, duplicate items, expiry, oversized notes and unsafe imported URLs',()=>{
    const mixed=fixture(); mixed.items[0].snapshot.generation_id='b'.repeat(64); expect(()=>parseShortlist(JSON.stringify(mixed))).toThrow(/mixed-generation/)
    const duplicate=fixture(); duplicate.items.push(duplicate.items[0]); expect(()=>parseShortlist(JSON.stringify(duplicate))).toThrow(/duplicate/)
    const expired=fixture(); expired.expires_at='2000-01-01T00:00:00Z'; expect(()=>parseShortlist(JSON.stringify(expired))).toThrow(/expired/)
    const long=fixture(); long.items[0].note='a'.repeat(2001); expect(()=>parseShortlist(JSON.stringify(long))).toThrow()
    const unsafe=fixture(); unsafe.items[0].snapshot.url='https://user:pass@example.org/'; expect(()=>parseShortlist(JSON.stringify(unsafe))).toThrow()
  })
  it('requires exact manifest pin and rejects alias substitutions',()=>{
    expect(samePin(pin,{...pin,ranking_version:'other'})).toBe(false)
    const list=fixture(); list.pin.generation_id='v1.2.0'; expect(()=>parseShortlist(JSON.stringify(list))).toThrow(/schema/)
  })
  it('exports deterministic JSON with per-export question consent and bound citations',async()=>{
    const list=fixture(), timestamp='2026-11-13T01:00:00Z'
    const first=await selectionBrief(list,timestamp)
    expect(first).toBe(await selectionBrief(list,timestamp))
    expect((await importBrief(first)).items[0].snapshot).toEqual(list.items[0].snapshot)
    const tampered = JSON.parse(first); tampered.items[0].note = 'tampered'; await expect(importBrief(JSON.stringify(tampered))).rejects.toThrow(/checksum/)
    expect(first).not.toContain('Synthetic private question')
    const parsed=JSON.parse(first); expect(parsed.question).toBeNull(); expect(parsed.items[0].citations[0].pin).toEqual(pin)
    expect(JSON.parse(await selectionBrief(list,timestamp,true)).question).toBe(list.question)
    const digest=parsed.content_sha256; delete parsed.content_sha256
    const actual=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(parsed)))
    expect(digest).toBe(Array.from(new Uint8Array(actual),v=>v.toString(16).padStart(2,'0')).join(''))
  })
})

it('exports usable pinned publisher citations, retains absent hashes and rejects contradictory citation copies',async()=>{
 const list=fixture();list.items[0].snapshot.citations=[{capture_id:'synthetic:evidence',canonical_url:'https://example.org/catalog/source',retrieved_at:'2026-11-13T00:00:00Z',content_sha256:null,locator_scheme:'section',locators:['Source metadata']}]
 const brief=JSON.parse(await selectionBrief(list,'2026-11-13T01:00:00Z'))
 expect(brief.items[0].citations[0]).toEqual({...list.items[0].snapshot.citations[0],pin})
 expect(brief.items[0].citations[0].content_sha256).toBeNull()
 expect((await importBrief(JSON.stringify(brief))).items[0].snapshot.citations).toEqual(list.items[0].snapshot.citations)
 brief.items[0].citations[0].canonical_url='https://example.org/different';delete brief.content_sha256
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(brief)));brief.content_sha256=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')
 await expect(importBrief(canonicalJson(brief))).rejects.toThrow(/does not match/)
 const invalid=fixture();invalid.items[0].snapshot.citations=[{...list.items[0].snapshot.citations[0],capture_id:'different'}]
 expect(()=>parseShortlist(JSON.stringify(invalid))).toThrow(/mixed-generation/)
})
