import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {validateOperatingBoundsPolicy} from './baseline-module.mjs';
const repo='/mnt/d/worktrees/plumbob/ushso-research-program-20260910';
const {APPROVED_SOURCE_DESCRIPTOR_TEMPLATES,validateDescriptor}=await import(repo+'/packages/connectors/src/index.mjs');
const {DEFAULT_RESPONSE_LIMITS,routeManifestInventory}=await import(repo+'/packages/connectors/src/route-manifest.mjs');
const {STAGE_POLICIES,retryBudget}=await import(repo+'/packages/ingestion/src/index.mjs');
const {DLQ_SINK_TRANSPORT_POLICY}=await import(repo+'/packages/ingestion/src/dlq-sink-policy.mjs');
const context={descriptors:APPROVED_SOURCE_DESCRIPTOR_TEMPLATES,validateDescriptor,defaultResponseLimits:DEFAULT_RESPONSE_LIMITS,routeManifestInventory,stagePolicies:STAGE_POLICIES,retryBudget,dlqPolicy:DLQ_SINK_TRANSPORT_POLICY};
const policy=JSON.parse(await readFile(new URL('./baseline-policy.json',import.meta.url)));
assert.equal((await validateOperatingBoundsPolicy(policy,context)).valid,true,'Coherent original policy is the positive control');
const results=[];
for(const [name,change] of [['sources object',v=>{v.sources={};}],['null source',v=>{v.sources[0]=null;}],['routes object',v=>{v.sources[0].routes={};}],['forbidden classes object',v=>{v.forbidden_operation_classes={};}]]){
 const value=structuredClone(policy);change(value);
 try{const result=await validateOperatingBoundsPolicy(value,context);results.push({name,expected:'typed_invalid_policy',actual:result,passed:result.valid===false&&Array.isArray(result.issues)});}
 catch(error){results.push({name,expected:'typed_invalid_policy',actual:'thrown_exception',error_name:error.name,message:error.message,passed:false});}
}
console.log(JSON.stringify(results,null,2));
await writeFile(new URL('./results.json',import.meta.url),JSON.stringify({positive_control_passed:true,results,scope:'Pure policy validation of exact immutable bound baseline; no current producer mutation or source request.'},null,2)+'\n');
process.exitCode=results.every(x=>x.passed)?0:1;
