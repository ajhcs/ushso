# Complete dictionary package verification

The portable CLI requires a hash-bound input specification and exact expected field sources. It does not offer a source-comparison bypass. The lower-level graph verifier can intentionally run graph-only diagnostics; that is not equivalent to source-value qualification.

```sh
/home/plumbob/bin/with-dev-storage node scripts/research/compose-dictionary-review.mjs INPUT_SPEC NEW_OUTPUT
/home/plumbob/bin/with-dev-storage node scripts/research/compose-dictionary-review.mjs INPUT_SPEC EXISTING_OUTPUT --verify-only
/home/plumbob/bin/with-dev-storage env -u NODE_TEST_CONTEXT node scripts/research/dictionary-package-closure.test.mjs
```

Input format `ushso.dictionary-composition-inputs.v1` declares generation, `publication_authorized:false`, packages with manifest hashes, and one `expected_fields` entry per exact record ID: source JSON file, SHA256, JSON pointer to the field array, and optional `add_review_context:true`. Context adds review provenance only. JSON serialization removes undefined optional properties; it never replaces null descriptions or changes literal field values. The caller must prepare this specification from qualified source evidence, not derive it from the output under test.

Historical input packages may have unsorted record lists. Composition explicitly validates those original inputs with record sorting disabled, preserves their field order, rejects all record overlaps, and writes sorted output. Default output verification enforces lexicographic record order, unique names and source field order. Output refuses an existing directory. A failed composition may leave partial files but never emits a successful manifest; preserve that first failure or clean only its task-owned output under the host workflow.

Current retained specification: `review/complete-dictionary-closure-v1/composition-inputs.json` in the research evidence root. Its four inputs cover CDC 1,126 records, Census 1,738 records and CMS 35 records. The 45 rejected historical CMS entries remain excluded; PBJ's 81 unresolved passages remain separate. No scientific approval is inferred.

Complete output v2 and independent rebuild v3 have identical 40,718-file sets and identical file hashes: 1,279,473,095 bytes total. Manifest hash `a6dd627a306393dc942012b5b6e81fbb0d44dd3909937de8bfa43be64993b153`. All 2,899 records, 1,573,137 fields, 34,026 logical pages, 348 oversized fields and 4,553 fragments passed source-value reconstruction. There are 1,672 retained unowned context lines. Maximum page size is 65,535 bytes. These counts describe this immutable input set, not future acceptance constants.

The package is a local review artifact. Cloudflare storage/deployment limits, complete Worker API traversal, browser qualification, scientific approval and release approval remain separate.
