# Publication and optional AI engineering handoff

This follow-on prepares source publication and internal AI drafting. Actual
source acceptance, operating appointments, researcher sessions, provider account
approval and paid evaluation remain human work. Neither feature is activated by
the preparation commands below.

## Human work, in order

1. Open the [source packet](../source-selection-approval/README.md). It contains
   P01-P06 and two identity claims, exact source observations, private retained
   HCRIS/PHC4 HTML references and paragraph hashes, two rights worksheets and six
   deferred candidates. Complete a private copy; the checked-in forms are blank.
2. Confirm actual responsibilities and capacity for Luis Barrigan, Syed Siddiqi
   and Cole Lyons. Record claim decisions, a different person's independent
   challenge, and separate metadata-capture, retention, publication, excerpt and
   AI-sharing rights. Revise the packet before signing if wording or rights
   change; new digests invalidate prior decisions.
3. Run the prepared 12-case retrieval and six-task/three-participant usability
   protocol. Preserve failures, assistance and consent records. Supply the
   actual correction/on-call and backup arrangements. None of these observations
   is supplied by passing software tests.
4. Import actual decisions; prepare, retain and restore the resulting generation
   using current external authority. Add the resulting receipt to the review
   records. Approve the exact generation, rights policy, application inventory
   and deployment target, then prepare the gated production handoff.
5. For AI, use [the disabled runner and templates](ai-engineering.md) and
   [provider evidence](provider-evidence-2026-11-14.md). Confirm account, input
   rights, retention, budgets and reviewer capacity before an actual request.
   Freeze the proposed evaluation cohort and gather real timing/labels. A paid
   evaluation and a later operating approval are separate decisions.

## Technical entry points

| Operation | Entry point |
| --- | --- |
| Packet digest, blocked readiness, immutable actual-decision import | `scripts/source-selection-approval/review.mjs` |
| Exact generation approval validation | `scripts/source-selection-approval/validate-generation.mjs` |
| Production handoff with actual restore/inventory verification | `scripts/source-selection-approval/prepare-release.mjs` |
| Accepted and unavailable release retain/verify/restore | `scripts/release-source-selection/restore-release.mjs` |
| Real local retained-Worker HTTP smoke | `scripts/release-source-selection/restore-smoke.mjs` |
| Accepted-source browser/export/import checks | `scripts/release-source-selection/check-accepted-browser.mjs` |
| Local withdrawal and rights rotation | `scripts/source-selection/local.mjs withdraw` |
| Disabled AI dry run, explicit budget initialization, execution, evaluation, status, shutdown | `scripts/source-selection-ai/cli.mjs` |

Determine the exact production target before completing the final approval:

```sh
node scripts/release-source-selection/deploy-approved.mjs --target
```

Prepare the validated deployment without contacting Cloudflare:

```sh
node scripts/release-source-selection/deploy-approved.mjs \
  /workspace/private-review/handoff-inputs.json \
  /workspace/private-review/new-deployment-preparation
```

Only after actual approval and qualification, the same command with a **new**
destination and `--apply` invokes the deployment. It uses the already qualified
retained Worker and assets without rebundling. Direct repository `cf:deploy`
rejects an available publication. The trusted local operator can still invoke
raw provider tools; JSON hashes are integrity bindings, not identity proof or a
replacement for operator access control.

## Evidence boundaries

The engineering rehearsal uses an explicitly synthetic source and mocked model
responses. Its passing result demonstrates implementation behavior, not accepted
publisher facts or model quality. Private publisher captures are outside Git and
served assets; metadata and their hashes are review evidence. No medical dataset
payload was acquired, no publisher/customer contacted, and no API expenditure
authorized by the preparation work. Historical release and failed-test receipts
remain retained separately.

Local qualification receipts are retained under
`/workspace/build/builderbob/ushso-publication-ai/receipts`.
