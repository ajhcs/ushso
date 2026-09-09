# Remediation source evidence

Observed on 2026-09-06. These entries are publisher locators reviewed during
remediation of F05, F06, F12, and F13. They are not immutable page captures and
must not be presented as preserved excerpts or tested dataset downloads.

## CMS Hospital Provider Cost Report

- Publisher dataset page: <https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report>
- Publisher methodology: <https://data.cms.gov/sites/default/files/2024-10/aba118b3-4f1f-45a4-8c61-b392d96b1b12/Hospital%20Provider%20Cost%20Report%20Methodology_2024_508%20Approved.pdf>
- Publisher data dictionary: <https://data.cms.gov/sites/default/files/2024-03/9756088d-5280-4090-80b9-449d31ef25a3/Cost%20Report%20Data%20Dictionary%20Update.pdf>
- Supported claims: CMS labels the product a free public-use file, reports an
  annual update frequency, and provides download and API routes. The product is
  a selected-measure extract from annual hospital cost reports maintained in
  HCRIS. The methodology identifies the aggregation level as hospital. It is
  therefore not accurate to describe this product as every raw HCRIS field or
  as claim-level data.
- Availability testing: not performed by this review.
- Evidence state: publisher locator reviewed; no immutable excerpt captured.

## CDC VEHSS use of NHIS

- Publisher documentation: <https://www.cdc.gov/vision-health-data/data-sources/national-health-interview-survey.html>
- Supported claims: the VEHSS product exposes NHIS-derived summary data. Its
  documentation describes prevalence estimates made from NHIS public-use files
  and states that estimates are suppressed where applicable under NCHS data
  presentation standards. The displayed VEHSS product must not be represented
  as respondent-level NHIS microdata.
- Availability testing: not performed by this review.
- Evidence state: publisher locator reviewed; no immutable excerpt captured.

## Named-source discovery registry

These official discovery routes support an explicit coverage-gap response when
the requested source itself is not present in the published USHSO generation.
A derivative product that merely mentions one of these sources is not a
substitute for the source.

| Source entity | Official discovery route | Access qualification |
| --- | --- | --- |
| HCUP | <https://hcup-us.ahrq.gov/databases.jsp> | HCUP includes multiple database products with product-, year-, and state-specific availability and access conditions. |
| MEPS | <https://meps.ahrq.gov/mepsweb/data_stats/download_data_files.jsp> | The official file catalog exposes public-use files, documentation, and codebooks; file-specific grain and years must be checked. |
| PHC4 | <https://www.phc4.org/> | PHC4 publishes free reports and also offers paid standard or custom data requests; catalog visibility does not establish free payload access. |
| AHRQ Compendium of U.S. Health Systems | <https://www.ahrq.gov/chsp/data-resources/compendium/technical-documentation.html> | The Compendium is a distinct AHRQ source with versioned files and methodology; generic AHRQ mentions are secondary evidence only. |

## Interpretation boundary

These observations support catalog metadata and routing statements only. They
do not establish scientific fitness for an individual study, current endpoint
availability, authorization, schema compatibility, or join success. Any future
claim presented as a captured excerpt must include its own evidence identifier,
source locator, capture time, content hash, and preserved content.
