# Tester feedback provenance and reconciliation v1.0.0

This package preserves the exact bytes of the two tester-feedback attachments
used to author the research-navigator implementation plan. The source files are
immutable evidence; corrections require a versioned successor package.

- `tester-feedback-a.txt` is byte-identical to attachment
  `757b8a95-753c-4e28-8a4e-96fa2b30bfd0`.
- `tester-feedback-b.txt` is byte-identical to attachment
  `7203ea9b-03f0-447d-840a-fbdd96f91041`.
- `manifest.json` pins source hashes, byte counts, line counts, and logical
  paragraph counts.
- `reconciliation.json` maps every logical paragraph to an accepted requirement
  topic, owner, acceptance test, and receipt target.

Feedback A contains two physical paragraphs. Its second physical paragraph
contains seven distinct topical recommendations, so A2–A8 use unique ordered
start markers to preserve the source's exact formatting while documenting the
finer semantic reconciliation. Feedback B contains 154 blank-line-delimited
logical paragraphs grouped into the thirteen topical ranges B1–B13. Code and
example blocks stay attached to the topic they support; none is discarded as
non-requirement text.

Validate with:

```bash
npm test --prefix docs/feedback/v1.0.0
npm run validate --prefix docs/feedback/v1.0.0
```
