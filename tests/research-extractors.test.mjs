import test from 'node:test';
import assert from 'node:assert/strict';
import {hash,extractRecord,pointerValue,verifyClaim as verifyBoundClaim,verifyProposalClaim,bindCatalog,documentedEnumeration,dictionaryFrom} from '../scripts/research/source-extractors.mjs';
import {extractVersionedVariables,verifyVariableIdentity,verifyVersionedVariables} from '../scripts/research/source-extractors.mjs';
const verifyClaim=(claim,captures,record)=>verifyBoundClaim(claim,captures,record,'g');
test('generation, proposal provenance and future capture-time substitutions fail closed',()=>{
 const r=record(),m=cap({id:'abcd-1234',columns:[{fieldName:'x'}]}),[c]=extractRecord(r,{metadata:m},'g').claims,cs=new Map([[m.url,m]]);
 assert.throws(()=>verifyClaim({...c,generation:'invented'},cs,r),/GENERATION_BINDING/);
 assert.throws(()=>verifyBoundClaim(c,cs,r),/GENERATION_BINDING/);
 const diff={after:c.value,evidence:c.evidence,scope:c.scope};
 assert.ok(verifyProposalClaim(c,diff,cs,r,'g'));
 for(const field of ['url','capture_sha256','pointer','observed_at'])assert.throws(()=>verifyProposalClaim(c,{...diff,evidence:{...c.evidence,[field]:'forged'}},cs,r,'g'),/DIFF_EVIDENCE_BINDING/);
 assert.throws(()=>verifyProposalClaim(c,{...diff,scope:'certified'},cs,r,'g'),/DIFF_EVIDENCE_BINDING/);
 for(const time of ['invalid','2099-01-01T00:00:00Z'])assert.throws(()=>verifyClaim({...c,evidence:{...c.evidence,observed_at:time}},new Map([[m.url,{...m,captured_at:time}]]),r),/CAPTURE_TIME_INVALID/);
});
const record=(source='cdc-socrata',id='abcd-1234')=>({record_id:'r:'+id,title:'Test asset',identity:{source:{source_id:source},match_fields:{source_id:id}}});
const cap=(data,url='https://data.cdc.gov/api/views/abcd-1234.json')=>{const text=JSON.stringify(data);return{data,text,url,sha256:hash(text),status:'captured',captured_at:'2026-09-07T00:00:00Z'}};
test('Muse T02/T04/T06/T11: generic labels, missing links, empty domains and malformed pointers',()=>{
 for(const label of ['Datasets','Database','Rows of data',' data '])assert.equal(extractRecord(record(),{metadata:cap({id:'abcd-1234',metadata:{rowLabel:label}})},'g').claims.length,0);
 assert.equal(extractRecord(record(),{metadata:cap({id:'abcd-1234',metadata:{rowLabel:'Hospital discharge records'}})},'g').claims.length,1);
 assert.equal(documentedEnumeration({}),null);
 assert.equal(pointerValue({'a/b~c':1},'/a~1b~0c'),1);
 for(const p of ['/a~2b','/a~'])assert.throws(()=>pointerValue({},p),/INVALID_POINTER_ESCAPE/);
 const id='https://api.census.gov/data/id/X',r=record('census-api',id),m=cap({dataset:[{identifier:id,c_variablesLink:'https://api.census.gov/data/2023/x/variables.json'}]},'https://api.census.gov/data.json');
 assert.equal(extractRecord(r,{metadata:m},'g').issues[0].code,'LINK_CAPTURE_MISSING');
});
test('Muse T01: reordered nested claim values retain semantic equality',()=>{
 const r=record(),m=cap({id:'abcd-1234',columns:[{fieldName:'x'}]}),[c]=extractRecord(r,{metadata:m},'g').claims;
 const reordered=Object.fromEntries(Object.entries(c.value[0]).reverse());
 assert.ok(verifyClaim({...c,value:[reordered]},new Map([[m.url,m]]),r));
});
test('publisher enumerations preserve codes and labels without inventing missing values',()=>{
 const labels={'1':'Yes','2':'No','-1':'Not in Universe'};assert.deepEqual(documentedEnumeration(labels),{codes:Object.keys(labels),labels});
 for(const missing of [undefined,null,'1=Yes',['Yes','No'],{min:1,max:2},{1:{label:'Yes'}}])assert.equal(documentedEnumeration(missing),null);
});
test('CDC exact identity produces quoted dictionary evidence but never approves units or payload schema',()=>{
 const r=record(),m=cap({id:'abcd-1234',columns:[{fieldName:'count',name:'Count',dataTypeName:'number'}]});
 const out=extractRecord(r,{metadata:m},'g');assert.equal(out.claims.length,1);
 const c=out.claims[0];assert.equal(c.value[0].unit,null);assert.equal(c.publication_authorized,false);assert.ok(verifyClaim(c,new Map([[m.url,m]]),r));
 const {value,...metadata}=c;assert.ok(verifyClaim({...metadata,value},new Map([[m.url,m]]),r),'serialized review claims may reorder object keys');
 assert.throws(()=>verifyClaim({...c,value:[{...c.value[0],unit:'persons'}]},new Map([[m.url,m]]),r),/UNSUPPORTED_VALUE/);
});
test('identity mismatch and malformed collections isolate one record without interrupting valid peers',()=>{
 const r=record();for(const data of [{id:'other',columns:[]},{id:'abcd-1234',columns:{}},{id:'abcd-1234',columns:[{fieldName:'x'},{fieldName:'x'}]}])assert.ok(extractRecord(r,{metadata:cap(data)},'g').issues.length);
 assert.equal(extractRecord(r,{metadata:cap({id:'abcd-1234',columns:[{fieldName:'x'}]})},'g').claims.length,1);
});
test('reporting frequency and generic row labels are not observation-grain evidence',()=>{
 for(const rowLabel of ['quarterly','daily','row','records'])assert.equal(extractRecord(record(),{metadata:cap({id:'abcd-1234',metadata:{rowLabel}})},'g').claims.length,0);
});
test('restricted assets retain contradictions without promoting related public products',()=>{
 const r={...record(),title:'Restricted dataset'},m=cap({id:'abcd-1234',description:'This restricted product differs from the public-use dataset.'});
 const result=extractRecord(r,{metadata:m},'g');assert.equal(result.issues[0].code,'RESTRICTED_ASSET_WITH_PUBLIC_PRODUCT_REFERENCE');assert.ok(result.claims.every(c=>c.field!=='public_payload'));
});
test('Census dictionaries require an exact identifier and publisher-linked endpoint',()=>{
 const id='https://api.census.gov/data/id/EXACT',r=record('census-api',id),url='https://api.census.gov/data/2023/test/variables.json';
 const m=cap({dataset:[{identifier:id,c_variablesLink:url}]},'https://api.census.gov/data.json'),v=cap({variables:{AGE:{label:'Age',predicateType:'int'}}},url);
 const result=extractRecord(r,{metadata:m,variables:v},'g');assert.equal(result.claims.length,1);assert.equal(result.claims[0].evidence.parent.identity_pointer,'/dataset/0/identifier');
 assert.ok(extractRecord(r,{metadata:m,variables:{...v,url:url.replace('2023','2024')}},'g').issues.length);
 assert.throws(()=>bindCatalog(r,cap({dataset:[{identifier:id},{identifier:id}]})),/AMBIGUOUS_IDENTITY/);
});
test('Census query levels do not assert populated coverage and vintage is not an observation date',()=>{
 const id='https://api.census.gov/data/id/X',r=record('census-api',id),url='https://api.census.gov/data/2023/x/geography.json';
 const m=cap({dataset:[{identifier:id,c_vintage:2023,c_geographyLink:url}]},'https://api.census.gov/data.json');
 const out=extractRecord(r,{metadata:m,geography:cap({fips:[{name:'county'}]},url)},'g');
 assert.match(out.claims.find(c=>c.dimension==='geography').scope,/not all areas populated/);assert.equal(out.claims.find(c=>c.dimension==='dates').field,'publisher_catalog_c_vintage');
});
test('tampered captures, record substitutions and unapproved approvals are rejected',()=>{
 const r=record(),m=cap({id:'abcd-1234',columns:[{fieldName:'x'}]}),[c]=extractRecord(r,{metadata:m},'g').claims;
 assert.throws(()=>verifyClaim(c,new Map([[m.url,{...m,text:m.text+' '}]]),r),/CAPTURE_BINDING/);
 assert.throws(()=>verifyClaim(c,new Map([[m.url,m]]),{...r,title:'changed'}),/RECORD_BINDING/);
 assert.throws(()=>verifyClaim({...c,publication_authorized:true},new Map([[m.url,m]]),r),/UNAUTHORIZED_APPROVAL/);
});
test('literal evidence cannot be relabelled as a different scientific assertion',()=>{
 const r=record(),m=cap({id:'abcd-1234',publicationDate:123}),[c]=extractRecord(r,{metadata:m},'g').claims,cs=new Map([[m.url,m]]);
 for(const change of [{field:'observation_date'},{dimension:'observation_unit'},{scope:'verified observation grain'},{status:'bound_supported'}])assert.throws(()=>verifyClaim({...c,...change},cs,r),/CLAIM_SCOPE_OR_IDENTITY/);
 assert.throws(()=>verifyClaim({...c,source_id:'census-api'},cs,r),/RECORD_BINDING/);
});
test('Census parent identity and linked endpoint are required during verification',()=>{
 const id='https://api.census.gov/data/id/X',r=record('census-api',id),url='https://api.census.gov/data/2023/x/variables.json';
 const m=cap({dataset:[{identifier:id,c_variablesLink:url}]},'https://api.census.gov/data.json'),v=cap({variables:{X:{label:'X'}}},url);
 const [c]=extractRecord(r,{metadata:m,variables:v},'g').claims,cs=new Map([[m.url,m],[v.url,v]]);
 assert.ok(verifyClaim(c,cs,r));
 assert.throws(()=>verifyClaim(c,new Map([[v.url,v]]),r),/CLAIM_SCOPE_OR_IDENTITY/);
 assert.throws(()=>verifyClaim({...c,evidence:{...c.evidence,parent:{...c.evidence.parent,identity_pointer:'/dataset/1/identifier'}}},cs,r),/CLAIM_SCOPE_OR_IDENTITY/);
 assert.throws(()=>verifyClaim(c,new Map([[m.url,{...m,data:{dataset:[]}}],[v.url,v]]),r),/CAPTURE_BODY_MISMATCH/);
});

