import datetime
import gzip
import hashlib
import json
import pathlib
import subprocess
from functools import lru_cache

REPO = pathlib.Path('/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr006-pr008-combined-20260911')
OUT = pathlib.Path('/mnt/d/tmp/plumbob/ushso-epic-execution-20260912/independent-metadata-review')
PRIOR = 'db71bfb1cee4557d4eb7640f78c97fd60da5e119'
FINAL = '954a237a8984d06f5ea0ab15f83c71ce210bf09a'
PR006 = 'a153a3d5e734fee17d9016b8d36b0f94006f24fe'
PR006_SOURCE = '073a09da002df395e30c7394e256525035f1db61'
PR008 = '09e312c9fb8767656ba6f6dcb0f996510098842d'
CAPSULE = 'verification/research-program/bootstrap/astra-takeover-20260912/final-composition'
LEDGER = 'docs/research-program/execution-ledger.json'
SOURCE_REVIEW = pathlib.Path('/mnt/d/tmp/plumbob/ushso-astra-correction-followup-20260912')

def git(*args):
    return subprocess.check_output(['git','-C',str(REPO),*args],stderr=subprocess.PIPE)

@lru_cache(maxsize=None)
def blob(ref,path):
    return git('show',f'{ref}:{path}')

def obj(ref,path):
    return json.loads(blob(ref,path))

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

checks=[]
def check(name,condition,detail):
    checks.append({'name':name,'passed':bool(condition),'detail':detail})

def walk_artifacts(value,route='$'):
    if isinstance(value,dict):
        if 'path' in value and 'sha256' in value:
            yield route,value
        for key,child in value.items():
            yield from walk_artifacts(child,route+'.'+key)
    elif isinstance(value,list):
        for index,child in enumerate(value):
            yield from walk_artifacts(child,route+f'[{index}]')

initial=json.loads((OUT/'object-integrity-review.json').read_bytes())
check('prior_independent_metadata_object_review_passed',initial['failed']==0,{'passed':initial['passed'],'path':'object-integrity-review.json','sha256':digest((OUT/'object-integrity-review.json').read_bytes())})
tree=git('rev-parse',FINAL+'^{tree}').decode().strip()
parents=git('show','-s','--format=%P',FINAL).decode().strip().split()
check('final_tree_and_parents_bound',tree=='a781e9801224af92b51389fb898f0b67ab261982' and parents==[PRIOR,PR006],{'head':FINAL,'tree':tree,'parents':parents})
composition=obj(FINAL,CAPSULE+'/composition.json')
check('composition_parent_identities_match_git',composition['parents']=={'combined':PRIOR,'pr006_finalized':PR006} and composition['pr008_finalized']==PR008,composition['parents'])

source_checks={}
for path,record in composition['source_equivalence'].items():
    raw=blob(FINAL,path)
    snapshot=gzip.decompress(blob(FINAL,CAPSULE+'/prior-correction-followup/reviewed-bytes/'+path+'.gz'))
    source_ref=PR006_SOURCE if path.startswith('apps/') else PR008
    source_checks[path]={'unchanged_from_prior':raw==blob(PRIOR,path),'matches_producer':raw==blob(source_ref,path),'matches_retained_reviewed_bytes':raw==snapshot,'matches_manifest':digest(raw)==record['sha256'] and len(raw)==record['bytes'],'bytes':len(raw),'sha256':digest(raw)}
check('all_four_corrected_source_files_match_reviewed_bytes',len(source_checks)==4 and all(all(v[k] for k in ['unchanged_from_prior','matches_producer','matches_retained_reviewed_bytes','matches_manifest']) for v in source_checks.values()),source_checks)

historical=composition['historical_followup_artifacts']
archive_errors=[]
archived={}
for record in historical:
    raw=blob(FINAL,record['path']); decoded=gzip.decompress(raw)
    archived[record['original_relative_path']]=decoded
    if digest(raw)!=record['sha256'] or digest(decoded)!=record['decoded_sha256'] or len(decoded)!=record['decoded_bytes'] or decoded!=(SOURCE_REVIEW/record['original_relative_path']).read_bytes():
        archive_errors.append(record['path'])
check('all_historical_followup_files_byte_exact',not archive_errors,{'archived_files':len(historical),'errors':archive_errors})
manifest=json.loads(archived['artifact-manifest.json'])
manifest_errors=[]
for record in manifest['files']:
    raw=archived.get(record['path'])
    if raw is None or digest(raw)!=record['sha256'] or len(raw)!=record['bytes']:
        manifest_errors.append(record['path'])
