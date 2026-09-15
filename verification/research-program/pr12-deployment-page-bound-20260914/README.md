# Deployment catalog page bound

The pre-deployment runtime check found that `GET /api/catalog?limit=200` exceeded the existing 2 MiB response budget: 2,689,752 bytes on the previous deployed artifact and 2,794,549 bytes on merged PR #12. Both failures are retained unchanged here. The limit is not relaxed.

HTTP catalog requests now return at most 100 records per page, while preserving the full matching count and continuation cursor. Smaller requests keep their requested size. The existing runtime check is now an unconditional post-build release-gate stage; no extra build is introduced. HTTP E2E checks measure the first unfiltered maximum-size response and follow its cursor with the same original request limit, checking for repeated records or changed totals.

This correction changes pagination size, not catalog membership, source claims, access authorization or scientific qualification. Production deployment must use a newly gated artifact containing this fix.

Separate native reviewer `/root/evidence_dependency_review` approved the page-limit patch after independently passing all nine worker contract tests. Existing cursors issued with requested page sizes above 100 require traversal restart after deployment because page size is part of the cursor signature. The runtime byte check measures the first unfiltered maximum-size page; it does not prove a universal byte maximum across every page, filter, or sort.
