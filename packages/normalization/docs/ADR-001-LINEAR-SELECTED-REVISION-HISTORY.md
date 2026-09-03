# ADR-001: Linear selected-revision history in the WP6 persistence profile

Status: accepted for the WP6 database import profile.

Core v2 permits `history.supersedes_revision_ids` to contain more than one
revision because the shared semantic contract can describe a convergent
provenance graph. The WP6 public selected-head ledger intentionally supports a
stricter subset: one revision may have at most one immediate predecessor and
one immediate successor. This makes automatic audited rejection fallback
deterministic and prevents a rollback from choosing among multiple ancestors.

This is a persistence-profile restriction, not a redefinition of core v2. The
package semantic guard and `catalog.validate_normalization_bundle` both reject
multi-predecessor input with `DB_LINEAR_HISTORY_MULTIPLE_PREDECESSORS` before
publication. Producers that need convergent provenance must express it through
lineage/evidence relationships or undergo a future ADR and migration that adds
an explicit reviewed selection policy. Existing core-valid convergent history
must never be silently coerced to a linear edge.

