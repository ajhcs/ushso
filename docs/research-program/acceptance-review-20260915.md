# Acceptance review — 2026-09-15

Base: `908ea5981c3f7442efc1ead8d0e6323c7336b08e`, research integration.
PR-079–084 engineering packages are merged. All 87 assignments are integrated;
this does not establish completed capabilities or program acceptance.

## Corrected defects

- Assignment IDs and completion flags alone previously yielded eight participants
  and 100% completion even with an empty consented-session list. Metrics now
  require a matching session, explicit consent and implementer separation,
  non-simulation, matching generation/task/slot/audience/participant, and an
  evidence reference plus SHA-256. Duplicate sessions and cross-group participant
  reuse are rejected. These are input checks, not independent authentication of
  real human participation. R12 acceptance remains a separate decision.
- The PR-084 zero-observation snapshot previously accepted caller-supplied
  day/cycle counts. It now rejects positive or malformed counters. A future
  receipt-ingestion implementation must bind authorization, deployment, actual
  timestamps, scheduled-run identities and after-refresh checks before recording
  nonzero observations. This snapshot cannot ingest those receipts.
- The release record confused September 9's version and deployment UUID with
  current production and an account ID. The corrected, hashed retained baseline
  records September 14's production version, deployment ID, configured account
  and separate rollback version. It does not claim a fresh live readback.
- Active PR-077–084 verification suites were absent from root test discovery.
  They now run through `tests/research-program/acceptance-suites.test.mjs`.
  The PR-081 test also now covers planned and integrated ledger states explicitly.

Synthetic test fixtures are validation inputs only. No participant, consent,
source-access, scientific, deployment, or elapsed-operation witness was created.
Historical PR handoffs and frozen candidate evidence remain intact; corrected
current deployment/qualification projections supersede their stale identity text.

## Next work, in dependency order

1. **Engineering remediation remains possible.** Decompose the retained R03–R08
   failures into bounded tasks: source-attempt accounting, core product/field
   coverage, restricted routes, dictionary/unit/key residuals, retrieval failures,
   and independent join qualification. Do not classify the entire remainder as
   waiting for humans. Keep source authorization and scientific interpretation
   separate from offline implementation fixes.
2. **Prepare concrete authorization packets.** Map each proposed staging,
   scheduler or recovery action to the actual AUTH entry, environment, candidate,
   resources, cost ceiling and rollback. AUTH-05 is recovery drills; AUTH-07 is
   database-backed public promotion. Neither is a generic scheduler permission.
   Existing static-site deployment approval is not approval of a new topology.
3. **Collect and review missing evidence.** Recruit eight distinct novice and
   eight distinct advanced participants through a facilitator. Verify the current
   candidate in actual browsers/assistive technologies/native WebMCP. Preserve
   consent and private notes outside public Git; publish sanitized evidence
   references and hashes. Historic September 14 native Chrome success does not
   cover the changed research candidate.
4. **Resolve cost and scientific decisions.** Obtain actual account terms, shared
   allowances and measured workloads for C-009-1. Named human decisions may approve
   supported interpretations or explicitly amend requirements with reasons and
   impact; a signature cannot turn missing witnesses into observed passes.
5. **Qualify before rollout.** Reconcile the research candidate with current main,
   freeze and independently qualify an exact artifact, then obtain any required
   concrete rollout authorization. The technical gate for this correction does
   not qualify the whole research product.
6. **Observe after a real deployment.** Start the observation clock on the reviewed
   deployed product with authorized scheduling. Require 14 actual elapsed days,
   two complete cycles, and after-refresh rechecks. Waiting now would not satisfy
   post-deployment observation. Reconcile any longer topology-specific soak window
   (for example AUTH-08) before claiming closure.

## Limits

`plan_research` stays disabled. No deployment, scheduler activation, credential
change, paid call, scientific approval or requirement waiver is part of this fix.
R01–R16 remain unaccepted; `program_complete` remains false.
