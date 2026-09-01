# WP13 local candidate verification

This versioned package verifies the additive USHSO web-discoverability
candidate against implementation-plan section 15.5, WP13, sections 22.6, 23.5,
23.6, and tester requirement TST-SEO-01.

Evidence is `fixture_only_local_integration`. The suite makes no network, DNS,
database, R2, Cloudflare, deployment, or credential call. It proves the local
projection/adapter invariants but does not claim that the full production
canonical corpus has a promoted SEO generation or that public traffic can reach
the candidate.

Current public state:

- `worker/index.mjs` imports no WP13 candidate;
- public enabled WP13 routes: **0**;
- internal canary authorization AUTH-06: `not_requested`, `authorized:false`;
- public deployment/cutover authorization AUTH-07: `not_requested`,
  `authorized:false`;
- WP13 work-package and DOD-15 acceptance remain withheld pending complete
  canonical-corpus projection, prerequisite search/publication/release gates,
  entry-point review, protected canary, public authorization, crawler smoke,
  production-like load, rollback rehearsal, and soak.

Run:

```sh
npm test --prefix packages/web-discoverability
npm test --prefix verification/wp13/v1.0.0
npm run validate --prefix verification/wp13/v1.0.0
```

The receipt seal covers every file in `packages/web-discoverability`, the one
unwired Worker candidate adapter, and this package except the receipt itself.
The pre-hardening seal
`sha256:c823baab000811e3b7ba39d3f110b9be25203fb017d30266ca9a84ddb0d1dcd9`
is retained only as a superseded baseline. Final resealing is intentionally
pending root confirmation that the wider tree is frozen; the validator reports
the current provisional seal without persisting or claiming it as final.

The local gate additionally proves digest recomputation and semantic rebuild for
active, retained, and static rollback reads; frozen quarantine and rehashed
unsafe-locator rejection; deployment-owned origin composition; standards-correct
Accept negotiation and redirect variance; exact public-locator/redaction
provenance; repeated-decoding secret-path rejection; and DCAT 3 output against a
hand-authored offline fixture pinned to the immutable W3C Recommendation URL.
