# Reviewed WP8 PostgreSQL search SQL

`0010_search_projection_schema.reviewed.sql` is additive successor SQL for later migration 0010 integration. It is not a migration and ordinary CI does not apply it. The active `db/**` migration sequence remains owned elsewhere.

The design stores exact W1 membership, immutable projection generations, normalized facets, acknowledgement/reference ledgers, append-only lifecycle/history, and the singleton publication pointer. Public functions require explicit publication and generation pins; no cacheable query dereferences the mutable pointer. FTS uses a partial GIN index, browse and hydration use composite B-tree indexes, pagination is keyset-based, and every public result path is capped at 51 database rows.

Promotion and rollback acquire the singleton pointer row with `FOR UPDATE`, validate all seven components and all required gates, append history, transition component generations in deterministic ID order, and switch the pointer in one short transaction. Failed transactions preserve the prior pointer automatically. The public database role gets execute-only access to generation-pinned functions; projector and operations grants remain separate.

Final retrieval-gate control stores only lease and aggregate terminal-receipt
metadata. A unique package-content digest consumes a sealed holdout on the first
authorized attempt, including failed attempts; no item content or item-level
output enters this schema. The separately provisioned
`ushso_evaluation_custodian` role is the only caller. This supports `AUTH-13` but
does not assert that a replacement package exists or that authorization was
granted. Production leases must already carry a digest-bound authorization and
custody verification receipt; completion is bound to the authorized evaluator,
the terminal-verification receipt, and both supplied completion time and database
clock before authorization expiry. These controls validate receipt boundaries;
they do not independently prove custody or absence of evaluator side outputs.
The application adapter accepts a write only when the function returns exactly
one `accepted=true` row echoing the package, lease, and (for completion) terminal
receipt digests; missing, negative, mismatched, or duplicate acknowledgements
fail closed.

The `explain/` file is a rehearsal template, not evidence of production performance. Final WP8/WP14 receipts require an authorized production-like database, the frozen workload manifest, redacted `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` output, the 30-minute 2× load test, and measured rollback timing. Until then the performance and public-cutover gates remain unverified.
