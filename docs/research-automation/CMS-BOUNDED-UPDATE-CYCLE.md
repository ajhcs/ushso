# Bounded CMS dictionary update cycle (review only)

This specialized companion to `BOUNDED-UPDATE-CYCLE.md` consumes retained public
dictionary captures. It does not fetch payloads, approve science, or deploy.

```sh
/home/plumbob/bin/with-dev-storage env USHSO_RESEARCH_PYTHON=/absolute/qualified/venv/bin/python node scripts/research/cms-update-cycle.mjs PLAN_JSON NEW_OUTPUT_DIRECTORY ABSOLUTE_RESEARCH_MODULE_DIRECTORY
```

The version-1 plan uses `format: "ushso.cms-update.v1"`, a corpus generation,
`scientific_approval: false`, `publication_authorized: false`, and the following
explicit identities. All file references are absolute and SHA-256 pinned.

- `orchestrator_sha256`: hash of this command's source.
- `parser_files`: the complete `.mjs`/`.py` inventory of the module directory,
  each `{file, sha256}`. Adding, removing, or changing a parser invalidates resume.
- `corpus_manifest`, `corpus_files`: exact production corpus manifest and shards.
- `retained_inputs`: captured dictionaries, source records, and proposal inputs.
- `baseline_spec`: complete existing composition specification, and
  `baseline_directory`: its fully verified package. Source values and the entire
  reference graph are rechecked, including oversized fields and issue artifacts.
- `evidence_root`: retained first-party evidence root used by existing adapters.
- `jobs`: explicit replacement groups, each with `family` (`grid`, `structured`,
  `legacy`, or `derived`), `record_ids`, pinned `inputs`, pinned `adapter_input`,
  and exact `expected_fields` entries using the composition-spec format.
  Legacy/derived inputs contain the existing adapter's `inputs` array;
  grid/structured inputs are their existing captured manifest format.

Existing adapters perform actual corpus/resource/source-document binding and
qualified parser replay. The orchestration does not bypass or infer these
bindings. Expected fields come from separately reviewable proposals; changing
an expected definition requires a new hash and a new plan, never approval
inheritance. The adapter output is compared against those exact field values.

The output includes the immutable plan, each attempted family package, explicit
family outcomes, the full composition specification, the complete successor
package, a field-level semantic diff, and a before/after receipt. The diff keys
records by exact record ID and fields by exact case-sensitive name. Each change
contains literal `before`/`after` objects, preserving nulls; additions/removals
are explicit. Unchanged source hash/pointer pairs are skipped. Changed source
pairs are compared by parsed values, not merely file hashes or field counts.
Diff pages contain at most 50 changes and 64 KiB. Oversized individual changes
use hash-bound base64 fragments that reconstruct the original UTF-8 JSON.
Limits are 100,000 changed fields, 64 MiB total diff artifacts, and an 8 MiB
manifest; exceeding a limit fails explicitly without a completion receipt.
The receipt/completion hashes bind the diff manifest, and resume recomputes the
diff and verifies every artifact against the qualified before/after source values.
Repeating the exact command on a completed
directory rechecks identities and closure and returns the same package. A changed
source or parser refuses resume. An interrupted directory is retained; use a new
output directory rather than overwriting it. This version does not resume midway
through an adapter; the existing large-PDF window collector has its own exact-hash
checkpoint mechanism.

Completion records bind the plan, receipt bytes, and composition bytes by hash.
Resume also recomputes the complete graph and compares every returned closure
count/hash against the stored receipt, validates review-only flags, and matches
outcome identities to planned jobs. These local checks are not signed owner
attestations and do not protect against an actor rewriting every local artifact.
Duplicate record IDs within or across jobs are rejected before output creation.
The corpus manifest and shards are checked again before completion.

Historical plans retain their deliberately conservative policy: a replacement group must
match an entire existing package group. A partial family output stays available
for review but is not advertised in the final graph; the whole previously
verified baseline group remains. Thus healthy baseline peers are preserved, but
new healthy rows from a partially failed group are not yet adopted automatically.
For finer isolation, set `partial_policy: "record_isolation"` on an explicit job.
Every successful adapter record must belong to that job and match its exact
`expected_fields`. A successful subset replaces only those exact IDs. The source
baseline is verified in full, then partitioned without rewriting descriptor,
page, issue, context or supplement bytes. Failed peers retain their old descriptor
and source expectations. The final composition rechecks every source value.
The outcome reports `qualified_partial_review_only`, `qualified_record_ids` and
`unresolved_record_ids`; resume checks that partition against actual adapter output.
Unknown policies, extra/duplicate adapter IDs and missing successful expectations
are rejected. Historical plans never silently opt into this new behavior.

This mode requires an adapter that emits a valid partial manifest. A thrown
family-level exception still retains the entire baseline group. In particular,
use independently scoped derived/legacy jobs when one source must be retried
without blocking another. Capture-to-qualified plan construction remains separate
engineering; this option does not infer missing release/source bindings.

Bounds: 159 jobs, 10,000 declared retained files, 64 MiB per file, 2 MiB corpus
manifest, 8 MiB composition specification; adapters retain their stricter page,
CPU, memory, subprocess, and source limits. Jobs run sequentially. The command
does not supply a new aggregate elapsed-time guarantee for 159 expensive jobs.

Normal tests import `cms-update-cycle.test.mjs`. Eleven named tests check exact
unchanged resume, same-filename changed-definition invalidation, failed-family
preservation, receipt/composition tampering, recomputed closure and approval
boundaries even after checksum rewriting, duplicate IDs, and a new pinned plan
that produces a changed field while preserving the historical baseline, plus
same-package healthy/failed record isolation, partial-outcome identity tampering,
and historical whole-group behavior. Seventeen graph tests include exact subset
reconstruction, issues/oversized fragments, duplicate/missing selections, empty
graphs, corruption of unselected content, deterministic bytes and overwrite refusal.
These are synthetic orchestration tests, not a substitute for publisher replay.
The retained CMS qualification separately replays the clinical and MCBS derived
adapters against public PDFs and composes all four CMS package families: 37
records, 6,118 ordinary entries, 239 pages, and 1,672 unowned context lines.
MCBS's 189 parser issues remain linked. PBJ's 81 unknown-identity terms, QIES's
contextual entries, and the 45 historical rejected entries remain excluded from
ordinary-variable composition. Capturing every PDF page does not mean extracting
every variable definition. No scientific or deployment approval is requested here.
