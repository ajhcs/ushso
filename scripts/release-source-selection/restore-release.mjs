import {verifyPublicationEvidence,evidencePaths} from './publication-evidence.mjs';
import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, writeFile, open } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v=>JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])) : value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const appVarNames = new Set(['USHSO_DICTIONARY_REVIEW','USHSO_DICTIONARY_REVIEW_MANIFEST_SHA256','USHSO_SCIENTIFIC_REVIEW','USHSO_SCIENTIFIC_REVIEW_MANIFEST_SHA256','USHSO_SCIENTIFIC_CONFLICTS_REVIEW','USHSO_SCIENTIFIC_CONFLICTS_MANIFEST_SHA256']);
const unavailableSentinel=value=>value&&value.status==='unavailable'&&Object.keys(value).every(key=>['status','reason'].includes(key))&&(value.reason===undefined||typeof value.reason==='string'&&value.reason.length>0&&value.reason.length<=200);
const fail = code => { throw Object.assign(new Error(code),{code}); };
async function readPublication(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function checkUnavailableSentinel(path){let handle;try{handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();if(!stat.isFile()||stat.size>1024||!unavailableSentinel(JSON.parse(await handle.readFile('utf8'))))fail('ACCEPTED_PUBLICATION_NOT_SUPPORTED');}catch(error){if(error.code!=='ENOENT')throw error;}finally{await handle?.close();}}
const safeRelative = path => typeof path === 'string' && path && !isAbsolute(path) && !path.includes('\\') && path.split('/').every(part=>part && part!=='.' && part!=='..');
export async function workspacePath(path) {
 const target=resolve(path); if (!target.startsWith('/workspace/')) fail('WORKSPACE_REQUIRED');
 let parent=target; for(;;) {try {const actual=await realpath(parent);if(actual!==parent)fail('SYMLINK_PATH_REJECTED');if((await lstat(actual)).dev!==(await lstat('/workspace')).dev)fail('WORKSPACE_DEVICE_MISMATCH');break;}catch(error){if(error.code!=='ENOENT')throw error;parent=dirname(parent);}}
 return target;
}
async function files(root, prefix='', expectedDirectories=null) {
 const result=[];
 for(const name of (await readdir(join(root,prefix))).sort()) {
  const path=join(prefix,name);if(!safeRelative(path.split(sep).join('/')))fail('INVALID_INVENTORY_PATH');const stat=await lstat(join(root,path));
  if(stat.dev!==(await lstat('/workspace')).dev)fail('WORKSPACE_DEVICE_MISMATCH');
  if(stat.isSymbolicLink())fail('SYMLINK_REJECTED');
  if(stat.isDirectory()){if(expectedDirectories&&!expectedDirectories.has(path.split(sep).join('/')))fail('UNEXPECTED_DIRECTORY');result.push(...await files(root,path,expectedDirectories));}
  else if(stat.isFile())result.push(path.split(sep).join('/'));
  else fail('SPECIAL_FILE_REJECTED');
 }
 return result;
}
async function hashFile(path) {const hash=createHash('sha256');let bytes=0;const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try {if(!(await handle.stat()).isFile())fail('SOURCE_NOT_REGULAR');for await(const chunk of handle.createReadStream({autoClose:false})){bytes+=chunk.length;hash.update(chunk);}return {sha256:hash.digest('hex'),bytes};}finally{await handle.close();}}
async function copyChecked(source,target,expected) {
 const handle=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);try {
 const before=await handle.stat();if(!before.isFile())fail('SOURCE_NOT_REGULAR');
 await mkdir(dirname(target),{recursive:true});const hash=createHash('sha256');let bytes=0;
 await pipeline(handle.createReadStream({autoClose:false}),new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;hash.update(chunk);callback(null,chunk);}}),createWriteStream(target,{flags:'wx',mode:0o600}));
 const after=await lstat(source);
 if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||bytes!==expected.bytes||hash.digest('hex')!==expected.sha256)fail('SOURCE_CHANGED_OR_HASH_MISMATCH');
 } finally {await handle.close();}
}
export async function retainRelease({assetsDirectory,workerFile,destination,compatibilityDate,compatibilityFlags=[],appVars={},ledgerRoot,...authority}) {
 const assets=await workspacePath(assetsDirectory),worker=await workspacePath(workerFile),target=await workspacePath(destination);
 if(!/^\d{4}-\d\d-\d\d$/.test(compatibilityDate)||!Array.isArray(compatibilityFlags)||compatibilityFlags.some(flag=>typeof flag!=='string'||!flag))fail('INVALID_COMPATIBILITY');
 if(!appVars||typeof appVars!=='object'||Array.isArray(appVars)||Object.entries(appVars).some(([key,value])=>!appVarNames.has(key)||typeof value!=='string'))fail('UNSAFE_APP_VARS');
 const publication=await readPublication(join(assets,'source-selection/publication.json'));
 if(publication?.status==='available'){if(!ledgerRoot)fail('ACCEPTED_PUBLICATION_NOT_SUPPORTED');await workspacePath(ledgerRoot);await verifyPublicationEvidence({ledgerRoot,publication,authority,retainedRoot:target});}else await checkUnavailableSentinel(join(assets,'source-selection/publication.json'));
 if(target===assets||target.startsWith(assets+'/')||assets.startsWith(target+'/'))fail('OVERLAPPING_PATHS');
 await mkdir(target); const inventory=[],assetPaths=await files(assets);
 for(const path of assetPaths) {const entry={path:`assets/${path}`,...await hashFile(join(assets,path))};await copyChecked(join(assets,path),join(target,entry.path),entry);inventory.push(entry);}
 if(publication?.status==='available'){for(const path of await evidencePaths(ledgerRoot,publication)){if(!safeRelative(path))fail('INVALID_INVENTORY_PATH');await workspacePath(join(ledgerRoot,path));const entry={path:`evidence/${path}`,...await hashFile(join(ledgerRoot,path))};await copyChecked(join(ledgerRoot,path),join(target,entry.path),entry);inventory.push(entry);}await verifyPublicationEvidence({ledgerRoot:join(target,'evidence'),publication,authority,retainedRoot:target});}
 const entry={path:'worker/index.js',...await hashFile(worker)};await copyChecked(worker,join(target,entry.path),entry);inventory.push(entry);
 const config={name:'ushso-local-restore',main:'worker/index.js',compatibility_date:compatibilityDate,compatibility_flags:compatibilityFlags,assets:{directory:'assets',binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/*']},observability:{enabled:false},vars:appVars};
 const configBytes=canonical(config);await writeFile(join(target,'wrangler.json'),configBytes,{flag:'wx',mode:0o600});inventory.push({path:'wrangler.json',bytes:Buffer.byteLength(configBytes),sha256:sha(configBytes)});
 if(JSON.stringify(await files(assets))!==JSON.stringify(assetPaths))fail('SOURCE_INVENTORY_CHANGED');
 inventory.sort((a,b)=>a.path.localeCompare(b.path));const body={schema_version:'ushso.local-release-inventory.v1',files:inventory,byte_count:inventory.reduce((n,e)=>n+e.bytes,0),deployment_authorized:false};const manifest={...body,inventory_sha256:sha(canonical(body))};
 await writeFile(join(target,'release-manifest.json'),canonical(manifest),{flag:'wx',mode:0o600});return manifest;
}
export async function verifyRetainedRelease(retainedDirectory,{expectedInventoryHash,...authority}={}) {
 if(!/^[a-f0-9]{64}$/.test(expectedInventoryHash??''))fail('EXTERNAL_INVENTORY_HASH_REQUIRED');
 const root=await workspacePath(retainedDirectory);const stat=await lstat(join(root,'release-manifest.json'));if(!stat.isFile()||stat.size>32*1024*1024)fail('INVALID_MANIFEST');
 const manifest=JSON.parse(await readFile(join(root,'release-manifest.json'),'utf8'));const {inventory_sha256,...body}=manifest;
 if(manifest.schema_version!=='ushso.local-release-inventory.v1'||manifest.deployment_authorized!==false||inventory_sha256!==expectedInventoryHash||sha(canonical(body))!==inventory_sha256||!Array.isArray(manifest.files)||!manifest.files.length)fail('INVALID_MANIFEST');
 const paths=new Set();let count=0;
 for(const entry of manifest.files){if(!safeRelative(entry.path)||paths.has(entry.path)||!(/^(assets|evidence)\/.+$|^worker\/index\.js$|^wrangler\.json$/.test(entry.path))||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||!(/^[a-f0-9]{64}$/).test(entry.sha256))fail('INVALID_INVENTORY_PATH');paths.add(entry.path);count+=entry.bytes;}
 if(!paths.has('worker/index.js')||!paths.has('wrangler.json')||count!==manifest.byte_count)fail('INVALID_MANIFEST');
 const expectedDirectories=new Set();for(const path of paths){let parent=dirname(path);while(parent!=='.'){expectedDirectories.add(parent);parent=dirname(parent);}}
 const actual=await files(root,'',expectedDirectories);if(actual.length!==paths.size+1||actual.some(path=>path!=='release-manifest.json'&&!paths.has(path)))fail('UNEXPECTED_FILE');
 for(const entry of manifest.files){const observed=await hashFile(join(root,entry.path));if(observed.bytes!==entry.bytes||observed.sha256!==entry.sha256)fail('RETAINED_HASH_MISMATCH');}
 const config=JSON.parse(await readFile(join(root,'wrangler.json'),'utf8'));
 const expectedConfig={name:'ushso-local-restore',main:'worker/index.js',compatibility_date:config.compatibility_date,compatibility_flags:config.compatibility_flags,assets:{directory:'assets',binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/*']},observability:{enabled:false},vars:config.vars};
 if(canonical(config)!==canonical(expectedConfig)||!/^\d{4}-\d\d-\d\d$/.test(config.compatibility_date)||!Array.isArray(config.compatibility_flags)||config.compatibility_flags.some(flag=>typeof flag!=='string'||!flag)||config.name!=='ushso-local-restore'||config.main!=='worker/index.js'||config.assets?.directory!=='assets'||config.assets?.binding!=='ASSETS'||config.account_id||config.routes||!config.vars||Object.entries(config.vars).some(([key,value])=>!appVarNames.has(key)||typeof value!=='string'))fail('UNSAFE_RESTORE_CONFIG');
 const publication=await readPublication(join(root,'assets/source-selection/publication.json'));
 if(publication?.status==='available'){await verifyPublicationEvidence({ledgerRoot:join(root,'evidence'),publication,authority,retainedRoot:root});const expected=new Set((await evidencePaths(join(root,'evidence'),publication)).map(p=>`evidence/${p}`));if(manifest.files.filter(e=>e.path.startsWith('evidence/')).some(e=>!expected.has(e.path)))fail('UNEXPECTED_EVIDENCE');}else {await checkUnavailableSentinel(join(root,'assets/source-selection/publication.json'));if(manifest.files.some(e=>e.path.startsWith('evidence/')))fail('UNEXPECTED_EVIDENCE');}
 return manifest;
}
export async function restoreRelease({retainedDirectory,destination,expectedInventoryHash,...authority}) {
 const source=await workspacePath(retainedDirectory),target=await workspacePath(destination);if(target===source||target.startsWith(source+'/')||source.startsWith(target+'/'))fail('OVERLAPPING_PATHS');
 const manifest=await verifyRetainedRelease(source,{expectedInventoryHash,...authority});await mkdir(target);
 for(const entry of manifest.files)await copyChecked(join(source,entry.path),join(target,entry.path),entry);
 await writeFile(join(target,'release-manifest.json'),canonical(manifest),{flag:'wx',mode:0o600});await verifyRetainedRelease(target,{expectedInventoryHash,...authority});return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [mode,...args]=process.argv.slice(2);
 let result;const authorityPath=mode==='retain'?args[4]:mode==='restore'?args[3]:args[2];const authority=authorityPath?JSON.parse(await readFile(authorityPath,'utf8')):{};
 if(mode==='retain'){const config=JSON.parse(await readFile(args[3],'utf8'));result=await retainRelease({assetsDirectory:args[0],workerFile:args[1],destination:args[2],compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags??[],appVars:config.vars??{},...authority});}
 else if(mode==='restore')result=await restoreRelease({retainedDirectory:args[0],destination:args[1],expectedInventoryHash:args[2],...authority});
 else if(mode==='verify')result=await verifyRetainedRelease(args[0],{expectedInventoryHash:args[1],...authority});
 else fail('USAGE_RETAIN_RESTORE_VERIFY');
 console.log(JSON.stringify({status:'PASS',mode,inventory_sha256:result.inventory_sha256,file_count:result.files.length,byte_count:result.byte_count,deployment_authorized:false}));
}
