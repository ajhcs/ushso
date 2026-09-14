# PR-005 correction review

Head afb90565456a429e73527f2bb99daf9cf174aa3c, tree bf49d34160b37c79a5948bc32199c24c2c92f24a. Root Astra independently reviewed the correction diff and replayed decisive behavior on a clean isolated worktree. Grok interface model: grok-4.

The corrected search, both browse forms and detail path share the request clock and freshness projection. Ordinary caller Date headers no longer set the clock. Frozen direct retrieval retains its deterministic legacy result. Unknown observations do not become successful checks; explicit null attempt dates stay null through the adapter and rendered card/detail helper. Only supported source-asserted or first-party grain states become Typical unit/Grain, and inferred or unavailable values remain qualified. Payload check presentation uses its typed state. Source fixture hashes and candidate source bytes remained unchanged during replay.

All ten independent semantic cases pass with no probe errors. Required focused freshness/WP1 tests pass; web tests pass (162); retrieval tests pass (105); handoff shape validation passes in the producer's original dependency context. The full worker command exits 1 with 342 passing and four failing tests, all in tests/wp11-attestation.test.mjs. Three fail on the first changed historical ResultCard.test.ts input; the real WP11 aggregate test propagates that adapter failure. Strict direct successor and routing negatives still pass.

Disposition: functional corrections reviewed; integration acceptance blocked on PR-086 and the independently gated real combined candidate. This review is not full frontend qualification, actual participant testing, current-subject approval or release qualification. UI evidence here is actual React server rendering and detail helpers, not a browser session. PR-005's earlier logical base/dependency packet is preserved; the newly declared PR-086 dependency governs later integration acceptance.

No historical input pin, approval, receipt, frozen cohort or deployed artifact was changed to make this review pass. The earlier failures remain retained. PR-005 remains a draft and unaccepted.
