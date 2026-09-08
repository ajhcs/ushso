import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {makeServer,runStdio} from '../plugins/ushso-research/scripts/mcp.mjs';
const initialize=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})+'\n',ping=JSON.stringify({jsonrpc:'2.0',id:2,method:'ping'})+'\n';
test('MCP awaits output writes and isolates internal dispatch errors without calling them parse failures',async()=>{
 let written=false,calls=0;const output=[];
 await runStdio(Readable.from([ping+ping]),async line=>{await new Promise(resolve=>setTimeout(resolve,5));output.push(JSON.parse(line));written=true;},async message=>{if(calls++)assert.equal(written,true);throw Error('private internal detail');});
 assert.equal(calls,2);assert.equal(output.length,2);assert.ok(output.every(x=>x.error.code===-32603&&x.id===2));assert.ok(output.every(x=>!x.error.message.includes('private')));
});
test('Muse: oversized frames are isolated across chunk boundaries and valid peers still execute',async()=>{
 for(const chunks of [[initialize+'x'.repeat(40000)+'\n'+ping],[initialize,'x'.repeat(32768),'xx','\n',ping],[initialize+'bad json\n'+ping]]){
  const output=[];await runStdio(Readable.from(chunks),line=>output.push(JSON.parse(line)),makeServer());
  assert.equal(output.length,3);assert.equal(output[0].id,1);assert.ok(output[1].error);assert.deepEqual(output[2],{jsonrpc:'2.0',id:2,result:{}});
 }
});
test('actual MCP child process survives an oversized request and reports nonzero protocol responses',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('../plugins/ushso-research/scripts/mcp.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],timeout:5000});let stdout='',stderr='';
 child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
 const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));});
 child.stdin.end(initialize+'x'.repeat(100000)+'\n'+ping);
 assert.deepEqual(await completed,{code:0,signal:null});assert.equal(stderr,'');
 const output=stdout.trim().split('\n').map(JSON.parse);assert.equal(output.length,3);assert.equal(output[1].error.code,-32600);assert.equal(output[2].id,2);assert.deepEqual(output[2].result,{});
});
