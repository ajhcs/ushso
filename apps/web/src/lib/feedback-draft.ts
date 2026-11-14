import { safeExternalHttpsUrl } from './externalUrls'
import { validPin } from '../features/shortlist/validation'
import type { PublicationPin } from '../features/shortlist/types'
export const FEEDBACK_OUTCOMES = ['useful','missing_source','access_problem','incorrect_metadata','interface_problem','other'] as const
export interface FeedbackDraft {
  schema_version: 'ushso.feedback-draft.v1'
  outcome: typeof FEEDBACK_OUTCOMES[number]
  asset_id?: string
  legacy_record_id?: string
  pin?: PublicationPin
  source_url?: string
  text?: string
  permission_to_reply: boolean
}
export function feedbackDraft(input: unknown): FeedbackDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid feedback draft.')
  const value = input as Record<string,unknown>
  const allowed = ['schema_version','outcome','asset_id','legacy_record_id','pin','source_url','text','permission_to_reply']
  if (Object.keys(value).some(key=>!allowed.includes(key)) || value.schema_version !== 'ushso.feedback-draft.v1' || !FEEDBACK_OUTCOMES.includes(value.outcome as FeedbackDraft['outcome']) || typeof value.permission_to_reply !== 'boolean') throw new Error('Invalid feedback draft fields.')
  for (const [key,limit] of [['asset_id',200],['legacy_record_id',200],['source_url',2048],['text',2000]] as const) {
    const item=value[key]
    if (item !== undefined && (typeof item !== 'string' || item.length>limit || /[\u0000-\u001f\u007f]/.test(item))) throw new Error(`${key.replaceAll('_',' ')} contains control characters or exceeds ${limit} characters.`)
  }
  if (value.pin !== undefined && !validPin(value.pin)) throw new Error('Invalid publication pin.')
  // Legacy IDs may be supplied only by a caller that has already resolved an explicit mapping.
  if (value.legacy_record_id && !value.asset_id) throw new Error('Legacy record requires an explicitly mapped source ID.')
  if (value.source_url && (typeof value.source_url !== 'string' || !/^https?:\/\//i.test(value.source_url) || !safeExternalHttpsUrl(value.source_url.replace(/^http:/i,'https:')))) throw new Error('Source URL must be a safe public HTTP or HTTPS URL.')
  return {...value} as unknown as FeedbackDraft
}
export function feedbackPreview(input: unknown): string {
  const value=feedbackDraft(input)
  const rows=[`USHSO feedback draft (${value.schema_version})`,`Outcome: ${value.outcome.replaceAll('_',' ')}`]
  if (value.asset_id) rows.push(`Source ID: ${value.asset_id}`)
  if (value.legacy_record_id) rows.push(`Mapped legacy record: ${value.legacy_record_id}`)
  if (value.pin) rows.push(`Publication: ${value.pin.generation_id}`,`Data manifest: ${value.pin.data_manifest_sha256}`,`Ranking: ${value.pin.ranking_version}`)
  if (value.source_url) rows.push(`Supporting source: ${value.source_url}`)
  if (value.text) rows.push(`Feedback: ${value.text}`)
  rows.push(`Permission to reply: ${value.permission_to_reply ? 'requested' : 'not granted'}`)
  return rows.join('\n')
}
// New draft mailto is disabled until processor/operator/retention governance is configured.
export const FEEDBACK_EMAIL_DRAFT_ENABLED = false
export function feedbackMailto(input: unknown, enabled = FEEDBACK_EMAIL_DRAFT_ENABLED): string | null {
  const body=feedbackPreview(input)
  if (!enabled) return null
  const url=`mailto:info@ushso.org?subject=${encodeURIComponent('USHSO catalog feedback')}&body=${encodeURIComponent(body)}`
  return url.length <= 1800 ? url : null
}
