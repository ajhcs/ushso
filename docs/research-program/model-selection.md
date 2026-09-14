# Model selection for residual extraction

This note records the PR-027 offline comparison of two exact model IDs:

- `deepseek/deepseek-chat`
- `meta/muse-spark-1.3-contributor`

The comparison uses independently frozen held-out labels in `evaluation/enrichment/labels.held-out.json`. Public prompts in `evaluation/enrichment/tasks.public.json` do not include those labels. Model output is not gold.

## Gate

Routine publication eligibility requires:

- held-out precision ≥ 0.98
- zero critical scientific errors overall and per task class
- 100% of accepted claims have resolvable citations

A model that fails a task class is disabled for that class. Cheap tokens and inter-model agreement do not override the gate.

## Offline result (fixture)

Both recorded models fail at least one class on this bounded fixture (DeepSeek date-role confusion; Muse guessed a missing publisher document). Neither is publication-eligible. Deterministic collection remains operational. Muse Contributor remains privacy-incompatible for residual transmission. R14 remains unaccepted.

Live OpenRouter calls are forbidden. A `--live` invocation reports the exact model IDs, endpoint, and total spend of zero without sending HTTP.
