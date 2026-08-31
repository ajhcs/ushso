#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, repositoryRoot, requireEnvironmentFence, runPsql, verifyManagedAuthorization } from '../tools/common.mjs';

const args = parseArgs();
const fence = requireEnvironmentFence(args);
await verifyManagedAuthorization(fence);
const sql = await readFile(path.join(repositoryRoot, 'db/bootstrap/roles.sql'), 'utf8');
runPsql({ container: args.container || null, database: args.database || 'ushso', sql });
console.log(JSON.stringify({ status: 'pass', environment: fence.environment, secret_values_processed: false }));

