import {checkWorkerRankingParity} from './check-ranking-parity.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';

// Run the bundled Worker through workerd, then run the existing HTTP assertions.
// No deploy command, remote source requests, or deployment receipts are created.
const port = 18787;
const server = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js','dev','--local','--port',String(port),'--ip','127.0.0.1'], {
 cwd: resolve('.'), stdio: ['ignore','pipe','pipe'], env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:process.env.WRANGLER_LOG_PATH??resolve('.wrangler/logs/local-integration.log')}, detached: process.platform !== 'win32'
});
let output='';
for (const stream of [server.stdout,server.stderr]) stream.on('data',data => { output=(output+data.toString()).slice(-24000); });
server.on('error', error => { output += `\n${error.message}`; });
const stop = signal => { try { if (process.platform !== 'win32') process.kill(-server.pid,signal); else server.kill(signal); } catch {} };
try {
 let ready=false;
 for(let i=0;i<120;i++) {
  if(server.exitCode !== null) throw new Error(`LOCAL_WORKER_EXITED:${server.exitCode}\n${output}`);
  try { const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)}); if(response.ok) {ready=true;break;} } catch {}
  await delay(500);
 }
 if(!ready) throw new Error(`LOCAL_WORKER_NOT_READY\n${output}`);
 const check=spawn(process.execPath,['tests/e2e-smoke.mjs','--base',`http://127.0.0.1:${port}`],{stdio:'inherit',env:process.env});
 const [code]=await once(check,'exit');
 if(code!==0) throw new Error(`HTTP_INTEGRATION_FAILED:${code}`);
 console.log(JSON.stringify(await checkWorkerRankingParity(`http://127.0.0.1:${port}`),null,2));
} finally {
 stop('SIGTERM');
 await Promise.race([once(server,'exit'),delay(3000)]);
 stop('SIGKILL');
}
