import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeTasks,serviceContribution,validateCoverage} from '../../scripts/source-selection-evaluation/acceptance.mjs';
test('abandonment and technical failure remain in task denominator',()=>{
 const base={consented:true,eligible:true,attempted:true};
 const result=summarizeTasks([{...base,session_id:'1',completed:true,rubric_pass:true},{...base,session_id:'2',abandoned:true},{...base,session_id:'3',technical_failure:true}]);
 assert.equal(result.attempted,3);assert.equal(result.successful,1);assert.equal(result.success_rate,1/3);assert.equal(result.missing_rubric,2);
 assert.equal(summarizeTasks([]).status,'not_run');
});
test('critical mistake defeats rubric pass; exclusions require reasons',()=>{
 assert.equal(summarizeTasks([{session_id:'1',consented:true,eligible:true,attempted:true,completed:true,rubric_pass:true,critical_false_assertion:true}]).successful,0);
 assert.throws(()=>summarizeTasks([{session_id:'2',consented:true,eligible:true,attempted:true,excluded:true}]),/EXCLUSION_REASON/);
});
test('synthetic revenue cannot become paid adoption and full labor is valued',()=>{
 const result=serviceContribution({evidence_kind:'synthetic',revenue:1000,refunds:0,nonlabor_cost:25,producer_hours:6,reviewer_hours:3,admin_support_hours:1,hourly_valuation:75});
 assert.equal(result.loaded_cost,775);assert.equal(result.contribution,225);assert.equal(result.counts_as_paid_adoption,false);
});
test('all 80 original obligations are retained; missing IDs and unsupported completion fail',()=>{
 const ledger=JSON.parse(readFileSync(new URL('../../docs/source-selection/execution-coverage.json',import.meta.url)));
 assert.equal(validateCoverage(ledger).scope_count,80);
 assert.throws(()=>validateCoverage({...ledger,changes:ledger.changes.slice(1)}),/ORIGINAL_SCOPE/);
 const forged=structuredClone(ledger);forged.changes[0].implementation_result='locally_verified';forged.changes[0].artifacts=[];
 assert.throws(()=>validateCoverage(forged),/COMPLETION_EVIDENCE/);
});
