import { asBytes } from './canonical.mjs';
import { classifyIpAddress } from './network-policy.mjs';
import { ConnectorResponseLimitError, DEFAULT_RESPONSE_LIMITS } from './route-manifest.mjs';

const ARCHIVE_MEDIA = new Set([
  'application/zip', 'application/x-zip-compressed', 'application/x-tar',
  'application/gzip', 'application/x-gzip', 'application/x-7z-compressed',
  'application/x-rar-compressed', 'application/octet-stream',
]);
const JSON_MEDIA = new Set(['application/json', 'application/ld+json']);
const TEXT_MEDIA = new Set(['text/html', 'text/plain', 'text/csv']);
const PAYLOAD_SENTINEL = /USHSONOEGRESS_(?:SOURCE_DATA_PAYLOAD|HEALTHCARE_ROW|QUERY_RESULT)/i;
const SECRET_OR_SIGNED_LOCATOR = /(?:https?:\\?\/\\?\/[\w.-]+[^\s"'<>]*[?&](?:x-amz-(?:credential|signature)|x-goog-(?:credential|signature)|awsaccesskeyid|googleaccessid|key-pair-id|signature|access_token|api_key)=)|(?:x-amz|x-goog)-(?:credential|signature)\s*(?:=|%3d)|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i;
const LOGIN_OR_CHALLENGE = /<(?:form|input)\b|type\s*=\s*["']?password|(?:sign|log)[ -]?in|captcha|cloudflare\s+(?:challenge|ray\s+id)|access\s+denied|verify\s+you\s+are\s+human/i;
const STRONG_CHALLENGE = /captcha|cloudflare\s+(?:challenge|ray\s+id)|verify\s+you\s+are\s+human/i;
const HTML_MARKUP = /<!doctype\s+html|<html\b|<body\b|<form\b/i;
const HEALTHCARE_ROW_KEYS = new Set([
  'patient_id', 'patientid', 'medical_record_number', 'mrn', 'beneficiary_id',
  'claim_id', 'diagnosis_code', 'procedure_code', 'admission_date',
  'discharge_date', 'member_id', 'subscriber_id', 'birth_date', 'date_of_birth',
]);
const METADATA_KEYS = new Set([
  'id', 'identifier', 'title', 'name', 'description', 'notes', 'publisher',
  'modified', 'created', 'issued', 'landingpage', 'accessurl', 'downloadurl',
  'distribution', 'dataset', 'theme', 'keyword', 'contactpoint', 'license',
  'columns', 'metadata', 'resource', 'resources', 'organization', 'type',
]);
const ROW_COLLECTION_KEYS = new Set(['rows', 'data', 'records', 'observations', 'results', 'items', 'features', 'measurements', 'values']);
const ROW_VALUE_KEYS = new Set(['value', 'values', 'amount', 'measure', 'measurement', 'measure_value', 'metric', 'count', 'code', 'category', 'year', 'month', 'quarter']);
const PRESENTATION_KEYS = new Set(['title', 'name', 'description', 'label', 'publisher', 'organization', 'metadata', 'landingpage', 'accessurl', 'downloadurl', 'url']);
const PRIVATE_HOST_SUFFIX = /(?:^|\.)(?:localhost|local|internal|home|lan|intranet)$/i;

function privateLocatorInText(text) {
  if (/\b(?:file|gopher):(?:\\?\/){2}/i.test(text)) return true;
  const expression = /(?:https?:\\?\/\\?\/|\\?\/\\?\/)[^\s"'<>]+/gi;
  for (const match of text.matchAll(expression)) {
    const normalized = match[0].replace(/\\\//g, '/').replace(/&amp;/gi, '&').replace(/[),.;]+$/, '');
    let locator;
    try { locator = new URL(normalized.startsWith('//') ? `https:${normalized}` : normalized); } catch { continue; }
    if (locator.username || locator.password) return true;
    const hostname = locator.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (/%2e/i.test(match[0]) || hostname.includes('..') || hostname.startsWith('.') || hostname.endsWith('.localhost')) return true;
    const address = classifyIpAddress(hostname);
    if (address.family !== null && !address.allowed) return true;
    if (!hostname.includes('.') || PRIVATE_HOST_SUFFIX.test(hostname)) return true;
  }
  return false;
}

export function mediaTypeFromHeaders(headers) {
  const raw = headers.get('content-type') ?? '';
  return raw.split(';', 1)[0].trim().toLowerCase();
}

function hasArchiveMagic(bytes) {
  const body = asBytes(bytes);
  return (body[0] === 0x50 && body[1] === 0x4b) ||
    (body[0] === 0x1f && body[1] === 0x8b) ||
    (body[0] === 0x37 && body[1] === 0x7a && body[2] === 0xbc && body[3] === 0xaf);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rowLikeObject(value) {
  const keys = Object.keys(value).map((key) => key.toLowerCase());
  const hasIdentity = keys.some((key) => key === 'id' || key === 'identifier' || key === 'record_id');
  const hasRowValue = keys.some((key) => ROW_VALUE_KEYS.has(key));
  const hasPresentation = keys.some((key) => PRESENTATION_KEYS.has(key));
  return hasIdentity && hasRowValue && !hasPresentation;
}

function inspectJsonShape(value, allowedMetadataCollectionKeys, limits) {
  const stack = [{ value, path: '', depth: 0 }];
  let nodes = 0;
  let privateLocator = false;
  let healthcareRows = false;
  let genericRows = false;

  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (current.depth > limits.maximum_response_depth || nodes > limits.maximum_response_nodes) {
      throw new ConnectorResponseLimitError('RESPONSE_STRUCTURE_LIMIT_EXCEEDED', 'Response structure exceeds its permitted depth or node count.');
    }

    if (typeof current.value === 'string') {
      if (privateLocatorInText(current.value)) privateLocator = true;
      continue;
    }
    if (Array.isArray(current.value)) {
      const objectItems = current.value.length > 0 && current.value.every(isPlainObject);
      if (objectItems && (current.path === '' || allowedMetadataCollectionKeys.has(current.path)) && current.value.length > limits.maximum_records) {
        throw new ConnectorResponseLimitError('RECORD_CARDINALITY_EXCEEDED', 'Response records exceed their permitted cardinality.');
      }
      if (objectItems && !allowedMetadataCollectionKeys.has(current.path)) {
        const metadataLike = current.value.every((item) => Object.keys(item).some((key) => METADATA_KEYS.has(key.toLowerCase())));
        if (!metadataLike || current.value.every(rowLikeObject)) genericRows = true;
      }
      if (current.value.length > 0 && current.depth >= limits.maximum_response_depth) {
        throw new ConnectorResponseLimitError('RESPONSE_STRUCTURE_LIMIT_EXCEEDED', 'Response structure exceeds its permitted depth or node count.');
      }
      if (nodes + stack.length + current.value.length > limits.maximum_response_nodes) {
        throw new ConnectorResponseLimitError('RESPONSE_STRUCTURE_LIMIT_EXCEEDED', 'Response structure exceeds its permitted depth or node count.');
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], path: `${current.path}/${index}`, depth: current.depth + 1 });
      }
      continue;
    }
    if (!isPlainObject(current.value)) continue;

    const keys = Object.keys(current.value).map((key) => key.toLowerCase());
    const sensitiveCount = keys.filter((key) => HEALTHCARE_ROW_KEYS.has(key)).length;
    if (sensitiveCount >= 2 || (sensitiveCount === 1 && keys.length >= 3 && keys.length <= 100)) healthcareRows = true;
    if (current.path !== '' && rowLikeObject(current.value)) genericRows = true;
    const entries = Object.entries(current.value);
    if (entries.length > 0 && current.depth >= limits.maximum_response_depth) {
      throw new ConnectorResponseLimitError('RESPONSE_STRUCTURE_LIMIT_EXCEEDED', 'Response structure exceeds its permitted depth or node count.');
    }
    if (nodes + stack.length + entries.length > limits.maximum_response_nodes) {
      throw new ConnectorResponseLimitError('RESPONSE_STRUCTURE_LIMIT_EXCEEDED', 'Response structure exceeds its permitted depth or node count.');
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      const childPath = `${current.path}/${key}`;
      if (Array.isArray(child) && child.length > 0 && ROW_COLLECTION_KEYS.has(key.toLowerCase()) && !allowedMetadataCollectionKeys.has(childPath)) {
        genericRows = true;
      }
      stack.push({ value: child, path: childPath, depth: current.depth + 1 });
    }
  }

  return { privateLocator, healthcareRows, genericRows };
}

function accepted(classification, parsed = null) {
  return { accepted: true, classification, reasonCode: null, parsed };
}

function rejected(reasonCode, suspectedClassification) {
  return { accepted: false, classification: suspectedClassification, reasonCode, parsed: null };
}

export function classifyResponse({ purpose, expectedContentClasses, headers, bodyBytes, profile, limits = DEFAULT_RESPONSE_LIMITS }) {
  const bytes = asBytes(bodyBytes);
  const mediaType = mediaTypeFromHeaders(headers);
  if (bytes.byteLength === 0) return rejected('EMPTY_METADATA_BODY', 'schema_drift');
  if (ARCHIVE_MEDIA.has(mediaType) || hasArchiveMagic(bytes)) return rejected('ARCHIVE_RESPONSE_QUARANTINED', 'archive_member');
  if (![...JSON_MEDIA, ...TEXT_MEDIA, 'application/xml'].includes(mediaType)) {
    return rejected('UNEXPECTED_CONTENT_TYPE', 'unknown');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return rejected('INVALID_UTF8_CONTENT', 'unknown');
  }
  if (PAYLOAD_SENTINEL.test(text)) return rejected('PAYLOAD_SENTINEL_RESPONSE_QUARANTINED', 'source_data_payload');
  if (SECRET_OR_SIGNED_LOCATOR.test(text)) return rejected('SECRET_OR_SIGNED_LOCATOR_QUARANTINED', 'credential_or_signed_locator');
  if (privateLocatorInText(text)) return rejected('PRIVATE_LOCATOR_QUARANTINED', 'private_locator');
  const looksHtml = HTML_MARKUP.test(text.slice(0, 8192));
  if (looksHtml && LOGIN_OR_CHALLENGE.test(text.slice(0, 131072))) return rejected('LOGIN_FORM_OR_CHALLENGE_QUARANTINED', 'login_or_form');
  if (STRONG_CHALLENGE.test(text.slice(0, 131072))) return rejected('LOGIN_FORM_OR_CHALLENGE_QUARANTINED', 'login_or_form');
  if (looksHtml && mediaType !== 'text/html') return rejected('MISLEADING_CONTENT_TYPE_HTML', 'misleading_content_type');
  const xmlCatalogMetadata = purpose === 'catalog_metadata' && mediaType === 'application/xml' && profile?.allowXmlCatalogMetadata === true;
  if (purpose === 'catalog_metadata' && !JSON_MEDIA.has(mediaType) && !mediaType.endsWith('+json') && !xmlCatalogMetadata) {
    return rejected('CATALOG_METADATA_REQUIRES_JSON', 'unexpected_content_type');
  }

  if (JSON_MEDIA.has(mediaType) || mediaType.endsWith('+json')) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return rejected('JSON_PARSE_FAILURE', 'parse_failure');
    }
    const permittedMetadataCollections = new Set(Array.isArray(profile?.metadataCollectionPaths) ? profile.metadataCollectionPaths : []);
    const shape = inspectJsonShape(parsed, permittedMetadataCollections, limits);
    if (shape.privateLocator) return rejected('PRIVATE_LOCATOR_QUARANTINED', 'private_locator');
    if (shape.healthcareRows) return rejected('HEALTHCARE_ROW_SHAPE_QUARANTINED', 'healthcare_rows');
    if (shape.genericRows) return rejected('ROW_SHAPED_RESPONSE_QUARANTINED', 'source_data_payload');
    if (typeof profile?.validateJson !== 'function') return rejected('JSON_ADAPTER_PROFILE_REQUIRED', 'schema_drift');
    const result = profile.validateJson(parsed, { purpose, expectedContentClasses });
    if (!result?.accepted) return rejected(result?.reasonCode ?? 'ADAPTER_SCHEMA_DRIFT', result?.classification ?? 'schema_drift');
    return accepted(result.classification ?? (purpose === 'schema' ? 'schema_metadata' : 'catalog_metadata'), parsed);
  }

  if (mediaType === 'text/html') {
    if (!looksHtml) return rejected('MISLEADING_CONTENT_TYPE_NON_HTML', 'misleading_content_type');
    if (purpose !== 'documentation' && !expectedContentClasses.includes('documentation_page')) {
      return rejected('HTML_NOT_ALLOWED_FOR_ROUTE', 'unexpected_content_type');
    }
    if (/<form\b/i.test(text)) return rejected('FORM_CONTENT_QUARANTINED', 'login_or_form');
    if (typeof profile?.validateText !== 'function') return rejected('HTML_ADAPTER_PROFILE_REQUIRED', 'schema_drift');
    const result = profile.validateText(text, { purpose, expectedContentClasses, mediaType });
    if (!result?.accepted) return rejected(result?.reasonCode ?? 'ADAPTER_SCHEMA_DRIFT', result?.classification ?? 'schema_drift');
    return accepted(result.classification ?? 'documentation', null);
  }

  if (mediaType === 'text/csv') {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length > 1) return rejected('CSV_ROW_PAYLOAD_QUARANTINED', 'source_data_payload');
    if (typeof profile?.validateText !== 'function') return rejected('CSV_ADAPTER_PROFILE_REQUIRED', 'schema_drift');
    const result = profile.validateText(text, { purpose, expectedContentClasses, mediaType });
    if (!result?.accepted) return rejected(result?.reasonCode ?? 'ADAPTER_SCHEMA_DRIFT', result?.classification ?? 'schema_drift');
    return accepted(result.classification ?? (purpose === 'schema' ? 'schema_metadata' : 'documentation'), null);
  }

  if (mediaType === 'text/plain') {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const delimiters = [',', '\t', '|'];
    const tabular = lines.length > 1 && delimiters.some((delimiter) => {
      const widths = lines.map((line) => line.split(delimiter).length);
      return widths[0] > 1 && widths.every((width) => width === widths[0]);
    });
    if (tabular) return rejected('TEXT_ROW_PAYLOAD_QUARANTINED', 'source_data_payload');
    if (typeof profile?.validateText !== 'function') return rejected('PLAIN_TEXT_ADAPTER_PROFILE_REQUIRED', 'schema_drift');
    const result = profile.validateText(text, { purpose, expectedContentClasses, mediaType });
    if (!result?.accepted) return rejected(result?.reasonCode ?? 'ADAPTER_SCHEMA_DRIFT', result?.classification ?? 'schema_drift');
    return accepted(result.classification ?? (purpose === 'schema' ? 'schema_metadata' : 'documentation'), null);
  }

  if (mediaType === 'application/xml') {
    if (typeof profile?.validateText !== 'function') return rejected('XML_ADAPTER_PROFILE_REQUIRED', 'schema_drift');
    const result = profile.validateText(text, { purpose, expectedContentClasses, mediaType });
    if (!result?.accepted) return rejected(result?.reasonCode ?? 'ADAPTER_SCHEMA_DRIFT', result?.classification ?? 'schema_drift');
    return accepted(result.classification ?? 'catalog_metadata', null);
  }

  return rejected('UNVALIDATED_METADATA_RESPONSE', 'schema_drift');
}
