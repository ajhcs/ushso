# PR-004 R2 semantic correction evidence

This directory records the second correction pass for PR-004. The normalization history expander now compares a revision’s canonical payload independently of its ancestry container, merges equivalent flat and nested representations, and raises `field_observation_revision_conflict` for divergent content. The focused regression covers a three-revision chain supplied as both `[a, b, c]` and nested history, plus a conflicting nested value.

`index.json` binds the read-only controller fixture, the independent review receipt, the agentctl command IDs/timestamps, and the unchanged 49,808,256-byte compact artifact. The lifecycle receipt is captured before the final handoff/finish events; the final receipt is reported separately by the producer.
