import { createHarvestEntrypoint, createHarvestWorkflowEntrypoint } from './index.mjs';

// The checked-in foundation remains inert until an authorized environment
// supplies the Queue consumers and Workflow runtime base. These factories are
// the reviewed composition seams; they perform no binding or secret lookup.
export function createHarvestWorkerEntrypoint(dependencies) {
  return createHarvestEntrypoint(dependencies);
}

export function createHarvestWorkflowClass({ workflow = null, createWorkflow = null, WorkflowEntrypointBase }) {
  return createHarvestWorkflowEntrypoint({ workflow, createWorkflow, WorkflowEntrypointBase });
}

function retryDisabledBatch(batch) {
  for (const message of batch?.messages ?? []) message.retry({ delaySeconds: 60 });
  return Object.freeze((batch?.messages ?? []).map(message => Object.freeze({
    eventId: message.body?.event_id,
    action: 'retry',
    reason: 'WP4_HARVEST_COMPOSITION_DISABLED',
  })));
}

const disabledHarvest = Object.freeze({
  async queue(batch) {
    return retryDisabledBatch(batch);
  },
  // The authorized composition supplies the concrete Harvest Workflow class
  // through createHarvestWorkflowClass; no runtime class is enabled here.
  Workflow: null,
});

export default disabledHarvest;
