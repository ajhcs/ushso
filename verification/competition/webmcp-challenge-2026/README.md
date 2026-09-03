# WebMCP Challenge 2026 submission freeze

This directory is post-submission evidence. It does not modify the tagged
submission or authorize a production deployment.

## Frozen identity

- Repository tag: `webmcp-challenge-submission-2026-09-03`
- Commit: `d30dd9f79d1f4047dba2c34dc159f44997d3004c`
- Tree: `9be3c1874bba3e67e64e5747de4b3252271cc8fd`
- Cloudflare deployment: `cc66a810-40b2-4ccf-98fb-b599482acb41`
- Cloudflare Worker version: `374c623c-8946-4974-9739-11f4917baf1a`
- Judged tool: `observatory.discover_sources`

The exact-tree release gate passed once with run
`20260903T210335Z-913fed37c652`. The complete receipt is stored at
`receipts/submission-release-gate.json`.

## Freeze rule

Do not deploy new tools, change the corpus, or materially alter behavior on
`ushso.org` or `www.ushso.org` during judging without written sponsor
clarification. An availability repair may restore the exact frozen behavior.
Record any such repair, including before/after deployment and asset identities.

Successor work remains in a separate branch and may not receive production
traffic. The repository defines the `ushso-staging` resource prefix, but no
staging hostname was provisioned when this baseline was recorded. Provision and
verify a distinct staging hostname before successor browser work.

## HTTP parity monitor

Run:

```bash
node scripts/check-webmcp-competition-baseline.mjs
```

The command checks the two readiness endpoints, the published WebMCP contract,
the primary static assets, and the canonical Pennsylvania finance/utilization
query against exact response hashes and semantic invariants. It exits nonzero on
drift. Run it through the end of judging at 2026-09-21 17:00 Pacific. A scheduler
was not installed by this branch; scheduling belongs outside the frozen
production artifact.

Verify the Cloudflare identity separately with the read-only command:

```bash
node scripts/run-wrangler.mjs deployments status --name ushso --json
```

## Native WebMCP host gate

HTTP/API parity is not a WebMCP host invocation. Complete this gate in ChatGPT's
in-app browser or a genuinely WebMCP-enabled Chrome newer than the locally
available Chrome 149:

1. Record the host and full browser version.
2. Open `https://ushso.org`.
3. Confirm that the host discovers exactly `observatory.discover_sources`.
4. Submit the exact judge prompt stored in `baseline.json`.
5. Confirm the host invokes the discovered tool without a mocked
   `document.modelContext`.
6. Record the timestamp, tool name, request, leading returned record IDs, and
   result status in a new receipt in this directory.

The local Chrome observation was version `149.0.7827.155`; it exposed no
`document.modelContext` and is deliberately not counted as evidence.

## Open evidence

The submission-video URL or file was not available in the repository or public
search at capture time. Add its immutable locator and SHA-256 digest to a new
receipt without editing the tagged tree or rewriting this historical baseline.
