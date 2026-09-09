# Cursor provisioning — proposed operation, not authorization

Status: local implementation only. No remote key, Worker version, deployment, or secret-manager item was created by this packet. Owner must approve the exact environment and operator before execution.

| Target | Exact identity | Status |
|---|---|---|
| Production Worker | `ushso`, account `1e5f92087e779df50f3f3546a0eed22e`, `wrangler.jsonc` (no named `--env`) | proposed target; authorization pending |
| Existing route-free staging Worker | `ushso-catalog-recovery-v12`, same account, `wrangler.staging.jsonc` | separate scope; do not infer permission from production |
| Dedicated secret binding | `USHSO_CURSOR_SIGNING_KEY` | 32–1024 UTF-8 bytes; HMAC-SHA256; no credential reuse |
| Operator | owner-designated repository operator with verified account identity and Cloudflare permission | exact operator authorization still needed |
| Storage | owner's approved secret manager, distinct production/staging entries with restricted operator access | product/item selection and authorization pending; no invented item ID |

## Authorized workflow to use later

1. Recheck target account, Worker, routes, active deployment/version and existing binding names using read-only commands. Record version IDs and binding names only, never secret contents or hashes. Stop on any mismatch with the approved packet.
2. Generate a dedicated high-entropy signing key inside the approved secret manager. Never place a value in shell arguments, source, screenshots, receipts, model prompts or query strings. Transfer through a secure interactive prompt without terminal recording, or an owner-approved secret-manager stdin integration. Do not export all host environment variables into the Worker.
3. After explicit authorization for remote version creation, use the repository-pinned Wrangler 4.127.1 `versions secret put` path for the exact config/name. **Do not use ordinary `secret put`: Cloudflare documents that it immediately deploys a new version.** The versions operation creates a version without promoting it. It still requires authorization and does not constitute deployment approval. [Cloudflare secret lifecycle](https://developers.cloudflare.com/workers/configuration/secrets/).
4. Ensure the resulting version contains the approved exact candidate code and retained asset inventory, not merely the previously deployed code with a new secret. Secret-only version creation is not a substitute for uploading the approved bundle. Record the resulting version identity and complete code/assets/config relationship before requesting traffic promotion.
5. With separately authorized staging/version-preview access, prove first and follow-up dictionary and machine pages continue across independent instances with the same key. Verify tampering, expiry, stale generation and a test-only rotation all give explicit restart-required outcomes. A local environment checker cannot attest to a remote binding. Do not test rotation by changing the production key without its own approval.
6. Request separate deployment approval for that exact version/artifact and routing allocation. No production traffic change is authorized here.

Command shape after authorization (contains the binding name only; the CLI prompts securely for its value):

```sh
/home/plumbob/bin/with-dev-storage env WRANGLER_LOG_PATH=/mnt/d/tmp/plumbob/ushso-cursor-operation-logs node scripts/run-wrangler.mjs versions secret put USHSO_CURSOR_SIGNING_KEY --config wrangler.jsonc --name ushso
```

Run from the approved owned candidate. Choose a fresh task-owned log directory outside watched source/assets. Validate the installed CLI help again before execution. No command in this packet has been executed against Cloudflare.

## Rotation and rollback

There is no previous-key grace ring. Rotation immediately invalidates outstanding cursors, including cursors within their non-sliding 15-minute TTL. Clients restart traversal; do not imply continuity across rotation. Keep the previous key only in the approved secret manager for an explicitly authorized rollback. A rollback to an older Worker version must be checked for both code/assets and secret-binding compatibility; code rollback alone does not prove cursor continuity. Capture the then-current rollback version immediately before the authorized change rather than relying on historical host notes.

Local tests use unmistakably test-only secrets. Unknown quota remains null and means no measured allowance, not unlimited or zero. Persistent cursor readiness does not accept latency, scientific limitations, AUTH-15, release subjects or deployment.
