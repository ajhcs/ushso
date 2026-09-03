# United States Health Systems Observatory

USHSO is an evidence-bound discovery and routing layer for United States health-systems data. It helps a person or software agent determine what authoritative data assets exist, what they contain, what they may be useful for, what access rules apply, how assets may or may not join, and how to reach the source.

USHSO is not a warehouse of copied healthcare datasets. The MVP is built from previously captured evidence and runs without live discovery traffic, autonomous acquisition, identity merging, or LLM-generated source claims.

## Architecture

```text
source objects + evidence + assertions + relationships
                         |
                         v
          non-authoritative search documents
                         |
                         v
        deterministic intent + retrieval + joins
                         |
                         v
       one discovery-result contract for UI and agents
```

The current `observatory-record.v1.0.0` records are compatibility inputs and discovery views. They are not the final source-truth abstraction. Search documents are explicitly labeled as denormalized, non-authoritative projections.

See [the four-layer architecture](docs/ARCHITECTURE.md) and the
[published 60-question baseline](docs/EVALUATION.md).

## Local verification

Requires Node.js 22.15 or newer.

```bash
npm ci
npm test
npm run build
npm run cf:dry-run
```

The checked-in Cloudflare configuration serves the application at `ushso.org` and
`www.ushso.org` through zone-level Worker routes. Only `npm run cf:deploy` mutates
the deployed Worker; the verification commands above do not. See the
[Cloudflare release and rollback record](docs/CLOUDFLARE_GO_LIVE.md).

## WebMCP Challenge

**Before August 25, 2026:** no code in this repository or public USHSO application
existed; the repository's public history begins on August 30. The Observatory
idea and its evidence-bound research requirements predated the implementation.

**Added during the challenge:** the human research-navigator interface, published
metadata corpus, deterministic same-origin API, and the proven
`observatory.discover_sources` WebMCP tool. A broader successor toolkit remains
disabled until its explicit planner and human gates are closed.

- Live URL: [https://ushso.org](https://ushso.org)
- Available tool: `observatory.discover_sources` finds relevant published source
  metadata and access-route context.

Copy/paste judge prompt:

> Use `observatory.discover_sources` to find public sources for studying hospital
> financials in Pennsylvania. Explain what the returned metadata says about
> access, evidence, and limitations. Do not retrieve data or follow external
> links.

The browser registers the tool once on an abortable lifecycle. Execution uses
the existing API-backed discovery provider at the relative `/api/discover`
route on the page's origin. The tool is read-only, validates and bounds inputs
and outputs, propagates cancellation, and returns deterministic published
metadata. It makes no authoritative-source requests, acquires no data, performs
no analysis, and does not authorize access or submit a human workflow.
`observatory.plan_research` and the successor toolkit remain disabled.

## Access and safety

- Public catalog visibility is never represented as data access.
- Application, DUA, license, payment, and human-approval requirements remain visible.
- Failed, blocked, unavailable, and unresolved outcomes are typed; they are never rewritten as `not_found`.
- Candidate or incompatible joins remain visibly non-exact.
- A zero-result query is not evidence that no source exists.

## License

Copyright 2026 United States Health Systems Observatory. Licensed under the
[Apache License 2.0](LICENSE).
