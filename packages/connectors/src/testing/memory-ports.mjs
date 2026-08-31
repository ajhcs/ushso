import { asBytes, canonicalJson, deterministicId, sha256 } from '../canonical.mjs';
import { classifyDeletionEvidence } from '../deletion-policy.mjs';
import { assertPinnedTransportRequest } from '../pinned-streaming-transport.mjs';

export class FixtureDnsResolver {
  constructor(records = {}, defaultAddresses = ['93.184.216.34']) {
    this.records = new Map(Object.entries(records));
    this.defaultAddresses = defaultAddresses;
    this.calls = [];
  }

  async resolve(hostname) {
    this.calls.push(hostname);
    const value = this.records.get(hostname) ?? this.defaultAddresses;
    if (typeof value === 'function') return value(this.calls.filter((host) => host === hostname).length);
    return [...value];
  }
}

export class FixtureTransport {
  constructor(routes = new Map()) {
    this.routes = routes instanceof Map ? routes : new Map(Object.entries(routes));
    this.calls = [];
  }

  add(method, url, response) {
    const key = `${method} ${url}`;
    const queue = this.routes.get(key) ?? [];
    queue.push(response);
    this.routes.set(key, queue);
    return this;
  }

  async send(request) {
    assertPinnedTransportRequest(request, 'collection');
    this.calls.push(structuredClone({ ...request, headers: Object.fromEntries(request.headers) }));
    const key = `${request.method} ${request.url}`;
    const queue = this.routes.get(key);
    if (!queue?.length) throw Object.assign(new Error(`No fixture response for ${key}`), { code: 'ENOTFOUND' });
    const fixture = queue.shift();
    if (fixture instanceof Error) throw fixture;
    const bodyBytes = asBytes(fixture.bodyBytes ?? '');
    const wireBytes = asBytes(fixture.wireBytes ?? bodyBytes);
    return {
      status: fixture.status ?? 200,
      headers: fixture.headers ?? { 'content-type': 'application/json', 'content-length': String(wireBytes.byteLength) },
      bodyBytes,
      wireBytes,
      connectedAddress: fixture.connectedAddress ?? request.approvedAddresses[0],
    };
  }
}

export class MemoryRequestLedger {
  constructor() { this.records = []; }
  async append(record) {
    if ('authorization' in record || 'cookie' in record || 'body' in record) throw new Error('Unsafe request-ledger field.');
    this.records.push(structuredClone(record));
    return record;
  }
}

export class MemoryObjectStore {
  constructor() { this.objects = new Map(); this.putCalls = []; }
  async putIfAbsent(key, bytesInput, options) {
    const bytes = asBytes(bytesInput);
    const digest = sha256(bytes);
    if (digest !== options.sha256) throw new Error('Object checksum does not match the requested checksum.');
    this.putCalls.push({ key, sha256: digest, size: bytes.byteLength, options: structuredClone(options) });
    const existing = this.objects.get(key);
    if (existing && existing.sha256 !== digest) throw new Error('Content-addressed key collision.');
    if (!existing) this.objects.set(key, { key, bytes: new Uint8Array(bytes), sha256: digest, size: bytes.byteLength, options: structuredClone(options) });
    return { key, sha256: digest, size: bytes.byteLength, created: !existing };
  }
}

export class MemoryCaptureReferenceStore {
  constructor() { this.references = new Map(); this.commitCalls = []; }
  async commit(reference) {
    this.commitCalls.push(reference.capture_ref_id);
    const existing = this.references.get(reference.capture_ref_id);
    if (existing && canonicalJson(existing) !== canonicalJson(reference)) throw new Error('Capture-reference idempotency conflict.');
    if (!existing) this.references.set(reference.capture_ref_id, structuredClone(reference));
    return structuredClone(this.references.get(reference.capture_ref_id));
  }
}

export class MemoryRunRepository {
  constructor({ requiredCompleteMisses = 2, failCheckpointTransaction = false } = {}) {
    this.runs = new Map();
    this.reusableCaptures = new Map();
    this.memberships = new Map();
    this.checkpoints = new Map();
    this.requiredCompleteMisses = requiredCompleteMisses;
    this.failCheckpointTransaction = failCheckpointTransaction;
    this.conditionals = new Map();
  }

