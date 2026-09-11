import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const R='/mnt/d/worktrees/plumbob/ushso-research-program-20260910',S='/mnt/d/tmp/plumbob/ushso-research-program-20260910';
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=(...a)=>{const x=spawnSync('git',a,{cwd:R,encoding:'utf8'});assert.equal(x.status,0);return x.stdout.trim();};
const head=git('rev-parse','HEAD');assert.equal(head,'3355015bc056ba3fdfddfdd4381a984c0d189aef');assert.equal(git('status','--porcelain'),'');
const {validateCatalogRecords}=await import(pathToFileURL(path.join(R,'packages/retrieval/tools/catalog-contract.mjs')));
const dir=path.join(R,'packages/retrieval/versions/v1.2.0/corpus');const records=[],inputFiles=[];
for(const filename of (await fs.readdir(dir)).filter(x=>/^records-\d+\.jsonl$/.test(x)).sort()){
 const file=path.join(dir,filename),bytes=await fs.readFile(file);records.push(...bytes.toString().trim().split(/\r?\n/).map(JSON.parse));inputFiles.push({path:path.relative(R,file),bytes:bytes.length,sha256:sha(bytes)});
}
const validated=validateCatalogRecords(records);assert.equal(records.length,3434);assert.equal(validated.valid.length,3430);assert.equal(validated.invalid.length,4);
const byId=new Map(records.map(x=>[x.record_id,x]));
const isolated=validated.invalid.map(issue=>{const record=byId.get(issue.record_id);return {...issue,title:record.title,source_id:record.identity.source.source_id,source_native_id:record.identity.match_fields.source_id,authoritative_url:record.authoritative_url,description:record.description,record_sha256:sha(JSON.stringify(record)),evidence_ids:record.evidence.map(x=>x.evidence_id),provenance:record.provenance.map(x=>({kind:x.kind,locator:x.locator,content_sha256:x.content_sha256}))};});
const paths=['packages/retrieval/tools/catalog-contract.mjs','packages/retrieval/schemas/browser-record.schema.json','apps/web/src/data/facets.ts','apps/web/src/data/facets.test.ts','apps/web/src/components/FacetSidebar.tsx','apps/web/src/lib/catalogAdapter.ts','apps/web/src/types/catalog.ts'];
const pins=[];for(const p of paths){const b=await fs.readFile(path.join(R,p));pins.push({path:p,sha256:sha(b),bytes:b.length});}
const report={format:'ushso.pr006-readonly-readiness-preparation.v1',at:new Date().toISOString(),head,tree:git('rev-parse','HEAD^{tree}'),source_generation:'live-2026-09-03-85b50522b420',classification:{total:records.length,searchable:validated.valid.length,isolated:validated.invalid.length},isolated,input_files:inputFiles,path_pins:pins,scope_gaps_to_resolve_before_dispatch:['Existing apps/web/src/data/facets.test.ts is outside PR006 packet scope.','New meaningful isolated-record/facet regression test paths need explicit ownership before implementation.','Review whether API-provided facet labels and availability flow through catalogAdapter rather than the fallback-only buildFacetSections path; authorize an exact adapter/type delta only if necessary.','If a versioned missing-description state requires browser schema changes, resolve that exact schema path before editing.'],dependency_status:'PR004 accepted; PR005 is under correction and not accepted. No PR006 dispatch authorized by this preparation.',implementation_changed:false,record_migration_performed:false,accepted:false};
assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('status','--porcelain'),'');for(const p of inputFiles)assert.equal(sha(await fs.readFile(path.join(R,p.path))),p.sha256);
await fs.writeFile(path.join(S,'pr006-readonly-readiness-preparation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({head,counts:report.classification,isolated:isolated.map(x=>({id:x.record_id,errors:x.errors})),dispatch_allowed:false}));
