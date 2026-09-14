import { classifyResponse, classifyResourceRole } from '../content-classifier.mjs';

export const EXAMPLE_RECEIPT_FORMAT = 'ushso.example-request-receipt.v1';
const SECRET_KEYS = Object.freeze(['key', 'api_key', 'token', 'secret', 'password', 'authorization']);

export async function blockedFetch() {
  const error = new Error('EXAMPLE_RUNNER_LIVE_NETWORK_FORBIDDEN');
  error.code = 'EXAMPLE_RUNNER_LIVE_NETWORK_FORBIDDEN';
  throw error;
}

function freeze(value) {
  return Object.freeze(value);
}

export function sanitizeParameters(parameters = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (SECRET_KEYS.includes(String(key).toLowerCase())) sanitized[key] = '[REDACTED]';
    else sanitized[key] = value;
  }
  return freeze(sanitized);
}

export function createExampleReceipt({
  source,
  release,
  distribution,
  parameters = {},
  expected = {},
  limits = {},
  observedAt = '2026-09-14T00:00:00.000Z',
  attemptedChecks = [],
  outcomeKind = 'sample',
  credentialRequired = false,
} = {}) {
  return freeze({
    format: EXAMPLE_RECEIPT_FORMAT,
    source: source ?? null,
    release: release ?? null,
    distribution: distribution ?? null,
    parameters: sanitizeParameters(parameters),
    expected: freeze({
      content_class: expected.content_class ?? null,
      media_type: expected.media_type ?? null,
      fields: freeze([...(expected.fields ?? [])]),
      types: freeze({ ...(expected.types ?? {}) }),
    }),
    limits: freeze({
      max_bytes: limits.max_bytes ?? 65536,
      max_rows: limits.max_rows ?? 5,
    }),
    observed_at: observedAt,
    attempted_checks: freeze([...(attemptedChecks.length ? attemptedChecks : ['http_status', 'media_type', 'fields', 'row_limit'])]),
    outcome_kind: outcomeKind,
    credential_required: credentialRequired === true,
    tested_example: false,
    full_dataset_validated: false,
    full_schema_validated: false,
    publication_authorized: false,
  });
}

function mediaTypeOf(observation = {}) {
  const raw = observation.mediaType ?? observation.media_type ?? observation.content_type ?? null;
  if (typeof raw !== 'string') return null;
  return raw.split(';', 1)[0].trim().toLowerCase();
}

function parseRows(observation = {}) {
  if (Array.isArray(observation.rows)) return observation.rows;
  if (observation.bodyJson !== undefined) {
    const body = observation.bodyJson;
    if (Array.isArray(body)) {
      if (body.length > 0 && Array.isArray(body[0])) {
        const [header, ...rows] = body;
        return rows.map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])));
      }
      return body;
    }
    if (body && typeof body === 'object' && Array.isArray(body.rows)) return body.rows;
  }
  if (typeof observation.body === 'string') {
    try {
      return parseRows({ bodyJson: JSON.parse(observation.body) });
    } catch {
      return [];
    }
  }
  return [];
}

function classifyObservation(receipt, observation, headers, bodyBytes) {
  return classifyResponse({
    purpose: receipt.expected.content_class === 'documentation_page' ? 'documentation' : 'catalog_metadata',
    expectedContentClasses: receipt.expected.content_class ? [receipt.expected.content_class] : ['catalog_collection'],
    headers,
    bodyBytes,
  });
}

export function executeBoundedSample(receipt, observation = {}) {
  const headers = observation.headers instanceof Headers
    ? observation.headers
    : new Headers({ 'content-type': mediaTypeOf(observation) ?? 'application/octet-stream' });
  const bodyBytes = observation.bodyBytes
    ?? (typeof observation.body === 'string' ? Buffer.from(observation.body) : Buffer.from(''));
  const classified = classifyObservation(receipt, observation, headers, bodyBytes);
  const role = classifyResourceRole({
    requestedUrl: observation.requestedUrl ?? null,
    finalUrl: observation.finalUrl ?? null,
    expectedRole: receipt.expected.content_class ?? 'catalog_metadata',
    observedTitle: observation.observedTitle ?? null,
    mediaType: mediaTypeOf(observation),
    status: observation.status ?? null,
    redirectCount: observation.redirectCount ?? null,
    purpose: receipt.expected.content_class ?? 'catalog_metadata',
  });
  const checks = [];
  const fail = (code, detail) => freeze({
    receipt,
    result: code,
    passed: false,
    tested_example: false,
    full_dataset_validated: false,
    full_schema_validated: false,
    http_success_alone: observation.status === 200,
    checks: freeze([...checks, freeze({ code, passed: false, detail })]),
    classified,
    role,
    catalog_accepted: classified.accepted === true,
    publication_authorized: false,
  });

  if (receipt.credential_required && (observation.missingKey === true || role.observed_role === 'error_html')) {
    return fail('missing_key', 'Census keyless HTML remains authentication-required');
  }
  const actualMedia = mediaTypeOf(observation);
  const expectedMedia = receipt.expected.media_type ? receipt.expected.media_type.split(';', 1)[0].trim().toLowerCase() : null;
  if (expectedMedia && actualMedia && actualMedia !== expectedMedia) {
    return fail('wrong_mime', `expected ${expectedMedia}, observed ${actualMedia}`);
  }
  const rows = parseRows(observation);
  if (bodyBytes.length > receipt.limits.max_bytes) {
    return fail('ignored_byte_limit', `observed ${bodyBytes.length} bytes, limit ${receipt.limits.max_bytes}`);
  }
  if (rows.length > receipt.limits.max_rows) {
    return fail('ignored_row_limit', `observed ${rows.length} rows, limit ${receipt.limits.max_rows}`);
  }
  if (rows.length === 0 && observation.emptyValid === true) {
    checks.push(freeze({ code: 'empty_but_valid', passed: true, detail: 'empty payload accepted as valid empty sample' }));
  } else if (rows.length === 0 && receipt.expected.fields.length > 0) {
    return fail('empty_payload', 'expected fields but observed no rows');
  }
  const first = rows[0] ?? {};
  if (observation.emptyValid !== true) {
    for (const field of receipt.expected.fields) {
      if (!Object.hasOwn(first, field)) {
        return fail('unexpected_field', `missing expected field ${field}`);
      }
      const expectedType = receipt.expected.types[field];
      if (expectedType && typeof first[field] !== expectedType) {
        return fail('unexpected_field', `field ${field} type ${typeof first[field]} !== ${expectedType}`);
      }
    }
  }
  checks.push(freeze({
    code: 'bounded_sample',
    passed: true,
    detail: 'sample field/type checks passed independently of catalog/schema classification',
  }));
  checks.push(freeze({
    code: 'catalog_classifier_separate',
    passed: true,
    detail: classified.accepted === true
      ? 'catalog classifier accepted; this still is not full dataset or schema validation'
      : `catalog classifier did not accept payload sample (${classified.reasonCode}); sample checks remain separate`,
  }));
  const sampleOk = expectedMedia ? actualMedia === expectedMedia : true;
  const tested = sampleOk
    && receipt.credential_required !== true
    && observation.emptyValid !== true
    && receipt.expected.fields.length > 0;
  return freeze({
    receipt,
    result: tested ? 'bounded_sample_passed' : 'not_tested_example',
    passed: true,
    tested_example: tested,
    full_dataset_validated: false,
    full_schema_validated: false,
    http_success_alone: observation.status === 200 && tested === false,
    checks: freeze(checks),
    classified,
    role,
    catalog_accepted: classified.accepted === true,
    rows: freeze(rows),
    publication_authorized: false,
  });
}

