import {requireResearchPython} from './research-python.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {capture} from './refresh.mjs';
import {hash,bindCatalog} from './source-extractors.mjs';
import {verifyDocumentCache} from './document-integrity.mjs';
const exec=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
const base=path.join(root,'packages/retrieval/versions/v1.2.0/corpus');
const evidence='/mnt/d/tmp/plumbob/ushso-research-expansion-20260907/evidence';
const expanded=process.argv.includes('--release-distributions');
const out='/mnt/d/tmp/plumbob/ushso-research-expansion-20260907/'+(expanded?'cms-release-documents':'cms-documents-v2');
await fs.mkdir(out,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(base,'corpus.json')));
const records=[];for(const f of manifest.record_files)records.push(...(await fs.readFile(path.join(base,f),'utf8')).trim().split('\n').map(JSON.parse));
const catalog=JSON.parse(await fs.readFile(path.join(evidence,'captures',hash('https://data.cms.gov/data.json')+'.json')));
if(catalog.url!=='https://data.cms.gov/data.json'||catalog.status!=='captured')throw Error('CATALOG_URL_IDENTITY');
catalog.text=await fs.readFile(path.join(evidence,'captures',catalog.sha256+'.body'),'utf8');
if(hash(catalog.text)!==catalog.sha256)throw Error('CATALOG_HASH');catalog.data=JSON.parse(catalog.text);
async function jsonCapture(url){const file=path.join(out,hash(url)+'.json');try{const o=JSON.parse(await fs.readFile(file));o.text=await fs.readFile(path.join(out,o.sha256+'.body'),'utf8');if(hash(o.text)!==o.sha256)throw Error('HASH');return {...o,data:JSON.parse(o.text)}}catch(e){if(e.code!=='ENOENT')throw e;}
 const o=await capture(url);if(o.text){await fs.writeFile(path.join(out,o.sha256+'.body'),o.text);o.data=JSON.parse(o.text);}const {text,data,...receipt}=o;await fs.writeFile(file,JSON.stringify(receipt));return o;}
