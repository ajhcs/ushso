# Payer in-network rate samples

Policy version: `ushso.payer-in-network-rates.v1`.

CMS payer in-network-rates schema is pinned from price-transparency-guide v2.2.1 (schema blob `836c6f075d13c52b73a513236db2b49e1539649f`). Official fictional examples are marked synthetic.

Unsupported schema/rate types are typed, not coerced into a dollar comparison. Stopping before end-of-file produces a partial-validation receipt; row order and file prefixes do not define a representative sample. No utilization weights, patient liability or observed paid-price claims are generated from a negotiated-rate object. The parser does not load a giant file into Worker memory. A rate without sufficient provider/network context remains incomplete.

Last-good generation remains `live-2026-09-03-85b50522b420`.
