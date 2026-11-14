import {readFile,realpath,stat,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {replay,previewBrief} from './workflow.mjs';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sha = bytes=>createHash('sha256').update(bytes).digest('hex');
export async function validateEvidence(record) {
 const results=[];
 for(const source of record.sources ?? []) {
  const relative=source.evidence?.path;
  if(typeof relative!=='string'||!relative.startsWith('docs/source-selection-sources/')||relative.split('/').includes('..'))throw new Error('EVIDENCE_OUTSIDE_PERMITTED_GUIDES');
  const canonical=await realpath(path.resolve(root,relative));
  const allowed=await realpath(path.join(root,'docs/source-selection-sources'));
  if(!canonical.startsWith(allowed+path.sep))throw new Error('EVIDENCE_SYMLINK_ESCAPE');
  const bytes=await readFile(canonical);
  if(sha(bytes)!==source.evidence.sha256)throw new Error('EVIDENCE_CHANGED_REVIEW_REQUIRED');
  results.push({source_id:source.source_id,path:relative,sha256:sha(bytes),scope:'candidate guide only; original publisher bytes and rights are not established'});
 }
 return results;
}
export async function readEngagement(file) {
 const record=JSON.parse(await readFile(file,'utf8'));
 replay(record);
 await validateEvidence(record);
 return record;
}
export async function workspaceDestination(destination) {
 if(!path.isAbsolute(destination))throw new Error('ABSOLUTE_WORKSPACE_OUTPUT_REQUIRED');
 const parent=await realpath(path.dirname(destination));
 const workspace=await realpath('/workspace');
 if(workspace!=='/workspace'||!parent.startsWith(workspace+path.sep))throw new Error('WORKSPACE_OUTPUT_REQUIRED');
 const [parentInfo,workspaceInfo,system]=await Promise.all([stat(parent),stat(workspace),stat('/')]);
 if(parentInfo.dev!==workspaceInfo.dev||workspaceInfo.dev===system.dev)throw new Error('WORKSPACE_DEVICE_REQUIRED');
 return path.join(parent,path.basename(destination));
}
export async function writeRecord(destination,record) {
 replay(record);await validateEvidence(record);
 const target=await workspaceDestination(destination);
 await writeFile(target,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
 return {path:target,state:replay(record).state,synthetic:true};
}
export async function exportEngagement(record,destination,{destinationCheck=workspaceDestination}={}) {
 const state=replay(record), evidence=await validateEvidence(record),preview=previewBrief(record);
 const target=await destinationCheck(destination);
 await mkdir(target,{mode:0o700});
 await mkdir(path.join(target,'private'),{mode:0o700});
 await mkdir(path.join(target,'preview'),{mode:0o700});
 const entries=[['private/engagement.json',record],['private/evidence-check.json',evidence],['preview/brief.json',preview]];
 const files=[];
 for(const [name,value] of entries) {
  const bytes=JSON.stringify(value,null,2)+'\n';
  await writeFile(path.join(target,name),bytes,{flag:'wx',mode:0o600});
  files.push({path:name,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)});
 }
 const receipt={schema:'ushso.synthetic-service-export.v1',synthetic:true,state:state.state,files,actual_revenue:null,public_release_authorized:false,customer_acceptance:'not_observed',independent_human_review:'not_run'};
 await writeFile(path.join(target,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
 return receipt;
}
