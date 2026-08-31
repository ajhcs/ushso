import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMigrations } from '../../../../db/tools/migrate.mjs';
import { runPsql } from '../../../../db/tools/common.mjs';
import { canonicalJson, contentFingerprint } from '../../../../packages/normalization/src/canonical.mjs';
import { applyImportDocument, applyProductionImport, buildProductionImportDocument, rejectProductionImport } from '../../../../packages/normalization/src/database-import.mjs';
import { loadLegacyCorpus } from '../../../../packages/normalization/src/legacy-loader.mjs';
import { dockerCommand, startLocalPostgres } from '../tools/local-postgres.mjs';

const FINGERPRINT = '0'.repeat(64);
const COLLECTIONS = [
  'organizations', 'sources', 'assets', 'releases', 'distributions',
  'documentation', 'schema_snapshots', 'schema_fields', 'access_routes',
  'access_observations', 'evidence', 'assertions', 'relationships'
];

function scalar(container, database, sql, user = 'postgres') {
  return runPsql({ container, database, user, sql, tuplesOnly: true }).stdout.trim();
}

function dollarJson(value, seed = 'document') {
  const json = JSON.stringify(value);
  for (let index = 0; index < 100; index += 1) {
    const delimiter = `$wp6_${seed}_${index}$`;
    if (!json.includes(delimiter)) return `${delimiter}${json}${delimiter}`;
  }
  throw new Error('WP6_TEST_DOLLAR_QUOTE_EXHAUSTED');
}

function expectDatabaseFailure({ container, database = 'ushso', user = 'postgres', sql }, pattern) {
  const result = runPsql({ container, database, user, sql, expectFailure: true });
  assert.match(result.stderr, pattern);
  return result;
}

function runMaintenanceSql({ container, database = 'ushso', sql, tuplesOnly = false, expectFailure = false }) {
  return runPsql({
    container,
    database,
    user: 'postgres',
    tuplesOnly,
    expectFailure,
    sql: `begin;
      set local role ushso_maintenance;
      ${sql}
      commit;`
  });
}

function expectMaintenanceFailure({ container, database = 'ushso', sql }, pattern) {
  const result = runMaintenanceSql({ container, database, sql, expectFailure: true });
  assert.match(result.stderr, pattern);
  return result;
}

function rehashRevision(row) {
  const body = structuredClone(row);
  delete body.canonical_content_fingerprint;
  row.canonical_content_fingerprint = contentFingerprint(body);
  return row;
}

function singleRowBundle(collection, row) {
  return {
    bundle_version: 'observatory-core-fixture-bundle.v2.0.0',
    ...Object.fromEntries(COLLECTIONS.map(name => [name, name === collection ? [row] : []]))
  };
}

function validateBundleFailure(container, normalized, collection, mutate, pattern) {
  const row = structuredClone(normalized.bundle[collection][0]);
  mutate(row, normalized.bundle);
  rehashRevision(row);
  const bundle = singleRowBundle(collection, row);
  expectDatabaseFailure({
    container,
    sql: `select catalog.validate_normalization_bundle(${dollarJson(bundle, collection)}::jsonb, '${normalized.import_id}');`
  }, pattern);
}

function insertAuditEvent({ container, auditEventId, action, objectType, objectId, details, occurredAt }) {
  runPsql({
    container, database: 'ushso', user: 'ushso_ops',
    sql: `insert into ops.audit_events
      (audit_event_id, action, actor_id, actor_type, object_type, object_id,
       decision, details, trace_id, occurred_at)
      values ('${auditEventId}', '${action}', 'wp6-local-maintenance',
       'maintenance_identity', '${objectType}', '${objectId}', 'allowed',
       ${dollarJson(details, 'audit')}::jsonb, 'wp6localtrace0001', '${occurredAt}'::timestamptz);`
  });
}

