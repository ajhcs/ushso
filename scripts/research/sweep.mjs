import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {hash,dimensions,bindCatalog,extractRecord,verifyClaim} from './source-extractors.mjs';
import {capture} from './refresh.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const {values}=parseArgs({options:{out:{type:'string'},cache:{type:'string'},limit:{type:'string',default:'3434'}}});
if(!values.out)throw Error('--out required');
const out=path.resolve(values.out),limit=Number(values.limit);
if(!out.startsWith('/mnt/d/tmp/plumbob/')||!Number.isInteger(limit)||limit<1||limit>3434)throw Error('INVALID_SCOPE');
await fs.mkdir(out,{recursive:true});
if(!(await fs.realpath(out)).startsWith('/mnt/d/tmp/plumbob/'))throw Error('OUTPUT_ESCAPE');
const lock=await fs.open(path.join(out,'.sweep-lock'),'wx');
try{
 await fs.mkdir(path.join(out,'captures'),{recursive:true});await fs.mkdir(path.join(out,'records'),{recursive:true});
 const captureDir=values.cache?await fs.realpath(values.cache):path.join(out,'captures');
 if(!captureDir.startsWith('/mnt/d/tmp/plumbob/'))throw Error('CACHE_ESCAPE');
 const base=path.join(root,'packages/retrieval/versions/v1.2.0/corpus');
 const corpus=JSON.parse(await fs.readFile(path.join(base,'corpus.json')));
 const records=[];for(const file of corpus.record_files)records.push(...(await fs.readFile(path.join(base,file),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse));
 if(records.length!==3434||new Set(records.map(r=>r.record_id)).size!==3434)throw Error('CORPUS_IDENTITY');
 const receipts=new Map(),inflight=new Map();let requests=0,bytes=0;
 async function get(url,catalog=false){
  if(inflight.has(url))return inflight.get(url);
  const p=(async()=>{
   const receiptFile=path.join(captureDir,hash(url)+'.json');
   let o;
   try{o=JSON.parse(await fs.readFile(receiptFile));if(o.url!==url)throw Error('CACHE_IDENTITY');if(o.sha256){o.text=await fs.readFile(path.join(captureDir,o.sha256+'.body'),'utf8');if(hash(o.text)!==o.sha256)throw Error('CACHE_HASH');}}
   catch(e){
    if(e.code!=='ENOENT')throw e;
    if(requests>=5400||bytes>512*1024*1024)return {url,status:'budget_unattempted'};
    requests++;o=await capture(url,{maxBytes:(catalog?32:8)*1024*1024,timeoutMs:20000});bytes+=o.bytes??0;
    if(o.text!==undefined){await fs.writeFile(path.join(captureDir,o.sha256+'.body'),o.text,{flag:'wx'}).catch(async e=>{if(e.code!=='EEXIST'||hash(await fs.readFile(path.join(captureDir,o.sha256+'.body')))!==o.sha256)throw e});}
    const {text,...receipt}=o;await fs.writeFile(receiptFile,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
   }
   if(o.status==='captured')try{o.data=JSON.parse(o.text)}catch{o.status='captured_non_json'}
   receipts.set(url,(({text,data,...rest})=>rest)(o));return o;
  })();inflight.set(url,p);
  const result=await p;
  // Keep only the two shared catalogs in memory. Per-record bodies live on disk.
  if(!catalog)inflight.delete(url);
  return result;
 }
 const cms=await get('https://data.cms.gov/data.json',true),census=await get('https://api.census.gov/data.json',true);
 const queues=Object.fromEntries(['cdc-socrata','cms-data-catalog','census-api'].map(s=>[s,records.filter(r=>r.identity.source.source_id===s)]));
 const selected=[];while(selected.length<limit&&Object.values(queues).some(q=>q.length))for(const q of Object.values(queues)){if(q.length&&selected.length<limit)selected.push(q.shift());}
 const stats={schema:'ushso-completeness.v1',generated_at:new Date().toISOString(),generation:corpus.publication.generation,records:3434,selected:selected.length,processed:0,records_with_proposed_field_improvement:0,field_changes:0,variable_fields:0,variable_fields_with_descriptions:0,variable_fields_with_explicit_units:0,dimensions:{},sources:{},issues:{},approved_updates:0,publication_authorized:false};
 for(const d of dimensions)stats.dimensions[d]={bound_partial:0,bound_supported:0,captured_unbound:0,attempted_unresolved:0,not_attempted:3434-selected.length};
 for(const s of ['cdc-socrata','cms-data-catalog','census-api'])stats.sources[s]={records:records.filter(r=>r.identity.source.source_id===s).length,processed:0,improved:0,dimensions:Object.fromEntries(dimensions.map(d=>[d,0]))};
 stats.baseline={dictionary_records:records.filter(r=>r.variable_documentation?.variables?.length).length,publisher_bounded_time_records:records.filter(r=>r.time_coverage?.state==='bounded').length,observation_grain_supported:0};
 let index=0;
 async function worker(){while(index<selected.length){
  const r=selected[index++],source=r.identity.source.source_id,id=r.identity.match_fields.source_id;
  const captures={};
  try{
   if(source==='cdc-socrata'){
    if(!/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(id))throw Error('INVALID_NATIVE_ID');
    captures.metadata=await get(`https://data.cdc.gov/api/views/${id}.json`);
   }else{
    captures.metadata=source==='cms-data-catalog'?cms:census;
    const {row}=bindCatalog(r,captures.metadata);
    if(source==='census-api'){
     for(const [key,slot] of [['c_variablesLink','variables'],['c_geographyLink','geography']]){
      if(typeof row[key]!=='string')continue;
      const u=new URL(row[key]);
      if(u.hostname!=='api.census.gov'||u.username||u.password||u.port||u.search||!u.pathname.startsWith('/data/')||!u.pathname.endsWith(slot==='variables'?'/variables.json':'/geography.json'))throw Error('INVALID_DOCUMENTATION_ROUTE');
      captures[slot]=await get(row[key].replace(/^http:/,'https:'));
     }
    }else if(typeof row.describedBy==='string'&&row.describedBy.startsWith('https://data.cms.gov/'))captures.documentation=await get(row.describedBy);
   }
  }catch(e){captures.planning_issue=e.message;}
  const result=extractRecord(r,captures,corpus.publication.generation);
  if(captures.planning_issue)result.issues.push({code:captures.planning_issue});
  const evidence=new Map(Object.values(captures).filter(c=>c?.url).map(c=>[c.url,c]));
  const checked=[];
  for(const claim of result.claims)try{verifyClaim(claim,evidence,r,corpus.publication.generation);checked.push(claim)}catch(e){result.issues.push({code:e.message,field:claim.field});}
  result.claims=checked;
  result.captures=Object.fromEntries(Object.entries(captures).map(([k,v])=>[k,typeof v==='string'?v:{url:v.url,status:v.status,sha256:v.sha256??null}]));
  result.diff=checked.map(c=>({operation:'propose',path:c.field==='variable_documentation'?'/variable_documentation':`/research_metadata/${c.field}`,before:c.field==='variable_documentation'?r.variable_documentation??null:null,after:c.value,evidence:c.evidence,scope:c.scope,review_status:c.review_status}));
  // Claim and diff share the values only in memory; retain one full representation.
  const stored={...result,claims:checked.map(({value,...c})=>({...c,value_in_diff_path:c.field==='variable_documentation'?'/variable_documentation':`/research_metadata/${c.field}`}))};
  await fs.writeFile(path.join(out,'records',hash(r.record_id)+'.json'),JSON.stringify(stored)+'\n');
  stats.processed++;stats.sources[source].processed++;stats.field_changes+=checked.length;
  const improved=checked.some(c=>c.status.startsWith('bound_'));
  if(improved){stats.records_with_proposed_field_improvement++;stats.sources[source].improved++;}
  for(const d of dimensions){const cs=checked.filter(c=>c.dimension===d);const relevant=source==='census-api'&&d==='dictionary'?captures.variables:source==='census-api'&&d==='geography'?captures.geography:captures.metadata;const state=cs.some(c=>c.status==='bound_supported')?'bound_supported':cs.some(c=>c.status==='bound_partial')?'bound_partial':cs.length?'captured_unbound':relevant?.status==='budget_unattempted'?'not_attempted':'attempted_unresolved';stats.dimensions[d][state]++;if(state.startsWith('bound_'))stats.sources[source].dimensions[d]++;}
  for(const c of checked.filter(c=>c.field==='variable_documentation')){stats.variable_fields+=c.value.length;stats.variable_fields_with_descriptions+=c.value.filter(v=>v.description&&!v.concept_is_not_variable_definition).length;stats.variable_fields_with_explicit_units+=c.value.filter(v=>v.unit).length;}
  for(const issue of result.issues)stats.issues[issue.code]=(stats.issues[issue.code]??0)+1;
  if(stats.processed%25===0){await fs.writeFile(path.join(out,'progress.json'),JSON.stringify({...stats,requests,bytes},null,2));console.log(JSON.stringify({processed:stats.processed,selected:stats.selected,improved:stats.records_with_proposed_field_improvement,requests,bytes}));}
  await new Promise(resolve=>setTimeout(resolve,100));
 }}
 await Promise.all([worker(),worker(),worker()]);
 stats.generated_at=new Date().toISOString();stats.requests_this_run=requests;stats.response_bytes_this_run=bytes;
 stats.capture_directory=captureDir;
 stats.http_outcomes=Object.fromEntries([...new Set([...receipts.values()].map(r=>r.status))].map(s=>[s,[...receipts.values()].filter(r=>r.status===s).length]));
 stats.captures=[...receipts.values()].map(({url,status,sha256})=>({url,status,sha256}));
 await fs.writeFile(path.join(out,'completeness.json'),JSON.stringify(stats,null,2)+'\n');
 console.log(JSON.stringify({...stats,captures:stats.captures.length},null,2));
}finally{await lock.close();await fs.unlink(path.join(out,'.sweep-lock'));}
