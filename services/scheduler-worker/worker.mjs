import { createSchedulerEntrypoint } from './index.mjs';

// The checked-in foundation remains inert until an authorized environment
// provides all least-privilege ports. Keeping the default handler disabled is
// an explicit safety boundary, not managed-integration evidence.
export function createSchedulerWorkerEntrypoint(dependencies) {
  return createSchedulerEntrypoint(dependencies);
}

const disabledScheduler = Object.freeze({
  async scheduled() {
    throw new Error('WP4_SCHEDULER_COMPOSITION_DISABLED');
  },
});

export default disabledScheduler;
