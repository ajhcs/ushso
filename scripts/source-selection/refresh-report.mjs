#!/usr/bin/env node
// Deterministic read-only manual report. No network or service registration.
import {readFile} from 'node:fs/promises';
import {buildRefreshReport} from '../../packages/source-selection/refresh.mjs';
const [ledgerPath,planPath,attemptPath,policyPath,asOf,...extra] = process.argv.slice(2);
const read = async path => JSON.parse(await readFile(path,'utf8'));
try {
 if (!asOf || extra.length) throw new Error('Usage: refresh-report.mjs LEDGER.json PLANS.json ATTEMPTS.json POLICY.json AS_OF_UTC');
 const [ledger,plans,attempts,policy] = await Promise.all([ledgerPath,planPath,attemptPath,policyPath].map(read));
 console.log(JSON.stringify(buildRefreshReport({ledger,plans,attempts,policy,asOf}),null,2));
} catch (error) { console.error(JSON.stringify({status:'failed',code:error.code || 'error',message:error.message})); process.exitCode=1; }
