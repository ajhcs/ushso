/** Deterministic summaries of supplied observations; never creates observations. */
export function summarizeTasks(observations) {
  const ids = new Set();
  for (const o of observations) {
    if (!o.session_id || ids.has(o.session_id) || typeof o.consented !== 'boolean' || typeof o.eligible !== 'boolean' || typeof o.attempted !== 'boolean') throw new Error('INVALID_SESSION');
    ids.add(o.session_id);
    if (o.excluded === true && !o.exclusion_reason) throw new Error('EXCLUSION_REASON_REQUIRED');
    if (o.completed === true && (!o.attempted || !o.consented)) throw new Error('INVALID_COMPLETION');
  }
  const attempted = observations.filter(o => o.consented && o.eligible && o.attempted && o.excluded !== true);
  const success = attempted.filter(o => o.completed === true && o.rubric_pass === true && o.critical_false_assertion !== true);
  const n = attempted.length, p = n ? success.length / n : null;
  // Wilson 95% interval. Descriptive small-sample uncertainty, not representativeness.
  const z = 1.959963984540054;
  const center = n ? (p + z*z/(2*n))/(1+z*z/n) : null;
  const radius = n ? z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n) : null;
  return { attempted: n, completed: attempted.filter(o=>o.completed===true).length,
    successful: success.length, success_rate: p,
    interval: n ? {method:'Wilson 95%',lower:center-radius,upper:center+radius} : null,
    abandoned: attempted.filter(o=>o.abandoned===true).length,
    technical_failures: attempted.filter(o=>o.technical_failure===true).length,
    assisted: attempted.filter(o=>o.assistance===true).length,
    excluded: observations.filter(o=>o.excluded===true).length,
    missing_rubric: attempted.filter(o=>typeof o.rubric_pass!=='boolean').length,
    status: n ? 'observed_requires_review' : 'not_run' };
}
export function serviceContribution(engagement) {
  const required=['revenue','refunds','nonlabor_cost','producer_hours','reviewer_hours','admin_support_hours','hourly_valuation'];
  if (required.some(k=>typeof engagement[k]!=='number'||!Number.isFinite(engagement[k])||engagement[k]<0)) throw new Error('INVALID_COST_OBSERVATION');
  if (engagement.refunds > engagement.revenue) throw new Error('REFUNDS_EXCEED_REVENUE');
  if (!['actual_paid','unpaid_pilot','synthetic'].includes(engagement.evidence_kind)) throw new Error('EVIDENCE_KIND_REQUIRED');
  const labor=(engagement.producer_hours+engagement.reviewer_hours+engagement.admin_support_hours)*engagement.hourly_valuation;
  return { evidence_kind: engagement.evidence_kind, counts_as_paid_adoption: engagement.evidence_kind==='actual_paid' && engagement.revenue-engagement.refunds>0,
    loaded_cost: labor+engagement.nonlabor_cost, contribution: engagement.revenue-engagement.refunds-labor-engagement.nonlabor_cost,
    status: engagement.evidence_kind==='synthetic'?'scenario_only':'observed_management_estimate' };
}
export function validateCoverage(ledger) {
  const expected=Array.from({length:80},(_,i)=>`CH-${String(i+1).padStart(3,'0')}`);
  if (ledger.scope_count!==80 || ledger.changes.length!==80 || JSON.stringify(ledger.changes.map(x=>x.change_id).sort())!==JSON.stringify(expected)) throw new Error('ORIGINAL_SCOPE_INCOMPLETE');
  const allowed=['not_run','candidate','locally_verified','independently_reviewed','integrated','operationally_observed','failed','blocked','unavailable','deferred_with_reason'];
  for (const c of ledger.changes) {
    if (!c.scope || !c.completion_evidence || !allowed.includes(c.implementation_result)) throw new Error('INVALID_COVERAGE_ROW');
    if (!['not_run','blocked','unavailable','deferred_with_reason','candidate'].includes(c.implementation_result) && !c.artifacts.length) throw new Error('COMPLETION_EVIDENCE_REQUIRED');
    if (['blocked','unavailable','deferred_with_reason'].includes(c.implementation_result) && !c.limitation) throw new Error('DISPOSITION_REASON_REQUIRED');
  }
  return {scope_count:80,complete_scope_retained:true};
}
