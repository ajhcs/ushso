"""Controller-only merge of independently reviewed PR009 engineering."""
import datetime
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent
REPO = Path('/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr009-successor-20260912')
HEAD = '27d0b0d7c31d8825b91d899dc280cd843af21465'
TREE = 'aef0428057d73645fab00f4d3aecb3418296f79b'
BASE = '8f2914e345b30809be4e1ad97cdccc39b809cc95'
BASE_BRANCH = 'codex/research-program-integration-20260910'
HEAD_BRANCH = 'codex/ushso-pr009-successor-20260912'
RUN = 34696826467
PAUSE = ROOT / 'usage-monitor/PAUSE_REQUESTED.json'
OUT = ROOT / 'pr009-integration'

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
    assert pr['number'] == 26 and pr['state'] == 'open' and not pr['merged']
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
gate = json.loads((ROOT / 'pr009-successor/gate-27d0b0d/gate-receipt.json').read_text())
assert gate['verdict'] == 'passed' and gate['evidence_independent']
assert gate['candidate']['head_sha'] == HEAD and gate['candidate']['tree_sha'] == TREE
decision = json.loads((OUT / 'controller-premerge-decision.json').read_text())
assert decision['verdict'] == 'accept_PR009_engineering_for_research_integration'
assert decision['head'] == HEAD and decision['tree'] == TREE and decision['base'] == BASE
assert decision['run_id'] == RUN and decision['run_attempt'] == 1
required = {'pr009-successor/gate-27d0b0d/gate-review.json', 'pr009-successor/final-metadata-review-27d0b0d/review.json', 'pr009-successor/final-independent-27d0b0d/summary.json', 'hosted-ci-27d0b0d/hosted-ci-receipt.json', 'pr009-integration/hosted-ci-root-review.json'}
assert required.issubset({item['path'] for item in decision['reviewed_evidence']})
for item in decision['reviewed_evidence']:
    p = ROOT / item['path']
    assert hashlib.sha256(p.read_bytes()).hexdigest() == item['sha256'], item['path']
assert decision['hosted_checkout']['tree'] == TREE
checkout = api('git/commits/' + decision['hosted_checkout']['commit'])
assert checkout['tree']['sha'] == TREE
assert [p['sha'] for p in checkout['parents']] == [BASE, HEAD]
save('hosted-checkout-readback.json', checkout)
main_before = api('git/ref/heads/main')
assert main_before['object']['sha'] == '45210704b8de2d7b1360b6d32657cd17791bdd77'
save('github-main-before.json', main_before)
before = api('pulls/26')
pr_guard(before)
save('github-pr-before.json', before)
live_ci_guard()
pause_guard()
if before['draft']:
    result = subprocess.run(['gh', 'pr', 'ready', '26', '--repo', 'ajhcs/ushso'], cwd=REPO, text=True, capture_output=True)
    save('mark-ready.json', {'at': now(), 'exit_code': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    ready_readback = api('pulls/26', record_atomic_result=True)
    save('github-pr-after-ready-command.json', ready_readback)
    assert result.returncode == 0, 'Inspect retained readiness readback before retrying.'
pause_guard()
ready = api('pulls/26')
pr_guard(ready)
assert ready['draft'] is False
live_ci_guard()
pause_guard()
cmd = ['gh', 'pr', 'merge', '26', '--repo', 'ajhcs/ushso', '--merge', '--match-head-commit', HEAD]
started = now()
result = subprocess.run(cmd, cwd=REPO, text=True, capture_output=True)
save('merge-command.json', {'command': cmd, 'started_at': started, 'finished_at': now(), 'exit_code': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr, 'pause_requested_after_atomic_action': PAUSE.exists()})
# Readback only: finish recording the already-issued atomic operation even if a reset arrived.
after = api('pulls/26', record_atomic_result=True)
save('github-pr-after.json', after)
assert after['merged'] is True and after['merged_at'], 'Merge not confirmed; inspect retained command/readback before any retry.'
merge = api('git/commits/' + after['merge_commit_sha'], record_atomic_result=True)
save('github-merge-commit.json', merge)
assert merge['tree']['sha'] == TREE
assert [p['sha'] for p in merge['parents']] == [BASE, HEAD]
branch_after = api('git/ref/heads/' + BASE_BRANCH, record_atomic_result=True)
main_after = api('git/ref/heads/main', record_atomic_result=True)
save('github-integration-after.json', branch_after)
save('github-main-after.json', main_after)
assert branch_after['object']['sha'] == after['merge_commit_sha']
assert main_after['object']['sha'] == main_before['object']['sha']
receipt = {'format': 'ushso.pr009-engineering-integration.v1', 'recorded_at': now(), 'pr_url': after['html_url'], 'candidate_head': HEAD, 'candidate_tree': TREE, 'prior_remote_base': BASE, 'actual_merge_sha': after['merge_commit_sha'], 'actual_merge_tree': merge['tree']['sha'], 'actual_merge_parents': [p['sha'] for p in merge['parents']], 'merged_at': after['merged_at'], 'merge_command_exit_code': result.returncode, 'command_transport_failure_retained': result.returncode != 0, 'dependency_merge_basis': 'actual accepted PR009 engineering merge; C0091 measured topology remains unresolved', 'main_changed': False, 'production_changed': False, 'pause_requested': PAUSE.exists()}
save('merge-receipt.json', receipt)
print(json.dumps(receipt))
