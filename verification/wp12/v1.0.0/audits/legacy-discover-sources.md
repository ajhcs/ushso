# Legacy `observatory.discover_sources` compatibility audit

Decision: **keep the deployed v1 implementation unchanged, but do not register
the v1.0.0 machine-toolkit alias.** The frozen strategy remains
`versioned_gated_alias`, `default_registered: false`, and
`disabled_pending_legacy_audit`.

Evidence reviewed:

- `packages/retrieval/tools/webmcp.mjs`
- `packages/retrieval/tools/query-schema.mjs`
- `apps/web/src/providers/registerWebMcp.ts`
- `apps/web/src/providers/discoveryProvider.ts`
- frozen machine-toolkit manifest and compatibility fixtures

The deployed helper has maintained read-only/untrusted annotations, propagates a
caller abort to its retrieval engine, and its default API provider uses a
relative same-origin endpoint. It does not itself harvest authoritative sources.
However, its input schema permits `limit: 50` while the successor maximum is 20,
several nested arrays have no `maxItems`, it has no decoded 20 KiB enforcement,
and its legacy response is not the bounded machine-toolkit envelope with the
complete zero-action truth boundary, redaction scan, generation pin, or
per-capability output ceiling. It therefore does not meet the successor release
gate as-is.

The candidate translator implements only the unambiguous compatibility subset:

- `question` → `mode: search` plus `research_need`
- omitted limit → 10
- limits 1–20 preserved exactly
- limits above 20 → `invalid_input` (never clipped)
- legacy geography/subject/unit/access/time filters → `invalid_input` pending a
  reviewed semantic mapping, never silently ignored

The legacy registration file was not overwritten or disabled in this phase, so
existing v1 behavior is preserved. A later public transition must separately
choose a deprecation window, prove response redaction and bounds end to end, and
promote one visually distinct search registration only after all applicable
gates pass.
