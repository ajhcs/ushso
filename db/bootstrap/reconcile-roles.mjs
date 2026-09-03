#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DATABASE_OPERATION_ACTIONS, parseArgs, repositoryRoot, requireEnvironmentFence, runPsql, verifyManagedAuthorization } from '../tools/common.mjs';

const args = parseArgs();
const fence = requireEnvironmentFence(args);
const database = args.database || 'ushso';
await verifyManagedAuthorization(fence, {
  action: DATABASE_OPERATION_ACTIONS.ROLE_RECONCILIATION,
  database,
  parameters: {},
});
const sql = await readFile(path.join(repositoryRoot, 'db/bootstrap/roles.sql'), 'utf8');
runPsql({ container: args.container || null, database, sql });
console.log(JSON.stringify({ status: 'pass', environment: fence.environment, secret_values_processed: false }));
