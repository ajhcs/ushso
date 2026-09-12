from pathlib import Path
import subprocess,os,json,datetime,hashlib
R=Path('/mnt/d/tmp/plumbob/ushso-epic-execution-20260912');O=R/'pr087-dispatch/creation';O.mkdir(exist_ok=False)
component=json.loads((R/'pr010-assembly-readiness/component-merge-receipt.json').read_bytes());repo=Path(component['worktree']);base=component['component_merge'];task='ushso-pr087-current-wp5-20260912'
assert component['parents']==['50a844d218600f95c13e64c2db64ab4d8562ae0d','0d3e5e18f721ef99003dd6b183b43f2f261f0ad1']
assert component['tree']=='0ffb5e5e2ad336f5f67695adc3398dc67c503037'
assert subprocess.run(['mountpoint','-q','/mnt/d']).returncode==0
assert subprocess.check_output(['git','--no-optional-locks','rev-parse','HEAD'],cwd=repo,text=True).strip()==base
assert not subprocess.check_output(['git','--no-optional-locks','status','--porcelain=v1'],cwd=repo)
config=json.loads((R/'pr010-assembly-readiness/bootstrap-tooling.json').read_bytes());shim=Path(config['task_scoped_shim']);assert hashlib.sha256(shim.read_bytes()).hexdigest()==config['shim_sha256'];assert hashlib.sha256(Path(config['npm_cli']).read_bytes()).hexdigest()==config['npm_cli_sha256']
env=os.environ.copy();env['PATH']=str(shim.parent)+':'+env['PATH'];assert subprocess.check_output(['npm','--version'],env=env,text=True).strip()=='11.19.1'
argv=['worktree-bootstrap','create',task,'--repo',str(repo),'--base',base,'--local-only','--branch','codex/'+task];started=datetime.datetime.now(datetime.timezone.utc).isoformat();result=subprocess.run(argv,env=env,cwd=repo,capture_output=True,timeout=600);(O/'create.stdout.log').write_bytes(result.stdout);(O/'create.stderr.log').write_bytes(result.stderr);receipt={'argv':argv,'started_at':started,'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit_code':result.returncode,'stdout_sha256':hashlib.sha256(result.stdout).hexdigest(),'stderr_sha256':hashlib.sha256(result.stderr).hexdigest(),'task':task,'base':base,'component_merge':base,'source_changed':False,'production_changed':False};(O/'create-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt));print(result.stdout.decode()[-6000:]);print(result.stderr.decode()[-1500:]);raise SystemExit(result.returncode)
