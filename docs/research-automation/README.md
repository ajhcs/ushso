# Research evidence completion

Operator: The American Journal of Healthcare Strategy. Final approval: repository owner. Public corrections: info@ushso.org. The private forwarding destination is operational configuration, not public page content.

Current status: [implementation-plan review](IMPLEMENTATION-PLAN-20260907.md). Earlier pilot and expansion counts are historical. Public Muse review is authorized, but the latest DSH plugin worker is externally blocked before model output. Ajv8.20.0/npm11.19.1 clean installs and relevant checks passed on Node22.15.0 and24.14.0. Scientific decisions, requested cold/concurrent latency, remote provisioning and exact release authorization remain open.

## Run on Plumbob

Use Node 22.15+ and the committed lockfile. From this checkout:

```sh
/home/plumbob/bin/with-dev-storage node scripts/research/refresh.mjs --out /mnt/d/tmp/plumbob/ushso-research-evidence
/home/plumbob/bin/with-dev-storage node scripts/research/refresh.mjs --out /mnt/d/tmp/plumbob/ushso-research-evidence --capture --limit 20 --muse
node --test tests/research-automation.test.mjs
node scripts/generate-agent-plugin.mjs
```

The first command inventories missing research fields without network requests. The second refreshes a bounded batch of publisher metadata and asks the existing DSH headless profile for proposed facts. Verify that profile selects `meta/muse-spark-1.3-contributor` on OpenRouter before enabling `--muse`; provider credentials stay in DSH's native store. Only public publisher metadata may enter the contributor model. No private corrections, user research questions, patient data or credentials.

Runs share a lock and attempt ledger. Unvisited URLs run first, then the oldest attempts; successful and failed attempts are eligible again after 24 hours. A crash can leave the lock: inspect for a running process before removing it. Each invocation limits requests to 1–100, responses to 2 MiB and 20 seconds, uses an allowlist, refuses redirects and retains hashes and typed failures. No recurring timer is installed. An operator can invoke the same command repeatedly; retaining the same output path preserves fairness and history. A 20-request batch does not refresh all 3,434 records.

## Review and promotion

Read `queue.json` for scope and unresolved fields, each run's `observations.json` for actual HTTP evidence, hashed text files for source content, and `proposals.json` for suggestions. A quote match only establishes that those words occurred on a linked source page. Verify exact asset/release identity, meaning, observation unit, date semantics, access terms and applicability. Reporting frequency is not observation grain. Record-level metadata is not proof of payload schema or join validity.

Approve or reject each proposed field with reviewer ID, source hash, exact record/generation and rationale. Incorporate approved values through the repository's versioned catalog builder and semantic validation, then review the resulting diff and issue candidate-specific attestations through the existing owner process. This runner intentionally has no direct catalog publication or approval operation. Keep rejected and superseded observations immutable. Dictionary, identity continuity and join-validation work require further source-specific engineering; they are not closed by these captures.

## Agent/API quality

The local plugin exposes the eight canonical read-only tools, with a generated copy of the browser HTTP client and self-contained input schemas. Integration tests invoke every route through the actual Worker using the full published corpus, check generation continuity and exercise disabled/failed boundaries. Run these deterministic checks after using Muse to propose adversarial cases. Passing checks establish transport behavior, not scientific usefulness. Keep model review offline so API requests do not acquire LLM latency.

Native Astra installation and WebMCP model-driven invocation require client qualification; local protocol tests do not prove that. Existing WebMCP schemas remain canonical. The new skill applies equally to Astra and other clients. No release approval is implied by plugin validation or any prior candidate receipt.
