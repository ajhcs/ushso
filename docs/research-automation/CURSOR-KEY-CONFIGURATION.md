# Persistent machine pagination key — prepared, not provisioned

The Worker already reads the dedicated `USHSO_CURSOR_SIGNING_KEY` secret binding. All instances serving one environment and candidate generation must receive the same value. A configured key permits cross-isolate continuation; it does not make cursors valid across changed generation, publication manifest, request filters or expiration. The TTL remains 15 minutes, non-sliding.

Provisioning is a separate authorized operational action. Do not put the value in wrangler.jsonc, vars, committed .dev.vars, command arguments, review packets or logs. Do not reuse any repository-owner, Cloudflare, OpenRouter, authentication or other service credential. An operator should generate a dedicated high-entropy secret in an approved secret manager; the implementation accepts 32–1024 UTF-8 bytes. Use the environment's approved Cloudflare secret provisioning workflow only after deployment authorization, checking exact Worker name and environment first. No secret was generated, read or provisioned for this preparation.

Pre-release checks:

- Confirm the dedicated binding name exists on the exact target environment without printing its value.
- Exercise page 1 through one independently created Worker instance and page 2 through another with the same test-only key; verify no duplicate or omitted members and no cursor_instance_limited warning.
- Exercise a different key, changed query, changed generation, tampering and expired token; each must return a typed restart-required outcome, not silently restart or mix results.
- If the binding is absent, the current local fallback is ephemeral and explicitly warns on continuation responses. This mode is not qualified for production multi-instance pagination.
- Rotation currently invalidates outstanding cursors immediately. There is no previous-key grace ring. Coordinate rotation as a documented 15-minute traversal disruption or separately implement and verify a key-version transition. Never silently accept a previous candidate's generation.

Cloudflare reference: https://developers.cloudflare.com/workers/configuration/secrets/

Remaining operator decision: approved target environment and secret provisioning/rotation ownership. This document is readiness guidance, not deployment authorization or evidence that production configuration exists.
