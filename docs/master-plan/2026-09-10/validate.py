"""Structural verification of the work plan; not product/engineering acceptance."""
import collections, hashlib, json, pathlib
ROOT=pathlib.Path(__file__).parent
m=json.loads((ROOT/'plan.json').read_text())
errors=[]
def check(condition,message):
    if not condition:errors.append(message)
prs={p['id']:p for p in m['prs']};subs={s['id']:s for s in m['subphases']};phases={p['id']:p for p in m['phases']}
reqs={r['id'] for r in m['requirements']};findings=set(m['finding_ids'])
check(len(prs)==len(m['prs']),'duplicate PR IDs')
check(len(subs)==len(m['subphases']),'duplicate sub-phase IDs')
check(len(phases)==len(m['phases']),'duplicate phase IDs')
check(set(prs)=={f'PR-{i:03}' for i in range(1,85)},'initial PR sequence must be exactly 001–084; revise validator intentionally when extending scope')
check(m['source_sha256']==hashlib.sha256((ROOT/'plan-source.py').read_bytes()).hexdigest(),'source/model drift')
commit_ids=[];mapped_reqs=set();mapped_findings=set()
for p in prs.values():
    check(p['phase'] in phases,p['id']+' missing phase')
    check(p['subphase'] in subs,p['id']+' missing subphase')
    check(p['phase']==subs[p['subphase']]['phase'],p['id']+' cross-parent mismatch')
    check(sum(p['id'] in s['prs'] for s in subs.values())==1,p['id']+' must have exactly one subphase parent')
    check(len(p['dependencies'])==len(set(p['dependencies'])),p['id']+' duplicate dependencies')
    check(all(d in prs and d!=p['id'] for d in p['dependencies']),p['id']+' invalid dependency')
    check(bool(p['outcome'] and p['files'] and p['acceptance']),p['id']+' missing scope/outcome/acceptance')
    check(set(p['requirements'])<=reqs,p['id']+' unknown requirement')
    check(set(p['findings'])<=findings,p['id']+' unknown finding')
    check(bool(p['requirements'] and p['findings']),p['id']+' must map to a requirement and audit finding')
    mapped_reqs.update(p['requirements']);mapped_findings.update(p['findings'])
    check(len(p['commits'])==3,p['id']+' expected three bounded commits')
    text=(ROOT/'prs'/(p['id']+'.md')).read_text()
    for c in p['commits']:
        commit_ids.append(c['id'])
        check(all(c.get(k) for k in ['id','subject','instructions','verification']),p['id']+' incomplete commit instruction')
        check(c['id'] in text and c['instructions'] in text and c['verification'] in text,p['id']+' packet/source mismatch')
    check(p['outcome'] in text,p['id']+' packet missing outcome')
    check(all(d in text for d in p['dependencies']),p['id']+' packet missing dependencies')
    check(all(c in text for c in p['check_commands']),p['id']+' packet missing planned check command')
for s in subs.values():
    check(len(s['prs'])==3,s['id']+' expected three PRs')
    check(sum(s['id'] in p['subphases'] for p in phases.values())==1,s['id']+' must have exactly one phase parent')
    check(bool(s['outcome']),s['id']+' missing outcome')
check(len(commit_ids)==len(set(commit_ids)),'commit IDs not unique')
check(mapped_reqs==reqs,'uncovered requirements: '+str(reqs-mapped_reqs))
check(mapped_findings==findings,'uncovered findings: '+str(findings-mapped_findings))
visiting=set();visited=set();order=[]
def visit(pid):
    if pid in visiting:errors.append('dependency cycle at '+pid);return
    if pid in visited:return
    visiting.add(pid)
    for dep in prs[pid]['dependencies']:
        if dep in prs:visit(dep)
    visiting.remove(pid);visited.add(pid);order.append(pid)
for pid in prs:visit(pid)
ancestors=set()
def ancestors_of(pid):
    if pid in ancestors:return
    ancestors.add(pid)
    for d in prs[pid]['dependencies']:ancestors_of(d)
if not errors:ancestors_of(m['terminal_pr'])
check(ancestors==set(prs),'some PRs do not contribute transitively to final acceptance')
# Prevent the important incomplete-cohort error found in the planning review.
check({'PR-043','PR-044','PR-045','PR-054'}<=set(prs['PR-042']['dependencies']),'core qualification must consume expansion and MRF evidence')
receipt={'format':'ushso.plan-structure-validation.v1','status':'PASS' if not errors else 'FAIL','scope':'Structural hierarchy, graph, traceability and packet synchronization only; not scientific correctness, user acceptance, implementation status or release permission.','counts':{'phases':len(phases),'subphases':len(subs),'prs':len(prs),'atomic_commits':len(commit_ids),'requirements':len(reqs),'audit_findings':len(findings)},'plan_sha256':hashlib.sha256((ROOT/'plan.json').read_bytes()).hexdigest(),'errors':errors,'topological_order':order}
(ROOT/'validation.json').write_text(json.dumps(receipt,indent=2)+'\n')
(ROOT/'VALIDATION.md').write_text('# Plan verification\n\nStatus: **'+receipt['status']+'**.\n\n'+receipt['scope']+'\n\n'+json.dumps(receipt['counts'])+'\n\nChecked unique parents and IDs, complete commit instructions/checks, dependency references and acyclicity, full requirement/finding coverage, a path from every PR to final acceptance, and generated PR packet contents.\n\nThe core-cohort qualification dependency was corrected to include the source-expansion and MRF work; its earlier modeling and example work can proceed in parallel. A valid graph does not prove empirical product targets.\n\nReproduce with:\n\n```bash\npython3 docs/master-plan/2026-09-10/build.py\npython3 docs/master-plan/2026-09-10/validate.py\n```\n\n[Machine-readable receipt](validation.json).\n')
print(json.dumps({k:v for k,v in receipt.items() if k!='topological_order'}))
raise SystemExit(bool(errors))
