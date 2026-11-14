import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CANDIDATE_TRANSITION,validateCandidateTransition} from '../scripts/source-selection-candidate-transition.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('exact candidate is structurally checked but remains unapproved',async()=>{
 const r=await validateCandidateTransition(root);
 assert.equal(r.status,'structurally_verified_pending_review');
 assert.equal(r.approval,null);assert.equal(r.release_qualified,false);assert.equal(r.historical_approval_transferred,false);
});
test('candidate transition rejects each altered or partial input',async()=>{
 for(const pin of CANDIDATE_TRANSITION.pins){
  await assert.rejects(validateCandidateTransition(root,async(r,p)=>{
    const b=await readFile(path.join(r,p));return p===pin.path?Buffer.concat([b,Buffer.from('\n')]):b;
  }),/CANDIDATE_PIN_MISMATCH/);
 }
 await assert.rejects(validateCandidateTransition(root,async(r,p)=>p==='package.json'?readFile(path.join(root,'verification/source-selection-candidate/fixtures/pr003-package.json')):readFile(path.join(r,p))),/CANDIDATE_PIN_MISMATCH/);
});
