# WP8 retrieval-v2 development candidate

This package records a deterministic retrieval-v2 development/validation run over the pinned c157 corpus and the development plus validation benchmark splits. It does not alter the v1 bridge, does not read or parse holdout question rows, and does not authorize production routing.

The candidate is intentionally not release-ready. Its zero-tolerance safety checks pass, while the frozen historical precision target remains open. AUTH-13 is still required before any independently owned final holdout may be supplied or evaluated.
