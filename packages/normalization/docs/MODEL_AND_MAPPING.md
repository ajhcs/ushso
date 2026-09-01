# Canonical model and legacy mapping

The WP6 import is a deterministic, offline migration of the frozen production
retrieval corpus `v1.1.0`. Its maintenance-owned authority row pins the source
manifest, records, search-document, and join-route hashes; the normalizer
version; all canonical collection counts; and the canonical bundle,
projection, and complete-document SHA-256 values.

## Reconciliation

- 157 legacy records map one-to-one to 157 canonical `Asset` identities.
- 157 search documents remain exact legacy projection rows.
- 14 legacy join routes map to exact candidate `SchemaField` endpoints.
- Every source record and join route has an explicit accepted or rejected
  mapping. The sealed corpus has zero rejected items.
- All legacy public IDs are permanent aliases. Mutable titles and locators are
  never identity keys.

Similarity by title or locator creates a separate
`same_identity_candidate` relationship. It never creates `same_identity` and
never merges objects. Join candidates remain `conditional` or `incompatible`;
candidate evidence cannot become documented, observed, executed, proven, or
compatible without a later evidence-backed review decision.

## Truth and lineage

Every truth-bearing object has an immutable object revision with four distinct
clock concepts: first seen, observed, recorded, and publisher time. Revision
payloads and the import document use `ushso-canonical-json-v1`: UTF-8 byte
ordered object keys, preserved array order, JSON string escaping, booleans and
null, and safe integers. PostgreSQL recomputes every relevant SHA-256 instead
of trusting caller-supplied digests.

Evidence derivation parents are identifier-only lineage anchors derived from
provenance IDs in the fingerprint-bound legacy projection. They do not contain
source payloads. Typed and logical references are checked against compatible
entity types and eligible revisions inside the security-definer import.

Current revision selection is not a mutable lifecycle bit. Immutable
supersession edges and append-only selection events feed an audited head
pointer. A revert changes the selected head without deleting either revision.

## Projection boundary

The database-backed v1 projection preserves records, search documents, join
routes, IDs, access states, evidence, warnings, and ordering exactly. A
zero-result response remains successful and carries
`absence_claim_permitted=false`; it is not evidence that no source exists.
