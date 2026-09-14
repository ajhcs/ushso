import { createExampleReceipt } from '../connectors/src/testing/example-runner.mjs';
import { LAST_GOOD_GENERATION } from '../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';

export const EXAMPLE_PACKET_FORMAT = 'ushso.research-example-packet.v1';
export { LAST_GOOD_GENERATION };

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function assertGenerationMatch(packet, attached) {
  const packetGen = packet.source_generation ?? packet.schema_generation;
  const attachedGen = attached.source_generation ?? attached.schema_generation ?? attached.generation;
  if (!packetGen || !attachedGen || packetGen !== attachedGen) {
    fail('PACKET_GENERATION_MISMATCH', `${packetGen}!=${attachedGen}`);
  }
  return true;
}

export function buildExamplePacket(input = {}) {
  const required = ['question', 'products', 'fields', 'access_steps', 'generation'];
  const missing = required.filter((field) => !input[field] || (Array.isArray(input[field]) && input[field].length === 0));
  if (missing.length) fail('EXAMPLE_PACKET_INCOMPLETE', missing.join(','));
  const generation = input.generation ?? LAST_GOOD_GENERATION;
  const products = (input.products ?? []).map((product) => freeze({
    product_key: product.product_key,
    release: product.release ?? null,
    why_needed: product.why_needed ?? null,
    source_id: product.source_id ?? null,
  }));
  const steps = (input.access_steps ?? []).map((step) => {
    if (step.executed === true && !step.receipt) fail('EXECUTED_STEP_REQUIRES_RECEIPT', step.id);
    return freeze({
      id: step.id,
      label: step.label,
      executed: step.executed === true,
      documented_unexecuted: step.executed !== true,
      unavailable_restricted: step.unavailable_restricted === true,
      receipt: step.receipt ?? null,
    });
  });
  const expected = freeze({
    kind: 'field_type_shape',
    fields: freeze([...(input.fields ?? [])]),
    types: freeze({ ...(input.types ?? {}) }),
    numeric_constants_forbidden: true,
    values: null,
  });
  if (input.expected_values != null) fail('FRAGILE_NUMERIC_CONSTANT');
  return freeze({
    format: EXAMPLE_PACKET_FORMAT,
    question: input.question,
    products: freeze(products),
    fields: expected.fields,
    types: expected.types,
    access_steps: freeze(steps),
    tested_request: input.tested_request ?? null,
    join_routes: freeze([...(input.join_routes ?? [])]),
    caveats: freeze([...(input.caveats ?? [])]),
    citations: freeze([...(input.citations ?? [])]),
    generation,
    source_generation: generation,
    schema_generation: generation,
    previous_dated_version: input.previous_dated_version ?? null,
    live_data_fabricated: false,
    last_good_generation: LAST_GOOD_GENERATION,
    expected,
  });
}

export function attachRequest(packet, request) {
  assertGenerationMatch(packet, request);
  return freeze({ ...packet, attached_request: freeze(request) });
}

export function attachResult(packet, result) {
  assertGenerationMatch(packet, result);
  if (result.fabricated === true) fail('LIVE_DATA_FABRICATED');
  return freeze({ ...packet, attached_result: freeze(result) });
}

export function invalidateOnSchemaChange(packet, { previousSchema, currentSchema, datedVersion } = {}) {
  if (previousSchema && currentSchema && previousSchema !== currentSchema) {
    return freeze({
      ...packet,
      valid: false,
      invalidated_by: 'SOURCE_SCHEMA_CHANGED',
      previous_dated_version: datedVersion ?? packet.generation,
      schema_generation: currentSchema,
    });
  }
  return freeze({ ...packet, valid: true });
}

export function representativeExamples() {
  const generation = LAST_GOOD_GENERATION;
  const finance = buildExamplePacket({
    question: 'Hospital cost-report net patient revenue for Pennsylvania',
    generation,
    products: [{ product_key: 'cms-hcris-hospital-provider-cost-report', release: 'hcris-worksheet-g3', why_needed: 'Facility/report/year financial worksheets.', source_id: 'cms-hcris' }],
    fields: ['PROVNUM', 'NET_PATIENT_REVENUE'],
    types: { PROVNUM: 'string', NET_PATIENT_REVENUE: 'number' },
    access_steps: [{
      id: 'hcris-sample',
      label: 'Replay bounded HCRIS sample',
      executed: true,
      receipt: createExampleReceipt({
        source: 'cms',
        release: generation,
        distribution: 'hcris',
        expected: { content_class: 'json', media_type: 'application/json', fields: ['PROVNUM'], types: { PROVNUM: 'string' } },
      }),
    }],
    tested_request: { source_generation: generation, schema_generation: generation },
    join_routes: [],
    caveats: ['Sample field checks are not full schema validation.'],
    citations: ['https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report'],
  });
  const staffing = buildExamplePacket({
    question: 'Hospital quality and staffing measures',
    generation,
    products: [{ product_key: 'cms-hospital-quality', release: 'star-ratings', why_needed: 'Documented quality context, not relief payments.', source_id: 'cms-quality' }],
    fields: ['facility_id', 'measure_id'],
    types: { facility_id: 'string', measure_id: 'string' },
    access_steps: [{ id: 'quality-docs', label: 'Read quality measure dictionary', executed: false }],
    caveats: ['Quality stars are not Provider Relief Fund payments.'],
    citations: ['https://data.cms.gov/'],
  });
  const insurance = buildExamplePacket({
    question: 'County uninsured estimates without inventing Census coverage',
    generation,
    products: [{ product_key: 'cdc-places', release: 'places-county', why_needed: 'County uninsured adults independent of Census SAHIE.', source_id: 'cdc-places' }],
    fields: ['countyfips', 'uninsured_adults'],
    types: { countyfips: 'string', uninsured_adults: 'number' },
    access_steps: [{ id: 'places-docs', label: 'Open PLACES county documentation', executed: false }],
    caveats: ['An explicit without-Census filter excludes Census sources.'],
    citations: ['https://www.cdc.gov/places/'],
  });
  const publicHealth = buildExamplePacket({
    question: 'Find HCUP inpatient stays',
    generation,
    products: [{ product_key: 'ahrq-hcup', release: null, why_needed: 'Named source family is recognized but not indexed.', source_id: 'ahrq-hcup' }],
    fields: ['nrd_id'],
    types: { nrd_id: 'string' },
    access_steps: [{
      id: 'hcup-restricted',
      label: 'HCUP restricted application route',
      executed: false,
      unavailable_restricted: true,
    }],
    caveats: ['HCUP is a coverage gap; this is not an exact catalog match.'],
    citations: ['https://hcup-us.ahrq.gov/'],
  });
  return freeze({ finance_utilization: finance, staffing_quality: staffing, insurance_geography: insurance, public_health: publicHealth });
}

export function validatePacket(packet, { request, result, currentSchema } = {}) {
  if (request) attachRequest(packet, request);
  if (result) attachResult(packet, result);
  if (currentSchema && currentSchema !== packet.schema_generation) {
    return invalidateOnSchemaChange(packet, { previousSchema: packet.schema_generation, currentSchema, datedVersion: packet.generation });
  }
  const unexecuted = packet.access_steps.filter((step) => step.documented_unexecuted);
  const executed = packet.access_steps.filter((step) => step.executed);
  if (executed.some((step) => !step.receipt)) fail('EXECUTED_STEP_REQUIRES_RECEIPT');
  return freeze({ valid: true, executed: executed.length, documented_unexecuted: unexecuted.length, live_data_fabricated: false });
}
