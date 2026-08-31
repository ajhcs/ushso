-- Keyset browse; OFFSET and unbounded scans are intentionally absent.
select *
from ushso_search.browse_candidates(
  $1::text,
  $2::text,
  $3::jsonb,
  $4::integer,
  $5::text,
  $6::text
);
