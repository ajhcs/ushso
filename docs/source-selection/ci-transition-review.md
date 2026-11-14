# Candidate CI transition self-review

Author review of the actual source-selection transition diff, 2026-11-14. This is not independent review, historical approval, source-rights acceptance or release authorization.

The root test chain remains byte-for-byte the existing command sequence. New source-selection suites enter through `tests/source-selection-program.test.mjs` under the existing worker test gate. The root package adds pinned Playwright 1.56.1, source-selection staging and prerendering after the web build. CI retains the Node 22.15 compatibility lane and build/dry-run lane, and adds local Worker and browser checks. The transition manifest pins the exact package, lockfile and CI bytes as a single pending candidate.

The candidate helper checks those pins, preserved legacy script commands, the specific build extension, unchanged package identity/workspace fields, lock-root dependency/workspace agreement and presence of required CI commands. Workspace-lock validation remains in the existing inventory verifier. The current evidence builders include the helper and transition artifacts in their newly computed pending subjects.

Historical PR-003 package, historical workflow and PR087 lock fixtures retain the original bytes. Existing approval/receipt hashes remain unchanged. Historical mutation and partial-transition tests operate against the retained fixtures. The current candidate is reported as `source_selection_candidate_pending_review`; its root package and lock are not represented as previously reviewed PR087 inputs.

The focused verification run covered temporary storage, the candidate transition, contract inventory, CI attestation and WP11 attestation: 47 tests passed. The candidate tests reject alteration of each pinned input and a partial historical/current package combination. The broader integrated test and deployment results must be read from the parent integration receipts; this document does not substitute for them.

Limits found in self-review:

- The manifest is producer-controlled review material. Exact hashes bind bytes; they are not a signature or an independently issued approval. A reviewed change to both implementation and manifest still requires substantive review.
- CI semantic checks use bounded assertions and text matching, not a complete YAML control-flow or security analysis. Pinning the full workflow prevents silent drift under the current manifest, but a later transition still needs inspection of actions, permissions, shell commands and network behavior.
- Merely finding a CI command does not prove that GitHub ran it or that a final commit passed. Local tests, actual hosted CI conclusions and release authorization remain separate.
- Historical proof validation does not transfer historical approval to current code. The current wrapper policy only extends implementation bindings and states a pending candidate disposition.
- Structural package/lock checks are not a dependency security audit or a publisher-rights decision. The accepted-publication rights gate remains independent.

No independent approval, release qualification or production permission was generated. Any change to a pinned root input requires a new explicit candidate disposition and revalidation; old historical receipt bytes must remain preserved.
