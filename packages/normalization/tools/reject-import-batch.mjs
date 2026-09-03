#!/usr/bin/env node
import { parseArgs } from '../../../db/tools/common.mjs';
import { rejectProductionImport } from '../src/database-import.mjs';

const args = parseArgs();
for (const required of ['import-id', 'reason', 'audit-event-id', 'recorded-at', 'environment']) {
  if (!args[required]) throw new Error(`--${required} is required`);
}
const result = await rejectProductionImport({
  importId: args['import-id'], reason: args.reason, auditEventId: args['audit-event-id'], recordedAt: args['recorded-at'],
  container: args.container || null, database: args.database || 'ushso', user: args.user || 'postgres',
  environment: args.environment, deploymentFingerprint: args['deployment-fingerprint'] || null,
  authorizationReceipt: args['authorization-receipt'] || null
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
