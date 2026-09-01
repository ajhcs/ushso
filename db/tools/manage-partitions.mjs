#!/usr/bin/env node
import { parseArgs, requireEnvironmentFence, runPsql, verifyManagedAuthorization } from './common.mjs';

const allowed = new Map([
  ['ingest.run_state_events', 'run_job_attempt'],
  ['ingest.job_attempts', 'run_job_attempt'],
  ['ingest.workflow_reconciliation_events', 'workflow_mapping'],
  ['ops.outbox_attempt_events', 'outbox'],
  ['ops.processed_event_history', 'processed_event'],
  ['ops.dead_letter_events', 'durable_dlq'],
  ['ops.audit_events', 'audit'],
]);

const args = parseArgs();
const fence = requireEnvironmentFence(args);
await verifyManagedAuthorization(fence);
const parent = args.parent;
if (!allowed.has(parent)) throw new Error('partition parent is not allowlisted');
if (!/^\d{4}-\d{2}-01$/.test(args.month || '')) throw new Error('--month must be YYYY-MM-01');
const [schema, table] = parent.split('.');
const month = new Date(`${args.month}T00:00:00Z`);
if (Number.isNaN(month.valueOf()) || month.getUTCDate() !== 1) throw new Error('invalid UTC month');
const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
const suffix = `${month.getUTCFullYear()}_${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
const nextIso = next.toISOString().slice(0, 10);
const lowerBound = `${args.month}T00:00:00Z`;
const upperBound = `${nextIso}T00:00:00Z`;
const relation = `${schema}.${table}_${suffix}`;
const sql = `
  create table if not exists ${relation} partition of ${parent}
    for values from ('${lowerBound}') to ('${upperBound}');
  alter table ${relation} set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 100);
  insert into ops.partition_registry
    (partition_relation, ledger_name, lower_bound, upper_bound, state, created_at, retention_deadline)
  values ('${relation}', '${allowed.get(parent)}', '${lowerBound}', '${upperBound}', 'online', clock_timestamp(), '${upperBound}'::timestamptz + interval '90 days')
  on conflict (partition_relation) do nothing;
`;
runPsql({ container: args.container || null, database: args.database || 'ushso', sql });
console.log(JSON.stringify({ status: 'pass', environment: fence.environment, partition_relation: relation }));
