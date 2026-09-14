# Payer Transparency in Coverage indexes

Policy version: `ushso.payer-tic-index.v1`.

Frozen 10 payer reporting-entity IDs from `evaluation/research-program/cohorts.json` `mrf_selection` (`ushso-mrf-directory-pilots-20260910-v1`) are consumed without replacement or silent deduplication: `67190,45845,32225,40702,32753,15560,11269,37833,59025,86382`.

CMS payer table-of-contents schema is pinned from price-transparency-guide v2.2.1 (schema blob `370be524856f38d97a9424f8508be6a7b79e28d5`). Official fictional examples are marked synthetic.

Employer plan ID, insurer identity and hospital identity cannot be substituted. The same file linked by many plans is fetched once but retains all supported plan associations. All ten reporting entities are accounted for; an inaccessible bulk file remains a valid documented route with failed sample state.

Hospital HPT and payer TiC schemas remain separate. Allowed-amount files are discoverable without pretending the in-network parser validates them. Last-good generation remains `live-2026-09-03-85b50522b420`.