  async beginRun(input) {
    const existing = this.runs.get(input.runId);
    if (existing) {
      if (canonicalJson(existing.plan) !== canonicalJson(input.plan)) throw new Error('Run plan changed across resume.');
      return structuredClone(existing);
    }
    const run = { ...structuredClone(input), pages: new Map(), failed: null, seal: null, checkpointCommitted: false };
    this.runs.set(input.runId, run);
    return structuredClone({ ...run, pages: [] });
  }

  setConditional(runId, pageKey, conditional) {
    this.conditionals.set(`${runId}:${pageKey}`, structuredClone(conditional));
  }

  async conditionalFor(runId, pageKey) {
    return structuredClone(this.conditionals.get(`${runId}:${pageKey}`) ?? null);
  }

  async getResume(runId) {
    const run = this.runs.get(runId);
    const pages = [...run.pages.values()].sort((a, b) => a.pageIndex - b.pageIndex);
    const last = pages.at(-1);
    return last ? { nextRequest: structuredClone(last.nextRequest), nextPageIndex: last.pageIndex + 1 } : null;
  }

  async getCommittedPage(runId, pageKey) {
    return structuredClone(this.runs.get(runId).pages.get(pageKey) ?? null);
  }

  async commitPage(input) {
    const run = this.runs.get(input.runId);
    if (run.failed || run.seal) throw new Error('Cannot commit a page to a failed or sealed run.');
    const value = {
      pageKey: input.pageKey, pageIndex: input.pageIndex, request: structuredClone(input.request),
      captureRefId: input.fetch.capture?.capture_ref_id ?? input.fetch.metadataFetch?.reused_capture_ref_id,
      observations: structuredClone(input.observations), nextRequest: structuredClone(input.nextRequest), cursor: input.cursor,
    };
    const existing = run.pages.get(input.pageKey);
    if (existing && canonicalJson(existing) !== canonicalJson(value)) throw new Error('Page idempotency conflict.');
    if (!existing) run.pages.set(input.pageKey, value);
    if (value.captureRefId) this.reusableCaptures.set(value.captureRefId, { observations: value.observations, nextRequest: value.nextRequest, cursor: value.cursor });
    return structuredClone(run.pages.get(input.pageKey));
  }

  async reuseCapturePage(captureRefId) {
    return structuredClone(this.reusableCaptures.get(captureRefId) ?? null);
  }

  seedReusableCapture(captureRefId, page) {
    this.reusableCaptures.set(captureRefId, structuredClone(page));
  }

  async failRun(runId, failure) {
    const run = this.runs.get(runId);
    run.failed = structuredClone(failure);
  }

  async sealEnumeration(runId) {
    const run = this.runs.get(runId);
    if (run.failed) return { sealed: false, failure: structuredClone(run.failed) };
    if (run.seal) return structuredClone(run.seal);
    const pages = [...run.pages.values()].sort((a, b) => a.pageIndex - b.pageIndex);
    if (pages.length === 0 || pages.some((page, index) => page.pageIndex !== index) || pages.at(-1).nextRequest !== null) {
      return { sealed: false, failure: { failure_type: 'canonical_invariant_failure', safe_detail_code: 'PAGE_CHAIN_INCOMPLETE' } };
    }
    const observationsById = new Map();
    let logicalDuplicates = 0;
    for (const observation of pages.flatMap((page) => page.observations)) {
      const existing = observationsById.get(observation.nativeId);
      if (existing) {
        logicalDuplicates += 1;
        const existingTuple = `${existing.publisherModifiedAt ?? ''}\u0000${existing.sourceRevision}`;
        const candidateTuple = `${observation.publisherModifiedAt ?? ''}\u0000${observation.sourceRevision}`;
        if (candidateTuple > existingTuple) observationsById.set(observation.nativeId, observation);
      } else observationsById.set(observation.nativeId, observation);
    }
    const observations = [...observationsById.values()].sort((a, b) => a.nativeId.localeCompare(b.nativeId));
    const seal = {
      sealed: true,
      enumerationSealId: deterministicId('seal', { runId, population: observations.map((item) => [item.nativeId, item.sourceRevision]) }),
      pagesDiscovered: pages.length,
      pagesCommitted: pages.length,
      observations,
      itemsDiscovered: pages.reduce((total, page) => total + page.observations.length, 0),
      discoveriesCommitted: observations.length,
      logicalDuplicates,
      populationDigest: sha256(canonicalJson(observations.map((item) => [item.nativeId, item.sourceRevision]))),
      committedCursorRefId: pages.at(-1).cursor ? deterministicId('cursor', { runId, cursor: pages.at(-1).cursor }) : null,
      fullEnumerationSequence: 1,
    };
    run.seal = structuredClone(seal);
    return structuredClone(seal);
  }

