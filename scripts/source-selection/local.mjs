#!/usr/bin/env node
// Local, explicitly invoked operator workflow. Does not deploy or contact sources.
import {readFile} from 'node:fs/promises';
import {sha256} from '../../packages/source-selection/index.mjs';
import {commitLedger, setRightsPolicy, publishCandidate, readPublished, recoverStaleLock, withdrawPublication} from '../../packages/source-selection/ledger.mjs';
const [command, root, ...args] = process.argv.slice(2);
const json = async p => JSON.parse(await readFile(p,'utf8'));
try {
 let result;
 if (command === 'commit' && args.length === 2) result = await commitLedger(root,args[0] === '-' ? null : args[0],await json(args[1]));
 else if (command === 'rights' && args.length === 2) result = await setRightsPolicy(root,await json(args[1]),args[0] === '-' ? null : args[0]);
 else if (command === 'publish' && args.length === 3) result = await publishCandidate(root,{expectedRevision:args[0],expectedRightsHash:args[1],rightsPolicy:await json(args[2]),schemaHashes:{'ushso.source-selection.v1':sha256(await readFile(new URL('../../packages/source-selection/index.mjs', import.meta.url))),'projection-contract':sha256(await readFile(new URL('../../packages/source-selection/projection-contract.mjs', import.meta.url)))}});
 else if (command === 'withdraw' && args.length === 2) result = await withdrawPublication(root,{expectedBundleHash:args[0],reason:args[1]});
 else if (command === 'recover-lock' && args.length === 1) result = await recoverStaleLock(root,args[0]);
 else if (command === 'read' && args.length === 0) result = await readPublished(root);
 else throw new Error('Usage: local.mjs commit ROOT EXPECTED_REVISION|- LEDGER.json | rights ROOT EXPECTED_HASH|- POLICY.json | publish ROOT REVISION RIGHTS_HASH POLICY.json | withdraw ROOT EXPECTED_BUNDLE_HASH REASON | recover-lock ROOT LOCK_SHA256 | read ROOT');
 console.log(JSON.stringify(result,null,2));
} catch(e) { console.error(JSON.stringify({status:'failed',code:e.code || 'error',message:e.message})); process.exitCode = 1; }
