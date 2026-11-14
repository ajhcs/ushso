import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from './validation'
const pin={generation_id:'a'.repeat(64),data_manifest_sha256:'a'.repeat(64),ranking_version:'synthetic.v1',schema_version:'ushso.source-selection.v1' as const}
const item={asset_id:'synthetic:a',decision:'consider' as const,note:'',snapshot:{schema_version:pin.schema_version,asset_id:'synthetic:a',publisher_id:'synthetic:p',title:'Synthetic source',generation_id:pin.generation_id,assertion_ids:[],evidence_ids:[]}}
let data:Map<string,string>
beforeEach(()=>{vi.resetModules();data=new Map();vi.stubGlobal('window',{localStorage:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)},addEventListener:vi.fn()})})
afterEach(()=>vi.unstubAllGlobals())
it('keeps the default shortlist in memory and saves questions only with separate consent',async()=>{
 const store=await import('./store');store.openShortlist();store.addSource(item,pin);expect(data.size).toBe(0)
 store.saveOnDevice(false,'Synthetic private question');let saved=JSON.parse(data.get(STORAGE_KEY)!);expect(saved.question).toBeUndefined();expect(saved.storage_consent.version).toBe('1');expect(Date.parse(saved.expires_at)-Date.parse(saved.storage_consent.granted_at)).toBe(30*86400000)
 store.saveOnDevice(true,'Synthetic private question');saved=JSON.parse(data.get(STORAGE_KEY)!);expect(saved.question).toBe('Synthetic private question')
 store.saveOnDevice(false,'Synthetic private question');expect(JSON.parse(data.get(STORAGE_KEY)!).question).toBeUndefined()
 store.clearShortlist();expect(data.has(STORAGE_KEY)).toBe(false)
})
it('purges expired saved state on opening and refuses silent multi-tab overwrite',async()=>{
 const store=await import('./store');store.addSource(item,pin);store.saveOnDevice(false,'');const saved=JSON.parse(data.get(STORAGE_KEY)!);saved.revision+=10;data.set(STORAGE_KEY,JSON.stringify(saved));store.editItem(item.asset_id,{note:'local change'});expect(JSON.parse(data.get(STORAGE_KEY)!).revision).toBe(saved.revision)
 store.clearShortlist();saved.expires_at='2000-01-01T00:00:00Z';data.set(STORAGE_KEY,JSON.stringify(saved));vi.resetModules();const reopened=await import('./store');reopened.openShortlist();expect(data.has(STORAGE_KEY)).toBe(false)
})
it('does not claim confirmed device deletion when storage removal fails',async()=>{
 const store=await import('./store');store.addSource(item,pin);store.saveOnDevice(false,'');(window.localStorage.removeItem as unknown as (key:string)=>void)=()=>{throw new Error('storage blocked')};store.clearShortlist();expect(data.has(STORAGE_KEY)).toBe(true)
 const {renderToStaticMarkup}=await import('react-dom/server');const {createElement}=await import('react');const Status=()=>createElement('p',{},store.useShortlist().message);expect(renderToStaticMarkup(createElement(Status))).toContain('removal could not be confirmed')
})
