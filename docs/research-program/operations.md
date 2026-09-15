# Research-program operations

This document is configuration and fixture evidence for PR-076. Merging it does not enable a timer, Queue consumer, Workflow, or production harvest.

## Refresh schedules

Measured source refresh uses publisher cadence, spend-budget class, last success/attempt, and changed-content hash. A source with no successful collector run remains stale and visible. Current last-good generation is `live-2026-09-03-85b50522b420`.

Checked-in schedules:

- CMS HCRIS: daily public-catalog metadata. Finding the source is not payload access.
- CDC PLACES: weekly county-estimate metadata.
- AHRQ HCUP: monthly documentation/application route. Restricted files are not fetched.

Job leases and outbox dispatch remain the WP4 ports. The checked-in scheduler default export throws `WP4_SCHEDULER_COMPOSITION_DISABLED`.

## Operational signals

Track queue age, failed checks, schema drift, coverage loss, budget exhaustion, and review backlog. Notify only on a meaningful state change with the affected source and next action. Repeated unchanged failures do not generate routine notification spam. Critical new loss is not hidden by aggregate HTTP success.

Redirect destination and resource-role drift are monitored separately from HTTP reachability. The dated PR-011 EPA developer-directory observation (`https://www.epa.gov/developers/data-data-products#apis` → `https://www.epa.gov/developers/widgets`, HTTP 200 HTML) is a `changed_destination` signal. It cannot refresh an actionable API success badge.

## Runtime activation

Public Worker has no source credentials and no source-fetch capability. Rendered public Wrangler configuration remains the WP3-generated fail-closed foundation placeholder. This PR does not edit generated Wrangler files. Public-worker no-credential and no-source-fetch bounds are asserted from owned harvest-worker activation evidence. Scheduler and harvest default exports remain disabled.

Fixture/staging cycles may be recorded as `fixture_only`. Two complete scheduled cycles remain **unrun until authorized**. Production activation is separately receipted and is not issued by this PR.
