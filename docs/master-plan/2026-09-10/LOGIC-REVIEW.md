# Decomposition and acceptance review

This review asks whether each layer contributes the evidence required by the next. It accompanies the automatically checked [dependency model](plan.json); it is a design argument, not evidence that the future implementation works.

## Sub-phase contracts

Each row identifies the three constituent contributions and the evidence that closes the sub-phase. Read the corresponding PR packets for exact owned paths, commit instructions and checks. All listed dependencies must be available; the table does not override the dependency graph.

| Sub-phase | Contribution of its PRs, in order | Required closure evidence |
|---|---|---|
| 1A | 001 identifies the implementation subject; 002 fixes denominators; 003 establishes handoffs | Baseline SHA/artifact map, frozen source/task cohorts and a validated sample handoff |
| 1B | 004 separates field/attempt states; 005 corrects clock and inference labels; 006 reconciles excluded records and facets | Complete baseline disposition and decisive regression cases for overdue evidence, inferred grain and unknown-only filters |
| 1C | 007 identifies releases/distributions; 008 separates wire names from meaning; 009 sets storage and collection bounds | Versioned linked entity fixtures and a reconciled architecture decision with explicit retention/cost limits |
| 2A | 010 persists jobs; 011 classifies responses; 012 schedules within quotas | Actual restart/retry tests without duplicated work, plus the Census 200/HTML and ordinary access-failure cases |
| 2B | 013 extracts CMS; 014 extracts CDC; 015 extracts Census | Source-specific metadata fixtures and capture receipts covering all three baseline source classes |
| 2C | 016 routes documents; 017 binds exact keys; 018 extracts literal meanings | Parser-family coverage, the HCRIS 11-name reconciliation, and field semantics with exact source pointers |
| 2D | 019 executes bounded examples; 020 processes the complete inventory; 021 reconciles deficits | All 3,434 IDs have attempted/blocked/ineligible dispositions; an evidenced residual manifest and dictionary-yield denominator exist |
| 3A | 022 provides the model adapter; 023 constrains routing/data policy; 024 reserves and reconciles spend | Exact model/endpoint records, disallowed-input rejection and concurrent budget-boundary tests |
| 3B | 025 scopes residual evidence; 026 validates cited proposals; 027 compares models | Frozen independently adjudicated tasks, output/usage receipts, precision and critical-error results by task/source class |
| 3C | 028 records claim review; 029 promotes under defined rules; 030 publishes coherently | Rejected/accepted/conflicting claim histories and one generation whose human, machine and dictionary identities agree |
| 4A | 031 defines grain/dates; 032 defines measures/denominators; 033 constructs source cards | Evidence-backed cards distinguishing release, observation period, population, units and interpretation |
| 4B | 034 types identifiers; 035 captures authoritative mappings; 036 qualifies joins | Fifteen route-specific compatibility receipts, with cardinality, time and unmatched denominators |
| 4C | 037 resolves source families; 038 respects scientific constraints; 039 evaluates retrieval | Current-generation held-out results, including the maternal/infant and absent-source failures, with fixed denominators |
| 4D | 040 measures core readiness; 041 packages examples; 042 qualifies the complete cohort | 100 product-level cards and required sample/manual routes pass; examples replay after P5 intake has landed |
| 5A | 043 adds five federal families; 044 adds four state/closure families; 045 adds three survey/restricted families | Twelve family-level intake records, supported access directions and no restricted-payload access claim |
| 5B | 046 locates hospital files; 047 parses JSON; 048 parses wide/tall CSV | Twenty-five hospital dispositions, pinned schema fixtures and exact cross-format example comparisons |
| 5C | 049 locates payer indexes; 050 parses rate samples; 051 resolves provider references | Ten reporting-entity dispositions and bounded rate/reference evidence within the same file/release context |
| 5D | 052 checks price meaning; 053 publishes profiles; 054 qualifies pricing workflows | At least 20 hospital/eight payer parsed samples and two tested pricing examples with scope limitations |
| 6A | 055 returns real contexts; 056 returns tested routes; 057 exposes contextual variables | A client can obtain IDs from get_asset and successfully use them in follow-up calls without guessing |
| 6B | 058 publishes matching contracts; 059 implements ordinary recovery; 060 verifies installation | Self-consistent schemas/examples, pagination/generation recovery and an actual clean MCP setup transcript |
| 6C | 061 exposes comparison/packets; 062 gates plan compilation; 063 verifies transports | Actual HTTP, stdio MCP and native WebMCP responses on the same generation; positive and honest negative cases |
| 7A | 064 creates understandable navigation; 065 improves search; 066 completes source detail | Rendered beginner/expert journeys over populated source facts, with usable filters and real next steps |
| 7B | 067 saves a shortlist; 068 compares sources; 069 exports citations/packets | A saved selection can be revisited, compared and handed to another user with its generation/provenance intact |
| 7C | 070 teaches starting workflows; 071 explains advanced methods; 072 completes accountability | Tested examples in linked guides and verified operator/editorial facts; no invented organizational disclosure |
| 7D | 073 checks accessibility; 074 checks devices/discovery; 075 applies final frontend review | Keyboard/assistive-technology and browser receipts, mobile screenshots and source content available without JavaScript |
| 8A | 076 operates refresh; 077 measures capacity/cost; 078 rehearses recovery | Scheduled job history, resource/spend measurements and recovery of the exact last good generation |
| 8B | 079 independently checks data; 080 observes real users; 081 reconciles the evidence | Requirement-by-requirement pass/deficit ledger with novice/advanced task results and no hidden unmet target |
| 8C | 082 gates the exact candidate; 083 deploys the authorized artifact; 084 observes operation | Artifact identity, post-deploy checks, two scheduled cycles and the actual 14-day observation record |

