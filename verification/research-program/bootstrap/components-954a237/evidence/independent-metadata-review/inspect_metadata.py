import datetime
import gzip
import hashlib
import json
import pathlib
import subprocess
from functools import lru_cache

REPO = pathlib.Path('/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr006-pr008-combined-20260911')
OUT = pathlib.Path('/mnt/d/tmp/plumbob/ushso-epic-execution-20260912/independent-metadata-review')
PRIOR = '2909aa8b7b6bae674cc257968c8d3f58c30717c5'
PRODUCER = '09e312c9fb8767656ba6f6dcb0f996510098842d'
COMBINED = 'db71bfb1cee4557d4eb7640f78c97fd60da5e119'
BEFORE = 'abf4110826389a1f01c374a983f397878ee4d952'
INTEGRATION = '7c7ad7f9577507fc294438025ec8c60145e8cb33'
COMPOSE_PARENT = 'f84ab7bb70d07dbcbfa365f53cdc5c89a0d4000e'
HANDOFF = 'docs/research-program/handoffs/PR-008.json'
LEDGER = 'docs/research-program/execution-ledger.json'
CAPSULE = 'verification/research-program/pr-008/astra-correction-20260912'
BOOTSTRAP = 'verification/research-program/bootstrap/astra-takeover-20260912'

def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args], stderr=subprocess.PIPE)

@lru_cache(maxsize=None)
def blob(ref, path):
    return git('show', f'{ref}:{path}')

def obj(ref, path):
    return json.loads(blob(ref, path))

def digest(data):
    return hashlib.sha256(data).hexdigest()

checks = []
def check(name, condition, detail):
    checks.append({'name': name, 'passed': bool(condition), 'detail': detail})

def same_fields(a, b, keys):
    return {k: a.get(k) == b.get(k) for k in keys}

