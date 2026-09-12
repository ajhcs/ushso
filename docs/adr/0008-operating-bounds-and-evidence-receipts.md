# ADR 0008: Operating bounds and evidence receipts

- **Status:** Proposed
- **Implementation state:** `in_progress`
- **Decision date:** 2026-09-12
- **Decision owners:** Platform, Data, Operations, Security, Architecture
- **Accountable approver role:** Platform architecture owner
- **Acceptance basis:** Master-plan PR-009 packet and retained operating-input
  receipts; this record does not accept R03, R14, R15, or R16
- **Plan authority:** `docs/master-plan/2026-09-10/prs/PR-009.md`;
  `docs/RESEARCH_NAVIGATOR_IMPLEMENTATION_PLAN.md` §§5–9, 13, 17–18, 20
  (WP3–WP5), 23.5, and 24
- **Depends on:** ADR 0001, ADR 0002, ADR 0003, ADR 0004, ADR 0005
- **Supersedes:** No accepted ADR. Refines unanswered operating-bound,
  retention-class, evidence-receipt, and descriptor-hash questions left open
  by ADR 0004 and ADR 0005 without replacing their architecture choices
- **Superseded by:** None
- **External state:** No paid resource, production binding, live collection,
  database migration, queue, workflow, or deletion action is authorized or
  created by this record

## Mapped requirements and tests

| Source | Requirement or test |
|---|---|
| Plan | PR-009 C-009-1/C-009-2/C-009-3; R03, R14, R15, R16 remain unevaluated |
| Findings | F03, F13, F32, F33 |
| Tester requirements | TST-TRUST-01, TST-COV-02, TST-MCP-04 |
| Acceptance tests | `operating-bounds.policy`, `evidence-receipt.contract`, `census-historical-negative`, `no-source-egress` |
| Acceptance evidence | `tests/research-program/operating-bounds.test.mjs`; `scripts/research-program/policy.json`; `scripts/research-program/receipts/v1.0.0/evidence-receipt.schema.json`; `verification/research-program/pr-009/` |

## Index note

WP0 v1.0.0 pins `docs/adr/README.md` and ADRs 0000–0006 as accepted
append-only bytes. This Proposed successor is therefore **not** added to that
frozen index. An Accepted later revision may add the index row only with a
WP0 successor attestation. ADR 0007 remains a separate WP14 attestation and
is not superseded here.

## Context

Collection, sample retention, and control-plane topology must be explicit and
cost-bounded without converting catalog membership into payload access or
inventing a cheapest provider. Existing connector descriptors already name
paused metadata/documentation/schema/access-probe routes, byte and redirect
caps, and a 90-day raw capture default. Existing ingestion stage retry and DLQ
transport policy already exist. None of those packages may be edited here.

The current public runtime remains a static, no-source-egress Worker. Neon
PostgreSQL remains the canonical/control-plane target from ADR 0004; R2 remains
bounded public metadata/documentation evidence. Those choices are not reopened.
What this record must settle, or explicitly leave unresolved, is:

1. whether a new paid control-plane/publication topology is selected from
   measured cost;
2. the request, retry, retention, and activation bounds consumed by later
   collection jobs;
3. a standalone evidence-receipt contract that cites immutable ingestion
   records without editing them;
4. the named descriptor-hash basis that PR-010 may carry unchanged.

## Decision

### 1. Topology: preserve the current static public runtime

The public request path continues to read a pinned published view. It does not
harvest, accept credentials, write R2, or select a candidate Worker version.
PostgreSQL remains canonical; R2 remains a separately gated evidence store for
bounded metadata/documentation captures, never source payloads, healthcare
rows, credentials, cookies, authorization material, or secret-bearing URLs.
An aggregate/sample store is a separate rights and privacy decision and stays
disabled here.

No new Neon project, Cloudflare Worker, R2 bucket, Queue, Workflow, Hyperdrive
binding, paid plan, or DNS change is selected. The six-`neon_role` design
rejected in the ADR 0004 security addendum remains rejected.

### 2. Measured cost is incomplete; cheapest topology remains null

Retained public-rate and publication-byte inputs are:

- Neon public GET 200 for `https://neon.com/pricing` at
  `2026-09-11T17:54:21.006904+00:00`, response SHA-256
  `4a9c3a39127211649236973c9d93da688a82c55353cb43e4191247f84780e3ed`.
  Documented paid Launch compute $0.106/CU-hour, Scale $0.222/CU-hour,
  database $0.35/GB-month, history $0.20/GB-month, snapshots $0.09/GB-month,
  500 GB public transfer per project then $0.10/GB. Transfer is billed on GB
  transferred in a billing month, not storage GB-month. These are documented
  rates, not a procured plan, measured CU-hours, or an invoice.
