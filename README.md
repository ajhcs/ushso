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

## Access and safety

- Public catalog visibility is never represented as data access.
- Application, DUA, license, payment, and human-approval requirements remain visible.
- Failed, blocked, unavailable, and unresolved outcomes are typed; they are never rewritten as `not_found`.
- Candidate or incompatible joins remain visibly non-exact.
- A zero-result query is not evidence that no source exists.

## License status

No open-source license has been granted yet. The repository is public for review and release qualification; all rights remain reserved until the owner selects a license.
