# Research relevance and exclusions

Policy version: `ushso.relevance.v1`.

Search respects important scientific distinctions and explicit user constraints. Near-miss fixtures identify forbidden, uncertain, and contextual matches. No test expects a title-only answer.

Exact phrase, named-source, exclusion, and supported-dimension logic apply before broad source priors. An explicit without-Census filter excludes Census by source identity, not the word census in unrelated prose. Maternal mortality does not promote infant data as the leading compatible result.

Ranking reasons agree with actual filters and evidence. The nonsense-plus-Pennsylvania query remains a scoped zero. Held-out reviewer labels stay outside ranking.

Fingerprint-sealed `packages/retrieval/tools/question-parser.mjs`, `retrieval-core-v1.2.mjs`, and `controlled-vocabulary.json` are not edited by this implementation.
