import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL, blockedFetch as openrouterBlockedFetch } from './openrouter-client.mjs';

export const POLICY_FORMAT = 'ushso.provider-policy.v1';
export const COLLECTION_CLASSES = Object.freeze([
  'approved_public_documentation',
  'secret',
  'private_query',
  'restricted_content',
  'unapproved_contributor_transmission',
  'untrusted_document_instruction',
]);

const SNAPSHOT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'model-snapshot.json');

export async function blockedFetch() {
  return openrouterBlockedFetch();
}

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function loadModelSnapshot({ snapshotPath = SNAPSHOT_PATH, snapshot = null } = {}) {
  const data = snapshot ?? JSON.parse(readFileSync(snapshotPath, 'utf8'));
  if (data.live_catalog_fetched === true) fail('LIVE_CATALOG_FETCH_FORBIDDEN');
  if (data.evaluated_model?.id !== DEFAULT_MODEL) fail('EVALUATED_MODEL_MISMATCH');
  if (data.muse_contributor?.operator_acceptance !== false) fail('MUSE_CONTRIBUTOR_MUST_BE_EXPLICIT');
  return freeze(data);
}

export function resolveEvaluatedModel(snapshot, requestedId) {
  const evaluated = snapshot.evaluated_model;
  if (!requestedId || requestedId === evaluated.id) {
    return freeze({ id: evaluated.id, reason: 'evaluated_model', review: false });
  }
  if ((evaluated.aliases ?? []).includes(requestedId) || /(?:^|[/:])(?:latest|auto)$/i.test(requestedId)) {
    fail('LATEST_ALIAS_CANNOT_REPLACE_EVALUATED_MODEL');
  }
  const known = (snapshot.fallbacks ?? []).find((row) => row.id === requestedId);
  if (!known) fail('MODEL_UNAVAILABLE_REVIEW_REQUIRED');
  if (known.evaluated !== true && /free-router/i.test(requestedId)) fail('UNEVALUATED_FREE_ROUTER_NOT_DEFAULT');
  if (known.evaluated !== true) fail('MODEL_CHANGED_REVIEW_REQUIRED');
  return freeze({ id: known.id, reason: 'explicit_evaluated_fallback', review: false });
}

export function classifyEvidence(evidence = {}) {
  const quote = String(evidence.quote ?? evidence.text ?? '');
  const locator = String(evidence.locator ?? evidence.url ?? '');
  const combined = `${locator}\n${quote}`;
  if (evidence.kind === 'secret' || /api[_-]?key|bearer\s+[a-z0-9]|-----BEGIN/i.test(combined)) {
    return freeze({ class: 'secret', eligible: false, reason: 'SECRET_EXCLUDED' });
  }
  if (evidence.kind === 'private_query' || /private query|internal only/i.test(combined)) {
    return freeze({ class: 'private_query', eligible: false, reason: 'PRIVATE_QUERY_EXCLUDED' });
  }
  if (evidence.kind === 'restricted' || /restricted content|not for redistribution/i.test(combined)) {
    return freeze({ class: 'restricted_content', eligible: false, reason: 'RESTRICTED_CONTENT_EXCLUDED' });
  }
  if (evidence.kind === 'contributor' || /muse contributor|train on this input/i.test(combined)) {
    return freeze({ class: 'unapproved_contributor_transmission', eligible: false, reason: 'CONTRIBUTOR_TRANSMISSION_EXCLUDED' });
  }
  if (evidence.kind === 'instruction' || /use this endpoint:|switch provider to|ignore previous/i.test(combined)) {
    return freeze({ class: 'untrusted_document_instruction', eligible: false, reason: 'UNTRUSTED_INSTRUCTION_EXCLUDED' });
  }
  if (evidence.kind !== 'public_passage') {
    return freeze({ class: 'restricted_content', eligible: false, reason: 'PUBLIC_PASSAGE_REQUIRED' });
  }
  return freeze({ class: 'approved_public_documentation', eligible: true, reason: null });
}

export function sanitizeLog(value) {
  return String(value ?? '').replace(/Bearer\s+[A-Za-z0-9._~+/-]+/g, 'Bearer [REDACTED]')
    .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=[REDACTED]');
}

export function filterEligibleEvidence(evidenceList, { transport } = {}) {
  const sent = [];
  const rejected = [];
  for (const evidence of evidenceList) {
    const classified = classifyEvidence(evidence);
    if (classified.eligible !== true) {
      rejected.push(freeze({ evidence_id: evidence.locator ?? evidence.id ?? null, ...classified }));
      continue;
    }
    const payload = freeze({ locator: evidence.locator, quote: evidence.quote, class: classified.class });
    if (typeof transport === 'function') transport(payload);
    sent.push(payload);
  }
  return freeze({ sent: freeze(sent), rejected: freeze(rejected) });
}

export function selectFallback(snapshot, { requestedId = null, cheaperIncompatibleId = null, freeRouterId = 'openrouter/free-router' } = {}) {
  const evaluated = resolveEvaluatedModel(snapshot, requestedId ?? snapshot.evaluated_model.id);
  const maxPrice = snapshot.operator?.max_price_prompt_per_million ?? snapshot.evaluated_model.max_price_prompt_per_million;
  if (requestedId === freeRouterId) fail('UNEVALUATED_FREE_ROUTER_NOT_DEFAULT');
  const candidates = (snapshot.fallbacks ?? []).filter((row) => row.id !== evaluated.id);
  if (cheaperIncompatibleId) {
    const cheap = candidates.find((row) => row.id === cheaperIncompatibleId);
    if (cheap && (cheap.trains_on_inputs === true || cheap.privacy_rank < snapshot.evaluated_model.privacy_rank)) {
      fail('PRIVACY_INCOMPATIBLE_FALLBACK');
    }
  }
  const allowed = [snapshot.evaluated_model, ...candidates.filter((row) => row.evaluated === true && row.trains_on_inputs !== true && row.privacy_rank >= snapshot.evaluated_model.privacy_rank && row.price_prompt_per_million <= maxPrice)];
  if (allowed.some((row) => row.id === freeRouterId && row.evaluated !== true)) fail('UNEVALUATED_FREE_ROUTER_NOT_DEFAULT');
  const selected = allowed[0];
  if (!selected || selected.id === freeRouterId) fail('UNEVALUATED_FREE_ROUTER_NOT_DEFAULT');
  return freeze({
    selected_id: selected.id,
    evaluated: true,
    price_prompt_per_million: selected.price_prompt_per_million,
    data_use_policy_version: snapshot.evaluated_model.data_use_policy_version,
    muse_contributor_accepted: snapshot.operator?.muse_contributor_terms_accepted === true,
  });
}

export function applyProviderPolicy({ residual, snapshot, requestedModel = null, transport } = {}) {
  const loaded = snapshot ?? loadModelSnapshot();
  if (residual?.evidence) {
    const classified = classifyEvidence(residual.evidence);
    if (classified.eligible !== true) fail(classified.reason);
  }
  if (residual?.untrusted_instruction) fail('UNTRUSTED_INSTRUCTION_EXCLUDED');
  const selected = selectFallback(loaded, { requestedId: requestedModel });
  const filtered = residual?.evidence ? filterEligibleEvidence([residual.evidence], { transport }) : { sent: [], rejected: [] };
  return freeze({
    format: POLICY_FORMAT,
    selected_model: selected.selected_id,
    muse_contributor_terms: loaded.muse_contributor,
    sent: filtered.sent,
    rejected: filtered.rejected,
    paid_calls_enabled: false,
  });
}
