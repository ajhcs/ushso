# USHSO architecture

USHSO is a discovery and routing product. It indexes evidence-backed metadata
and retrieval instructions; it does not copy the underlying healthcare data.

## Four layers

1. **Source truth** preserves source-native organizations, assets, versions,
   distributions, services, documentation, captures, and access observations.
2. **Evidence and assertions** keep each claim traceable, confidence-scoped,
   supersedable, and distinct from unknown or conflicting observations.
3. **Identity and relationships** represent typed, evidence-bearing links such
   as version-of, distribution-of, mirror, successor, candidate family, and
   join routes. The MVP does not perform identity merges.
4. **Discovery views** denormalize the preceding layers for deterministic
   lexical, controlled-vocabulary, geography, unit, time, access, and join
   retrieval. These search documents are explicitly non-authoritative.

```text
source-native objects
        |
        +--> evidence + assertions
        |
        +--> identity + typed relationships
                         |
                         v
             non-authoritative search documents
                         |
                         v
         deterministic intent compiler + ranking
                         |
                         v
          observatory-discovery-result.v1.0.0
                    /                 \
              browser UI        API / WebMCP
```

`ObservableResource` is the broad conceptual center. A searchable object may be
a dataset, distribution, service, documentation resource, organization,
capture, or access workflow; it is not forced into a generic `Dataset` class.

## Runtime boundary

The Cloudflare Worker and browser use the same immutable retrieval modules and
the same staged corpus. `POST /api/discover` returns exactly the canonical
discovery-result contract used by the frontend provider. WebMCP registers a
read-only discovery tool over the same engine when the browser surface exists.

The production runtime makes no source-discovery requests and invokes no LLM.
The indexed records contain authoritative locators and retrieval recipes, but
endpoint availability must be verified at acquisition time. A zero result is
always scoped to the published corpus and never asserted as source absence.

## Current immutable inputs

- Core contract: `contracts/core/v1.0.0`
- Use-card and access-recipe contract: `contracts/use-access/v1.0.0`
- Retrieval package and 143-record corpus: `packages/retrieval` (`v1.0.1`)
- Frozen 60-question benchmark: `evaluation/benchmark/v0.1.0`
- Deterministic evaluation harness: `evaluation/harness/v1.0.0`
- Honest MVP baseline: `evaluation/baseline/v0.1.0`
