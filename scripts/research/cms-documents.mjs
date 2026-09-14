import {requireResearchPython} from './research-python.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { createHash } from 'node:crypto';
import {capture} from './refresh.mjs';
import {hash,bindCatalog} from './source-extractors.mjs';
import {verifyDocumentCache, verifyRetainedArtifact} from './document-integrity.mjs';
import { classifyCmsReleaseLocators } from '../../packages/connectors/src/adapters/cms.mjs';
import { classifyResourceRole, classifyResponse } from '../../packages/connectors/src/content-classifier.mjs';

export const CMS_SOURCE_ID = 'cms-data-catalog';
export const HOSPITAL_COST_REPORT_ID =
  'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data-viewer';

const HEX = /^[a-f0-9]{64}$/;

export function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function assertNoLiveNetwork(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl === 'function' && fetchImpl !== blockedFetch) {
    throw Object.assign(new Error('CMS_RESOURCES_LIVE_NETWORK_FORBIDDEN'), { code: 'CMS_RESOURCES_LIVE_NETWORK_FORBIDDEN' });
  }
}

export async function blockedFetch() {
  const error = new Error('CMS_RESOURCES_LIVE_NETWORK_FORBIDDEN');
  error.code = 'CMS_RESOURCES_LIVE_NETWORK_FORBIDDEN';
  throw error;
}

export function cmsCorpusRecords(records) {
  if (!Array.isArray(records)) throw Error('CMS_CORPUS_RECORDS_INVALID');
  const selected = records.filter((record) => record?.identity?.source?.source_id === CMS_SOURCE_ID);
  const ids = selected.map((record) => record?.identity?.match_fields?.source_id);
  if (ids.some((id) => typeof id !== 'string' || id.length === 0)) throw Error('CMS_CORPUS_IDENTITY_INVALID');
  if (new Set(ids).size !== ids.length) throw Error('CMS_CORPUS_IDENTITY_DUPLICATE');
  return selected;
}

export function retainedCatalogCapture({ url, status, sha256, text, data, httpStatus = 200, contentType = 'application/json' }) {
  if (url !== 'https://data.cms.gov/data.json') throw Error('CATALOG_URL_IDENTITY');
  if (status !== 'captured') throw Error('CATALOG_CAPTURE_UNAVAILABLE');
  if (typeof text === 'string') {
    if (!HEX.test(sha256) || sha256Text(text) !== sha256) throw Error('CATALOG_HASH');
    data = JSON.parse(text);
  }
  if (!data || !Array.isArray(data.dataset)) throw Error('CATALOG_SHAPE');
  return Object.freeze({
    url,
    status,
    sha256,
    http_status: httpStatus,
    content_type: contentType,
    data,
    payload_success: false,
    publication_authorized: false
  });
}

function pointer(root, index, field) {
  return field ? `${root}/${index}/${field}` : `${root}/${index}`;
}

function captureIdentity({ catalogSha256, locator, resourceSha256 = null }) {
  return sha256Text(JSON.stringify({ catalogSha256, locator, resourceSha256 }));
}

