# Correction-3 candidate corpus v1.3.0-candidate

Explicitly versioned application candidate that adds the Track 1 first set
(HRSA AHRF and Sheps rural-hospital-closure tracking) to the searchable
catalog as documentation-first entries. Served through the application at the
versioned `/api/candidate/*` routes and staged under
`apps/web/public/corpus-candidate-v1.3.0/`.

## Frozen baseline preservation

- Baseline corpus `1.2.0` (3,434 records, generation
  `live-2026-09-03-85b50522b420`) is NOT mutated: `records-0001/2/3.jsonl`,
  `join-routes.jsonl`, and `controlled-vocabulary.json` in this directory are
  byte-identical copies of the frozen files (asserted by
  `build-candidate.mjs` against the frozen manifest SHAs on every run).
- Frozen `evaluation/research-program/cohorts.json` (100-product cohort,
  3,434-record baseline, R01-R16 unaccepted) is read-only input: the script
  asserts `record_count == 3434` and that the candidate invalid set equals the
  frozen `isolated_record_ids` (the same 4 baseline rows).
- The frozen named-source-registry fixture
  (`packages/retrieval/fixtures/named-source-registry.v1.0.0.json`) is
  read-only input; the candidate registry is a derived copy with exactly two
  additive bindings.
- Rebuild deterministically: `node packages/retrieval/versions/v1.3.0/build-candidate.mjs`
  (exit non-zero on any baseline drift).

## Additive diff (2 records)

`corpus/records-0004.jsonl` holds exactly two valid
`observatory-record.v1.0.0` rows (0 invalid):

| record_id | family | named source |
|---|---|---|
| `obs:asset:candidate-ahrf-documentation-v1` | HRSA AHRF | `hrsa-ahrf` |
| `obs:asset:candidate-sheps-closures-documentation-v1` | rural hospital closure tracking | `rural-hospital-closure-tracking` |

Candidate counts: 3,436 raw rows = 3,434 baseline + 2 additive; 3,432 valid
+ the same 4 isolated baseline rows. `source_slices` keeps the three baseline
slices byte-true and adds `candidate-documentation-first: 2`.

## Honesty states (both additive records)

- `access.status: unknown` (evidence `unresolved`); `payload_access: unknown`
  by construction. Catalog membership proves nothing about payload.
- `freshness_verification.verification_status: not_live_verified`, method
  `unknown`. No live HTTP check was performed.
- Retrieval steps are documented-not-executed (`requires_human: true`, human
  stop step); reachability was NOT tested.
- `variable_documentation.status: unknown` with `codebook: null`: variable-
  level dictionary links are unknown, not inferred. The only
  dictionary-adjacent link is the authoritative documentation page.
- `join_compatibility.state: none_known`, zero join routes.
- Family `resolution_state: provisional` (possible relation, not confirmed).
- Evidence-bound source cards stay in `evaluation/research-program/track1/`
  (`status: incomplete`); candidate research packets in `evidence-packets/`
  keep `tested: false, executed: false`, empty fields, zero joins.

Evidence-bound field decisions:

- AHRF `unit_of_analysis: [unknown]`: retained evidence marks grain `null`.
  Retrieval carries on the lexical `county` match plus the named-source direct
  binding; the unit stays unknown until evidenced.
- Sheps `unit_of_analysis: [event]`: evidenced as `product_type:
  closure_tracking` (closure-event list); facility-level grain fields are not
  evidenced and are not claimed.
- Sheps geography `national / [US]` (`source_asserted`): evidenced as the
  Sheps national closure list (nongovernmental). AHRF geography stays
  `unknown`: retained evidence marks scope unknown.

## No eligible substitution was needed

Retained evidence supports documentation-first entries for both families, so
no substitute source was required and no missing prerequisite blocks either
entry. Payload ingestion for all 12 Track 1 families remains 0/12; the other
10 families are reconciled in
`evaluation/research-program/track1/coverage-reconciliation.v1.json` and are
unchanged by this candidate.

## Serving

- Worker: `GET /api/candidate/catalog`, `POST /api/candidate/discover`,
  `GET /api/candidate/datasets/:id` (candidate catalog only). Baseline
  `/api/*` routes are untouched.
- Web app production build queries `/api/candidate/discover`; baseline
  generation copy on static pages still describes the frozen baseline.
- Static: `/corpus-candidate-v1.3.0/corpus/*`, `/fixtures/*`,
  `/evidence-packets/*`, `/manifests/*`, `/validation/*` (staged build
  artifacts, git-ignored).
