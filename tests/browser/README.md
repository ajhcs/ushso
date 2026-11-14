# Browser qualification

`npm run test:e2e:browser` builds the production SPA, starts the local Worker on
127.0.0.1:8787, waits up to 180 seconds for HTTP readiness, and shuts it down after
success or failure. An existing server causes failure instead of masking an old
build. Browser requests outside loopback are blocked; no publisher access is
claimed. Desktop (1440 × 1000) and narrow (390 × 844) Chromium flows use the real
Worker and staged release assets, without API mocks.

The default accepted source-selection publication has no reviewed fact ledger.
The browser suite therefore checks the unavailable boundary and absence of add
controls or device persistence. `synthetic-selection.spec.ts` separately routes the accepted-publication and
comparison endpoints using the shared ledger projection and comparison builders.
It exercises shortlist, comparison, consent, export/import and generation mismatch
without staging fixture facts as production claims. The default real Worker
unavailable checks remain separate. Real controlled-discovery checks replace and
remove inferred constraints, preserve the question, verify coverage exclusion
counts, and restart pagination. The 320px reflow/text resize check applies a 200%
root font size; it does not establish browser zoom or screen-reader acceptance. Feedback draft checks use the real app.

Install the committed dependency with `npm ci`; provision the matching browser in
CI with `npx playwright install --with-deps chromium`. On Builder Bob use existing
reviewed browser dependencies when needed, scoped to the test process:

```
LD_LIBRARY_PATH=/workspace/cache/builderbob/global-tools/browser-deps/sysroot/usr/lib/x86_64-linux-gnu
```

Set `USHSO_BROWSER_SKIP_BUILD=1` only when qualifying an already built artifact (as in CI).

Set `USHSO_RESEARCH_ASSET_SOURCE` to the retained archive matching the committed
research asset lock; the preparation script verifies the archive. Temporary files use `TMPDIR`, then hosted CI `RUNNER_TEMP`, then the local
`/workspace/build/builderbob/ushso-implementation/tmp` directory. Artifacts use
`USHSO_BROWSER_RESULTS` or `ushso-browser-results` within that selected temporary
directory. Local runs must keep these paths on the verified workspace. No host package installation is part of this command.