check('archived_original_manifest_and_all_45_entries_match',len(manifest['files'])==45 and not manifest_errors,{'manifest_entries':len(manifest['files']),'errors':manifest_errors})
review=json.loads(archived['review.json'])
check('historical_review_failure_not_relabelled',review['reviewer_fixture_correction']['initial_exit_code']==1 and review['reviewer_fixture_correction']['rerun_exit_code']==0 and archived['web-extra.test.ts']!=archived['web-extra.test.ts.initial-fixture'],review['reviewer_fixture_correction'])
check('reviewed_patch_identity_preserved',digest(archived['correction.patch'])==composition['reviewed_patch_sha256']==review['candidate']['patch_sha256'],composition['reviewed_patch_sha256'])

previous_ledger=gzip.decompress(blob(FINAL,CAPSULE+'/prior-ledger.json.gz'))
check('final_composition_prior_ledger_byte_exact',previous_ledger==blob(PRIOR,LEDGER),{'sha256':digest(previous_ledger),'parent':PRIOR,'path':CAPSULE+'/prior-ledger.json.gz'})
left,right=obj(PRIOR,LEDGER),obj(FINAL,LEDGER)
check('requirements_plan_publication_external_inputs_unchanged',all(left.get(k)==right.get(k) for k in left if k not in ['updated_at','controller','tasks']),[k for k in left if k not in ['updated_at','controller','tasks']])
lm,rm=({x['pr_id']:x for x in o['tasks']} for o in [left,right])
check('all_84_other_task_records_unchanged',len(lm)==len(rm)==86 and all(lm[k]==rm[k] for k in lm if k not in ['PR-006','PR-008']),{'tasks':len(rm),'unchanged_other_tasks':84})
critical=['status','owner','dependencies','dependency_merge_shas','merge_sha','base_sha','base_tree','task_id','branch','worktree','owned_paths','reviewed_tree','dispatch_packet','dispatch_packet_sha256','github_pr_url']
for pr,producer in [('PR-006',PR006),('PR-008',PR008)]:
    preserved={k:lm[pr].get(k)==rm[pr].get(k) for k in critical}
    check(pr+'_task_binding_and_acceptance_unchanged',all(preserved.values()),preserved)
    check(pr+'_final_producer_head_correct',rm[pr]['head_sha']==producer and rm[pr]['producer_state']=='corrected_source_and_producer_metadata_committed',{'head_sha':rm[pr]['head_sha'],'producer_state':rm[pr]['producer_state']})
    history=rm[pr]['prior_correction_states']
    check(pr+'_historical_joint_gate_retained_current_gate_pending',rm[pr]['latest_joint_candidate'] is None and rm[pr]['latest_joint_gate'] is None and any(x.get('latest_joint_candidate')==lm[pr]['latest_joint_candidate'] and x.get('latest_joint_gate')==lm[pr]['latest_joint_gate'] for x in history),{'current_candidate':rm[pr]['latest_joint_candidate'],'current_gate':rm[pr]['latest_joint_gate'],'prior_states':len(history)})
    binding='verification/research-program/'+pr.lower()+'/task-binding.json'
    check(pr+'_task_binding_file_unchanged',blob(PRIOR,binding)==blob(FINAL,binding)==blob(producer,binding),{'path':binding,'sha256':digest(blob(FINAL,binding))})
candidate=right['controller']['next_component_candidate']
check('final_combined_gate_and_acceptance_stay_pending',candidate['head'] is None and candidate['full_gate_pending'] and candidate['combined_hosted_ci_pending'] and candidate['peer_metadata_review_pending'] and candidate['accepted'] is False and candidate['root_code_integrated'] is False and candidate['old_e3af8dd_gate_applies_to_corrected_bytes'] is False,candidate)
check('previous_controller_candidate_and_execution_preserved',left['controller']['next_component_candidate'] in right['controller']['component_candidate_history'] and all(x in right['controller']['correction_execution_history'] for x in left['controller']['current_active_corrections']),{'candidate_history_count':len(right['controller']['component_candidate_history']),'correction_history_count':len(right['controller']['correction_execution_history'])})

