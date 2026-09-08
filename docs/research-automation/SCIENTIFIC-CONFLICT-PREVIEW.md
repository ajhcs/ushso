# Pending scientific-conflict preview

This implemented review package covers SCI-01, SCI-02, SCI-03 and SCI-06. It is not a canonical catalog, approval mechanism or ninth public machine tool. SCI-04/05 retain their separate exact-claim package and selector. Scientific promotion and deployment require separate owner decisions.

## Generate and verify

Run from the owned candidate with Node 22.15 or newer and task-owned outputs under `/mnt/d/tmp/plumbob`:

```sh
/home/plumbob/bin/with-dev-storage node scripts/research/package-scientific-conflicts.mjs PACKET_JSON DRAFT_JSON CORPUS_DIRECTORY NEW_OUTPUT_DIRECTORY
/home/plumbob/bin/with-dev-storage node scripts/research/verify-scientific-conflicts-package.mjs NEW_OUTPUT_DIRECTORY CORPUS_DIRECTORY
```

The positional inputs are the exact reviewed conflict packet, its hash-bound pending draft, and the current corpus. Output must be new; do not overwrite historical evidence. The draft identifies four retained original PBJ artifacts and their hashes. The packager verifies those bytes, packet binding, corpus generation/count/identities, and empty owner-decision fields before producing the package. Filesystem paths remain local; served rows reject local `/mnt/d/` and `/home/` paths. Package generation is deterministic for identical inputs.

This v1 package intentionally represents the current four decision cards: 90 items across seven records, including all 81 PBJ passages. It is not an automatic general-purpose conflict detector. Expanding the card set requires a reviewed successor, not relaxation of its fixed-scope checks.

The independent package verifier emits seven actual named tests for the selected public evidence package. Portable corruption/isolation cases are registered in the normal `tests/*.test.mjs` suite through `tests/scientific-conflicts.test.mjs`. Client runtime-guard cases are included in the normal web suite. Require nonzero passing test results; a successful wrapper exit is not sufficient evidence.

## Local preview configuration

Mount the generated package at `/scientific-conflicts-v1` in the local static assets and set both test-environment bindings:

- `USHSO_SCIENTIFIC_CONFLICTS_REVIEW=enabled`;
- `USHSO_SCIENTIFIC_CONFLICTS_MANIFEST_SHA256` to the actual generated manifest hash.

The GET route is `/api/research/v1/scientific-conflicts`. Required query parameters are `record_id` and `generation`; optional `page` is zero-based, and continuation after page zero requires the exact `manifest_sha256`. Unknown/duplicate query keys fail; no request parameter can enable a disabled route. Do not provision production bindings based on this documentation.

Bounds: manifest 64 KiB, descriptor 256 KiB, page 64 KiB and at most ten items, response 128 KiB. Records are bound to the exact current baseline hash. The shared asset reader enforces streamed byte bounds and cryptographic hashes and exposes actual byte count; the route verifies the declared page byte count as well. Page IDs, total counts, pending flags and rendered field types are checked. A malformed record returns a typed failure while a healthy peer remains available. Missing/stale pins and generations require a restart rather than silent continuation.

The React panel lives in the existing lazy scientific-review component, fetches only on request, retains one bounded page, aborts stale requests, rejects unsuccessful HTTP status and malformed pending states, and renders publisher content as text. Both header and row approval fields must remain pending. The eight public tool schemas are unchanged by this private review route.

## Scientific meaning preserved

- SCI-01 is a documentation-link observation; competing resource titles and dates remain visible, not certified release applicability.
- SCI-02 preserves the depression/bipolar label-definition contradiction without choosing a corrected meaning.
- SCI-03 is one bounded observed numeric-string example, not a universal data type, conversion or threshold rule.
- SCI-06 retains all 81 original passages with unresolved publisher variable identities. Eighty exact-name relationships are candidates only; `CY_QTR`/`CY_Qtr` and `Hrs_Admin_fn` remain explicitly unresolved.

The September 8 regenerated review package retained manifest `2882d2d56d76a2a23123d54e83cec2d71519dc2bbead7cd7841e4bdeab5f858d`. Integrated portable/client tests pass; full combined-Worker and desktop/mobile verification is tracked separately in the task evidence. A package test, preview, or reviewer recommendation is not scientific approval, a complete release gate, or deployment authorization.
