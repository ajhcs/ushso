import { typedProjectionValue as typedValue, validProjectionDate, projectionFields, criticalProjectionFields, validateProjectionViews } from './projection-contract.mjs';
import { createHash } from 'node:crypto';

export const SCHEMA = 'ushso.source-selection.v1';
export const canonical = value => JSON.stringify(sort(value));
function sort(value) { if (Array.isArray(value)) return value.map(sort); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])])); return value; }
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const statuses = new Set(['verified','unresolved','unavailable','blocked','conflict']);
const fields = projectionFields;
const critical = criticalProjectionFields;
const fail = (code, detail) => { const e = new Error(`${code}: ${detail}`); e.code = code; throw e; };
const unique = (items, key) => { const result = new Map(); for (const item of items) { if (!item[key] || result.has(item[key])) fail('duplicate_or_missing_id', key); result.set(item[key], item); } return result; };
const validDate = validProjectionDate;
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const validUrl = v => { try { const u = new URL(v); return ['http:','https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } };
const timestamp = v => validDate(v) && v.includes('T');
export function validateLedger(ledger) {
  if (!isObject(ledger) || ['assets','captures','rights','decisions','assertions'].some(k => !Array.isArray(ledger[k]))) fail('invalid_ledger', 'required arrays');
  const assets = unique(ledger.assets || [], 'asset_id'); const captures = unique(ledger.captures || [], 'capture_id'); const rights = unique(ledger.rights || [], 'rights_id'); const decisions = unique(ledger.decisions || [], 'decision_id'); const assertions = unique(ledger.assertions || [], 'assertion_id');
  const allIds = [...assets.keys(),...captures.keys(),...rights.keys(),...decisions.keys(),...assertions.keys(),...(ledger.releases || []).map(x => x.release_id),...(ledger.distributions || []).map(x => x.distribution_id)]; if (new Set(allIds).size !== allIds.length) fail('duplicate_global_id','ledger');
  for (const c of captures.values()) {
    if (!assets.has(c.asset_id) || !rights.has(c.rights_id) || !timestamp(c.retrieved_at) || !validUrl(c.canonical_url) || !nonempty(c.locator_scheme)) fail('invalid_capture', c.capture_id);
    if (c.retention_mode === 'metadata_only') { if (!c.retention_reason || c.sha256 || c.artifact_ref || c.normalized_text_sha256) fail('invalid_metadata_only', c.capture_id); }
    else if (c.retention_mode !== 'bytes' || !/^[a-f0-9]{64}$/.test(c.sha256 || '') || !c.artifact_ref || rights.get(c.rights_id).actions?.store_bytes !== 'allowed') fail('invalid_capture_rights', c.capture_id);
  }
  for (const right of rights.values()) {
    if ((right.expires_at && !validDate(right.expires_at)) || !validUrl(right.terms_url) || !validDate(right.checked_at) || !right.reviewer || !right.scope || !right.actions || ['metadata_capture','store_bytes','send_to_provider','redistribute_excerpt'].some(k => !['allowed','prohibited','unresolved'].includes(right.actions[k])) || (right.actions.publish_metadata != null && !['allowed','prohibited','unresolved'].includes(right.actions.publish_metadata))) fail('invalid_rights', right.rights_id);
  }
  for (const d of decisions.values()) {
    if (!['accept','reject','defer'].includes(d.decision) || !nonempty(d.reviewer) || d.reviewer === 'unassigned' || !nonempty(d.reviewer_role) || !nonempty(d.rationale) || !timestamp(d.reviewed_at) || !nonempty(d.subject_id) || !assets.has(d.subject_id) || !Array.isArray(d.evidence_ids) || !d.evidence_ids.length || d.evidence_ids.some(id => !captures.has(id))) fail('invalid_decision', d.decision_id);
  }
  for (const d of decisions.values()) if (!Array.isArray(d.assertion_ids) || d.assertion_ids.some(id => !assertions.has(id) || assertions.get(id).decision_id !== d.decision_id) || new Set(d.assertion_ids).size !== d.assertion_ids.length) fail('invalid_decision_binding', d.decision_id);
  const releaseMap = unique(ledger.releases || [], 'release_id');
  const distributionMap = unique(ledger.distributions || [], 'distribution_id');
  for (const r of releaseMap.values()) if (!assets.has(r.asset_id)) fail('invalid_release',r.release_id);
  for (const d of distributionMap.values()) if (!releaseMap.has(d.release_id) || releaseMap.get(d.release_id).asset_id !== d.asset_id) fail('invalid_distribution',d.distribution_id);
  for (const a of assertions.values()) {
    if (!assets.has(a.subject_id) || !a.predicate || !a.scope || !Array.isArray(a.evidence_refs) || !a.evidence_refs.length || decisions.get(a.decision_id)?.decision !== 'accept') fail('invalid_assertion', a.assertion_id);
    if ((a.value == null) === !a.null_reason || (a.value != null && !typedValue(a.predicate,a.value)) || (a.value == null && !['unresolved','unavailable','blocked'].includes(a.null_reason))) fail('invalid_assertion_value', a.assertion_id);
    const decision = decisions.get(a.decision_id);
    if (decision.subject_id !== a.subject_id || !Array.isArray(decision.assertion_ids) || !decision.assertion_ids.includes(a.assertion_id) || a.evidence_refs.some(ref => !decision.evidence_ids.includes(ref.capture_id)) || decision.reviewed_at < a.observed_at) fail('invalid_decision_scope',a.assertion_id);
    if (a.scope.release_id && releaseMap.get(a.scope.release_id)?.asset_id !== a.subject_id) fail('invalid_release_scope',a.assertion_id);
    if (a.scope.distribution_id && (distributionMap.get(a.scope.distribution_id)?.asset_id !== a.subject_id || distributionMap.get(a.scope.distribution_id)?.release_id !== a.scope.release_id)) fail('invalid_distribution_scope',a.assertion_id);
    if (['dictionaries','joins'].includes(a.predicate) && (!a.scope.release_id || !a.scope.distribution_id)) fail('missing_version_scope',a.assertion_id);
    if (a.predicate === 'dictionaries' && a.value?.some(v => v.distribution_id !== a.scope.distribution_id)) fail('invalid_dictionary_scope',a.assertion_id);
    if (a.predicate === 'joins' && a.value?.some(v => !distributionMap.has(v.left_distribution_id) || !distributionMap.has(v.right_distribution_id) || v.left_distribution_id !== a.scope.distribution_id)) fail('invalid_join_scope',a.assertion_id);
    if (a.predicate === 'identity' && (a.value?.asset_id !== a.subject_id || a.value?.publisher_id !== assets.get(a.subject_id).publisher_id || a.value?.title !== assets.get(a.subject_id).title)) fail('invalid_identity',a.assertion_id);
    if (a.predicate === 'release_id' && releaseMap.get(a.value)?.asset_id !== a.subject_id) fail('invalid_release_scope',a.assertion_id);
    if (a.predicate === 'distribution_id' && distributionMap.get(a.value)?.asset_id !== a.subject_id) fail('invalid_distribution_scope',a.assertion_id);
    if (!validDate(a.observed_at) || (a.valid_from && !validDate(a.valid_from)) || (a.valid_to && !validDate(a.valid_to)) || (a.valid_from && a.valid_to && a.valid_from > a.valid_to)) fail('invalid_assertion_dates', a.assertion_id);
    for (const ref of a.evidence_refs) { const c = captures.get(ref.capture_id); if (!c || c.asset_id !== a.subject_id || !(nonempty(ref.locator) || (c.retention_mode === 'bytes' && isObject(ref.locator) && Object.keys(ref.locator).sort().join(',') === 'end,start' && Number.isSafeInteger(ref.locator.start) && Number.isSafeInteger(ref.locator.end) && ref.locator.start >= 0 && ref.locator.end > ref.locator.start)) || rights.get(c.rights_id)?.actions.metadata_capture !== 'allowed' || (a.scope.release_id && c.release_id !== a.scope.release_id) || (a.scope.distribution_id && c.distribution_id !== a.scope.distribution_id)) fail('invalid_evidence_reference', a.assertion_id); }
    for (const id of a.supersedes || []) if (!assertions.has(id) || id === a.assertion_id || assertions.get(id).subject_id !== a.subject_id || assertions.get(id).predicate !== a.predicate || canonical(assertions.get(id).scope) !== canonical(a.scope)) fail('invalid_supersession', a.assertion_id);
  }
  const visiting = new Set(), visited = new Set(); function visit(id) { if (visiting.has(id)) fail('supersession_cycle', id); if (visited.has(id)) return; visiting.add(id); for (const s of assertions.get(id).supersedes || []) visit(s); visiting.delete(id); visited.add(id); } for (const id of assertions.keys()) visit(id);
  for (const asset of assets.values()) if (!asset.publisher_id || !asset.title || !['reviewed_core','inventory_only'].includes(asset.core_status)) fail('invalid_asset', asset.asset_id);
  return true;
}
export function createDataManifest({ ledgerRevision, ledgerHash, evidenceHash, rightsHash, schemaHashes }) {
  for (const x of [ledgerRevision, ledgerHash, evidenceHash, rightsHash]) if (!x) fail('invalid_manifest', 'missing input');
  const manifest = { accepted_ledger_revision: ledgerRevision, accepted_ledger_sha256: ledgerHash, evidence_manifest_sha256: evidenceHash, rights_policy_sha256: rightsHash, input_schema_sha256: schemaHashes };
  const bytes = canonical(manifest); return { manifest, bytes, generation_id: sha256(bytes) };
}
export function projectLedger(ledger, generation_id, { revokedRights = [] } = {}) {
  validateLedger(ledger); if (!/^[a-f0-9]{64}$/.test(generation_id)) fail('invalid_generation', generation_id);
  const captures = new Map(ledger.captures.map(c => [c.capture_id,c])); const rights = new Map(ledger.rights.map(r => [r.rights_id,r]));
  const superseded = new Set(ledger.assertions.flatMap(a => a.supersedes || []));
  const views = ledger.assets.map(asset => {
    const assertions = ledger.assertions.filter(a => a.subject_id === asset.asset_id && !superseded.has(a.assertion_id) && a.evidence_refs.every(r => { const right = rights.get(captures.get(r.capture_id).rights_id); return !revokedRights.includes(right.rights_id) && right.actions.metadata_capture === 'allowed' && right.actions.publish_metadata === 'allowed'; }));
    if (!assertions.some(a => a.predicate === 'identity' && a.value?.asset_id === asset.asset_id && a.value?.publisher_id === asset.publisher_id && a.value?.title === asset.title)) return null;
    const view = { schema_version: SCHEMA, generation_id, asset_id: asset.asset_id, publisher_id: asset.publisher_id, family_id: null, release_id: null, distribution_id: null, title: asset.title, core_status: asset.core_status, decision_readiness: 'inventory_only', freshness: asset.freshness || {status:'unknown'}, reviewed_at: null, checked_at: asset.checked_at || null, assertion_ids: [], evidence_ids: [], unresolved: [] };
    for (const field of fields.concat(['family_id','release_id','distribution_id'])) {
      const matching = assertions.filter(a => a.predicate === field); const values = new Set(matching.filter(a => a.value != null).map(a => canonical(a.value))); const aids = matching.map(a => a.assertion_id).sort(); const eids = [...new Set(matching.flatMap(a => a.evidence_refs.map(r => r.capture_id)))].sort();
      const scopes = new Set(matching.map(a => canonical(a.scope))); const reasons = new Set(matching.filter(a => a.null_reason).map(a => a.null_reason)); const status = values.size > 1 || scopes.size > 1 || reasons.size > 1 ? 'conflict' : matching.length === 0 ? 'unresolved' : matching.some(a => a.null_reason) ? (values.size ? 'conflict' : (statuses.has(matching[0].null_reason) ? matching[0].null_reason : 'unresolved')) : 'verified';
      const value = status === 'verified' ? matching[0].value : null;
      view.assertion_ids.push(...aids); view.evidence_ids.push(...eids);
      if (['family_id','release_id','distribution_id'].includes(field)) view[field] = value; else view[field] = { status, value, assertion_ids: aids, evidence_ids: eids };
      if (status !== 'verified') view.unresolved.push(field);
    }
    if (view.identity.status !== 'verified') return null;
    view.assertion_ids = [...new Set(view.assertion_ids)].sort(); view.evidence_ids = [...new Set(view.evidence_ids)].sort();
    view.citations = view.evidence_ids.map(id => { const capture = captures.get(id); const locators = [...new Set(assertions.flatMap(a => a.evidence_refs.filter(ref => ref.capture_id === id).map(ref => canonical(ref.locator))))].sort().map(x => JSON.parse(x)); return {capture_id:id,canonical_url:capture.canonical_url,retrieved_at:capture.retrieved_at,content_sha256:capture.sha256 || null,locator_scheme:capture.locator_scheme,locators}; });
    const decisions = new Map(ledger.decisions.map(d => [d.decision_id,d])); const reviewDates = assertions.map(a => decisions.get(a.decision_id).reviewed_at).filter(validDate).sort(); view.reviewed_at = reviewDates.at(-1) || null;
    if (asset.core_status === 'reviewed_core' && critical.every(f => view[f].status === 'verified' && assertions.filter(a => a.predicate === f).every(a => !a.valid_to)) && view.reviewed_at) view.decision_readiness = 'decision_ready';
    return view;
  }).filter(Boolean).sort((a,b) => a.asset_id.localeCompare(b.asset_id));
  if (!validateProjectionViews(views,generation_id)) fail('invalid_projection',generation_id);
  return views;
}
export function resolveLegacyAlias(recordId, aliases) { const found = aliases.filter(a => a.record_id === recordId && a.decision === 'accept' && a.evidence_id && a.version); if (!found.length) return {status:'unmapped'}; const ids = [...new Set(found.map(a => a.asset_id))]; return ids.length === 1 ? {status:'mapped',asset_id:ids[0]} : {status:'ambiguous_mapping',asset_ids:ids.sort()}; }
export function validateProposalSpan({text, textHash, start, end, quote, subjectId, expectedSubjectId}) { const bytes = Buffer.from(text); if (sha256(bytes) !== textHash || subjectId !== expectedSubjectId || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > bytes.length || !quote || !bytes.subarray(start,end).equals(Buffer.from(quote))) return {status:'invalid_span_or_scope'}; return {status:'draft', entailment:'requires_human_review'}; }
export function authorizeAI({enabled = false, rights, estimatedInputTokens, attempts = 3, worstCasePerAttempt, perJobBudget, monthlyRemaining}) { if (!enabled) return {status:'disabled'}; if (rights?.send_to_provider !== 'allowed') return {status:'blocked'}; if (!Number.isFinite(estimatedInputTokens) || estimatedInputTokens < 0 || estimatedInputTokens > 180000) return {status:'blocked',reason:'input_limit'}; if (![worstCasePerAttempt,perJobBudget,monthlyRemaining].every(v => Number.isFinite(v) && v >= 0) || !Number.isInteger(attempts) || attempts < 1 || attempts > 3 || worstCasePerAttempt * attempts > perJobBudget || worstCasePerAttempt * attempts > monthlyRemaining) return {status:'budget_exhausted'}; return {status:'reservation_required',amount:worstCasePerAttempt * attempts}; }
