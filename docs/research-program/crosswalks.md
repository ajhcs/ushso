# Crosswalks

Policy version: `ushso.crosswalks.v1`.

Priority CCN/NPI/facility and geographic-vintage crosswalks store publisher, release, rights, and exact download/access route. Each route’s intended entity and key system must match the research task. Absence of a crosswalk is explicit.

One-to-many mappings, unmatched keys, and date scope are preserved. Source-native IDs are kept without heuristic identity merging. A many-to-many or ambiguous mapping cannot collapse to one preferred row silently.

Candidate routes remain candidate until scoped validation and review are complete. Mapping files are data products with their own versions. A shared field name alone cannot produce a route.

Sealed `packages/identity/src/family-graph.mjs` and `packages/identity/src/join-routes.mjs` are not edited by this implementation.
