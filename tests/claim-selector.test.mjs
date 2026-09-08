import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,claimHash,selectClaims} from '../scripts/research/claim-selector.mjs';
const record={record_id:'r',evidence:[]};
function fixture(){const c={claim_id:'SCI-04:r:note',record_id:'r',generation:'g',baseline_record_sha256:digest(record),field_path:'/evidence/-',proposed_value:{text:'aggregate note'},sources:[{source_sha256:'source',passage_locator:'page 16'}],promotion_policy:'owner_scoped_note_only',owner_decision:null};c.proposal_sha256=claimHash(c);return c;}
function run(c,decisions=[],extra={}){return selectClaims({claims:[c],decisions,records:new Map([['r',record]]),generation:'g',sourceHashes:new Set(['source']),...extra});}
const approval=c=>({claim_id:c.claim_id,decision:'approved',proposal_sha256:c.proposal_sha256});
test('pending draft cannot promote and record remains unchanged',()=>{assert.equal(run(fixture()).excluded[0].reason,'UNAPPROVED');assert.deepEqual(record.evidence,[]);});
test('explicit authorization is required even for matching approval object',()=>{const c=fixture();assert.equal(run(c,[approval(c)]).excluded[0].reason,'OWNER_AUTHORIZATION_UNVERIFIED');});
test('verified fixture authorizes only its exact claim, not attached unrelated claim',()=>{const c=fixture(), unrelated={...fixture(),claim_id:'SCI-02:other',promotion_policy:'semantic_hold'};unrelated.proposal_sha256=claimHash(unrelated);const r=run(c,[approval(c)],{claims:[c,unrelated],verifyAuthorization:()=>true});assert.equal(r.selected.length,1);assert.equal(r.excluded[0].reason,'SEMANTIC_HOLD');});
test('stale proposed text rejected',()=>{const c=fixture(),d=approval(c);c.proposed_value.text='changed';assert.equal(run(c,[d]).excluded[0].reason,'STALE_PROPOSAL');});
test('wrong generation rejected even with rehashed proposal',()=>{const c=fixture();c.generation='other';c.proposal_sha256=claimHash(c);assert.equal(run(c,[approval(c)]).excluded[0].reason,'WRONG_GENERATION');});
test('changed source and changed baseline rejected',()=>{const c=fixture();assert.equal(run(c,[],{sourceHashes:new Set()}).excluded[0].reason,'SOURCE_BINDING');assert.equal(run(c,[],{records:new Map([['r',{...record,title:'changed'}]])}).excluded[0].reason,'STALE_RECORD');});
test('card-level approval does not approve a named claim',()=>{const c=fixture();assert.equal(run(c,[{claim_id:'SCI-04',decision:'approved'}]).selected.length,0);});
test('stale approval and arbitrary field assignment rejected',()=>{const c=fixture();assert.equal(run(c,[{...approval(c),proposal_sha256:'old'}]).excluded[0].reason,'STALE_APPROVAL');c.field_path='/variable_documentation/variables/0/unit';c.proposal_sha256=claimHash(c);assert.equal(run(c,[approval(c)]).excluded[0].reason,'FIELD_NOT_ALLOWED');});
test('duplicate decision rejected',()=>{const c=fixture(),d=approval(c);assert.throws(()=>run(c,[d,d]),/DUPLICATE_DECISION/);});
test('truthy values and unawaited authorization promises cannot approve',()=>{const c=fixture();for(const value of ['approved',{},Promise.resolve(false)])assert.equal(run(c,[approval(c)],{verifyAuthorization:()=>value}).excluded[0].reason,'OWNER_AUTHORIZATION_UNVERIFIED');});
