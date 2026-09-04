# ushso

Production United States Health Systems Observatory. Read README.md, docs/ARCHITECTURE.md, docs/EVALUATION.md, and the relevant release documents. Runtime work also requires /home/plumbob/.codex/memories/plumbob-server/ushso-prod.md.

- Use Node 22.15 or newer and the committed npm lockfile.
- Checks: `npm test`, `npm run build`, and `npm run cf:dry-run`. Scope checks to the changed behavior; cf:deploy is a production mutation.
- Preserve evidence-bound source metadata and non-authoritative search projections.
- Catalog membership does not prove payload access, authorization, schema, join compatibility, or fitness.
- Preserve typed failed, blocked, unavailable, and unresolved outcomes and current disabled-feature boundaries.

## Instruction maintenance

Edit .ruler/AGENTS.md and preview/sync with the Ruler Codex wrapper.
