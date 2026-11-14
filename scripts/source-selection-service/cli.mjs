import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {replay,reviewBinding,scopeBinding,quoteBinding} from './workflow.mjs';
import {readEngagement,writeRecord,exportEngagement,workspaceDestination,root} from './io.mjs';
export function syntheticEvents(record) {
 const e=(type,minute,extra={})=>({type,at:`2026-11-14T01:${String(minute).padStart(2,'0')}:00Z`,reason:'Synthetic workflow rehearsal only',...extra});
 return [e('triage',0),e('quote',1,{assumptions:record.quote_assumptions,scope_binding:scopeBinding(record.scope)}),e('confirm_scope',2,{simulated:true,scope_revision:record.scope.revision,scope_binding:scopeBinding(record.scope),quote_binding:quoteBinding(record.scope,record.quote_assumptions)}),e('start_research',3),
  e('source_access_failed',4,{source_id:record.sources[0].source_id,outcome:'blocked',reason:'Simulated access restriction; no publisher request made'}),
  e('resume_with_gap',5,{simulated:true,retain_unresolved:true}),e('log_time',6,{role:'producer',minutes:30,simulated:true}),
  e('log_time',7,{role:'reviewer',minutes:15,simulated:true}),e('log_time',8,{role:'admin_support',minutes:10,simulated:true}),e('submit_review',9),
  e('review',10,{simulated:true,reviewer_id:'synthetic-reviewer',binding:reviewBinding(record.scope,record.sources),decisions:record.sources.map(s=>({source_id:s.source_id,decision:'defer',rationale:'Candidate guide does not establish accepted source claims or rights',next_action:'Obtain release-specific source and rights review'}))}),
  e('deliver',11,{simulated:true,deliverable_kind:'unresolved_gap_brief'}),e('close',12,{simulated:true})];
}
export async function run(argv) {
 const [command,input,arg,output]=argv;
 if(command==='validate') {const record=await readEngagement(input),state=replay(record);return {synthetic:true,state:state.state,scope_revision:state.scope.revision,source_count:record.sources.length,retained_access_attempts:state.attempts.length,review_present:state.review!==null,paid_adoption:false};}
 if(command==='advance') {
  const record=await readEngagement(input),event=JSON.parse(await readFile(arg,'utf8'));
  return writeRecord(output,{...record,events:[...record.events,event]});
 }
 if(command==='export') return exportEngagement(await readEngagement(input),arg);
 if(command==='dry-run') {
  const template=await readEngagement(path.join(root,'docs/source-selection-service/engagement.template.json'));
  const target=await workspaceDestination(input);await mkdir(target,{mode:0o700});
  const completed={...template,events:syntheticEvents(template)};
  const receipt=await exportEngagement(completed,path.join(target,'gap-brief'));
  const cancelled={...template,engagement_id:'synthetic-cancelled',events:[...syntheticEvents(template).slice(0,5),{type:'cancel',at:'2026-11-14T01:05:00Z',reason:'Synthetic customer withdrawal while access is blocked',simulated:true,obligations_disposition:'no_real_customer_or_charge'},{type:'close',at:'2026-11-14T01:06:00Z',reason:'Synthetic cancellation closed with retained evidence',simulated:true}]};
  await writeRecord(path.join(target,'cancelled.private.json'),cancelled);
  const blocked={...template,engagement_id:'synthetic-access-blocked',events:syntheticEvents(template).slice(0,5)};
  await writeRecord(path.join(target,'blocked.private.json'),blocked);
  const result={synthetic:true,gap_brief:receipt,blocked_state:replay(blocked).state,cancellation_state:replay(cancelled).state,real_outreach:0,real_charges:0,actual_customer_acceptance:'not_observed',independent_human_review:'not_run',paid_demand:'not_observed'};
  await writeFile(path.join(target,'dry-run.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
 }
 throw new Error('Usage: cli.mjs validate RECORD | advance RECORD EVENT NEW_RECORD | export RECORD NEW_DIRECTORY | dry-run NEW_DIRECTORY');
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 try {console.log(JSON.stringify(await run(process.argv.slice(2)),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
