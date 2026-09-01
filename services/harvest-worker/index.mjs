import { invariant } from '../../packages/ingestion/src/common.mjs';
import { normalizeWorkflowPlatformState } from '../../packages/ingestion/src/workflow-reconciler.mjs';

export function createHarvestWorker({ queueConsumers, deadLetterConsumers = {} }) {
  invariant(queueConsumers && typeof queueConsumers === 'object', 'QUEUE_CONSUMERS_MISSING');
  return Object.freeze({
    async queue(batch) {
      const consumer = queueConsumers[batch.queue] ?? deadLetterConsumers[batch.queue];
      if (!consumer || typeof consumer.handleBatch !== 'function') {
        for (const message of batch.messages) message.retry({ delaySeconds: 60 });
        return Object.freeze(batch.messages.map(message => ({ eventId: message.body?.event_id, action: 'retry', reason: 'QUEUE_ROUTE_UNCONFIGURED' })));
      }
      return consumer.handleBatch(batch);
    }
  });
}

// This is the only Queue composition seam. The deployment-specific module
// supplies consumers; this adapter never resolves bindings or credentials.
export function createHarvestEntrypoint({ queueConsumers, deadLetterConsumers = {} }) {
  const harvestWorker = createHarvestWorker({ queueConsumers, deadLetterConsumers });
  return Object.freeze({
    async queue(batch) {
      return harvestWorker.queue(batch);
    },
  });
}

function retentionDurationMs(value) {
  const match = /^(\d+)\s+(second|minute|hour|day|week)s?$/.exec(value);
  invariant(match, 'WORKFLOW_RETENTION_DURATION_INVALID');
  const unit = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[match[2]];
  return Number(match[1]) * unit;
}

export function createCloudflareWorkflowPlatform({ binding, successRetention, errorRetention, maximumSupportedRetentionMs = null }) {
  invariant(typeof binding?.create === 'function' && typeof binding?.get === 'function', 'WORKFLOW_BINDING_INVALID');
  invariant(typeof successRetention === 'string' && typeof errorRetention === 'string', 'WORKFLOW_RETENTION_CONFIGURATION_INVALID');
  const configuredRetentionMs = Math.min(retentionDurationMs(successRetention), retentionDurationMs(errorRetention));
  if (maximumSupportedRetentionMs !== null) invariant(maximumSupportedRetentionMs === configuredRetentionMs, 'WORKFLOW_RETENTION_BOUND_MISMATCH');
  async function normalize(instance) {
    invariant(instance && typeof instance.status === 'function', 'WORKFLOW_INSTANCE_STATUS_PORT_INVALID');
    const statusResult = await instance.status();
    const rawStatus = typeof statusResult === 'string' ? statusResult : statusResult?.status ?? 'unknown';
    return Object.freeze({ id: instance.id, status: normalizeWorkflowPlatformState(rawStatus), raw_status: rawStatus });
  }
  return Object.freeze({
    async create({ id, params, retentionExpiresAt, requestedAt }) {
      invariant(id.length <= 100 && /^[A-Za-z0-9_][A-Za-z0-9-_]*$/.test(id), 'WORKFLOW_INSTANCE_ID_PLATFORM_UNSAFE', id);
      const requestedMs = Date.parse(requestedAt);
      const databaseExpiryMs = Date.parse(retentionExpiresAt);
      invariant(Number.isFinite(requestedMs) && Number.isFinite(databaseExpiryMs) && databaseExpiryMs > requestedMs, 'WORKFLOW_DATABASE_RETENTION_INVALID');
      invariant(databaseExpiryMs <= requestedMs + configuredRetentionMs, 'WORKFLOW_DATABASE_RETENTION_EXCEEDS_PLATFORM');
      const instance = await binding.create({ id, params, retention: { successRetention, errorRetention } });
      return Object.freeze({ ...await normalize(instance), retention_expires_at: retentionExpiresAt });
    },
    async get(id) {
      invariant(id.length <= 100 && /^[A-Za-z0-9_][A-Za-z0-9-_]*$/.test(id), 'WORKFLOW_INSTANCE_ID_PLATFORM_UNSAFE', id);
      return normalize(await binding.get(id));
    }
  });
}

export function createHarvestWorkflowEntrypoint({ workflow = null, createWorkflow = null, WorkflowEntrypointBase }) {
  invariant((typeof workflow?.run === 'function') !== (typeof createWorkflow === 'function'), 'HARVEST_WORKFLOW_FACTORY_INVALID');
  invariant(typeof WorkflowEntrypointBase === 'function', 'WORKFLOW_ENTRYPOINT_BASE_INVALID');
  return class HarvestWorkflowEntrypoint extends WorkflowEntrypointBase {
    constructor(context, env) {
      super(context, env);
      this.delegate = createWorkflow ? createWorkflow({ context, env }) : workflow;
      invariant(typeof this.delegate?.run === 'function', 'HARVEST_WORKFLOW_MISSING');
    }
    async run(event, step) { return this.delegate.run(event, step); }
  };
}
