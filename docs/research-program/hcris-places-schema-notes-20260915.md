# HCRIS CCN/PROVNUM and PLACES year — local evidence only

No additional publisher requests. Original HCRIS failed attempt preserved.

## HCRIS: Provider CCN vs PROVNUM

Frozen painted dictionary `scripts/research/fixtures/cms-cost-grid/hospital.json` (pages 1–2) contains:

- Variable name span **Provider CCN**
- Worksheet S2 Part1 Line 3 Column 2
- Definition spans **CMS Certification Number (CCN).**

There is **no** `PROVNUM` span in that dictionary extract.

Live captured CMS API row 0 (gitignored capture sha256 `efb538d3…`) has keys including `Provider CCN`, `Fiscal Year End Date`, `Hospital Name`, and does **not** have `PROVNUM`. Example value `Provider CCN` = `110130`.

**Proposed mapping (not applied, not counted as a sample):** live API `Provider CCN` is the same CMS Certification Number described by the frozen dictionary variable “Provider CCN”. `PROVNUM` is **not** evidenced in the frozen dictionary or the live row as an alias. A later product-definition amendment could replace required field `PROVNUM` with `Provider CCN` after named review of that dictionary+API pair. This note does not perform that amendment. The failed HCRIS attempt remains identity-failed.

**Fiscal Year End Date:** dictionary spans “Fiscal Year End Date” as S2 worksheet element. That is a reporting-period date, not proof that the catalog distribution is `CostReport_2023_Final`. Release check stays unresolved.

## PLACES year vs catalog release

Frozen cohort text: “Annual PLACES releases and county/tract/ZCTA/GIS-friendly files are releases or distribution formats of this one product. Representative evidence is the 2025 county table.” Frozen native id is `swc5-untb`.

Live captured rows (sha256 `d67b34ef…`) include `year`, `stateabbr`, `locationname`, `measure`. Observed `year` values on the five-row sample must be read from the gitignored capture; they are observation attributes on the row, not a catalog-release identifier.

Frozen local documentation does **not** state whether `year` is measurement year, publication year, or another concept, or that `year=2025` proves the representative 2025 county table. Release check stays unresolved. Identity on `stateabbr` can pass while contributing **zero** qualified R04 samples.

## Missing publisher documentation

To close HCRIS identity: a first-party CMS field list for dataset UUID `44060663-47d8-4ced-a115-b53b4c270acb` that names `Provider CCN` / `PROVNUM` together, or an explicit alias. The local dictionary names only Provider CCN.

To close PLACES release: a first-party PLACES data dictionary for `swc5-untb` that defines `year` relative to the 2025 county-table release. Not present in the frozen corpus.
