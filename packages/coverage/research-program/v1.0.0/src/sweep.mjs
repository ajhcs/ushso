import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { membershipHash } from './completeness.mjs';

export const SWEEP_FORMAT = 'ushso.baseline-sweep-receipt.v1';
export const BASELINE_RECORD_COUNT = 3434;
export const DISPOSITIONS = Object.freeze([
  'eligible_attempted',
  'eligible_unattempted',
  'not_applicable',
  'blocked',
  'unknown_eligibility',
  'isolated',
]);
export const ISOLATED_RECORDS = Object.freeze([
  Object.freeze({ record_id: 'obs:asset:cdc-socrata:2g2d-yfx9-060a56b0e1f5e82b', reason: 'description must be a non-empty string' }),
  Object.freeze({ record_id: 'obs:asset:cdc-socrata:38b4-r9iv-82269ee71b664250', reason: 'description must be a non-empty string' }),
  Object.freeze({ record_id: 'obs:asset:cdc-socrata:4ckf-c7xz-8a5026e46b58641e', reason: 'description must be a non-empty string' }),
  Object.freeze({ record_id: 'obs:asset:cdc-socrata:va9e-d8re-c845d9bfb921e339', reason: 'description must be a non-empty string' }),
]);
export const SOURCE_ADAPTERS = Object.freeze({
  'cdc-socrata': Object.freeze({ adapter: 'packages/connectors/src/adapters/cdc-view.mjs', documentation: 'socrata-view', sample: 'bounded-json-sample' }),
  'cms-data-catalog': Object.freeze({ adapter: 'packages/connectors/src/adapters/cms.mjs', documentation: 'dcat-data-json', sample: 'bounded-json-sample' }),
  'census-api': Object.freeze({ adapter: 'packages/connectors/src/adapters/census-api.mjs', documentation: 'census-variables', sample: 'keyed-json-sample' }),
});
export const ORIGINAL_AUDIT_GAPS = Object.freeze([
  'dictionary_locator_unresolved',
  'census_key_required',
  'html_not_json_success',
  'isolated_non_searchable',
]);

export async function blockedFetch() {
  const error = new Error('SWEEP_LIVE_NETWORK_FORBIDDEN');
  error.code = 'SWEEP_LIVE_NETWORK_FORBIDDEN';
  throw error;
}

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function defaultCorpusRoot(repoRoot) {
  return path.join(repoRoot, 'packages/retrieval/versions/v1.2.0/corpus');
}

