# Hospital JSON MRF samples

Policy version: `ushso.hospital-json-mrf.v1`.

CMS hospital-price-transparency JSON v3.0.0 is pinned from repository commit `5333564a710f80d7740180b9ffab8dbdcba9b502` (schema blob `11043f073ab24e638c91bde1b8bcf73e4733b296`). Official fictional examples are marked synthetic. Unknown newer versions are never reported as compatible. Historical v2 is labeled historical and not compatible.

A budget stop yields a partial sample, not whole-file validation. Numeric, string, percentage, algorithm and per-diem charge cases remain distinct. No algorithm/percentage/per-diem value is automatically represented as a comparable dollar price. 2026 allowed-amount percentile/median fields are preserved as allowed-amount elements, not patient bills.

File-level schema validity is unknown unless the whole required structure was validated. No full-size MRF download is initiated. Last-good generation remains `live-2026-09-03-85b50522b420`.