test('versioned CDC extraction preserves wire names separately from labels and replays evidence', () => {
 const data={columns:[{fieldName:':id',name:'metadata',dataTypeName:'text'},{fieldName:'ZIP',name:'Postal code',description:'Five-character code',dataTypeName:'text'},{fieldName:'0007',name:'Leading zero',dataTypeName:'text'},{fieldName:'—',name:'Unicode sentinel',dataTypeName:'text'}]};
 const body=JSON.stringify(data),capture={status:'captured',url:'https://example.test/cdc.json',text:body,data,sha256:hash(body),captured_at:'2026-09-11T00:00:00Z',evidence_id:'evidence:test:cdc-v1'};
 const variables=extractVersionedVariables(data.columns,'cdc',{capture});
 assert.deepEqual(variables.map(v=>v.wire_name),['ZIP','0007','—']);
 assert.equal(variables[0].publisher_label,'Postal code');assert.equal(variables[0].definition,'Five-character code');
 assert.equal(variables[0].provenance.pointer,'/columns/1');assert.equal(variables[1].provenance.pointer,'/columns/2');assert.equal(verifyVersionedVariables(variables,capture),true);
 const legacy=dictionaryFrom(data.columns,'cdc');assert.deepEqual(legacy[1],{name:'0007',label:'Leading zero',description:'',data_type:'text',unit:null,allowed_values:[]});
});

