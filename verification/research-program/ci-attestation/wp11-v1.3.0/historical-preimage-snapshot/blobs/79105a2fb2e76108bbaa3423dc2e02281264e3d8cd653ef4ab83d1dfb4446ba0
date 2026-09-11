const ASCII_CONTROL = /[\u0000-\u001f\u007f]/;
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const SIGNED_QUERY_NAME = /^(?:access[_-]?token|api[_-]?key|auth|authorization|awsaccesskeyid|bearer|code|credential|expires?|googleaccessid|jwt|key|key-pair-id|password|policy|s[aeikpstv]|secret|session|sig|signature|signed|ticket|token|x-amz-.+|x-goog-.+)$/iu;
const NON_PUBLIC_HOST_SUFFIX = /(?:^|\.)(?:home|internal|intranet|invalid|lan|local|localhost|onion|test)$/i;

export const MAX_EXTERNAL_URL_LENGTH = 2_048;

function isPublicHostname(hostname) {
  const labels = hostname.split('.');
  return Boolean(
    hostname
    && hostname.length <= 253
    && !hostname.endsWith('.')
    && hostname.includes('.')
    && !IPV4_LITERAL.test(hostname)
    && !hostname.includes(':')
    && !NON_PUBLIC_HOST_SUFFIX.test(hostname)
    && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  );
}

function isSignedQueryName(name) {
  let candidate = name;
  for (let depth = 0; depth < 3; depth += 1) {
    if (SIGNED_QUERY_NAME.test(candidate)) return true;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return false;
      candidate = decoded;
    } catch {
      return false;
    }
  }
  return SIGNED_QUERY_NAME.test(candidate);
}

function safePublicUrl(value, protocol) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EXTERNAL_URL_LENGTH
    || value !== value.trim() || ASCII_CONTROL.test(value) || value.includes('\\')
    || !value.toLowerCase().startsWith(`${protocol}//`) || value[protocol.length + 2] === '/') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== protocol || parsed.username || parsed.password || !isPublicHostname(parsed.hostname)) return null;
    if ([...parsed.searchParams.keys()].some(isSignedQueryName)) return null;
    return parsed.href.length <= MAX_EXTERNAL_URL_LENGTH ? parsed.href : null;
  } catch {
    return null;
  }
}

export function safeExternalHttpsUrl(value) {
  return safePublicUrl(value, 'https:');
}

export function safePreservedHttpUrl(value) {
  return safePublicUrl(value, 'http:');
}

export function isSafeEvidenceLocator(value) {
  if (safeExternalHttpsUrl(value) !== null) return true;
  return typeof value === 'string'
    && value.length <= MAX_EXTERNAL_URL_LENGTH
    && value === value.trim()
    && !ASCII_CONTROL.test(value)
    && /^urn:[a-z0-9][a-z0-9-]{0,31}:[^\s]+$/i.test(value);
}
