# Grain and time

Policy version: `ushso.grain-and-time.v1`.

Observation grain, sampled entity, reporting organization, universe, and geographic dimension are separate evidenced fields. Undocumented dimensions are explicitly unknown. Inferred topic tags cannot substitute for grain.

HCRIS facility/report/year and PLACES county/measure/year cannot collapse into a generic hospital or person tag.

Date roles bind only from captured statements: collection period, fiscal year, calendar year, release, revision, projection horizon, observation end, and metadata-modified. A metadata-modified date cannot fill observation end. A projection to 2100 is not observed future data. Overlapping ACS periods and rolling releases are preserved.

Incompatible reporting periods yield a specific `INCOMPATIBLE_REPORTING_PERIODS` caution/blocker. There is no automatic fiscal-to-calendar equivalence. Source-native terms remain visible alongside normalized fields.

Sealed `packages/identity/src` and `packages/normalization/src` are not edited by this implementation.
