import { readFile } from 'node:fs/promises';
import { commitLedger } from '../../packages/source-selection/ledger.mjs';
const [dir,base,fixturePath,boundary] = process.argv.slice(2);
const ledger = JSON.parse(await readFile(fixturePath));
await commitLedger(dir,base,ledger,{checkpoint:async name => { if (name === boundary) { process.send({name}); await new Promise(() => { setInterval(() => {}, 1000); }); } }});
