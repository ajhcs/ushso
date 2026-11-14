# Evaluation inputs

No frozen 30-case cohort or independent observations are supplied in this directory. Construct and freeze the actual cohort before drafting; record exact capture identifiers, byte hashes, rights policies and case identities in the private study package. Prepare the separately held baseline, assisted and label files after independent review. Do not substitute hypothetical source descriptions, time measurements or labels. See `evaluate` in `packages/source-selection-ai/index.mjs` for the required schema and [AI engineering](../ai-engineering.md) for the comparison and independence requirements.

The deliberately disabled configuration can be checked without a credential or provider request:

```sh
node scripts/source-selection-ai/cli.mjs dry-run /workspace/repos/builderbob/ushso-implementation/docs/source-selection/ai-templates/disabled.json
```

The CLI requires its input file and any capture, rights and state paths to reside on the same filesystem as `/workspace`. Adapt the absolute checkout path if this repository is elsewhere on that filesystem.

`cohort.proposed.json` is a prospective worklist of 30 extraction tasks across eight candidate source families, not 30 independent sources or verified cases. Before freezing, independently identify and verify each eligible capture and rights record, complete all null fields, review the source/task assignment and critical-error expectations, and set the status, reviewer, revision and freeze time. The baseline, assisted and label templates contain no observations and are deliberately rejected by evaluation until completed and pinned to the frozen cohort digest. Their names do not establish reviewer independence.

The proposed execution limits are in `execution.template.json`: disabled and
unvetted, with a USD20 total/monthly ceiling, USD1 job cap, 32,000 input-token
ceiling, 2,048 output-token ceiling and at most one retry. These are unsigned
budget proposals. Recheck provider pricing and complete account/input/retention
approval before changing the two disabled controls in a private copy.

Use `rights.template.json` for the specific capture's independent current rights
file. Its SHA-256 is of the exact file bytes; the config binding is SHA-256 of
`JSON.stringify(config)`, preserving JSON property order. Keep the rights file
outside the budget directory and replace it when permissions change.

After actual account/budget/input approval, create a private existing budget
directory and set its absolute path and a unique ledger identity in the execution
input. Run `cli.mjs init execution.json` once; it makes no provider request.
Then run `cli.mjs dry-run execution.json` and
`node scripts/source-selection-ai/prepare-job.mjs execution.json unsigned-job.json`.
The latter produces the exact hashes and maximum reservation but leaves all human
approval fields null. A reviewer fills the actual approval fields and places the
`approval` object into the execution input. Only `cli.mjs execute execution.json`
can send a request, and it also requires the credential in the named environment
variable. Do not paste keys into JSON, source code, chat or review records.

`cli.mjs status execution.json` reports the shared ledger, and
`cli.mjs shutdown execution.json` durably blocks further dispatch. Neither
resets an uncertain charge. All jobs for this budget must use that same initialized
directory and identity. The runner refuses a copied approval in a different
budget directory. Returned drafts go to the operator's private output; the CLI
has no path into source acceptance or publication.
