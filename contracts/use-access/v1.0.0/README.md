# Observatory Use and Access Contract v1.0.0

This immutable fixture package defines two offline contracts:

- **O5 Use Cards** answer “what could I use this for?” with curated analytical-fit assertions. Use Cards are not source truth. Every assertion references a separately stored source-truth snapshot, declares fitness, compatible measures, units, geography and time needs, and carries evidence, confidence, review status, and limitations.
- **O6 Access Recipes** give humans and agents ordered, fail-closed retrieval instructions. Recipes identify the exact asset and route, authoritative URLs, mechanisms, requirements, restrictions, authorization gates, expected artifacts, and typed outcomes.

The package is fixture-only. It performs no HTTP requests, downloads no payloads, does not read or modify the shared identity index, and grants no execution authorization. A public URL is not authorization to execute a recipe.

## Truth boundary

Source truth is copied into `fixtures/source-truth.json` from the hash-pinned curated Observatory fixture. Analytical usefulness is stored separately in `fixtures/use-cards.json`. An LLM may help draft a suggestion, but LLM output cannot be represented or promoted as source truth. Promotion requires human or deterministic evidence review.

## Failure boundary

Access and infrastructure outcomes remain typed. HTTP denial, authentication, registration, application, DUA, payment, licensing, throttling, timeout, transport, malformed response, cancellation, unavailable, and unresolved states must never be translated to `not_found`.

## Commands

```powershell
npm test --prefix observatory/use-access-contract/v1.0.0
node observatory/use-access-contract/v1.0.0/tools/validate-package.mjs
```

Both commands are offline. Manifest and validation receipt publication are build-time actions for a new package only.