export function classifyCmsDistributionCandidate(distribution, { catalogPointer, catalogSha256, index }) {
  const format = typeof distribution?.format === 'string' ? distribution.format : null;
  const mediaType = typeof distribution?.mediaType === 'string' ? distribution.mediaType : null;
  const title = typeof distribution?.title === 'string' ? distribution.title : null;
  const description = typeof distribution?.description === 'string' ? distribution.description : null;
  const accessURL = typeof distribution?.accessURL === 'string' ? distribution.accessURL : null;
  const downloadURL = typeof distribution?.downloadURL === 'string' ? distribution.downloadURL : null;
  const resourcesAPI = typeof distribution?.resourcesAPI === 'string' ? distribution.resourcesAPI : null;
  const temporal = typeof distribution?.temporal === 'string' ? distribution.temporal : null;
  const locator = downloadURL ?? accessURL ?? resourcesAPI;
  const blob = [title, description, format, mediaType, locator].filter(Boolean).join(' ').toLowerCase();
  let role = 'unclassified';
  if (format === 'API' || (accessURL && /\/data-api\//.test(accessURL))) role = 'api';
  if (format === 'CSV' || (mediaType && /csv/i.test(mediaType))) role = 'csv';
  if (format === 'ZIP' || (mediaType && /zip/i.test(mediaType))) role = 'zip';
  if (format === 'XLSX' || format === 'XLS' || (mediaType && /spreadsheet|excel|xlsx/i.test(mediaType))) role = 'xlsx_dictionary_or_table';
  if (format === 'PDF' || (mediaType && /pdf/i.test(mediaType))) role = 'pdf_document';
  if (/dictionary/.test(blob)) role = role.startsWith('xlsx') ? 'xlsx_dictionary' : role === 'pdf_document' ? 'pdf_dictionary' : 'dictionary';
  const locators = [];
  if (accessURL) locators.push({ kind: 'accessURL', locator: accessURL, pointer: pointer(catalogPointer, index, 'accessURL') });
  if (downloadURL) locators.push({ kind: 'downloadURL', locator: downloadURL, pointer: pointer(catalogPointer, index, 'downloadURL') });
  if (resourcesAPI) locators.push({ kind: 'resourcesAPI', locator: resourcesAPI, pointer: pointer(catalogPointer, index, 'resourcesAPI') });
  return Object.freeze({
    role,
    title,
    description,
    format,
    media_type: mediaType,
    temporal,
    locators,
    capture_identity: locator ? captureIdentity({ catalogSha256, locator }) : null,
    catalog_pointer: pointer(catalogPointer, index),
    payload_success: false,
    retrieval_authorized: false
  });
}

export function bindCmsCatalogResources(record, catalogCapture) {
  const { row, pointer: catalogPointer, index } = bindCatalog(record, catalogCapture);
  const identifier = record.identity.match_fields.source_id;
  const title = typeof row.title === 'string' ? row.title : record.title ?? null;
  const temporal = typeof row.temporal === 'string' ? row.temporal : null;
  const modified = typeof row.modified === 'string' ? row.modified : null;
  const format = typeof row.format === 'string' ? row.format : null;
  const landingPage = typeof row.landingPage === 'string' ? row.landingPage : record.identity?.match_fields?.canonical_url ?? null;
  const distributions = Array.isArray(row.distribution) ? row.distribution : [];
  const candidates = distributions.map((distribution, distributionIndex) =>
    classifyCmsDistributionCandidate(distribution, {
      catalogPointer: `${catalogPointer}/distribution`,
      catalogSha256: catalogCapture.sha256,
      index: distributionIndex
    })
  );
  const landing = landingPage
    ? Object.freeze({
        role: 'landing_page',
        title,
        locator: landingPage,
        locators: [{ kind: 'landingPage', locator: landingPage, pointer: `${catalogPointer}/landingPage` }],
        capture_identity: captureIdentity({ catalogSha256: catalogCapture.sha256, locator: landingPage }),
        catalog_pointer: `${catalogPointer}/landingPage`,
        payload_success: false,
        retrieval_authorized: false
      })
    : null;
  const byCapture = new Map();
  for (const candidate of [...candidates, landing].filter(Boolean)) {
    for (const item of candidate.locators ?? [{ locator: candidate.locator, kind: candidate.role, pointer: candidate.catalog_pointer }]) {
      if (!item?.locator) continue;
      const identity = captureIdentity({ catalogSha256: catalogCapture.sha256, locator: item.locator });
      if (!byCapture.has(identity)) {
        byCapture.set(identity, Object.freeze({
          capture_identity: identity,
          locator: item.locator,
          kind: item.kind,
          role: candidate.role,
          pointer: item.pointer,
          title: candidate.title ?? title,
          temporal: candidate.temporal ?? null,
          format: candidate.format ?? format,
          payload_success: false
        }));
      }
    }
  }
  const releaseLocators = classifyCmsReleaseLocators(row);
  return Object.freeze({
    record_id: record.record_id,
    source_native_id: identifier,
    catalog_sha256: catalogCapture.sha256,
    catalog_pointer: catalogPointer,
    catalog_index: index,
    title,
    roles: Object.freeze({
      title,
      temporal,
      modified,
      format,
      landing_page: landingPage
    }),
    product_temporal: temporal,
    metadata_modified: modified,
    distributions: Object.freeze(candidates),
    landing_page: landing,
    unique_locators: Object.freeze([...byCapture.values()]),
    release_locators: Object.freeze(releaseLocators),
    payload_success: false,
    publication_authorized: false
  });
}

export function dictionaryLocatorStatus(bound, resourceCaptures = {}) {
  const dictionaryLike = bound.distributions.filter((candidate) =>
    ['dictionary', 'pdf_dictionary', 'xlsx_dictionary'].includes(candidate.role)
  );
  if (dictionaryLike.some((candidate) => candidate.locators.length > 0)) return 'present';
  const resourceUrls = bound.distributions.flatMap((candidate) =>
    (candidate.locators ?? []).filter((item) => item.kind === 'resourcesAPI').map((item) => item.locator)
  );
  const capturedDictionary = resourceUrls.some((url) => {
    const capture = resourceCaptures[url];
    if (!capture || capture.status !== 'captured') return false;
    const names = JSON.stringify(capture.data ?? {}).toLowerCase();
    return names.includes('dictionary');
  });
  if (capturedDictionary) return 'present';
  return 'unresolved';
}

export function parserFamily(bound) {
  const formats = new Set(bound.distributions.map((candidate) => candidate.format).filter(Boolean));
  if (formats.has('XLSX') || formats.has('XLS')) return 'xlsx_table_or_dictionary';
  if (formats.has('CSV') && formats.has('API')) return 'cms_dcat_api_csv';
  if (formats.has('CSV')) return 'csv_distribution';
  if (formats.has('API')) return 'cms_resources_api';
  if (formats.has('ZIP')) return 'zip_archive';
  if (formats.size) return 'catalog_distribution';
  return 'unresolved_parser';
}

export function nextAction(status, family) {
  if (status === 'unresolved' && family === 'cms_dcat_api_csv') return 'retain_unresolved_dictionary_locator';
  if (status === 'unresolved') return 'retain_unresolved_dictionary_or_parser';
  if (family === 'xlsx_table_or_dictionary') return 'review_xlsx_dictionary_locator';
  return 'review_catalog_distribution_metadata';
}

export function reconcileCmsCauseRow(bound, resourceCaptures = {}) {
  const dictionaryStatus = dictionaryLocatorStatus(bound, resourceCaptures);
  const family = parserFamily(bound);
  return Object.freeze({
    record_id: bound.record_id,
    source_native_id: bound.source_native_id,
    title: bound.title,
    product_temporal: bound.product_temporal,
    metadata_modified: bound.metadata_modified,
    resource_count: bound.unique_locators.length,
    distribution_count: bound.distributions.length,
    dictionary_locator_status: dictionaryStatus,
    parser_family: family,
    eligibility: dictionaryStatus === 'present' ? 'dictionary_locator_present' : 'metadata_only',
    next_action: nextAction(dictionaryStatus, family),
    payload_success: false,
    publication_authorized: false
  });
}

export function buildCmsCauseLedger({ records, catalogCapture, resourceCaptures = {} }) {
  const selected = cmsCorpusRecords(records);
  const rows = selected.map((record) => {
    try {
      return reconcileCmsCauseRow(bindCmsCatalogResources(record, catalogCapture), resourceCaptures);
    } catch (error) {
      return Object.freeze({
        record_id: record.record_id,
        source_native_id: record.identity?.match_fields?.source_id ?? null,
        title: record.title ?? null,
        product_temporal: null,
        metadata_modified: null,
        resource_count: 0,
        distribution_count: 0,
        dictionary_locator_status: 'unresolved',
        parser_family: 'bind_failed',
        eligibility: 'unresolved',
        next_action: 'retain_unresolved_catalog_binding',
        issue: error.message,
        payload_success: false,
        publication_authorized: false
      });
    }
  });
  const missing = rows.filter((row) => row.dictionary_locator_status === 'unresolved');
  return Object.freeze({
    format: 'ushso.cms-cause-ledger.v1',
    source_id: CMS_SOURCE_ID,
    catalog_sha256: catalogCapture.sha256,
    record_count: rows.length,
    rows: Object.freeze(rows),
    unresolved_dictionary_locator_count: missing.length,
    dictionary_absent_count: 0,
    payload_success: false,
    publication_authorized: false
  });
}

export function htmlDocumentationCannotBeJsonSuccess({ headers, bodyBytes, purpose = 'catalog_metadata' }) {
  return classifyResponse({
    purpose,
    expectedContentClasses: ['json'],
    headers,
    bodyBytes,
    profile: { validateJson() { return { accepted: true, classification: 'catalog_metadata' }; } }
  });
}

export function documentationRole(input) {
  return classifyResourceRole(input);
}


const exec=promisify(execFile);
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
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
}
