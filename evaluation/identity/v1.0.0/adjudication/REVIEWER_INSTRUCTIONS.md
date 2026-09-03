# WP7 independent identity adjudication instructions

This packet is prepared for a future, explicitly authorized independent human
review. It is not an authorization to begin review. `AUTH-14` currently records
only the authorization and coordination boundary (`not_requested`,
`authorized:false`). Do not assign cases, contact reviewers, collect decisions,
or import evidence until the register contains an explicit scoped authorization
receipt and this packet has been reissued and resealed against that receipt.

## Before review

1. Verify the exact bytes and digests named in `reviewer-packet.json` with
   `npm run validate`. Do not use a copied or edited case list.
2. After explicit authorization, reissue the packet so its authorization
   boundary names the exact authorization receipt. A packet whose status is
   `prepared_not_authorized_for_review` is preflight material only.
3. Record a stable reviewer ID, a separately verified identity receipt, and a
   separate independence attestation for every reviewer. Do not put names,
   email addresses, credentials, or other personal data in the submission.
4. Exclude anyone who saw the controlled expectation, algorithm output, or a
   peer decision before sealing their own independent decision. Exclude anyone
   with a disclosed conflict. Controlled, synthetic, fixture, and test reviewer
   identities never count as external evidence.
5. Predeclare the sample. At least 100 cases must receive both a primary and a
   secondary review, or the entire eligible set when it contains fewer than 100
   cases. The sample must represent every launch-critical stratum and each
   sealed case class within every represented stratum. Reviewers receive only
   opaque `review_case_id` values; do not reveal internal case IDs, case class,
   scenario name, synthetic expectation, or algorithm prediction.

## Independent decisions

- Assign exactly one primary and one secondary reviewer to each sampled case.
  The two stable reviewer IDs, identity receipts, and independence attestations
  must be distinct.
- Each reviewer evaluates only the evidence-bound assertions in the blinded
  packet and chooses exactly one of `same_identity`, `not_same_identity`, or
  `needs_more_evidence` at the stated entity grain and effective time.
- Record a 20-2,000 character evidence-based rationale and one or more opaque
  evidence references from the packet. Do not include source payloads, personal
  data, controlled labels, or peer decisions.
- Seal the primary and secondary records before comparing them. The importer
  calculates percent agreement and Cohen's kappa from these two independent
  first-pass decisions only.

## Conflicts

- Matching primary and secondary decisions become the case decision. Do not
  add a third reviewer to an agreement.
- A disagreement remains unresolved. Never select a majority, merge an entity,
  or overwrite either record. Assign exactly one third adjudicator whose stable
  ID, identity receipt, and independence attestation differ from both original
  reviewers.
- The adjudicator records a new decision. `needs_more_evidence` is a safe
  conflict disposition and does not prove equality. All three immutable records
  remain in the evidence set.

## Validation and reporting

Build one JSON submission conforming to
`schemas/adjudication-submission.schema.json`. Bind every record to the exact
packet byte SHA-256 and calculate `record_set_sha256` over canonical JSON of the
ordered records. Then run:

```sh
npm run validate-adjudication --prefix evaluation/identity/v1.0.0 -- /absolute/path/to/submission.json
```

The command is offline, rejects symlinks and inputs over 10 MiB, performs no
database write, and never imports records. It rejects unknown fields, unknown
cases, fixture identities, reused identity/attestation receipts, duplicate
reviewers or roles, incomplete double reviews, unresolved conflicts, missing
strata/classes, digest drift, and absent authorization. It reports agreement,
kappa, pending/conflict denominators, and per-stratum 50/50/20 evidence counts.

A `validated_ready_for_append_only_import` receipt means only that the bounded
file passed the offline gate under an explicit authorization receipt;
`import_executed` remains `false`. A later append-only persistence migration and
separate import receipt are still required. This package includes only the
receipt schema—no completed review or import receipt.

Automatic identity rules remain `disabled_candidate_only`. Human adjudication
does not itself authorize automatic resolution, and future rule enablement is
not required for a candidate-only release.

