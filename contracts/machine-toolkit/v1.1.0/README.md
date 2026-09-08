# Machine-toolkit response successor v1.1

Implemented response-envelope successor; owner approval and deployment remain pending. Inputs remain v1.0. Strict v1.0 response consumers must migrate to the v1.1 schemas before consuming this candidate.

Quota is explicitly unknown: state is unknown and policy_id, limit, remaining, reset_at and retry_after_seconds are null. Unknown is not unlimited, zero allowance or a retry deadline. No limiter policy is invented. This successor cannot claim rate_limited while quota is unknown.

The package contains common/result definitions and all nine capability response schemas. Run `npm --prefix contracts/machine-toolkit/v1.1.0 run verify` from the repository. The verifier compiles all nine schemas and resolves only repository-local USHSO contract dependencies, never network references. The normal repository tests import this verifier and validate actual unknown-quota error envelopes for every capability, plus a success envelope and malformed-input/safety-fallback cases. Runtime validation also enforces timestamps and semantic constraints; schema compilation uses no format plugins.

Historical contracts/machine-toolkit/v1.0.0 and their receipts are unchanged. The dependency on the historical research-plan schema preserves the disabled planner result shape; it does not activate planning. This package is not an attestation or release receipt.

Cursor readiness is independently checked by scripts/check-cursor-configuration.mjs without displaying the key. Independent Worker tests cover shared-key continuation and mid-pagination rotation/restart. No remote secret was provisioned. Actual target-environment provisioning and deployment require separate authorization.
