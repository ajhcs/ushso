const ASCII_CONTROL = /[\u0000-\u001f\u007f]/
const ABSOLUTE_HTTPS_PREFIX = /^https:\/\//i
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/
const SIGNED_QUERY_NAME = /^(?:access[_-]?token|api[_-]?key|auth|authorization|awsaccesskeyid|bearer|code|credential|expires?|googleaccessid|jwt|key|key-pair-id|password|policy|s[aeikpstv]|secret|session|sig|signature|signed|ticket|token|x-amz-.+|x-goog-.+)$/iu
const NON_PUBLIC_HOST_SUFFIX = /(?:^|\.)(?:home|internal|intranet|invalid|lan|local|localhost|onion|test)$/i

export const MAX_EXTERNAL_URL_LENGTH = 2_048

function isPublicHostname(hostname: string): boolean {
  const labels = hostname.split('.')
  if (
    !hostname
    || hostname.length > 253
    || hostname.endsWith('.')
    || !hostname.includes('.')
    || IPV4_LITERAL.test(hostname)
    || hostname.includes(':')
    || NON_PUBLIC_HOST_SUFFIX.test(hostname)
    || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  ) return false

  return true
}

function isSignedQueryName(name: string): boolean {
  let candidate = name
  for (let depth = 0; depth < 3; depth += 1) {
    if (SIGNED_QUERY_NAME.test(candidate)) return true
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return false
      candidate = decoded
    } catch {
      return false
    }
  }
  return SIGNED_QUERY_NAME.test(candidate)
}

/**
 * External routes are evidence-bearing data, not trusted application URLs.
 * Only canonical, public HTTPS URLs without credentials or signed query
 * parameters are navigable in the browser. IP literals are intentionally
 * excluded: evidence destinations must use a reviewable public DNS name.
 */
export function safeExternalHttpsUrl(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_EXTERNAL_URL_LENGTH
    || value !== value.trim()
    || ASCII_CONTROL.test(value)
    || value.includes('\\')
    || !ABSOLUTE_HTTPS_PREFIX.test(value)
  ) return null

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !isPublicHostname(parsed.hostname)) return null
    if ([...parsed.searchParams.keys()].some(isSignedQueryName)) return null

    const canonical = parsed.href
    return canonical.length <= MAX_EXTERNAL_URL_LENGTH ? canonical : null
  } catch {
    return null
  }
}

export function isSafeEvidenceLocator(value: unknown): value is string {
  if (safeExternalHttpsUrl(value) !== null) return true
  return typeof value === 'string'
    && value.length <= MAX_EXTERNAL_URL_LENGTH
    && value === value.trim()
    && !ASCII_CONTROL.test(value)
    && /^urn:[a-z0-9][a-z0-9-]{0,31}:[^\s]+$/i.test(value)
}
