# Release-candidate replay of the live research audit

Generated: 2026-09-06T20:27:07.858Z

Target: http://127.0.0.1:8794

This replay uses the production-lineage Worker corpus: **3434 published records** (3430 currently searchable; 4 incompatible records isolated), version 1.2.0, generation live-2026-09-03-85b50522b420.

The 143-record evaluation corpus and 157-record predecessor are historical fixtures, not candidate acceptance expectations.

## Outcome

- Original audit questions replayed in this receipt: 0/0.
- Homepage examples replayed in this receipt: 5/5.
- Worker/corpus/ordering/isolation checks: 35 passed, 0 failed.
- Homepage expected leading records: 5/5 passed.
- Relevance remains a reviewer judgment. HTTP 200 or a nonzero count is not proof that a result answers the question.

## Original 42-question diagnostic replay

| # | Question | Matches | Leading result | Leading state | Acceptance |
|---:|---|---:|---|---|---|


## Homepage example acceptance replay

| # | Question | Matches | Leading result | Leading state | Expected production leader |
|---:|---|---:|---|---|---|
| 1 | CMS HCRIS hospital cost reports by state | 1 | Hospital Provider Cost Report | contextual | pass |
| 2 | CDC maternal mortality data | 29 | VSRR Provisional Maternal Death Counts and Rates | contextual | pass |
| 3 | What CMS sources describe hospital ownership in Pennsylvania? | 99 | Hospital Change of Ownership - Owner Information | contextual | pass |
| 4 | Public-use hospital utilization data | 149 | National Hospital Ambulatory Medical Care Survey, Public-use data 1992-2022 | supported | pass |
| 5 | CMS Medicare inpatient hospital utilization | 62 | CMS Program Statistics - Medicare Inpatient Hospital | supported | pass |

The JSON companion preserves interpreted constraints, five ordered records, section counts, named-source resolution, partial-result state, and every automated check.
