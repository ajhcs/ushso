import os,json,subprocess,datetime
from pathlib import Path
repo=Path('/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr005-pr086-controller-combined-20260911')
s=Path('/mnt/d/tmp/plumbob/ushso-research-program-20260910')
task='ushso-pr005-pr086-controller-combined-20260911'
assert os.environ['WORKTREE_BOOTSTRAP_TASK']==task
subprocess.run(['/home/plumbob/.local/bin/worktree-bootstrap','verify',task,'--repo',str(repo),'--require-writer'],cwd=repo,check=True)
git=lambda *args: subprocess.check_output(['git',*args],cwd=repo,text=True).strip()
assert git('status','--porcelain')==''
assert git('rev-parse','HEAD')=='a11c675b66b25441355ffc9f66bec0f0b6125bc6'
components=[]
for pr,head in [('PR-086','cb9f5d846f36821540af158b455478fe0e2cdb87'),('PR-005','afb90565456a429e73527f2bb99daf9cf174aa3c')]:
 before=git('rev-parse','HEAD')
 subprocess.run(['git','merge','--no-ff','--no-edit','-m',f'Compose {pr} for independent combined review',head],cwd=repo,check=True,stdout=subprocess.DEVNULL)
 components.append({'pr':pr,'producer_head':head,'prior_head':before,'merge_head':git('rev-parse','HEAD'),'merge_tree':git('rev-parse','HEAD^{tree}')})
head=git('rev-parse','HEAD')
record={'recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'repo':str(repo),'task':task,'head':head,'tree':git('rev-parse','HEAD^{tree}'),'components':components,'accepted':False}
(s/'pr005-pr086-initial-combined-candidate.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record),flush=True)
subprocess.run(['/home/plumbob/.nvm/versions/node/v24.14.0/bin/node',str(s/'run-independent-review.mjs'),str(repo),head,str(s/'pr005-pr086-combined-review/initial'),str(s/'pr005-pr086-combined-initial-commands.json')],cwd=repo,check=True)
