from pathlib import Path
import hashlib, json, os, subprocess

R = Path.cwd()
S = Path('/mnt/d/tmp/plumbob/ushso-research-program-20260910')
cp = json.loads((S / 'combined-corrected-preflight/preflight.json').read_text())
head = cp['head']
git = lambda *a: subprocess.check_output(['git', *a], text=True).strip()
subprocess.run(['/home/plumbob/.local/bin/worktree-bootstrap', 'verify', 'ushso-pr005-pr086-controller-combined-20260911', '--repo', str(R), '--require-writer'], check=True)
assert head == 'e6da2e2d87c95501e5a1b129989e17bdae3cb882'
assert git('rev-parse', 'HEAD') == head and git('rev-parse', 'HEAD^{tree}') == cp['tree'] and not git('status', '--porcelain')
assert cp['status'] == 'ready_for_exact_candidate_gate' and cp['accepted'] is False
assert hashlib.sha256((S / 'combined-corrected-preflight/receipt.json').read_bytes()).hexdigest() == cp['commands_receipt_sha256']
assert hashlib.sha256((S / 'combined-e6da2e2-gate-plan.json').read_bytes()).hexdigest() == '90d80c8cbca9b3a6f3395d5a8c23703eab855e6e4e2a246cceb2892790725857'
assert hashlib.sha256((R / '.codex/release-gate.toml').read_bytes()).hexdigest() == '068273993ddb6692eb5ac77a07d9ab7a10a5ee670efdf3b236ba1064de297478'
listeners = subprocess.run(['ss', '-H', '-tlnp', '( sport = :18787 )'], capture_output=True, text=True, check=True)
assert not listeners.stdout.strip(), 'Gate port 18787 is already in use'
env = dict(os.environ)
env['PATH'] = str(S / 'tooling/node_modules/.bin') + os.pathsep + env['PATH']
env['WRANGLER_LOG_PATH'] = str(S / 'gate-component-e6da2e2-wrangler.log')
assert subprocess.check_output(['npm', '--version'], env=env, text=True).strip() == '11.19.1'
receipt = S / 'gate-component-e6da2e2.json'
assert not receipt.exists()
with (S / 'gate-component-e6da2e2-run.stdout').open('wb') as out, (S / 'gate-component-e6da2e2-run.stderr').open('wb') as err:
    result = subprocess.run(['/home/plumbob/.local/bin/release-gate', 'run', '--repo', str(R), '--receipt', str(receipt)], env=env, stdout=out, stderr=err)
print(json.dumps({'head': head, 'receipt': str(receipt), 'exit_code': result.returncode}), flush=True)
raise SystemExit(result.returncode)
