# PR-004 packaging evidence

This directory records the lossless gzip packaging of the PR-004 completeness view and the bounded manifest-consistency correction.

C-004-1 through C-004-7 remain Luna Max implementation. C-004-8 introduced the deterministic Node zlib gzip transport. Independent review of `877281c81b937829ae18f54075a349697b480a0e` requested rejection of contradictory manifest metadata. C-004-10 adds that cross-check. C-004-9 is the current evidence/handoff packet.

`evidence.json` and `evidence/r2/index.json` are retained byte-for-byte as prior receipts. The original 49,808,256-byte JSON is a historical Git snapshot at `323dfe54c88322369f417c7fde22597b9ab57d75` and is not present in this tree.