- Cloudflare Workers Standard published inputs: $5 per account-month, 10
  million included requests and 30 million included CPU-ms, then $0.30 per
  million requests and $0.02 per million CPU-ms. Paid static file count 100000;
  per-file 25 MiB. Direct static asset storage/requests are documented as free;
  the pinned `run_worker_first: ['/*']` still invokes a Worker and is not
  changed here.
- Previously accepted publication measurement: 41865 `apps/web/dist` files and
  1338661425 bytes, largest file 8383528 bytes. The later e3af8dd inventory
  (41865 files, 1338670840 bytes) is a retained artifact length, not a bill.
  Dictionary review artifacts dominate those bytes.

Conditional arithmetic from those rates cannot establish total operating cost
or incremental account spend. Missing actual account plan, usage, invoice,
workload, capacity, recovery, residency, and source-rights facts remain
unresolved. **`measured_cheapest_new_topology` is null.** A policy/receipt
implementation does not satisfy this topology decision.

### 3. Request, retry, and activation bounds

`scripts/research-program/policy.json` is a fixture-only local integration
policy. All activation flags are false: live network, receipt writes, database
writes, queue, workflow, deletion, and source egress. The external
authorization gate remains `AUTH-04`. Source entries name exact source,
descriptor, endpoint, and route-template IDs. They do not contain arbitrary
URLs, query strings, credentials, or body content.

Request bounds are no looser than the matching paused descriptor. Structural
response limits equal `DEFAULT_RESPONSE_LIMITS`. Origin concurrency, rate, and
burst are equal to or stricter than the descriptor. Harvest retry and DLQ
transport values are the existing ingestion exports, not a second retry
engine. Arbitrary user URLs and unauthorized operation classes are rejected.

### 4. Retention classes

Ninety days is the active raw metadata/documentation **default**, not an
unconditional legal floor. A versioned source-policy class may choose a
shorter or longer period only with owner, rationale, review date, audit
event, and explicit legal/rights/dependency/recovery evidence. Capture hashes,
safe provenance, and evidence-lineage references outlive raw retention while
dependencies remain. Security and audit receipts remain at least 365 days.
Existing GC all-zero dependency proof, archive/restore, backup/PITR, replay,
and rollback checks remain in force. This record does not execute deletion.

### 5. Evidence receipt contract

The receipt `ushso.research-program.evidence-receipt.v1.0.0` is a standalone
strict JSON Schema 2020-12 artifact. It does not add properties to released
`ingestion.v1.0.0` metadata-fetch or capture-reference records. It records
request type, expected content classes, safe final host/path, observed sizes
and hashes, source/parser identity, attempt outcome, and next action. It
contains no secrets and no body content.

Capture raw/semantic hashes are populated only from a validated capture
reference. A hash of a retained rejected body is labeled
`observed_rejected_body_sha256` and never proves capture or schema validity.
Truncated bytes never imply complete schema validation. HTTP 200 is not
content or payload success.

The retained Census `sample-census-acs` observation is an unmatched historical
negative: HTTP 200 `text/html` Missing Key page, safe final locator
`https://api.census.gov/data/missing_key.html`, complete rejected-body hash
`c2f4687e09b80676de7f68dec92ebea395209616dbc6f895520e547c5f68c0f5`. The
historical query URL is omitted. `redirect_count` is null/unknown, not zero.
Parser state is `not_run`. Outcome is typed access/content failure. No
approved Census metadata route ID is fabricated.

### 6. Descriptor hash basis for PR-010

Two digest claims are distinct (`contracts/ingestion/v1.1.0/README.md`):

1. SHA-256 of **exact published descriptor bytes**
2. SHA-256 of the **`ushso-canonical-json.v1`** representation (UTF-8,
   recursively sorted object keys, preserved array order)

This policy names **`hash_basis=ushso-canonical-json.v1`** /
`hash_version=ushso-canonical-json.v1` as the digest a collection job may
carry. The registry column `registry.source_revisions.descriptor_sha256` is an
append-only 64-hex field with no insertion invariant recomputing it from
either byte basis. JSONB storage is not evidence of original published bytes.
Fixture `lpad(to_hex(n), 64, '0')` values are not computed descriptor hashes.

PR-010 must:

