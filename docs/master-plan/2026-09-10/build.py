"""Generate the PR work model, index and individual assignment packets."""
import hashlib, json, pathlib, runpy
ROOT=pathlib.Path(__file__).parent
namespace=runpy.run_path(str(ROOT/'plan-source.py'))
prs=namespace['PRS']
phase_specs=[
 ('P1','Establish source truth','One baseline, accurate evidence states and versioned source identities.',['1A','1B','1C']),
 ('P2','Programmatic evidence','Every baseline record has an evidenced processing disposition.',['2A','2B','2C','2D']),
 ('P3','Residual AI and publication','Evaluated low-cost proposals become accepted, reproducible metadata.',['3A','3B','3C']),
 ('P4','Research usefulness','Scientific semantics, linkage and retrieval support complete research tasks. Full core qualification consumes P5 intake.',['4A','4B','4C','4D']),
 ('P5','Coverage and MRFs','Missing source families and hospital/payer price files have usable routes.',['5A','5B','5C','5D']),
 ('P6','Machine product','All enabled tools have real positive research paths and honest limitations.',['6A','6B','6C']),
 ('P7','Human product','Beginners and experts can understand, compare, use and cite sources.',['7A','7B','7C','7D']),
 ('P8','Operate and qualify','The exact reviewed product operates sustainably and is independently accepted.',['8A','8B','8C'])]
sub_specs={
 '1A':('Baseline and acceptance','Exact baseline plus fixed success criteria and review protocol.'),
 '1B':('Truth repairs','Accurate field states, freshness, inference labels and catalog dispositions.'),
 '1C':('Versioned source model','Bound product/release/distribution/field identities and storage rules.'),
 '2A':('Durable collection','Resumable jobs with bounded transport, quotas and useful failures.'),
 '2B':('Source adapters','Evidence-backed CMS, CDC and Census metadata extraction.'),
 '2C':('Documents and keys','Parser coverage, exact wire-name mappings and literal field meanings.'),
 '2D':('Samples and full inventory','Bounded tested examples plus complete baseline attempt accounting.'),
 '3A':('Provider and cost controls','Exact model routing, eligible inputs and atomic spend controls.'),
 '3B':('Extraction and evaluation','Bounded evidence tasks and independently evaluated claim proposals.'),
 '3C':('Review and publication','Exact claim decisions and coherent reversible public generations.'),
 '4A':('Scientific semantics','Grain, dates, measurements and useful evidence-backed source cards.'),
 '4B':('Linkage','Typed identifiers, authoritative crosswalks and qualified join routes.'),
 '4C':('Retrieval','Named-source/family resolution, scientific relevance and current evaluation.'),
 '4D':('Priority-cohort workflows','Core readiness, reproducible examples and scientific qualification after expansion.'),
 '5A':('Missing source families','Twelve priority families with documented product and access scope.'),
 '5B':('Hospital MRFs','Hospital locators plus bounded versioned JSON and CSV parsing.'),
 '5C':('Payer MRFs','Payer indexes, rate samples and provider-reference context.'),
 '5D':('Pricing product','Price semantics, discoverable profiles and qualified research examples.'),
 '6A':('Source and dictionary APIs','Actual contexts, routes and variables on enabled machine operations.'),
 '6B':('Client contracts','Consistent schemas, useful recovery and clean MCP installation.'),
 '6C':('Research packet and qualification','Comparison/planning and actual cross-transport acceptance.'),
 '7A':('Navigation and source detail','Plain-language discovery and useful source/variable pages.'),
 '7B':('Research workflow','Shortlist, comparisons and reproducible citation/evidence exports.'),
 '7C':('Guides and accountability','Beginner/expert/developer teaching and truthful public disclosures.'),
 '7D':('Frontend qualification','Accessible, responsive and independently reviewed final product.'),
 '8A':('Refresh and capacity','Operating schedules, measured costs and tested recovery.'),
 '8B':('Independent acceptance','Data, human-use and evidence closure with no hidden deficits.'),
 '8C':('Release and observation','Exact artifact qualification, authorized rollout and sustained verification.')}
