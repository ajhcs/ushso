#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { assertCompletenessView, createOfflineCompletenessConsumer, membershipHash } from '../../../packages/coverage/research-program/v1.0.0/src/completeness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const artifactPath = path.join(ROOT, 'verification/research-program/pr-004/completeness-view.json');
const baselinePath = path.join(ROOT, 'docs/research-program/baseline.json');
const cohortsPath = path.join(ROOT, 'evaluation/research-program/cohorts.json');
const schemaPath = path.join(ROOT, 'packages/coverage/research-program/v1.0.0/schemas/completeness-view.schema.json');
const fieldSchemaPath = path.join(ROOT, 'packages/normalization/schemas/field-observation.schema.json');

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

const [artifactBytes, artifact, baseline, cohorts, schema, fieldSchema] = await Promise.all([
  fs.readFile(artifactPath),
  fs.readFile(artifactPath, 'utf8').then(JSON.parse),
  fs.readFile(baselinePath, 'utf8').then(JSON.parse),
  fs.readFile(cohortsPath, 'utf8').then(JSON.parse),
  fs.readFile(schemaPath, 'utf8').then(JSON.parse),
  fs.readFile(fieldSchemaPath, 'utf8').then(JSON.parse)
]);
const cohortsBytes = await fs.readFile(cohortsPath);
const expectedInputDigest = `sha256:${crypto.createHash('sha256').update(cohortsBytes).digest('hex')}`;
const ajv = new Ajv2020({ strict: true, strictSchema: true, strictTypes: true, allErrors: true });
ajv.addFormat('date-time', value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
ajv.compile(fieldSchema);
const validate = ajv.compile(schema);
assert(validate(artifact), `SCHEMA_INVALID:${JSON.stringify(validate.errors)}`);
assert(baseline.corpus.record_count === 3434, 'BASELINE_RECORD_COUNT');
assert(baseline.corpus.unique_record_id_count === 3434, 'BASELINE_UNIQUE_RECORD_COUNT');
assert(baseline.corpus.searchable_record_count === 3430, 'BASELINE_SEARCHABLE_RECORD_COUNT');
assert(baseline.corpus.search_document_count === 0, 'BASELINE_SEARCH_DOCUMENT_COUNT');
assert(cohorts.baseline_records.length === 3434, 'COHORT_RECORD_COUNT');
assert(cohorts.baseline_records.every(row => typeof row.native_id === 'string' && row.native_id.length > 0), 'COHORT_NATIVE_ID');
assert(cohorts.corpus.generation === baseline.corpus.generation, 'COHORT_GENERATION');
assert(cohorts.corpus.manifest_sha256 === baseline.corpus.manifest_sha256, 'COHORT_MANIFEST');
const expectedSourceCounts = baseline.corpus.source_slices;
for (const [sourceId, count] of Object.entries(expectedSourceCounts)) assert(artifact.membership.source_counts[sourceId] === count, 'BASELINE_SOURCE_COUNT:' + sourceId);
assert(Object.values(artifact.membership.source_counts).reduce((sum, count) => sum + count, 0) === 3434, 'BASELINE_SOURCE_TOTAL');
const dictionary = baseline.dictionary_evidence;
assert(dictionary.canonical_v1_2.status === 'absent_from_published_corpus', 'CANONICAL_DICTIONARY_PROMOTION');
assert(dictionary.public_proposal_assets.status === 'served_as_pending_review_assets', 'PUBLIC_DICTIONARY_STATUS');
assert(dictionary.public_proposal_assets.manifest.record_count === 2905, 'PUBLIC_DICTIONARY_RECORD_COUNT');
assert(dictionary.public_proposal_assets.manifest.page_count === 34081, 'PUBLIC_DICTIONARY_PAGE_COUNT');
assert(dictionary.public_proposal_assets.manifest.variable_count === 1573847, 'PUBLIC_DICTIONARY_VARIABLE_COUNT');
assert(dictionary.public_proposal_assets.manifest.publication_authorized === false, 'PUBLIC_DICTIONARY_AUTHORIZATION');
assert(dictionary.audit_inventory.completeness_csv.data_rows === 3434, 'DICTIONARY_AUDIT_ROWS');
assert(dictionary.audit_inventory.completeness_csv.dictionary_present_rows === 2905, 'DICTIONARY_AUDIT_PRESENT');
assert(dictionary.audit_inventory.completeness_csv.dictionary_not_present_rows === 529, 'DICTIONARY_AUDIT_ABSENT');
const isolatedReasons = new Map(baseline.corpus.isolated_records.map(row => [row.record_id, row.reason]));
const membership = cohorts.baseline_records.map(row => ({
  record_id: row.record_id,
  source_id: row.source_id,
  isolated: row.isolated === true,
  isolation_reason: isolatedReasons.get(row.record_id) ?? null,
  evidence_ids: row.evidence_ids,
  source_observed_at: '2026-09-03T22:22:33.908Z'
}));
assert(artifact.membership.membership_hash === membershipHash(membership), 'MEMBERSHIP_HASH');
assertCompletenessView(artifact, {
  expectedMembershipHash: membershipHash(membership),
  expectedCohort: 'PR-002 accepted baseline_records (C-002-3)',
  expectedGeneration: cohorts.corpus.generation,
  expectedAsOf: '2026-09-10T15:32:40.000Z',
  expectedInputDigest
});
assert(artifact.membership.record_count === 3434, 'VIEW_RECORD_COUNT');
assert(artifact.membership.source_membership_count === 3434, 'VIEW_SOURCE_COUNT');
assert(artifact.membership.isolated_count === 4, 'VIEW_ISOLATED_COUNT');
const expectedIsolatedIds = baseline.corpus.isolated_records.map(row => row.record_id).sort();
assert(JSON.stringify(artifact.membership.isolated_record_ids) === JSON.stringify(expectedIsolatedIds), 'VIEW_ISOLATED_IDS');
assert(JSON.stringify(artifact.records.filter(record => record.isolated).map(record => record.record_id).sort()) === JSON.stringify(expectedIsolatedIds), 'VIEW_ISOLATED_RECORDS');
assert(new Set(artifact.records.map(record => record.record_id)).size === 3434, 'VIEW_RECORD_IDS');
const vectorFields = artifact.records.flatMap(record => record.source_vectors.flatMap(source => source.fields));
assert(vectorFields.length === 3434 * artifact.field_definitions.length, 'VIEW_VECTOR_CARDINALITY');
const fieldRows = fieldId => vectorFields.filter(field => field.field_id === fieldId);
const nativeIds = new Map(cohorts.baseline_records.map(row => [row.record_id, row.native_id]));
assert(fieldRows('record.identifier').every(field => field.observation.value_state === 'known' && field.observation.attempt_state === 'succeeded'), 'IDENTIFIER_STATE');
assert(artifact.records.every(record => record.source_vectors.every(source => {
  const identifier = source.fields.find(field => field.field_id === 'record.identifier');
  return identifier?.observation.value?.value === nativeIds.get(record.record_id);
})), 'IDENTIFIER_NATIVE_VALUE');
for (const fieldId of ['record.title', 'payload.access', 'schema.applicability']) {
  assert(fieldRows(fieldId).every(field => field.observation.value_state === 'unknown' && field.observation.attempt_state === 'not_attempted'), 'UNRESOLVED_FIELD_STATE:' + fieldId);
}
assert(fieldRows('payload.access').every(field => field.observation.applicability_state === 'unknown'), 'PAYLOAD_APPLICABILITY_OVERCLAIM');
assert(fieldRows('schema.applicability').every(field => field.observation.applicability_state === 'unknown'), 'SCHEMA_APPLICABILITY_OVERCLAIM');
assert(artifact.records.every(record => record.readiness_state !== 'ready'), 'RESEARCH_READY_OVERCLAIM');
const evidenceIds = new Set(artifact.evidence_catalog.map(ref => ref.evidence_id));
assert(artifact.evidence_catalog.length === 3434, 'EVIDENCE_CATALOG_COUNT');
assert(vectorFields.every(field => field.observation.evidence_ids.every(evidenceId => evidenceIds.has(evidenceId))), 'EVIDENCE_CATALOG_BINDING');
const accessSummary = artifact.access_summary;
assert(accessSummary.schema_version === 'ushso.access-summary.v1.0.0' && accessSummary.as_of === artifact.as_of, 'ACCESS_SUMMARY_IDENTITY');
const accessScopes = new Map(accessSummary.endpoint_scopes.map(scope => [scope.endpoint_scope.operation, scope]));
assert(accessScopes.size === 3, 'ACCESS_SCOPE_COUNT');
const metadataScope = accessScopes.get('metadata_read');
assert(metadataScope?.latest_successful_check?.attempt_state === 'succeeded', 'ACCESS_METADATA_SUCCESS');
assert(metadataScope?.latest_attempt?.attempt_state === 'succeeded', 'ACCESS_METADATA_ATTEMPT');
for (const operation of ['payload_read', 'schema_read']) {
  const scope = accessScopes.get(operation);
  assert(scope?.latest_successful_check === null && scope?.latest_attempt === null, 'ACCESS_UNATTEMPTED:' + operation);
}
for (const scope of accessSummary.endpoint_scopes) {
  assert(scope.documented.cost.state === 'unknown' && scope.documented.cost.amount === null, 'ACCESS_COST:' + scope.endpoint_scope.operation);
  assert(scope.documented.usage_limit.state === 'unknown' && scope.documented.usage_limit.limit === null, 'ACCESS_USAGE:' + scope.endpoint_scope.operation);
}
for (const metric of artifact.aggregates.metrics) {
  assert(metric.rate_context.cohort_definition === artifact.cohort, `METRIC_COHORT:${metric.metric_id}`);
  assert(metric.rate_context.generation === artifact.generation, `METRIC_GENERATION:${metric.metric_id}`);
  assert(metric.rate_context.as_of === artifact.as_of, `METRIC_AS_OF:${metric.metric_id}`);
  assert(metric.rate_context.membership_hash === artifact.membership.membership_hash, 'METRIC_MEMBERSHIP:' + metric.metric_id);
  assert(metric.numerator_count === metric.partitions[0].count, 'METRIC_NUMERATOR:' + metric.metric_id);
  assert(JSON.stringify(metric.rate_context.partition_states) === JSON.stringify(metric.partitions.map(item => item.state)), 'METRIC_PARTITION_CONTEXT:' + metric.metric_id);
  assert(metric.partitions.reduce((sum, item) => sum + item.count, 0) === metric.denominator_count, `METRIC_PARTITION:${metric.metric_id}`);
  if (metric.denominator_status !== 'known' || metric.denominator_count === 0) assert(metric.rate === null, `UNSAFE_RATE:${metric.metric_id}`);
}
const consumer = createOfflineCompletenessConsumer(artifact, {
  expectedDigest: artifact.artifact_digest,
  expectedInputDigest,
  expectedMembershipHash: membershipHash(membership),
  expectedCohort: 'PR-002 accepted baseline_records (C-002-3)',
  expectedGeneration: cohorts.corpus.generation,
  expectedAsOf: '2026-09-10T15:32:40.000Z',
  maxPageSize: 25
});
assert(consumer.listRecords({ limit: 25 }).records.length === 25, 'CONSUMER_BOUND');
assert(consumer.getRecord(artifact.records[0].record_id)?.record_id === artifact.records[0].record_id, 'CONSUMER_RECORD');
const fileSha256 = crypto.createHash('sha256').update(artifactBytes).digest('hex');
process.stdout.write(`${JSON.stringify({ status: 'pass', artifact_id: artifact.artifact_id, artifact_digest: artifact.artifact_digest, artifact_file_sha256: fileSha256, artifact_bytes: artifactBytes.length, record_count: artifact.membership.record_count, source_membership_count: artifact.membership.source_membership_count, isolated_count: artifact.membership.isolated_count, vector_field_count: vectorFields.length, metric_count: artifact.aggregates.metrics.length, vector_encoding: artifact.vector_encoding })}\n`);
