import {safePreservedHttpUrl} from '../../../../../packages/retrieval/tools/external-url-policy.mjs'
import { safeExternalHttpsUrl } from '../../lib/externalUrls'
import type { LocalShortlist, PublicationPin, SourceSnapshot } from './types'
export const STORAGE_KEY = 'ushso.shortlist.v1'
export const MAX_ITEMS = 50
const hash = /^[a-f0-9]{64}$/
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export function validPin(value: unknown): value is PublicationPin {
  return object(value) && typeof value.generation_id === 'string' && hash.test(value.generation_id) && value.generation_id === value.data_manifest_sha256 && typeof value.ranking_version === 'string' && !!value.ranking_version && value.schema_version === 'ushso.source-selection.v1'
}
export function samePin(a: PublicationPin, b: PublicationPin) {
  return a.generation_id === b.generation_id && a.data_manifest_sha256 === b.data_manifest_sha256 && a.ranking_version === b.ranking_version && a.schema_version === b.schema_version
}
function safeValues(value: unknown, depth = 0, preservedLocator = false): boolean {
  if (depth > 32) return false
  if (typeof value === 'string') return !/<\/?[a-z][^>]*>/i.test(value) && (preservedLocator && !!safePreservedHttpUrl(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value) || !/^(?:https?|javascript|data|vbscript|file|ftp):/i.test(value) || !!safeExternalHttpsUrl(value))
  if (Array.isArray(value)) return value.every(item => safeValues(item, depth + 1))
  if (object(value)) return Object.entries(value).every(([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && (!/(?:^|_)(?:url|href|locator)$/i.test(key) || item === null || (typeof item === 'string' && (!!safeExternalHttpsUrl(item) || key==='canonical_url'&&!!safePreservedHttpUrl(item)))) && safeValues(item, depth + 1, key==='canonical_url'))
  return value === null || ['number', 'boolean'].includes(typeof value)
}
export function validSnapshot(value: unknown, pin: PublicationPin): value is SourceSnapshot {
  return object(value) && value.schema_version === pin.schema_version && value.generation_id === pin.generation_id && typeof value.asset_id === 'string' && !!value.asset_id && typeof value.publisher_id === 'string' && !!value.publisher_id && typeof value.title === 'string' && Array.isArray(value.assertion_ids) && value.assertion_ids.every(id => typeof id === 'string') && Array.isArray(value.evidence_ids) && value.evidence_ids.every(id => typeof id === 'string') && validCitations(value.citations,value.evidence_ids) && safeValues(value)
}
export function parseShortlist(text: string, now = Date.now()): LocalShortlist {
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('Import exceeds 1 MiB.')
  const value: unknown = JSON.parse(text)
  if (!object(value) || value.schema_version !== STORAGE_KEY || !validPin(value.pin) || typeof value.id !== 'string' || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.items) || value.items.length > MAX_ITEMS) throw new Error('Invalid shortlist schema.')
  for (const field of ['created_at', 'updated_at']) if (typeof value[field] !== 'string' || !Number.isFinite(Date.parse(value[field] as string))) throw new Error('Invalid shortlist date.')
  if (value.expires_at !== null && (typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at)))) throw new Error('Invalid expiry.')
  if (value.expires_at && Date.parse(value.expires_at as string) <= now) throw new Error('Shortlist expired.')
  if (value.storage_consent !== null && (!object(value.storage_consent) || value.storage_consent.version !== '1' || typeof value.storage_consent.granted_at !== 'string' || !Number.isFinite(Date.parse(value.storage_consent.granted_at)))) throw new Error('Invalid storage consent.')
  if (value.question !== undefined && (typeof value.question !== 'string' || value.question.length > 2000)) throw new Error('Question exceeds 2,000 characters.')
  const ids = new Set<string>()
  for (const item of value.items) {
    if (!object(item) || !validSnapshot(item.snapshot, value.pin) || item.asset_id !== item.snapshot.asset_id || !['include', 'exclude', 'consider'].includes(String(item.decision)) || typeof item.note !== 'string' || item.note.length > 2000 || ids.has(item.snapshot.asset_id)) throw new Error('Invalid, duplicate, or mixed-generation item.')
    ids.add(item.snapshot.asset_id)
  }
  if (!safeValues(value)) throw new Error('HTML or unsafe external URLs are not accepted.')
  return value as unknown as LocalShortlist
}

function validCitations(value: unknown,evidenceIds: unknown[]): boolean {
 if(value===undefined)return true // Old device snapshots remain unverified compatibility inputs.
 if(!Array.isArray(value)||value.length!==evidenceIds.length||new Set(value.map(item=>item?.capture_id)).size!==value.length)return false
 return value.every(item=>object(item)&&Object.keys(item).sort().join(',')==='canonical_url,capture_id,content_sha256,locator_scheme,locators,retrieved_at'&&typeof item.capture_id==='string'&&evidenceIds.includes(item.capture_id)
  &&typeof item.canonical_url==='string'&&!!(safeExternalHttpsUrl(item.canonical_url)||safePreservedHttpUrl(item.canonical_url))
  &&typeof item.retrieved_at==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(item.retrieved_at)&&Number.isFinite(Date.parse(item.retrieved_at))&&new Date(item.retrieved_at).toISOString().slice(0,10)===item.retrieved_at.slice(0,10)
  &&(item.content_sha256===null||typeof item.content_sha256==='string'&&hash.test(item.content_sha256))&&typeof item.locator_scheme==='string'&&!!item.locator_scheme.trim()
  &&Array.isArray(item.locators)&&item.locators.length>0&&item.locators.every(locator=>typeof locator==='string'&&!!locator.trim()||object(locator)&&Object.keys(locator).sort().join(',')==='end,start'&&Number.isSafeInteger(locator.start)&&Number.isSafeInteger(locator.end)&&Number(locator.start)>=0&&Number(locator.end)>Number(locator.start)))
}
