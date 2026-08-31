# USHSO web-discoverability candidate

This package implements the additive WP13 web-discoverability projection and
runtime boundary. It is a protected local candidate: no current browser or
Worker entry point imports it, it changes no bindings, and it performs no
deployment or authoritative-source request.

## One publication truth boundary

`buildSeoGenerationArtifact()` accepts one deeply frozen
`ushso-publication-read-context.v1.0.0`. The context must contain both the
`asset_search` and `seo` component generations selected by the same immutable
publication manifest, and `index_generation` must equal `asset_search`.

Every projected record carries the exact SEO generation and canonical revision;
the artifact carries the publication manifest, canonical-revision manifest,
search generation, SEO generation/checksum, coverage snapshot, and canonical
as-of time. Pointer sequence is intentionally excluded from immutable artifact
material so promotion and rollback of the same sealed manifest cannot change
its digest. `WebDiscoverabilityService.openRequest()` resolves the pointer
once and passes that exact object into the injected projection repository. A
repository result with any mismatched pin fails closed. The service never asks
for a current canonical revision after opening the request.

The projector is deliberately a projection, not a new truth store. Its strict
input contains only evidence-bound canonical facts:

- stable public ID, explicit `public` visibility, eligible lifecycle, and exact
  canonical revision;
- title, description, publisher, temporal/spatial coverage, access boundary,
  distributions, evidence summary, canonical source link, and optional license;
- exact truth references for every rendered fact;
- an exact, policy-versioned `admissible_public`/`verified_public_safe` locator
  attestation for every publisher, source, license, access, and download URL;
- optional DCAT profile only when explicit supporting evidence exists.

Unknown fields, unpinned evidence, hidden visibility, unsafe locators, signed
locators, missing distribution URLs, or unsupported DCAT claims reject the
whole build. The artifact is deterministic, deeply frozen, non-authoritative,
content-digested, and includes exact render and sitemap reconciliation receipts.
Before every active, retained, or static-rollback read can reach the service, the
service recomputes the artifact, projection-document, rendered-HTML, current
sitemap, and shard digests and then rebuilds the full artifact through the strict
projector. Verification is service-owned and is applied to every repository
result, including custom repository implementations; no marker or caller claim
can bypass it. The service serves the newly rebuilt, deeply frozen value rather
than the repository object, eliminating accessor/proxy and post-verification
mutation paths.

## Public resolution policy

- A record exists only when its in-generation SEO document is explicitly
  public. It receives record-specific no-JavaScript HTML, metadata, schema.org
  `Dataset` JSON-LD, and optional evidence-supported DCAT/DCAT-US JSON-LD.
- A legacy alias receives a 308 only when an accepted, public, permanent
  `legacy_public_alias` assertion targets a public record in the same artifact.
- A 410 is possible only for a strict `public_withdrawn` assertion with an
  `admissible_public` disclosure state and exact evidence of a prior public
  document and publication generation. The response is a generic tombstone and
  never renders the assertion, evidence IDs, or internal reason.
- Every other syntactically valid or invalid ID returns the same generic 404.
  Private, excluded, quarantined, candidate, never-public, and unknown IDs are
  not represented in the artifact and cannot be distinguished.

## Output and security bounds

All source strings are treated as untrusted. HTML text and attributes, XML, and
JSON-LD use context-specific escaping; JSON-LD escapes `<`, `>`, `&`, U+2028,
and U+2029, so `</script>` cannot terminate the data block. Canonical USHSO URLs
are built only from the exact deployment-owned HTTPS origin injected into both
repository and service composition and encoded stable ID; neither request Host
nor stored artifact bytes can select it. Public source and distribution links
must be attested under `ushso-public-locator-redaction.v1.0.0`, HTTPS,
credential-free, public DNS names, free of query/fragment material, and free of
secret-bearing path segments after repeated percent decoding. Response header
values are independently control-character checked.

Evidence-supported `dcat-3` output pins `dct:conformsTo` to the immutable 22
August 2024 W3C Recommendation URL. The offline conformance gate compares output
to the hand-authored `conformance/dcat3-dataset.v1.0.0.json` fixture and its
independently listed Dataset, Distribution, access/download URL, and temporal
expectations; it does not compare the renderer with itself.

The maintained limits are exported as `LIMITS`. They cover record, alias,
withdrawal, field, evidence, coverage, distribution, URL, HTML, sitemap URL,
sitemap byte, sitemap-index byte, whole-artifact byte, and shard cardinalities. Oversize records fail
the projection atomically. Sitemaps shard by both URL count and exact UTF-8
bytes. Every and only projected public stable URL appears exactly once.

The candidate Worker adapter negotiates dataset HTML before applying method
semantics, permits GET/HEAD for accepted HTML, and leaves JSON callers and unrelated
routes untouched. Negotiable responses, including immutable canonical and alias
redirects, carry `Vary: Accept`. It exposes no source client or mutation port, uses a fixed CSP and
privacy headers, and emits all publication/search/SEO pins. Current pages and
`/sitemap.xml` use a short pointer-aware cache policy. Generation-qualified
sitemap shards are immutable and remain resolvable through the repository's
retained-generation read, preventing a pointer flip between sitemap-index and
shard requests from mixing generations. Pointer-bound pages, robots, tombstones,
and the current sitemap are `no-store`: without a custom cache key containing
the publication IDs, caching those stable routes could serve SEO generation A
beside search generation B. Only generation-qualified shards and permanent
redirects receive immutable caching.

## Composition and rollback

The only Worker adapter is
`worker/wp13-web-discoverability-candidate.mjs`. It is intentionally not imported
by `worker/index.mjs`. Future composition must inject the same publication
resolver used by search, the deployment-owned exact canonical origin, and a
read-only repository that verifies sealed SEO artifacts. Service and repository
origins must match exactly. No caller-supplied flag activates the candidate.

For an authorized future rollback, atomically restore the N-1 publication
pointer so search and SEO move together. `createStaticRollbackWebDiscoverabilityService()`
supports an explicit emergency composition over a sealed retained artifact and
its exact publication context; it performs no pointer, database, source-network,
or mutation action. The current candidate requires no runtime rollback because
it is unwired. Removing its future additive import restores the previous Worker;
there is no data migration to reverse.

Run locally:

```sh
npm test --prefix packages/web-discoverability
npm run verify --prefix packages/web-discoverability
```
