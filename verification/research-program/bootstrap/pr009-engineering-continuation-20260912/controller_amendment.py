#!/usr/bin/env python3
"""One guarded PR009 controller amendment; no Git writes or product execution.

Default execution renders a scratch preview. --apply-preview-sha256 requires
that exact preview to have been reviewed. Both modes require the future clean,
accepted ledger base and a worktree-bootstrap writer. See VALIDATION-PLAN.md.
"""
import argparse
import copy
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import runpy
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
PAUSE = Path('/mnt/d/tmp/plumbob/ushso-epic-execution-20260912/usage-monitor/PAUSE_REQUESTED.json')
SCRATCH = Path('/mnt/d/tmp/plumbob')
PLAN = 'docs/master-plan/2026-09-10'
LEDGER = 'docs/research-program/execution-ledger.json'
CAPSULE = 'verification/research-program/bootstrap/pr009-engineering-continuation-20260912'
CHANGED_PRS = ['PR-009', 'PR-010', 'PR-077', 'PR-078', 'PR-082']
PLAN_OUTPUTS = [f'{PLAN}/{n}' for n in ['plan-source.py', 'plan.json', 'validation.json', 'VALIDATION.md', 'link-validation.json']]
PLAN_OUTPUTS += [f'{PLAN}/prs/{p}.md' for p in CHANGED_PRS]
PINNED = {
 'plan-source.py': 'ce02e3a24ff6dd3cbae0c641a1293c28f09e193bcfd279424b0b0bf07f897bd2',
 'plan.json': 'a30e035fc1cf883e7e789487cb3ec0aebde1ddb58177556b9b16f9811d271ef8',
 'build.py': 'd9361935a446d85d0705c253dfe5888a1310c6092c63b37a06ca1c51239f0f8b',
 'validate.py': 'a75a10755e69c21232c14871fd6906c8d6f53bb4674ff6141bea6ad661fdb395',
 'check-links.py': '9162e393a2b95b8a235365f47e730d5bd6dea16de318b8d837a3bdda7b022e41',
}
REVIEW_SHA = '77aabc915323912d9f2c568ea6d3864205bb4cf4dfb7805449dd4f5609970d47'
PROPOSAL_SHA = '67c60f5342f59fa050ef623de7e600c64e074895326585d96809f258403a4323'
EXCLUDED_PRODUCER = '911aff5588ea59b12b81b58f1d5e07ce09a987d3'
BUDGET_QUOTE = "Cheap as possible don't orrry about that for now"


def need(ok, message):
    if not ok:
        raise ValueError(message)


def pause():
    need(not PAUSE.exists(), f'PAUSE_REQUESTED: stop at the current file boundary; retain the preview and any partial local diff: {PAUSE}')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def relative(value):
    need(isinstance(value, str) and value != '', 'missing repository-relative evidence path')
    path = PurePosixPath(value)
    need(not path.is_absolute() and '..' not in path.parts and str(path) == value, 'invalid repository-relative path')
    need(not any(x in ('.git', '.env') or x.startswith('.env.') for x in path.parts), 'administrative/environment paths are outside this amendment')
    return value


def sha(value, label):
    need(isinstance(value, str) and re.fullmatch('[0-9a-f]{40}', value) is not None and value != '0' * 40, f'{label} requires a non-null full Git SHA')
    need(value != EXCLUDED_PRODUCER, f'{label} cannot use the historical 911aff5 producer as accepted identity')
    return value


def run(argv, cwd):
    pause()
    result = subprocess.run(argv, cwd=cwd, capture_output=True, check=False)
    need(result.returncode == 0, f'command failed ({result.returncode}): {argv[:2]!r}; {result.stderr.decode(errors="replace")[:1600]}')
    return result.stdout


