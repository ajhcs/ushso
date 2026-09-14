# Accepted freshness, release identity and WP11 components

PR-005, PR-007 and PR-086 were independently accepted and merged through [PR #22](https://github.com/ajhcs/ushso/pull/22). Combined head `e6da2e2d87c95501e5a1b129989e17bdae3cb882` and integration merge `0d730aaf07b89bb16fb66fc224841a2d66c80d49` have the same tree `a9d9bca698ffc403a9ad1b82a8c8328af01146aa`.

All ten local release-gate stages passed on the first attempt with one build. Both jobs in [GitHub CI run 34622150511](https://github.com/ajhcs/ushso/actions/runs/34622150511) checked out `c94b187639eb795826fc95532a4a3ce35d88f98e`. Retained checkout logs and GitHub commit parents establish the same tree as the local gate. `index.json` maps every retained evidence file and losslessly compressed report to its original path and hash.

The full 21,922,095-byte gate receipt is retained as `local-gate.json.gz`; its decoded SHA-256 is `eb91ff62e7933753c1d1db723f3c56db635baadc0744efb7929753a00a1330d4`. The complete decoded receipt and both complete hosted logs were scanned before publication. The only gate finding is the independently recomputed candidate identity, with its original scan and disposition retained.

PR-005 retains its historical producer base and PR-004 dependency. Its later PR-086 integration dependency is separately bound in the controller handoff and exact combined evidence. Earlier failed receipts remain intact. The controller receipt-finalization correction reran no product checks and changed no candidate bytes.

The PR-006 and PR-008 scope work is preparation, not implementation acceptance. Grok could not dispatch the later PR-008 scope review because the connected runtime was incomplete; the failure occurred before prompt dispatch. No provider configuration or credentials were changed. Native Luna Max reviews use the user-authorized alternative.

All R01–R16 requirements remain unaccepted. Current WP0/CI/WP11 successor approvals remain pending PR-082. Component integration does not qualify scientific fitness, production deployment, real participant testing or sustained operation.
