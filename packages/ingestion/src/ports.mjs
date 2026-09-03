import { requirePort } from './common.mjs';

export const PORT_METHODS = Object.freeze({
  controlStore: ['transaction', 'leaseDueSources', 'ensureRunAndWorkflowOutbox', 'recordScheduleDispatchFailure', 'leaseOutbox', 'loadQueueRouting', 'markOutboxPublished', 'markOutboxRetry', 'markOutboxDead', 'getWorkflowStart', 'listWorkflowRetentionRisks', 'listActiveWorkflowMappings', 'recordWorkflowMapping', 'updateWorkflowMappingState', 'markWorkflowStartResolved', 'markWorkflowStartDead', 'failRunForWorkflowControl', 'failRunForExpiredWorkflow', 'loadRunForWorkflow', 'ensureInitialPageJob', 'readEnumerationBarrier', 'commitCheckpointAndNormalizationOutbox', 'readNormalizationBarrier', 'requestProjection', 'readProjectionBarrier', 'recordCoverageAndCompleteRun', 'markRunPartialUnpublished', 'prepareEventDelivery', 'processEventOnce', 'recordAttemptFailure', 'recordTerminalOutcome', 'recordTransportLossAttempt', 'reledgerRetry', 'listExpiredQueueDeliveries', 'reledgerExpiredQueueDelivery', 'persistDurableDeadLetter', 'getDeadLetter', 'getDeadLetterByOriginalEvent', 'loadDeadLetterEvidence', 'recordDeadLetterTransportExhaustionObservation', 'listDeadLetterRecoveryCandidates', 'markDeadLetterSinkCommitted', 'createReplay', 'requestSourcePause', 'drainSource', 'resumeSource', 'canSourceFetch', 'consumeOriginTokens', 'acquireOriginPermit', 'recordCircuitFailure', 'recordCircuitSuccess', 'loadCircuit', 'listGcDependencies', 'recordGcProof', 'deleteGcPartition', 'appendAudit'],
  queueProducer: ['send'],
  workflowPlatform: ['create', 'get'],
  logger: ['emit'],
  databaseClient: ['close']
});

export function assertControlStore(port) { return requirePort(port, PORT_METHODS.controlStore, 'controlStore'); }
export function assertQueueProducer(port) { return requirePort(port, PORT_METHODS.queueProducer, 'queueProducer'); }
export function assertWorkflowPlatform(port) { return requirePort(port, PORT_METHODS.workflowPlatform, 'workflowPlatform'); }
export function assertLogger(port) { return requirePort(port, PORT_METHODS.logger, 'logger'); }

export async function withFreshDatabaseClient(openDatabase, work) {
  const client = await openDatabase();
  requirePort(client, PORT_METHODS.databaseClient, 'databaseClient');
  try { return await work(client); }
  finally { await client.close(); }
}
