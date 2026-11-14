# Manual feasibility-service rehearsal

This is a usable local workflow rehearsal for WP-16/M16A–B and the separate commercial lane in WP-18. It covers intake, scoped quote assumptions, source investigation, review, delivery/export, blocked access, scope revision and cancellation. WP-17 outreach remains a separate authorization: this tool sends nothing, contacts no publisher or customer, and charges nothing.

**Synthetic mode only.** It refuses actual engagements and refuses to fill unknown actual funding, capacity, pricing or revenue. The template contains synthetic private details. A second synthetic actor exercises the review step; no named human has completed that review. Luis Barrigan, Syed Siddiqi and Cole Lyons remain user-designated source reviewers with capacity and actual decisions unconfirmed.

## Run the complete rehearsal

From the implementation repository, choose a new output directory whose parent already exists on the verified `/workspace` data device:

```bash
node --test tests/source-selection-service/*.test.mjs
node scripts/source-selection-service/cli.mjs dry-run /workspace/build/builderbob/ushso-implementation/receipts/service-example-001
```

The command refuses an existing destination. It creates:

- `gap-brief/private/engagement.json`: full synthetic scope, assumptions and ordered event history.
- `gap-brief/private/evidence-check.json`: checked candidate-guide digests and their evidence limits.
- `gap-brief/preview/brief.json`: an allowlisted unresolved-source brief, excluding private question, customer reference, notes, quote, time and reviewer details.
- `gap-brief/receipt.json`: hashes of those exact outputs and explicit non-approval states.
- `blocked.private.json`: a source-access failure retained as `blocked_by_source_access`.
- `cancelled.private.json`: cancellation and closure with the failed attempt retained; no real obligation or charge is asserted.
- `dry-run.json`: synthetic outcomes, zero real outreach/charges, and unobserved customer acceptance and demand.

Directories are created with mode 0700 and files with mode 0600. Private and preview outputs are separate. The preview is still a **local draft**, not an authorized public release. Export uses exclusive creation; a failed export may leave a partial directory for inspection. It does not overwrite or silently retry an earlier artifact.

## Work through an engagement manually

Copy `engagement.template.json` into a private `/workspace` working directory with restrictive permissions. Keep `mode:"synthetic"` and actual facts null. Edit the synthetic decision, period, unit, access constraints, exclusions and deliverable, preserving all four domain obligations. The input is an engagement record, not an evidence acceptance ledger.

```bash
node scripts/source-selection-service/cli.mjs validate /workspace/build/builderbob/my-service/revision-01.json
node scripts/source-selection-service/cli.mjs advance /workspace/build/builderbob/my-service/revision-01.json /workspace/build/builderbob/my-service/event.json /workspace/build/builderbob/my-service/revision-02.json
node scripts/source-selection-service/cli.mjs export /workspace/build/builderbob/my-service/deliverable-record.json /workspace/build/builderbob/my-service/new-export
```

An event needs a UTC `at`, `type` and meaningful `reason`. `advance` appends one event to a new record and validates the entire history before writing. It never mutates the prior file. `validate` prints a minimal state summary, not private questions or notes. Keep all private working files out of Git and out of any web build directory.

| Event | Preconditions and additional fields |
|---|---|
| `triage` | From inquiry; record why the bounded task is worth investigating. |
| `quote` | From triaged or scope-revision-requested; exact `scope_binding` and `assumptions` with `evidence_kind:illustrative_assumptions`, `currency:USD`, producer/reviewer/admin hours, hourly valuation, nonlabor cost and target margin. |
| `confirm_scope` | From quoted; `simulated:true`, exact `scope_revision`, `scope_binding` and `quote_binding`. This is not customer acceptance. |
| `start_research` | From accepted synthetic scope. |
| `source_access_failed` | From researching; existing `source_id`, `outcome:blocked|unavailable|failed`. Retains the reason and attempt. |
| `resume_with_gap` | From blocked; `simulated:true`, `retain_unresolved:true`. Allows continued gap reporting, never changes source rights or claims. |
| `log_time` | Accepted/researching/blocked/reviewing; positive `minutes`, `role:producer|reviewer|admin_support`, `simulated:true`. |
| `submit_review` | From researching. |
| `review` | From reviewing; different synthetic `reviewer_id`, `simulated:true`, exact review `binding`, and a `defer` or `reject` decision with rationale and next action for every source. |
| `revise_scope` | Accepted/researching/blocked/reviewing; complete `scope` with revision incremented by one. Invalidates quote and review and requires another quote/confirmation. |
| `deliver` | Current review and scope-bound quote required; `simulated:true`, `deliverable_kind:unresolved_gap_brief`. |
| `cancel` | Any open pre-delivery state; `simulated:true`, `obligations_disposition:no_real_customer_or_charge`. |
| `close` | Delivered or cancelled; `simulated:true`. Does not assert actual customer satisfaction or acceptance. |

Use exported `scopeBinding(scope)` and `quoteBinding(scope, assumptions)` to bind quote and confirmation to the exact scope and assumptions. Use exported `reviewBinding(scope, sources)` from `scripts/source-selection-service/workflow.mjs` to obtain the review digest after reviewing the exact scope and source rows. This hash establishes which synthetic inputs were reviewed; it does not authenticate a person or prove correctness. Example generation is in `syntheticEvents` in the CLI module. Changing source evidence or scope invalidates an earlier review.

The quote illustration uses 6 producer, 3 reviewer and 1 administrative hour, an assumed USD75/hour, USD25 nonlabor cost and a 35% target contribution margin. Loaded cost is USD775 and the scenario floor is USD1,192.31, rounded upward to cents. These are the plan's illustrative assumptions, **not actual rates, wages, a public price or an offer**. The rehearsal logs simulated minutes separately; it never calls them measured delivery capacity. Paid adoption remains false.

## Evidence and release limits

The source rows cover finance, ownership, capacity and utilization and reference the current local Pennsylvania candidate guide by exact digest. That guide points to publisher documents and records limitations. Original publisher response bytes were not retained, source-specific rights remain unresolved, and the guide is not an accepted assertion ledger. The service code therefore permits only deferred/rejected source decisions and an unresolved gap brief. It cannot produce verified source claims or rights approvals.

A changed guide fails evidence validation. Investigate the change and explicitly revise the engagement; do not automatically refresh its digest just to bypass review. No supplied URL is fetched. The public projection copies only explicit source IDs/domain/status/evidence path+hash and fixed next-action text; nested private data is not copied. This is a bounded serialization rule, not general-purpose detection or redaction of sensitive text entered into public fields.

Eleven adversarial tests cover denominator-free cost scenarios, self-review, missing source decisions, stale scope/review, cancelled/blocked exports including reviewed-then-cancelled closure, real-mode rejection, unknown actual facts, nested privacy leakage, evidence drift and exclusive export. Production CLI storage checks require a real `/workspace` directory on its separate device. Serialization tests may inject a test destination check on the runner's authorized storage; actual local CLI execution separately exercises the real storage check.

## Human operating handoff

Before a real service exists, the operator must decide customer consent, confidentiality, retention/deletion, actual producer/reviewer capacity, due dates, quote/payment/cancellation terms and source permissions. None is inferred from this rehearsal. The present tool intentionally refuses actual customer records; adapting it for real work is a separately reviewed implementation change.

The permissible completed outcome here is a verified **synthetic workflow**, including a defensible statement that source suitability and acquisition remain unresolved. The paid pilot, independently reviewed real brief, payment evidence, demand and 90-day business review remain not_run. The 90-day clock begins at actual M18B release, not at this rehearsal.
