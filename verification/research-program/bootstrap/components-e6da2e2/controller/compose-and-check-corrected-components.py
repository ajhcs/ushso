import subprocess,json,hashlib,datetime
from pathlib import Path
R=Path.cwd();S=Path('/mnt/d/tmp/plumbob/ushso-research-program-20260910');task='ushso-pr005-pr086-controller-combined-20260911';O=S/'combined-corrected-preflight'
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *a:subprocess.check_output(['git',*a],text=True).strip()
subprocess.run(['/home/plumbob/.local/bin/worktree-bootstrap','verify',task,'--repo',str(R),'--require-writer'],check=True)
assert git('rev-parse','HEAD')=='17f9271372ecdf29f6b818ad9caaa5332258f4fd' and not git('status','--porcelain')
for p in ['pr086-controller-review/fc246d03/receipt.json','pr007-controller-review/fa624903/receipt.json']:
 r=json.loads((S/p).read_text());assert r['source_clean'] and r['head_unchanged'] and all(c['exit_code']==0 for c in r['commands'])
subprocess.run(['git','merge','--no-ff','--no-edit','-m','Compose independently reviewed PR086 R2 correction','fc246d03463bb85e3892b443120c60b6206aae4a'],check=True,stdout=subprocess.DEVNULL)
head=git('rev-parse','HEAD');tree=git('rev-parse','HEAD^{tree}')
record={'format':'ushso.corrected-component-composition.v1','recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':head,'tree':tree,'repo':str(R),'task':task,'prior_head':'17f9271372ecdf29f6b818ad9caaa5332258f4fd','components':{'PR-005':'afb90565456a429e73527f2bb99daf9cf174aa3c','PR-007':'fa624903123dac858650730ee71bf7f8cb3c34ef','PR-086':'fc246d03463bb85e3892b443120c60b6206aae4a'},'accepted':False}
(S/'combined-corrected-candidate.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
subprocess.run(['/home/plumbob/.nvm/versions/node/v24.14.0/bin/node',str(S/'run-independent-review.mjs'),str(R),head,str(O),str(S/'combined-corrected-preflight-commands.json')],check=True)
r=json.loads((O/'receipt.json').read_text());assert all(c['exit_code']==0 for c in r['commands']),[(c['id'],c['exit_code']) for c in r['commands']]
adapter=json.loads((O/'wp11-adapter.stdout').read_text());sealed=json.loads((R/'verification/wp11/v1.3.0/receipts/approved.json').read_text())
expected=[]
for p in sealed['technical_evidence']['files']:
 b=(R/p['path']).read_bytes()
 if len(b)!=p['bytes'] or sha(b)!=p['sha256']:expected.append({'path':p['path'],'historical_bytes':p['bytes'],'historical_sha256':p['sha256'],'current_bytes':len(b),'current_sha256':sha(b)})
expected.sort(key=lambda x:x['path'])
actual=[{k:x[k] for k in ['path','historical_bytes','historical_sha256','current_bytes','current_sha256']} for x in adapter['current_versus_historical']['changed']]
assert expected==actual and len(expected)==13 and len(sealed['technical_evidence']['files'])==154
assert adapter['current']['approval'] is None and adapter['wrapper']['approval'] is None
assert adapter['historical']['subject_sha256']=='294d8b40bb5a2dbe1f55cdfde4a60205de75ee1ffe48e0108eae69aea2db0f98'
assert len({adapter['historical']['subject_sha256'],adapter['current']['subject_sha256'],adapter['wrapper']['subject_sha256']})==3
frozen={'evaluation/research-program/cohorts.json':'89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543','evaluation/research-program/tasks.json':'4fc5c7fe2a5b51da4bf5ae8e348949a33f26c1758d7a18065e7c5611d1efcedc','docs/research-program/acceptance.md':'625271093e73108959d56f7647107b96ea3398c8555c59a654a53717721a4cc7'}
for p,h in frozen.items():assert sha((R/p).read_bytes())==h
for h in record['components'].values():subprocess.run(['git','merge-base','--is-ancestor',h,head],check=True)
pr005=json.loads((R/'verification/research-program/pr-005/task-binding.json').read_text())
record.update(status='ready_for_exact_candidate_gate',commands_receipt_sha256=sha((O/'receipt.json').read_bytes()),historical_file_count=154,current_changed_inputs=expected,historical_subject=adapter['historical']['subject_sha256'],current_subject=adapter['current']['subject_sha256'],wrapper_subject=adapter['wrapper']['subject_sha256'],frozen_sha256=frozen,original_pr005_base=pr005['base_sha'],original_pr005_dependencies=pr005['dependency_merge_shas'],integration_dependency_merge_shas={'PR-086':head},new_dependency_note='PR005 original producer dependency/base remain historical; this actual combined merge binds the subsequently added PR086 integration dependency. Gate and CI remain pending.',gate_pending=True,hosted_ci_pending=True)
assert not git('status','--porcelain') and git('rev-parse','HEAD')==head
(O/'preflight.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'head':head,'tree':tree,'preflight':str(O/'preflight.json'),'status':record['status']}),flush=True)