test('versioned Census extraction separates concept from definition and preserves escaped literal values', () => {
 const data={variables:{'A/B~C':{label:'Label',concept:'Concept only',predicateType:'string',values:{item:{'001':'Leading zero','—':'Unicode'}}},EXACT:{label:'Defined',description:'Definition',predicateType:'int'}}};
 const body=JSON.stringify(data),capture={status:'captured',url:'https://example.test/census.json',text:body,data,sha256:hash(body),captured_at:'2026-09-11T00:00:00Z',evidence_id:'evidence:test:census-v1'};
 const variables=extractVersionedVariables(data.variables,'census',{capture});
 assert.equal(variables[0].wire_name,'A/B~C');assert.equal(variables[0].publisher_concept,'Concept only');assert.equal(variables[0].definition,null);
 assert.deepEqual(variables[0].code_values.values,[{code:'001',label:'Leading zero'},{code:'—',label:'Unicode'}]);
 assert.equal(variables[0].provenance.pointer,'/variables/A~1B~0C');assert.equal(verifyVariableIdentity(variables[0],capture),true);
 assert.equal(variables[1].publisher_concept,null);assert.equal(variables[1].definition,'Definition');
});

test('dictionary-only rows retain a documented name without inventing a wire mapping', () => {
 const data={variables:[{documented_name:'Dictionary-only label',label:'Displayed label',description:'Publisher text'}]};const body=JSON.stringify(data),capture={status:'captured',url:'https://example.test/cms-dictionary.json',text:body,data,sha256:hash(body),captured_at:'2026-09-11T00:00:00Z',evidence_id:'evidence:test:cms-dictionary-v1'};
 const [variable]=extractVersionedVariables(data,'cms',{capture});
 assert.equal(variable.wire_name,null);assert.equal(variable.mapping.state,'unmatched');assert.equal(variable.mapping.documented_name,'Dictionary-only label');assert.equal(variable.variable_id,null);assert.equal(verifyVariableIdentity(variable,capture),true);
});

