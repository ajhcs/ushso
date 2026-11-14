# Meta Muse Ember: implementation evidence and unresolved account decisions

Checked 2026-11-14 against first-party documentation. This records public API
documentation, not a successful authenticated request, account eligibility,
provider contract acceptance, or authorization to incur charges.

| Implementation fact | First-party source |
| --- | --- |
| Direct endpoint `https://api.meta.ai/v1/responses`; Bearer authentication; model `muse-ember-1.0`; Standard mode; reasoning effort supports `minimal` | [Model documentation](https://dev.meta.ai/docs/muse-ember) |
| Up to 200,000 input tokens: USD 0.10 / million uncached input, 0.004 / million cached input, 0.50 / million output. Above that threshold the respective rates are 0.30, 0.012, and 1.50 for the whole request. | [Pricing](https://dev.meta.ai/docs/pricing-rate-limits) |
| `store` defaults to true, so the adapter must explicitly send false. `max_output_tokens` includes reasoning. Parse text from response output items; `output_text` is an SDK convenience. | [Responses schema](https://dev.meta.ai/docs/api-reference/responses/schemas) |
| Structured extraction uses JSON schema in `text.format`; local validation remains necessary. | [Structured output](https://dev.meta.ai/docs/structured-output) |

The initial adapter uses text-only, stateless requests, bounded output and no
tools, search, uploads, or conversation continuation. Reserve at uncached rates;
cache discounts are not needed to make the spending limit hold. Pricing is an
observed snapshot and must be rechecked before paid evaluation. No account's
billing limits or credentials were inspected or changed.

`store:false` is **not zero data retention**. Standard-service content is not
used to train Meta models, but retention still follows the provider terms.
The operating owner must review the [terms](https://dev.meta.ai/legal/terms-of-service)
and approve the treatment of the specific permitted inputs. Do not fill in a
fictional retention period or assume a request option removes those obligations.

[Zero data retention](https://dev.meta.ai/legal/zero-data-retention-terms)
requires provider enablement for the actual account and has exceptions. No ZDR
entitlement has been established here. If the source permissions require ZDR,
execution must remain blocked until that account-specific evidence exists.

Human decisions still required: account owner and eligibility; current pricing;
applicable terms and retention; per-source permission to send material to Meta;
reviewer capacity; evaluation budget; and a later, separate operating approval.
The proposed USD 20 evaluation ceiling is a budget proposal, not an expenditure
or a claim that API cost alone measures the value of the workflow.
