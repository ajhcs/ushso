# WP5 verification receipt set

This receipt set verifies the shared connector SDK and reusable Wave 1–6
protocol adapters only at `fixture_only` and `local_integration` levels. All network,
DNS, R2, PostgreSQL, Cloudflare, credential, server, and deployment ports were
in-memory fakes. No authoritative source was contacted by the connector or
verification execution, and no external state was changed.

The local gates prove descriptor and ingestion-contract conformance, manifest-
bound egress, SSRF and DNS-rebinding controls, response bounds, content
quarantine, conditional requests, content-addressed capture ordering,
checkpoint and membership safety, deterministic adapter behavior, crash/resume,
cross-origin redirect header stripping, observation-reference durability, exact
discovery-to-capture lineage, and zero source-data/healthcare-row capture.

The delivery-wave receipt additionally covers eighteen disabled source
descriptors and their source-specific promotion records: Wave 2 national
catalogs; Wave 3 HRSA/AHRQ/IRS inventories; Wave 4 state Socrata, CKAN, ArcGIS,
and static candidates; the Wave 5 non-executing regulator/APCD dispatcher; and
Wave 6 Dataverse, DataCite, and OAI-PMH. Eighteen exact-byte offline fixtures are
SHA-256 pinned and labeled as contract fixtures, not live captures. The legacy
parity receipt checks all 52 Harvard Dataverse and 50 DataCite records against
the pinned canonical corpus without creating an identity merge or increasing
their authority above first-party government sources.

They do not claim the per-source activation gate. `live_shadow`,
`index_shadow`, `canary`, and `active` remain
`PENDING_EXTERNAL_AUTHORIZATION`. Those stages require policy/terms approval,
credential and infrastructure provisioning, live route confirmation, source-
specific reconciliation cycles, production observability, publication
traceability, and rollback rehearsal.
Every source is `candidate`/`paused` and independently gated by external
authorization `AUTH-04`; a local template pass is not an activation receipt.

Run from the repository root:

```sh
npm test --prefix packages/connectors
npm run validate --prefix packages/connectors
npm test --prefix verification/wp5/v1.0.0
npm run validate --prefix verification/wp5/v1.0.0
```
