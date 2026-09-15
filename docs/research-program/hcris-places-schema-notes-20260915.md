# HCRIS CCN/PROVNUM and PLACES year — local evidence only

No additional publisher requests. Original HCRIS failed attempt preserved.

## HCRIS: Provider CCN vs PROVNUM

Frozen painted dictionary `scripts/research/fixtures/cms-cost-grid/hospital.json` (pages 1–2) contains:

- Variable name span **Provider CCN**
- Worksheet S2 Part1 Line 3 Column 2
- Definition spans **CMS Certification Number (CCN).**

There is **no** `PROVNUM` span in that hospital cost-report dictionary extract.

`PROVNUM` **does** appear in the **PBJ** (Payroll Based Journal Daily Non-Nurse Staffing) dictionary as “Medicare provider number”. That is a different CMS product. Using PBJ `PROVNUM` as the HCRIS hospital JSON identity was a product-definition error.

Live captured CMS API row 0 (gitignored capture sha256 `efb538d31b8d51bf8443b12b617271617afd2f73bf379ed53c0e8bdad2eba08f`) has keys including `Provider CCN`, `Fiscal Year End Date`, `Hospital Name`, and does **not** have `PROVNUM`. Example value `Provider CCN` = `110130`.

### Applied product-definition correction

Amendment `HCRIS-IDENTITY-PROVIDER-CCN-20260915` in `verification/research-program/evidence/product-sample-requirements.json` now requires live/file sample rows to expose **`Provider CCN`**, not `PROVNUM`.

This correction:

- uses retained dictionary + captured bytes
- does **not** rewrite the original failed live attempt on SHA `2efafed` (that attempt remains identity-failed under the then-required `PROVNUM` field)
- does **not** count as a new retrieval
- does **not** verify the catalog release (`FY_END_DT` / Fiscal Year End Date remains unresolved)

VariableBrowser for this record now labels the bound field `Provider CCN` and states that `PROVNUM` is a PBJ staffing field.

**Fiscal Year End Date:** dictionary spans “Fiscal Year End Date” as S2 worksheet element. That is a reporting-period date, not proof that the catalog distribution is `CostReport_2023_Final`. Release check stays unresolved.

## PLACES year vs catalog release

Frozen cohort text: “Annual PLACES releases and county/tract/ZCTA/GIS-friendly files are releases or distribution formats of this one product. Representative evidence is the 2025 county table.” Frozen native id is `swc5-untb`.

Live captured rows (sha256 `d67b34efce9a129cd4d79dc56b05961c2741f41807d6dd54b154c905179ca6f4`) include `year`, `stateabbr`, `locationname`, `measure`. Those `year` values are observation attributes on the row, not a catalog-release identifier.

Frozen local documentation does **not** state whether `year` is measurement year, publication year, or another concept, or that `year=2025` proves the representative 2025 county table. Release check stays unresolved. Identity on `stateabbr` can pass while contributing **zero** qualified R04 samples.

## Missing publisher documentation

To close HCRIS **release**: a first-party CMS statement that Fiscal Year End Date, or another captured field, identifies catalog distribution `CostReport_2023_Final`. Not present.

To close PLACES release: a first-party PLACES data dictionary for `swc5-untb` that defines `year` relative to the 2025 county-table release. Not present in the frozen corpus.
