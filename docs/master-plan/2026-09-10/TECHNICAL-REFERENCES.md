# Verified technical starting points

Checked September 10, 2026. Recheck and pin the actual schema/model revision in the implementing PR. URLs describe publisher contracts, not permission to assume every listed distribution works.

| Area | Primary reference | Instruction for implementation |
|---|---|---|
| CMS public data API | [CMS API documentation](https://data.cms.gov/api-docs) | Use documented metadata/resources and bounded size/offset queries. Preserve dataset ID and exact returned keys. The audit's 117-field HCRIS sample is a regression input, not proof of every CMS endpoint |
| Census API | [Census API user guide](https://www.census.gov/data/developers/guidance/api-user-guide.html) | Model key requirements and actual response content. The captured 200/HTML missing-key result must remain a negative case without credentials in logs |
| Hospital price transparency | [CMS hospital repository](https://github.com/CMSgov/hospital-price-transparency), [JSON documentation](https://github.com/CMSgov/hospital-price-transparency/blob/master/documentation/JSON/README.md) | Pin a repository commit and supported schema version. The 2026 v3.0 contract must not be parsed with silently assumed older fields |
| Hospital test fixtures | [CMS official examples](https://github.com/CMSgov/hospital-price-transparency/blob/master/examples/README.md) | Official fictional JSON/wide/tall CSV examples provide shared values for parser equivalence checks; retain their version and source notice |
| 2026 hospital price semantics | [CMS final-rule fact sheet](https://www.cms.gov/newsroom/fact-sheets/cy-2026-opps-ambulatory-surgical-center-final-rule-hospital-price-transparency-policy-changes) | Distinguish dollar charges and allowed-amount percentile/median fields for applicable percentage/algorithm arrangements. Do not relabel these as patient bills or observed utilization-weighted prices |
| Payer Transparency in Coverage | [CMS payer schema guide](https://github.com/CMSgov/price-transparency-guide) | Treat this as a separate schema family. Pin index/in-network/provider-reference contracts and validate IDs within the actual file/release context |
| Available OpenRouter models | [Model catalog](https://openrouter.ai/api/v1/models) | Store exact model ID, capability/pricing snapshot, endpoint and run time. Both proposed models appeared in the captured catalog; selection remains subject to the held-out evaluation |
| Structured outputs | [OpenRouter structured-output guide](https://openrouter.ai/docs/guides/features/structured-outputs) | Require a compatible endpoint and locally validate returned JSON and citations; JSON syntax alone does not validate a claim |
| Provider selection | [Provider routing controls](https://openrouter.ai/docs/guides/routing/provider-selection) | Implement an evaluated allowlist, price ceiling and explicit fallback policy; no silent arbitrary free-router substitution |
| Contributor data handling | [Muse Contributor page](https://openrouter.ai/meta/muse-spark-1.3-contributor), [OpenRouter data collection](https://openrouter.ai/docs/guides/privacy/data-collection) | Decide eligible public inputs explicitly. Contributor data use affects model selection; do not imply a routing flag can override an incompatible provider policy |

## Minimum contracts to settle before parallel implementation

PR-004/007/008/009 establish these contracts; later PRs consume their merged versions:

1. **Source identity:** product, release, distribution, schema, document and source-native IDs; canonical URL; alias/family relations; replacement history.
2. **Attempt receipt:** source/context, operation, requested public parameters, time, status, expected/actual MIME, redirected public locator, bounded bytes, artifact hash, parser version and typed outcome. Secret values are excluded before persistence.
3. **Claim:** entity/field, proposed value, value kind, source pointer, interpretation status, applicability, observation/review clocks, reviewer/rule and acceptance generation.
4. **Variable:** exact wire key, label, definition, type assertion/observation, units or applicability, code list, missing/suppressed values, measurement/identifier role and schema binding.
5. **Recipe:** source operation and scope, parameter meanings, credentials by name only, pagination, sample shape, last check and limits. Reading a recipe never executes it.
6. **Join:** source/release/key pairs, mapping authority, periods/universes, cardinality, measured matching loss and forbidden shortcuts.
7. **MRF preview:** file/release/version, bounded sample scope, billing code/system/version, setting, charge/rate kind, units, payer/plan and provider-reference context. Absent dimensions block the corresponding comparison.
8. **AI task:** immutable evidence/chunk hash, requested field, extraction schema, exact model/endpoint, estimated/reserved/actual usage, raw cited proposal, validation result and reviewer decision.

Avoid a one-score “verified” flag. The required states and independent axes are specified in the master plan. A state transition must name its new evidence and preserve the prior observation.

## Suggested initial operating profile

These are configuration proposals for PR-009/012/024/076, to be tested against publisher requirements and measured usage:

- Start collection at one in-flight request per origin, with a configurable request interval and publisher-specific stricter limits. Respect documented rate limits and Retry-After. Increase concurrency only with evidence.
- Separate metadata, documentation, small sample and full-file operation classes. Assign explicit byte/time/row/decompressed-byte limits per class before dispatch; a large-file exception cannot inherit an unbounded default.
- Review catalog/endpoint evidence on a regular configured schedule, and source-release evidence on the publisher's actual cadence. Display stale status when due even when the refresh job is blocked.
- Store source captures and parse results by hash; reuse unchanged evidence. Do not run a model again for the same task/schema/evidence/model-policy identity after an accepted result.
- Start AI evaluation with the proposed capped pilot in the master plan. Select the cheaper **qualified** model by cost per accepted correct claim, including review effort; token pricing alone does not select the winner.
- Keep queue throughput, source error rates, stale coverage, processing yield, model spend, review backlog and public query latency separately observable. Their denominators must be visible.

The program can begin with local fixtures and the existing static public release. A premium managed database, new public API topology, full MRF warehouse and recurring paid inference are not prerequisites to correcting the current truth labels or demonstrating a tested source route.
