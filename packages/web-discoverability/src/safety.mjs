export const WEB_DISCOVERABILITY_VERSION = 'ushso-web-discoverability.v1.0.0-candidate';
export const SEO_ARTIFACT_VERSION = 'ushso-seo-generation.v1.0.0';
export const SEO_RECORD_DOCUMENT_VERSION = 'ushso-seo-record-document.v1.0.0';
export const SEO_RENDERER_VERSION = 'ushso-seo-html.v1.0.0';

export const LIMITS = Object.freeze({
  maxRecords: 50_000,
  maxAliases: 100_000,
  maxWithdrawals: 50_000,
  maxPublicIdChars: 240,
  maxTitleChars: 300,
  maxDescriptionChars: 2_000,
  maxPublisherChars: 300,
  maxCoverageLabelChars: 500,
  maxAccessLabelChars: 500,
  maxEvidenceSummaryChars: 1_000,
  maxEvidenceIds: 100,
  maxPublicLocatorAttestations: 120,
  maxSpatialCoverageItems: 50,
  maxDistributions: 50,
  maxUrlChars: 2_048,
  maxHtmlBytes: 256 * 1_024,
  maxArtifactBytes: 128 * 1_024 * 1_024,
  sitemapShardMaxUrls: 10_000,
  sitemapShardMaxBytes: 5 * 1_024 * 1_024,
  sitemapIndexMaxBytes: 1 * 1_024 * 1_024,
  maxSitemapShards: 1_000
});

const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const ABSOLUTE_HTTPS_PREFIX = /^https:\/\//iu;
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
const SIGNED_QUERY_NAME = /^(?:access[_-]?token|api[_-]?key|auth|authorization|awsaccesskeyid|bearer|code|credential|expires?|googleaccessid|jwt|key|key-pair-id|password|policy|s[aeikpstv]|secret|session|sig|signature|signed|ticket|token|x-amz-.+|x-goog-.+)$/iu;
const NON_PUBLIC_HOST_SUFFIX = /(?:^|\.)(?:home|internal|intranet|invalid|lan|local|localhost|onion|test)$/iu;
const SECRET_PATH_MARKER = /^(?:access[\s._-]?token|api[\s._-]?(?:key|token)|auth(?:orization)?|bearer|client[\s._-]?secret|credentials?|id[\s._-]?token|jwt|keys?|oauth[\s._-]?token|passwords?|private|private[\s._-]?key|refresh[\s._-]?token|sas|secrets?|session(?:[\s._-]?(?:id|key|token))?|shared[\s._-]?access[\s._-]?signature|sig(?:nature|v4)?|signed[\s._-]?url|subscription[\s._-]?key|tickets?|tokens?|x-amz-(?:credential|security-token|signature)|x-goog-(?:credential|signature))$/iu;
const SECRET_PATH_INLINE = /^(?:access[\s._-]?token|api[\s._-]?(?:key|token)|auth(?:orization)?|bearer|client[\s._-]?secret|credentials?|id[\s._-]?token|jwt|keys?|oauth[\s._-]?token|passwords?|private|private[\s._-]?key|refresh[\s._-]?token|sas|secrets?|session(?:[\s._-]?(?:id|key|token))?|shared[\s._-]?access[\s._-]?signature|sig(?:nature|v4)?|signed[\s._-]?url|subscription[\s._-]?key|tickets?|tokens?|x-amz-(?:credential|security-token|signature)|x-goog-(?:credential|signature))(?:=|:).+/iu;
const SECRET_VALUE = /(?:\bBearer[ _-]+[A-Za-z0-9._~+/=-]{8,}|-----BEGIN(?:%20|[ _-])(?:RSA(?:%20|[ _-])|EC(?:%20|[ _-])|OPENSSH(?:%20|[ _-]))?PRIVATE(?:%20|[ _-])KEY-----|\bAKIA[A-Z0-9]{16}\b|\bAIza[0-9A-Za-z_-]{30,}\b|\bgh[opsu]_[0-9A-Za-z]{20,}\b|\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b|\bxox[baprs]-[0-9A-Za-z-]{10,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)/iu;

export class WebDiscoverabilityError extends Error {
  constructor(code, detail = null) {
    super(`${code}${detail === null ? '' : `:${detail}`}`);
    this.name = 'WebDiscoverabilityError';
    this.code = code;
    this.detail = detail;
  }
}

export function fail(code, detail = null) {
  throw new WebDiscoverabilityError(code, detail);
}

export function assertSignal(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

export function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('SEO_OBJECT_INVALID', label);
  }
  return value;
}

export function assertExactKeys(value, required, optional, label) {
  assertPlainObject(value, label);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  const missing = required.filter(key => !Object.hasOwn(value, key));
  if (unknown.length) fail('SEO_FIELD_UNKNOWN', `${label}.${unknown.sort().join(',')}`);
  if (missing.length) fail('SEO_FIELD_MISSING', `${label}.${missing.sort().join(',')}`);
  return value;
}

export function stringValue(value, label, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    fail('SEO_STRING_INVALID', label);
  }
  return value;
}

export function nullableString(value, label, options) {
  return value === null ? null : stringValue(value, label, options);
}

export function publicId(value, label = 'public_id') {
  stringValue(value, label, { max: LIMITS.maxPublicIdChars });
  if (!PUBLIC_ID.test(value) || value === '.' || value === '..') fail('SEO_PUBLIC_ID_INVALID', label);
  return value;
}

export function identifierValue(value, label, { max = 240 } = {}) {
  stringValue(value, label, { max });
  if (/[\u0000-\u0020\u007f]/u.test(value)) fail('SEO_IDENTIFIER_INVALID', label);
  return value;
}

