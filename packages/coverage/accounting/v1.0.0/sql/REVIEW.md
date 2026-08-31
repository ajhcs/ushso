# Proposed migration 0011 review

`0011_coverage_facts_definitions_snapshots.reviewed.sql` is an additive,
forward-only proposal for the planned eleventh migration. It has not been
copied to `db/migrations`, added to the migration manifest, or executed.

The proposal preserves:

- append-only metric definitions, source-scope facts, stage facts, membership
  manifests, snapshots, metrics, source classes, and matrix cells;
- exact denominator-status/rate constraints, including `rate = null` for zero
  or unknown denominators;
- one cell per `(snapshot, jurisdiction, source class)` and the seven exact
  `coverage_cell_state` values;
- absence-reason pairing and denial for every non-integrated cell;
- typed unknown/not-applicable/excluded/unclassified counts;
- no direct `ushso_public` read or write grants.

Static tests reject destructive statements, missing uniqueness, state drift,
unsafe zero-denominator rates, and accidental presence of the proposal in
`db/migrations`. PostgreSQL execution is deferred because the required 0007–0010
sequence is not yet complete in this workstream. Before promotion, run the
repository migration verifier in an isolated local PostgreSQL environment,
review the final role grants against the then-current projection writer, add the
exact byte hash to the migration manifest, and rehearse publication-pointer
rollback.

Operational rollback never drops these tables. It selects a prior sealed
coverage/publication snapshot while retaining immutable evidence for audit.
