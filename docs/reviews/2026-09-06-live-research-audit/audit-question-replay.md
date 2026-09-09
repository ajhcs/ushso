# Release-candidate replay of the live research audit

Generated: 2026-09-06T20:27:05.298Z

Target: http://127.0.0.1:8794

This replay uses the production-lineage Worker corpus: **3434 published records** (3430 currently searchable; 4 incompatible records isolated), version 1.2.0, generation live-2026-09-03-85b50522b420.

The 143-record evaluation corpus and 157-record predecessor are historical fixtures, not candidate acceptance expectations.

## Outcome

- Original audit questions replayed in this receipt: 42/42.
- Homepage examples replayed in this receipt: 0/0.
- Worker/corpus/ordering/isolation checks: 252 passed, 0 failed.
- Homepage expected leading records: 0/0 passed.
- Relevance remains a reviewer judgment. HTTP 200 or a nonzero count is not proof that a result answers the question.

## Original 42-question diagnostic replay

| # | Question | Matches | Leading result | Leading state | Acceptance |
|---:|---|---:|---|---|---|
| 1 | I need hospital financial and utilization data for Pennsylvania | 3 | Hospital Provider Cost Report | uncertain | diagnostic replay |
| 2 | hospital cost reports | 109 | Hospital Provider Cost Report | supported | diagnostic replay |
| 3 | HCRIS | 1 | Hospital Provider Cost Report | contextual | diagnostic replay |
| 4 | PHC4 | 0 | — | — | diagnostic replay |
| 5 | HCUP | 0 | — | — | diagnostic replay |
| 6 | AHRQ Compendium of US Health Systems | 0 | — | — | diagnostic replay |
| 7 | hospital ownership | 99 | Hospital Change of Ownership - Owner Information | supported | diagnostic replay |
| 8 | Medicaid enrollment by state | 229 | CMS Program Statistics - Medicare-Medicaid Dual Enrollment | contextual | diagnostic replay |
| 9 | rural hospital closures | 0 | — | — | diagnostic replay |
| 10 | hospital readmission rates | 531 | Weekly Hospital Respiratory Admission Levels and Rates by Jurisdiction, National Healthcare Safety Network (NHSN) | contextual | diagnostic replay |
| 11 | Medicare hospital spending 2023 | 158 | Medicare Outpatient Hospitals - by Geography and Service | contextual | diagnostic replay |
| 12 | uninsured adults by county | 629 | Time Series Small Area Health Insurance Estimates | contextual | diagnostic replay |
| 13 | maternal mortality by race | 29 | VSRR Provisional Maternal Death Counts and Rates | supported | diagnostic replay |
| 14 | NHIS | 27 | NHIS Adult Summary Health Statistics | supported | diagnostic replay |
| 15 | MEPS | 0 | — | — | diagnostic replay |
| 16 | BRFSS | 119 | Behavior Risk Factor Surveillance System (BRFSS) Glossary and Methodology | supported | diagnostic replay |
| 17 | Pennsylvania flibbertigibbet qzxwvu | 0 | — | — | diagnostic replay |
| 18 | zzzxxyqq | 0 | — | — | diagnostic replay |
| 19 | hospital | 344 | National Hospital Care Survey (NHCS) linked to Centers for Medicare & Medicaid (CMS) Medicare Data | supported | diagnostic replay |
| 20 | hospital in California | 344 | National Hospital Care Survey (NHCS) linked to Centers for Medicare & Medicaid (CMS) Medicare Data | uncertain | diagnostic replay |
| 21 | hospital in Pennsylvania | 344 | National Hospital Care Survey (NHCS) linked to Centers for Medicare & Medicaid (CMS) Medicare Data | uncertain | diagnostic replay |
| 22 | hospital 2020 | 263 | Deficit Reduction Act Hospital-Acquired Condition Measures | supported | diagnostic replay |
| 23 | hospital 2024 | 266 | Deficit Reduction Act Hospital-Acquired Condition Measures | supported | diagnostic replay |
| 24 | hospital public use data only | 321 | National Hospital Discharge Survey 1970-2010, public-use data | supported | diagnostic replay |
| 25 | Pennsylvania hospital discharge and utilization data | 158 | Medicare Post-Acute Care Utilization - Long-Term Care Hospital by Geography and Provider | contextual | diagnostic replay |
| 26 | Hospital financial and utilization data in California | 3 | Hospital Provider Cost Report | uncertain | diagnostic replay |
| 27 | Hospital quality and workforce data in New York | 540 | Provider Relief Fund COVID-19 Nursing Home Quality Incentive Program | contextual | diagnostic replay |
| 28 | Hospital ownership changes and enrollments in Texas | 99 | Hospital Change of Ownership - Owner Information | contextual | diagnostic replay |
| 29 | Rural hospital classifications and closures in Kansas | 1131 | Provisional Drug Overdose Deaths by Urban/Rural Classification Scheme for 12 month-ending December 2018-December 2020 | contextual | diagnostic replay |
| 30 | hospital public only | 321 | National Hospital Discharge Survey 1970-2010, public-use data | supported | diagnostic replay |
| 31 | hospital free data | 321 | National Hospital Discharge Survey 1970-2010, public-use data | uncertain | diagnostic replay |
| 32 | hospital 1900 | 201 | National Hospital Care Survey (NHCS) linked to Centers for Medicare & Medicaid (CMS) Medicare Data | uncertain | diagnostic replay |
| 33 | hospital 2099 | 201 | National Hospital Care Survey (NHCS) linked to Centers for Medicare & Medicaid (CMS) Medicare Data | uncertain | diagnostic replay |
| 34 | hospital NOT nursing home | 329 | National Hospital Care Survey (NHCS) linked to Centers for Medicare & Medicaid (CMS) Medicare Data | supported | diagnostic replay |
| 35 | hospital excluding nursing homes | 329 | National Hospital Care Survey (NHCS) linked to Centers for Medicare & Medicaid (CMS) Medicare Data | supported | diagnostic replay |
| 36 | hospital readmissions | 540 | National Hospital Care Survey, 2020-2022 public-use data | contextual | diagnostic replay |
| 37 | maternal mortality | 29 | VSRR Provisional Maternal Death Counts and Rates | supported | diagnostic replay |
| 38 | pregnancy related mortality | 29 | VSRR Provisional Maternal Death Counts and Rates | supported | diagnostic replay |
| 39 | hospital finance | 109 | Hospital Provider Cost Report | contextual | diagnostic replay |
| 40 | hospital financials | 109 | Hospital Provider Cost Report | supported | diagnostic replay |
| 41 | CMS Hospital Readmissions Reduction Program | 540 | National Hospital Care Survey (NHCS) linked to Centers for Medicare & Medicaid (CMS) Medicaid Data | contextual | diagnostic replay |
| 42 | health insurance small area estimates | 860 | Time Series Small Area Health Insurance Estimates | supported | diagnostic replay |

## Homepage example acceptance replay

| # | Question | Matches | Leading result | Leading state | Expected production leader |
|---:|---|---:|---|---|---|


The JSON companion preserves interpreted constraints, five ordered records, section counts, named-source resolution, partial-result state, and every automated check.
