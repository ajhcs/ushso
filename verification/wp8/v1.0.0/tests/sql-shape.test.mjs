import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageRoot = new URL('../../../../packages/search/sql/', import.meta.url);
const mainSqlUrl = new URL('0010_search_projection_schema.reviewed.sql', packageRoot);

function functionSql(sql, name) {
  const marker = `create or replace function ushso_search.${name}(`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `missing SQL function ${name}`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `unterminated SQL function ${name}`);
  return sql.slice(start, end + 4).toLowerCase();
}

function executableSql(sql) {
  return sql.replace(/^\s*--.*$/gmu, '').trim();
}

test('reviewed successor SQL has immutable W1 projection and reconciliation shape', async () => {
  const sql = (await readFile(mainSqlUrl, 'utf8')).toLowerCase();
  for (const table of [
    'canonical_revision_manifests', 'canonical_revision_members', 'reference_inventory',
    'projection_generations', 'generation_state_events', 'projection_documents',
    'projection_document_revisions', 'projection_truth_refs', 'projection_facets',
    'projection_acknowledgements', 'acknowledgement_documents', 'publication_builds',
    'publication_manifests', 'publication_components', 'promotion_gates',
    'publication_pointer', 'publication_history', 'retention_audit',
    'final_holdout_uses', 'final_holdout_terminal_receipts',
  ]) assert.match(sql, new RegExp(`create table if not exists ushso_search\\.${table}\\b`));

  assert.match(sql, /selection_model text not null check \(selection_model = 'exact_immutable_revision_membership'\)/);
  assert.match(sql, /build_strategy text not null check \(build_strategy = 'complete_as_of_exact_revision_manifest'\)/);
  assert.match(sql, /source_of_truth boolean not null default false check \(source_of_truth = false\)/);
  assert.match(sql, /generation_state_events.*append_only boolean/s);
  assert.match(sql, /immutable_triggers.*before update or delete/s);
  assert.match(sql, /projection_generation_build_start/);

  const validate = functionSql(sql, 'validate_generation');
  for (const invariant of [
    'projection obligations are not fully acknowledged',
    'visibility or acknowledgement reconciliation failed',
    'acknowledged document checksum mismatch',
    'unacknowledged projection document',
    'document canonical revision reconciliation failed',
    'truth reference visibility reconciliation failed',
  ]) assert.ok(validate.includes(invariant), `validation omits ${invariant}`);
  assert.ok(validate.indexOf("state = 'validated'") < validate.indexOf('insert into ushso_search.generation_state_events'));
});

test('public SQL is bounded, indexed, generation-pinned, and keyset paginated', async () => {
  const sql = (await readFile(mainSqlUrl, 'utf8')).toLowerCase();
  assert.match(sql, /using gin \(search_vector\)/);
  assert.match(sql, /where visibility_state = 'public'/);
  assert.match(sql, /projection_facets_lookup_idx/);
  assert.match(sql, /projection_document_revisions_hydration_idx/);

  const search = functionSql(sql, 'search_candidates');
  const browse = functionSql(sql, 'browse_candidates');
  const hydrate = functionSql(sql, 'hydrate_exact_revisions');
  for (const body of [search, browse, hydrate]) {
    assert.match(body, /assert_publication_generation_pin\(p_publication_id, p_generation_id\)/);
    assert.doesNotMatch(body, /publication_pointer/);
    assert.match(body, /set statement_timeout = '600ms'/);
    assert.doesNotMatch(body, /\boffset\b/);
  }
  assert.match(search, /d\.generation_id = p_generation_id/);
  assert.match(search, /d\.search_vector @@ q\.query/);
  assert.match(search, /p_limit > 51/);
  assert.match(search, /r\.rank_micros < p_cursor_rank_micros/);
  assert.match(browse, /\(d\.primary_canonical_id, d\.document_id\) > \(p_cursor_canonical_id, p_cursor_document_id\)/);
  assert.match(hydrate, /jsonb_array_length\(p_pins\) not between 1 and 50/);
});

