import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildTechnicalEvidence,validateCandidateEvidence,verifyBehavior} from '../tools/technical-evidence.mjs';
const repoRoot=process.env.WP11_TEST_REPO??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const evidence=await buildTechnicalEvidence({repoRoot});
test('candidate technical evidence passes while approval and release remain unclaimed',async()=>{
 assert.equal(evidence.technical_foundation_status,'pass');
 assert.equal(evidence.approval_status,'pending_authorized_review');
 assert.equal(evidence.approved,false);
 assert.equal(evidence.publication_authorized,false);
 assert.equal(evidence.deployment_authorized,false);
 assert.equal(evidence.work_package_acceptance_status,'blocked_external_dependencies_and_human_studies');
 assert.equal(evidence.previous_successor_receipt.package_id,'@ushso/wp11-verification-v1.1.0@1.1.0');
 assert.equal((await validateCandidateEvidence(evidence,{repoRoot})).status,'technical_evidence_valid');
});
test('stale file hash or missing dependency cannot validate',async()=>{
 const changed=structuredClone(evidence);changed.files[0].sha256='0'.repeat(64);
 await assert.rejects(validateCandidateEvidence(changed,{repoRoot}),/WP11_CANDIDATE_EVIDENCE_STALE/);
 const omitted=structuredClone(evidence);omitted.files.pop();
 await assert.rejects(validateCandidateEvidence(omitted,{repoRoot}),/WP11_CANDIDATE_EVIDENCE_STALE/);
});
test('technical evidence cannot smuggle approval',async()=>{
 const forged={...evidence,approved:true};
 await assert.rejects(validateCandidateEvidence(forged,{repoRoot}),/TECHNICAL_EVIDENCE_APPROVAL_OVERCLAIM/);
});
test('behavioral probes fail a permissive URL implementation',async()=>{
 const policy=await import(pathToFileURL(path.join(repoRoot,'packages/retrieval/tools/external-url-policy.mjs')));
 const contract=await import(pathToFileURL(path.join(repoRoot,'packages/retrieval/tools/catalog-contract.mjs')));
 const valid=JSON.parse((await fs.readFile(path.join(repoRoot,'packages/retrieval/corpus/records.jsonl'),'utf8')).trim().split(/\r?\n/)[0]);
 await assert.rejects(verifyBehavior({...policy,safeExternalHttpsUrl:value=>value},contract,valid),/UNSAFE_URL_ACCEPTED/);
 await assert.rejects(verifyBehavior(policy,{...contract,validateCatalogRecords:records=>({valid:records,invalid:[]})},valid),/MALFORMED_PEER_NOT_ISOLATED/);
});
