# PR #12 evidence corrections

The merge review found accepted invented literals, quotations with invalid passage/span bindings, and later pages given the first page's header and denominator. The corrected implementation rejects unsupported proposals and preserves each page's source context.

Quotation spans use UTF-16 offsets into the original `source_bytes` string. A cited chunk must have an unambiguous source range containing that exact span; injected prompt headings are not source evidence. Every cited passage must resolve. Literal, table, unit, and definition values must occur as whole terms in the quotation. This technical acceptance does not certify scientific meaning. Abstentions never become accepted facts.

Page-local header/denominator values take precedence over explicitly supplied shared defaults. Absent page context stays unknown; no context is implicitly inherited from the first page. Chunks carry source ranges, and task/cache identities include corrected context and source release under builder v2. Source bytes and recorded model evaluation outputs are unchanged.

`review.json` binds the root-authored fix, separate reviewer approval, focused tests, original failures, and offline evaluation replay by exact identities and hashes. All 18 focused tests passed; independent review also checked four numeric edge cases. The replay remains publication-ineligible, with no model selected and R14 unaccepted. Historical receipts remain as evidence of their original runs; this additive review records current applicability for PR025–PR028.

Full local gate and hosted CI must qualify the final PR head separately before merge. This packet does not authorize deployment or complete the research program's scientific requirements.
