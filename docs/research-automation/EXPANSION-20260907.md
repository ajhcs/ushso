# Expanded research review — 2026-09-07

**Historical initial packet.** See [current Muse follow-up](MUSE-FOLLOWUP-20260907.md). The owner has authorized scoped Muse review; three reviews completed. npm 11.19.1 resolves the earlier Ajv override issue. The candidate has since changed; browser, agent, latency and full-gate evidence must be identified by run, not inherited from this initial packet.

The immediate research deliverable is ready for review, not publication. No canonical corpus records were changed and no approval receipts were issued.

## Measured evidence coverage

All 3,434 production records were processed: 1,472 CDC, 159 CMS and 1,803 Census. There are 22,441 proposed metadata additions. These are partial evidence gains, not complete scientific dossiers.

- Structured dictionaries: **0 → 2,864 records** (1,126 CDC; 1,738 Census).
- Record-scoped variable entries: **1,567,292**, including **451,328** with literal publisher code-to-label enumerations. Repeated variables across releases are counted separately.
- Actual variable descriptions: 14,283. Explicit measurement units: zero. Census concepts are not substituted for definitions.
- CMS documentation: all **159** records have captured documents; **132** have dictionary PDFs. There are 723 record–release–document links, 251 distinct PDF hashes and 359 additional exact release-distribution bindings. PDF variable tables are not yet normalized.
- Four substantive proposals preserve exact page/line evidence: hospital and SNF aggregation labels, ACO-county/suppression wording, and PAC nonadditivity limitations. Scientific approval remains pending.

[Full completeness report](/mnt/d/tmp/plumbob/ushso-research-expansion-20260907/review/completeness-report.md) contains the dimension-specific gaps and verification limits.

[Before/after field index](/mnt/d/tmp/plumbob/ushso-research-expansion-20260907/review/catalog-before-after-index.json), [dictionary proposal manifest](/mnt/d/tmp/plumbob/ushso-research-expansion-20260907/review/canonical-dictionary-proposals/manifest.json), [scientific proposals](/mnt/d/tmp/plumbob/ushso-research-expansion-20260907/review/scientific-proposals.json), and [unresolved records](/mnt/d/tmp/plumbob/ushso-research-expansion-20260907/review/unresolved-records.json) retain every proposed field's source, hashes and before/after representation. Keep the referenced captures and per-record files until review and durable evidence archival are complete; they are not bundled into Git or the production Worker.

## Verification and remaining work

Actual GPT-6 Astra exercised the plugin MCP through session-only configuration. Marketplace installation is not verified. Native Chrome WebMCP discovered and invoked all eight tools, including a post-install rerun. Desktop/mobile browser checks covered all four sorts and exact rendered/exported order, filters, detail correction-link privacy and contact copy. Focused tests: 16 passed; retrieval: 105 passed; clean-installed contracts: 11 suites passed.

Latest latency sample: **2026-09-07T02:04:21.246Z**, 141 actual Worker requests across the 42 original audit questions and five homepage examples. Mean **162.66 ms**, p95 **263.87 ms**, maximum **322.59 ms**. Every response matched the reviewed control hash; every query median was below 300 ms, but one sample exceeded it. The strict all-samples target is not met. An initial request/health timeout on the pre-install development server is preserved, with cause unresolved; the fresh-fixture replay is diagnostic. No cold-start or concurrent-load qualification is claimed.

Ajv 8.20.0 is installed through a root override. Nine stale vulnerable lock entries were removed without altering sealed historical manifests. A clean npm 11 install, all 11 contract suites and a zero-vulnerability advisory scan passed. npm 11 still reports workspace-override `ELSPROBLEMS`; the npm 10 clean-lock experiment fails. Resolve the toolchain/manifest strategy before release; this is not an accepted compatibility exception.

Muse review requires explicit repository-sharing authorization. Scientific proposals need owner review. Bulk dictionaries need bounded, out-of-line storage and agent API integration before promotion; do not eagerly load 1.57 million entries into the current Worker corpus. CMS table normalization, measurement units, definitions, release applicability, access requirements and scientific limitations remain individually unresolved where reported.

The complete release gate has **not** been run for an approved integrated research candidate. Changed subjects cannot reuse historical approvals. AUTH-15, scientific limitations, the strict latency target and deployment approval remain open. Local test servers were stopped; no deployment, release, publication or mail delivery test occurred.

## Reproduction

Use `with-dev-storage` and the recorded isolated worktree. `scripts/research/sweep.mjs` collects or resumes exact publisher metadata with bounded requests and verified caches. `cms-documents.mjs --release-distributions` follows explicit release-resource relationships. `prepare-catalog-update.mjs <evidence-directory>` independently revalidates captures and emits pending dictionary proposals; `build-review.mjs <evidence-directory>` assembles the review packet. Current CMS/report paths are scoped to this dated collection, not a general unattended service. No timer was installed.
