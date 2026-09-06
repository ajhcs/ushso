# Release-candidate example search validation

Validated through the local production Worker on 2026-09-06 against catalog generation `85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e`.

| Displayed question | Leading useful production record | Why it helps |
| --- | --- | --- |
| CMS HCRIS hospital cost reports by state | `…dataset-44060…` — Hospital Provider Cost Report | Direct CMS cost-report metadata and access route. State analytic suitability still requires field and geography review. |
| CDC maternal mortality data | `…e2d5-ggg7…` — VSRR Provisional Maternal Death Counts and Rates | Directly names the requested outcome and publisher. |
| What CMS sources describe hospital ownership in Pennsylvania? | `…dataset-60625…` — Hospital Change of Ownership - Owner Information | Direct ownership product; the UI labels Pennsylvania compatibility as unknown rather than inferring state coverage. |
| Public hospital utilization data | `…tqpr-vcrm…` — National Hospital Ambulatory Medical Care Survey, Public-use data 1992–2022 | Direct public-use hospital utilization route. |
| CMS Medicare inpatient hospital utilization | `…dataset-1e1be…` — CMS Program Statistics - Medicare Inpatient Hospital | Direct CMS inpatient utilization/statistics product. |

The validation checks usefulness and qualification, not merely a nonzero result count. All examples use stable production record identifiers from the release candidate.
