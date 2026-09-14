# Deployment catalog page bound

The pre-deployment runtime check found that `GET /api/catalog?limit=200` exceeded the existing 2 MiB response budget: 2,689,752 bytes on the previous deployed artifact and 2,794,549 bytes on merged PR #12. Both failures are retained unchanged here. The limit is not relaxed.

HTTP catalog requests now return at most 100 records per page, while preserving the full matching count and continuation cursor. Smaller requests keep their requested size. The existing runtime check is now an unconditional post-build release-gate stage; no extra build is introduced. HTTP E2E checks measure the actual largest response and follow its cursor with the same original request limit, checking for repeated records or changed totals.

This correction changes pagination size, not catalog membership, source claims, access authorization or scientific qualification. Production deployment must use a newly gated artifact containing this fix.
