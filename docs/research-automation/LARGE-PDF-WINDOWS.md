# Bounded large-PDF evidence collection

This separate entry point does not increase or bypass the normal PDF extractor's 64-page limit. It admits at most 2,048 physical pages, reads at most eight pages per invocation, caps the source PDF at 64 MiB, and enforces pypdf 6.18.0, 512 MiB address space, 20 CPU seconds, 25 seconds parent timeout, 8 MiB decoded content per page, 1 MiB text per page and 8 MiB output per window. Source PDFs are public publisher dictionaries only.

```sh
/home/plumbob/bin/with-dev-storage env USHSO_RESEARCH_PYTHON=/absolute/qualified/venv/bin/python node scripts/research/collect-pdf-windows.mjs CAPTURED_PUBLIC_PDF NEW_WINDOW_DIRECTORY
```

Repeating that command verifies cached window hashes and reuses only the same source PDF and extractor identities. A changed extractor or modified cached window fails explicitly. A cached orphan without a bound resume entry is rejected; preserve it for investigation rather than treating it as verified. Window manifests bind physical-page order, source SHA256, extractor SHA256 and completion state. They are capture evidence, not scientific approvals. Catalog/resources/release binding is verified separately before proposals are admitted.

Current isolated evidence: QIES 733 physical pages in 93 windows; MCBS 112 physical pages in 15 windows. QIES proposes 856 entries across 15 explicit publisher CATEGORY codes, with 164 unresolved blocks/identity issues. Names cannot be flattened across categories; normalized descriptions remain null and raw description passages retain exact physical-page/line locations. MCBS proposes 270 literal labels with 189 unresolved blocks; storage labels such as `N um` remain literal, not normalized types. Neither proposal changes the frozen 35-CMS-record package.

The additive review package contains 37 CMS records and 6,118 entries, but these become the candidate's review scope only after root-owned adapter/package integration and verification. The increase is three clinical-laboratory definitions plus 270 MCBS labels; QIES remains separate. Capturing every physical page does not mean extracting every variable or understanding every definition. Scientific approval is still absent.

Checks: `large-dictionary-parser.test.mjs` has five self-contained named parser cases; `pdf-text-window.test.py` has four generated-public-fixture range cases. `pdf-window-resume.test.mjs` has six portable cache/identity/size/atomic-checkpoint cases using synthetic cache fixtures, with no external evidence dependency. The synthetic cache is not a qualified publisher capture. No test count represents semantic approval.

The strengthened collector stats source files before bounded reads, validates cached physical-page/text structure, caps checkpoint size, and writes checkpoints through a same-directory temporary file followed by atomic rename. The PDF extractor bytes and existing window hashes are unchanged; collector qualification is separately versioned. A new collector does not silently approve old scientific proposals.
