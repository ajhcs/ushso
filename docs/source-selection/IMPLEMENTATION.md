# Source-selection implementation status

This is an implemented software candidate on `codex/ushso-source-selection`,
based on public source `66c04a79fb89d8ba79da407a8b2b883783f28077`. The separate
recovery checkout is preserved. Production has not been changed. The complete
80-item program is **not complete**: source decisions, intended-use evidence and
operating/business outcomes remain separate from this software qualification.

## Implemented

- An immutable local evidence/review ledger with scoped decisions, capture
  readback, concurrent-writer protection, crash recovery and versioned projection.
  Public metadata requires explicit reuse permission and an accepted identity
  matching the asset ID, publisher and title. Capture-only and revoked records
  are omitted from the public projection.
- Shared website and machine-API ranking, contextual treatment of text-only
  matches, subject/geography/year overrides, evidence-scoped coverage filters
  before pagination, cursor reset behavior and request-time freshness. Four
  evidence-bound records retain explicit missing descriptions instead of being
  silently excluded or filled with invented text.
- Hospital-source starting points, visible example questions, readable cards,
  source details, an archived readiness view, meaningful initial source HTML,
  canonical metadata and a current sitemap.
- A memory-first shortlist, optional 30-day device storage, separate question
  consent, pinned comparison, JSON/print briefs with publisher citations, and
  unverified import handling. The accepted-source path is exercised with labeled
  synthetic sources; no actual source approval was invented to enable it.
- Copy-only feedback, accurate privacy disclosures, a private security-contact
  route, an explicit rule against paid ranking/inclusion and a distinction
  between code licensing and source-content rights.
- Actual-engine evaluation, API examples, real-browser CI checks, transient
  initialization recovery, refresh reporting, streamed release retention and
  local restore tooling. Historical release receipts remain historical.
- A synthetic manual-service workflow covering scope, quote assumptions, review,
  access failure, cancellation and private/preview exports. It makes no customer,
  payment, staffing or demand claim.

## Qualification

The local environment used Node 24.22.0 and npm 11.19.1 with the committed lockfile.
The final receipts are indexed with hashes in `qualification.json`. Earlier
failed attempts remain outside the source tree alongside the final receipts.

- The complete `npm test` chain passed, including 121 retrieval tests, 205 web
  tests and the existing verification runner's 33 package suites.
- `npm run cf:dry-run`, which includes the production build, passed.
- Twelve real Chromium tests passed on desktop and narrow layouts, including
  320px reflow with 200% root text sizing. This is not a screen-reader or actual
  browser-zoom acceptance claim.
- Nine frozen-catalog queries passed direct-engine/HTTP ranking and
  classification parity with zero external requests. Full-contract timestamp
  differences are retained; there are no independent accuracy labels or scores.
- Actual Worker checks exercise website/machine/controlled-search parity,
  pagination, freshness, unavailable-source boundaries and no-JavaScript pages.
  The restore receipt identifies the retained build and the exact checks run.

These checks ran on the candidate file bytes before the local commit was made.
They do not establish hosted CI completion, source truth, production acceptance
or operational availability.

## Remaining acceptance work

1. Luis Barrigan, Syed Siddiqi and Cole Lyons are designated source reviewers.
   Weekly capacity and individual evidence/rights decisions remain unknown.
   Start with `docs/source-selection-sources/human-review-packet.md`; eight
   candidates and twelve proposals are preparation, not accepted source facts.
2. No actual accepted source publication is configured. Identity, source claims,
   public reuse rights and acquisition conditions need substantive review. The
   production accepted-source path must remain unavailable until its gates pass.
3. Independently judged retrieval tasks and consented researcher observations
   have not run. Producer regression examples do not establish source fitness or
   successful research tasks. Measure, provider-class and geographic mismatches
   can still occur among explicitly contextual results.
4. Default Python urllib still received 403 responses where curl received 200
   from the live site on November 14. The production edge cause and exact
   deployed build identity remain unresolved; local client success is not a fix.
5. Local restoration covers the candidate with an unavailable accepted-source
   publication. Restoring a real accepted publication under current rights,
   production rollback and operational monitoring remain separate work.
6. Actual funding/conflict declarations, correction/support capacity, customer
   terms, paid pilots, distribution activity and the 90-day business review
   remain unobserved. No outreach or charges occurred.
7. Muse Ember and other optional model providers remain disabled. The preflight
   cost helper does not authorize a request or reserve spend. See `ai-decision.md`.

The detailed obligation-by-obligation record is `execution-coverage.json`.
`candidate` means code or preparation exists for part of an obligation; it is
not a completion count. `acceptance.json` retains the actual open gates.
