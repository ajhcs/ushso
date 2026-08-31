-- Prepared query used by PostgresSearchBackendV2. Every call carries explicit
-- immutable publication and generation pins. No mutable pointer is dereferenced.
select *
from ushso_search.search_candidates(
  $1::text,
  $2::text,
  $3::text,
  $4::jsonb,
  $5::integer,
  $6::bigint,
  $7::text,
  $8::text
);
