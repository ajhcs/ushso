# PR-003 C-003-3-R4 — composite wildcard evidence

This additive record covers the bounded R4 continuation from reviewed Grok R3 base commit 0b28d036f1df4b5248732bc62f68edd79f14d06f (tree 6e2de2232e2aa0f19055751d70e5a904a38216f9). The functional correction is commit b41c27db36b58b4bda16ded02bde3211ca02fb9d. The evidence commit remains pending until the controller binds its exact final head and tree.

## Correction

ownedPathMatches now keeps wildcard-bearing prefixes active when an ownership pattern ends in /** or /. It preserves the existing literal handling for dir/** and dir/, exact-file matches, slash-free * segments, zero-or-more ** segments, regex metacharacter escaping, and outside-path rejection. The focused suite adds direct and completed-packet controls for:

- tests/*/** accepting tests/unit/one.mjs and tests/unit;
- docs/**/fixtures/** accepting both nested and zero-interior fixtures;
- tests/*/ accepting descendants while rejecting a different root.

The current checker hash is 9a691294228356d56d012c66aa0af1cb1f1db5c9142f9960670b78275027d2b5 and the focused test hash is bd43c94f07cacc946745a4725f0b184135aec010b478199f6887487b27c2c07e. Fixture artifact references were refreshed for the changed checker, test and schema README bytes; historical receipt and evidence-index bytes were not rewritten.

## Execution

The controller-requested role was native gpt-5.6-luna with reasoning max (successful dispatch used fork_turns=none). The serving backend identity is not independently inspectable through this interface. Grok R3 is retained as historical input evidence and is not credited with the R4 patch. The current task binding is 9401b0afdf36ac7e4424821644a537211ed09369a3c130555a2c2c222ca3dbe4; the current branch is codex/ushso-pr003-composite-glob-20260911.

The focused handoff suite passed 42/42 tests. The registered research-program script, schema helper, PR guidance helper and current handoff check also exited 0. The nine exact composite controls passed 9/9. The historical audit found 44/44 pre-existing command-receipt/evidence-index files byte-identical.

This packet remains producer evidence with a typed pending head_sha: null. Independent review, scientific acceptance, publication, merge and deployment remain outside this continuation. Full root npm test, build and Cloudflare gates remain separately owned.
