# USHSO connector SDK

This package implements the fixture-only/local-integration WP5 connector
boundary. It enumerates and parses bounded public catalog metadata,
documentation, schema descriptions, and access-status headers. It never writes
canonical objects or search projections, retrieves source dataset rows, follows
arbitrary discovered links, submits forms, or executes a source query.

No production connector is activated by this package. The eighteen Wave 2–6
source templates exported from `src/descriptors.mjs` are deliberately `paused`,
have a `pending` legal review, and each has a source-specific registry entry with
`fixture_only`, `candidate`, `activation_authorized: false`, and the external
`AUTH-04` gate. Live source requests, credentials,
R2, PostgreSQL, Cloudflare resources, deployment, and paid infrastructure remain
outside this receipt and require explicit authorization.

Source descriptors use `ingestion.v1.1.0`, whose bounded query-name grammar can
represent JSON:API keys such as DataCite `page[number]` and `page[size]`.
Harvest plans, metadata fetches, capture references, and checkpoints remain on
their actually validated `ingestion.v1.0.0` envelopes. The explicit contract
version router prevents a caller from assuming one global validator version.

## Boundary and ports

Adapters are pure protocol parsers. They expose a strict ingestion-v1
descriptor, a plan, a manifest-bound first/next request, deterministic page
parsing, pure normalization proposals, schema targets, access-probe recipes, and
a checkpoint proposal. The shared runner owns fetch invocation, page identity,
idempotent page commits, resume state, population sealing, membership/deletion
accounting, downstream effect creation, and atomic checkpoint commitment.

Every side effect is injected:

- `transport.send` is the only HTTP-capable port. There is no default `fetch`
  implementation.
- `resolver.resolve` is required and tests use an in-memory resolver, not DNS.
- `objectStore.putIfAbsent` models a private R2 binding with checksum-confirmed,
  content-addressed writes.
- `referenceStore.commit` models the PostgreSQL capture-reference transaction.
- `requestLedger.append` records only redacted, body-free request outcomes.
- `governor.acquire` is mandatory; there is no rate/circuit bypass default.
- `runRepository` models durable page, cursor, seal, membership, checkpoint, and
  downstream-work transactions.
- `credentialProvider` may resolve a secret locator into `Authorization` or
  `X-Api-Key` only for the initial host. Neither the value nor header name is
  copied into a ledger, capture, object metadata, error, or receipt.

A descriptor that names a credential fails before egress if that provider is
absent. Redirect hops receive neither credentials nor conditional validators,
including explicitly allowlisted cross-origin redirects.

The memory ports under `src/testing/` are test doubles. They are not production
R2, database, DNS, or network clients.

## Egress policy

Requests can be created only by compiling a versioned descriptor route. The
compiler enforces HTTPS/443, `GET|HEAD`, an exact endpoint and template, a route
purpose of `catalog_metadata|documentation|schema|access_probe`, declared path
and query parameters, explicit payload/query/download/form/login/payment
prohibitions, and no secret-bearing query parameters. Source-data, query, and
payload sentinel intent is rejected before the transport port is invoked.

Before every hop the client resolves the host through the injected resolver and
rejects loopback, private, carrier-grade NAT, link-local, metadata-service,
documentation, benchmarking, multicast, reserved, and non-global IPv4/IPv6
addresses. The transport must attest the connected address against the pinned
answer, and a post-response re-resolution must be identical. Every redirect is
manually processed, bounded, policy-checked, and required to match another
declared route of the same method and purpose.

Compressed bytes, decompressed bytes, declared length, duration, redirects,
pages, methods, target classes, and media types are independently bounded.
HTTP login/forms/challenges, archives, misleading content types, unexpected
schemas, row-shaped results, healthcare-row shapes, and payload sentinels are
quarantined before object storage. Credential-bearing, signed, and private
locators in response bodies or retained headers are likewise rejected or
removed. A successful access probe is header-only and never creates a body
capture.

## Capture and checkpoint protocol

A permitted response is hashed twice: SHA-256 of the exact bounded decoded
capture bytes consumed by classifiers/normalizers and a deterministic semantic
hash. Compressed wire and decoded byte counts remain separate. The raw digest defines
`captures/sha256/<prefix>/<digest>`. The object-store port must confirm the key,
checksum, and size before the capture reference can commit. R2 custom metadata
contains only classification, connector version, and digest; it never contains
the source locator or credential material. Capture references retain only an
exact redacted locator, template and endpoint IDs, safe headers, clocks, sizes,
digests, classification, and the object key.

A crash after the object write creates an unreferenced object. Re-delivery uses
the same key and links it without duplicating content. Capture-reference IDs
identify individual observations, so a later-clock refetch after a page crash
preserves a second reference while still reusing one content object. A `304`
has zero body bytes and is usable only with an exact prior capture and a request
validator.