export function sha256Value(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('SEO_SHA256_INVALID', label);
  return value;
}

export function utcTimestamp(value, label) {
  if (typeof value !== 'string' || !UTC.test(value) || Number.isNaN(Date.parse(value))) fail('SEO_TIMESTAMP_INVALID', label);
  const parsed = new Date(value);
  if (parsed.toISOString().slice(0, 10) !== value.slice(0, 10)) fail('SEO_TIMESTAMP_INVALID', label);
  return value;
}

export function nullableDate(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) fail('SEO_DATE_INVALID', label);
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail('SEO_DATE_INVALID', label);
  return value;
}

function assertPublicHostname(hostname, label) {
  const labels = hostname.split('.');
  if (!hostname || hostname.length > 253 || hostname.endsWith('.') || !hostname.includes('.')
      || IPV4_LITERAL.test(hostname) || hostname.includes(':') || NON_PUBLIC_HOST_SUFFIX.test(hostname)
      || labels.some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(part))) {
    fail('SEO_URL_HOST_FORBIDDEN', label);
  }
}

function decodedPathname(pathname, label) {
  let decoded = pathname;
  for (let depth = 0; depth < 3; depth += 1) {
    let candidate;
    try {
      candidate = decodeURIComponent(decoded);
    } catch {
      fail('SEO_URL_PATH_ENCODING_INVALID', label);
    }
    if (candidate === decoded) return decoded;
    decoded = candidate;
  }
  if (/%[0-9a-f]{2}/iu.test(decoded)) fail('SEO_URL_PATH_ENCODING_DEPTH_EXCEEDED', label);
  return decoded;
}

function assertPublicPath(pathname, label) {
  const decoded = decodedPathname(pathname, label).normalize('NFKC');
  if (/[\\\u0000-\u001f\u007f]/u.test(decoded)) fail('SEO_URL_PATH_CONTROL_FORBIDDEN', label);
  if (SECRET_VALUE.test(decoded)) fail('SEO_SECRET_PATH_FORBIDDEN', label);
  const segments = decoded.split(/[\/;]/u).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (SECRET_PATH_INLINE.test(segment)) fail('SEO_SECRET_PATH_FORBIDDEN', label);
    if (SECRET_PATH_MARKER.test(segment) && typeof segments[index + 1] === 'string' && segments[index + 1].length > 0) {
      fail('SEO_SECRET_PATH_FORBIDDEN', label);
    }
  }
}

export function safePublicHttpsUrl(value, label, { allowQuery = false } = {}) {
  stringValue(value, label, { max: LIMITS.maxUrlChars });
  if (value !== value.trim() || /[\u0000-\u0020\u007f]/u.test(value) || value.includes('\\')) {
    fail('SEO_URL_CONTROL_CHAR', label);
  }
  if (!ABSOLUTE_HTTPS_PREFIX.test(value)) fail('SEO_URL_SCHEME_FORBIDDEN', label);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('SEO_URL_INVALID', label);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) fail('SEO_URL_SCHEME_FORBIDDEN', label);
  assertPublicHostname(parsed.hostname, label);
  for (const name of parsed.searchParams.keys()) if (SIGNED_QUERY_NAME.test(name)) fail('SEO_SIGNED_URL_FORBIDDEN', label);
  if (!allowQuery && parsed.search) fail('SEO_URL_QUERY_FORBIDDEN', label);
  if (parsed.hash) fail('SEO_URL_FRAGMENT_FORBIDDEN', label);
  assertPublicPath(parsed.pathname, label);
  const normalized = parsed.href;
  if (normalized.length > LIMITS.maxUrlChars) fail('SEO_URL_TOO_LONG', label);
  return normalized;
}

export function siteOrigin(value) {
  const normalized = safePublicHttpsUrl(value, 'site_origin', { allowQuery: false });
  const parsed = new URL(normalized);
  if (parsed.pathname !== '/') fail('SEO_SITE_ORIGIN_PATH_FORBIDDEN');
  return parsed.origin;
}

export function stableDatasetPath(id) {
  return `/datasets/${encodeURIComponent(publicId(id))}`;
}

export function canonicalDatasetUrl(origin, id) {
  return `${siteOrigin(origin)}${stableDatasetPath(id)}`;
}

export function htmlText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const htmlAttribute = htmlText;

export function xmlText(value) {
  return htmlText(value);
}

export function safeJsonForHtml(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu, character => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029'
  })[character]);
}

export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('SEO_CANONICAL_NUMBER_INVALID');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  assertPlainObject(value, 'canonical_json');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function sha256Hex(value, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle) fail('SEO_CRYPTO_UNAVAILABLE');
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await cryptoProvider.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  if (!Object.isFrozen(value)) Object.freeze(value);
  return value;
}

export function assertDeepFrozen(value, label) {
  const pending = [value];
  const seen = new WeakSet();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) continue;
    seen.add(candidate);
    if (!Object.isFrozen(candidate)) fail('SEO_OBJECT_NOT_DEEPLY_FROZEN', label);
    pending.push(...Object.values(candidate));
  }
  return value;
}

export function sortedUniqueStrings(value, label, { maxItems = LIMITS.maxEvidenceIds, maxChars = 240, minItems = 1 } = {}) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) fail('SEO_ARRAY_INVALID', label);
  const result = value.map((item, index) => stringValue(item, `${label}[${index}]`, { max: maxChars })).sort();
  if (new Set(result).size !== result.length) fail('SEO_ARRAY_DUPLICATE', label);
  return result;
}

export function assertByteLimit(value, limit, code) {
  const bytes = utf8Bytes(value);
  if (bytes > limit) fail(code, `${bytes}>${limit}`);
  return bytes;
}
