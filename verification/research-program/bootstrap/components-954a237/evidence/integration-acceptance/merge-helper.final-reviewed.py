"""Controller-only, exact-head merge of the reviewed PR-006/008 composition."""
import datetime
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent
REPO = Path('/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr006-pr008-combined-20260911')
HEAD = '954a237a8984d06f5ea0ab15f83c71ce210bf09a'
TREE = 'a781e9801224af92b51389fb898f0b67ab261982'
BASE = '9e00d4e09514e1dd30672e19a3cbef4171955b00'
BASE_BRANCH = 'codex/research-program-integration-20260910'
HEAD_BRANCH = 'codex/ushso-pr006-pr008-combined-20260911'
RUN = 34673332274
PAUSE = ROOT / 'usage-monitor/PAUSE_REQUESTED.json'
OUT = ROOT / 'integration-acceptance'

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')

def pause_guard():
    if PAUSE.exists():
        raise SystemExit('Usage reset observed: no new work permitted.')

def run(*args, record_atomic_result=False):
    if not record_atomic_result:
        pause_guard()
    return subprocess.check_output(list(args), cwd=REPO, text=True).strip()

def api(path, record_atomic_result=False):
    return json.loads(run('gh', 'api', 'repos/ajhcs/ushso/' + path, record_atomic_result=record_atomic_result))

def save(name, obj):
    (OUT / name).write_text(json.dumps(obj, indent=2) + '\n')

def pr_guard(pr):
    assert pr['number'] == 25 and pr['state'] == 'open' and not pr['merged']
    assert pr['head']['sha'] == HEAD and pr['head']['ref'] == HEAD_BRANCH
    assert pr['base']['sha'] == BASE and pr['base']['ref'] == BASE_BRANCH
    assert pr['head']['repo']['full_name'] == pr['base']['repo']['full_name'] == 'ajhcs/ushso'
    assert pr['mergeable'] is True, 'GitHub mergeability must be resolved and true.'

def live_ci_guard():
    current = api(f'actions/runs/{RUN}')
    assert current['head_sha'] == HEAD and current['run_attempt'] == 1
    assert current['status'] == 'completed' and current['conclusion'] == 'success'
    live = api(f'actions/runs/{RUN}/attempts/1')
    assert live['head_sha'] == HEAD and live['run_attempt'] == 1
    assert live['status'] == 'completed' and live['conclusion'] == 'success'
    jobs = api(f'actions/runs/{RUN}/attempts/1/jobs')['jobs']
    assert len(jobs) == 2 and {j['name'] for j in jobs} == {'node22-compatibility', 'build-and-dry-run'}
    assert all(j['status'] == 'completed' and j['conclusion'] == 'success' for j in jobs)
    save('live-ci-before-merge.json', {'current_run': current, 'attempt_run': live, 'jobs': jobs})

pause_guard()
assert Path.cwd().resolve() == REPO.resolve()
run('worktree-bootstrap', 'verify', REPO.name, '--repo', str(REPO), '--require-writer')
assert run('git', 'rev-parse', 'HEAD') == HEAD
assert run('git', 'rev-parse', 'HEAD^{tree}') == TREE
assert not run('git', 'status', '--porcelain')
assert run('git', 'remote', 'get-url', 'origin') == 'git@github.com:ajhcs/ushso.git'
OUT.mkdir(exist_ok=True)
gate = json.loads((ROOT / 'final-gate-receipt.json').read_text())
assert gate['verdict'] == 'passed' and gate['evidence_independent']
assert gate['candidate']['head_sha'] == HEAD and gate['candidate']['tree_sha'] == TREE
decision = json.loads((OUT / 'controller-premerge-decision.json').read_text())
assert decision['verdict'] == 'accept_exact_candidate_for_research_integration'
assert decision['head'] == HEAD and decision['tree'] == TREE and decision['base'] == BASE
assert decision['run_id'] == RUN and decision['run_attempt'] == 1
for item in decision['reviewed_evidence']:
    p = ROOT / item['path']
    assert hashlib.sha256(p.read_bytes()).hexdigest() == item['sha256'], item['path']
assert decision['hosted_checkout']['tree'] == TREE
checkout = api('git/commits/' + decision['hosted_checkout']['commit'])
assert checkout['tree']['sha'] == TREE
assert [p['sha'] for p in checkout['parents']] == [BASE, HEAD]
save('hosted-checkout-readback.json', checkout)
before = api('pulls/25')
pr_guard(before)
save('github-pr-before.json', before)
live_ci_guard()
pause_guard()
if before['draft']:
    result = subprocess.run(['gh', 'pr', 'ready', '25', '--repo', 'ajhcs/ushso'], cwd=REPO, text=True, capture_output=True)
    save('mark-ready.json', {'at': now(), 'exit_code': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    assert result.returncode == 0
pause_guard()
ready = api('pulls/25')
pr_guard(ready)
assert ready['draft'] is False
live_ci_guard()
pause_guard()
cmd = ['gh', 'pr', 'merge', '25', '--repo', 'ajhcs/ushso', '--merge', '--match-head-commit', HEAD]
started = now()
result = subprocess.run(cmd, cwd=REPO, text=True, capture_output=True)
save('merge-command.json', {'command': cmd, 'started_at': started, 'finished_at': now(), 'exit_code': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr, 'pause_requested_after_atomic_action': PAUSE.exists()})
# Readback only: finish recording the already-issued atomic operation even if a reset arrived.
after = api('pulls/25', record_atomic_result=True)
save('github-pr-after.json', after)
assert after['merged'] is True and after['merged_at'], 'Merge not confirmed; inspect retained command/readback before any retry.'
merge = api('git/commits/' + after['merge_commit_sha'], record_atomic_result=True)
save('github-merge-commit.json', merge)
assert merge['tree']['sha'] == TREE
assert [p['sha'] for p in merge['parents']] == [BASE, HEAD]
for number in [23, 24]:
    save(f'github-pr-{number}-after-bundle.json', api(f'pulls/{number}', record_atomic_result=True))
receipt = {'format': 'ushso.exact-combined-integration.v1', 'recorded_at': now(), 'pr_url': after['html_url'], 'candidate_head': HEAD, 'candidate_tree': TREE, 'prior_remote_base': BASE, 'actual_merge_sha': after['merge_commit_sha'], 'actual_merge_tree': merge['tree']['sha'], 'actual_merge_parents': [p['sha'] for p in merge['parents']], 'merged_at': after['merged_at'], 'merge_command_exit_code': result.returncode, 'command_transport_failure_retained': result.returncode != 0, 'component_dependency_merge_basis': 'actual accepted combined integration merge; individual GitHub PR states are retained separately', 'main_changed': False, 'production_changed': False, 'pause_requested': PAUSE.exists()}
save('merge-receipt.json', receipt)
print(json.dumps(receipt))
