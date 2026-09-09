# Historical pilot results — 2026-09-07

The pilot observations below are preserved as history. Current collection, dictionary proposals, actual Astra/WebMCP testing, latency and dependency status are in [the expansion review](EXPANSION-20260907.md). The earlier Muse run below is not fresh Muse review of the expanded packet.

This candidate adds a repeatable publisher-evidence collection and review workflow, an eight-tool MCP plugin/skill sharing the WebMCP HTTP client, and operator/private-contact copy. It is not deployed or release-approved. No historical approval receipt was regenerated.

## Evidence

- Inventory: 3,434 records, 3,234 with an allowlisted exact metadata locator; 200 need source-specific locator work.
- Pilot: eight metadata requests, four successful captures. Failed outcomes retained.
- Muse through DSH: seven quoted proposals; subsequent deterministic/semantic screening retained six pending proposals and rejected reporting frequency misclassified as observation grain. Original output is preserved.
- Deterministic extraction from retained publisher metadata: three candidate dictionaries, 67 columns. These are publisher-view metadata, not verified payload schemas; exact release binding remains unresolved.
- New tests: four passed, including all eight MCP-to-Worker operations over the full corpus, generation errors, disabled planner, capture restrictions and dictionary identity binding.
- Existing retrieval tests: 103 passed. Web tests: 124 passed. Worker tests: 52 passed before the final dictionary-only addition; that addition's dedicated test passed separately. Build and Cloudflare dry-run passed before that offline-only addition.
- Plugin ingestion validation passed. Native Astra installation/invocation is not yet qualified; browser WebMCP behavior was not requalified in this turn.
- Email: Cloudflare rule enabled to the owner-confirmed destination, destination verified, routing ready, public 1.1.1.1 resolver returned all three Cloudflare MX records. End-to-end mail delivery was not tested.

Retained working evidence: `/mnt/d/tmp/plumbob/ushso-research-automation-20260907/` (`verification.log`, `final-tests.log`, `email-routing-receipt.json`, `rechecked/source-review.json`). Initial captures and model output remain under `evidence/2026-09-07T00-30-00-840Z/`. The rechecked packet corrects the initial manifest-hash-as-generation label using the current catalog publication generation; original artifacts are not overwritten.

## Remaining implementation and approval work

The pipeline stages evidence; it does not yet automatically produce a versioned catalog successor. Extend source-specific dictionary/metadata extraction beyond the CDC pilot, add exact release binding and reproducible identity/join checks, and review the full resulting completeness distribution. The owner must approve proposed scientific facts before promotion. No recurring service was installed. Native Astra plugin and browser model-driven tests remain necessary. Existing latency prototype remains separate from this candidate; no new API latency claim is made here. The Ajv exception remains unaccepted and no dependency upgrade was performed in this change.

Public website wording is prepared but is not live. The final owner must review this changed candidate and its own release evidence; the prior candidate's passing gate does not cover these edits.
# Historical pilot results

The measurements and pending work below belong to the initial pilot. They are superseded by [the current implementation-plan review](IMPLEMENTATION-PLAN-20260907.md), not current acceptance expectations.
