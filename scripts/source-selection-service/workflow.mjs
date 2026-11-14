import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const need = (value,code) => assert.ok(value,code);
const text = value => typeof value==='string' && value.trim().length>0;
const id = value => typeof value==='string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const finite = value => typeof value==='number' && Number.isFinite(value) && value>=0;
const domains = ['finance','ownership','capacity','utilization'];
export function quoteScenario(assumptions) {
  need(assumptions?.evidence_kind==='illustrative_assumptions','QUOTE_ASSUMPTIONS_REQUIRED');
  need(assumptions.currency==='USD','QUOTE_CURRENCY_REQUIRED');
  for(const key of ['producer_hours','reviewer_hours','admin_hours','hourly_valuation','nonlabor_cost','target_margin']) need(finite(assumptions[key]),`INVALID_QUOTE_${key}`);
  need(assumptions.target_margin<1,'INVALID_QUOTE_MARGIN');
  const loaded_cost=(assumptions.producer_hours+assumptions.reviewer_hours+assumptions.admin_hours)*assumptions.hourly_valuation+assumptions.nonlabor_cost;
  need(Number.isFinite(loaded_cost)&&Number.isFinite(loaded_cost/(1-assumptions.target_margin)),'QUOTE_OVERFLOW');
  const priceFloor=Math.ceil(loaded_cost/(1-assumptions.target_margin)*100)/100;
  need(Number.isFinite(priceFloor),'QUOTE_ROUNDING_OVERFLOW');
  return {evidence_kind:'illustrative_assumptions',currency:'USD',loaded_cost,price_floor:priceFloor,actual_quote_sent:false,actual_revenue:null};
}
export function validateScope(scope) {
  need(Number.isInteger(scope?.revision)&&scope.revision>0,'SCOPE_REVISION_REQUIRED');
  for(const key of ['decision','private_question','geography','period','unit','access_constraints','deliverable','exclusions']) need(text(scope[key]),`SCOPE_${key}_REQUIRED`);
  need(Array.isArray(scope.domains)&&domains.every(d=>scope.domains.includes(d))&&new Set(scope.domains).size===4&&scope.domains.length===4,'ALL_FOUR_DOMAINS_REQUIRED');
}
export const scopeBinding = scope => digest(scope);
export const quoteBinding = (scope,assumptions) => digest({scope,assumptions});
export function reviewBinding(scope,sources) {return digest({scope,sources});}
export function replay(record) {
  need(record?.schema==='ushso.synthetic-engagement.v1'&&record.mode==='synthetic','SYNTHETIC_ONLY');
  need(id(record.engagement_id)&&id(record.producer_id),'ENGAGEMENT_ID_REQUIRED');
  need(record.actual_facts?.funding===null&&record.actual_facts?.reviewer_capacity===null&&record.actual_facts?.price===null&&record.actual_facts?.revenue===null,'ACTUAL_FACTS_MUST_REMAIN_UNOBSERVED');
  validateScope(record.scope);
  need(Array.isArray(record.sources)&&record.sources.length>0,'SOURCE_PLAN_REQUIRED');
  const sourceIds=new Set();
  for(const s of record.sources) {
    need(id(s.source_id)&&!sourceIds.has(s.source_id),'SOURCE_ID_INVALID_OR_DUPLICATE');sourceIds.add(s.source_id);
    need(domains.includes(s.domain)&&s.claim_state==='unresolved'&&s.rights_state==='unresolved','SOURCE_CANNOT_BE_PROMOTED_BY_REHEARSAL');
    need(text(s.evidence?.path)&&/^[a-f0-9]{64}$/.test(s.evidence.sha256),'EVIDENCE_REFERENCE_REQUIRED');
  }
  need(domains.every(d=>record.sources.some(s=>s.domain===d)),'DOMAIN_SOURCE_OR_GAP_REQUIRED');
  need(Array.isArray(record.events),'EVENTS_REQUIRED');
  let state='inquiry',scope=structuredClone(record.scope),quote=null,review=null,last=-Infinity,delivered=false,closedFrom=null;
  const attempts=[],time=[];
  for(const event of record.events) {
    const at=Date.parse(event.at);need(typeof event.at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(event.at)&&Number.isFinite(at)&&at>=last,'EVENT_CLOCK_INVALID');last=at;
    need(text(event.reason),'EVENT_REASON_REQUIRED');
    const go = allowed => need(allowed.includes(state),`INVALID_TRANSITION:${state}:${event.type}`);
    switch(event.type) {
      case 'triage': go(['inquiry']);state='triaged';break;
      case 'quote': go(['triaged','scope_revision_requested']);need(event.scope_binding===scopeBinding(scope),'QUOTE_SCOPE_BINDING_MISMATCH');quote={...quoteScenario(event.assumptions),scope_revision:scope.revision,scope_binding:event.scope_binding,binding:quoteBinding(scope,event.assumptions)};state='quoted';break;
      case 'confirm_scope':go(['quoted']);need(event.simulated===true&&event.scope_revision===scope.revision&&event.scope_binding===scopeBinding(scope)&&event.quote_binding===quote.binding,'SCOPE_CONFIRMATION_MISMATCH');state='accepted';break;
      case 'start_research':go(['accepted']);state='researching';break;
      case 'source_access_failed':
        go(['researching']);need(sourceIds.has(event.source_id)&&['blocked','unavailable','failed'].includes(event.outcome),'ACCESS_FAILURE_REQUIRED');
        attempts.push({source_id:event.source_id,outcome:event.outcome,reason:event.reason,at:event.at,synthetic:true});state='blocked_by_source_access';break;
      case 'resume_with_gap':go(['blocked_by_source_access']);need(event.simulated===true&&event.retain_unresolved===true,'GAP_ACKNOWLEDGEMENT_REQUIRED');state='researching';break;
      case 'revise_scope':
        go(['accepted','researching','reviewing','blocked_by_source_access']);validateScope(event.scope);need(event.scope.revision===scope.revision+1,'SCOPE_REVISION_SEQUENCE');
        scope=structuredClone(event.scope);quote=null;review=null;state='scope_revision_requested';break;
      case 'log_time':
        go(['accepted','researching','blocked_by_source_access','reviewing']);need(['producer','reviewer','admin_support'].includes(event.role)&&finite(event.minutes)&&event.minutes>0&&event.simulated===true,'TIME_ENTRY_INVALID');
        time.push({role:event.role,minutes:event.minutes,synthetic:true});break;
      case 'submit_review':go(['researching']);state='reviewing';break;
      case 'review':
        go(['reviewing']);need(event.simulated===true&&id(event.reviewer_id)&&event.reviewer_id!==record.producer_id,'SEPARATE_SIMULATED_REVIEWER_REQUIRED');
        need(event.binding===reviewBinding(scope,record.sources),'REVIEW_BINDING_MISMATCH');
        need(Array.isArray(event.decisions)&&event.decisions.length===sourceIds.size&&new Set(event.decisions.map(d=>d.source_id)).size===sourceIds.size,'REVIEW_ALL_SOURCES_REQUIRED');
        for(const d of event.decisions)need(sourceIds.has(d.source_id)&&['defer','reject'].includes(d.decision)&&text(d.rationale)&&text(d.next_action),'REVIEW_DECISION_INVALID');
        review={reviewer_id:event.reviewer_id,binding:event.binding,decisions:event.decisions,synthetic:true};break;
      case 'deliver':
        go(['reviewing']);need(review?.binding===reviewBinding(scope,record.sources)&&quote?.scope_revision===scope.revision,'CURRENT_REVIEW_AND_QUOTE_REQUIRED');
        need(event.simulated===true&&event.deliverable_kind==='unresolved_gap_brief','ONLY_SYNTHETIC_GAP_BRIEF_PERMITTED');state='delivered';delivered=true;break;
      case 'cancel':
        go(['inquiry','triaged','quoted','accepted','researching','reviewing','scope_revision_requested','blocked_by_source_access']);
        need(event.simulated===true&&event.obligations_disposition==='no_real_customer_or_charge','CANCELLATION_OBLIGATIONS_REQUIRED');state='cancelled';break;
      case 'close':go(['delivered','cancelled']);need(event.simulated===true,'REAL_CUSTOMER_ACCEPTANCE_FORBIDDEN');closedFrom=state;state='closed';break;
      default:throw new Error(`UNKNOWN_EVENT:${event.type}`);
    }
  }
  return {state,closed_from:closedFrom,delivered,scope,quote,review,attempts,time,paid_adoption:false,actual_customer_acceptance:'not_observed'};
}
export function previewBrief(record) {
  const result=replay(record);
  need(result.delivered&&['delivered','closed'].includes(result.state)&&result.review,'BRIEF_NOT_DELIVERABLE');
  // Deliberate allowlist. Private question, notes, identities, quote and time do
  // not cross this boundary. Public text is fixed here, not copied from notes.
  return {schema:'ushso.synthetic-gap-brief.v1',synthetic:true,publication_authorized:false,
    purpose:'Rehearsal of unresolved hospital source selection',
    domains:domains.map(domain=>({domain,status:'unresolved',next_action:'Obtain qualified source and rights review before asserting fitness or acquiring data.'})),
    sources:record.sources.map(s=>({source_id:s.source_id,domain:s.domain,claim_state:s.claim_state,rights_state:s.rights_state,evidence:{path:s.evidence.path,sha256:s.evidence.sha256}})),
    acquisition_authorized:false,analysis_feasible:'not_established',customer_demand:'not_observed'};
}
