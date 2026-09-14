# Join evidence

Policy version: `ushso.join-evidence.v1`.

At least fifteen intended joins have inspectable compatibility evidence. Fixtures record input counts, eligible key counts, uniqueness, nulls, mapping multiplicity, and expected outputs, including one valid and one incompatible temporal/universe case.

Fixtures detect row multiplication, leading-zero loss, and unmatched rows rather than treating successful SQL as enough. Scoped linkage metrics separate sampled checks from full-release checks. No route reports a universal match rate from a tiny sample. Incompatible contexts remain blocked.

Machine and UI consumers receive identical compatibility and limits. HCRIS-to-NPPES cannot claim CCN=NPI. R08 remains incomplete if fewer than fifteen routes are qualified.

Sealed `packages/identity/src/join-routes.mjs` is not edited by this implementation.
