# Contributing

Contributions should preserve the Observatory's evidence boundary:

1. Keep source-native objects, assertions, access observations, evidence, relationships, and search projections distinct.
2. Add a small offline fixture before changing retrieval behavior.
3. Cite an authoritative locator and preserve evidence state, limitations, and verification date for every source claim.
4. Do not infer identity equality from a shared title, publisher, URL family, or organization name.
5. Do not turn an access failure, infrastructure failure, unresolved record, or zero-result query into `not_found`.
6. Never add secrets, source payloads, controlled data, or protected health information.

Run `npm test`, `npm run build`, and `npm run cf:dry-run` before proposing a change.
