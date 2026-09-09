import {createHash} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
const hash=x=>createHash('sha256').update(x).digest('hex');
function pointer(value,p){if(typeof p!=='string'||!p.startsWith('/'))throw Error('BINDING_POINTER');for(const part of p.slice(1).split('/')){const key=part.replace(/~1/g,'/').replace(/~0/g,'~');if(!value||typeof value!=='object'||!Object.hasOwn(value,key))throw Error('BINDING_POINTER');value=value[key];}return value;}
export async function verifyGridBinding(record,doc,{generation,originals,catalog,capture}){
 const original=originals.get(record.record_id),binding=doc.release_binding??record.binding;
 if(!original||hash(JSON.stringify(original))!==record.record_sha256||record.generation!==generation)throw Error('RECORD_GENERATION');
 if(!binding||catalog.sha256!==binding.catalog_sha256||pointer(catalog.data,binding.identifier_pointer)!==original.identity?.match_fields?.source_id||!isDeepStrictEqual(pointer(catalog.data,binding.distribution_pointer),binding.distribution))throw Error('CATALOG_RELEASE');
 const resources=await capture(binding.resources_url);
 if(resources.sha256!==binding.resources_sha256||resources.data.links?.self?.href!==binding.resources_url||pointer(resources.data,doc.resources_pointer)?.downloadURL!==doc.url)throw Error('DOCUMENT_LINK');
 if(!/^[a-f0-9]{64}$/.test(doc.sha256))throw Error('PDF_HASH_IDENTITY');
 return {status:'verified',scope:'actual corpus generation and record; captured catalog distribution; resources self identity and exact PDF link; scientific release applicability unresolved'};
}