reqs={
 'R01':'Every catalog record accounted for','R02':'Accurate evidence labels','R03':'Every record has a test disposition',
 'R04':'100-product core readiness','R05':'Contextual variable meaning','R06':'Broader dictionary extraction yield',
 'R07':'Measured research retrieval','R08':'Fifteen qualified join routes','R09':'Twelve missing source families',
 'R10':'Hospital and payer MRF pilot','R11':'Machine/human parity','R12':'Novice and advanced task completion',
 'R13':'Usable teaching and reference content','R14':'Controlled economical AI','R15':'Sustainable refresh','R16':'Independent exact release qualification'}
phases=[dict(id=i,title=t,outcome=o,subphases=s) for i,t,o,s in phase_specs]
subs=[dict(id=i,phase='P'+i[0],title=t,outcome=o,prs=[p['id'] for p in prs if p['subphase']==i]) for i,(t,o) in sub_specs.items()]
for p in prs:
    p['owner_role']='Astra' if p['id'] in ['PR-075','PR-079','PR-081','PR-082','PR-083','PR-084'] else 'Luna Max, Grok or DeepSeek; assign one owner at dispatch'
    p['reviewer_role']=('Astra verifies the final candidate; a separate reviewer or owner reviews any substantive code Astra authored' if p['owner_role']=='Astra' else 'Astra; named human domain/owner decision when required')
    p['status']='planned'
    p['evidence_directory']='verification/research-program/'+p['id'].lower()+'/'
    p['verification_scope']='Use the existing affected package tests plus the specific fixtures described below. Add meaningful regression/integration tests for behavior changes; documentation-only commits use link, schema or artifact checks. Full npm test/build/cf:dry-run run at the integration/release gate.'
    p['check_commands']=['node --test '+f for f in p['files'] if f.endswith('.test.mjs')]
    if any(f.startswith('apps/web/src/') for f in p['files']):p['check_commands'].append('npm run test:web')
    if any(f.startswith('packages/retrieval/') for f in p['files']):p['check_commands'].append('npm run test:retrieval')
    if any(f.startswith('worker/') for f in p['files']):p['check_commands'].append('npm run test:worker')
    if p['id'] in ['PR-007','PR-008']:p['check_commands'].extend(['npm test --prefix packages/identity','npm run validate --prefix packages/identity'])
    if p['id']=='PR-008':p['check_commands'].extend(['npm run validate --prefix contracts/machine-toolkit/v1.2.0','npm run test:contracts','node --test tests/contract-package-inventory.test.mjs'])
    if p['id']=='PR-086':p['check_commands'].extend(['node scripts/verify-wp11-attestation.mjs','node scripts/run-contract-suites.mjs --suite wp11'])
model=dict(format='ushso.research-master-plan.v1',date='2026-09-10',status='proposed_not_implemented',
 mission='Help humans and AI find, understand and obtain tested routes to US health-systems data.',
 source_sha256=hashlib.sha256((ROOT/'plan-source.py').read_bytes()).hexdigest(),
 requirements=[dict(id=k,outcome=v) for k,v in reqs.items()],finding_ids=[f'F{i:02}' for i in range(1,34)],
 phases=phases,subphases=subs,prs=prs,terminal_pr='PR-084',scope_extensions=namespace.get('PLAN_EXTENSIONS',[]))
(ROOT/'plan.json').write_text(json.dumps(model,indent=2)+'\n')
(ROOT/'prs').mkdir(exist_ok=True)
index=['# PR index','', 'Generated from `plan-source.py` by `build.py`. The source, index and PR packets describe planned work; none is a claimed implementation.', '',
 'Use [the execution protocol](EXECUTION.md) with every packet. A PR is ready when its listed dependencies have merged and its required external facts/permissions exist. Phase numbers describe capabilities; they are not a forced serial schedule. PR-042 deliberately consumes completed P5 intake because the core cohort includes those sources.', '']
for phase in phases:
    index += ['## '+phase['id']+' — '+phase['title'],'',phase['outcome'],'']
    for sub in [s for s in subs if s['phase']==phase['id']]:
        index += ['### '+sub['id']+' — '+sub['title'],'',sub['outcome'],'','| PR | Outcome | Dependencies |','|---|---|---|']
        for p in [p for p in prs if p['subphase']==sub['id']]:
            deps=', '.join(p['dependencies']) if len(p['dependencies'])<12 else 'PR-001 through PR-081'+(' plus '+', '.join(d for d in p['dependencies'] if d not in {f'PR-{i:03}' for i in range(1,82)}) if any(d not in {f'PR-{i:03}' for i in range(1,82)} for d in p['dependencies']) else '')+' (all required work before release)'
            index.append(f"| [{p['id']}: {p['title']}](prs/{p['id']}.md) | {p['outcome']} | {deps or 'None'} |")
        index.append('')
    index+=['Sub-phase closure rule: every listed PR is merged, independently reviewed and its acceptance evidence exists; a sub-phase cannot close from implementation status alone.','']