test('versioned extraction defaults missing release context to an unresolved, non-promotable identity', () => {
 const data={columns:[{fieldName:'COUNT',name:'Count',dataTypeName:'number'}]};const body=JSON.stringify(data),capture={status:'captured',url:'https://example.test/cdc.json',text:body,data,sha256:hash(body),captured_at:'2026-09-11T00:00:00Z',evidence_id:'evidence:test:unresolved'};
 const [variable]=extractVersionedVariables(data.columns,'cdc',{capture});
 assert.equal(variable.variable_id,null);assert.equal(variable.context_binding.state,'unresolved');assert.equal(variable.publication_authorized,false);assert.equal(variable.promotion_eligible,false);
});

test('versioned verification requires a successful capture and retained raw bytes', () => {
const data={variables:{COUNT:{label:'Count',predicateType:'int'}}};const body=JSON.stringify(data);const capture={status:'captured',url:'https://example.test/capture-gate.json',text:body,data,sha256:hash(body),captured_at:'2026-09-11T00:00:00Z',evidence_id:'evidence:test:capture-gate'};
const [claim]=extractVersionedVariables(data.variables,'census',{capture});
assert.throws(()=>verifyVariableIdentity(claim,{...capture,status:'failed'}),/VARIABLE_CAPTURE_NOT_SUCCESSFUL/);
const {text,...withoutBytes}=capture;
assert.throws(()=>verifyVariableIdentity(claim,withoutBytes),/VARIABLE_CAPTURE_BYTES_REQUIRED/);
});
test('resolved versioned replay uses an independently supplied context and capture evidence', () => {
const data={variables:{COUNT:{label:'Count',predicateType:'int'}}};const body=JSON.stringify(data);const capture={status:'captured',url:'https://example.test/trusted-replay.json',text:body,data,sha256:hash(body),captured_at:'2026-09-11T00:00:00Z',evidence_id:'evidence:test:trusted-replay'};
const context={source_id:'urn:ushso:source:trusted',asset_id:'urn:ushso:asset:trusted',release_id:'urn:ushso:release:trusted',distribution_id:'urn:ushso:distribution:trusted',schema_snapshot_id:'urn:ushso:schema:trusted',schema_field_id:'urn:ushso:field:trusted',field_revision_id:'urn:ushso:revision:trusted'};
const [claim]=extractVersionedVariables(data.variables,'census',{capture,context_binding:context});
assert.equal(verifyVariableIdentity(claim,capture,{context_binding:context}),true);
assert.throws(()=>verifyVariableIdentity({...claim,context_binding:{...claim.context_binding,release_id:'urn:ushso:release:foreign'}},capture,{context_binding:context}),/VARIABLE_TRUSTED_CONTEXT_MISMATCH|UNSUPPORTED_VERSIONED_VALUE/);
assert.throws(()=>verifyVariableIdentity(claim,capture),/VARIABLE_TRUSTED_CONTEXT_REQUIRED/);
});