function createSyntheticSuccessor({ container, normalized, suffix, entityIndex, recordedAt, includeTypedProjection = true }) {
  const prior = structuredClone(normalized.bundle.assets[entityIndex]);
  const importId = `urn:ushso:import:wp6-history-${suffix}`;
  const revisionId = `urn:ushso:revision:wp6-history-${suffix}`;
  const digestCharacter = suffix[0];
  const createdAt = new Date(Date.parse(recordedAt) - 1000).toISOString();
  runPsql({ container, database: 'ushso', sql: `
    insert into catalog.import_batches (
      import_id, contract_version, source_corpus_version, source_manifest_file_sha256,
      source_content_fingerprint, document_fingerprint, normalizer_name,
      normalizer_version, state, projection_eligible, plan_payload,
      expected_record_count, expected_search_document_count, expected_join_route_count,
      created_at
    ) values (
      '${importId}', 'ushso-normalization-import.v1.0.0', '1.1.${suffix === 'a' ? '1' : '2'}',
      repeat('${digestCharacter}', 64), repeat('${digestCharacter}', 64),
      'sha256:' || repeat('${digestCharacter}', 64), 'wp6-history-normalizer',
      '1.0.0', 'prepared', false, '{"purpose":"revision-history-test"}'::jsonb,
      0, 0, 0, '${createdAt}'::timestamptz
    );
    insert into catalog.import_batch_events
      (import_id, from_state, to_state, reason, audit_event_id, actor, recorded_at)
    values ('${importId}', null, 'prepared', 'synthetic revision history batch staged',
      null, session_user, '${createdAt}'::timestamptz);`
  });

  for (const mutation of [
    `import_id = '${importId}-changed'`,
    `contract_version = 'ushso-normalization-import.v9.9.9'`,
    `source_corpus_version = '9.9.9'`,
    `source_manifest_file_sha256 = repeat('9', 64)`,
    `source_content_fingerprint = repeat('9', 64)`,
    `document_fingerprint = 'sha256:' || repeat('9', 64)`,
    `normalizer_name = 'changed-normalizer'`,
    `normalizer_version = '9.9.9'`,
    `plan_payload = '{"purpose":"mutated"}'::jsonb`,
    `expected_record_count = 1`,
    `expected_search_document_count = 1`,
    `expected_join_route_count = 1`,
    `created_at = created_at + interval '1 second'`
  ]) {
    expectDatabaseFailure({
      container,
      sql: `update catalog.import_batches set ${mutation} where import_id = '${importId}';`
    }, /IMPORT_BATCH_IMMUTABLE_RECEIPT_CHANGED/u);
  }
  expectDatabaseFailure({
    container,
    sql: `update catalog.import_batches set canonical_revision_count = 1 where import_id = '${importId}';`
  }, /IMPORT_BATCH_SAME_STATE_MUTATION/u);

  const successor = structuredClone(prior);
  successor.revision_id = revisionId;
  successor.lineage.import_id = importId;
  successor.lineage.normalizer = { name: 'wp6-history-normalizer', version: '1.0.0' };
  successor.history = {
    append_only: true,
    supersedes_revision_ids: [prior.revision_id],
    superseded_by_revision_id: null,
    rationale: 'WP6 immutable revision selection test'
  };
  successor.clocks.recorded_at = recordedAt;
  successor.clocks.superseded_at = null;
  rehashRevision(successor);
  runPsql({ container, database: 'ushso', sql: `
    insert into catalog.object_revisions (
      revision_id, entity_id, entity_type, contract_version, schema_version,
      lifecycle_state, canonical_content_fingerprint, revision_payload, import_id,
      normalizer_name, normalizer_version, first_seen_at, observed_at, recorded_at,
      publisher_released_at, publisher_modified_at, superseded_at
    ) values (
      '${revisionId}', '${successor.entity_id}', '${successor.entity_type}',
      '${successor.contract_version}', '${successor.schema_version}', '${successor.lifecycle_state}',
      '${successor.canonical_content_fingerprint}', ${dollarJson(successor, `revision_${suffix}`)}::jsonb,
      '${importId}', 'wp6-history-normalizer', '1.0.0',
      '${successor.clocks.first_seen_at}'::timestamptz,
      '${successor.clocks.observed_at}'::timestamptz,
      '${successor.clocks.recorded_at}'::timestamptz,
      ${successor.clocks.publisher_released_at ? `'${successor.clocks.publisher_released_at}'::timestamptz` : 'null'},
      ${successor.clocks.publisher_modified_at ? `'${successor.clocks.publisher_modified_at}'::timestamptz` : 'null'}, null
    );
    ${includeTypedProjection ? `insert into catalog.assets (
      asset_revision_id, asset_id, source_id, responsible_organization_id,
      title, asset_kind, summary, identity_resolution_state,
      family_resolution_state, import_id
    ) values (
      '${revisionId}', '${successor.asset_id}', '${successor.source_id}',
      '${successor.responsible_organization_id}',
      (${dollarJson(successor.title, `title_${suffix}`)}::jsonb #>> '{}'),
      '${successor.asset_kind}',
      (${dollarJson(successor.summary, `summary_${suffix}`)}::jsonb #>> '{}'),
      '${successor.identity_resolution_state}', '${successor.family_resolution_state}',
      '${importId}'
    );` : ''}
    insert into catalog.temporal_revision_history
      (prior_revision_id, successor_revision_id, entity_id, rationale, superseded_at, import_id)
    values ('${prior.revision_id}', '${revisionId}', '${prior.entity_id}',
      'WP6 immutable revision selection test', '${recordedAt}'::timestamptz, '${importId}');
    update catalog.import_batches
    set state = 'applied', projection_eligible = true, canonical_revision_count = 1,
        applied_at = '${recordedAt}'::timestamptz
    where import_id = '${importId}';
    insert into catalog.import_batch_events
      (import_id, from_state, to_state, reason, audit_event_id, actor, recorded_at)
    values ('${importId}', 'prepared', 'applied', 'synthetic revision history batch applied',
      null, session_user, '${recordedAt}'::timestamptz);`
  });
  expectDatabaseFailure({
    container,
    sql: `update catalog.import_batches set applied_at = applied_at + interval '1 second' where import_id = '${importId}';`
  }, /IMPORT_BATCH_SAME_STATE_MUTATION/u);
  return { prior, successor, importId, revisionId, recordedAt };
}

test('WP6 isolated PostgreSQL canonical import and parity suite', async (t) => {
  const postgres = await startLocalPostgres();
  const { container } = postgres;
  try {
    await t.test('clean 0001-0007 migration and exact foundation preservation', async () => {
      const result = await applyMigrations({ container, database: 'ushso', environment: 'local', 'deployment-fingerprint': FINGERPRINT });
      assert.deepEqual(result.applied, ['0001', '0002', '0003', '0004', '0005', '0006', '0007']);
      assert.equal(scalar(container, 'ushso', 'select count(*) from public.ushso_schema_migrations;'), '7');
      for (const relation of [
        'normalization_import_authorities', 'lineage_anchors', 'object_revision_selections',
        'object_revision_heads', 'object_revision_unavailability_events',
        'selected_object_revisions', 'object_revision_selection_status'
      ]) assert.equal(scalar(container, 'ushso', `select to_regclass('catalog.${relation}') is not null;`), 't');
      assert.equal(
        scalar(container, 'ushso', `select catalog.content_fingerprint('{"é":2,"a":[true,null,"x"]}'::jsonb);`),
        contentFingerprint({ é: 2, a: [true, null, 'x'] })
      );
      assert.equal(scalar(container, 'ushso', `select indisunique from pg_index where indexrelid='catalog.temporal_history_one_predecessor_idx'::regclass;`), 't');
      expectDatabaseFailure({
        container,
        sql: `insert into catalog.import_batches (
          import_id, contract_version, source_corpus_version, source_manifest_file_sha256,
          source_content_fingerprint, document_fingerprint, normalizer_name,
          normalizer_version, state, projection_eligible, plan_payload,
          expected_record_count, expected_search_document_count, expected_join_route_count,
          canonical_revision_count, created_at, applied_at
        ) values (
          'urn:ushso:import:illegal-initial-applied', 'ushso-normalization-import.v1.0.0',
          '9.9.9', repeat('9',64), repeat('9',64), 'sha256:' || repeat('9',64),
          'illegal-initial-batch', '1.0.0', 'applied', true, '{}'::jsonb,
          0, 0, 0, 0, clock_timestamp(), clock_timestamp()
        );`
      }, /IMPORT_BATCH_MUST_START_PREPARED/u);
    });

    await t.test('N-1 foundation upgrade to canonical schema is additive', async () => {
      runPsql({ container, database: 'postgres', sql: 'create database ushso_nminus1;' });
      const first = await applyMigrations({ container, database: 'ushso_nminus1', environment: 'local', 'deployment-fingerprint': FINGERPRINT, through: '0003' });
      assert.deepEqual(first.applied, ['0001', '0002', '0003']);
      const upgraded = await applyMigrations({ container, database: 'ushso_nminus1', environment: 'local', 'deployment-fingerprint': FINGERPRINT });
      assert.deepEqual(upgraded.applied, ['0004', '0005', '0006', '0007']);
      assert.equal(scalar(container, 'ushso_nminus1', "select to_regprocedure('catalog.apply_normalization_import_guarded(jsonb,text,text)') is not null;"), 't');
      assert.equal(scalar(container, 'ushso_nminus1', "select to_regclass('registry.sources') is not null;"), 't');
    });

    await t.test('six Worker identities have least privilege around catalog imports', () => {
      runPsql({ container, database: 'ushso', user: 'ushso_normalize', sql: 'select count(*) from catalog.import_batches;' });
      runPsql({ container, database: 'ushso', user: 'ushso_normalize', sql: "insert into catalog.objects values ('urn:ushso:asset:forbidden','Asset','urn:ushso:import:forbidden',clock_timestamp());", expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_projector', sql: 'select count(*) from catalog.objects;', expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_projector', sql: 'select count(*) from catalog.selected_object_revisions;' });
      runPsql({ container, database: 'ushso', user: 'ushso_projector', sql: 'select count(*) from catalog.legacy_v1_records;', expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_projector', sql: "select catalog.apply_normalization_import('{}'::jsonb);", expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_ops', sql: "select catalog.apply_normalization_import('{}'::jsonb);", expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_ops', sql: "select catalog.reject_import_batch('missing','forbidden','missing',clock_timestamp());", expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_ops', sql: "select catalog.select_object_revision('missing','missing','select','forbidden','missing','missing',clock_timestamp());", expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_normalize', sql: "select * from catalog.normalization_import_authorities;", expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_normalize', sql: "select catalog.validate_normalization_bundle('{}'::jsonb, 'urn:ushso:import:forbidden');", expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_normalize', sql: "select catalog.apply_normalization_import('{}'::jsonb);", expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_normalize', sql: "select catalog.apply_normalization_import_guarded('{}'::jsonb, 'staging', repeat('1',64));", expectFailure: true });
      for (const role of ['ushso_public', 'ushso_scheduler', 'ushso_harvest']) {
        runPsql({ container, database: 'ushso', user: role, sql: 'select count(*) from catalog.objects;', expectFailure: true });
      }
      assert.equal(scalar(container, 'ushso', "select count(*) from information_schema.role_routine_grants where grantee='ushso_normalize' and routine_name='apply_normalization_import' and privilege_type='EXECUTE';"), '0');
      assert.equal(scalar(container, 'ushso', "select count(*) from information_schema.role_routine_grants where grantee='ushso_normalize' and routine_name='apply_normalization_import_guarded' and privilege_type='EXECUTE';"), '1');
      assert.equal(scalar(container, 'ushso', "select count(*) from information_schema.role_routine_grants where grantee='ushso_ops' and routine_name='reject_import_batch' and privilege_type='EXECUTE';"), '0');
      assert.equal(scalar(container, 'ushso', "select count(*) from information_schema.role_routine_grants where grantee='ushso_maintenance' and routine_name='reject_import_batch' and privilege_type='EXECUTE';"), '1');
      assert.equal(scalar(container, 'ushso', "select count(*) from information_schema.role_routine_grants where grantee='ushso_maintenance' and routine_name='select_object_revision' and privilege_type='EXECUTE';"), '1');
    });

    const normalized = await buildProductionImportDocument();
    const legacy = await loadLegacyCorpus();
    let laterHeadForOlderBatchRejection = null;
    let importAppliedAt = null;

    await t.test('atomic production v1.1.0 import reconciles all canonical and legacy rows', async () => {
      const startedAt = performance.now();
      const result = await applyProductionImport({ container, database: 'ushso', environment: 'local' });
      assert.ok(performance.now() - startedAt < 60_000, 'sealed 1,725-revision import exceeded the 60s local gate');
      assert.equal(result.status, 'applied');
      assert.equal(result.records, 157);
      assert.equal(result.search_documents, 157);
      assert.equal(result.join_routes, 14);
      assert.equal(result.integrity_authority_id, 'legacy-v1.1.0:legacy-corpus-normalizer@1.0.0');
      assert.equal(result.database_canonical_hash_verified, true);
      importAppliedAt = scalar(container, 'ushso', `select applied_at::text from catalog.import_batches where import_id='${normalized.import_id}';`);
      assert.ok(Date.parse(importAppliedAt) >= Date.parse(normalized.plan.created_at));
      assert.equal(scalar(container, 'ushso', `select created_at = applied_at from catalog.import_batches where import_id='${normalized.import_id}';`), 't');
      assert.equal(scalar(container, 'ushso', `select count(distinct recorded_at) from catalog.import_batch_events where import_id='${normalized.import_id}';`), '1');
      assert.equal(scalar(container, 'ushso', 'select count(*) from catalog.assets;'), '157');
      assert.equal(scalar(container, 'ushso', 'select count(*) from catalog.releases;'), '157');
      assert.equal(scalar(container, 'ushso', 'select count(*) from catalog.distributions;'), '157');
      assert.equal(scalar(container, 'ushso', 'select count(*) from catalog.access_routes;'), '157');
      assert.equal(scalar(container, 'ushso', 'select count(*) from catalog.access_observations;'), '157');
      assert.equal(scalar(container, 'ushso', 'select count(*) from catalog.evidence;'), '361');
      assert.equal(scalar(container, 'ushso', 'select count(*) from catalog.object_revision_heads;'), String(Object.values(normalized.plan.canonical_counts).reduce((sum, count) => sum + count, 0)));
      assert.equal(scalar(container, 'ushso', 'select count(*) from catalog.selected_object_revisions;'), String(Object.values(normalized.plan.canonical_counts).reduce((sum, count) => sum + count, 0)));
      assert.equal(scalar(container, 'ushso', "select count(*) from catalog.object_revision_selection_status where selection_state <> 'selected_eligible';"), '0');
      assert.equal(scalar(container, 'ushso', 'select count(*) > 0 from catalog.lineage_anchors;'), 't');
      assert.equal(scalar(container, 'ushso', "select count(*) from catalog.legacy_import_mappings where legacy_kind='record';"), '157');
      assert.equal(scalar(container, 'ushso', "select count(*) from catalog.legacy_import_mappings where legacy_kind='join_route';"), '14');
    });

    await t.test('database replay is exactly idempotent', async () => {
      const before = scalar(container, 'ushso', 'select count(*) from catalog.objects;');
      const replay = await applyProductionImport({ container, database: 'ushso', environment: 'local' });
      assert.equal(replay.status, 'already_applied');
      assert.equal(replay.new_logical_rows, 0);
      assert.equal(replay.database_canonical_hash_verified, true);
      assert.equal(scalar(container, 'ushso', 'select count(*) from catalog.objects;'), before);
      const conflicting = structuredClone(normalized.importDocument);
      conflicting.legacy_projection.records[0].title = 'mutation-with-unchanged-fingerprint';
      assert.throws(() => applyImportDocument(conflicting, { container, database: 'ushso' }), /DOCUMENT_FINGERPRINT_MISMATCH/u);
      assert.equal(scalar(container, 'ushso', 'select count(*) from catalog.objects;'), before);
    });

    await t.test('database-generated v1 projection is byte-semantic parity', () => {
      const json = scalar(container, 'ushso', `select catalog.legacy_v1_projection('${normalized.import_id}')::text;`, 'ushso_projector');
      const projection = JSON.parse(json);
      assert.equal(canonicalJson(projection.records), canonicalJson(legacy.records));
      assert.equal(canonicalJson(projection.search_documents), canonicalJson(legacy.searchDocuments));
      assert.equal(canonicalJson(projection.join_routes), canonicalJson(legacy.joinRoutes));
      assert.equal(canonicalJson(projection.corpus), canonicalJson(legacy.corpus));
      assert.equal(projection.semantics.zero_results_status, 200);
      assert.equal(projection.semantics.zero_results_absence_claim_permitted, false);
      assert.match(projection.semantics.zero_results_warning, /not evidence/iu);
    });

    await t.test('identity and joins stay unresolved without silent upgrade', () => {
      assert.equal(scalar(container, 'ushso', "select count(distinct asset_id) from catalog.assets;"), '157');
      assert.equal(scalar(container, 'ushso', "select count(*) from catalog.relationships where relationship_kind='same_identity';"), '0');
      assert.equal(scalar(container, 'ushso', "select count(*) from catalog.relationships where relationship_kind='same_identity_candidate' and identity_semantics->>'state'='candidate';"), String(normalized.plan.identity_review_candidates.length + normalized.plan.source_identity_review_candidates.length));
      assert.equal(scalar(container, 'ushso', "select count(*) from catalog.relationships where relationship_domain='join';"), '14');
      assert.equal(scalar(container, 'ushso', "select count(*) from catalog.relationships where relationship_domain='join' and join_semantics->>'evidence_state' <> 'candidate';"), '0');
      assert.equal(scalar(container, 'ushso', "select count(*) from catalog.relationships where relationship_domain='join' and join_semantics->>'compatibility'='compatible';"), '0');
    });

    await t.test('database truth boundary rejects collection, typed, array, and lineage reference attacks', () => {
      const missing = 'urn:ushso:asset:missing-reference';
      const evidenceId = normalized.bundle.evidence[0].evidence_id;
      const sourceId = normalized.bundle.sources[0].source_id;
      const organizationId = normalized.bundle.organizations[0].organization_id;

      validateBundleFailure(container, normalized, 'assets', row => { row.entity_type = 'Release'; }, /COLLECTION_TYPE_MISMATCH:assets/u);
      validateBundleFailure(container, normalized, 'sources', row => { row.operator_organization_id = missing; }, /REFERENCE_MISSING:sources\.operator_organization_id/u);
      validateBundleFailure(container, normalized, 'assets', row => { row.source_id = organizationId; }, /REFERENCE_TYPE_MISMATCH:assets\.source_id/u);
      validateBundleFailure(container, normalized, 'assets', row => { row.responsible_organization_id = sourceId; }, /REFERENCE_TYPE_MISMATCH:assets\.responsible_organization_id/u);
      validateBundleFailure(container, normalized, 'releases', row => { row.asset_id = missing; }, /REFERENCE_MISSING:releases\.asset_id/u);
      validateBundleFailure(container, normalized, 'distributions', row => { row.release_id = missing; }, /REFERENCE_MISSING:distributions\.release_id/u);
      validateBundleFailure(container, normalized, 'documentation', row => { row.subject_id = evidenceId; }, /REFERENCE_TYPE_MISMATCH:documentation\.subject_id/u);
      validateBundleFailure(container, normalized, 'schema_snapshots', row => { row.release_id = missing; }, /REFERENCE_MISSING:schema_snapshots\.release_id/u);
      validateBundleFailure(container, normalized, 'schema_snapshots', row => { row.distribution_id = missing; }, /REFERENCE_MISSING:schema_snapshots\.distribution_id/u);
      validateBundleFailure(container, normalized, 'schema_fields', row => { row.schema_snapshot_id = missing; }, /REFERENCE_MISSING:schema_fields\.schema_snapshot_id/u);
      validateBundleFailure(container, normalized, 'access_routes', row => { row.distribution_id = missing; }, /REFERENCE_MISSING:access_routes\.distribution_id/u);
      validateBundleFailure(container, normalized, 'access_observations', row => { row.access_route_id = missing; }, /REFERENCE_MISSING:access_observations\.access_route_id/u);
      validateBundleFailure(container, normalized, 'evidence', row => { row.source_id = organizationId; }, /REFERENCE_TYPE_MISMATCH:evidence\.source_id/u);
      validateBundleFailure(container, normalized, 'assertions', row => { row.subject_id = evidenceId; }, /REFERENCE_TYPE_MISMATCH:assertions\.subject_id/u);
      validateBundleFailure(container, normalized, 'relationships', row => { row.object_id = evidenceId; }, /REFERENCE_TYPE_MISMATCH:relationships\.object_id/u);

      validateBundleFailure(container, normalized, 'distributions', row => { row.access_route_ids = [missing]; }, /REFERENCE_MISSING:distributions\.access_route_ids/u);
      validateBundleFailure(container, normalized, 'schema_snapshots', row => { row.field_ids = [missing]; }, /REFERENCE_MISSING:schema_snapshots\.field_ids/u);
      validateBundleFailure(container, normalized, 'assets', row => { row.native_identifiers[0].evidence_ids = [missing]; }, /REFERENCE_MISSING:assets\.native_identifiers\.evidence_ids/u);
      validateBundleFailure(container, normalized, 'distributions', row => { row.machine_readiness.evidence_ids = [missing]; }, /REFERENCE_MISSING:distributions\.machine_readiness\.evidence_ids/u);
      validateBundleFailure(container, normalized, 'access_routes', row => {
        row.requirements.push({ kind: 'other', description: 'adversarial', satisfaction_state: 'unknown', human_gate: false, evidence_ids: [missing] });
      }, /REFERENCE_MISSING:access_routes\.requirements\.evidence_ids/u);
      validateBundleFailure(container, normalized, 'assertions', row => { row.evidence_refs[0].evidence_id = missing; }, /REFERENCE_MISSING:assertions\.evidence_refs/u);
      validateBundleFailure(container, normalized, 'relationships', row => { row.evidence_refs[0].evidence_id = missing; }, /REFERENCE_MISSING:relationships\.evidence_refs/u);
      validateBundleFailure(container, normalized, 'relationships', row => {
        if (row.relationship_domain !== 'join') {
          const join = normalized.bundle.relationships.find(candidate => candidate.relationship_domain === 'join' && candidate.join_semantics.requirements.length > 0);
          Object.assign(row, structuredClone(join));
        }
        row.join_semantics.requirements[0].evidence_ids = [missing];
      }, /REFERENCE_MISSING:relationships\.join_semantics\.requirements\.evidence_ids/u);
      validateBundleFailure(container, normalized, 'relationships', row => {
        const join = normalized.bundle.relationships.find(candidate => candidate.relationship_domain === 'join' && candidate.join_semantics.blockers.length > 0);
        Object.assign(row, structuredClone(join));
        row.join_semantics.blockers[0].evidence_ids = [missing];
      }, /REFERENCE_MISSING:relationships\.join_semantics\.blockers\.evidence_ids/u);
      validateBundleFailure(container, normalized, 'evidence', row => { row.lineage.derivation_parent_ids = [missing]; }, /EVIDENCE_DERIVATION_PARENT_MISSING/u);

      const wrongMappingPlan = structuredClone(normalized.plan);
      wrongMappingPlan.record_mappings[0].canonical_ids.asset_id = missing;
      expectDatabaseFailure({
        container,
        sql: `select catalog.validate_import_mapping_reconciliation(
          ${dollarJson(wrongMappingPlan, 'wrong_mapping')}::jsonb,
          ${dollarJson(normalized.bundle, 'wrong_mapping_bundle')}::jsonb
        );`
      }, /RECORD_MAPPING_TARGET_MISSING/u);
      const wrongRoutePlan = structuredClone(normalized.plan);
      wrongRoutePlan.join_route_mappings[0].relationship_ids[0] = missing;
      expectDatabaseFailure({
        container,
        sql: `select catalog.validate_import_mapping_reconciliation(
          ${dollarJson(wrongRoutePlan, 'wrong_route')}::jsonb,
          ${dollarJson(normalized.bundle, 'wrong_route_bundle')}::jsonb
        );`
      }, /ROUTE_MAPPING_TARGET_MISMATCH/u);
    });

    await t.test('database-side digest authority rejects forged receipts and clean recovery succeeds', async () => {
      runPsql({ container, database: 'postgres', sql: 'create database ushso_failure;' });
      await applyMigrations({ container, database: 'ushso_failure', environment: 'local', 'deployment-fingerprint': FINGERPRINT });

      runPsql({ container, database: 'postgres', sql: 'create database ushso_incomplete;' });
      await applyMigrations({ container, database: 'ushso_incomplete', environment: 'local', 'deployment-fingerprint': FINGERPRINT });
      runPsql({ container, database: 'ushso_incomplete', sql: `
        insert into catalog.import_batches (
          import_id, contract_version, source_corpus_version, source_manifest_file_sha256,
          source_content_fingerprint, document_fingerprint, normalizer_name,
          normalizer_version, state, projection_eligible, plan_payload,
          expected_record_count, expected_search_document_count, expected_join_route_count,
          created_at
        ) values (
          '${normalized.import_id}', '${normalized.importDocument.contract_version}',
          '${normalized.plan.source.corpus_version}', '${normalized.plan.source.manifest_file_sha256}',
          '${normalized.importDocument.source_content_fingerprint}', '${normalized.importDocument.document_fingerprint}',
          '${normalized.plan.normalizer.name}', '${normalized.plan.normalizer.version}',
          'prepared', false, ${dollarJson(normalized.plan, 'incomplete_plan')}::jsonb,
          157, 157, 14, clock_timestamp()
        );
        insert into catalog.import_batch_events
          (import_id, from_state, to_state, reason, audit_event_id, actor, recorded_at)
        values ('${normalized.import_id}', null, 'prepared', 'failure injection staged receipt', null, session_user, clock_timestamp());`
      });
      assert.throws(
        () => applyImportDocument(normalized.importDocument, { container, database: 'ushso_incomplete' }),
        /INCOMPLETE_IMPORT_REQUIRES_MAINTENANCE_RECOVERY/u
      );
      assert.equal(scalar(container, 'ushso_incomplete', `select state from catalog.import_batches where import_id='${normalized.import_id}';`), 'prepared');
      assert.equal(scalar(container, 'ushso_incomplete', 'select count(*) from catalog.objects;'), '0');

      const unchangedFingerprint = structuredClone(normalized.importDocument);
      unchangedFingerprint.bundle.assets[0].title = 'tampered without changing any receipt digest';
      assert.throws(() => applyImportDocument(unchangedFingerprint, { container, database: 'ushso_failure' }), /DOCUMENT_FINGERPRINT_MISMATCH/u);
      assert.equal(scalar(container, 'ushso_failure', 'select count(*) from catalog.import_batches;'), '0');

      const selfSignedForgery = structuredClone(normalized.importDocument);
      selfSignedForgery.plan.created_at = '2026-08-30T18:15:37.295Z';
      selfSignedForgery.document_fingerprint = contentFingerprint({ ...selfSignedForgery, document_fingerprint: null });
      assert.throws(() => applyImportDocument(selfSignedForgery, { container, database: 'ushso_failure' }), /NORMALIZATION_IMPORT_NOT_AUTHORIZED/u);
      assert.equal(scalar(container, 'ushso_failure', 'select count(*) from catalog.import_batches;'), '0');
      assert.equal(scalar(container, 'ushso_failure', 'select count(*) from catalog.objects;'), '0');
      const recovered = applyImportDocument(normalized.importDocument, { container, database: 'ushso_failure' });
      assert.equal(recovered.status, 'applied');
      assert.equal(scalar(container, 'ushso_failure', 'select count(*) from catalog.assets;'), '157');
    });

    await t.test('backup and isolated restore retain exact canonical/projection state', () => {
      let result = dockerCommand(['exec', container, 'pg_dump', '-U', 'postgres', '-Fc', '--no-owner', '--no-privileges', '-d', 'ushso', '-f', '/tmp/ushso-wp6.dump']);
      assert.equal(result.status, 0, result.stderr);
      result = dockerCommand(['exec', container, 'createdb', '-U', 'postgres', 'ushso_restore']);
      assert.equal(result.status, 0, result.stderr);
      result = dockerCommand(['exec', container, 'pg_restore', '-U', 'postgres', '--no-owner', '--no-privileges', '-d', 'ushso_restore', '/tmp/ushso-wp6.dump']);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(scalar(container, 'ushso_restore', 'select count(*) from catalog.assets;'), '157');
      const restored = JSON.parse(scalar(container, 'ushso_restore', `select catalog.legacy_v1_projection('${normalized.import_id}')::text;`));
      assert.equal(canonicalJson(restored.records), canonicalJson(legacy.records));
      assert.equal(canonicalJson(restored.join_routes), canonicalJson(legacy.joinRoutes));
    });

    await t.test('immutable revision heads support N+1, cycle rejection, audited revert, and rejection fallback', async () => {
      assert.ok(importAppliedAt);
      const at = seconds => new Date(Date.parse(importAppliedAt) + seconds * 1000).toISOString();
      const times = {
        aRecorded: at(1), aRevert: at(2), aReselect: at(3), aReject: at(4), aInvalid: at(5),
        bRecorded: at(6), baseAudit: at(7), bReject: at(8), baseFinal: at(9)
      };
      const historyA = createSyntheticSuccessor({
        container, normalized, suffix: 'a', entityIndex: 0,
        recordedAt: times.aRecorded
      });
      const otherRevisionId = normalized.bundle.assets[1].revision_id;
      expectDatabaseFailure({ container, sql: `
        insert into catalog.temporal_revision_history
          (prior_revision_id, successor_revision_id, entity_id, rationale, superseded_at, import_id)
        values ('${otherRevisionId}', '${historyA.revisionId}', '${historyA.prior.entity_id}',
          'adversarial cross-entity edge', '${times.aRecorded}', '${historyA.importId}');`
      }, /SUPERSESSION_IDENTITY_MISMATCH/u);
      expectDatabaseFailure({ container, sql: `
        insert into catalog.temporal_revision_history
          (prior_revision_id, successor_revision_id, entity_id, rationale, superseded_at, import_id)
        values ('${historyA.revisionId}', '${historyA.prior.revision_id}', '${historyA.prior.entity_id}',
          'adversarial cycle', '${times.aRevert}', '${normalized.import_id}');`
      }, /SUPERSESSION_(?:CYCLE|TEMPORAL_ORDER)/u);

      const missingTyped = createSyntheticSuccessor({
        container, normalized, suffix: 'c', entityIndex: 2,
        recordedAt: times.aRecorded, includeTypedProjection: false
      });
      insertAuditEvent({
        container, auditEventId: 'audit:wp6:select-missing-typed', action: 'promote',
        objectType: 'catalog_entity', objectId: missingTyped.prior.entity_id,
        details: { import_id: missingTyped.importId, selected_revision_id: missingTyped.revisionId },
        occurredAt: times.aRecorded
      });
      expectMaintenanceFailure({
        container,
        sql: `select catalog.select_object_revision('${missingTyped.prior.entity_id}', '${missingTyped.revisionId}',
          'select', 'adversarial untyped head selection', 'audit:wp6:select-missing-typed',
          '${missingTyped.importId}', '${times.aRecorded}');`
      }, /REVISION_TYPED_PROJECTION_MISSING/u);
      assert.equal(
        scalar(container, 'ushso', `select selected_revision_id from catalog.object_revision_heads where entity_id='${missingTyped.prior.entity_id}';`),
        missingTyped.prior.revision_id
      );

      insertAuditEvent({
        container, auditEventId: 'audit:wp6:select-a', action: 'promote',
        objectType: 'catalog_entity', objectId: historyA.prior.entity_id,
        details: { import_id: historyA.importId, selected_revision_id: historyA.revisionId },
        occurredAt: times.aRecorded
      });
      expectMaintenanceFailure({
        container,
        sql: `select catalog.select_object_revision('${historyA.prior.entity_id}', '${historyA.revisionId}',
          'select', 'wrong import adversarial request', 'audit:wp6:select-a', '${normalized.import_id}',
          '${times.aRecorded}');`
      }, /REVISION_SELECTION_IMPORT_MISMATCH/u);
      expectMaintenanceFailure({
        container,
        sql: `select catalog.select_object_revision('${historyA.prior.entity_id}', '${historyA.revisionId}',
          'select', 'missing audit adversarial request', 'audit:wp6:missing', '${historyA.importId}',
          '${times.aRecorded}');`
      }, /REVISION_SELECTION_AUDIT_MISMATCH/u);
      for (const occurredAt of [times.aRecorded, new Date(Date.parse(times.aRecorded) + 100).toISOString()]) {
        insertAuditEvent({
          container, auditEventId: 'audit:wp6:duplicate-id', action: 'promote',
          objectType: 'catalog_entity', objectId: historyA.prior.entity_id,
          details: { import_id: historyA.importId, selected_revision_id: historyA.revisionId },
          occurredAt
        });
      }
      expectMaintenanceFailure({
        container,
        sql: `select catalog.select_object_revision('${historyA.prior.entity_id}', '${historyA.revisionId}',
          'select', 'duplicate audit identifier adversarial request', 'audit:wp6:duplicate-id',
          '${historyA.importId}', '${times.aRevert}');`
      }, /REVISION_SELECTION_AUDIT_MISMATCH/u);
      runMaintenanceSql({
        container,
        sql: `select catalog.select_object_revision('${historyA.prior.entity_id}', '${historyA.revisionId}',
          'select', 'select reviewed immutable successor', 'audit:wp6:select-a', '${historyA.importId}',
          '${times.aRecorded}');`
      });
      assert.equal(scalar(container, 'ushso', `select selected_revision_id from catalog.object_revision_heads where entity_id='${historyA.prior.entity_id}';`), historyA.revisionId);
      assert.equal(scalar(container, 'ushso', `select count(*) from catalog.object_revisions where entity_id='${historyA.prior.entity_id}';`), '2');
      assert.equal(scalar(container, 'ushso', `select count(*) from catalog.selected_object_revisions where entity_id='${historyA.prior.entity_id}' and revision_id='${historyA.revisionId}';`), '1');

      insertAuditEvent({
        container, auditEventId: 'audit:wp6:manual-revert-a', action: 'rollback',
        objectType: 'catalog_entity', objectId: historyA.prior.entity_id,
        details: { import_id: normalized.import_id, selected_revision_id: historyA.prior.revision_id },
        occurredAt: times.aRevert
      });
      runMaintenanceSql({
        container,
        sql: `select catalog.select_object_revision('${historyA.prior.entity_id}', '${historyA.prior.revision_id}',
          'revert', 'manual rollback rehearsal to prior revision', 'audit:wp6:manual-revert-a',
          '${normalized.import_id}', '${times.aRevert}');`
      });
      assert.equal(scalar(container, 'ushso', `select selected_revision_id from catalog.object_revision_heads where entity_id='${historyA.prior.entity_id}';`), historyA.prior.revision_id);
      assert.equal(scalar(container, 'ushso', `select count(*) from catalog.object_revision_selections where entity_id='${historyA.prior.entity_id}';`), '3');

      insertAuditEvent({
        container, auditEventId: 'audit:wp6:reselect-a', action: 'promote',
        objectType: 'catalog_entity', objectId: historyA.prior.entity_id,
        details: { import_id: historyA.importId, selected_revision_id: historyA.revisionId },
        occurredAt: times.aReselect
      });
      runMaintenanceSql({
        container,
        sql: `select catalog.select_object_revision('${historyA.prior.entity_id}', '${historyA.revisionId}',
          'select', 'reselect successor before rejection rehearsal', 'audit:wp6:reselect-a',
          '${historyA.importId}', '${times.aReselect}');`
      });
      insertAuditEvent({
        container, auditEventId: 'audit:wp6:reject-successor-a', action: 'rollback',
        objectType: 'normalization_import', objectId: historyA.importId,
        details: { import_id: historyA.importId },
        occurredAt: times.aReject
      });
      const rejectedSuccessor = await rejectProductionImport({
        importId: historyA.importId, reason: 'reject synthetic N+1 and restore eligible N',
        auditEventId: 'audit:wp6:reject-successor-a', recordedAt: times.aReject,
        container, database: 'ushso', environment: 'local'
      });
      assert.equal(rejectedSuccessor.reverted_heads, 1);
      assert.equal(rejectedSuccessor.no_eligible_heads, 0);
      assert.equal(scalar(container, 'ushso', `select selected_revision_id from catalog.object_revision_heads where entity_id='${historyA.prior.entity_id}';`), historyA.prior.revision_id);
      assert.equal(scalar(container, 'ushso', `select count(*) from catalog.object_revisions where entity_id='${historyA.prior.entity_id}';`), '2');
      assert.equal(scalar(container, 'ushso', `select count(*) from catalog.object_revision_selections where entity_id='${historyA.prior.entity_id}';`), '5');
      expectMaintenanceFailure({
        container,
        sql: `select catalog.select_object_revision('${historyA.prior.entity_id}', '${historyA.revisionId}',
          'select', 'rejected successor must remain ineligible', 'audit:wp6:reselect-a',
          '${historyA.importId}', '${times.aInvalid}');`
      }, /REVISION_BATCH_INELIGIBLE/u);

      const historyB = createSyntheticSuccessor({
        container, normalized, suffix: 'b', entityIndex: 1,
        recordedAt: times.bRecorded
      });
      insertAuditEvent({
        container, auditEventId: 'audit:wp6:select-b', action: 'promote',
        objectType: 'catalog_entity', objectId: historyB.prior.entity_id,
        details: { import_id: historyB.importId, selected_revision_id: historyB.revisionId },
        occurredAt: times.bRecorded
      });
      runMaintenanceSql({
        container,
        sql: `select catalog.select_object_revision('${historyB.prior.entity_id}', '${historyB.revisionId}',
          'select', 'select later head retained across older rejection', 'audit:wp6:select-b',
          '${historyB.importId}', '${times.bRecorded}');`
      });
      laterHeadForOlderBatchRejection = { ...historyB, times };
    });

    await t.test('batch rejection is non-destructive, audited, and fail-closed for reads', async () => {
      const before = {
        entities: scalar(container, 'ushso', 'select count(*) from catalog.objects;'),
        revisions: scalar(container, 'ushso', 'select count(*) from catalog.object_revisions;'),
        aliases: scalar(container, 'ushso', 'select count(*) from catalog.legacy_aliases;'),
        records: scalar(container, 'ushso', 'select count(*) from catalog.legacy_v1_records;')
      };
      insertAuditEvent({
        container, auditEventId: 'audit:wp6:rollback-rehearsal', action: 'rollback',
        objectType: 'normalization_import', objectId: normalized.import_id,
        details: { import_id: normalized.import_id },
        occurredAt: laterHeadForOlderBatchRejection.times.baseAudit
      });

      // The later synthetic Asset revision still depends on Source,
      // Organization, and Evidence entities whose only eligible revisions are
      // in the base import. Rejecting the base first must therefore fail
      // atomically instead of leaving a publicly selected dangling graph.
      await assert.rejects(() => rejectProductionImport({
        importId: normalized.import_id, reason: 'adversarial out-of-order rollback rehearsal',
        auditEventId: 'audit:wp6:rollback-rehearsal', recordedAt: laterHeadForOlderBatchRejection.times.baseAudit,
        container, database: 'ushso', environment: 'local'
      }), /IMPORT_REJECTION_BREAKS_ELIGIBLE_REFERENCE_CLOSURE/u);
      assert.equal(scalar(container, 'ushso', `select state from catalog.import_batches where import_id='${normalized.import_id}';`), 'applied');
      assert.equal(
        scalar(container, 'ushso', `select selected_revision_id from catalog.object_revision_heads where entity_id='${laterHeadForOlderBatchRejection.prior.entity_id}';`),
        laterHeadForOlderBatchRejection.revisionId
      );
      assert.equal(scalar(container, 'ushso', "select count(*) from catalog.object_revision_selections where audit_event_id='audit:wp6:rollback-rehearsal';"), '0');
      assert.equal(scalar(container, 'ushso', "select count(*) from catalog.object_revision_unavailability_events where audit_event_id='audit:wp6:rollback-rehearsal';"), '0');

      insertAuditEvent({
        container, auditEventId: 'audit:wp6:reject-successor-b', action: 'rollback',
        objectType: 'normalization_import', objectId: laterHeadForOlderBatchRejection.importId,
        details: { import_id: laterHeadForOlderBatchRejection.importId },
        occurredAt: laterHeadForOlderBatchRejection.times.bReject
      });
      const rejectedLaterDependency = await rejectProductionImport({
        importId: laterHeadForOlderBatchRejection.importId,
        reason: 'reject dependent successor before its foundational import',
        auditEventId: 'audit:wp6:reject-successor-b', recordedAt: laterHeadForOlderBatchRejection.times.bReject,
        container, database: 'ushso', environment: 'local'
      });
      assert.equal(rejectedLaterDependency.reverted_heads, 1);
      assert.equal(
        scalar(container, 'ushso', `select selected_revision_id from catalog.object_revision_heads where entity_id='${laterHeadForOlderBatchRejection.prior.entity_id}';`),
        laterHeadForOlderBatchRejection.prior.revision_id
      );

      const rejected = await rejectProductionImport({
        importId: normalized.import_id, reason: 'WP6 rollback rehearsal', auditEventId: 'audit:wp6:rollback-rehearsal',
        recordedAt: laterHeadForOlderBatchRejection.times.baseFinal, container, database: 'ushso', environment: 'local'
      });
      assert.equal(rejected.status, 'rejected');
      assert.equal(rejected.deleted_rows, 0);
      assert.ok(rejected.no_eligible_heads > 0);
      assert.deepEqual({
        entities: scalar(container, 'ushso', 'select count(*) from catalog.objects;'),
        revisions: scalar(container, 'ushso', 'select count(*) from catalog.object_revisions;'),
        aliases: scalar(container, 'ushso', 'select count(*) from catalog.legacy_aliases;'),
        records: scalar(container, 'ushso', 'select count(*) from catalog.legacy_v1_records;')
      }, before);
      assert.equal(scalar(container, 'ushso', `select catalog.legacy_v1_projection('${normalized.import_id}') is null;`, 'ushso_projector'), 't');
      assert.equal(scalar(container, 'ushso', "select count(*) from catalog.import_batch_events where to_state='rejected' and audit_event_id='audit:wp6:rollback-rehearsal';"), '1');
      assert.ok(laterHeadForOlderBatchRejection);
      assert.equal(
        scalar(container, 'ushso', `select selected_revision_id from catalog.object_revision_heads where entity_id='${laterHeadForOlderBatchRejection.prior.entity_id}';`),
        laterHeadForOlderBatchRejection.prior.revision_id
      );
      assert.equal(
        scalar(container, 'ushso', `select count(*) from catalog.selected_object_revisions where entity_id='${laterHeadForOlderBatchRejection.prior.entity_id}' and revision_id='${laterHeadForOlderBatchRejection.revisionId}';`),
        '0'
      );
      assert.equal(scalar(container, 'ushso', "select count(*) > 0 from catalog.object_revision_unavailability_events where reason='rejected_import_no_eligible_predecessor';"), 't');
      assert.equal(scalar(container, 'ushso', "select count(*) > 0 from catalog.object_revision_selection_status where selection_state='no_eligible_head' and unavailability_event_id is not null;"), 't');
      await assert.rejects(() => applyProductionImport({ container, database: 'ushso', environment: 'local' }), /REJECTED_IMPORT_CANNOT_BE_REAPPLIED/u);
    });
  } finally {
    postgres.stop();
  }
});
