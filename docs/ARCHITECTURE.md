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
discovery-result contract used by the frontend provider. The successor
machine-toolkit and legacy WebMCP providers remain unwired while their release
and compatibility gates are pending.

The production runtime makes no source-discovery requests and invokes no LLM.
The indexed records contain authoritative locators and retrieval recipes, but
endpoint availability must be verified at acquisition time. A zero result is
always scoped to the published corpus and never asserted as source absence.

## Current immutable inputs

- Core contract: `contracts/core/v1.0.0`
- Use-card and access-recipe contract: `contracts/use-access/v1.0.0`
- Production and migration-seed corpus: `packages/retrieval/versions/v1.1.0`
  (157 records and 14 join routes)
- Historical evaluator corpus: `packages/retrieval` (`v1.0.1`, 143 records and
  14 join routes)
- Frozen 60-question benchmark: `evaluation/benchmark/v0.1.0`
- Deterministic evaluation harness: `evaluation/harness/v1.0.0`
- Honest MVP baseline: `evaluation/baseline/v0.1.0`
- Byte-verified WP0 production/evaluation identity receipt:
  `verification/wp0/v1.0.0/receipts/production-baseline.json`

## Baseline naming invariant

The production runtime and the PostgreSQL migration seed are corpus **v1.1.0**:
157 records, 157 search documents, and 14 join routes. Its corpus-manifest file
SHA-256 is
`23f704ce3e421a6eb26c2b3677d616a1ae6b4f45226233257b9a1ff676caba2b`;
its content and algorithm fingerprints are respectively
`adcfb56babc981a4c7dfc787af86d56f5fb2a31e84de02f9db8c93f0548b5d03`
and
`b17c49fcd3f5fd1a09c38902f8733437e366b75f1e764a92cadf3f9788116ae6`.

Published retrieval baseline scores belong to the separate historical evaluator
corpus **v1.0.1**: 143 records, 143 search documents, and 14 join routes. Its
corpus-manifest file SHA-256 is
`5622272ded52b0cbf039da47114142f8cb35ba634e8a6bbb9ee55b0ecd70511c`;
its content and algorithm fingerprints are respectively
`0e676ada3d601275083615a3f7804781eef1c183cb1b7efcf7ec8044fce33b3d`
and
`0316cf544da21a5b6790d91c126fa1d348c080b77fcbf5225d81cbe09bebefa2`.
These values name different immutable lanes. Documentation and receipts must not
use an unqualified “current corpus” label, and scores are directly comparable
only when the corpus, evaluator, algorithm, and cohort pins agree.

The v1.1.0 production arithmetic is six slices: canonical base 4,
Pennsylvania catalog 22, Harvard Dataverse 52, DataCite 50, curated
authoritative registry 15, and live-metadata-validated federal successor 14.
Those values total 157. Tester feedback listed the latter five slices (153) but
omitted the canonical-base 4 from its arithmetic; the corpus metadata and WP0
receipt preserve the authoritative six-slice total.