export async function loadBaselineInventory({ repoRoot, corpusRoot } = {}) {
  const root = corpusRoot ?? defaultCorpusRoot(repoRoot);
  const corpus = JSON.parse(await fs.readFile(path.join(root, 'corpus.json'), 'utf8'));
  if (corpus.record_count !== BASELINE_RECORD_COUNT) fail('CORPUS_COUNT', `expected ${BASELINE_RECORD_COUNT}, found ${corpus.record_count}`);
  const records = [];
  for (const file of corpus.record_files) {
    const stream = createReadStream(path.join(root, file), { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      records.push(freeze({
        record_id: row.record_id,
        source_id: row.identity?.source?.source_id ?? null,
        native_id: row.identity?.match_fields?.source_id ?? null,
      }));
    }
  }
  if (records.length !== BASELINE_RECORD_COUNT) fail('CORPUS_IDENTITY', `loaded ${records.length}`);
  if (new Set(records.map((row) => row.record_id)).size !== BASELINE_RECORD_COUNT) fail('CORPUS_DUPLICATE');
  return freeze({
    generation: corpus.publication?.generation ?? null,
    records: freeze(records),
    source_slices: freeze({
      'cdc-socrata': records.filter((row) => row.source_id === 'cdc-socrata').length,
      'census-api': records.filter((row) => row.source_id === 'census-api').length,
      'cms-data-catalog': records.filter((row) => row.source_id === 'cms-data-catalog').length,
    }),
  });
}

function isolatedSet() {
  return new Set(ISOLATED_RECORDS.map((row) => row.record_id));
}

export function classifyEligibility(record, { unknownIds = [], blockedIds = [], notApplicableIds = [] } = {}) {
  if (isolatedSet().has(record.record_id)) {
    return freeze({ disposition: 'isolated', attempted: false, reason: ISOLATED_RECORDS.find((row) => row.record_id === record.record_id).reason, adapter: SOURCE_ADAPTERS[record.source_id] ?? null });
  }
  if (unknownIds.includes(record.record_id)) {
    return freeze({ disposition: 'unknown_eligibility', attempted: false, reason: 'eligibility unknown; not counted as attempted', adapter: SOURCE_ADAPTERS[record.source_id] ?? null });
  }
  if (blockedIds.includes(record.record_id)) {
    return freeze({ disposition: 'blocked', attempted: false, reason: 'current source policy or credential blocks dispatch', adapter: SOURCE_ADAPTERS[record.source_id] ?? null });
  }
  if (notApplicableIds.includes(record.record_id)) {
    return freeze({ disposition: 'not_applicable', attempted: false, reason: 'operation not applicable for this source/role', adapter: SOURCE_ADAPTERS[record.source_id] ?? null });
  }
  if (!SOURCE_ADAPTERS[record.source_id]) {
    return freeze({ disposition: 'unknown_eligibility', attempted: false, reason: 'source adapter not bound', adapter: null });
  }
  return freeze({ disposition: 'eligible', attempted: false, reason: null, adapter: SOURCE_ADAPTERS[record.source_id] });
}

export function compileSweepJobs(inventory, options = {}) {
  const budget = options.budget ?? { max_attempts: 3, max_capture_charges: 3 };
  const jobs = inventory.records.map((record) => {
    const eligibility = classifyEligibility(record, options);
    return freeze({
      record_id: record.record_id,
      source_id: record.source_id,
      native_id: record.native_id,
      ...eligibility,
    });
  });
  const eligible = jobs.filter((job) => job.disposition === 'eligible');
  const queues = {
    'cdc-socrata': eligible.filter((job) => job.source_id === 'cdc-socrata'),
    'cms-data-catalog': eligible.filter((job) => job.source_id === 'cms-data-catalog'),
    'census-api': eligible.filter((job) => job.source_id === 'census-api'),
  };
  const reserved = [];
  const order = ['cdc-socrata', 'cms-data-catalog', 'census-api'];
  let cursor = 0;
  while (reserved.length < budget.max_attempts && order.some((source) => queues[source].length > 0)) {
    const source = order[cursor % order.length];
    cursor += 1;
    if (!queues[source].length) continue;
    reserved.push(freeze({ ...queues[source].shift(), reserved: true }));
  }
  const reservedIds = new Set(reserved.map((job) => job.record_id));
  const unreserved = eligible.filter((job) => !reservedIds.has(job.record_id)).map((job) => freeze({
    ...job,
    disposition: 'eligible_unattempted',
    reserved: false,
    reason: 'eligible but outside reserved budget',
  }));
  const compiled = [
    ...jobs.filter((job) => job.disposition !== 'eligible'),
    ...reserved.map((job) => freeze({ ...job, disposition: 'eligible_attempted' })),
    ...unreserved,
  ].sort((left, right) => left.record_id.localeCompare(right.record_id));
  const counts = Object.fromEntries(DISPOSITIONS.map((name) => [name, compiled.filter((job) => job.disposition === name).length]));
  const sum = Object.values(counts).reduce((total, n) => total + n, 0);
  if (sum !== inventory.records.length) fail('DISPOSITION_SUM', `${sum} !== ${inventory.records.length}`);
  if (counts.unknown_eligibility > 0 && compiled.some((job) => job.disposition === 'unknown_eligibility' && job.attempted === true)) {
    fail('UNKNOWN_COUNTED_AS_ATTEMPTED');
  }
  return freeze({
    format: 'ushso.baseline-sweep-jobs.v1',
    record_count: inventory.records.length,
    jobs: freeze(compiled),
    counts: freeze(counts),
    budget: freeze(budget),
    reserved_attempts: reserved.length,
    unknown_not_attempted: compiled.filter((job) => job.disposition === 'unknown_eligibility').every((job) => job.attempted === false),
    live_source_traffic: false,
  });
}

export function runResumableBatch(compiled, { stopAfter = null, priorCharges = [], captures = {} } = {}) {
  const charges = [...priorCharges];
  const outcomes = [];
  const queues = { format_exception: [], access_exception: [] };
  let processed = 0;
  for (const job of compiled.jobs) {
    if (job.disposition !== 'eligible_attempted') {
      outcomes.push(freeze({ record_id: job.record_id, disposition: job.disposition, capture_charged: false, reused: false }));
      continue;
    }
    if (stopAfter !== null && processed >= stopAfter) {
      outcomes.push(freeze({ record_id: job.record_id, disposition: 'eligible_unattempted', capture_charged: false, reused: false, deferred: true }));
      continue;
    }
    const prior = captures[job.record_id];
    const reused = Boolean(prior && prior.unchanged === true);
    if (!reused) charges.push(job.record_id);
    if (job.source_id === 'census-api') queues.access_exception.push(job.record_id);
    outcomes.push(freeze({
      record_id: job.record_id,
      disposition: 'eligible_attempted',
      capture_charged: !reused,
      reused,
      next: job.source_id === 'census-api' ? 'census_key_required' : 'bounded_sample',
    }));
    processed += 1;
  }
  const membership = outcomes.map((row) => row.record_id).sort();
  return freeze({
    outcomes: freeze(outcomes),
    membership: freeze(membership),
    capture_charges: freeze([...charges]),
    queues: freeze({
      format_exception: freeze([...queues.format_exception]),
      access_exception: freeze([...queues.access_exception]),
    }),
    duplicate_capture_charges: charges.length !== new Set(charges).size,
    live_source_traffic: false,
  });
}

export function resumeBatch(compiled, partial, captures = {}) {
  const remainingStop = compiled.jobs.filter((job) => job.disposition === 'eligible_attempted').length;
  return runResumableBatch(compiled, {
    stopAfter: remainingStop,
    priorCharges: partial.capture_charges,
    captures: {
      ...Object.fromEntries(partial.outcomes.filter((row) => row.capture_charged || row.reused).map((row) => [row.record_id, { unchanged: true }])),
      ...captures,
    },
  });
}

export function writeDeficitManifest(compiled, batch, { originalGaps = ORIGINAL_AUDIT_GAPS } = {}) {
  const remainingEligible = compiled.jobs.filter((job) => job.disposition === 'eligible_unattempted' || (job.disposition === 'eligible_attempted' && batch.outcomes.find((row) => row.record_id === job.record_id)?.deferred === true));
  const rows = compiled.jobs.map((job) => {
    const outcome = batch.outcomes.find((row) => row.record_id === job.record_id);
    let nextAction = 'none';
    let cause = job.disposition;
    if (job.disposition === 'isolated') { nextAction = 'retain_non_searchable'; cause = 'isolated_non_searchable'; }
    else if (job.disposition === 'unknown_eligibility') { nextAction = 'resolve_eligibility'; cause = 'unknown_eligibility'; }
    else if (job.disposition === 'blocked') { nextAction = 'satisfy_source_policy'; cause = 'blocked_policy'; }
    else if (job.disposition === 'not_applicable') { nextAction = 'none'; cause = 'not_applicable'; }
    else if (job.source_id === 'census-api' && job.disposition === 'eligible_attempted') { nextAction = 'supply_census_key_via_secret_provider'; cause = 'census_key_required'; }
    else if (job.disposition === 'eligible_unattempted' || outcome?.deferred) { nextAction = 'dispatch_within_budget'; cause = 'eligible_unattempted'; }
    else if (job.source_id === 'cms-data-catalog') { nextAction = 'retain_unresolved_dictionary_locator'; cause = 'dictionary_locator_unresolved'; }
    else if (job.source_id === 'cdc-socrata') { nextAction = 'keep_html_from_json_success'; cause = 'html_not_json_success'; }
    return freeze({
      record_id: job.record_id,
      source_id: job.source_id,
      disposition: outcome?.disposition ?? job.disposition,
      cause,
      next_action: nextAction,
    });
  });
  const byCause = {};
  for (const row of rows) byCause[row.cause] = (byCause[row.cause] ?? 0) + 1;
  const observedGaps = originalGaps.filter((gap) => rows.some((row) => row.cause === gap));
  const complete = remainingEligible.length === 0 && compiled.counts.eligible_unattempted === 0;
  if (complete && compiled.counts.eligible_unattempted > 0) fail('COMPLETION_WHILE_UNATTEMPTED');
  return freeze({
    format: 'ushso.baseline-deficit-manifest.v1',
    record_count: rows.length,
    rows: freeze(rows),
    counts_by_cause: freeze(byCause),
    original_audit_gaps_observed: freeze(observedGaps),
    all_original_gaps_have_disposition: originalGaps.every((gap) => observedGaps.includes(gap) || rows.some((row) => row.cause === gap)),
    unattempted_eligible: remainingEligible.length,
    completion_asserted: false,
    completion_allowed: complete,
    priority_cohort_impact: freeze({
      isolated: compiled.counts.isolated,
      census_key_required: rows.filter((row) => row.cause === 'census_key_required').length,
      unknown_eligibility: compiled.counts.unknown_eligibility,
    }),
    live_source_traffic: false,
  });
}

export function buildSweepReceipt({ inventory, compiled, batch, deficits }) {
  const ids = compiled.jobs.map((job) => job.record_id).sort();
  if (ids.length !== BASELINE_RECORD_COUNT) fail('RECEIPT_COUNT');
  if (new Set(ids).size !== BASELINE_RECORD_COUNT) fail('RECEIPT_DUPLICATE');
  const membership = inventory.records.map((row) => ({
    record_id: row.record_id,
    source_id: row.source_id,
    isolated: isolatedSet().has(row.record_id),
    isolation_reason: ISOLATED_RECORDS.find((item) => item.record_id === row.record_id)?.reason ?? null,
    evidence_ids: [`corpus:${row.record_id}`],
    source_observed_at: null,
  }));
  return freeze({
    format: SWEEP_FORMAT,
    record_count: BASELINE_RECORD_COUNT,
    ids: freeze(ids),
    counts: compiled.counts,
    source_slices: inventory.source_slices,
    membership_hash: membershipHash(membership),
    capture_charges: batch.capture_charges.length,
    duplicate_capture_charges: batch.duplicate_capture_charges,
    unknown_not_attempted: compiled.unknown_not_attempted,
    completion_asserted: deficits.completion_asserted,
    all_ids_present: ids.length === BASELINE_RECORD_COUNT,
    live_source_traffic: false,
    publication_authorized: false,
    scientific_qualification: false,
  });
}

export async function runFixtureSweep(options = {}) {
  const repoRoot = options.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
  const inventory = options.inventory ?? await loadBaselineInventory({ repoRoot, corpusRoot: options.corpusRoot });
  const compiled = compileSweepJobs(inventory, options);
  const partial = runResumableBatch(compiled, { stopAfter: options.stopAfter ?? 1, captures: options.captures ?? {} });
  const resumed = resumeBatch(compiled, partial, options.captures ?? {});
  const uninterrupted = runResumableBatch(compiled, { captures: options.captures ?? {} });
  const deficits = writeDeficitManifest(compiled, resumed);
  const receipt = buildSweepReceipt({ inventory, compiled, batch: resumed, deficits });
  return freeze({ inventory, compiled, partial, resumed, uninterrupted, deficits, receipt });
}
