# Non-destructive rollback and head recovery

Rollback is an audited transition of an import batch to `rejected`; it is not a
down migration and does not delete truth. The operations audit event must
authorize `rollback` for the exact `normalization_import` and import ID before
`catalog.reject_import_batch` accepts the request.

When the rejected batch supplies a currently selected N+1 revision, rejection
walks immutable predecessor edges and atomically appends a `revert` selection
to the nearest eligible N revision. It retains N, N+1, the supersession edge,
all selection events, evidence, aliases, typed projections, legacy audit rows,
and batch events. A later head from another batch is never changed when an
older batch is rejected.

For a new entity with no eligible predecessor, the raw head remains available
for audit but is excluded from eligible reads. An append-only
`rejected_import_no_eligible_predecessor` event and the
`object_revision_selection_status` view make this state explicit.

Local rehearsal requires an `ops.audit_events` row and then:

```sh
npm --prefix packages/normalization run reject:local -- \
  --import-id urn:ushso:import:0a00fe54b027f45b336d3900f3d0727c0465b3eb \
  --reason "rollback rehearsal" \
  --audit-event-id audit:wp6:rollback-rehearsal \
  --recorded-at 2026-08-30T20:00:00.000Z
```

Verify that the legacy projection is no longer eligible, later heads remain
unchanged, predecessor fallback occurred where possible, explicit unavailable
events exist otherwise, and raw row counts did not decrease. The static public
path remains unchanged until a separately authorized publication cutover.
