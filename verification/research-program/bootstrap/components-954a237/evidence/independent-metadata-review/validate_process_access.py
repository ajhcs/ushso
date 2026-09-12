import datetime
import hashlib
import json
import pathlib
import subprocess

repo = pathlib.Path('/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr006-pr008-combined-20260911')
out = pathlib.Path('/mnt/d/tmp/plumbob/ushso-epic-execution-20260912/independent-metadata-review')
expected = '954a237a8984d06f5ea0ab15f83c71ce210bf09a'
results = []
for pr in ['PR-006', 'PR-086']:
    before = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo).decode().strip()
    assert before == expected
    command = ['node', 'scripts/research-program/check-handoff.mjs', f'docs/research-program/handoffs/{pr}.json']
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    process = subprocess.run(command, cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
    completed = datetime.datetime.now(datetime.timezone.utc).isoformat()
    after = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo).decode().strip()
    assert after == expected
    report = json.loads(process.stdout)
    label = 'final-' + pr.lower() + '-handoff-process-access'
    (out / (label + '.stdout.json')).write_bytes(process.stdout)
    (out / (label + '.stderr.log')).write_bytes(process.stderr)
    receipt = {
        'pr_id': pr, 'command': command, 'cwd': str(repo), 'head_before': before,
        'head_after': after, 'started_at': started, 'completed_at': completed,
        'exit_code': process.returncode, 'stdout_sha256': hashlib.sha256(process.stdout).hexdigest(),
        'stderr_sha256': hashlib.sha256(process.stderr).hexdigest(), 'ok': report.get('ok'),
        'findings': report.get('findings'), 'initial_failure': 'final-' + pr.lower() + '-handoff.json',
        'scope': 'Read-only metadata validation with normal process access; no product test, build, repository or Git metadata write.'
    }
    (out / (label + '.json')).write_text(json.dumps(receipt, indent=2) + '\n')
    results.append(receipt)
print(json.dumps(results, indent=2))