const pending=new Map();let downloaded=0;
async function pdf(url){if(pending.has(url))return pending.get(url);const promise=(async()=>{
 const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='data.cms.gov'||u.username||u.password||u.port||u.search||!u.pathname.toLowerCase().endsWith('.pdf'))return {url,status:'blocked_document_url'};
 const receiptFile=path.join(out,hash(url)+'.receipt.json');try{return await verifyDocumentCache(JSON.parse(await fs.readFile(receiptFile)),url,name=>fs.readFile(path.join(out,name)))}catch(e){if(e.code!=='ENOENT')throw e;}
 let result={url,captured_at:new Date().toISOString()};
 try{
  if(downloaded>256*1024*1024)throw Error('TOTAL_PDF_BUDGET');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{accept:'application/pdf','user-agent':'USHSO-MetadataReview/1.0 (+https://ushso.org/contact)'}});
  if(!response.ok||!response.headers.get('content-type')?.includes('pdf')){await response.body?.cancel();throw Error('PDF_HTTP_OR_CONTENT_TYPE:'+response.status)}
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>8*1024*1024)throw Error('PDF_BYTE_LIMIT');chunks.push(chunk)}
  const bytes=Buffer.concat(chunks);downloaded+=bytes.length;if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('PDF_SIGNATURE');
  result={...result,sha256:hash(bytes),bytes:bytes.length,http_status:response.status};
  const file=path.join(out,result.sha256+'.pdf');await fs.writeFile(file,bytes);
  const parsed=await exec(requireResearchPython(), ['-I', fileURLToPath(new URL('./pdf-text.py',import.meta.url)),file],{timeout:20000,maxBuffer:4*1024*1024});
  const data=JSON.parse(parsed.stdout),text=JSON.stringify(data);
  await fs.writeFile(path.join(out,result.sha256+'.text.json'),text);
  result={...result,status:'captured_document',text_sha256:hash(text),parser:data.parser,parser_version:data.version,pages:data.pages.length,text_characters:data.pages.reduce((n,p)=>n+p.text.length,0)};
 }catch(error){result={...result,status:'unavailable_document',error:error.message}}
 await fs.writeFile(receiptFile,JSON.stringify(result,null,2));return result;
})();pending.set(url,promise);return promise;}
const unresolved=expanded?new Set(JSON.parse(await fs.readFile('/mnt/d/tmp/plumbob/ushso-research-expansion-20260907/cms-documents-v2/summary.json')).records_unresolved.map(r=>r.record_id)):null;
const selected=records.filter(r=>r.identity.source.source_id==='cms-data-catalog'&&(!expanded||unresolved.has(r.record_id))),results=[];let index=0;
async function worker(){while(index<selected.length){const r=selected[index++];const result={record_id:r.record_id,source_native_id:r.identity.match_fields.source_id,record_sha256:hash(JSON.stringify(r)),generation:manifest.publication.generation,documents:[],issues:[],publication_authorized:false,review_status:'pending_owner_review'};
 try{
  const {row,pointer}=bindCatalog(r,catalog),id=r.identity.match_fields.source_id;
  const distributions=Array.isArray(row.distribution)?row.distribution:[];
  const uuid=id.match(/\/dataset\/([a-f0-9-]+)\/data-viewer$/)?.[1];
  if(!uuid)throw Error('SOURCE_IDENTIFIER_FORMAT');
  const bound=distributions.map((d,i)=>({d,i})).filter(({d})=>(expanded?typeof d.downloadURL==='string':d.accessURL===`https://data.cms.gov/data-api/v1/dataset/${uuid}/data`)&&typeof d.resourcesAPI==='string');
  if(!bound.length||(!expanded&&bound.length!==1))throw Error('EXACT_DISTRIBUTION_BINDING_UNAVAILABLE');
  result.bindings=[];
  for(const {d,i} of bound){
  const resourceUrl=d.resourcesAPI;
  if(expanded?!/^https:\/\/data\.cms\.gov\/data-api\/v1\/dataset-resources\/[a-f0-9-]+$/.test(resourceUrl):resourceUrl!==`https://data.cms.gov/data-api/v1/dataset-resources/${uuid}`)throw Error('RESOURCE_ROUTE_IDENTITY');
  const resources=await jsonCapture(resourceUrl);
  if(resources.status!=='captured'||resources.data?.links?.self?.href!==resourceUrl||!Array.isArray(resources.data.data))throw Error('RESOURCE_RESPONSE_IDENTITY');
  result.binding={catalog_sha256:catalog.sha256,identifier_pointer:pointer+'/identifier',distribution_pointer:`${pointer}/distribution/${i}`,distribution:d,resources_url:resourceUrl,resources_sha256:resources.sha256};
  result.bindings.push(result.binding);
  const docs=resources.data.data.map((doc,j)=>({doc,j})).filter(({doc})=>/dictionary|methodolog|limitation|technical correction/i.test(doc.name??''));
  result.document_candidates=(result.document_candidates??0)+docs.length;
  if(docs.length>3)result.issues.push({code:'DOCUMENT_LIMIT',distribution_pointer:result.binding.distribution_pointer,candidates:docs.length,attempted:3});
  for(const {doc,j} of docs.slice(0,3)){
   if(typeof doc.downloadURL!=='string'){result.issues.push({code:'DOCUMENT_URL_MISSING',resources_pointer:`/data/${j}`});continue;}
   const captured=await pdf(doc.downloadURL);
   if(captured.status==='blocked_document_url')result.issues.push({code:'DOCUMENT_FORMAT_OR_URL_PENDING',url:doc.downloadURL,resources_pointer:`/data/${j}`});
   const evidence={...captured,publisher_title:doc.name,resources_pointer:`/data/${j}`,release_binding:result.binding,role:/dictionary/i.test(doc.name)?'dictionary':'methodology_or_limitations'};
   if(captured.status==='captured_document'){
    const data=JSON.parse(await fs.readFile(path.join(out,captured.sha256+'.text.json')));
    evidence.passages=[];
    for(const page of data.pages){const lines=page.text.split('\n');for(let line=0;line<lines.length;line++)if(/each (row|record)|unit of (analysis|observation)|represent[s]? (a |an |one )|reporting period|fiscal year|calendar year|geographic|county|counties|limitation|caution|restricted|suppres|data use agreement|no (fee|charge)|not (include|represent)|cost report/i.test(lines[line]))evidence.passages.push({page:page.page,line:line+1,quote:lines.slice(Math.max(0,line-1),line+3).join('\n'),review_status:'pending_owner_review'});}
   evidence.passages=evidence.passages.slice(0,60);
    evidence.passages=evidence.passages.map(p=>({...p,matched_line:p.line,quote_start_line:Math.max(1,p.line-1)}));
    evidence.scope='Exact publisher-linked documentation bytes and text; semantic applicability and historical release continuity require review. No payload schema or join execution.';
   }
   result.documents.push(evidence);
  }
  }
  if(result.bindings.length>1)delete result.binding;
 }catch(e){result.issues.push(e.message)}
 results.push(result);await fs.writeFile(path.join(out,hash(r.record_id)+'.record.json'),JSON.stringify(result,null,2));
 if(results.length%10===0)console.log(JSON.stringify({cms_processed:results.length,records:159,documents:results.flatMap(r=>r.documents).filter(d=>d.status==='captured_document').length}));
}}
await Promise.all([worker(),worker()]);
const summary={generated_at:new Date().toISOString(),records:selected.length,processed:results.length,records_with_captured_documents:results.filter(r=>r.documents.some(d=>d.status==='captured_document')).length,records_with_dictionary_documents:results.filter(r=>r.documents.some(d=>d.status==='captured_document'&&d.role==='dictionary')).length,documents_captured:results.flatMap(r=>r.documents).filter(d=>d.status==='captured_document').length,distinct_document_hashes:new Set(results.flatMap(r=>r.documents).filter(d=>d.status==='captured_document').map(d=>d.sha256)).size,release_distribution_bindings:results.reduce((n,r)=>n+(r.bindings?.length??0),0),records_unresolved:results.filter(r=>!r.documents.some(d=>d.status==='captured_document')).map(r=>({record_id:r.record_id,issues:r.issues,document_outcomes:r.documents.map(d=>({url:d.url,status:d.status,error:d.error}))})),pdf_bytes_this_run:downloaded,publication_authorized:false};
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