  async commitMembershipAndCheckpoint(input) {
    const run = this.runs.get(input.runId);
    if (!input.seal.sealed || run.failed) throw new Error('Unsealed enumeration cannot advance membership or checkpoint.');
    if (input.downstreamEffects.length !== input.seal.observations.length) throw new Error('Checkpoint requires durable downstream work for every discovery.');
    if (this.failCheckpointTransaction) throw new Error('Injected downstream/outbox transaction failure.');
    if (run.checkpointCommitted) return structuredClone(run.commitResult);

    const current = new Map(this.memberships.get(input.sourceId) ?? []);
    const seen = new Set();
    for (const observation of input.seal.observations) {
      seen.add(observation.nativeId);
      const prior = current.get(observation.nativeId);
      const isLate = prior?.publisherModifiedAt && observation.publisherModifiedAt &&
        String(observation.publisherModifiedAt).localeCompare(String(prior.publisherModifiedAt)) < 0;
      if (isLate && !observation.tombstone) {
        current.set(observation.nativeId, { ...prior, lateObservationCount: (prior.lateObservationCount ?? 0) + 1 });
        continue;
      }
      const deletion = classifyDeletionEvidence({ explicitTombstone: observation.tombstone, targetClass: 'exact_item', requiredCompleteMisses: this.requiredCompleteMisses });
      current.set(observation.nativeId, {
        nativeId: observation.nativeId,
        sourceRevision: observation.sourceRevision,
        publisherModifiedAt: observation.publisherModifiedAt,
        captureRefId: observation.sourceLocator.captureRefId,
        state: deletion.disposition === 'withdraw_item' ? 'withdrawn' : 'active',
        consecutiveCompleteMisses: 0,
        deletionReason: deletion.disposition === 'withdraw_item' ? deletion.reason : null,
        lateObservationCount: prior?.lateObservationCount ?? 0,
      });
      if (prior?.state === 'withdrawn' && !observation.tombstone) current.get(observation.nativeId).state = 'active';
    }
    if (input.mode === 'full_membership') {
      for (const [nativeId, membership] of current) {
        if (seen.has(nativeId) || membership.state === 'withdrawn') continue;
        const misses = membership.consecutiveCompleteMisses + 1;
        const deletion = classifyDeletionEvidence({ targetClass: 'exact_item', consecutiveCompleteMisses: misses, requiredCompleteMisses: this.requiredCompleteMisses });
        current.set(nativeId, {
          ...membership,
          state: deletion.disposition === 'withdraw_item' ? 'withdrawn' : 'active',
          consecutiveCompleteMisses: misses,
          deletionReason: deletion.disposition === 'withdraw_item' ? deletion.reason : null,
        });
      }
    }

    const position = input.proposal.position;
    const checkpointCore = {
      contract_version: 'ingestion.v1.0.0',
      checkpoint_id: deterministicId('checkpoint', { runId: input.runId, position }),
      source_id: input.sourceId,
      scope_id: input.scopeId,
      configuration_revision: input.configurationRevision,
      strategy: input.proposal.strategy,
      position,
      state: 'committed',
      prior_checkpoint_id: input.priorCheckpoint?.checkpoint_id ?? null,
      prior_checkpoint_digest: input.priorCheckpoint?.checkpoint_digest ?? null,
      proposed_by_run_id: input.runId,
      enumeration_seal_id: input.seal.enumerationSealId,
      downstream_outbox_committed: true,
      committed_at: new Date(run.plan.scheduled_slot).toISOString(),
      superseded_at: null,
    };
    const checkpoint = { ...checkpointCore, checkpoint_digest: sha256(canonicalJson(checkpointCore)) };
    this.memberships.set(input.sourceId, current);
    this.checkpoints.set(input.sourceId, checkpoint);
    run.checkpointCommitted = true;
    run.commitResult = {
      checkpoint,
      membership: [...current.values()].sort((a, b) => a.nativeId.localeCompare(b.nativeId)),
      downstreamEffects: structuredClone(input.downstreamEffects),
    };
    return structuredClone(run.commitResult);
  }
}
