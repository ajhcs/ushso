import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {replay,previewBrief,quoteScenario,reviewBinding} from '../../scripts/source-selection-service/workflow.mjs';
import {syntheticEvents} from '../../scripts/source-selection-service/cli.mjs';
import {validateEvidence,exportEngagement,workspaceDestination} from '../../scripts/source-selection-service/io.mjs';
const template=JSON.parse(await readFile(new URL('../../docs/source-selection-service/engagement.template.json',import.meta.url),'utf8'));
const completed=()=>({...structuredClone(template),events:syntheticEvents(template)});
test('quote is explicit scenario with all delivery labor; no real price/revenue',()=>{
 const q=quoteScenario(template.quote_assumptions);
 assert.equal(q.loaded_cost,775);assert.equal(q.price_floor,1192.31);assert.equal(q.actual_quote_sent,false);assert.equal(q.actual_revenue,null);
 assert.throws(()=>quoteScenario({...template.quote_assumptions,target_margin:1}),/MARGIN/);
 assert.throws(()=>quoteScenario({...template.quote_assumptions,producer_hours:1,reviewer_hours:0,admin_hours:0,nonlabor_cost:0,hourly_valuation:1e307,target_margin:0}),/ROUNDING_OVERFLOW/);
});
test('completed rehearsal preserves failed access and unresolved claims; no paid adoption',()=>{
 const r=replay(completed());assert.equal(r.state,'closed');assert.equal(r.attempts[0].outcome,'blocked');assert.equal(r.paid_adoption,false);
 assert.equal(r.review.decisions.length,4);assert.equal(r.time.length,3);
});
test('delivery without source review, producer self-review and omitted domain decisions fail',()=>{
 for(const mutate of [
  r=>{r.events=r.events.filter(e=>e.type!=='review');},
  r=>{r.events.find(e=>e.type==='review').reviewer_id=r.producer_id;},
  r=>{r.events.find(e=>e.type==='review').decisions.pop();}
 ]){const r=completed();mutate(r);assert.throws(()=>replay(r),/REVIEW/);}
});
test('source or scope changes invalidate review; quote and confirmation bind scope revision',()=>{
 const r=completed();r.sources[0].source_id='different_source';assert.throws(()=>replay(r),/ACCESS_FAILURE_REQUIRED|REVIEW_BINDING_MISMATCH/);
 const q=completed();q.events.find(e=>e.type==='confirm_scope').scope_revision=2;assert.throws(()=>replay(q),/SCOPE_CONFIRMATION/);
 const revised=completed();revised.events=revised.events.slice(0,10);const scope={...revised.scope,revision:2};
 revised.events.push({type:'revise_scope',at:'2026-11-14T01:10:00Z',reason:'Changed period requires a new quote and review',scope});
 assert.equal(replay(revised).state,'scope_revision_requested');assert.equal(replay(revised).review,null);assert.equal(replay(revised).quote,null);
 revised.events.push({type:'deliver',at:'2026-11-14T01:11:00Z',reason:'Attempt to reuse earlier work',simulated:true,deliverable_kind:'unresolved_gap_brief'});assert.throws(()=>replay(revised),/INVALID_TRANSITION/);
});
test('blocked and cancelled work cannot export a deliverable; cancellation retains failed attempt',()=>{
 const r=completed();r.events=r.events.slice(0,5);assert.equal(replay(r).state,'blocked_by_source_access');assert.throws(()=>previewBrief(r),/BRIEF_NOT_DELIVERABLE/);
 r.events.push({type:'cancel',at:'2026-11-14T01:05:00Z',reason:'Synthetic withdrawal',simulated:true,obligations_disposition:'no_real_customer_or_charge'});
 assert.equal(replay(r).state,'cancelled');assert.equal(replay(r).attempts.length,1);assert.throws(()=>previewBrief(r),/BRIEF_NOT_DELIVERABLE/);
});
test('real mode, accepted claims and invented actual facts fail closed',()=>{
 for(const mutate of [r=>r.mode='actual',r=>r.sources[0].rights_state='allowed',r=>r.actual_facts.revenue=50]){const r=completed();mutate(r);assert.throws(()=>replay(r));}
});
test('public preview allowlist excludes private task, customer, notes, quote and reviewer',()=>{
 const r=completed();r.sources[0].evidence.extra_private='NESTED-PRIVATE-NOTE';r.events.find(e=>e.type==='review').binding=reviewBinding(r.scope,r.sources);const serialized=JSON.stringify(previewBrief(r));
 assert.equal(serialized.includes('NESTED-PRIVATE-NOTE'),false);
 for(const value of [r.private_customer_reference,r.private_notes,r.scope.private_question,r.producer_id,'synthetic-reviewer'])assert.equal(serialized.includes(value),false);
 assert.equal(previewBrief(r).publication_authorized,false);assert.equal(previewBrief(r).analysis_feasible,'not_established');
});
test('candidate guide evidence is hash-bound and altered references fail',async()=>{
 assert.equal((await validateEvidence(template)).length,4);
 const r=structuredClone(template);r.sources[0].evidence.sha256='0'.repeat(64);await assert.rejects(validateEvidence(r),/EVIDENCE_CHANGED/);
 r.sources[0].evidence.path='../outside';await assert.rejects(validateEvidence(r),/OUTSIDE/);
 await assert.rejects(workspaceDestination('relative'),/ABSOLUTE_WORKSPACE/);
});
test('export writes separate restricted private and preview files and refuses replacement',async()=>{
 const parent=process.env.RUNNER_TEMP??process.env.TMPDIR??path.resolve('.work/service-tests');await mkdir(parent,{recursive:true});
 const dir=await mkdtemp(path.join(parent,'synthetic-service-test-'));
 // Storage authority is separately enforced by the production CLI. This test
 // exercises serialization/permissions on the test runner's authorized storage.
 const options={destinationCheck:async value=>value};
 try{
  const target=path.join(dir,'export'),receipt=await exportEngagement(completed(),target,options);
  assert.equal(receipt.public_release_authorized,false);assert.equal((await stat(path.join(target,'private/engagement.json'))).mode&0o777,0o600);
  const preview=await readFile(path.join(target,'preview/brief.json'),'utf8');assert.equal(preview.includes(template.private_notes),false);
  await assert.rejects(exportEngagement(completed(),target,options),/EEXIST/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('reviewed then cancelled then closed never becomes an exportable delivery',async()=>{
 const r=completed();r.events=r.events.filter(e=>!['deliver','close'].includes(e.type));
 r.events.push({type:'cancel',at:'2026-11-14T01:11:00Z',reason:'Synthetic withdrawal after review',simulated:true,obligations_disposition:'no_real_customer_or_charge'},
 {type:'close',at:'2026-11-14T01:12:00Z',reason:'Close cancellation without delivery',simulated:true});
 assert.equal(replay(r).state,'closed');assert.equal(replay(r).closed_from,'cancelled');assert.equal(replay(r).delivered,false);
 assert.ok(replay(r).review,'retain review history without delivering');assert.throws(()=>previewBrief(r),/BRIEF_NOT_DELIVERABLE/);
 await assert.rejects(exportEngagement(r,'/workspace/should-not-be-written'),/BRIEF_NOT_DELIVERABLE/);
});

test('same-revision scope edits and changed quote assumptions cannot reuse confirmation',()=>{
 const changed=completed();changed.scope.geography='Synthetic different geography';changed.events.find(e=>e.type==='review').binding=reviewBinding(changed.scope,changed.sources);
 assert.throws(()=>replay(changed),/QUOTE_SCOPE_BINDING_MISMATCH/);
 const changedQuote=completed();changedQuote.events.find(e=>e.type==='quote').assumptions={...template.quote_assumptions,hourly_valuation:80};
 assert.throws(()=>replay(changedQuote),/SCOPE_CONFIRMATION_MISMATCH/);
});
