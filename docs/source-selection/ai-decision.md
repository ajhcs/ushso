# Optional model processing: disabled

This implementation chooses the disabled branch of WP-12. No publisher capture,
research question, or source payload is sent to Muse Ember or another model.
Search, projection, comparison, refresh reporting, and export are deterministic.
No API account, paid request, or background model service was created.

The current `authorizeAI` helper is a preflight check only. It rejects missing
provider-sharing rights and excessive estimated input or cost. Its
`reservation_required` result is not a reservation and must never trigger a
request. There is no concurrency-safe spend ledger or provider adapter behind it.

Ember remains a candidate for proposing metadata from permitted public captures,
with exact supporting spans and human review. It cannot approve source facts or
rights. Before enabling it, implement durable aggregate reservations across
concurrent jobs, bounded retries and output, provider-specific request accounting,
cache invalidation, deletion/retention handling, and failed-call records. Verify
current official pricing and account availability at that time; planning prices
are not an operating budget. Compare against deterministic extraction on the
same independently reviewed examples, including review time and critical errors.

The enabling decision must identify the permitted inputs, reviewer capacity,
measured benefit, monthly ceiling, incident owner and tested shutdown path.
Until those conditions are met, the disabled implementation is the release
configuration. The code does not claim a qualified low-cost model integration.