def git(repo, *args):
    return run(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', str(repo), *args], repo)


def read_object(repo, commit, path):
    return git(repo, 'show', f'{sha(commit, "object commit")}:{relative(path)}')


def write(path, data):
    pause()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def execute_source(data):
    # The caller pins the reviewed existing source before executing its data builder.
    namespace = {'__name__': 'pr009_plan_data_check'}
    exec(compile(data, 'plan-source.py', 'exec'), namespace)
    return namespace['PRS'], namespace['PLAN_EXTENSIONS']


def check_scope(before, after):
    need(len(before) == len(after) == 86, 'assignment count changed')
    need([p['id'] for p in before] == [p['id'] for p in after], 'assignment identity/order changed')
    need(sum(len(p['commits']) for p in after) == 258, 'planned commit count changed')
    for old, new in zip(before, after):
        old_fixed = {k: v for k, v in old.items() if k not in ('commits', 'acceptance')}
        new_fixed = {k: v for k, v in new.items() if k not in ('commits', 'acceptance')}
        need(old_fixed == new_fixed, f'{old["id"]} changed graph, paths, mappings or other fixed fields')
        if old['id'] not in CHANGED_PRS:
            need(old == new, f'unreviewed assignment changed: {old["id"]}')
        for oc, nc in zip(old['commits'], new['commits']):
            for key in oc:
                if key in ('instructions', 'verification'):
                    need(nc[key].startswith(oc[key]), f'original {oc["id"]} {key} was rewritten')
                else:
                    need(nc[key] == oc[key], f'{oc["id"]} identity changed')
        need(new['acceptance'][:len(old['acceptance'])] == old['acceptance'], 'existing acceptance text changed')
    old10 = next(p for p in before if p['id'] == 'PR-010')
    new10 = next(p for p in after if p['id'] == 'PR-010')
    need(old10['commits'] == new10['commits'], 'PR010 implementation contracts are still pending exact interface review')
    consumers = [p['id'] for p in after if 'PR-009' in p['dependencies']]
    need(consumers == ['PR-010', 'PR-011', 'PR-019', 'PR-022', 'PR-046', 'PR-049', 'PR-078', 'PR-082'], 'PR009 consumer graph changed')


def check_dependency_state(ledger, accepted):
    sha(accepted, 'accepted integration argument')
    need(ledger.get('format') == 'ushso.research-program-execution.v1', 'unexpected live ledger format')
    tasks = ledger.get('tasks', [])
    selected = {}
    for ident in ('PR-003', 'PR-004', 'PR-007', 'PR-008', 'PR-009'):
        found = [t for t in tasks if t.get('pr_id') == ident]
        need(len(found) == 1, f'missing/duplicate live ledger task {ident}')
        selected[ident] = found[0]
    for ident in ('PR-003', 'PR-004', 'PR-007', 'PR-008'):
        need(selected[ident].get('status') in ('integrated', 'qualified'), f'{ident} is not accepted and integrated in the live ledger')
        sha(selected[ident].get('merge_sha'), f'{ident} live merge')
    pr8 = selected['PR-008']
    sha(pr8.get('head_sha'), 'PR008 accepted producer')
    sha(pr8.get('integration_merge_sha'), 'PR008 actual bundle integration')
    for key in ('controller_handoff', 'independent_acceptance'):
        relative(pr8.get(key))
    return selected


def workspace_guard(repo, accepted, task):
    pause()
    sha(accepted, 'accepted integration argument')
    need(repo.is_absolute() and repo.resolve() == repo and repo.is_relative_to('/mnt/d/worktrees/plumbob'), 'use the actual isolated worktree path supplied by worktree-bootstrap')
    need(os.environ.get('WORKTREE_BOOTSTRAP_TASK') == task and bool(task), 'launch this exact task through worktree-bootstrap')
    run(['worktree-bootstrap', 'verify', task, '--repo', str(repo), '--require-writer'], repo)
    need(git(repo, 'rev-parse', 'HEAD').decode().strip() == accepted, 'writer HEAD must equal the explicit accepted ledger base')
    need(git(repo, 'symbolic-ref', '--short', 'HEAD').decode().strip().startswith('codex/'), 'writer must own an attached codex/ branch')
    need(not git(repo, 'status', '--porcelain=v1', '--untracked-files=all'), 'writer worktree is not clean')
    old = read_object(repo, accepted, LEDGER)
    need((repo / LEDGER).read_bytes() == old, 'live ledger differs from the explicit committed base')
    ledger = json.loads(old)
    selected = check_dependency_state(ledger, accepted)
    def committed_json(path):
        return json.loads(read_object(repo, accepted, relative(path)))
    pr8 = selected['PR-008']
    handoff = committed_json(pr8['controller_handoff'])
    acceptance_bytes = read_object(repo, accepted, pr8['independent_acceptance'])
    acceptance = json.loads(acceptance_bytes)
    need(handoff.get('pr_id') == 'PR-008' and handoff.get('status') == 'independently_verified' and handoff.get('integration_state') == 'integrated', 'PR008 controller handoff is not independently accepted and integrated')
    for key in ('head_sha', 'merge_sha', 'integration_merge_sha'):
        need(handoff.get(key) == pr8[key], f'PR008 handoff/live-ledger mismatch: {key}')
    need(handoff.get('independent_acceptance') == pr8['independent_acceptance'], 'PR008 handoff acceptance locator mismatch')
    need(acceptance.get('status') == 'independently_verified' and acceptance.get('component_heads', {}).get('PR-008') == pr8['head_sha'], 'acceptance does not independently accept this PR008 producer')
    sha(acceptance.get('combined_head'), 'accepted combined head')
    sha(acceptance.get('combined_tree'), 'accepted combined tree')
    for ancestor in [*[selected[p]['merge_sha'] for p in ('PR-003', 'PR-004', 'PR-007', 'PR-008')], pr8['head_sha'], pr8['integration_merge_sha'], acceptance['combined_head']]:
        git(repo, 'merge-base', '--is-ancestor', ancestor, accepted)
    bundle_tree = git(repo, 'rev-parse', pr8['integration_merge_sha'] + '^{tree}').decode().strip()
    need(bundle_tree == handoff.get('integration_tree') == acceptance['combined_tree'], 'accepted bundle tree does not match retained acceptance')
    evidence = handoff.get('evidence_index')
    need(isinstance(evidence, dict), 'missing live controller evidence index pin')
    index_bytes = read_object(repo, accepted, relative(evidence.get('path')))
    need(digest(index_bytes) == evidence.get('sha256') and len(index_bytes) == evidence.get('bytes'), 'controller evidence index hash/length mismatch')
    index = json.loads(index_bytes)
    need(index.get('accepted_combined_head') == acceptance['combined_head'] and index.get('accepted_tree') == bundle_tree and index.get('github_integration_merge') == pr8['integration_merge_sha'], 'evidence index does not bind the accepted bundle')
    pins = [p for p in index.get('artifacts', []) if p.get('path') == pr8['independent_acceptance']]
    need(len(pins) == 1 and pins[0].get('sha256') == digest(acceptance_bytes) and pins[0].get('bytes') == len(acceptance_bytes), 'live evidence index does not pin actual acceptance bytes')
    for key in ('local_full_gate', 'hosted_combined_ci'):
        proof = acceptance.get(key)
        need(isinstance(proof, dict) and re.fullmatch('[0-9a-f]{64}', str(proof.get('sha256'))) and isinstance(proof.get('bytes'), int) and proof['bytes'] > 0, f'missing retained {key} identity')
        retained = [p for p in index.get('artifacts', []) if (p.get('path') == proof.get('path') or p.get('source_path') == proof.get('path')) and p.get('sha256') == proof['sha256'] and p.get('bytes') == proof['bytes']]
        if retained:
            need(len(retained) == 1, f'ambiguous retained {key}')
            data = read_object(repo, accepted, relative(retained[0]['path']))
        else:
            decoded = index.get('decoded_local_gate', {}) if key == 'local_full_gate' else {}
            need(decoded.get('sha256') == proof['sha256'] and decoded.get('bytes') == proof['bytes'] and decoded.get('encoding') == 'gzip', f'missing repository-retained {key} bytes')
            compressed = read_object(repo, accepted, relative(decoded.get('path')))
            zipped = [p for p in index.get('artifacts', []) if p.get('path') == decoded['path']]
            need(len(zipped) == 1 and zipped[0].get('sha256') == digest(compressed) and zipped[0].get('bytes') == len(compressed), 'compressed gate pin mismatch')
            data = gzip.decompress(compressed)
        need(digest(data) == proof['sha256'] and len(data) == proof['bytes'], f'{key} retained bytes mismatch')
    for name, pin in PINNED.items():
        data = read_object(repo, accepted, f'{PLAN}/{name}')
        need(digest(data) == pin and (repo / PLAN / name).read_bytes() == data, f'reviewed plan preimage changed: {name}; obtain bounded review, do not relax the guard')
    need(ledger.get('plan') == f'{PLAN}/plan.json' and ledger.get('plan_sha256') == PINNED['plan.json'], 'live ledger does not bind the reviewed plan')
    need(not (repo / CAPSULE).exists(), 'continuation capsule already exists; refuse repeat adoption')
    return ledger, selected


def check_packet_inputs():
    review_bytes = (HERE.parent / 'root-proposal-review.json').read_bytes()
    proposal_bytes = (HERE.parent / 'decision.json').read_bytes()
    need(digest(review_bytes) == REVIEW_SHA and digest(proposal_bytes) == PROPOSAL_SHA, 'root-reviewed proposal identity changed')
    review = json.loads(review_bytes)
    need(review['subject_sha256'] == PROPOSAL_SHA and review['verdict'] == 'suitable_for_bound_successor_scope_preparation', 'root scope preparation review missing')
    fragment = (HERE / 'scope-amendment.py.fragment').read_bytes()
    compile(fragment, 'scope-amendment.py.fragment', 'exec')
    return review_bytes, proposal_bytes, fragment


def continuation_decision(accepted, selected, ledger_bytes, plan_sha, recorded):
    return {
      'format': 'ushso.pr009-engineering-continuation-controller-amendment.v1',
      'recorded_at': recorded, 'scope_state': 'controller_scope_adopted_pending_independent_applied_metadata_review',
      'accepted_ledger_base_sha': accepted,
      'pr008_head_sha': selected['PR-008']['head_sha'],
      'pr008_merge_sha': selected['PR-008']['merge_sha'],
      'pr008_integration_merge_sha': selected['PR-008']['integration_merge_sha'],
      'merge_basis': 'actual accepted ledger/component-or-bundle identity; individual GitHub observations confer no invented merge SHA',
      'previous_ledger_sha256': digest(ledger_bytes), 'previous_plan_sha256': PINNED['plan.json'], 'plan_sha256': plan_sha,
      'owner_direction': {'quote': BUDGET_QUOTE, 'preference': 'minimize_additional_cost_existing_infrastructure_first', 'numeric_monthly_budget': None, 'numeric_budget_state': 'owner_deferred', 'paid_resources_authorized': False},
      'engineering_acceptance': {'status': 'pending_independent_check', 'accepted_head_sha': None, 'component_merge_sha': None, 'integration_merge_sha': None},
      'qualification': {'id': 'C-009-1-measured-topology-qualification', 'status': 'unresolved', 'measured_cheapest_new_topology': None, 'original_C_009_1_preserved': True, 'later_evidence_assignments': ['PR-077', 'PR-078'], 'release_recheck': 'PR-082'},
      'bounded_consumer': 'PR-010', 'consumer_readiness_granted': False,
      'pending_interface_reviews': ['PR010-DESCRIPTOR-HASH-PORT', 'PR010-CLI-PATH'],
      'descriptor_hash_basis': 'ushso-canonical-json.v1',
      'disabled_activation_preserved': True, 'rights_recovery_residency_thresholds_unchanged': True,
      'other_PR009_consumers_require_separate_scope_and_interface_review': True,
      'requirements_accepted': [], 'production_change': False, 'publication_performed': False,
      'scope_review': {'path': f'{CAPSULE}/root-proposal-review.json', 'sha256': REVIEW_SHA},
      'historical_proposal': {'path': f'{CAPSULE}/historical-proposal.json', 'sha256': PROPOSAL_SHA, 'unadopted_PR010_implementation_choices_remain_historical_only': True},
      'next_actions': ['Independently review this exact controller metadata and regenerated plan.', 'Bind the PR009 successor and preserve prior handoff/task-binding/evidence before implementation.', 'Independently check exact C-009-2/C-009-3 interfaces and record unresolved C-009-1 before bounded PR010 dispatch.']
    }


def amend_ledger(old, decision):
    new = copy.deepcopy(old)
    new['updated_at'] = decision['recorded_at']
    new['plan_sha256'] = decision['plan_sha256']
    record = {'path': f'{CAPSULE}/decision.json', 'engineering_acceptance': 'pending_independent_check', 'qualification': 'unresolved', 'bounded_consumer': 'PR-010', 'consumer_readiness_granted': False}
    task = next(t for t in new['tasks'] if t['pr_id'] == 'PR-009')
    need('engineering_continuation' not in task and 'pr009_engineering_continuation' not in new['controller'], 'continuation already recorded')
    task['engineering_continuation'] = copy.deepcopy(record)
    new['controller']['pr009_engineering_continuation'] = copy.deepcopy(record)
    new.setdefault('plan_revisions', []).append({'reason': 'Owner-deferred numeric budget and separate PR009 engineering integration from unresolved measured topology qualification', 'previous_plan_sha256': old['plan_sha256'], 'plan_sha256': decision['plan_sha256'], 'changed_prs': CHANGED_PRS, 'dependencies_and_thresholds_unchanged': True, 'scope_counts': {'prs': 86, 'commits': 258}, 'evidence': f'{CAPSULE}/decision.json', 'independent_applied_metadata_review': 'pending'})
    need(not any(x.get('id') == 'INPUT-PR009-NUMERIC-BUDGET' for x in new['external_inputs']), 'budget deferral already recorded')
    new['external_inputs'].append({'id': 'INPUT-PR009-NUMERIC-BUDGET', 'status': 'owner_deferred', 'affected_prs': ['PR-009'], 'numeric_monthly_budget': None, 'evidence': f'{CAPSULE}/decision.json', 'required': 'Minimize additional cost using existing infrastructure first. Numeric budget alone does not block pure engineering. Required measured cost/capacity/recovery/rights qualification remains unresolved; no paid resources are authorized.'})
    return new


def render(repo, accepted, task, output):
    ledger, selected = workspace_guard(repo, accepted, task)
    review, proposal, fragment = check_packet_inputs()
    need(not output.exists(), 'preview destination already exists; preserve prior attempts')
    pause()
    stage = output / 'staged'
    # Copy only the plan and the audit Markdown needed by its exact generators.
    copied = 0
    for directory, markdown_only in [(PLAN, False), ('docs/reviews/2026-09-10-product-data-audit', True)]:
        for source in sorted((repo / directory).rglob('*')):
            if source.is_file() and source.suffix in (('.md',) if markdown_only else ('.py', '.md', '.json')):
                need(not source.is_symlink(), 'unexpected symlink in document-generation inputs')
                data = source.read_bytes(); copied += len(data)
                need(copied <= 16 * 1024 * 1024, 'document stage exceeded bounded copy size')
                write(stage / source.relative_to(repo), data)
    old_source = (repo / PLAN / 'plan-source.py').read_bytes()
    before, extensions = execute_source(old_source)
    after, new_extensions = execute_source(old_source + fragment)
    check_scope(before, after)
    need(extensions == new_extensions, '84+2 extension provenance changed')
    write(stage / PLAN / 'plan-source.py', old_source + fragment)
    for generator in ('build.py', 'validate.py'):
        log = run([sys.executable, '-B', str(stage / PLAN / generator)], stage)
        write(output / (generator + '.stdout'), log)
    # Resolve existing local-link destinations through read-only staging links.
    # The unchanged checker only verifies existence; it never writes targets.
    scan_roots = [stage / PLAN, stage / 'docs/reviews/2026-09-10-product-data-audit']
    for scan_root in scan_roots:
        for page in scan_root.rglob('*.md'):
            text = re.sub(r'```[\s\S]*?```', '', page.read_text())
            for match in re.finditer(r'!?\[[^\]]*\]\(([^\n]+?)\)', text):
                target = match.group(1).strip().strip('<>')
                if re.match(r'^[a-z][a-z0-9+.-]*:', target) or target.startswith('#'):
                    continue
                destination = Path(os.path.abspath(page.parent / target.split('#')[0]))
                need(destination.is_relative_to(stage), 'local link escapes staged repository')
                source = repo / destination.relative_to(stage)
                if destination.exists():
                    if not destination.resolve().is_relative_to(stage):
                        need(source.exists() and source.resolve().is_relative_to(repo) and destination.resolve() == source.resolve(), 'borrowed link resolves to an unexpected repository path')
                else:
                    need(source.exists() and source.resolve().is_relative_to(repo), 'local link destination is absent or foreign')
                    relative(str(destination.relative_to(stage)))
                    pause(); destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.symlink_to(source)
    log = run([sys.executable, '-B', str(stage / PLAN / 'check-links.py')], stage)
    write(output / 'check-links.py.stdout', log)
    for name in ('validation.json', 'link-validation.json'):
        need(json.loads((stage / PLAN / name).read_bytes())['status'] == 'PASS', f'{name} failed')
    new_plan_bytes = (stage / PLAN / 'plan.json').read_bytes()
    old_model = json.loads((repo / PLAN / 'plan.json').read_bytes())
    new_model = json.loads(new_plan_bytes)
    expected_model = copy.deepcopy(old_model)
    source_prs = {p['id']: p for p in after}
    for assignment in expected_model['prs']:
        assignment.update(source_prs[assignment['id']])
    expected_model['source_sha256'] = digest(old_source + fragment)
    need(new_model == expected_model, 'authoritative generator output exceeds the reviewed data delta')
    for path in (stage / PLAN).rglob('*'):
        if path.is_file() and not path.is_symlink():
            rel = str(path.relative_to(stage))
            original = repo / rel
            if rel not in PLAN_OUTPUTS:
                need(original.is_file() and path.read_bytes() == original.read_bytes(), f'unexpected generated change: {rel}')
    recorded = datetime.datetime.now(datetime.timezone.utc).isoformat()
    old_ledger = (repo / LEDGER).read_bytes()
    decision = continuation_decision(accepted, selected, old_ledger, digest(new_plan_bytes), recorded)
    write(stage / LEDGER, encode(amend_ledger(ledger, decision)))
    capsule_files = {'decision.json': encode(decision), 'root-proposal-review.json': review, 'historical-proposal.json': proposal, 'scope-amendment.py.fragment': fragment, 'controller_amendment.py': Path(__file__).read_bytes()}
    for rel in PLAN_OUTPUTS + [LEDGER]:
        capsule_files['prior/' + rel.replace('/', '__') + '.gz'] = gzip.compress((repo / rel).read_bytes(), mtime=0)
    for name, data in capsule_files.items():
        write(stage / CAPSULE / name, data)
    capsule_index = {'format': 'ushso.pr009-controller-amendment-evidence.v1', 'accepted_ledger_base_sha': accepted, 'old_ledger_sha256': digest(old_ledger), 'artifacts': [{'path': f'{CAPSULE}/{name}', 'sha256': digest(data), 'bytes': len(data)} for name, data in sorted(capsule_files.items())], 'applied_metadata_independent_review': 'pending', 'engineering_acceptance': 'pending', 'qualification': 'unresolved'}
    write(stage / CAPSULE / 'index.json', encode(capsule_index))
    allowed = PLAN_OUTPUTS + [LEDGER] + [f'{CAPSULE}/{n}' for n in sorted(capsule_files)] + [f'{CAPSULE}/index.json']
    changes = []
    for rel in allowed:
        old = (repo / rel).read_bytes() if (repo / rel).exists() else None
        new = (stage / rel).read_bytes()
        if old != new:
            changes.append({'path': rel, 'before_sha256': digest(old) if old is not None else None, 'after_sha256': digest(new), 'bytes': len(new)})
    preview = {'format': 'ushso.pr009-controller-amendment-preview.v1', 'accepted_ledger_base_sha': accepted, 'writer_task': task, 'repository': str(repo), 'script_sha256': digest(Path(__file__).read_bytes()), 'fragment_sha256': digest(fragment), 'root_review_sha256': REVIEW_SHA, 'old_ledger_sha256': digest(old_ledger), 'changes': changes, 'scope': 'controller metadata only; no PR009/PR010 implementation, handoff, task binding, acceptance, Git or external mutation', 'qualification': 'unresolved', 'applied': False}
    write(output / 'preview.json', encode(preview))
    print(json.dumps({'status': 'preview_only', 'preview': str(output / 'preview.json'), 'sha256': digest(encode(preview)), 'changed_files': len(changes)}))


def apply(repo, accepted, task, output, expected_preview):
    ledger, selected = workspace_guard(repo, accepted, task)
    review, proposal, fragment = check_packet_inputs()
    preview_bytes = (output / 'preview.json').read_bytes()
    need(digest(preview_bytes) == expected_preview, 'reviewed preview hash mismatch')
    preview = json.loads(preview_bytes)
    need(preview['accepted_ledger_base_sha'] == accepted and preview['writer_task'] == task and preview['repository'] == str(repo), 'preview belongs to a different base/writer/repository')
    need(preview['script_sha256'] == digest(Path(__file__).read_bytes()) and preview['fragment_sha256'] == digest(fragment), 'application script/fragment changed after preview')
    stage = output / 'staged'
    expected_capsule = {f'{CAPSULE}/{n}' for n in ('decision.json', 'root-proposal-review.json', 'historical-proposal.json', 'scope-amendment.py.fragment', 'controller_amendment.py', 'index.json')}
    expected_capsule.update(f'{CAPSULE}/prior/{p.replace("/", "__")}.gz' for p in PLAN_OUTPUTS + [LEDGER])
    allowed = set(PLAN_OUTPUTS + [LEDGER]) | expected_capsule
    paths = [relative(change['path']) for change in preview['changes']]
    need(len(paths) == len(set(paths)) and set(paths) <= allowed and expected_capsule <= set(paths), 'preview changed-file allowlist mismatch')
    need((stage / PLAN / 'plan-source.py').read_bytes() == (repo / PLAN / 'plan-source.py').read_bytes() + fragment, 'staged source is not the exact additive amendment')
    staged_decision = json.loads((stage / CAPSULE / 'decision.json').read_bytes())
    expected_decision = continuation_decision(accepted, selected, (repo / LEDGER).read_bytes(), digest((stage / PLAN / 'plan.json').read_bytes()), staged_decision['recorded_at'])
    need(staged_decision == expected_decision and (stage / LEDGER).read_bytes() == encode(amend_ledger(ledger, expected_decision)), 'staged decision/ledger exceeds the reviewed continuation delta')
    for change in preview['changes']:
        rel = change['path']; target = repo / rel
        need(not any(p.is_symlink() for p in [target, *target.parents] if p.is_relative_to(repo)), 'refuse symlink in write destination')
        data = (stage / rel).read_bytes()
        need(digest(data) == change['after_sha256'] and len(data) == change['bytes'], f'staged output drift: {rel}')
        old = target.read_bytes() if target.exists() else None
        need((digest(old) if old is not None else None) == change['before_sha256'], f'repository preimage drift: {rel}')
    # No Git commands that write metadata, no product tests, no network calls.
    # A pause stops between files; the immutable preview retains every preimage.
    for change in preview['changes']:
        write(repo / change['path'], (stage / change['path']).read_bytes())
        print(json.dumps({'written': change['path']}), flush=True)
    write(output / 'applied.json', encode({'status': 'local_uncommitted_controller_metadata', 'preview_sha256': expected_preview, 'changed_files': paths, 'independent_applied_metadata_review': 'pending', 'engineering_acceptance': 'pending', 'qualification': 'unresolved'}))
    print(json.dumps({'status': 'applied_local_only', 'files': len(paths), 'independent_review': 'pending'}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--accepted-integration-sha', required=True, help='exact clean writer base with committed accepted PR008 live-ledger evidence; may be a metadata descendant of the actual bundle merge')
    parser.add_argument('--task', required=True)
    parser.add_argument('--output', type=Path, required=True, help='new scratch preview directory; existing reviewed preview in apply mode')
    parser.add_argument('--apply-preview-sha256', help='explicit exact preview hash reviewed by root; omission renders only')
    args = parser.parse_args()
    pause()
    need(args.output.is_absolute() and args.output.resolve().is_relative_to(SCRATCH) and args.output.resolve() == args.output, 'output must be an unsymlinked task-owned scratch directory under /mnt/d/tmp/plumbob')
    need(os.path.ismount('/mnt/d'), 'development storage is not mounted')
    if args.apply_preview_sha256:
        apply(args.repo, args.accepted_integration_sha, args.task, args.output, args.apply_preview_sha256)
    else:
        render(args.repo, args.accepted_integration_sha, args.task, args.output)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({'status': 'refused_or_incomplete', 'reason': str(exc), 'action': 'preserve the exact failure and existing preview/local diff; do not relax checks or infer acceptance'}), file=sys.stderr)
        raise SystemExit(2)
