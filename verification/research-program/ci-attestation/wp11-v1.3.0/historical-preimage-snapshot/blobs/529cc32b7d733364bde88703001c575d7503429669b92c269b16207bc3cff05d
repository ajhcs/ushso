import {
  isSafeEvidenceLocator as sharedIsSafeEvidenceLocator,
  MAX_EXTERNAL_URL_LENGTH as sharedMaxExternalUrlLength,
  safeExternalHttpsUrl as sharedSafeExternalHttpsUrl,
} from '../../../../packages/retrieval/tools/external-url-policy.mjs'

export const MAX_EXTERNAL_URL_LENGTH = sharedMaxExternalUrlLength as number

/**
 * External routes are evidence-bearing data, not trusted application URLs.
 * Only canonical, public HTTPS URLs without credentials or signed query
 * parameters are navigable in the browser. IP literals are intentionally
 * excluded: evidence destinations must use a reviewable public DNS name.
 */
export function safeExternalHttpsUrl(value: unknown): string | null {
  return sharedSafeExternalHttpsUrl(value) as string | null
}

export function isSafeEvidenceLocator(value: unknown): value is string {
  return sharedIsSafeEvidenceLocator(value) as boolean
}