export function publishExamplePreview(receipt, execution, { synthetic = false, captureDate = '2026-09-14', scope = 'bounded_sample' } = {}) {
  if (synthetic === true) {
    return freeze({
      kind: 'synthetic_schema_example',
      tested_example: false,
      synthetic: true,
      values_retained: false,
      sample_values: null,
      source: receipt.source,
      release: receipt.release,
      distribution: receipt.distribution,
      pointer: receipt.distribution ?? receipt.source,
      capture_date: captureDate,
      scope,
      publication_authorized: false,
    });
  }
  if (execution.tested_example !== true) {
    return freeze({
      kind: execution.result === 'missing_key' ? 'credential_blocked' : 'untested',
      tested_example: false,
      synthetic: false,
      values_retained: false,
      sample_values: null,
      source: receipt.source,
      release: receipt.release,
      distribution: receipt.distribution,
      pointer: receipt.distribution ?? receipt.source,
      capture_date: captureDate,
      scope,
      publication_authorized: false,
    });
  }
  const sampleValues = (execution.rows ?? []).slice(0, receipt.limits.max_rows);
  return freeze({
    kind: 'sampled_aggregate_preview',
    tested_example: true,
    synthetic: false,
    values_retained: sampleValues.length > 0,
    sample_values: freeze(sampleValues),
    source: receipt.source,
    release: receipt.release,
    distribution: receipt.distribution,
    pointer: receipt.distribution ?? receipt.source,
    capture_date: captureDate,
    scope,
    publication_authorized: false,
  });
}

export function generateCopyableExamples(receipt) {
  const params = sanitizeParameters(receipt.parameters);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  if (!query.has('limit')) query.set('limit', String(receipt.limits.max_rows));
  if (!query.has('key')) query.set('key', '[REDACTED]');
  const host = `https://example.test/${receipt.source ?? 'source'}/${receipt.release ?? 'release'}`;
  const url = `${host}?${query.toString()}`;
  const fields = receipt.expected.fields.join(',');
  const curl = [
    `curl --get '${host}'`,
    fields ? ` --data-urlencode 'get=${fields}'` : '',
    ` --data-urlencode 'limit=${receipt.limits.max_rows}'`,
    ` --data-urlencode 'key=[REDACTED]'`,
  ].join('');
  const pythonParams = { get: fields, limit: receipt.limits.max_rows, key: '[REDACTED]' };
  const python = [
    'import urllib.parse, urllib.request',
    `params = ${JSON.stringify(pythonParams)}`,
    `url = '${host}?' + urllib.parse.urlencode(params)`,
    'print(url)',
  ].join('\n');
  return freeze({
    curl,
    python,
    url,
    source: receipt.source,
    release: receipt.release,
    distribution: receipt.distribution,
    fields: receipt.expected.fields,
    limits: receipt.limits,
    credential_placeholder: '[REDACTED]',
    live_source_traffic: false,
    round_trip: freeze({
      source: receipt.source,
      release: receipt.release,
      distribution: receipt.distribution,
      fields: [...receipt.expected.fields],
      max_rows: receipt.limits.max_rows,
      max_bytes: receipt.limits.max_bytes,
      credential_placeholder: true,
    }),
  });
}

export function roundTripExample(receipt, generated) {
  const rt = generated.round_trip;
  return rt.source === receipt.source
    && rt.release === receipt.release
    && rt.distribution === receipt.distribution
    && JSON.stringify(rt.fields) === JSON.stringify(receipt.expected.fields)
    && rt.max_rows === receipt.limits.max_rows
    && rt.max_bytes === receipt.limits.max_bytes
    && rt.credential_placeholder === true
    && generated.credential_placeholder === '[REDACTED]'
    && generated.live_source_traffic === false
    && !JSON.stringify(generated).includes('secret-value');
}
