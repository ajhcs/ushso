import {describe,it,expect} from 'vitest'
import {isReviewPage,reviewFailureCode} from './ScientificConflictsPanel'
const fixture=()=>({schema:'ushso.scientific-conflicts-response.v1',result:{review_status:'pending_owner_review',record_id:'record',generation:'generation',manifest_sha256:'a'.repeat(64),owner_decision:null,publication_authorized:false,canonical_records_changed:0,row_count:1,page:0,page_count:1,next_page:null,rows:[{preview_id:'row',record_id:'record',card_id:'SCI-06',field_name:null,display_label:'Literal publisher term',state:'candidate_only',scope_warning:'Unresolved',proposed_text:'No scientific resolution proposed.',review_status:'pending_owner_review',owner_decision:null,publication_authorized:false,eligible_for_schema_promotion:false,payload:{literal:'<script>untrusted text</script>'}}]}})
const valid=(x:unknown)=>isReviewPage(x,'record','generation',0,null,true)
describe('conflict response runtime guard',()=>{
 it('accepts bounded literal review data without treating text as markup',()=>expect(valid(fixture())).toBe(true))
 it('rejects malformed rendered strings and review state',()=>{for(const k of ['state','scope_warning','proposed_text','display_label','review_status']){const x=fixture();Object.assign(x.result.rows[0],{[k]:{not:'text'}});expect(valid(x)).toBe(false)}})
 it('rejects duplicate row IDs',()=>{const x=fixture();x.result.row_count=2;x.result.rows.push({...x.result.rows[0]});expect(valid(x)).toBe(false)})
 it('rejects invalid row/page bounds',()=>{for(const [k,v]of [['row_count',-1],['page_count',101],['page',1],['next_page',1]]){const x=fixture();Object.assign(x.result,{[k]:v});expect(valid(x)).toBe(false)}})
 it('rejects stale identity and continuation manifest',()=>{const x=fixture();x.result.generation='stale';expect(valid(x)).toBe(false);expect(isReviewPage(fixture(),'record','generation',0,'b'.repeat(64),true)).toBe(false)})
 it('rejects non-success HTTP even when the body has a valid success shape',()=>expect(isReviewPage(fixture(),'record','generation',0,null,false)).toBe(false))
 it('rejects top-level review status and preserves only bounded typed HTTP errors',()=>{const x=fixture();x.result.review_status='approved';expect(valid(x)).toBe(false);expect(reviewFailureCode({error:{code:'scientific_conflicts_restart_required'}})).toBe('scientific_conflicts_restart_required');expect(reviewFailureCode({error:{code:'<script>unsafe</script>'}})).toBe('review_unavailable');expect(reviewFailureCode({error:{code:'a'.repeat(101)}})).toBe('review_unavailable')})
 it('rejects approval changes and arbitrary objects',()=>{const x=fixture();x.result.publication_authorized=true;expect(valid(x)).toBe(false);expect(valid({})).toBe(false);expect(valid(null)).toBe(false)})
})
