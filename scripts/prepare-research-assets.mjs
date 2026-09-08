import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = code => { throw new Error(code); };
const MAX_RESEARCH_ARCHIVE_BYTES = 8 * 1024 ** 3;
const MAX_REDIRECTS = 3;
const RELEASE_REDIRECT_HOSTS = new Set([
 'github.com',
 'release-assets.githubusercontent.com',
 'objects.githubusercontent.com',
 'github-releases.githubusercontent.com',
]);

function assertReleaseUrl(value) {
 let url;
 try { url = new URL(value); } catch { fail('RESEARCH_SOURCE_URL'); }
 if(url.origin!=='https://github.com'||url.username||url.password||url.search||url.hash||!/^\/ajhcs\/ushso\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.tar\.gz$/.test(url.pathname))fail('RESEARCH_SOURCE_URL');
 return url;
}

async function ensureCacheDirectory(file) {
 const parent = path.resolve(path.dirname(file));
 const missing=[];
 // Validate existing ancestors before creating anything. Otherwise
 // `mkdir(..., recursive)` could walk through a symlink introduced in the
 // cache path and create descendants outside the intended root.
 for(let current=parent;;current=path.dirname(current)){
  try{
   const stat=await fs.lstat(current);
   if(!stat.isDirectory()||stat.isSymbolicLink())fail('RESEARCH_SOURCE_CACHE_PATH');
  }catch(error){
   if(error.code!=='ENOENT')throw error;
   missing.push(current);
  }
  if(path.dirname(current)===current)break;
 }
 await fs.mkdir(parent,{recursive:true});
 for(const current of missing){
  const stat=await fs.lstat(current);
  if(!stat.isDirectory()||stat.isSymbolicLink())fail('RESEARCH_SOURCE_CACHE_PATH');
 }
}

async function fetchReleaseArchive(url,fetchImpl) {
 let current=url;
 const signal=AbortSignal.timeout(180000);
 for(let attempt=0;attempt<=MAX_REDIRECTS;attempt+=1){
  const response=await fetchImpl(current.href,{signal,redirect:'manual',headers:{accept:'application/octet-stream'}});
  if(![301,302,303,307,308].includes(response.status))return response;
  const location=response.headers.get('location');
  if(response.body&&!response.body.locked)await response.body.cancel().catch(()=>{});
  if(!location||attempt===MAX_REDIRECTS)fail('RESEARCH_SOURCE_REDIRECT');
  let next;
  try{next=new URL(location,current);}catch{fail('RESEARCH_SOURCE_REDIRECT');}
  if(next.protocol!=='https:'||next.username||next.password||!RELEASE_REDIRECT_HOSTS.has(next.hostname))fail('RESEARCH_SOURCE_REDIRECT');
  current=next;
 }
 fail('RESEARCH_SOURCE_REDIRECT');
}

export async function verifyResearchArchive(file, expected) {
 const stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==expected.bytes) fail('RESEARCH_SOURCE_SIZE_OR_TYPE');
 const digest=createHash('sha256');let size=0;
 for await(const chunk of createReadStream(file)){
  size+=chunk.length;if(size>expected.bytes)fail('RESEARCH_SOURCE_SIZE');digest.update(chunk);
 }
 if(size!==expected.bytes||digest.digest('hex')!==expected.sha256)fail('RESEARCH_SOURCE_HASH');
 return file;
}
export async function ensureResearchArchive({archive,file,fetchImpl=globalThis.fetch}) {
 if(!archive||typeof file!=='string'||!file||!Number.isSafeInteger(archive.bytes)||archive.bytes<1||archive.bytes>MAX_RESEARCH_ARCHIVE_BYTES||!/^[a-f0-9]{64}$/.test(archive.sha256))fail('RESEARCH_SOURCE_LOCK');
 try{return await verifyResearchArchive(file,archive);}catch(error){if(error.code!=='ENOENT')throw error;}
 const url=assertReleaseUrl(archive.url);
 if(path.resolve(file).startsWith('/mnt/d/'))execFileSync('mountpoint',['-q','/mnt/d']);
 await ensureCacheDirectory(file);
 const temporary=file+'.partial-'+randomBytes(12).toString('hex');
 let handle, response;
 try {
  response=await fetchReleaseArchive(url,fetchImpl);
  if(response.status!==200||!response.body)fail('RESEARCH_SOURCE_HTTP');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==archive.bytes))fail('RESEARCH_SOURCE_LENGTH');
  handle=await fs.open(temporary,'wx',0o600);
  const digest=createHash('sha256');let size=0;
  for await(const raw of response.body){
   const chunk=Buffer.from(raw);size+=chunk.length;
   if(size>archive.bytes)fail('RESEARCH_SOURCE_SIZE');
   digest.update(chunk);let offset=0;
   while(offset<chunk.length){const written=await handle.write(chunk,offset,chunk.length-offset);if(!written.bytesWritten)fail('RESEARCH_SOURCE_WRITE');offset+=written.bytesWritten;}
  }
  if(size!==archive.bytes||digest.digest('hex')!==archive.sha256)fail('RESEARCH_SOURCE_HASH');
  await handle.sync();await handle.close();handle=null;
  // Exclusive installation preserves a competing cache entry. Verify it rather
  // than replacing bytes another build may already be reading.
  try{await fs.link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;}
  return await verifyResearchArchive(file,archive);
 } finally {
  if(handle)await handle.close();
  if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});
  await fs.rm(temporary,{force:true});
 }
}
async function main(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const {loadLock,stageResearchAssets}=await import('./stage-research-assets.mjs');
 const lockFile=path.join(root,'config/research-assets.lock.json');
 const loaded=await loadLock(lockFile),archive=loaded.lock.source.archive;
 const temporaryBase=process.env.TMPDIR??process.env.RUNNER_TEMP;
 if(!temporaryBase||!path.isAbsolute(temporaryBase))fail('RESEARCH_TEMP_ROOT_REQUIRED');
 const source=process.env.USHSO_RESEARCH_ASSET_SOURCE??(process.env.RUNNER_TEMP?path.join(process.env.RUNNER_TEMP,'ushso-research-assets',archive.sha256+'.tar.gz'):archive.path);
 const file=path.isAbsolute(source)?source:path.resolve(path.dirname(lockFile),source);
 await ensureResearchArchive({archive,file});
 const result=await stageResearchAssets({lock:loaded.lock,lockSha256:loaded.lock_sha256,archivePath:file,outputRoot:path.join(root,'apps/web/public'),temporaryBase});
 process.stdout.write(JSON.stringify({status:'PASS',archive_sha256:archive.sha256,index_sha256:result.index_sha256})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('RESEARCH_ASSET_PREPARATION_FAILED:'+error.message);process.exitCode=1;});