## Phase composition

P1 establishes what a source claim and a successful check mean. P2 produces that evidence at catalog scale. P3 handles evidence that deterministic processing cannot interpret and promotes only qualified claims. P4 turns accepted metadata into scientific decisions, joins and examples. P5 supplies the missing research families and both MRF systems. P6 makes those capabilities usable by agents; P7 makes them usable by people. P8 verifies that the combined product remains correct and maintainable after publication.

These capabilities overlap in time. P4 modeling and examples feed P5, while **P4's final cohort qualification consumes P5's completed intake**. The initial draft omitted that last dependency; this review added PR-043, PR-044, PR-045 and PR-054 to PR-042 and a validator assertion to prevent recurrence. There is no cycle: P5 consumes PR-041's example contract, not PR-042's final qualification.

P6 and P7 can develop from accepted intermediate artifacts. They cannot satisfy final parity and usability acceptance using empty placeholder cards. Operational plumbing can develop early; sustained-operation qualification occurs on the reviewed deployed product.

## What can be established formally

Let `C`, `P`, `S` and `F` be the sets of commits, PRs, sub-phases and phases. Parent functions `c_to_p`, `p_to_s` and `s_to_f` are total and single-valued. The validator checks their coverage and identity constraints. Every PR specifies at least one acceptance requirement and finding, three distinct coherent commits, owned paths, acceptance statements and verification instructions.

Let `G=(P,E)` contain an edge from a prerequisite to its consumer. The validator establishes that G is acyclic and every PR has a path to PR-084. Final release PR-082 consumes all implementation work through PR-081. This prevents an omitted branch of the work model from disappearing from release review.

For PR `p`, completion requires `merged(p) AND producer_checks(p) AND reviewer_accepts(p) AND evidence_bound_to_head(p)`. Sub-phase closure additionally requires its tabled outcome; it is not simply an AND of merge states. Product acceptance requires all R01–R16 predicates evaluated on the accepted candidate and observation window.

The numerical targets are acceptance predicates to be measured later. They are not mathematical consequences of a dependency graph. The 100-product cohort, MRF locators, adjudicated query set and participant recruitment are still implementation inputs. Unknown source exceptions can require additional PRs. The [exception template](templates/exception-pr.md) preserves parent requirements, dependency closure and evidence rules when that happens.

## Checks against misleading completion

- Catalog coverage, attempted checks, successful samples, qualified dictionaries and scientifically usable products use separate denominators.
- R06's publisher-accessible dictionary denominator requires evidence. An extraction failure cannot be relabeled publisher absence to improve yield.
- Current-source retrieval and full-universe retrieval are reported separately. Removing absent families or difficult questions from a benchmark requires an explicit versioned change.
- AI precision is evaluated against independently adjudicated claims, with sample sizes, confidence intervals and critical-error classes. Cheap calls or model consensus do not meet R14.
- An MRF partial parse reports its actual scope. File existence and a successful gzip prefix do not meet full-file validation.
- R12 needs real participants. R15 needs elapsed operation. Neither can be replaced with generated transcripts or simulated dates.
- Astra's authored changes are identified as such; independent authorship review cannot be claimed for the same actor's own patch. See the execution protocol.

Result: the decomposition provides a traceable, feasible route to every proposed requirement, with explicit external inputs and empirical gates. It does not claim certainty about unseen publisher formats or pre-authorize a reduced goal when a target proves difficult.


## Bounded CI remediation added during execution

PR-085 adds three commits under P1/1A after CI run 34541539731 exposed a stale WP0 approval subject. The initial 84 PRs and 252 planned commits are retained; the model at that checkpoint contained 85 PRs and 255 planned commits across the same eight phases and 28 sub-phases. Initial sub-phase membership remains intact, with PR-085 explicitly added to 1A. PR-082 also depends on PR-085.

The correction must preserve immutable historical approval, run the current technical checks with fresh code/hash identities, and leave current-subject successor approval separate from development CI. It does not lower R01–R16 thresholds, change frozen cohorts, grant scientific approval, or authorize production. See the PR-085 packet and the evidence-backed exception record in docs/research-program/exceptions/PR-085-ci-attestation.md.


## Bounded WP11 current-input follow-up

PR-086 adds three planned commits under P1/1A after PR-005 exposed 11 changed historical input pins beyond the two prior package transitions. The current model contains 86 PRs and 258 planned commits; the initial 84-PR/252-commit model, eight phases, 28 sub-phases and frozen acceptance cohorts remain intact. PR-086 depends on accepted PR-003 and PR-085. PR-005 integration and PR-082 release qualification consume PR-086. Earlier PR-005 producer heads retain the original packet and dependency provenance; this new edge governs integration acceptance after discovery.

An independent Grok design review and controller byte audit recovered all 154 original inputs (1,347,732 bytes) matching the sealed WP11 receipt. The new assignment retains those preimages outside the historical package and checks actual current bytes in separate pending technical and wrapper subjects. Historical approvals, the technical builder/validator, general runner, frozen cohorts and disabled features stay immutable. Missing original bytes, incomplete snapshots, current technical failures and approval overclaims remain failures. Current implementation and combined-candidate qualification are still required. See [PR-086](prs/PR-086.md).
