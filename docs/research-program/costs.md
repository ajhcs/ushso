# Research-program costs

This document names workload and cost ceilings **before** measurement. It does not invent a numeric budget. Owner direction remains cheapest-possible using existing infrastructure first. Owner budget deferral is **neither** a zero-dollar cap **nor** proof of a cheapest topology.

Last-good generation remains `live-2026-09-03-85b50522b420` with **3,434** frozen baseline record IDs. The offline retrieval fixture measured here has **143** records. A small fixture or warm-only average cannot qualify cold starts or production capacity.

## Existing deployment requirements versus proposed SLOs

| Gate | Existing requirement | This PR |
| --- | --- | --- |
| Historical all-samples 300 ms Worker diagnostic (141 requests, 2026-09-07) | **Not met** (max 322.59 ms). No cold-start or concurrent-load qualification. | Unchanged. Not rewritten as passed. |
| WP14 / ADR 0005 record-search | p95 ≤ 600 ms; p99 ≤ 1.5 s | Not relaxed. |
| WP14 bundle-plan | p95 ≤ 1.2 s; p99 ≤ 3 s | Not relaxed. |
| Authorized 30-minute 2× production-like load | pending external authorization | Unrun. |

No accepted old performance gate is silently weakened.

## Timing classes

Performance results distinguish:

- **Browser time:** unmeasured in this PR.
- **Edge/network latency:** unmeasured in this PR.
- **Local indexed-metadata CPU:** measured in-process against the offline retrieval fixture.
- **Upstream collection:** not invoked during a user search.

No source acquisition happens during a user search. HTTP 200 is not a completed research task.

## Fixture measurement bounds

`scripts/research-program/capacity.mjs` measures candidate **query**, **detail**, **variables metadata**, and **MRF metadata** paths at current fixture load and twice that fixture mix. Variables and MRF paths are indexed-metadata inspections: the fixture does not contain variable dictionaries or MRF payloads. Output parity remains exact across 1× and 2× copies of the published query mix.

This is **not**:

- a Worker isolate cold start
- a production percentile/SLO
- a 20 rps / 40 rps public peak
- a Neon/Hyperdrive/R2 bill
- scientific approval

Sealed `packages/search` remains the untuned successor (`package_content_digest` `ed9faf0180a66001e9479771545b92f22dce3748580fd330f0d8424f4b53c1f0`, 18 files). The current public runtime remains immutable static JSONL.

## C-009-1 measured topology

Required evidence for cheapest measured control-plane/publication topology:

- actual account terms and shared allowances
- measured steady and burst workload and cost
- storage/transfer
- unchanged rights, capacity, and recovery constraints

Public prices and publication asset lengths alone are insufficient. Those facts are **absent**. `measured_cheapest_new_topology` remains **null**. C-009-1 remains **unresolved**. Failed targets remain unresolved until fixed.

Steady/burst costs, provider fees, storage, and review operations are reported as **null** because no actual bill or authorized production measurement exists. Premium infrastructure is not assumed. No paid resource is created. Production activation is not issued.