- look up `descriptor_sha256` by exact `(source_id, revision_number)`;
- carry that registered value **unchanged** only when the named basis is
  `ushso-canonical-json.v1`;
- fail closed on a missing value, invalid digest, source/revision mismatch, or
  unnamed/other basis;
- never hash `configuration_revision` or a source/endpoint/revision tuple and
  call the result an exact descriptor hash.

Exact published-byte hashing remains an unresolved distinct claim until a
later accepted handoff supplies sanitized evidence of original bytes.

## Earlier ADR clauses retained

| Record | Retained clauses |
|---|---|
| ADR 0001 | Catalog visibility is not payload access, authorization, join compatibility, coverage, or scientific fitness. Public requests never harvest. Typed unknown/failed/blocked/stale outcomes remain meaningful. |
| ADR 0002 | Released schemas, fixtures, manifests, and validators are immutable successors. No `expected_content`, `final_locator`, `parser_identity`, or `next_action` fields are inserted into v1.0 metadata-fetch/capture objects. |
| ADR 0003 | No automatic identity merge or similarity-based equality as a side effect of retention or evidence processing. |
| ADR 0004 | PostgreSQL canonical; R2 bounded metadata/documentation only; failed runs cannot replace last-known-good publication; staging/production isolation; pointer-based rollback; 90-day raw default with evidenced overrides; 365-day security/audit receipts; six-`neon_role` rejected. Unresolved Neon/Cloudflare procurement, SLA, capacity, PITR, and Access facts remain unresolved. |
| ADR 0005 | PostgreSQL FTS/GIN remains the first production search candidate. The current static adapter remains the emergency/public fallback. An unmeasured search vendor is not selected. |

## Alternatives considered

| Alternative | Disposition | Reason |
|---|---|---|
| Select Neon Launch or Scale as the cheapest measured topology from public list prices | Rejected | List prices plus publication-file counts are not measured CU-hours, transfer, invoice, or capacity. |
| Keep JSONL as the production control plane | Rejected as a target, retained as the current public runtime | ADR 0004 already rejected JSONL as canonical truth; this record does not deploy the database-backed successor. |
| Add evidence fields onto ingestion.v1.0.0 metadata-fetch/capture records | Rejected | Released contracts are immutable; extra properties are a breaking change. |
| Hash `(source_id, endpoint_id, revision)` and call it descriptor_sha256 | Rejected | Deterministic but not an exact descriptor digest. |
| Edit `packages/connectors` or `packages/ingestion` to export receipt helpers | Rejected for this assignment | First connector-byte change requires a separately owned WP5 successor. |
| Activate live collection or GC deletion from the policy file | Rejected | Activation remains false; deletion is a later audited action. |

## Consequences

Operators gain a named, fixture-only policy and a strict in-memory receipt
composer. Later PR-010 jobs can consume a named hash basis without inventing
one. The public no-source-egress boundary is unchanged. The program still
lacks a measured cheapest topology, source-specific legal overrides, and
durable receipt persistence.

## Compatibility and rollout

No migration, Worker binding, or publication-pointer change is performed.
Consumers import `scripts/research-program/operating-bounds.mjs` with injected
descriptor/limit/retry context. Durable persistence, HTTP, and quota
enforcement remain PR-010/011/012. The first connector edit remains a
separately owned WP5 v1.1.0 (or next immutable) successor.

## Implementation and verification

| Control | Required verification | Receipt target |
|---|---|---|
| Topology honesty | ADR states null cheapest topology and lists missing measurements | `docs/adr/0008-operating-bounds-and-evidence-receipts.md` |
| Policy bounds | Default policy accepts; foreign IDs, URLs, activation, unbounded limits, and unauthorized retention fail | `tests/research-program/operating-bounds.test.mjs` |
| Receipt contract | Captured, 304, access-only, pre-egress, typed failure, truncation, and Census historical negative | `scripts/research-program/receipts/v1.0.0/evidence-receipt.schema.json` |
| No side effects | Pure module has no fetch/http/net/tls/database/queue/R2 imports | `tests/research-program/operating-bounds.test.mjs` |
| Underlying contracts | Injected ingestion.v1.0.0 metadata-fetch and capture-reference records still validate | `contracts/ingestion/v1.0.0/fixtures/valid-fixtures.json` |

This ADR does **not** authorize procurement, Terraform apply, live source
requests, production secrets, or traffic promotion. If later measured evidence
selects a different topology, a new numbered ADR must preserve the product,
truth, publication, privacy, and rollback boundaries above.
