import {checkWorkerRankingParity} from './check-ranking-parity.mjs';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {verifyRetainedRelease,workspacePath} from './restore-release.mjs';
export async function smokeRestoredRelease({restoredDirectory,wranglerPath,runtimeDirectory,expectedInventoryHash,port=18790}) {
 const root=await workspacePath(restoredDirectory),runtime=await workspacePath(runtimeDirectory);if(!runtime.startsWith('/workspace/')||runtime===root||runtime.startsWith(root+'/'))throw new Error('ISOLATED_WORKSPACE_RUNTIME_REQUIRED');
 const manifest=await verifyRetainedRelease(root,{expectedInventoryHash});
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('INVALID_LOCAL_PORT');
 await new Promise((accept,reject)=>{const probe=createServer();probe.once('error',()=>reject(new Error('RESTORE_PORT_ALREADY_IN_USE')));probe.listen(port,'127.0.0.1',()=>probe.close(accept));});
 await mkdir(runtime);await mkdir(join(runtime,'logs'));
 const retainedConfig=JSON.parse(await readFile(join(root,'wrangler.json'),'utf8'));
 const launchConfig={...retainedConfig,main:join(root,'worker/index.js'),assets:{...retainedConfig.assets,directory:join(root,'assets')}};
 await writeFile(join(runtime,'wrangler.json'),JSON.stringify(launchConfig),{flag:'wx'});
 const server=spawn(process.execPath,[resolve(wranglerPath),'dev','--config',join(runtime,'wrangler.json'),'--local','--no-bundle','--port',String(port),'--ip','127.0.0.1','--persist-to',join(runtime,'state')],{cwd:runtime,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:join(runtime,'logs','wrangler.log')}});
 let output='',childReady=false;for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{output=(output+chunk.toString()).slice(-16000);childReady=childReady||output.includes(`Ready on http://127.0.0.1:${port}`);});
 const stop=signal=>{try{process.platform==='win32'?server.kill(signal):process.kill(-server.pid,signal);}catch{}};
 const origin=`http://127.0.0.1:${port}`;let receipt;
 try {
  let health;
  for(let i=0;i<120;i++){if(server.exitCode!==null)throw new Error(`RESTORED_WORKER_EXITED:${output}`);try{if(!childReady){await delay(500);continue;}const response=await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(2000)});if(response.ok){health=await response.json();break;}}catch{}await delay(500);}
  if(server.exitCode!==null||server.signalCode!==null)throw new Error(`RESTORED_WORKER_EXITED:${output}`);
  if(!health)throw new Error(`RESTORED_WORKER_NOT_READY:${output}`);assert.equal(health.status,'ok');
  const home=await fetch(origin);assert.equal(home.status,200);const html=await home.text();assert.match(html,/<h1[\s>]/);assert.match(html,/United States Health Systems Observatory/);
  const catalogResponse=await fetch(`${origin}/api/catalog?limit=1`);assert.equal(catalogResponse.status,200);const catalog=await catalogResponse.json();assert.ok(catalog.results.length);assert.equal(catalog.total_matches,catalog.corpus.record_count);
  const first=catalog.results[0],id=first.record_id;assert.equal(id,first.record.record_id);assert.equal(id,first.record.identity.asset.asset_id);
  const detail=await fetch(`${origin}/datasets/${encodeURIComponent(id)}`);assert.equal(detail.status,200);const detailHtml=await detail.text();assert.match(detailHtml,/<h1[\s>]/);assert.ok(detailHtml.includes(first.record.title.replaceAll('&','&amp;'))||detailHtml.includes(first.record.title));
  const archive=await fetch(`${origin}/methods/archive/national-readiness`);assert.equal(archive.status,200);assert.match(archive.headers.get('x-robots-tag')??'',/noindex/);
  const sitemap=await fetch(`${origin}/sitemap.xml`);assert.equal(sitemap.status,200);assert.ok(!(await sitemap.text()).includes('/methods/archive/'));
  const missing=await fetch(`${origin}/datasets/restore-rehearsal-unknown-fixture`);assert.equal(missing.status,404);
  const rawPublication=await fetch(`${origin}/source-selection/publication.json`);assert.equal(rawPublication.status,404);
  const publication=await fetch(`${origin}/api/source-selection/v1/publication`);const publicationBody=await publication.json();assert.equal(publication.status,503);assert.equal(publicationBody.status,'unavailable');
  const ranking_parity=await checkWorkerRankingParity(origin);
  if(server.exitCode!==null||server.signalCode!==null)throw new Error('RESTORED_WORKER_EXITED_BEFORE_RECEIPT');
  receipt={schema_version:'ushso.local-restore-rehearsal.v1',status:'PASS',inventory_sha256:manifest.inventory_sha256,file_count:manifest.files.length,byte_count:manifest.byte_count,worker_source:'retained worker/index.js, no-bundle',launch_config:'Verified retained config copied into separate runtime; only Worker/assets paths made absolute',base:origin,health,catalog:{record_count:catalog.corpus.record_count,total_matches:catalog.total_matches,first_record_id:id},ranking_parity,no_javascript_home:true,no_javascript_detail:true,unknown_dataset_status:missing.status,accepted_publication:publicationBody,deployment_authorized:false,scope:'Local retained-byte restore only; no production activation or publisher payload access.'};

 } catch(error) {await writeFile(join(runtime,'restore-failure.json'),JSON.stringify({schema_version:'ushso.local-restore-failure.v1',status:'FAIL',inventory_sha256:manifest.inventory_sha256,base:origin,error:{name:error.name,message:error.message},deployment_authorized:false},null,2));throw error;} finally {stop('SIGTERM');await Promise.race([once(server,'exit'),delay(3000)]);stop('SIGKILL');await writeFile(join(runtime,'worker.log'),output);}
 try{await verifyRetainedRelease(root,{expectedInventoryHash});}catch(error){await writeFile(join(runtime,'restore-failure.json'),JSON.stringify({status:'FAIL',stage:'post_smoke_inventory',inventory_sha256:manifest.inventory_sha256,error:{name:error.name,message:error.message}},null,2));throw error;}
 receipt.inventory_after_smoke_verified=true;await writeFile(join(runtime,'restore-smoke.json'),JSON.stringify(receipt,null,2));return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const [restoredDirectory,wranglerPath,runtimeDirectory,expectedInventoryHash,port]=process.argv.slice(2);console.log(JSON.stringify(await smokeRestoredRelease({restoredDirectory,wranglerPath,runtimeDirectory,expectedInventoryHash,port:port?Number(port):18790}),null,2));}
