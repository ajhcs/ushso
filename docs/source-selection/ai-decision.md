# Optional model processing: implemented, disabled pending approval

This implementation chooses the disabled branch of WP-12. No publisher capture,
research question, or source payload is sent to Muse Ember or another model.
Search, projection, comparison, refresh reporting, and export are deterministic.
No API account, paid request, or background model service was created.

The legacy `authorizeAI` helper remains a preflight check only. Its
`reservation_required` result must never trigger a request. The separate
`packages/source-selection-ai` runner implements durable reservations, an
explicitly initialized shared budget ledger, a Meta Responses adapter, bounded
requests, current rights rechecks, and a shutdown marker. No caller in the
public application invokes that runner. See [engineering and commands](ai-engineering.md).

Ember remains a candidate for proposing metadata from permitted public captures,
with exact supporting spans and human review. It cannot approve source facts or
rights. Offline adversarial tests exercise aggregate limits, uncertain charges,
duplicate jobs across processes, ledger loss and replay, month rollover, rights
changes, bounded output, retries, and shutdown. The runner retains no response
cache; returned drafts remain subject to the approved retention/deletion policy.
The [provider evidence](provider-evidence-2026-11-14.md) records current public
documentation. Account eligibility, an authenticated request, actual billing,
terms acceptance and a paid evaluation have not been observed. Compare against
deterministic extraction on the same independently reviewed examples, including
review time and critical errors; [templates](ai-templates/README.md) intentionally
contain no invented labels or timings.

The enabling decision must identify the permitted inputs, reviewer capacity,
measured benefit, monthly ceiling, incident owner and tested shutdown path.
Until those conditions are met, the disabled implementation is the release
configuration. Offline implementation qualification does not establish measured
model quality, account eligibility, or permission to incur charges.
