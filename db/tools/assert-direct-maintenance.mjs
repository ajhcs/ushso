#!/usr/bin/env node
import { DATABASE_OPERATION_ACTIONS, parseArgs, requireEnvironmentFence, runPsql, verifyManagedAuthorization } from './common.mjs';

const args = parseArgs();
const fence = requireEnvironmentFence(args);
const database = args.database || 'ushso';
await verifyManagedAuthorization(fence, {
  action: DATABASE_OPERATION_ACTIONS.DIRECT_MAINTENANCE_ASSERT,
  database,
  parameters: {},
});
const result = runPsql({
  container: args.container || null,
  database,
  tuplesOnly: true,
  sql: `select environment || ':' || deployment_fingerprint from ops.environment_fence where singleton;`,
}).stdout.trim();
if (result !== `${fence.environment}:${fence.fingerprint}`) throw new Error('direct maintenance environment fence mismatch');
console.log(JSON.stringify({ status: 'pass', environment: fence.environment, path: 'direct_non_hyperdrive', credential_value_emitted: false }));
