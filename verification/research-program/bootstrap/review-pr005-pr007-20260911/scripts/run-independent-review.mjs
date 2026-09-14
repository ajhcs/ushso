import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const [repo,expectedHead,out,commandsFile]=process.argv.slice(2);
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
assert(path.isAbsolute(repo)&&path.isAbsolute(out));
const guard=spawnSync('/home/plumbob/.local/bin/worktree-bootstrap',['verify',process.env.WORKTREE_BOOTSTRAP_TASK,'--repo',repo,'--require-writer'],{cwd:repo,encoding:'utf8'});
assert.equal(guard.status,0,guard.stderr);assert.equal(git('rev-parse','HEAD'),expectedHead);assert.equal(git('status','--porcelain'),'');
await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'workspace-verification.json'),guard.stdout);
const commands=JSON.parse(await fs.readFile(commandsFile,'utf8'));
const results=[];
for(const command of commands){
 const start=new Date().toISOString();
 const r=spawnSync(command.executable==='node'?process.execPath:command.executable,command.args,{cwd:repo,encoding:'utf8',maxBuffer:64*1024*1024,timeout:command.timeout_ms??180000,env:process.env});
 const stdout=Buffer.from(r.stdout??''),stderr=Buffer.from(r.stderr??'');
 await fs.writeFile(path.join(out,command.id+'.stdout'),stdout);await fs.writeFile(path.join(out,command.id+'.stderr'),stderr);
 const row={...command,started_at:start,finished_at:new Date().toISOString(),exit_code:r.status,signal:r.signal,error:r.error?.message??null,stdout:{path:command.id+'.stdout',bytes:stdout.length,sha256:hash(stdout)},stderr:{path:command.id+'.stderr',bytes:stderr.length,sha256:hash(stderr)}};
 results.push(row);console.log(JSON.stringify({id:row.id,exit_code:row.exit_code,signal:row.signal}));
 await fs.writeFile(path.join(out,'commands.partial.json'),JSON.stringify(results,null,2)+'\n');
}
const receipt={format:'ushso.controller-independent-review-commands.v1',recorded_at:new Date().toISOString(),head:expectedHead,tree:git('rev-parse','HEAD^{tree}'),node:process.version,commands:results,source_clean:git('status','--porcelain')==='',head_unchanged:git('rev-parse','HEAD')===expectedHead,runner_sha256:hash(await fs.readFile(new URL(import.meta.url))),commands_sha256:hash(await fs.readFile(commandsFile)),accepted:false};
await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');assert(receipt.source_clean&&receipt.head_unchanged);console.log(JSON.stringify({receipt:path.join(out,'receipt.json'),all_commands_passed:results.every(x=>x.exit_code===0),accepted:false}));
