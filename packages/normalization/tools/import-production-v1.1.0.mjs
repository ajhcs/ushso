#!/usr/bin/env node
import { parseArgs } from '../../../db/tools/common.mjs';
import { applyProductionImport } from '../src/database-import.mjs';

const args = parseArgs();
if (!args.environment) throw new Error('--environment is required');
const result = await applyProductionImport({
  container: args.container || null,
  database: args.database || 'ushso',
  user: args.user || 'ushso_normalize',
  environment: args.environment,
  deploymentFingerprint: args['deployment-fingerprint'] || null,
  authorizationReceipt: args['authorization-receipt'] || null
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
