# Source-selection execution evidence

The 80 original change obligations are retained in `execution-coverage.json`, with their original wording and acceptance methods. `not_run` means the obligation has no linked completion evidence; it does not mean no implementation exists. The parent integration owner must link reviewed artifacts before changing these states. Code verification, source review, intended-use validation, operational qualification and business outcomes are separate.

`candidate` means that code or preparation artifacts exist for part of the obligation. It is not completion, acceptance, or a percentage of the program delivered. Read the limitation on each row; a protocol or template does not stand in for observed outcomes.

## Corrected retrieval lane

The historical `scripts/research-program/evaluate-retrieval.mjs` constructs candidates using expected source IDs and sometimes question text. Its `precision_at_5` is not actual per-query top-five precision. Its immutable reports remain historical component evidence. Do not compare those scores with this new lane.

The new `scripts/source-selection-evaluation/execute.mjs` loads the full byte-pinned corpus using the production Worker loader. Public query objects permit only ID, text and stratum; they contain no expected results. A fresh assets binding isolates each candidate. Required registry presence, inventory hashes and root containment fail closed. The binding serves frozen local bytes; `fetch` is intercepted and any attempted external request is counted. This is not a general operating-system network sandbox.

Execution and scoring are separate command-line processes. Run execution before giving the scorer access to independent judgments. The scorer checks the frozen receipt digest, query cohort, source unit and label revision. Process separation and hashes support reproducibility; they cannot prove a reviewer was independent or that labels were sealed. Never place sealed labels in producer-accessible files.

```sh
node --test tests/source-selection-evaluation/*.test.mjs
node scripts/source-selection-evaluation/execute.mjs evaluation/source-selection/candidate.json evaluation/source-selection/queries.public.json /workspace/build/builderbob/ushso-implementation/receipts/new-raw.json
node scripts/source-selection-evaluation/score.mjs /workspace/build/builderbob/ushso-implementation/receipts/new-raw.json EXPECTED_SHA256 /path/to/independent-labels.json /workspace/build/builderbob/ushso-implementation/receipts/new-scores.json
```

Outputs use exclusive creation to prevent overwriting earlier evidence. The execution lane is explicitly nonindexed and source-injected. Exact compiled Worker, browser journey, and indexed artifact qualification remain separate.

The raw receipt retains complete direct and HTTP outputs. Ranking parity checks order, score, classification, sections, pagination, generation, partial failures, named-source resolution and warnings. Full-contract equality is reported separately: the HTTP service enriches freshness at request time, while the direct engine currently receives `now:null`. This discrepancy is retained rather than removing dates from raw evidence.

## Prospective metric protocol

The default production run uses record IDs as units because no independently verified family crosswalk has been supplied. Family scoring requires a new frozen crosswalk and source-unit identity; do not label record-level metrics family-level. For declared family fixtures, duplicate rows consume original rank slots and earn credit once. No compressing duplicates into a new top-k list.

For k=1,5,10,20, precision lower bound is distinct relevant judged units in the first k slots divided by k; upper bound additionally counts distinct unresolved/unjudged returned units. Empty slots remain in the denominator. Conditional recall divides hits by independently relevant catalog units; full-universe recall also retains known absent relevant sources. Both zero denominators are null and reported. Macro means and micro ratios are separate. Failures stay in attempted-query counts and have zero hits. Unjudged bounds do not establish complete recall over unknown sources.

No-direct-match correctness applies only to independently adjudicated no-direct cases. An engine failure never counts as correct abstention. Critical unsupported direct matches are retained as counts. Labels must explicitly distinguish critical unsupported direct claims from mere irrelevance.

The public cohort includes four Pennsylvania domains, restricted access, county life expectancy, Medicaid, Medicare and nonsense geography. These are producer-visible regression cases, not a held-out cohort or a claim of sufficient task coverage. No independent labels or accuracy estimates are supplied. The initial planning targets (30 tasks, five usability participants, three paid engagements) remain prospective and are not statistical guarantees.

The frozen receipt also pins sorted loader-accepted catalog record membership and its SHA-256. Judgments reference that digest; they cannot define a narrower catalog. This prevents omitting relevant but unretrieved catalog records from the conditional denominator. The execution identity includes commit, lockfile hash, Node version and hashes of the local module dependency closure. Execution rejects code changes during its run. Recheck these pins after concurrent implementation changes; the checked-in execution summary is a dated producer observation, not final integrated qualification.

`acceptance.mjs` computes task counts and a stated Wilson 95% interval without excluding abandonment or technical failures; critical false assertions defeat success. Its cost summary values all producer/reviewer/admin/support hours and keeps synthetic/unpaid evidence separate from actual paid adoption. It validates all 80 coverage IDs and rejects completion states without evidence. The tests use synthetic observations only. `acceptance.json` contains no invented participant or customer observations.

Judgment file shape (stored outside producer inputs for independent acceptance): `cohort_sha256`, `source_unit`, `revision`, `independence`, `corpus_units_sha256`, and `queries`. Each query has `query_id`, optional `no_direct_expected`, and `units`; each unit has `unit_id`, `relevance` (`relevant`, `irrelevant`, or `unresolved`) and optional `critical_false_direct`. Retain reviewer identity, evidence citations, raw disagreements and adjudication in the private review package. An `independently_adjudicated` string alone does not establish independent review; the responsible reviewer must disposition that evidence separately.
