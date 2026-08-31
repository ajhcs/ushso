# Evaluator-v2 retrieval attribution matrix

All values below use the same frozen evaluator, benchmark, cohort, and metric contract. The production Worker is an observed alternate runtime, not an accepted post-WP0 algorithm.

| Lane | Corpus | Algorithm | Full recall@3 | Full recall@10 | Present recall@5 | Present recall@10 | Graded precision@5 |
|---|---|---|---:|---:|---:|---:|---:|
| c143_legacy | historical-evaluation-corpus-v1.0.1-143 | legacy-package-retrieval-runtime | 0.323413 | 0.500000 | 0.700000 | 0.805556 | 0.130000 |
| c157_legacy | production-migration-seed-v1.1.0-157 | legacy-package-retrieval-runtime | 0.303571 | 0.492063 | 0.700000 | 0.794444 | 0.131111 |
| c143_production_worker | historical-evaluation-corpus-v1.0.1-143 | production-worker-pre-wp0-runtime | 0.388889 | 0.523810 | 0.738889 | 0.838889 | 0.136111 |
| c157_production_worker | production-migration-seed-v1.1.0-157 | production-worker-pre-wp0-runtime | 0.371032 | 0.515873 | 0.705556 | 0.827778 | 0.136111 |

Corpus v1.1.0 adds 14 records, changes the vocabulary, and regenerates 37 existing search documents while leaving all 143 existing record objects and all 14 join routes unchanged.

The machine-readable matrix contains macro/micro numerators and denominators, safety counts, all rank cutoffs, and difference-in-differences attribution.
