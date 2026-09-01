# Security policy

## Reporting a vulnerability

Please do not include credentials, protected health information, controlled
data, raw acquisition payloads, private evidence, or unnecessarily detailed
exploit instructions in issues or pull requests.

Until a private reporting channel is published, do not disclose exploitable
security details in a public issue. Contact the repository owner through GitHub
profile channels and request a private reporting route.

## System and scope

USHSO is a metadata-only research navigator. It recommends public authoritative
sources, explains access and compatibility, and deterministically compiles
research plans. It does not acquire underlying healthcare datasets, inspect
their rows, execute analysis or retrieval recipes, calculate market share or
financial benchmarks, grant source access, or silently merge identities.

The currently deployable public surface is a Cloudflare Worker and static web
application serving the versioned v1.1.0 metadata corpus, browser pages, and the
`/api/health`, `/api/contract`, `/api/catalog`, `/api/datasets/*`, and
`/api/discover` routes. The active Worker reads packaged static assets; it does
not currently have production database, queue, workflow, R2 capture, harvester,
or operations bindings. The current production/custom-domain release is pinned
in `RELEASE_PROVENANCE.json`; any new deployment, route change, or domain change
continues to require separate review and authorization.

The target Research Navigator adds separately deployed public-query,
scheduler/dispatcher, harvester, normalization/projector, and authenticated
operations components. Its trust boundaries include PostgreSQL reached through
Hyperdrive, R2 metadata captures, Cloudflare Queues and Workflows, source-host
egress, publication manifests, signing and connector secrets, and operator
actions. Target controls are requirements until their release receipts and
production-binding tests exist; this document does not claim that unprovisioned
infrastructure has been verified.

## Threat model and trust boundaries

Treat public paths, headers, query parameters, JSON bodies, pagination and
clarification tokens, and browser-tool arguments as attacker-controlled. Treat
authoritative-source HTML, JSON, XML, headers, redirects, DNS answers, URLs,
metadata text, filenames, schemas, and rate-limit responses as untrusted data.
Queue messages, workflow events, R2 objects, database rows, import bundles, and
review actions require integrity, provenance, authorization, and replay checks;
their presence in an internal system does not make their contents trusted.

Important assets are the canonical metadata/evidence history, identity and
review decisions, source configuration and policy, publication pointers and
generation manifests, correctness ledgers, user-query privacy, secrets, and the
zero-action product boundary. A public metadata claim must remain traceable to
evidence and an observation time. A public generation must be complete,
immutable, reproducible, and last-known-good rather than a partial consequence
of an upstream or pipeline failure.

Source-specific access restrictions continue to apply at authoritative
sources. A public listing, Access Plan, or Retrieval Recipe is neither proof of
payload access nor authorization to submit a registration, login, agreement,
payment, DUA, or licensed transfer.

## Security invariants

### Metadata-only and zero action

- Connector allowlists and request manifests cover only approved metadata,
  documentation, schema-description, and access-observation routes. Row-shaped,
  source-data-payload, credential, form-submission, and payload-sentinel targets
  must be rejected before egress.
- Public schemas and responses contain no underlying healthcare rows, source
  payload bodies, computed measures, analytical results, market-share values,
  or financial benchmark results.
- Public API and WebMCP responses carry the shared, contract-defined truth
  boundary. Authoritative source requests, access authorization, recipe
  execution, payload acquisition, analysis execution, and identity mutation are
  always false for public calls.
- Public request paths never harvest authoritative sources. They read a pinned
  published generation through same-origin assets or least-privilege canonical
  services only.

### Harvester network and capture safety

- Source hosts are allowlisted by versioned configuration. Every redirect is
  revalidated, schemes and ports are bounded, and redirects never inherit
  credentials or authorization headers.
- Resolution and connection checks block loopback, private, link-local,
  multicast, reserved, metadata-service, and unapproved address ranges for
  IPv4 and IPv6. DNS answers are pinned/rechecked so rebinding cannot bypass the
  destination policy.
- Requests bound redirects, duration, pages, request bytes, response bytes,
  decompressed bytes, and content types. Decompression bombs, ambiguous parser
  content, and policy violations fail closed and are classified.
- Raw capture objects are encrypted, access-controlled, content-addressed, and
  lineage-bound. They contain permitted source metadata only and never contain
  credentials, cookies, signed URLs, private locators, or unauthorized source
  payloads.

### Isolation and least privilege

- Production and staging Workers, Hyperdrive bindings, databases, roles,
  queues, workflows, buckets, keys, and secrets are distinct and visibly named.
- The public role reads only published canonical/search views. It cannot write
  canonical history, review decisions, correctness ledgers, captures, or
  publication pointers.
