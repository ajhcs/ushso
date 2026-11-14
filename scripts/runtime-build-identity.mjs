import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from 'esbuild';
const exec=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function assetInventory(directory, prefix='') {
 const rows=[];
 for(const entry of (await fs.readdir(path.join(directory,prefix),{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
  const relative=prefix?`${prefix}/${entry.name}`:entry.name;
  if(entry.isSymbolicLink())throw new Error('BUILD_IDENTITY_ASSET_SYMLINK');
  if(entry.isDirectory())rows.push(...await assetInventory(directory,relative));
  else if(entry.isFile())rows.push({path:relative,sha256:digest(await fs.readFile(path.join(directory,relative)))});
 }
 return rows;
}
export async function createRuntimeBuildIdentity({assetsDirectory=path.join(root,'apps/web/dist'),sourceRoot=root,configurationPath=null,buildArguments=[]}={}) {
 const assets=path.resolve(assetsDirectory);
 const result=await build({absWorkingDir:sourceRoot,entryPoints:['worker/index.mjs'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',metafile:true,define:{USHSO_RUNTIME_BUILD_IDENTITY:'null',USHSO_LEXICAL_BUILD_PIN:'null'}});
 const inputNames=Object.keys(result.metafile.inputs).filter(name=>!name.startsWith('<define:')).sort();
 const sourceInventory=async()=>Promise.all(inputNames.map(async relative=>({path:relative,sha256:digest(await fs.readFile(path.resolve(sourceRoot,relative)))})));
 const sources=await sourceInventory();
 const before=await assetInventory(assets);
 if(!before.some(entry=>entry.path==='index.html'))throw new Error('BUILD_IDENTITY_INDEX_MISSING');
 const lock=await fs.readFile(path.join(sourceRoot,'package-lock.json'));
 const configuration=configurationPath?await fs.readFile(configurationPath):null;
 const [revision,status]=await Promise.all([exec('git',['rev-parse','HEAD'],{cwd:sourceRoot}),exec('git',['status','--porcelain','--untracked-files=normal'],{cwd:sourceRoot})]);
 const payload={schema_version:'ushso.runtime-build-identity.v1',source_revision:revision.stdout.trim(),source_dirty:!!status.stdout.trim(),source_graph_sha256:digest(JSON.stringify(sources)),assets_manifest_sha256:digest(JSON.stringify(before)),lockfile_sha256:digest(lock),runtime_configuration_sha256:configuration?digest(configuration):null,bundler_arguments_sha256:digest(JSON.stringify(buildArguments))};
 if(JSON.stringify(sources)!==JSON.stringify(await sourceInventory())||JSON.stringify(before)!==JSON.stringify(await assetInventory(assets))||!lock.equals(await fs.readFile(path.join(sourceRoot,'package-lock.json')))||configuration&& !configuration.equals(await fs.readFile(configurationPath)))throw new Error('BUILD_IDENTITY_INPUT_CHANGED');
 const identity={...payload,build_id:digest(JSON.stringify(payload))};
 return {identity,sources,assets:before};
}
export async function writeRuntimeBuildReceipt(receipt,{directory=path.join(root,'.wrangler/runtime-build-identities')}={}) {
 await fs.mkdir(directory,{recursive:true});
 const target=path.join(directory,`${receipt.identity.build_id}.json`);
 const bytes=JSON.stringify(receipt,null,2)+'\n';
 try{await fs.writeFile(target,bytes,{flag:'wx'})}catch(error){if(error.code!=='EEXIST'||await fs.readFile(target,'utf8')!==bytes)throw error}
 return target;
}

export async function finalizeRuntimeBuildReceipt(prepared,{assetsDirectory,sourceRoot=root,configurationPath=null,buildArguments=[],workerArtifact,directory}={}) {
 const current=await createRuntimeBuildIdentity({assetsDirectory,sourceRoot,configurationPath,buildArguments});
 if(JSON.stringify(current)!==JSON.stringify(prepared))throw new Error('BUILD_IDENTITY_CHANGED_DURING_BUNDLE');
 const stat=await fs.lstat(workerArtifact);
 if(!stat.isFile()||stat.isSymbolicLink())throw new Error('BUILD_IDENTITY_ARTIFACT_NOT_REGULAR');
 const worker=await fs.readFile(workerArtifact);
 if(!worker.includes(prepared.identity.build_id)||!worker.includes(prepared.identity.source_graph_sha256)||!worker.includes(prepared.identity.schema_version))throw new Error('BUILD_IDENTITY_NOT_EMBEDDED_IN_ARTIFACT');
 const receipt={...prepared,worker_artifact_sha256:digest(worker),worker_artifact_bytes:worker.length,scope:'Compiled artifact and staged assets after source/config/asset stability checks; deploy this exact artifact without rebundling.'};
 const targetDirectory=directory??path.join(root,'.wrangler/runtime-build-identities');
 await fs.mkdir(targetDirectory,{recursive:true});
 const target=path.join(targetDirectory,`${prepared.identity.build_id}.compiled.json`);
 const bytes=JSON.stringify(receipt,null,2)+'\n';
 try{await fs.writeFile(target,bytes,{flag:'wx'})}catch(error){if(error.code!=='EEXIST'||await fs.readFile(target,'utf8')!==bytes)throw error}
 return {receipt,path:target};
}