handoff6='docs/research-program/handoffs/PR-006.json'
h6_before,h6,h6_producer=[obj(r,handoff6) for r in [PR006_SOURCE,FINAL,PR006]]
check('PR006_composed_handoff_matches_Grok_commit',blob(FINAL,handoff6)==blob(PR006,handoff6),digest(blob(FINAL,handoff6)))
check('PR006_original_handoff_preserved_byte_exact',blob(FINAL,'verification/research-program/pr-006/finalization-receipts/prior-handoff.json')==blob(PR006_SOURCE,handoff6),{'parent':PR006_SOURCE})
id_fields=['pr_id','status','owner','base_sha','head_sha','dependency_merge_shas','branch']
check('PR006_original_producer_identity_unchanged',all(h6_before[k]==h6[k] for k in id_fields),{k:h6[k] for k in id_fields})
for key in ['commands','commits','artifacts']:
    check('PR006_historical_'+key+'_preserved',all(x in h6[key] for x in h6_before[key]),{'before':len(h6_before[key]),'after':len(h6[key])})
check('PR008_composed_handoff_unchanged_since_prior_review',blob(PRIOR,'docs/research-program/handoffs/PR-008.json')==blob(FINAL,'docs/research-program/handoffs/PR-008.json'),{'initial_review_head':PRIOR})

for pr in ['PR-006','PR-008','PR-086']:
    h=obj(FINAL,'docs/research-program/handoffs/'+pr+'.json')
    artifacts=list(walk_artifacts(h)); errors=[]
    for route,record in artifacts:
        raw=blob(FINAL,record['path'])
        if digest(raw)!=record['sha256'] or ('bytes' in record and len(raw)!=record['bytes']):
            errors.append(route)
    check(pr+'_final_artifact_references_match_Git_objects',not errors,{'references':len(artifacts),'errors':errors})
    source_count=0; errors=[]
    for source in h['source_identities']:
        if source.get('location')=='local':
            raw=blob(FINAL,source['id'])
        elif source.get('git_commit') and source.get('git_path'):
            raw=blob(source['git_commit'],source['git_path'])
        else:
            continue
        source_count+=1
        if digest(raw)!=source['sha256']:
            errors.append(source['id'])
    check(pr+'_final_local_and_git_source_references_match',not errors,{'references':source_count,'errors':errors})
    label='final-'+pr.lower()+'-handoff'+('' if pr=='PR-008' else '-process-access')
    receipt=json.loads((OUT/(label+'.json')).read_bytes())
    check(pr+'_final_handoff_validator_passed',receipt['head_before']==receipt['head_after']==FINAL and receipt['exit_code']==0 and receipt['ok'] and not receipt['findings'],{'path':label+'.json','exit_code':receipt['exit_code'],'source_sha256':digest((OUT/(label+'.json')).read_bytes())})

changes=git('diff','--name-only',PRIOR,FINAL).decode().splitlines()
unexpected=[]
for path in changes:
    if path==LEDGER or path.startswith(CAPSULE+'/'):
        continue
    try:
        if blob(FINAL,path)!=blob(PR006,path):
            unexpected.append(path)
    except subprocess.CalledProcessError:
        unexpected.append(path)
check('final_delta_only_Grok_metadata_and_controller_capsule',not unexpected,{'changed_paths':len(changes),'unexpected':unexpected})
check('final_record_authorship_and_pending_scope_honest',composition['authorship']=={'pr008_metadata_and_controller_composition':'Astra','pr006_metadata':'Grok','separate_metadata_review':'pending'} and composition['full_gate']=='pending' and composition['hosted_ci']=='pending' and composition['accepted'] is False and composition['published'] is False and composition['old_e3af8dd_gate_applies'] is False and composition['requirements_accepted']==[] and composition['production_changed'] is False,{'authorship':composition['authorship'],'full_gate':composition['full_gate'],'hosted_ci':composition['hosted_ci'],'accepted':composition['accepted'],'published':composition['published']})

report={'format':'ushso.independent-final-metadata-review.v1','reviewer':'/root/review_correction_metadata','recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'reviewed_head':FINAL,'reviewed_tree':tree,'initial_reviewed_scope':initial['combined_before']+'..'+PRIOR,'final_delta_scope':PRIOR+'..'+FINAL,'checks':checks,'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'verdict':'no_actionable_metadata_findings' if all(c['passed'] for c in checks) else 'checks_require_review','findings':[],'limits':['Independent metadata/identity review; no full product suite, build, full release gate, hosted CI, live source request or production check was run by this reviewer.','Acceptance, publication, integration, R01-R16 and release qualification remain outside this verdict.','Initial reviewer harness assumptions and PR006/086 sandbox process-access failures are retained and explained alongside successful exact replays.']}
(OUT/'final-metadata-review.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':report['passed'],'failed':report['failed'],'failures':[c for c in checks if not c['passed']],'verdict':report['verdict'],'path':str(OUT/'final-metadata-review.json')},indent=2))