def walk_artifacts(value, route='$'):
    if isinstance(value, dict):
        if 'path' in value and 'sha256' in value:
            yield route, value
        for key, child in value.items():
            yield from walk_artifacts(child, route + '.' + key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk_artifacts(child, route + f'[{index}]')

prior, producer, combined, compose_parent = [obj(r, HANDOFF) for r in [PRIOR, PRODUCER, COMBINED, COMPOSE_PARENT]]
identities = ['pr_id', 'status', 'owner', 'base_sha', 'head_sha', 'dependency_merge_shas', 'branch']
stable = same_fields(prior, producer, identities)
check('producer_identity_fields_unchanged', all(stable.values()), stable)
check('combined_identity_matches_producer', all(same_fields(producer, combined, identities).values()), same_fields(producer, combined, identities))

producer_diff = git('diff', '--name-only', PRIOR, PRODUCER).decode().splitlines()
check('producer_scope_metadata_only', all(p == HANDOFF or p.startswith(CAPSULE + '/') for p in producer_diff), producer_diff)
binding_paths = [p for p in git('ls-tree', '-r', '--name-only', PRODUCER).decode().splitlines() if p.endswith('task-binding.json') and 'pr-008' in p]
check('producer_task_binding_unchanged', bool(binding_paths) and all(blob(PRIOR,p) == blob(PRODUCER,p) == blob(COMBINED,p) for p in binding_paths), binding_paths)

for key in ['commits', 'commands', 'acceptance_results', 'failures_and_skipped_checks', 'source_identities']:
    missing = [x.get('id', x) for x in prior[key] if x not in producer[key]]
    check('producer_preserves_' + key, not missing, {'prior_count':len(prior[key]),'current_count':len(producer[key]),'missing':missing})
check('producer_prior_handoff_preserved_byte_exact', gzip.decompress(blob(PRODUCER,CAPSULE + '/prior-handoff.json.gz')) == blob(PRIOR,HANDOFF), {'parent':PRIOR,'path':CAPSULE+'/prior-handoff.json.gz'})
for key in ['commits', 'commands', 'acceptance_results', 'failures_and_skipped_checks', 'changed_files']:
    check('combined_preserves_producer_' + key, producer[key] == combined[key], {'producer_count':len(producer[key]),'combined_count':len(combined[key])})
check('combined_assignment_source_locators_preserved', combined['source_identities'] == compose_parent['source_identities'], combined['source_identities'][4:6])
source_original = next(x for x in combined['source_identities'] if x['kind'] == 'local-PR-008.md')
source_amended = next(x for x in combined['source_identities'] if x['kind'] == 'local-pr008-package-completion-amended-assignment')
check('original_assignment_is_original_dispatch_bytes', blob(COMBINED,source_original['id']) == blob('a00630c712e3a4e64354a77d268cb168fa3f528a','docs/master-plan/2026-09-10/prs/PR-008.md'), source_original)
check('amended_assignment_is_controller_amendment_bytes', blob(COMBINED,source_amended['id']) == blob('fdeed22bc052dbc88544001a2270fe79df32ddc9','docs/master-plan/2026-09-10/prs/PR-008.md'), source_amended)

for ref, handoff, name in [(PRODUCER, producer, 'producer'), (COMBINED, combined, 'combined')]:
    mismatches = []
    count = 0
    for route, record in walk_artifacts(handoff):
        count += 1
        try:
            raw = blob(ref, record['path'])
            if record['sha256'] != digest(raw) or ('bytes' in record and record['bytes'] != len(raw)):
                mismatches.append({'route':route,'record':record,'observed_bytes':len(raw),'observed_sha256':digest(raw)})
        except subprocess.CalledProcessError as e:
            mismatches.append({'route':route,'record':record,'error':e.stderr.decode()})
    check(name + '_all_declared_artifact_hashes', not mismatches, {'count':count,'mismatches':mismatches})
    mismatches = []
    count = 0
    for record in handoff['source_identities']:
        if record.get('location') != 'local':
            continue
        count += 1
        raw = blob(ref, record['id'])
        if record.get('sha256') != digest(raw):
            mismatches.append({'record':record,'observed_sha256':digest(raw)})
    check(name + '_all_local_source_hashes', not mismatches, {'count':count,'mismatches':mismatches})

finalization = obj(PRODUCER,CAPSULE+'/finalization.json')
source_checks = {}
for path, record in finalization['source_files'].items():
    raw = blob(PRIOR,path)
    source_checks[path] = {
        'matches_before_producer_metadata_and_combined': raw == blob(PRODUCER,path) == blob(BEFORE,path) == blob(COMBINED,path),
        'receipt_hash_matches': digest(raw) == record['sha256'] and len(raw) == record['bytes'],
        'sha256':digest(raw), 'bytes':len(raw)
    }
check('source_correspondence', all(x['matches_before_producer_metadata_and_combined'] and x['receipt_hash_matches'] for x in source_checks.values()), source_checks)
check('producer_code_tree_identity', git('rev-parse', PRIOR+'^{tree}').decode().strip() == finalization['producer_code_tree'], finalization['producer_code_tree'])
source_review_root = pathlib.Path('/mnt/d/tmp/plumbob/ushso-astra-correction-followup-20260912')
source_review_record = json.loads((source_review_root/'review.json').read_bytes())
source_review_hashes = finalization['independent_source_review']
check('independent_source_review_report_and_receipt_match', digest((source_review_root/'ASTRA-REVIEW.md').read_bytes()) == source_review_hashes['source_report_sha256'] and digest((source_review_root/'review.json').read_bytes()) == source_review_hashes['source_receipt_sha256'] and digest((source_review_root/'correction.patch').read_bytes()) == source_review_hashes['reviewed_patch_sha256'], source_review_hashes)
check('source_commit_matches_reviewed_producer_bytes', source_review_record['producers']['PR-008']['files'] == finalization['source_files'], finalization['source_files'])
source_manifest = json.loads((source_review_root/'artifact-manifest.json').read_bytes())
source_mismatches = []
for record in source_manifest['files']:
    raw = (source_review_root/record['path']).read_bytes()
    if digest(raw) != record['sha256'] or len(raw) != record['bytes']:
        source_mismatches.append(record['path'])
check('original_correction_review_manifest_preserved', not source_mismatches, {'count':len(source_manifest['files']),'mismatches':source_mismatches})
check('producer_new_acceptance_stays_pending', finalization['accepted'] is False and finalization['integrated'] is False and finalization['published'] is False and finalization['old_gate_applicable'] is False and finalization['requirements_accepted'] == [] and producer['independent_review']['status'] == 'in_review', finalization)

command_receipt = obj(PRODUCER,CAPSULE+'/cms-extractors-identity.json')
stdout = gzip.decompress(blob(PRODUCER,CAPSULE+'/cms-extractors-identity.stdout.log.gz'))
stderr = gzip.decompress(blob(PRODUCER,CAPSULE+'/cms-extractors-identity.stderr.log.gz'))
check('new_command_receipt_matches_finalization', command_receipt == finalization['checks'][0], {'candidate_head':command_receipt['candidate_head'],'exit_code':command_receipt['exit_code']})
check('new_command_log_hashes_match', all(command_receipt[k]['sha256']==digest(raw) and command_receipt[k]['bytes']==len(raw) for k,raw in [('stdout',stdout),('stderr',stderr)]), {'stdout_tail':stdout.decode().splitlines()[-10:],'stderr':stderr.decode()})
check('new_command_has_40_pass_zero_fail_observation', ('ℹ tests 40' in stdout.decode() and 'ℹ pass 40' in stdout.decode() and 'ℹ fail 0' in stdout.decode()), stdout.decode().splitlines()[-10:])
initial_validation = json.loads(gzip.decompress(blob(PRODUCER,CAPSULE+'/initial-handoff-validation.json.gz')))
check('initial_validation_failure_retained_and_recorded', initial_validation.get('ok') is False and initial_validation.get('outcome') == 'rejected' and {x['rule'] for x in initial_validation['findings']} == {'schema_invalid','command_timestamp_invalid'} and any(x['id']=='pr008-finalization-initial-timestamp-format' and x['status']=='failed' for x in producer['failures_and_skipped_checks']), initial_validation)

new_commands = [x for x in producer['commands'] if x not in prior['commands']]
check('new_handoff_command_only_normalizes_timestamp_spelling', len(new_commands)==1 and all(new_commands[0][k] == command_receipt[k].replace('+00:00','Z') for k in ['started_at','completed_at']) and new_commands[0]['exit_code'] == command_receipt['exit_code'] and new_commands[0]['command'] == ' '.join(command_receipt['command']), new_commands)

resolution = obj(COMBINED,BOOTSTRAP+'/merge-resolution.json')
for parent in resolution['parents']:
    raw = blob(COMBINED,parent['path']); decoded = gzip.decompress(raw)
    check('ledger_parent_preserved_'+parent['head'][:7], digest(raw)==parent['sha256'] and digest(decoded)==parent['uncompressed_sha256'] and decoded==blob(parent['head'],LEDGER), parent)
composition = obj(COMBINED,BOOTSTRAP+'/pr008-handoff-composition/composition.json')
snapshot_refs = [PRIOR, COMPOSE_PARENT, PRODUCER]
for ref, snapshot in zip(snapshot_refs,composition['parent_snapshots']):
    raw = blob(COMBINED,snapshot['path']); decoded = gzip.decompress(raw)
    check('handoff_parent_preserved_'+ref[:7], digest(raw)==snapshot['sha256'] and digest(decoded)==snapshot['decoded_sha256'] and decoded==blob(ref,HANDOFF), snapshot)

left, right, merged = [obj(r,LEDGER) for r in [BEFORE,INTEGRATION,COMBINED]]
check('requirements_unchanged_from_both_parents', left['requirements'] == right['requirements'] == merged['requirements'], {'count':len(merged['requirements'])})
maps = [{x['pr_id']:x for x in v['tasks']} for v in [left,right,merged]]
check('all_task_ids_preserved', set(maps[0])==set(maps[1])==set(maps[2]), {'count':len(maps[2])})
fixed_task_fields = ['owner','base_sha','base_tree','dependency_merge_shas','merge_sha','integration_merge_sha','previous_accepted_implementation','task_id','branch','worktree','owned_paths']
critical_changes = []
for pr_id,new in maps[2].items():
    for field in fixed_task_fields:
        if pr_id == 'PR-086':
            unchanged = maps[0][pr_id].get(field) == new.get(field)
        else:
            unchanged = maps[0][pr_id].get(field) == maps[1][pr_id].get(field) == new.get(field)
        if not unchanged:
            critical_changes.append({'pr_id':pr_id,'field':field,'left':maps[0][pr_id].get(field),'right':maps[1][pr_id].get(field),'merged':new.get(field)})
check('accepted_and_assignment_critical_task_fields_unchanged', not critical_changes, critical_changes)
unrelated_task_changes = {pr_id:{'left_equal':maps[0][pr_id]==new,'right_equal':maps[1][pr_id]==new} for pr_id,new in maps[2].items() if pr_id not in ['PR-006','PR-008','PR-086'] and not maps[0][pr_id]==new==maps[1][pr_id]}
check('unrelated_tasks_match_one_parent_exactly', all(x['left_equal'] or x['right_equal'] for x in unrelated_task_changes.values()), unrelated_task_changes)
task86 = maps[2]['PR-086']
unchanged86 = {k:v for k,v in task86.items() if k != 'current_input_correction'} == {k:v for k,v in maps[0]['PR-086'].items() if k != 'current_input_correction'}
correction86 = task86['current_input_correction']
inherited86 = {k: v == maps[0]['PR-086']['current_input_correction'].get(k) or v == maps[1]['PR-086']['current_input_correction'].get(k) for k,v in correction86.items()}
check('PR086_continuation_only_inherits_parent_review_metadata', unchanged86 and all(inherited86.values()), {'other_fields_unchanged_from_combined_parent':unchanged86,'each_correction_field_matches_parent':inherited86})
previous86 = obj(COMBINED,task86['previous_accepted_implementation']['ledger_record'])
accepted86fields = ['status','head_sha','base_sha','merge_sha','integration_merge_sha','dependency_merge_shas','integration_dependency_merge_shas','controller_handoff','artifact_manifest','independent_acceptance','integration_evidence']
accepted86equal = same_fields(previous86,maps[1]['PR-086'],accepted86fields)
check('PR086_original_accepted_identity_preserved', all(accepted86equal.values()) and previous86['status']=='integrated' and task86['merge_sha'] is None, {'original_acceptance_fields_match_integration_parent':accepted86equal,'prior_ledger_path':task86['previous_accepted_implementation']['ledger_record']})
accepted = [pr_id for pr_id,t in maps[2].items() if t.get('merge_sha') or t.get('integration_merge_sha')]
check('accepted_task_records_unchanged', all(maps[0][p] == maps[1][p] == maps[2][p] for p in accepted), accepted)
for pr_id in ['PR-006','PR-008']:
    t=maps[2][pr_id]
    check(pr_id+'_current_acceptance_pending', t['status']=='independent_review' and t['merge_sha'] is None and t['reviewed_tree'] is None, {'status':t['status'],'merge_sha':t['merge_sha'],'reviewed_tree':t['reviewed_tree'],'blockers':t['blockers']})
candidate=merged['controller']['next_component_candidate']
check('current_combined_candidate_gate_review_pending', candidate['full_gate_pending'] and candidate['combined_hosted_ci_pending'] and candidate['peer_metadata_review_pending'] and not candidate['accepted'] and not candidate['root_code_integrated'] and candidate['old_e3af8dd_gate_applies_to_corrected_bytes'] is False, candidate)

combined_changes=git('diff','--name-only',BEFORE,COMBINED).decode().splitlines()
novel=[]
for path in combined_changes:
    if path in [LEDGER,HANDOFF] or path.startswith(BOOTSTRAP+'/'):
        continue
    inherited=False
    for ref in [INTEGRATION,PRODUCER]:
        try:
            inherited = inherited or blob(ref,path) == blob(COMBINED,path)
        except subprocess.CalledProcessError:
            pass
    if not inherited:
        novel.append(path)
check('combined_only_reviewed_metadata_plus_byte_exact_parent_files', not novel, {'total_changed_paths':len(combined_changes),'non_inherited_files':novel})

report={
    'format':'ushso.independent-metadata-review.v1',
    'reviewer':'/root/review_correction_metadata',
    'recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'producer_before':PRIOR, 'producer_head':PRODUCER,
    'combined_before':BEFORE, 'combined_head':COMBINED,
    'combined_tree':git('rev-parse',COMBINED+'^{tree}').decode().strip(),
    'checks':checks,
    'passed':sum(x['passed'] for x in checks),
    'failed':sum(not x['passed'] for x in checks),
    'limits':['Git-object metadata review only; full gate, hosted CI, product scientific acceptance and integration are outside this receipt.','Producer status and combined working trees may advance; only the named immutable commits were inspected.']
}
(OUT/'object-integrity-review.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':report['passed'],'failed':report['failed'],'failures':[x for x in checks if not x['passed']],'path':str(OUT/'object-integrity-review.json')},indent=2))
