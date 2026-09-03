-- Run only against an authorized production-like temporary/staging database.
-- Replace fixture values with the versioned workload-manifest pins. Store
-- redacted EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) output in the final
-- query-plan receipt. Ordinary CI performs only static SQL-shape verification.

begin;
set local statement_timeout = '5s';
set local lock_timeout = '1s';
set local plan_cache_mode = 'force_custom_plan';

explain (analyze, buffers, wal, settings, format json)
select * from ushso_search.search_candidates(
  'publication:production-like-fixture',
  'generation:asset-search:production-like-fixture',
  'hospital financial utilization pennsylvania',
  '{"geographies":["US-PA"],"authority_tiers":["first_party"]}'::jsonb,
  21,
  null,
  null,
  null
);

explain (analyze, buffers, wal, settings, format json)
select * from ushso_search.browse_candidates(
  'publication:production-like-fixture',
  'generation:asset-search:production-like-fixture',
  '{}'::jsonb,
  21,
  null,
  null
);

explain (analyze, buffers, wal, settings, format json)
select * from ushso_search.hydrate_exact_revisions(
  'publication:production-like-fixture',
  'generation:asset-search:production-like-fixture',
  '[{"canonical_id":"asset:fixture","revision_id":"revision:fixture"}]'::jsonb
);

rollback;