- Harvesters cannot publish; projectors cannot make source-network requests;
  schedulers cannot read captures; normalization consumes only ledgered
  captures; operations mutations require authenticated, audited authorization.
- Secrets live only in the platform secret store, are scoped per component and
  environment, are rotated, and never appear in descriptors, source code,
  queue/workflow payloads, logs, traces, R2 metadata, responses, or receipts.
- Queue and Workflow deliveries are treated as at-least-once. Idempotency,
  attempt budgets, leases, outbox/inbox records, replay lineage, DLQ controls,
  and circuit-breaker state must prevent duplicate logical effects and
  unauthorized replay.

### Publication and evidence integrity

- Canonical evidence, assertions, relationships, access observations, identity
  reviews, and publication history are append-only or explicitly superseded.
- Candidate generations are built from one sealed canonical revision and
  projector fingerprint, checksum-verified, evaluated, and atomically promoted.
  A failed or partial run cannot replace the last-known-good generation.
- Generation pins, cursors, rollback bundles, manifests, and evidence references
  reject tampering, cross-environment use, expiry, or unavailable revisions
  rather than silently moving to current state.
- Uncertain identity, duplicate, family, and join matches remain separate and
  reviewable. No public or pipeline request silently mutates identity equality.

### Privacy, redaction, and untrusted content

- Raw public research questions and user identifiers are not persisted or
  logged by default. Operational telemetry is allowlisted to request/trace IDs,
  result state, timing, generation, bounded counts, and error class. Error and
  distributed-trace paths obey the same rule.
- Public output, logs, traces, errors, R2 object metadata, receipts, and coverage
  artifacts redact authorization headers, credentials, cookies, private
  locators, signed or presigned URLs, and secret-bearing query parameters.
- Clarification tokens contain no raw question or user identifier, are
  integrity-protected, expire, and use a separately scoped signing secret.
- Source-derived metadata is inert data. It cannot alter maintained planner
  instructions, WebMCP tool names or descriptions, JSON Schemas, routing,
  access decisions, truth-boundary fields, or executable configuration. Prompt
  and tool-poisoning content must remain visibly attributed and bounded.
- Every public input and output is schema-closed and size-, string-, array-,
  page-, cursor-, concurrency-, and rate-bounded. Throttling and abuse controls
  never become evidence of authoritative-source absence.

## Reportable findings and severity context

A finding is reportable when it plausibly crosses one of these boundaries or
breaks an invariant in reachable repository or deployed code. High-impact
examples include acquisition or disclosure of healthcare rows or credentials;
SSRF to internal, metadata-service, or unapproved origins; authorization or
role bypass; raw-query leakage; publication-pointer or evidence tampering;
secret exposure; source content changing tool/planner behavior; silent identity
mutation; or public execution of retrieval, analysis, access, or payment flows.

Severity should reflect realistic reachability, exposed data or authority,
cross-environment or cross-role impact, persistence, and rollback difficulty.
The presence of a future-looking contract or infrastructure file alone does not
prove a deployed exposure, but an unsafe default that would become reachable on
the documented deployment path remains reportable.

## Out of scope and exclusions

- Vulnerabilities in an authoritative source's own systems are outside this
  repository's scope unless USHSO makes them reachable, amplifies them, or
  mishandles their data.
- Publicly documented source access restrictions and expected denials are not
  USHSO vulnerabilities. Bypassing or misclassifying them is in scope.
- Synthetic fixtures are not sensitive merely because they exercise row,
  credential, SSRF, poisoning, or redaction sentinels. A fixture containing real
  sensitive data is in scope and must be removed safely.
- Availability limits intentionally imposed by bounded requests, freshness
  policy, rate controls, or a paused source are not findings by themselves.
  Fail-open behavior, false coverage claims, or lost correctness state is in
  scope.

No class of otherwise valid security finding is accepted or suppressed by this
section. Report ambiguous cases privately so reachability and impact can be
resolved with the owner.

## Known limitations and external authorization

Provisioning or changing managed PostgreSQL, Hyperdrive, R2, Queues, Workflows,
Cloudflare Access, production secrets, DNS, remote Terraform state, or paid
service plans requires explicit owner authorization. Production deployment,
remote pushes, live source harvesting, custom-domain changes, and irreversible
external actions likewise require separate authorization.

Before target promotion, receipts must verify SSRF and payload-sentinel
fixtures, role/binding isolation, secret and redaction scans, queue/workflow
replay behavior, publication integrity, query-minimization audits, prompt/tool
poisoning defenses, backup/PITR restore, generation rollback, and zero
authoritative egress from every public API and WebMCP tool. Until those receipts
exist, the corresponding target controls are unverified rather than accepted
risk.
