import { validProjectionDate } from './projection-contract.mjs';
import { validateLedger } from './index.mjs';

const fail = (code, detail) => { throw Object.assign(new Error(`${code}: ${detail}`), {code}); };
const timestamp = v => validProjectionDate(v) && v.includes('T');
const text = v => typeof v === 'string' && !!v.trim();
const outcomes = new Set(['changed','unchanged','failed','blocked','unavailable','unresolved']);
const successes = new Set(['changed','unchanged']);
const epoch = value => Date.parse(value);
/** Pure manual planning report. No network calls or ledger mutation. */
export function buildRefreshReport({ledger, plans, attempts, policy, asOf}) {
  validateLedger(ledger);
  if (!timestamp(asOf) || !Array.isArray(plans) || !Array.isArray(attempts) || !policy || !Array.isArray(policy.revoked_rights) || policy.revoked_rights.some(x => !text(x))) fail('invalid_refresh_input','clock, plans, attempts or policy');
  const assets = new Map(ledger.assets.map(x => [x.asset_id,x]));
  const captures = new Map(ledger.captures.map(x => [x.capture_id,x]));
  const rights = new Map(ledger.rights.map(x => [x.rights_id,x]));
  const ids = new Set();
  for (const a of attempts) {
    if (!text(a.attempt_id) || ids.has(a.attempt_id) || !assets.has(a.asset_id) || !timestamp(a.attempted_at) || epoch(a.attempted_at) > epoch(asOf) || !outcomes.has(a.outcome) || !text(a.owner)) fail('invalid_attempt',a.attempt_id);
    if (attempts.some(b => b !== a && b.asset_id === a.asset_id && epoch(b.attempted_at) === epoch(a.attempted_at))) fail('ambiguous_attempt_order',a.attempt_id);
    ids.add(a.attempt_id);
    if (a.retry_after_at != null && (!timestamp(a.retry_after_at) || epoch(a.retry_after_at) < epoch(a.attempted_at) || !['failed','blocked','unavailable','unresolved'].includes(a.outcome))) fail('invalid_retry_after',a.attempt_id);
    if (successes.has(a.outcome)) { const c = captures.get(a.capture_id); if (!c || c.asset_id !== a.asset_id || epoch(c.retrieved_at) > epoch(a.attempted_at)) fail('invalid_success_capture',a.attempt_id); }
    else if (a.capture_id != null) fail('invalid_failed_capture',a.attempt_id);
  }
  const planIds = new Set();
  const entries = plans.map(plan => {
    if (!assets.has(plan.asset_id) || planIds.has(plan.asset_id) || !text(plan.owner) || !timestamp(plan.due_at) || (plan.review_due_at != null && !timestamp(plan.review_due_at)) || !rights.has(plan.rights_id)) fail('invalid_plan',plan.asset_id);
    planIds.add(plan.asset_id);
    const history = attempts.filter(a => a.asset_id === plan.asset_id).sort((a,b) => epoch(a.attempted_at) - epoch(b.attempted_at));
    const last = history.at(-1) || null; const success = history.filter(a => successes.has(a.outcome)).at(-1) || null;
    const right = rights.get(plan.rights_id); const rightsBlocked = !ledger.captures.some(c => c.asset_id === plan.asset_id && c.rights_id === plan.rights_id && epoch(c.retrieved_at) <= epoch(asOf)) || epoch(right.checked_at) > epoch(asOf) || policy.revoked_rights.includes(right.rights_id) || right.actions.metadata_capture !== 'allowed' || (right.expires_at && epoch(right.expires_at) <= epoch(asOf));
    const dueStatus = epoch(asOf) > epoch(plan.due_at) ? 'overdue' : epoch(asOf) === epoch(plan.due_at) ? 'due' : 'current';
    const reviewDueStatus = !plan.review_due_at ? 'unknown' : epoch(asOf) > epoch(plan.review_due_at) ? 'overdue' : epoch(asOf) === epoch(plan.review_due_at) ? 'due' : 'current';
    const status = rightsBlocked ? 'blocked' : last && !successes.has(last.outcome) ? last.outcome : dueStatus;
    const deferred = !!(last?.retry_after_at && epoch(last.retry_after_at) > epoch(asOf));
    return {asset_id:plan.asset_id, owner:plan.owner, rights_id:plan.rights_id, due_at:plan.due_at, review_due_at:plan.review_due_at ?? null, due_status:dueStatus, review_due_status:reviewDueStatus, status, rights_status:rightsBlocked ? 'blocked' : 'allowed', last_attempt:last ? {...last} : null, last_success:success ? {attempt_id:success.attempt_id,attempted_at:success.attempted_at,capture_id:success.capture_id} : null, next_eligible_at:deferred ? last.retry_after_at : null, action: rightsBlocked ? 'review_rights' : deferred ? 'wait_for_retry_after' : status === 'current' && !['due','overdue'].includes(reviewDueStatus) ? 'none' : 'manual_review'};
  }).sort((a,b)=>a.asset_id.localeCompare(b.asset_id));
  return {schema_version:'ushso.refresh-report.v1',as_of:asOf,entries,unplanned_asset_ids:[...assets.keys()].filter(id=>!planIds.has(id)).sort(),capacity_status:'unknown',notice:'Manual planning only; no request, staffing, or acceptance is implied.'};
}
