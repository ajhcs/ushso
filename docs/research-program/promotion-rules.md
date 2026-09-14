# Promotion rules

Policy version: `ushso.promotion-policy.v1`.

## Classes

- **literal publisher metadata** may promote under an approved field/source rule without a separate human click for every field.
- **inferred scientific statements**, **identity merges**, and **ambiguous mappings** require explicit review and cannot receive literal-observation status.

Scientific acceptance and technical acceptance are separate recorded decisions. Automated rules cannot authorize source access or legal rights.

## Exact revisions

A candidate revision binds source, generation, value, and field hashes plus individual dispositions. Rejected, conflicting, and unknown values remain in provenance. A stale approval, incomplete source run, or changed field hash cannot promote. Unaffected accepted claims remain available.

## Rollback

Promotion diffs are reversible. Rollback restores prior public facts and retains newer attempt/review history. Last-good generation `live-2026-09-03-85b50522b420` is not changed by a failed or rolled-back candidate.

Sealed `packages/normalization/src` and `packages/identity/src/review-ledger.mjs` are not edited by this policy implementation.
