// Additive Worker composition boundary for WP12. This module intentionally has
// no fetch handler, bindings, persistence, or source-network capability.
import { assertCanonicalService, createMachineToolkit } from '../packages/machine-toolkit/src/index.mjs';

export function createWorkerMachineToolkit({ operations, responseContext, clock, requestId, cryptoProvider }) {
  const service = assertCanonicalService(operations);
  return createMachineToolkit({ service, responseContext, clock, requestId, cryptoProvider });
}
