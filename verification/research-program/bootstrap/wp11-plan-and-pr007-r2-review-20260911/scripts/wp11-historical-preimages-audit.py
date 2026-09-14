from pathlib import Path
import json,hashlib,subprocess
from datetime import datetime,timezone
r=Path('/mnt/d/worktrees/plumbob/ushso-research-program-20260910')
s=Path('/mnt/d/tmp/plumbob/ushso-research-program-20260910')
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=r)
head=git('rev-parse','HEAD').decode().strip()
assert head=='3355015bc056ba3fdfddfdd4381a984c0d189aef'
assert not git('status','--porcelain')
sealed='verification/wp11/v1.3.0/receipts/approved.json'
b=(r/sealed).read_bytes();assert sha(b)=='e596e1b18a0251f611990c9752e1d12fb36cd05dab16bf55cf96e8d1fc431f9d'
receipt=json.loads(b);rows=receipt['technical_evidence']['files'];assert len(rows)==154
source='30fa0c59ecd4d3d1dd1f56cd8422c6c470e45cb0'
results=[]
for row in rows:
 original=git('show',source+':'+row['path'])
 current=(r/row['path']).read_bytes()
 results.append({'path':row['path'],'expected':row,'source_commit':source,'original_bytes':len(original),'original_sha256':sha(original),'historical_pin_matches':sha(original)==row['sha256'] and len(original)==row['bytes'],'current_bytes':len(current),'current_sha256':sha(current),'current_differs':current!=original})
assert all(x['historical_pin_matches'] for x in results)
assert not git('status','--porcelain')
out={'format':'ushso.wp11-controller-historical-preimage-audit.v1','recorded_at':datetime.now(timezone.utc).isoformat(),'reviewer':'root Astra','head':head,'tree':git('rev-parse','HEAD^{tree}').decode().strip(),'source_commit':source,'receipt_sha256':sha(b),'historical_subject_sha256':receipt['subject_sha256'],'files':results,'matched':len(results),'historical_total_bytes':sum(x['original_bytes'] for x in results),'current_changed_paths':[x['path'] for x in results if x['current_differs']],'source_clean':True,'snapshot_artifact_created':False,'approval_issued':False,'accepted':False}
(s/'wp11-historical-preimages-controller-audit.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({k:v for k,v in out.items() if k!='files'}))
