"""Controller-run pinned npm repair; use only inside the managed PR010 writer."""
from pathlib import Path
import datetime, hashlib, json, os, runpy, shutil, subprocess

REPO = Path('/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr010-local-jobs-20260912')
TASK = 'ushso-pr010-local-jobs-20260912'
START = '50a844d218600f95c13e64c2db64ab4d8562ae0d'
TOOL = Path('/home/plumbob/.local/bin/worktree-bootstrap')
TOOL_SHA = '4138a49e42148db9e5c63dfd5386fdac235f19e445453e702f342b1a7002b813'
NPM_ROOT = Path('/mnt/d/cache/plumbob/npm/_npx/ae109337638209d1/node_modules/npm')
OUT = Path(__file__).resolve().parent
ROOT = OUT.parent

def guard():
    if (ROOT / 'usage-monitor/PAUSE_REQUESTED.json').exists(): raise SystemExit(75)

def run(args):
    guard()
    result = subprocess.check_output(args, cwd=REPO, text=True).strip()
    guard()
    return result

def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + '\n')

guard()
assert Path.cwd().resolve() == REPO and os.environ.get('WORKTREE_BOOTSTRAP_TASK') == TASK
assert hashlib.sha256(TOOL.read_bytes()).hexdigest() == TOOL_SHA
assert run(['git', 'rev-parse', 'HEAD']) == START and not run(['git', 'status', '--porcelain'])
run(['worktree-bootstrap', 'verify', TASK, '--repo', str(REPO), '--require-writer'])
assert json.loads((NPM_ROOT / 'package.json').read_text())['version'] == '11.19.1'
node = shutil.which('node'); assert node
npm = [node, str(NPM_ROOT / 'bin/npm-cli.js')]
assert run(npm + ['--version']) == '11.19.1'
node_version = run([node, '--version'])
marker_path = REPO / 'node_modules/.worktree-bootstrap-owner.json'
old_marker = json.loads(marker_path.read_text())
assert old_marker['task'] == TASK and old_marker['worktree_path'] == str(REPO) and old_marker['start_sha'] == START
# Use the installed implementation's ownership guards and post-success marker writer.
# No CLI rebootstrap subcommand exists; source hash pins this internal helper API.
library = runpy.run_path(str(TOOL), run_name='worktree_bootstrap_support')
plan = [{'argv': npm + ['ci', '--no-audit', '--no-fund'], 'source': 'controller-pinned-npm-11.19.1-rebootstrap'}]
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
guard()
try:
    results = library['execute_bootstrap'](REPO, plan, TASK, START)
except Exception as error:
    save('rebootstrap-failure.json', {'started_at': started, 'finished_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'task': TASK, 'repo': str(REPO), 'node_version': node_version, 'npm_version': '11.19.1', 'error_type': type(error).__name__, 'detail': str(error), 'results': getattr(error, 'details', None), 'prior_marker': old_marker, 'ownership_recovery': 'Stop and inspect. Do not fabricate a success marker or repeat creation. The tool deliberately marks only a successful bootstrap.'})
    raise
# Complete this already-issued install's evidence, then honor a pending pause.
new_marker = json.loads(marker_path.read_text())
assert all(new_marker[k] == old_marker[k] for k in ['schema', 'task', 'worktree_path', 'start_sha'])
save('rebootstrap-receipt.json', {'started_at': started, 'finished_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'task': TASK, 'repo': str(REPO), 'head': START, 'node_version': node_version, 'npm_version': '11.19.1', 'results': results, 'prior_marker': old_marker, 'current_marker': new_marker, 'global_npm_changed': False, 'original_bootstrap_manifest_preserved': True})
guard()
verification = json.loads(run(['worktree-bootstrap', 'verify', TASK, '--repo', str(REPO), '--require-writer']))
assert verification['ok'] is True and not run(['git', 'status', '--porcelain'])
save('rebootstrap-verification.json', verification)
print(json.dumps({'status': 'pinned_npm_rebootstrap_passed', 'node_version': node_version, 'npm_version': '11.19.1', 'worktree_verified': True, 'receipt': str(OUT / 'rebootstrap-receipt.json')}))
