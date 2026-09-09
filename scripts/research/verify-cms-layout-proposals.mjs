import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseTypedLayout} from './cms-typed-layout.mjs';
import {parseVariableLayout} from './cms-variable-layout.mjs';
import {pointerValue} from './source-extractors.mjs';
const base=process.env.USHSO_RESEARCH_EVIDENCE_ROOT??'/mnt/d/tmp/plumbob/ushso-research-expansion-20260907',family=process.argv.includes('--variable-first')?'variable':'typed',out=process.env.USHSO_RESEARCH_OUTPUT_DIR??base+'/review/cms-'+family+'-dictionary-proposals';
const hash=x=>createHash('sha256').update(x).digest('hex');
const corpusBase=fileURLToPath(new URL('../../packages/retrieval/versions/v1.2.0/corpus',import.meta.url));
const corpus=JSON.parse(await fs.readFile(corpusBase+'/corpus.json')),originals=new Map();
for(const file of corpus.record_files)for(const line of (await fs.readFile(corpusBase+'/'+file,'utf8')).trim().split('\n')){const r=JSON.parse(line);originals.set(r.record_id,r);}
async function capture(directory,url){const r=JSON.parse(await fs.readFile(directory+'/'+hash(url)+'.json'));if(r.url!==url)throw Error('CAPTURE_URL');const body=await fs.readFile(directory+'/'+r.sha256+'.body');if(hash(body)!==r.sha256)throw Error('CAPTURE_HASH');return {...r,data:JSON.parse(body)};}
const catalog=await capture(base+'/evidence/captures','https://data.cms.gov/data.json');
const manifest=JSON.parse(await fs.readFile(out+'/manifest.json'));let fields=0;
for(const entry of manifest.proposals){
 const bytes=await fs.readFile(entry.file);if(hash(bytes)!==entry.sha256)throw Error('PROPOSAL_HASH');const p=JSON.parse(bytes),original=originals.get(p.record_id);
 if(!original||hash(JSON.stringify(original))!==p.baseline_record_sha256||p.generation!==corpus.publication.generation)throw Error('RECORD_GENERATION');
 if(!p.source_record_file.startsWith(base+'/cms-documents-v2/')&&!p.source_record_file.startsWith(base+'/cms-release-documents/'))throw Error('SOURCE_RECORD_PATH');
 if(hash(await fs.readFile(p.source_record_file))!==p.source_record_sha256)throw Error('SOURCE_RECORD_HASH');
 const binding=p.release_binding;
 if(catalog.sha256!==binding.catalog_sha256||pointerValue(catalog.data,binding.identifier_pointer)!==original.identity.match_fields.source_id||!isDeepStrictEqual(pointerValue(catalog.data,binding.distribution_pointer),binding.distribution))throw Error('CATALOG_RELEASE');
 const directory=path.dirname(p.source_record_file),resources=await capture(directory,binding.resources_url);
 if(resources.sha256!==binding.resources_sha256||resources.data.links?.self?.href!==binding.resources_url||pointerValue(resources.data,p.resources_pointer)?.downloadURL!==p.publisher_url)throw Error('DOCUMENT_LINK');
 if(hash(await fs.readFile(directory+'/'+p.pdf_sha256+'.pdf'))!==p.pdf_sha256)throw Error('PDF_HASH');
 const layout=await fs.readFile(out+'/'+p.pdf_sha256+'.layout.json');if(hash(layout)!==p.layout_sha256)throw Error('LAYOUT_HASH');
 const reconstructed=(family==='typed'?parseTypedLayout:parseVariableLayout)(JSON.parse(layout));if(!isDeepStrictEqual(reconstructed,p.after))throw Error('UNSUPPORTED_ROW');
 if(p.publication_authorized!==false||p.review_status!=='pending_owner_review')throw Error('UNAUTHORIZED_APPROVAL');
 fields+=p.after.variables.length;
}
const result={recorded_at:new Date().toISOString(),status:'PASS',scope:'Exact captured publisher asset/distribution/document link and deterministic column extraction; not release applicability or scientific approval',records:manifest.records,proposals:manifest.proposals.length,variables:fields,manifest_sha256:hash(await fs.readFile(out+'/manifest.json')),canonical_records_changed:0,scientific_approval:false};
await fs.writeFile(out+'/binding-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