(ROOT/'PR-INDEX.md').write_text('\n'.join(index).rstrip()+'\n')
for p in prs:
    deps=', '.join(p['dependencies']) or 'None; start here.'
    base_instruction=('Resolve the current release subject and prepare its isolated worktree before writing or committing; PR-001 establishes the integration base.' if p['id']=='PR-001' else 'Start from the merged integration SHA selected in PR-001, not the stale original workspace.')
    content=[f"# {p['id']} — {p['title']}",'',f"Phase **{p['phase']}**, sub-phase **{p['subphase']}**. Status: planned.",'',p['outcome'],'',
      f"**Dependencies:** {deps}",'',f"**Implementer:** {p['owner_role']}. **Reviewer:** {p['reviewer_role']}.",'',
      f"**Acceptance requirements:** {', '.join(p['requirements'])}. **Audit findings:** {', '.join(p['findings'])}.",'',
      '## Before editing','', 'Read [EXECUTION.md](../EXECUTION.md), the dependency handoffs and the current repository instructions. '+base_instruction+' Confirm the paths below in that release; create a new path only when it is named here. If an existing package supplies the required behavior, extend it instead of creating a parallel subsystem.','',
      '**Owned scope:**','',*['- `'+f+'`' for f in p['files']],'',
      'If a shared contract or another owner’s file must change, record the proposed interface change and resolve ownership before editing it. Keep each commit independently understandable and passing the checks appropriate to that change.','',
      '## Atomic commits','']
    for c in p['commits']:
        content += [f"### {c['id']} — {c['subject']}",'',c['instructions'],'','**Verify:** '+c['verification'],'']
    content += ['## PR acceptance','',*['- '+a for a in p['acceptance']],'',p['verification_scope'],'']
    if p['check_commands']:
        content += ['Run these commands from the isolated repository root after implementing the specified tests. They are planned verification commands, not checks executed by this planning task:','', '```bash',*p['check_commands'],'```','']
    content += [
      'The implementation must demonstrate the behavior above using actual fixtures or retained execution evidence. A source capture is not a payload test; a passing schema is not scientific approval; a successful tool envelope is not a completed research task.','',
      '## Handoff and independent review','',
      f"Write the sanitized evidence index under `{p['evidence_directory']}` and the task-specific handoff under `docs/research-program/handoffs/{p['id']}.json`. Follow the [handoff template](../templates/handoff.json). Include exact base/head and dependency SHAs; commands with exit statuses; fixtures and expected/actual results; changed public behavior; source/generation identity; artifact hashes; failures; remaining questions; and the next consumer.",'',
      'Push the task branch to GitHub and open/update a draft PR using the [PR body template](../templates/pr-body.md). Do not mark it ready until producer checks and handoff validation pass. Astra independently inspects the diff and replays the decisive acceptance checks; producer logs alone are not approval. Retain a failing result when blocked and identify the exact missing input. Do not auto-merge or deploy.','']
    (ROOT/'prs'/(p['id']+'.md')).write_text('\n'.join(content))
trace=['# Requirement and finding traceability','', '| Requirement | Outcome | Implementing/qualifying PRs |','|---|---|---|']
for k,v in reqs.items():trace.append(f"| {k} | {v} | "+', '.join(p['id'] for p in prs if k in p['requirements'])+' |')
trace+=['','| Finding | Addressed by |','|---|---|']
for fid in model['finding_ids']:trace.append('| '+fid+' | '+', '.join(p['id'] for p in prs if fid in p['findings'])+' |')
(ROOT/'TRACEABILITY.md').write_text('\n'.join(trace)+'\n')
print(json.dumps({'phases':len(phases),'subphases':len(subs),'prs':len(prs),'commits':sum(len(p['commits']) for p in prs)}))
