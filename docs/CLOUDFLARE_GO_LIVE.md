# Cloudflare go-live checklist for USHSO.org

The checked-in configuration is a deployment candidate, not production authorization. It has no custom-domain route and no account credentials.

## Already prepared

- Vite single-page application served through Workers Static Assets.
- Worker-first routing only for `/api/*`; ordinary static assets remain on the optimized asset path.
- Same-origin `POST /api/discover` using the same deterministic result contract as the browser and WebMCP surface.
- `GET /api/health` and `GET /api/contract` readiness endpoints.
- Bounded JSON request size, typed client errors, no LLM or external-source fetch from the request path.
- Wrangler dry-run command and CI gate.

## Required before production activation

1. Retrieval corpus validation receipt is `PASS`, and the 60-question evaluation report is reviewed.
2. Frontend contract, accessibility, desktop, and mobile tests pass against the generated corpus response—not a handwritten source fixture.
3. `npm audit` and repository secret/large-file scans are reviewed.
4. `wrangler whoami` confirms the intended Cloudflare account and access to the `ushso.org` zone.
5. A preview deployment passes `/`, deep-link SPA fallback, `/api/health`, `/api/contract`, and representative `/api/discover` smoke tests.
6. Caching, observability retention, privacy copy, contact channel, terms, and the repository license decision are approved.
7. The owner explicitly authorizes production deployment and DNS/custom-domain attachment.

## Production change held behind the gate

After approval, attach `ushso.org` as a Worker custom domain in a production-specific Wrangler configuration or the Cloudflare dashboard, verify the generated DNS record, then repeat the smoke tests against the public hostname. Do not reuse a preview token in production and do not commit Cloudflare credentials.
