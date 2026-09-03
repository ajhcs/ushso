# Cloudflare release and rollback record for USHSO.org

The checked-in configuration routes `ushso.org/*` and `www.ushso.org/*` to the
`ushso` Cloudflare Worker. Credentials are never committed. The proxied DNS records
and former origin remain intact, so the Worker routes can be removed without
rebuilding the previous service.

## Already prepared

- Vite single-page application served through Workers Static Assets.
- Worker-first routing only for `/api/*`; ordinary static assets remain on the optimized asset path.
- Same-origin `POST /api/discover` using the same deterministic result contract as the browser and WebMCP surface.
- `GET /api/health` and `GET /api/contract` readiness endpoints.
- Bounded JSON request size, typed client errors, no LLM or external-source fetch from the request path.
- Wrangler dry-run command and CI gate.

## Production gate

Before activation on 2026-08-30:

- Retrieval corpus validation, all package tests, the 60-question evaluation run,
  production build, dependency audit, and repository release audit passed.
- Desktop and mobile browser QA passed against the accepted generated response.
- `wrangler whoami` confirmed the intended account and access to the `ushso.org` zone.
- The Worker preview passed root, deep-link fallback, health, contract, representative
  discovery, zero-result, media-type, malformed-body, and request-size checks.
- No application analytics or Worker observability are enabled. The application has
  no accounts and deliberately persists no search questions.
- Public privacy, terms, contact, security, and all-rights-reserved license notices are present.
- The owner explicitly authorized production activation and replacement of the existing
  `ushso.org` service.

## Rollback

1. Remove the `ushso.org/*` and `www.ushso.org/*` Worker routes from `wrangler.jsonc`
   and deploy the prior known-good Worker configuration, or remove those routes in
   the Cloudflare dashboard.
2. Confirm the pre-existing origin/DNS path is active again.
3. Repeat HTTP and application smoke tests against `https://ushso.org`.

Do not delete or mutate the retained apex tunnel, `www` CNAME, or former origin as
part of a Worker rollback. Cloudflare credentials and preview tokens must remain
outside the repository.

## v1.2 successor promotion gate

The 3,434-record live-catalog successor is not promoted merely because it
builds. Promotion must proceed in this order:

1. Re-run `npm run test:catalog` and `npm run verify:catalog-runtime`; require
   exact source counts, hashes, zero payload downloads, zero identity merges,
   bounded shards, and the Worker memory/latency limits.
2. Run the complete repository, web, Worker, connector, immutable-contract,
   WP12 activation, production-build, release-audit, and Wrangler dry-run gates
   against one exact commit.
3. Upload that commit to an isolated preview hostname with no production routes.
   Verify health, contract, catalog totals, representative searches, all eight
   JSON inspection routes, error behavior, and static asset hashes.
4. In a secure WebMCP-capable browser, prove native discovery of exactly eight
   tools, prove at least one successful invocation per tool, and prove
   `observatory.plan_research` is absent. Prefer `document.modelContext`; the
   transitional `navigator.modelContext` surface remains supported for earlier
   Chromium implementations.
5. Only after those receipts agree may an explicitly authorized canary receive
   production traffic. Any count, hash, safety, memory, route, schema, or native
   invocation mismatch stops promotion and keeps the previous Worker version
   available for rollback.

The isolated successor uses `wrangler.staging.jsonc` and Worker name
`ushso-catalog-recovery-v12`. That configuration has no custom routes, so it
cannot attach the candidate to `ushso.org` or `www.ushso.org`. Production still
uses `wrangler.jsonc`; never substitute the staging upload for an authorized
production canary and release.
