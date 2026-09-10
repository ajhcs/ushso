import { pathToFileURL } from 'node:url';
const modulePath = process.argv[2];
const {createFieldObservation, buildAccessSummary} = await import(pathToFileURL(modulePath));
const T='2026-09-01T00:00:00.000Z';
function evidence(id,at=T){return {evidence_id:id,evidence_state:'documented',observed_at:at,source_locator:'https://example.invalid/retained-doc',claim_paths:['/access'],staleness_state:'current'};}
function observation(id, at, requirementState, attemptedAt=at){
 const refs=[evidence('evidence:'+id,at)];
 return createFieldObservation({observation_id:'observation:'+id,record_id:'record:fixture',source_id:'source:fixture',field_id:'payload.value',field_role:'metadata',unit:null,value:{kind:'boolean',value:true},value_state:'known',evidence_state:'observed',applicability_state:'supported',attempt_state:'succeeded',endpoint_scope:{endpoint_id:'endpoint:fixture',resource:'resource:payload',operation:'payload_read'},evidence_refs:refs,reason_codes:['test_fixture'],source_observed_at:T,observed_at:at,recorded_at:at,attempted_at:attemptedAt,access_facts:{credential_requirements:[{requirement_id:'requirement:api-key',kind:'credential',name:'api_key',state:requirementState,evidence_refs:refs,observed_at:at}],cost:{state:'unknown',amount:null,currency:null,evidence_refs:refs,observed_at:at},usage_limit:{state:'unknown',limit:null,unit:null,evidence_refs:refs,observed_at:at},evidence_refs:refs,observed_at:at}});
}
const older=observation('older','2026-09-02T00:00:00.000Z','required');
const newer=observation('newer','2026-09-04T00:00:00.000Z','not_required');
const summarize=observations=>buildAccessSummary({observations,asOf:'2026-09-10T00:00:00.000Z'}).endpoint_scopes[0];
const forward=summarize([older,newer]);const reverse=summarize([newer,older]);
const attemptOld=observation('recorded-late-old-attempt','2026-09-05T00:00:00.000Z','required','2026-09-01T00:00:00.000Z');
const attemptNew=observation('recorded-earlier-new-attempt','2026-09-04T00:00:00.000Z','required','2026-09-03T00:00:00.000Z');
const attempts=summarize([attemptOld,attemptNew]);
let invalidDateAccepted=false,invalidDateError=null;
try{createFieldObservation({...older,field_role:'date',value:{kind:'date',value:'2026-02-31'}});invalidDateAccepted=true;}catch(error){invalidDateError=error.code??error.message;}
const result={candidate_module:modulePath,credential_order:{forward:forward.documented.credential_requirements[0].state,reverse:reverse.documented.credential_requirements[0].state,order_invariant:JSON.stringify(forward.documented.credential_requirements)===JSON.stringify(reverse.documented.credential_requirements)},latest_attempt:{expected_id:attemptNew.observation_id,actual_attempt_id:attempts.latest_attempt?.observation_id,actual_success_id:attempts.latest_successful_check?.observation_id,pass:attempts.latest_attempt?.observation_id===attemptNew.observation_id&&attempts.latest_successful_check?.observation_id===attemptNew.observation_id},invalid_calendar_date:{accepted:invalidDateAccepted,error:invalidDateError}};
console.log(JSON.stringify(result,null,2));
process.exitCode=result.credential_order.order_invariant&&result.latest_attempt.pass&&!invalidDateAccepted?0:1;
