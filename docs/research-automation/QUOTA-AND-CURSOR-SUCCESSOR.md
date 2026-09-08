# Response quota successor v1.1 and persistent cursor readiness

## Quota meaning

The current candidate response envelope is `observatory-machine-toolkit.v1.1.0`. Input contracts, capability names and read-only boundaries remain v1.0. The successor states quota honestly:

```json
{"state":"unknown","policy_id":null,"limit":null,"remaining":null,"reset_at":null,"retry_after_seconds":null}
```

Unknown means this service has no measured/enforced allowance to report. It does not mean unlimited, zero remaining, or a promise that the next request will succeed. The candidate does not invent a limiter policy, reset deadline or 60/59 counter. It must not derive rate-limit headers or retry instructions from null fields.

The successor intentionally does not represent a configured limiter yet. A future measured policy needs a separately specified known-state contract. Claiming `rate_limited` while quota is unknown is invalid.

## Migration and historical boundaries

Historical `contracts/machine-toolkit/v1.0.0` files remain unchanged. New v1.1 common/result/response schemas describe the successor envelope. Runtime validation accepts historical v1.0 concrete quota envelopes and v1.1 unknown envelopes according to their separate shapes; it rejects mixing them.

Strict consumers pinned to the v1.0 response schema must adopt the v1.1 response schema before consuming this candidate. Do not relabel a v1.1 response as v1.0 or coerce null into zero. Existing input schemas are not migrated, and the legacy exported TOOL_CONTRACT_VERSION remains the historical v1.0 toolkit identity, not an assertion that new responses use the old envelope. The response itself carries its explicit version.

No historical receipt, release attestation, activation approval or sealed contract is rewritten by this migration. This is an engineering candidate; deployment approval remains separate.

## Persistent cursor preparation

The prepared dedicated binding is `USHSO_CURSOR_SIGNING_KEY`. The same high-entropy key must be supplied to all instances serving one environment. It is unrelated to repository-owner identity or any authentication/provider credential. The existing signer validates 32–1024 UTF-8 bytes and uses HMAC-SHA256; absence remains explicitly instance-limited.

`node scripts/check-cursor-configuration.mjs` checks only its supplied local environment and prints missing/invalid/configured without printing, hashing or fingerprinting the secret. Its success does not establish that a remote Worker has the binding. Missing/invalid exits nonzero. No value was generated or provisioned during preparation.

Tests use clearly test-only keys and independently constructed Workers: page one and page two continue across instances sharing the key; rotation between pages rejects the old cursor with restart-required; restarting with the new key succeeds across new instances. There is no previous-key grace ring. Rotation therefore invalidates outstanding traversals, including those within the non-sliding 15-minute TTL.

An authorized operator must separately select the exact target environment, provision a dedicated secret using the approved secret-management workflow, confirm the binding without exposing its value, and perform the cross-instance smoke test on the approved candidate. Neither source configuration nor documentation contains a secret. No live provisioning, version creation, release or deployment is authorized by these tests.

Remaining authority needed: explicit authorization for the exact remote Worker/environment secret mutation and, separately, deployment of the approved candidate. Scientific proposals remain pending owner review.
