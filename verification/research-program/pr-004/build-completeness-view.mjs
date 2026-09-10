#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCompletenessView } from '../../../packages/coverage/research-program/v1.0.0/src/completeness.mjs';
import { buildAccessSummary } from '../../../packages/normalization/src/field-observation.mjs';
import { createFieldObservation } from '../../../packages/normalization/src/field-observation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTPUT = path.join(ROOT, 'verification/research-program/pr-004/completeness-view.json');
const BASELINE_PATH = path.join(ROOT, 'docs/research-program/baseline.json');
const COHORTS_PATH = path.join(ROOT, 'evaluation/research-program/cohorts.json');
const OBSERVED_AT = '2026-09-03T22:22:33.908Z';
const AS_OF = '2026-09-10T15:32:40.000Z';

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function evidenceRefs(row) {
  return row.evidence_ids.map(evidenceId => ({
    evidence_id: evidenceId,
    evidence_state: 'documented',
    observed_at: OBSERVED_AT,
    source_locator: null,
    claim_paths: ['/corpus/baseline_records'],
    staleness_state: 'unknown'
  }));
}

function observation({ row, fieldId, fieldRole, unit, value, valueState, applicabilityState, attemptState, operation, reason }) {
  const refs = evidenceRefs(row);
  const attemptedAt = attemptState === 'not_attempted' ? null : OBSERVED_AT;
  return createFieldObservation({
    record_id: row.record_id,
    source_id: row.source_id,
    field_id: fieldId,
    field_role: fieldRole,
    unit,
    value,
    value_state: valueState,
    evidence_state: 'documented',
    applicability_state: applicabilityState,
    attempt_state: attemptState,
    endpoint_scope: { endpoint_id: `endpoint:${row.source_id}:corpus`, resource: 'published-corpus-record', operation },
    evidence_refs: refs,
    reason_codes: [reason],
    source_observed_at: OBSERVED_AT,
    observed_at: OBSERVED_AT,
    recorded_at: AS_OF,
    attempted_at: attemptedAt,
    access_facts: {
      credential_requirements: [],
      cost: { state: 'unknown', amount: null, currency: null, evidence_refs: refs, observed_at: OBSERVED_AT },
      usage_limit: { state: 'unknown', limit: null, unit: null, evidence_refs: refs, observed_at: OBSERVED_AT },
      evidence_refs: refs,
      observed_at: OBSERVED_AT
    }
  });
}

const baseline = await readJson(BASELINE_PATH);
const cohorts = await readJson(COHORTS_PATH);
if (baseline.corpus.record_count !== 3434 || cohorts.baseline_records.length !== 3434) throw new Error('BASELINE_RECORD_COUNT_MISMATCH');
if (!cohorts.baseline_records.every(row => typeof row.native_id === 'string' && row.native_id.length > 0)) throw new Error('NATIVE_ID_REQUIRED');
const isolatedReasons = new Map(baseline.corpus.isolated_records.map(row => [row.record_id, row.reason]));
const membership = cohorts.baseline_records.map(row => ({
  record_id: row.record_id,
  source_id: row.source_id,
  isolated: row.isolated === true,
  isolation_reason: isolatedReasons.get(row.record_id) ?? null,
  evidence_ids: row.evidence_ids,
  source_observed_at: OBSERVED_AT
}));
const observations = [];
for (const row of cohorts.baseline_records) {
  const refs = evidenceRefs(row);
  observations.push(observation({
    row,
    fieldId: 'record.identifier',
    fieldRole: 'identifier',
    unit: null,
    value: { kind: 'identifier', value: row.native_id },
    valueState: 'known',
    applicabilityState: 'supported',
    attemptState: 'succeeded',
    operation: 'metadata_read',
    reason: 'source_metadata_identity_observed'
  }));
  observations.push(observation({
    row,
    fieldId: 'record.title',
    fieldRole: 'metadata',
    unit: null,
    value: { kind: 'unknown', value: null },
    valueState: 'unknown',
    applicabilityState: 'supported',
    attemptState: 'not_attempted',
    operation: 'metadata_read',
    reason: 'metadata_value_not_materialized'
  }));
  observations.push(observation({
    row,
    fieldId: 'payload.access',
    fieldRole: 'metadata',
    unit: null,
    value: { kind: 'unknown', value: null },
    valueState: 'unknown',
    applicabilityState: 'unknown',
    attemptState: 'not_attempted',
    operation: 'payload_read',
    reason: 'payload_access_not_tested'
  }));
  observations.push(observation({
    row,
    fieldId: 'schema.applicability',
    fieldRole: 'metadata',
    unit: null,
    value: { kind: 'unknown', value: null },
    valueState: 'unknown',
    applicabilityState: 'unknown',
    attemptState: 'not_attempted',
    operation: 'schema_read',
    reason: 'schema_applicability_not_qualified'
  }));
}
const view = buildCompletenessView({
  membership,
  observations,
  fieldDefinitions: [
    { field_id: 'record.identifier', field_role: 'identifier', unit: null, required_for_readiness: true, description: 'Publisher-native identifier; record_id remains the stable USHSO observation identifier.' },
    { field_id: 'record.title', field_role: 'metadata', unit: null, required_for_readiness: false, description: 'Publisher metadata title; raw title values remain outside this compact artifact.' },
    { field_id: 'payload.access', field_role: 'metadata', unit: null, required_for_readiness: true, description: 'Endpoint-scoped payload access observation.' },
    { field_id: 'schema.applicability', field_role: 'metadata', unit: null, required_for_readiness: true, description: 'Schema applicability remains unresolved until a scoped schema observation exists.' }
  ],
  cohort: 'PR-002 accepted baseline_records (C-002-3)',
  generation: cohorts.corpus.generation,
  asOf: AS_OF,
  generatedAt: AS_OF,
  vectorEncoding: 'compact-v1',
  accessSummary: buildAccessSummary({ observations, asOf: AS_OF, compact: true })
});
await fs.writeFile(OUTPUT, `${JSON.stringify(view)}\n`);
process.stdout.write(`${JSON.stringify({ status: 'pass', output: path.relative(ROOT, OUTPUT), record_count: view.records.length, source_membership_count: view.membership.source_membership_count, isolated_count: view.membership.isolated_count, artifact_id: view.artifact_id, artifact_digest: view.artifact_digest })}\n`);
