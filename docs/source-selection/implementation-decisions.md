# Implementation decisions and retained gaps

The original 80-item plan remains the scope baseline. This execution uses a
separate branch from the public source baseline; the recovery checkout and its
pending work remain preserved. `execution-coverage.json` links each obligation
to candidate artifacts and states what they do not yet establish.

1. **Source acceptance stays explicit (CH-002, 007, 011–018, 040).** The source
   inventory and review packet contain proposals, not approved assertions. The
   public accepted-publication endpoint stays unavailable until a reviewed
   ledger and independently configured current rights pin exist. Luis Barrigan,
   Syed Siddiqi and Cole Lyons are designated reviewers; designation supplies
   neither weekly capacity nor a source decision. Tests use labeled synthetic
   accepted publications to exercise the complete software path.
2. **Search text is not verified subject support (CH-023–030).** Publisher text
   may affect relevance while remaining contextual. Agency names and URL slugs
   must not stand in for the requested subject. Producer-visible examples exposed
   the separate machine-API ranker; both serving paths require actual behavioral
   checks. Independent task judgments remain a separate acceptance gate.
3. **Missing descriptions remain missing (CH-022).** A successor reader permits
   four otherwise identified, evidence-bound inventory records with an explicit
   missing-description state. It does not fill in prose or rewrite the frozen
   corpus and historical schema. Derived runtime projections need the same
   eligibility rule and their own current hashes.
4. **Historical proof remains historical (CH-032–035, 054, 062).** Old evaluation
   reports and release receipts are retained. Current package/lock/CI checks use
   an explicitly pending transition with no transferred approval. The new
   evaluator runs the full frozen catalog and retains failed attempts, exact
   module identities and unresolved full-contract timing differences.
5. **Optional models remain disabled (WP-12).** See `ai-decision.md`. No model
   request is justified by the presence of a preflight cost helper. Enabling a
   provider requires reviewed inputs, actual capacity, durable spend controls
   and measured benefit against deterministic extraction.
6. **Restore claims require restored bytes (CH-061).** The initial synthetic
   accepted-ledger restore test is a component check. The actual application
   needs a streamed inventory, an externally retained digest, preserved local
   configuration and a separately launched Worker serving restored assets.
   Neither rehearsal authorizes production activation or proves that an old
   publication still has valid rights.
7. **Commercial rehearsal is not demand (CH-065–070, 078).** The local service
   workflow deliberately uses synthetic identities, assumptions and events.
   It exercises scope changes, review, access failure, cancellation and private
   export. Real customer terms, fees, capacity, deliveries and demand remain
   unobserved. The 90-day review clock has not started.
8. **Client access remains an operational defect (CH-050).** The November 14
   public GET observation retained default urllib 403 responses and curl 200
   responses. Local client tests do not resolve that production difference.
   Investigating or changing the production edge requires the actual serving
   configuration and explicitly scoped production work.

Re-run affected contract, retrieval, browser and restore checks after source
changes. A passing check establishes its stated boundary; it does not erase a
failed attempt or settle the human and operating gates in `acceptance.json`.