Run-local cursors never become global checkpoints. The runner seals only a
complete page chain and commits membership, a checkpoint, and one downstream
normalization event per discovery together. Expired cursors, page bounds,
catalog/list absence, parse drift, or downstream transaction failure leave the
checkpoint unchanged. One complete membership miss preserves an item; the
configured consecutive-miss threshold, an explicit tombstone, or an admissible
exact-item absence is required for withdrawal. Exact-distribution absence does
not withdraw its parent asset.

## Protocol adapters and source templates

Implemented reusable adapters:

- `DcatDataJsonConnector`
- `CkanCatalogConnector`
- `SocrataCatalogConnector` (metadata endpoints only; no `/resource` SODA rows)
- `HtmlReleaseInventoryConnector` (only explicitly labeled release links)
- `ArcGisCatalogConnector` (Sharing REST item metadata only)
- `DataGovV4CatalogConnector` (originating-agency preserving)
- `CmsDataCatalogConnector` and `CmsProviderDataCatalogConnector`
- `CensusMetadataConnector` (configured discovery and variables metadata only)
- `DataverseCatalogConnector`
- `DataCiteCatalogConnector`
- `OaiPmhCatalogConnector` (bounded `ListRecords`, no entity expansion)
- bounded documentation and schema-description extractors

Disabled Wave 2 templates cover Data.gov Catalog API v4,
Data.CMS.gov `data.json`, CMS Provider Data metastore, CDC Socrata, a separately
scoped CDC non-Socrata inventory, and Census discovery/variables metadata.
Data.gov v4 uses an API-key secret locator and a metadata-only `/search` route;
the provider key is never in the descriptor. Its traversal-local `after` token
does not become a global cursor checkpoint; only a sealed full snapshot
advances the template checkpoint. Census variables are reachable
only through a configured year/dataset path; no observation query is declared.

Wave 3 adds disabled HRSA and AHRQ inventories plus IRS TEOS/EO-BMF,
Form 990 manifest/index/XSD, and SOI inventory descriptors. No `.zip`, `.gz`,
filing archive, archive member, data-download, search-form, or TEOS application
route is manifested. The Form 990 path may retain public manifest metadata, but
the connector cannot retrieve or unpack a filing archive.

Wave 4 adds Pennsylvania Socrata, California CKAN, Pennsylvania ArcGIS, and
Pennsylvania static-inventory candidates. These are protocol and route
candidates, not evidence that a jurisdiction cell is integrated. Exact owner,
organization-filter, route, denominator, and terms confirmation remain pending
under `AUTH-04`, and every coverage cell remains `candidate`.

Wave 5 is a non-executing regulator/APCD registry dispatcher. It keeps hospital
licensing, health department, rate-setting, discharge-data, APCD, and other
oversight classes distinct. Navigation, application, login, agreement, identity,
payment, licensed-transfer, and contact workflows are returned only as
human-required documentation objects. The dispatcher has no transport port and
cannot submit or satisfy any workflow. `no_source_identified`, `not_assessed`,
`transport_failure`, `source_absent`, `inaccessible`, and an unknown registry ID
remain distinct outcomes.

Wave 6 adds Dataverse, DataCite, and OAI-PMH. A deterministic parity audit covers
the existing 52 Harvard Dataverse and 50 DataCite canonical records, including
stable record/asset/source-native IDs and every evidence-to-provenance link.
Both repository lanes carry an explicit ranking boundary below first-party
government authority; record volume cannot override authority.

The executable delivery-wave fixture set is exact-byte and SHA-256 pinned. It
contains no live capture claim: every entry is labeled
`offline_contract_fixture_not_live_capture`. It covers every disabled descriptor
and supplements the foundation matrix with aggregation-origin preservation, CMS
latest-versus-immutable modeling, metadata-only Socrata, Census no-observations,
ArcGIS/Dataverse/DataCite pagination, OAI resumption/deletion, workflow
non-execution, and source-specific activation gates.

The route choices are grounded in the official
[Data.gov Catalog API documentation](https://resources.data.gov/catalog-api/),
[CMS Provider Data API documentation](https://data.cms.gov/provider-data/docs),
and [Census API discovery metadata](https://api.census.gov/data.json). They have
not been called by this package. Route confirmation, policy review, credentials,
and live canaries remain activation prerequisites.

## Verification

Run from the repository root:

```sh
npm test --prefix packages/connectors
npm run matrix --prefix packages/connectors
npm run validate --prefix packages/connectors
npm test --prefix verification/wp5/v1.0.0
npm run validate --prefix verification/wp5/v1.0.0
```

The mandatory matrix covers initial/full, unchanged/no-op, conditional 304,
insert, update, duplicate, late update, expired cursor, source shrink,
tombstone, 429, network failure, restricted access, approved/unapproved
redirects, login/form, schema drift, misleading type, archive, healthcare rows,
payload sentinels, oversize responses, every deletion target class, four runner
crash/resume boundaries, and the R2-write/DB-commit orphan boundary.
