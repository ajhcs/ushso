import { createHash } from 'node:crypto';
export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
import { matchQualifiedRoute } from './qualified-access-routes.mjs';
import { matchQualifiedVariableContext } from './qualified-variable-contexts.mjs';
import { comparisonFact, documentedComparisonProfile } from './comparison-dimensions.mjs';
import { inspectJoinRoutes } from './qualified-join-routes.mjs';

export const RESEARCH_PACKET_FORMAT = 'ushso.research-evidence-packet.v1';

const SECRET_KEYS = freezeSet(['authorization', 'cookie', 'password', 'api_key', 'api_key_value', 'token', 'access_token', 'signed_url', 'presigned_url', 'credential', 'credentials']);

function freezeSet(values) {
  return Object.freeze(new Set(values));
}

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function containsSecrets(value) {
  if (value == null || value === false) return false;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsSecrets);
  for (const [key, item] of Object.entries(value)) {
    if (item == null || item === false) continue;
    if (SECRET_KEYS.has(key) || SECRET_KEYS.has(key.toLowerCase())) return true;
    if (containsSecrets(item)) return true;
  }
  return false;
}

export function buildResearchPacket(input = {}) {
  const generation = input.generation ?? LAST_GOOD_GENERATION;
  if (generation !== LAST_GOOD_GENERATION && input.allow_other_generation !== true) fail('PACKET_GENERATION_NOT_LAST_GOOD', generation);
  const sources = freeze((input.asset_ids ?? []).map((asset_id) => freeze({
    asset_id,
    documented_profile: documentedComparisonProfile(asset_id)?.reporting_definition ?? null,
    identity_sha256: sha(asset_id),
  })));
  const contexts = freeze((input.contexts ?? []).map((context) => freeze({ ...context })));
  const recipes = freeze((input.contexts ?? []).map((context) => {
    const route = matchQualifiedRoute(context);
    return freeze({
      asset_id: context.record_id,
      documented: Boolean(route),
      access_route_id: route?.access_route_id ?? null,
      secrets: null,
    });
  }));
  const variable_citations = freeze((input.contexts ?? []).map((context) => {
    const qualified = matchQualifiedVariableContext(context);
    return freeze({
      asset_id: context.record_id,
      schema_id: qualified?.schema_id ?? context.schema_id ?? null,
      fields: freeze((qualified?.fields ?? []).map((field) => field.schema_field_id)),
      schema_completeness: qualified?.schema_completeness ?? 'unknown',
    });
  }));
  const comparisons = freeze((input.comparisons ?? []).map((row) => freeze({ ...row })));
  const join_metadata = inspectJoinRoutes({
    from_id: input.from_id ?? input.asset_ids?.[0],
    to_id: input.to_id ?? input.asset_ids?.[1] ?? null,
    include_indirect: input.include_indirect === true,
    max_hops: 1,
  });
  const packet = freeze({
    format: RESEARCH_PACKET_FORMAT,
    generation,
    last_good_generation: LAST_GOOD_GENERATION,
    question: input.question ?? null,
    sources,
    contexts,
    recipes,
    variable_citations,
    comparisons,
    join_metadata,
    llm_invoked: false,
    source_data_fetched: false,
    credentials: null,
    hidden_research_query_telemetry: false,
    packet_sha256: null,
  });
  if (containsSecrets(packet)) fail('PACKET_CONTAINS_SECRETS');
  const packet_sha256 = sha({ ...packet, packet_sha256: null });
  return freeze({ ...packet, packet_sha256 });
}

export function validateResearchPacket(packet) {
  if (!packet || packet.format !== RESEARCH_PACKET_FORMAT) fail('PACKET_FORMAT_INVALID');
  if (packet.llm_invoked !== false) fail('PACKET_LLM_INVOKED');
  if (packet.source_data_fetched !== false) fail('PACKET_SOURCE_FETCHED');
  if (packet.credentials != null) fail('PACKET_HAS_CREDENTIALS');
  if (packet.hidden_research_query_telemetry !== false) fail('PACKET_HIDDEN_TELEMETRY');
  if (containsSecrets(packet)) fail('PACKET_CONTAINS_SECRETS');
  const { packet_sha256, ...rest } = packet;
  if (packet_sha256 !== sha({ ...rest, packet_sha256: null })) fail('PACKET_HASH_MISMATCH');
  return freeze({ valid: true, generation: packet.generation, source_count: packet.sources.length });
}

export function comparisonOverlayFacts(record, dimension) {
  return comparisonFact(record, dimension);
}
