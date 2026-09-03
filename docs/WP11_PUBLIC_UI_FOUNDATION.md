# WP11 Public UI Foundation

WP11 adds an evidence-bound researcher presentation and a distinct research-plan surface to the existing Observatory design system. It does not redesign the site, implement the planner compiler, activate a plan API, or broaden USHSO into an analytics application.

## Delivered browser surfaces

- Result cards preserve the six required scanning regions in order: title, one-sentence description, why it matched, geography/grain/time, access/evidence, and the details action. The verification label names the scoped target instead of saying only “verified.”
- Dataset details now begin with an evidence-backed Use Card, Access Plan, and technical Retrieval Recipe. Unknown fit, lag, suppression, identifier stability, measure semantics, exact release/distribution/access-route pins, and machine-readiness facts remain visibly unresolved rather than inferred.
- `/sources` renders the small WP9 public-service projection with its exact coverage snapshot, as-of time, 14/51/306/157 unit boundaries, 11/2/1 federal applicability, zero-result boundary, and non-additivity language. The older jurisdiction aggregate is explicitly non-canonical and cannot promote source-class cells.
- `/plan` is a distinct route and renderer for a supplied `observatory-research-plan.v1.0.0` artifact. It renders the eight required sections in fixed order and provides a 256 KiB-bounded copy/download JSON control.

The renderer displays every canonical status: `unsupported`, `clarification_required`, `incomplete`, `ready_with_constraints`, and `ready`. Operation kind, evidence state, compatibility, requirements, and blockers use separate fields. Candidate or ambiguous evidence is never promoted. Every acquisition step and truth-boundary flag remains non-executed.

## Plan dependency boundary

The browser adapter reserves these contract seams:

- `POST /api/plan`
- `GET /api/contracts/research-plan/v1.0.0`

Both are disabled. `AUTH-12` is `not_requested` and `authorized: false`, so WP10B compiler implementation and runtime activation remain prohibited. The default `/plan` route therefore collects no question and renders no synthetic plan. Frozen canonical contract fixtures are used only in tests to prove every renderer state.

An authorized later work package must implement WP10B, validate responses against the frozen contract, add the server endpoints, inject a compiled-plan surface state, and rerun the WP11 package. It must not overload discovery with a plan mode. Browse and search modules contain no planner adapter, endpoint, or generation call.

## Coverage publication boundary

The UI projection is mechanically checked against `packages/coverage/accounting/v1.0.0/artifacts/public-coverage-view.json`. `AUTH-15` remains `not_requested` and `authorized: false`; the interface visibly calls the wording a preview and says product-owner approval is pending. This implementation must not be deployed as approved public coverage wording until the exact digest-bound WP9 review receipt exists.

## Product and privacy boundary

USHSO recommends sources, explains evidence and access, and presents an already-compiled handoff. It does not:

- submit registrations, applications, DUAs, payments, or logins;
- request source data, retrieve or store payloads, inspect rows, or execute operations;
- join data, calculate a measure, market share, benchmark, ranking, trend, or forecast;
- persist a raw research question; or
- claim access authorization, analytical fitness, identity resolution, completeness, or source absence without the required evidence.

The JSON export serializes only the validated canonical plan object; it adds no request envelope, raw question, or transport metadata.

## External navigation boundary

Authoritative links, retrieval routes, codebooks, and live-verification evidence are untrusted contract data. Browser navigation is limited to canonical public-DNS HTTPS URLs no longer than 2,048 characters. The shared boundary rejects URL credentials, decoded signing or credential query keys, IP literals, local/internal DNS suffixes, controls, backslashes, and ambiguous single-slash scheme spellings. Rendered anchors use the canonical URL returned by that boundary, never the unchecked input. Bounded URNs may remain visible as non-navigable evidence locators.

The adversarial suite covers signed and percent-encoded query keys, userinfo, ASCII controls, loopback alternate spellings, Unicode-dot loopback, IPv4 and IPv6 literals, local suffixes, length limits, and validator/browser resolution equivalence. The same boundary is exercised at response validation, overlay ingestion, guidance construction, and rendered evidence/codebook sinks.

## Verification and external studies

Local gates:

```text
npm test --prefix apps/web
npm run typecheck --prefix apps/web
npm run build --prefix apps/web
npm test --prefix verification/wp11/v1.0.0
npm run validate --prefix verification/wp11/v1.0.0
npm run verify --prefix verification/wp11/v1.0.0
```

The component and route suite verifies coverage parity, all five plan statuses, eight-section order, operation-field orthogonality, bounded JSON round trips, disabled adapter no-egress, browse/search separation, six ResultCard regions, semantic landmarks, and tablet/phone collapse rules. Browser Plugin tooling is not available in this environment; no live browser session or device emulation was claimed.

Two human gates remain pending and block beta claims. They are tracked in the
central register as `AUTH-16` (researcher usability) and `AUTH-17` (expert
asset review):

1. Five representative researchers must select the intended ResultCard within 30 seconds at least 80% of the time and must not interpret the card as an analytics result.
2. Two reviewers must assess a stratified 12-asset decision-summary sample with 100% critical-field accuracy and zero unsupported access, coverage, compatibility, or analysis claims.

The packets in `verification/wp11/v1.0.0/governance/` describe how to record those studies without putting raw user questions into repository evidence.

## Rollback

No production deployment, API route, database migration, source action, or planner runtime activation occurred. A code rollback removes the `/plan` route and WP11 presentation imports, then restores the prior ResultCard/details/source markup and stylesheet sections. Coverage and plan contract artifacts are immutable inputs and are not deleted. If a future activation fails, disable the plan feature gate first; retain canonical plan and verification receipts for audit.
