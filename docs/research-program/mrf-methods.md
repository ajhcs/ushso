# MRF pricing methods and coverage packet

Policy version: `ushso.mrf-pilot-qualification.v1`.

## What this packet is

This is a discovery/research-layer methods packet for the frozen MRF pilot. It is not an unbounded national rate warehouse, not legal compliance, and not observed payment.

Last-good generation remains `live-2026-09-03-85b50522b420`. Frozen cohort status remains `ids_frozen_locators_not_materialized`.

## Frozen denominators

- Hospitals: 25 IDs from `evaluation/research-program/cohorts.json` `mrf_selection.hospital_candidate_ids`. Replacement and silent deduplication are forbidden.
- Payers: 10 HIOS issuer IDs `67190,45845,32225,40702,32753,15560,11269,37833,59025,86382`.
- Parsed-sample targets remain 20 hospital and 8 payer live bounded samples. Unknown locator cells cannot count toward those targets.

## Historical versus current schemas

- Hospital JSON/CSV: CMS hospital-price-transparency v3.0.0, pinned. Historical v2 is labeled historical and not compatible.
- Payer indexes and in-network rates: CMS price-transparency-guide v2.2.1 table-of-contents and in-network-rates, pinned.
- Do not parse 2026 hospital v3.0 with silently assumed older fields.

## Sampling bias and stale rates

Official fictional CMS examples (West Mercy Hospital; Comprehensive Health Insurance) are synthetic walkthroughs. They do not represent the frozen 25/10 live locators. Row order and file prefixes do not define a representative sample. Expiration dates in fixtures are example dates, not current market rates.

## Duplicate and shared files

A file linked by many payer plans is fetched once and retains plan associations. Shared files do not inflate provider coverage. Equal numeric provider-reference IDs in different files cannot be joined.

## Missing references

A missing referenced object yields an unresolved association. No provider group is invented from a hospital name. An NPI-bearing rate does not map to a hospital CCN.

## Price definitions

Gross charge, discounted cash, negotiated amount and allowed amount remain different measures. Algorithm, percentage and per-diem values are not comparable dollar prices. A negotiated rate is not observed payment, patient liability, or utilization-weighted price.

## Worked examples

- Hospital walkthrough: official fictional CMS JSON v3.0, labeled synthetic, with an executed receipt.
- Payer walkthrough: official fictional CMS in-network negotiated-types sample, labeled synthetic, with an executed receipt.

Every executed step has a receipt. Documented but unexecuted live locator materialization remains labeled.

## Expansion families

All twelve frozen expansion families have documented intake routes from PR-043/PR-044/PR-045. Documented routes are not publisher-access claims and not schema qualification.

## What a reviewer can and cannot infer

A reviewer can reproduce the pricing task against the pinned fictional fixtures and the frozen ID lists. A reviewer cannot treat a rate as observed payment, treat a passing sample as legal compliance, treat unknown locator cells as supported, or accept implementer/model self-approval as scientific qualification.
