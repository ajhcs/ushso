# Limited publication review

This packet proposes P01–P06 and two public identity claims for HCRIS and PHC4 inpatient discharge documentation. It contains no accepted claims, rights grants, appointments or signatures. Six other assets are explicitly deferred. The existing captures are metadata-only; receipts cannot replay their original bodies. Review the actual publisher text and the exact claim before deciding. A page title or catalog entry establishes neither payload access nor suitability for a calculation.

Edit `packet.json` to bind the current terms observations, exact scope, expiry and five separate rights actions. An unresolved or prohibited store/send/excerpt action may remain so; accepting publication requires metadata_capture and publish_metadata allowed. Public metadata scope must cover HTML, APIs, citations and exports. Terms evidence needs its actual URL, UTC checked_at, precise locator, observed receipt SHA256 and status observed. Expiry is a proposed review deadline, not a publisher grant. Reassess it explicitly. After any packet change, regenerate digests and obtain new decisions. Never copy an old signature onto a new digest.

Run from the repository root:

```sh
node scripts/source-selection-approval/review.mjs digest docs/source-selection-approval/packet.json docs/source-selection-approval/base-ledger.json
node scripts/source-selection-approval/review.mjs preview docs/source-selection-approval/packet.json docs/source-selection-approval/base-ledger.json /workspace/private-review/records.json
```

The preview is blocked until actual complete records exist. It does not create acceptance. `prepare.mjs` regenerates unsigned initial drafts only; do not run it over completed review work. Keep completed records and personal contact, consent and availability details in a private workspace location, never public assets. The checked-in blank records file intentionally has empty arrays.

## Operating appointment form

The user named Luis Barrigan, Syed Siddiqi and Cole Lyons as possible reviewers. No role, authority, availability or capacity is accepted. Each willing participant completes an actual appointment record:

```json
{"packet_digest":null,"person":null,"role":null,"capabilities":[],"accepted":null,"accepted_at":null,"capacity":null,"contact_private_ref":null,"evidence_class":null,"attestation_ref":null}
```

Capabilities are `claim_review` and/or `rights_review`. Proposed operating responsibilities also needing explicit assignment: accountable service owner; source review lead; rights/privacy reviewer; technical operator; incident/on-call and backup; usability facilitator; AI budget owner; publication approver. Record hours/week, review turnaround, absence backup and incident response expectation in capacity. Record secure contact reference and escalation route, not personal details in this repository. Accepting an appointment does not approve a claim or a release.

## Claim and rights decision forms

Copy each exact digest from the digest command. One record per proposal; duplicate decisions in one import are rejected. A correction or disagreement gets a new packet/review cycle, retaining the old records. The proposer cannot accept their own claim. Review time must follow observation and appointment; actual source support confirmation is mandatory for accepted claims.

```json
{"packet_digest":null,"proposal_id":null,"proposal_digest":null,"decision":null,"reviewer":null,"reviewer_role":null,"reviewed_at":null,"rationale":null,"source_support_confirmed":null,"evidence_class":null,"attestation_ref":null}
```

```json
{"packet_digest":null,"asset_id":null,"rights_digest":null,"decision":null,"reviewer":null,"reviewer_role":null,"reviewed_at":null,"rationale":null,"evidence_class":null,"attestation_ref":null}
```

Decisions are accept, reject, defer or conflict. `evidence_class` must be `actual_human`; this is an attestation checked against the referenced private review record by the importing operator, not cryptographic proof of identity. JSON cannot establish that someone actually signed. Synthetic tests must never be relabeled as human evidence. A conflict is retained verbatim and stored as a ledger defer with no assertion. Rejections and deferrals grant no rights. Private attestation references must remain accessible to the authorized audit owner.

Import to a local reviewed ledger only after the operator verifies the actual attestations:

```sh
node scripts/source-selection-approval/review.mjs import packet.json base-ledger.json /workspace/private-review/records.json /workspace/private-review/ledger null
```

For an existing ledger supply its exact expected revision instead of null. The immutable ledger rejects modified old records; approval creates new rights and capture IDs. Import may retain partial review outcomes; readiness remains blocked until every proposed claim and both rights reviews are accepted. Import never publishes or changes core membership. Byte captures additionally need the original bytes staged under the local ledger captures directory, where the existing ledger verifies hashes and locator spans.

## Retrieval review: twelve prospective cases

Human reviewers independently score each result: 0 incorrect/unsupported, 1 partially useful with material omissions, 2 correct source with clearly bounded support and limitations. Require all critical access/rights/join/identity statements correct, zero invented accepted claims, and at least 20/24 total before accepting this limited discovery behavior. Record query, generation, result order/IDs, source inspection, score, rationale, reviewer and UTC time. These are proposed thresholds requiring acceptance before study execution.

