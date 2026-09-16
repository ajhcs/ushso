# C-009-1 account-information request

Status: **unresolved**. Public prices and publication asset lengths are insufficient.

This request does not authorize paid resources, a new topology, or production change.

## Required inputs (redacted)

Collect, for each currently feasible option that could host the reviewed product:

1. Actual account plans and contract terms.
2. Included allowances and shared usage with other workloads.
3. Redacted bills or provider usage exports covering a representative period.
4. Measured steady and burst workloads (not fixture 1x/2x alone).
5. Storage growth, transfer, refresh cost, and recovery requirements.
6. Unchanged rights, capacity, and recovery constraints that any cheaper option must still satisfy.

## Comparison rule

Compare feasible options against the **same** workload and constraints. Recommend the cheapest option that satisfies required rights, capacity, and recovery. An independent reviewer must be able to reproduce the comparison.

Leaving the decision unresolved is honest. It does **not** satisfy C-009-1.

## Out of scope

- AUTH-01 procurement without this comparison.
- Treating the September 14 static-site deployment approval as approval of a database-backed topology.
- Inventing numeric budgets.

Current recommendation: **none**. `measured_cheapest_new_topology` remains null.
