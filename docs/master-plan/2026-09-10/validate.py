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
initial_prs={f'PR-{i:03}' for i in range(1,85)}
check(set(prs)==initial_prs|{'PR-085','PR-086'},'declared scope must contain initial PR-001–084 plus bounded remediations PR-085 and PR-086; revise intentionally for later extensions')
extensions=m.get('scope_extensions',[])
check(len(extensions)==2 and extensions[0].get('id')=='PR-085' and extensions[0].get('parent_pr')=='PR-001' and extensions[0].get('kind')=='bounded_ci_remediation' and bool(extensions[0].get('trigger')) and bool(extensions[0].get('reason')),'missing exact PR-085 extension provenance')
check('PR-085' in prs.get('PR-082',{}).get('dependencies',[]),'release qualification must consume the CI remediation')
check(extensions[1].get('id')=='PR-086' and extensions[1].get('parent_pr')=='PR-005' and extensions[1].get('kind')=='bounded_wp11_current_input_remediation' and bool(extensions[1].get('trigger')) and bool(extensions[1].get('reason')) and bool(extensions[1].get('independent_design_review_sha256')),'missing exact PR-086 extension provenance')
check(set(prs.get('PR-086',{}).get('dependencies',[]))=={'PR-003','PR-085'},'PR086 requires accepted protocol and attestation foundations')
check(all('PR-086' in prs.get(p,{}).get('dependencies',[]) for p in ['PR-005','PR-082']),'PR005 integration and release qualification must consume the current-input remediation')
check(m['source_sha256']==hashlib.sha256((ROOT/'plan-source.py').read_bytes()).hexdigest(),'source/model drift')
check({'scripts/research-program/operating-bounds.mjs','scripts/research-program/receipts/v1.0.0/evidence-receipt.schema.json','tests/research-program/operating-bounds.test.mjs','tests/research-program/fixtures/pr009-census-negative/'}<=set(prs.get('PR-009',{}).get('files',[])),'PR009 must own its standalone receipt and replay fixture')
check(not any(f.startswith(('packages/connectors/','packages/ingestion/','contracts/ingestion/','verification/wp5/')) for f in prs.get('PR-009',{}).get('files',[])),'PR009 must reuse existing execution packages and preserve released evidence bytes')
check({'apps/web/src/providers/discoveryProvider.ts','apps/web/src/pages/SearchResultsPage.tsx','tests/research-program/isolation-and-facets.test.mjs','tests/direct-base-regression.test.mjs','packages/retrieval/tests/lexical-index.test.mjs'}<=set(prs.get('PR-006',{}).get('files',[])),'PR006 must own the real live/fallback path and label-only differential checks')
check(not {'packages/coverage/','packages/retrieval/schemas/discovery-result.schema.json','tests/fixtures/direct-base-control.mjs','packages/retrieval/fixtures/retrieval-core-before-lexical-index.txt'}&set(prs.get('PR-006',{}).get('files',[])),'PR006 must preserve frozen contracts/reference engines and reuse existing completeness accounting')
check({'contracts/machine-toolkit/v1.2.0/schemas/variable-identity.schema.json','packages/identity/manifests/package-manifest.json','packages/identity/validation/validation-receipt.json'}<=set(prs.get('PR-008',{}).get('files',[])),'PR008 must own its additive schema and current identity seal')
check('contracts/machine-toolkit/' not in prs.get('PR-008',{}).get('files',[]),'PR008 must not own frozen machine contracts through a blanket directory scope')
check('tests/subject-shortcircuit.test.mjs' in prs['PR-006']['files'],'PR006 must retain label-only subject parity coverage')
check({'contracts/machine-toolkit/v1.2.0/package.json','contracts/machine-toolkit/v1.2.0/README.md','contracts/machine-toolkit/v1.2.0/tools/verify.mjs','contracts/machine-toolkit/v1.2.0/tests/variable-identity.test.mjs','package-lock.json'}<=set(prs['PR-008']['files']),'PR008 must own complete bounded variable package and additive lock metadata')
check(not {'package.json','scripts/run-contract-suites.mjs','scripts/verify-wp11-attestation.mjs','tests/wp11-attestation.test.mjs'}&set(prs['PR-008']['files']),'PR008 package completion cannot alter root scripts or WP11 evidence authority')
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
    check(len(set(s['prs'])&initial_prs)==3,s['id']+' must retain its three initial PRs')
    check(set(s['prs'])-initial_prs==({'PR-085','PR-086'} if s['id']=='1A' else set()),s['id']+' has an undeclared extension')
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
