-- Resolves only the exact canonical revision pins carried by bounded candidates.
-- canonical_source_ref is subsequently dereferenced by the canonical repository;
-- the projection remains source_of_truth=false.
select *
from ushso_search.hydrate_exact_revisions(
  $1::text,
  $2::text,
  $3::jsonb
);
