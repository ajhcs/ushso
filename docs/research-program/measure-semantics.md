# Measure semantics

Policy version: `ushso.measure-semantics.v1`.

Numerator, denominator/universe, scale/unit, adjustment, weight, confidence interval/MOE, suppression, and missingness are separately evidenced fields. A rate, count, percentage, and monetary total cannot share a unit merely because their labels look similar.

HCRIS net patient revenue remains a monetary total. CDC PLACES adult obesity prevalence remains a percentage with an evidenced adult-population denominator. Maternal mortality and infant mortality are explicit non-equivalences. Crude and age-adjusted rates are explicit non-equivalences. Overlapping ACS 5-year estimates are explicit non-equivalences.

Optional unknowns are preserved. A research-ready badge is blocked when an essential denominator or unit is missing, including when an API is otherwise executable. No cross-drug, cross-year, or cross-population conversion is inferred without evidence. Scientific cautions are specific to the selected measure.

Sealed `packages/identity/schemas/researcher-use-card.schema.json` and `packages/normalization/src` are not edited by this implementation.
