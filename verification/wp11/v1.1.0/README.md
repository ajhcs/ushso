# WP11 v1.1 implemented successor — approval pending

Run `npm test --prefix verification/wp11/v1.1.0` for technical and adversarial
tests; `npm run receipt:draft --prefix verification/wp11/v1.1.0` for a deterministic
review subject. `validate` returns BLOCKED_APPROVAL_PENDING (exit 2) until a genuine
authorization and exact approved receipt exist. No predecessor is overwritten.

Completed product fixes: explicit HTTPS syntax and shared URL policy, malformed
peer isolation, truthful historical AUTH-15 label, activation-time return context,
real-height result cards for scroll restoration and typed not-found titles.
The verifier tests relocated policy behavior instead of requiring obsolete local
implementation snippets. Existing planner/contract/governance/frozen coverage
checks are retained. It pins the predecessor receipts and a superset of the
previous implementation scope, including current UI, shared retrieval dependencies
and this successor's own source. New or changed files invalidate authorization.

Technical foundation passing does not imply work-package acceptance: AUTH-12,
AUTH-15, AUTH-16, AUTH-17 and the specified external human studies remain pending.
Historical WP9 copy is not authorized current coverage wording. This successor
does not discharge these separate gates or enable planning.

Approval format and exact statement are documented in
`verification/wp0/v1.2.0/README.md` and enforced by the common support module.
After authorized review only, `receipt:issue -- --approval PATH --evidence PATH`
exclusively creates `receipts/approved.json`. Validators rebuild the current
subject and reject stale, missing or wrong-package approvals. Evidence provenance
and reviewer authority still require human verification; JSON is not identity proof.
