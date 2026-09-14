# Identifier systems

Policy version: `ushso.identifier-systems.v1`.

CCN, NPI, FIPS/GEOID, source report IDs, tax identifiers, and plan identifiers keep source-specific formatting, entity role, and leading zeros. CCN and NPI are never interchangeable. Equal strings from different systems do not establish identity.

Candidate, composite, foreign-key, and display-label roles require documentation or scoped sample evidence. Observed uniqueness is not full-release uniqueness. Composite facility/report/year keys remain composite.

An identifier match outside its applicability period is ambiguous or incompatible, not exact. No automatic name-based merge is added. All key checks report sampled versus full-release evidence scope.

Sealed `packages/identity/src/exact-identifier-policy.mjs` and `packages/identity/src/schema-catalog.mjs` are not edited by this implementation.
