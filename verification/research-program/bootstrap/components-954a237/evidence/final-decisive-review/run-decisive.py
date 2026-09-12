from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys, time
OUT=Path(__file__).parent
C=Path('/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr006-pr008-combined-20260911')
EXPECTED_HEAD='954a237a8984d06f5ea0ab15f83c71ce210bf09a'
EXPECTED_TREE='a781e9801224af92b51389fb898f0b67ab261982'
FILES=['apps/web/src/providers/discoveryProvider.ts','apps/web/src/providers/discoveryProvider.test.ts','scripts/research/source-extractors.mjs','tests/cms-layout.test.mjs']
HARNESSES=[
 '/mnt/d/tmp/plumbob/ushso-astra-review-e3af8dd-20260912/data-probes.test.mjs',
 '/mnt/d/tmp/plumbob/ushso-astra-review-e3af8dd-20260912/web-probes.test.ts',
 '/mnt/d/tmp/plumbob/ushso-astra-corrections-review-20260912/cms-boundary.test.mjs',
 '/mnt/d/tmp/plumbob/ushso-astra-corrections-review-20260912/web-boundary.test.ts',
 '/mnt/d/tmp/plumbob/ushso-astra-correction-followup-20260912/cms-extra.test.mjs',
 '/mnt/d/tmp/plumbob/ushso-astra-correction-followup-20260912/web-extra.test.ts']
def sha(b):return hashlib.sha256(b).hexdigest()
def digest(p):
 b=Path(p).read_bytes();return {'bytes':len(b),'sha256':sha(b)}
def git(*args):return subprocess.check_output(['git',*args],cwd=C).decode().strip()
def write(name,value):
 p=OUT/name
 with p.open('x') as f:f.write(json.dumps(value,indent=2)+'\n')
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
def snapshot():
 return {'head':git('rev-parse','HEAD'),'tree':git('rev-parse','HEAD^{tree}'),'status_porcelain':git('status','--porcelain=v1'),'tracked_diff_sha256':sha(subprocess.check_output(['git','diff','--binary','--full-index','HEAD'],cwd=C)),'files':{p:digest(C/p) for p in FILES},'harnesses':{p:digest(p) for p in HARNESSES}}
def check_snapshot():
 s=snapshot()
 assert s['head']==EXPECTED_HEAD and s['tree']==EXPECTED_TREE,'Immutable identity changed'
 assert s['status_porcelain']=='','Candidate is not clean'
 return s
MODE=sys.argv[1]
if MODE=='capture':
 before=check_snapshot()
 write('candidate-before.json',before)
 print(json.dumps({'snapshot':str(OUT/'candidate-before.json'),'head':before['head'],'tree':before['tree']}))
 sys.exit(0)
before=json.loads((OUT/'candidate-before.json').read_text())
assert check_snapshot()==before,'Snapshot mismatch before checks'
CASES={
 'original-data':(['node',HARNESSES[0]],2),
 'cms-boundary':(['node',HARNESSES[2]],4),
 'cms-extra':(['node',HARNESSES[4]],3),
 'web':(['node','node_modules/vitest/vitest.mjs','run','--config',str(OUT/'decisive-vitest.config.mjs'),'--configLoader','native','--no-cache','--reporter=verbose','--reporter=json','--outputFile',str(OUT/'web-results.json')],14)
}
case=MODE
label=sys.argv[2] if len(sys.argv)>2 else MODE
command,expected=CASES[case]
env=dict(os.environ,USHSO_LIVE_SOURCE_REQUESTS='forbidden',USHSO_ALLOW_LIVE_SOURCE_REQUESTS='0',USHSO_NETWORK_POLICY='authoritative-sources-forbidden',USHSO_ALLOW_RECEIPT_WRITES='0',USHSO_RECEIPT_MODE='verify-only')
stdout=OUT/(label+'.stdout.log');stderr=OUT/(label+'.stderr.log')
started=now();tick=time.monotonic();exc=None
with stdout.open('xb') as of,stderr.open('xb') as ef:
 try:run=subprocess.run(command,cwd=C,env=env,stdout=of,stderr=ef,timeout=120);exit_code=run.returncode
 except Exception as e:exit_code=None;exc=repr(e)
after=snapshot()
receipt={'case':case,'label':label,'command':command,'cwd':str(C),'started_at':started,'completed_at':now(),'duration_seconds':round(time.monotonic()-tick,3),'exit_code':exit_code,'exception':exc,'node_version':subprocess.check_output(['node','--version'],text=True).strip(),'expected_cases':expected,'expected_outcome':{'kind':'observed_exit','exit_code':0},'observed_outcome':{'kind':'observed_exit' if exit_code is not None else 'failed','exit_code':exit_code},'subject':{'head':EXPECTED_HEAD,'tree':EXPECTED_TREE},'candidate_unchanged':after==before,'stdout':{'path':str(stdout),**digest(stdout)},'stderr':{'path':str(stderr),**digest(stderr)},'sandbox_context':os.environ.get('PR006008_REVIEW_EXECUTION_CONTEXT','workspace-write')}
write(label+'.receipt.json',receipt);write(label+'.candidate-after.json',after)
print(json.dumps(receipt),flush=True)
assert after==before,'Candidate or retained reviewer source changed'
sys.exit(0 if exit_code==0 else 1)
