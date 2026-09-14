# Machine-toolkit v1.1 response migration

Policy: old clients receive supported compatibility or a typed version error, not a silently different response shape.

- Input contracts remain `observatory-machine-toolkit.v1.0.0`.
- Current responses use `observatory-machine-toolkit.v1.1.0`.
- Strict v1.0 response consumers must reject v1.1 envelopes with a typed version error. They must not coerce the v1.1 quota/unknown shape into v1.0.
- A successful tool envelope is not a completed research task. Protocol success and scientific-result states remain separate.
- `plan_research` remains disabled until its own acceptance is met.
