import datetime, hashlib, json, subprocess
from pathlib import Path

R = Path.cwd()
S = Path('/mnt/d/tmp/plumbob/ushso-research-program-20260910')
O = S / 'combined-corrected-preflight'
sha = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *a: subprocess.check_output(['git', *a], text=True).strip()
record = json.loads((S / 'combined-corrected-candidate.json').read_text())
head = record['head']
assert head == 'e6da2e2d87c95501e5a1b129989e17bdae3cb882'
assert git('rev-parse', 'HEAD') == head
assert git('rev-parse', 'HEAD^{tree}') == record['tree']
assert not git('status', '--porcelain')
assert not (O / 'preflight.json').exists()
r = json.loads((O / 'receipt.json').read_text())
assert r['head'] == head and r['tree'] == record['tree']
assert r['source_clean'] and r['head_unchanged'] and len(r['commands']) == 10
for c in r['commands']:
    assert c['exit_code'] == 0 and c['error'] is None and c['signal'] is None
    for stream in ('stdout', 'stderr'):
        ref = c[stream]
        b = (O / ref['path']).read_bytes()
        assert len(b) == ref['bytes'] and sha(b) == ref['sha256']
adapter = json.loads((O / 'wp11-adapter.stdout').read_text())
sealed = json.loads((R / 'verification/wp11/v1.3.0/receipts/approved.json').read_text())
expected = []
for p in sealed['technical_evidence']['files']:
    b = (R / p['path']).read_bytes()
    if len(b) != p['bytes'] or sha(b) != p['sha256']:
        expected.append(dict(path=p['path'], historical_bytes=p['bytes'], historical_sha256=p['sha256'], current_bytes=len(b), current_sha256=sha(b)))
expected.sort(key=lambda x: x['path'])
actual = [{k: x[k] for k in ('path', 'historical_bytes', 'historical_sha256', 'current_bytes', 'current_sha256')} for x in adapter['current_versus_historical']['changed']]
assert expected == actual and len(expected) == 13 and len(sealed['technical_evidence']['files']) == 154
assert adapter['current']['approval'] is None and adapter['wrapper']['approval'] is None
assert adapter['historical']['subject_sha256'] == '294d8b40bb5a2dbe1f55cdfde4a60205de75ee1ffe48e0108eae69aea2db0f98'
assert len({adapter[k]['subject_sha256'] for k in ('historical', 'current', 'wrapper')}) == 3
frozen = {
    'evaluation/research-program/cohorts.json': '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543',
    'evaluation/research-program/tasks.json': '4fc5c7fe2a5b51da4bf5ae8e348949a33f26c1758d7a18065e7c5611d1efcedc',
    'docs/research-program/acceptance.md': '625271093e73108959d56f7647107b96ea3398c8555c59a654a53717721a4cc7',
}
for p, h in frozen.items():
    assert sha((R / p).read_bytes()) == h
for h in record['components'].values():
    subprocess.run(['git', 'merge-base', '--is-ancestor', h, head], check=True)
binding = json.loads((R / 'verification/research-program/pr-005/task-binding.json').read_text())['binding']
assert binding['base_sha'] == '15b351a92af729f9ba07359fd210123fdfd76bb3'
assert binding['dependency_merge_shas'] == {'PR-004': '463f092f71c0ed1ef2aa5baa29b186e5697d04ce'}
correction = {
    'format': 'ushso.controller-receipt-finalization-correction.v1',
    'recorded_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'candidate_head': head,
    'original_script': 'compose-and-check-corrected-components.py',
    'original_script_sha256': sha((S / 'compose-and-check-corrected-components.py').read_bytes()),
    'failure': "KeyError: 'base_sha' after all ten commands and byte checks passed; task-binding stores provenance under binding.",
    'correction': 'Read binding.base_sha and binding.dependency_merge_shas; independently revalidate retained command stream hashes and unchanged candidate bytes.',
    'command_reruns': 0,
    'candidate_mutations': 0,
    'commands_receipt_sha256': sha((O / 'receipt.json').read_bytes()),
}
(O / 'controller-finalization-correction.json').write_text(json.dumps(correction, indent=2) + '\n')
record.update(
    status='ready_for_exact_candidate_gate',
    commands_receipt_sha256=sha((O / 'receipt.json').read_bytes()),
    controller_finalization_correction_sha256=sha((O / 'controller-finalization-correction.json').read_bytes()),
    historical_file_count=154, current_changed_inputs=expected,
    historical_subject=adapter['historical']['subject_sha256'], current_subject=adapter['current']['subject_sha256'], wrapper_subject=adapter['wrapper']['subject_sha256'],
    frozen_sha256=frozen, original_pr005_base=binding['base_sha'], original_pr005_dependencies=binding['dependency_merge_shas'],
    integration_dependency_merge_shas={'PR-086': head},
    new_dependency_note='PR005 original producer dependency/base remain historical; this actual combined merge binds the subsequently added PR086 integration dependency. Gate and CI remain pending.',
    gate_pending=True, hosted_ci_pending=True,
)
assert git('rev-parse', 'HEAD') == head and not git('status', '--porcelain')
(O / 'preflight.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({k: record[k] for k in ('head', 'tree', 'status', 'current_subject', 'wrapper_subject', 'accepted')}))