| Case | Domain | Question and expected boundary |
|---|---|---|
| R01 | Finance | Find hospital cost-report source; HCRIS purpose only, no selected worksheet. |
| R02 | Finance | Are all HCRIS reports audited? Preserve submitted/settled/reopened limitation. |
| R03 | Finance | Find PHC4 financial statements; deferred finance asset, no discharge substitution. |
| R04 | Ownership | Find hospital owner associations; deferred CMS owners, no accepted ownership claim. |
| R05 | Ownership | Link hospitals to systems; deferred Compendium, no name-based inferred join. |
| R06 | Ownership | Compare ownership over time; unavailable release-specific linkage remains unresolved. |
| R07 | Capacity | Find licensed beds; no accepted bed count or bed definition. |
| R08 | Capacity | Does directory imply staffed beds? No; directory candidate deferred. |
| R09 | Capacity | Compare beds across hospitals; require release, type, period and coverage. |
| R10 | Utilization | Find PA inpatient discharges; PHC4 grain and facility geography bounded. |
| R11 | Utilization | Estimate resident-region rate; preserve facility-region/residence distinction. |
| R12 | Utilization | Download paid discharge records; purchase-information route is not acquired access. |

## Usability protocol and private records

Six tasks: (U01) find a finance candidate; (U02) locate evidence supporting its limitation; (U03) explain PHC4 facility versus residence geography; (U04) distinguish purchase route from authorized access; (U05) identify an unresolved bed/ownership claim; (U06) export citations and identify generation and review status. Prospectively score unassisted completion 0/1, time in seconds, errors and confidence 1–5. Require at least 5/6 unassisted completion overall across six tasks assigned to three consenting participants, zero false authorization interpretations, and explicit human adjudication of failures. Recruit actual intended users; synthetic walkthroughs qualify software only. No participant recruitment is authorized by this packet.

Before study execution record actual protocol approval, recruitment owner, participant inclusion criteria and planned sample/coverage. Private consent record: participant pseudonym; consent form/version and timestamp; voluntary participation; withdrawal route/deadline; recording permission separately; accessibility needs optionally; retention deadline; access owner; deletion date/receipt. Proposed retention is 90 days after adjudication for recordings and identifiable notes, subject to participant and institutional approval. Public summaries must omit contact details and raw recordings. No completed consent or study data exists here.

## AI and generation gates

Engineering proposal: Meta direct Responses, muse-ember-1.0 Standard, store:false. This does not claim zero provider retention. Proposed evaluation ceiling $20, maximum $1/job including at most one retry; a later $20/month operating ceiling needs separate approval. Bind exact permitted capture hashes, allowed send_to_provider rights, evaluation cases/rubric, actual budget owner, provider-terms review, dates and expenditure ledger. Do not infer consent to paid calls from a selected provider or budget proposal.

The AI engine owns its per-job authorization contract: `{action:"execute_paid_draft",job_id,capture_sha256,reserved_micro_usd,config_sha256,rights_sha256,ledger_directory,ledger_id,budget_scope_id,approver,role,issued_at,expires_at,attestation}`. See `packages/source-selection-ai` and its documentation for validation and final paths. The private signed approval must support that exact job; enabling config, sufficient funds, rights, consent and evaluation acceptance remain independent prerequisites. Machine drafts never become accepted claims without this human review process.

Exact-generation approval is a separate actual record binding generation_id, ledger revision, bundle hash, rights policy hash, retained application inventory_sha256, deployment target, approved operation, reviewer authority, UTC timestamp, expiry and rollback reference. Production go-live requires explicit user scope and operational acceptance. A ready preview, local import, synthetic test, deployed code or paid job cannot stand in for this record.

## Release evidence records

The `records.release_reviews` object remains empty until actual work occurs. Readiness requires `independent_challenges` (one per exact proposal digest; different person from primary reviewer and proposer), `retrieval`, `usability`, `restore` and `operations`. Each uses the same actual-human reviewer, role, UTC time, rationale, packet_digest and attestation fields above, plus decision accept. Appointments must explicitly accept the corresponding capabilities: independent_challenge, evaluation_review, technical_review or operational_acceptance.

Retrieval requires a private results reference and SHA256 plus twelve `cases` with case_id R01–R12, integer score 0–2 and critical_error false. Usability requires private results reference/SHA256, consent_private_ref, retention_until and six `tasks` with task_id U01–U06, private participant_id (three distinct consenting users across six tasks), unassisted_completion boolean and false_authorization false. Restore requires receipt_ref, receipt_sha256 and outcome pass. Operations requires on_call_private_ref, capacity_private_ref and backup_private_ref. These record references are audited by the importing operator; the validator checks structure and scope, not truth or identity. No synthetic, mock, or rehearsed human results count toward acceptance.

The final production approver must hold an actual accepted appointment for the same packet, name and role with explicit `release_authorization` capability. Final approval must occur after that appointment and every completed claim, rights, independent challenge, retrieval, usability, restore and operations review. The standalone generation validator checks digest/target/time binding only; the production handoff additionally enforces this accepted authority and chronology.
