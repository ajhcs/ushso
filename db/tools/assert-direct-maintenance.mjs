#!/usr/bin/env node
import { parseArgs, requireEnvironmentFence, runPsql, verifyManagedAuthorization } from './common.mjs';

const args = parseArgs();
const fence = requireEnvironmentFence(args);
await verifyManagedAuthorization(fence);
const result = runPsql({
  container: args.container || null,
  database: args.database || 'ushso',
  tuplesOnly: true,
  sql: `select environment || ':' || deployment_fingerprint from ops.environment_fence where singleton;`,
}).stdout.trim();
if (result !== `${fence.environment}:${fence.fingerprint}`) throw new Error('direct maintenance environment fence mismatch');
console.log(JSON.stringify({ status: 'pass', environment: fence.environment, path: 'direct_non_hyperdrive', credential_value_emitted: false }));

