import { canonicalJson, deterministicId, sha256 } from './canonical.mjs';

function requestKey(request) {
  return sha256(canonicalJson(request));
}

function discoveryKey(sourceId, namespace, nativeId) {
  return `${sourceId}\u0000${namespace}\u0000${nativeId}`;
}

export class DeterministicConnectorRunner {
  constructor({ httpClient, runRepository, clock = () => new Date(), crashInjector = null }) {
    if (!httpClient?.execute || !runRepository?.beginRun || !runRepository?.commitPage || !runRepository?.sealEnumeration || !runRepository?.commitMembershipAndCheckpoint) {
      throw new TypeError('Runner requires HTTP and durable run-state ports.');
    }
    this.httpClient = httpClient;
    this.runRepository = runRepository;
    this.clock = clock;
    this.crashInjector = crashInjector;
  }

  async run({ connector, checkpoint = null, runId, scheduledSlot, mode, attempt = 1 }) {
    const descriptor = connector.descriptor();
    const plan = await connector.plan(checkpoint, { scheduledSlot, mode, createdAt: scheduledSlot });
    const runState = await this.runRepository.beginRun({ runId, attempt, descriptor, plan, checkpoint });
    if (runState.failed) {
      return { outcome: 'partial_unpublished', sealed: false, checkpointCommitted: false, failure: runState.failed };
    }
    if (descriptor.source_state !== 'active') {
      const failure = {
        failure_type: 'policy_blocked', retry_class: 'pause_source', target_class: 'collection',
        safe_detail_code: 'SOURCE_NOT_ACTIVE', http_status: null, observed_at: this.clock().toISOString(),
      };
      await this.runRepository.failRun(runId, failure);
      return { outcome: 'partial_unpublished', sealed: false, checkpointCommitted: false, failure };
    }
    let resume = await this.runRepository.getResume(runId);
    let request = resume ? resume.nextRequest : connector.initialRequest(plan, resume);
    let pageIndex = resume?.nextPageIndex ?? 0;

    while (request) {
      if (pageIndex >= plan.bounded_by.maximum_pages || this.clock().getTime() > new Date(plan.bounded_by.deadline_at).getTime()) {
        const failure = {
          failure_type: 'policy_blocked', retry_class: 'enumeration_terminal', target_class: request.targetClass,
          safe_detail_code: pageIndex >= plan.bounded_by.maximum_pages ? 'MAXIMUM_PAGES_EXCEEDED' : 'RUN_DEADLINE_EXCEEDED',
          http_status: null, observed_at: this.clock().toISOString(),
        };
        await this.runRepository.failRun(runId, failure);
        return { outcome: 'partial_unpublished', sealed: false, checkpointCommitted: false, failure };
      }
      const key = requestKey(request);
      const alreadyCommitted = await this.runRepository.getCommittedPage(runId, key);
      if (alreadyCommitted) {
        request = alreadyCommitted.nextRequest;
        pageIndex = alreadyCommitted.pageIndex + 1;
        continue;
      }
      await this.crashInjector?.('before_page_fetch', { runId, pageIndex, request });
      const conditional = await this.runRepository.conditionalFor(runId, key);
      const fetch = await this.httpClient.execute({
        descriptor,
        request,
        runId,
        jobId: deterministicId('job', { runId, key }),
        validators: conditional?.validators ?? null,
        priorCaptureRefId: conditional?.priorCaptureRefId ?? null,
        responseProfile: connector.responseProfile(),
      });
      if (fetch.outcome === 'typed_failure') {
        await this.runRepository.failRun(runId, fetch.failure);
        return { outcome: 'partial_unpublished', sealed: false, checkpointCommitted: false, failure: fetch.failure };
      }
      await this.crashInjector?.('after_fetch_before_page_commit', { runId, pageIndex, fetch });
      let parsedPage;
      if (fetch.outcome === 'not_modified') {
        parsedPage = await this.runRepository.reuseCapturePage(fetch.metadataFetch.reused_capture_ref_id);
        if (!parsedPage) {
          const failure = {
            failure_type: 'canonical_invariant_failure', retry_class: 'quarantine', target_class: request.targetClass,
            safe_detail_code: 'NOT_MODIFIED_CAPTURE_NOT_REUSABLE', http_status: 304, observed_at: this.clock().toISOString(),
          };
          await this.runRepository.failRun(runId, failure);
          return { outcome: 'partial_unpublished', sealed: false, checkpointCommitted: false, failure };
        }
      } else {
        try {
          parsedPage = connector.parsePage({
            parsed: fetch.parsed,
            bodyBytes: fetch.bodyBytes,
            capture: fetch.capture,
            request,
          });
        } catch {
          const failure = {
            failure_type: 'schema_drift', retry_class: 'quarantine', target_class: request.targetClass,
            safe_detail_code: 'ADAPTER_PAGE_PARSE_FAILED', http_status: 200, observed_at: this.clock().toISOString(),
          };
          await this.runRepository.failRun(runId, failure);
          return { outcome: 'partial_unpublished', sealed: false, checkpointCommitted: false, failure };
        }
      }
      const committed = await this.runRepository.commitPage({
        runId, pageKey: key, pageIndex, request, fetch,
        observations: parsedPage.observations,
        nextRequest: parsedPage.nextRequest,
        cursor: parsedPage.cursor,
      });
      await this.crashInjector?.('after_page_commit_before_resume', { runId, pageIndex, committed });
      request = committed.nextRequest;
      pageIndex += 1;
    }

    const seal = await this.runRepository.sealEnumeration(runId);
    await this.crashInjector?.('after_seal_before_checkpoint_commit', { runId, seal });
    if (!seal.sealed) {
      return { outcome: 'partial_unpublished', sealed: false, checkpointCommitted: false, failure: seal.failure };
    }
    const proposal = connector.proposeCheckpoint({
      sealed: true,
      failure: null,
      cursorExpired: false,
      items: seal.observations,
      committedCursorRefId: seal.committedCursorRefId,
      fullEnumerationSequence: seal.fullEnumerationSequence,
    });
    const committed = await this.runRepository.commitMembershipAndCheckpoint({
      runId,
      sourceId: descriptor.source_id,
      scopeId: plan.scope_ids[0],
      configurationRevision: descriptor.configuration_revision,
      mode: plan.mode,
      priorCheckpoint: checkpoint,
      proposal,
      seal,
      downstreamEffects: seal.observations.map((observation) => ({
        eventId: deterministicId('event', { runId, nativeId: observation.nativeId, revision: observation.sourceRevision }),
        eventType: 'normalize_record_requested',
        captureRefId: observation.sourceLocator.captureRefId,
        discoveryKey: discoveryKey(descriptor.source_id, descriptor.native_identifier.namespace, observation.nativeId),
      })),
    });
    await this.crashInjector?.('after_checkpoint_transaction', { runId, committed });
    return {
      outcome: 'succeeded',
      sealed: true,
      checkpointCommitted: true,
      checkpoint: committed.checkpoint,
      membership: committed.membership,
      seal,
      failure: null,
    };
  }
}

export { requestKey as connectorRequestKey };