test('pointer promotion, rollback, failure containment, revocation, and retention are transaction-shaped', async () => {
  const sql = (await readFile(mainSqlUrl, 'utf8')).toLowerCase();
  const promote = functionSql(sql, 'promote_publication');
  const rollback = functionSql(sql, 'rollback_publication');
  const resolve = functionSql(sql, 'resolve_active_publication');
  const expire = functionSql(sql, 'expire_retired_generation');

  assert.match(resolve, /volatile/);
  assert.match(resolve, /pointer_lookup_cache_disabled/);
  assert.match(resolve, /component_count <> 7/);
  assert.ok(promote.indexOf('for update') < promote.indexOf('insert into ushso_search.publication_history'));
  assert.ok(promote.indexOf('insert into ushso_search.publication_history') < promote.indexOf('update ushso_search.publication_pointer'));
  assert.match(promote, /publication gates are incomplete/);
  assert.match(promote, /publication does not match its validated build receipt/);
  assert.match(promote, /public_cutover_authorization_ref is null/);
  assert.match(rollback, /retained n-1 publication/);
  assert.match(rollback, /g\.safety_revoked_at is not null/);
  assert.match(expire, /active or n-1 pointer/);
  assert.match(sql, /create or replace function ushso_search\.safety_revoke_generation/);
  assert.match(sql, /create or replace function ushso_search\.consume_final_holdout_lease/);
  assert.match(sql, /create or replace function ushso_search\.complete_final_holdout_lease/);
  assert.match(sql, /package_content_sha256 text primary key/);
  assert.match(sql, /ordinary_test_access boolean not null default false/);
  assert.match(sql, /authorization_verification_sha256 text not null/);
  assert.match(sql, /terminal_verification_sha256 text not null/);
  assert.match(sql, /returns table \(accepted boolean, package_content_sha256 text, lease_sha256 text\)/);
  assert.match(sql, /terminal_receipt_sha256 text/);
  assert.match(sql, /return query select true, package_sha, lease_sha/);
  assert.match(sql, /return query select true, p_package_content_sha256, p_lease_sha256, receipt_sha/);
  assert.match(sql, /p_terminal_receipt ->> 'evaluator_actor_id' <> expected_evaluator_id/);
  assert.match(sql, /clock_timestamp\(\) >= expected_authorization_expires_at/);
  assert.match(sql, /external_per_item_side_outputs_proven_absent boolean not null default false/);
  assert.match(sql, /grant execute on function ushso_search\.consume_final_holdout_lease\(jsonb\) to ushso_evaluation_custodian/);
});

test('query templates and EXPLAIN gate cannot become full-corpus Worker scans or false evidence', async () => {
  const [search, browse, hydrate, explainSql, readme] = await Promise.all([
    readFile(new URL('query/search-candidates.sql', packageRoot), 'utf8'),
    readFile(new URL('query/browse-candidates.sql', packageRoot), 'utf8'),
    readFile(new URL('query/hydrate-exact-revisions.sql', packageRoot), 'utf8'),
    readFile(new URL('explain/production-query-plan-gate.sql', packageRoot), 'utf8'),
    readFile(new URL('README.md', packageRoot), 'utf8'),
  ]);
  for (const source of [search, browse, hydrate]) {
    const query = executableSql(source);
    assert.match(query, /ushso_search\.(?:search_candidates|browse_candidates|hydrate_exact_revisions)\(/);
    assert.doesNotMatch(query, /\boffset\b/i);
    assert.doesNotMatch(query, /canonical_revision_members/i);
    assert.doesNotMatch(query, /publication_pointer/i);
  }
  assert.match(explainSql, /explain \(analyze, buffers, wal, settings, format json\)/i);
  assert.match(explainSql, /^begin;/m);
  assert.match(explainSql, /^rollback;/m);
  assert.match(explainSql, /ordinary ci performs only static sql-shape verification/i);
  assert.match(readme, /not a migration/i);
  assert.match(readme, /not evidence of production performance/i);
  assert.match(readme, /performance and public-cutover gates remain unverified/i);
});
