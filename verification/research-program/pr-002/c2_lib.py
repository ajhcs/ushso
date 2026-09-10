#!/usr/bin/env python3
"""C-002-2 public task freeze, acceptance rows, and non-circular hashing."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

SEALED_MANIFEST_NAME = "evaluator-freeze-manifest-sealed-v1.json"
SEALED_MANIFEST_SHA256 = "142458d686e1cb5e9677b6a5eaa619955c78ef9a4d51735207d4ad19bf26c9ef"
SEALED_MANIFEST_BYTES = 24446
R14_PROTOCOL_NAME = "c2-r14-denominator-freeze-protocol-v2.md"
R14_PROTOCOL_SHA256 = "3a35ee6662f939bf53e9f8c5005079ac09982372d80c9b385a9beb9c52e525c7"
R14_PROTOCOL_BYTES = 6619
R14_DISPOSITION_NAME = "pr002-r14-protocol-disposition.json"
C1_COHORTS_SHA256 = "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4"
C1_COHORTS_BYTES = 2336377
C1_BUILD_RECEIPT_SHA256 = "857750c9536aa1f34a8b8b70ce9e463c912b13ca7f386fc6fc2e1e90a7ef8f6d"
C1_VERIFY_RECEIPT_SHA256 = "ec9aad31a65464ac3224a80930d548c2069fd5a4ebf80626e62495eea48a0244"
C1_CATALOG_SHA256 = "5183f7ac32aeaaa0402965c9658ca1e048ebcbaea18a57cc20a542850e222684"
C1_PRODUCER = "44506be8052e1054641048de68893fc41526b664"
C1_CORRECTION = "ef9c2569b78dd26f0436d2ea945a8e1b791b8698"
EXPECTED_GENERATION = "live-2026-09-03-85b50522b420"
EXPECTED_MANIFEST = "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e"
REQUIREMENT_IDS = tuple(f"R{i:02d}" for i in range(1, 17))
C1_IDENTITY_FIELDS = (
    "format",
    "pr_id",
    "base",
    "corpus",
    "predecessor",
    "domains",
    "products",
    "baseline_records",
    "resolution",
)
AUDIENCE_COUNTS = {"novice": 10, "advanced": 17, "machine": 13}
DOMAIN_COUNT = 10
TASKS_PER_DOMAIN = 4
TASK_COUNT = 40
INTENTION_SLOTS = 49
PRIVATE_FIELDS = (
    "query",
    "prompt",
    "raw_prompt",
    "question",
    "label",
    "labels",
    "gold",
    "gold_labels",
    "answer",
    "answer_id",
    "answer_ids",
    "expected_id",
    "expected_ids",
    "holdout_label",
)
HISTORICAL_RECEIPT_NAMES = ("c1-build-receipt.json", "c1-verify-receipt.json")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def extract_c1_projection(payload: dict) -> dict:
    return {field: payload[field] for field in C1_IDENTITY_FIELDS}


def load_sealed_manifest(here: Path = HERE) -> dict:
    path = here / SEALED_MANIFEST_NAME
    if digest(path) != SEALED_MANIFEST_SHA256:
        raise SystemExit(f"sealed evaluator manifest hash mismatch: {digest(path)}")
    if path.stat().st_size != SEALED_MANIFEST_BYTES:
        raise SystemExit("sealed evaluator manifest size mismatch")
    return load_json(path)


def public_task_index(sealed: dict) -> list[dict]:
    tasks = []
    for item in sealed["task_index"]:
        tasks.append({
            "task_id": item["taskID"],
            "audience": item["audience"],
            "domain": item["domain"],
            "label_access": "inaccessible_to_implementer_tuning",
            "raw_prompt_included": False,
            "gold_labels_included": False,
            "scientific_gold": False,
            "r14_claim_gold": False,
        })
    return tasks


def hash_scheme() -> dict:
    return load_json(HERE / "hash-scheme.json")


def negative_case_types() -> list[dict]:
    fixtures = load_json(HERE / "negative-selector-fixtures.json")
    return [
        {
            "id": item["id"],
            "type": item["selector"],
            "public_contract": item["reason"],
            "expected": item["expected"],
        }
        for item in fixtures["fixtures"]
    ]


def r07_public_contract() -> dict:
    return {
        "present_source_recall_at_10": {
            "aggregation": "task_macro",
            "threshold": 0.90,
            "report_micro_alongside": True,
            "eligibility": "Current-generation frozen present-source target bindings, versioned before scoring.",
        },
        "judged_precision_at_5": {
            "aggregation": "task_macro",
            "threshold": 0.80,
            "report_micro_alongside": True,
            "judgment_rule": "Every returned top-five result requires an independent blind judgment. Any unresolved returned top-five item blocks precision acceptance.",
        },
        "critical_forbidden_matches": {
            "threshold": 0,
            "examples": [
                "HCRIS treated as PHC4",
                "maternal mortality substituted with infant mortality",
                "ACS geography grain or year confusion presented as exact coverage",
                "nursing staffing source/grain confusion",
                "published charge or negotiated rate treated as a patient bill or utilization-weighted payment",
                "CCN=NPI or name-only join",
            ],
        },
        "full_intention_recall": {
            "slots": INTENTION_SLOTS,
            "tasks": TASK_COUNT,
            "numeric_threshold": None,
            "reporting": "Report all 49 fixed target slots across 40 tasks separately. No invented numeric threshold.",
        },
        "not_denominators": [
            "The 3,434 catalog IDs are not a retrieval relevance denominator.",
            "The 40 retrieval tasks are not an R14 scientific-claim gold set.",
        ],
        "uncertainty_rule": "Reviewer uncertainty blocks acceptance. Model agreement cannot supply labels.",
    }


def r14_public_contract() -> dict:
    return {
        "protocol_path": f"verification/research-program/pr-002/{R14_PROTOCOL_NAME}",
        "protocol_sha256": R14_PROTOCOL_SHA256,
        "disposition_path": f"verification/research-program/pr-002/{R14_DISPOSITION_NAME}",
        "status": "protocol_published_not_materialized",
        "stage_order": [
            "C2 publishes the protocol and unaccepted R14 row.",
            "PR-020 C-020-3 produces the actual residual frame.",
            "PR-027 C-027-1 independently freezes scientific claim targets before comparison calls or results.",
            "PR-027 C-027-2/C-027-3 execute and evaluate model outputs against that freeze.",
            "R14 quality gates promotion, not creation of the comparison itself.",
        ],
        "not_adopted": [
            "The 40 retrieval tasks are not R14 claim gold.",
            "The illustrative 149 iid count is not an adopted sample-size or CI threshold.",
        ],
        "thresholds_when_later_measured": {
            "held_out_claim_precision": 0.98,
            "critical_scientific_errors": 0,
            "accepted_claim_citation_and_schema_checks": 1.0,
        },
        "paid_enrichment": "Requires an actually selected product budget and credentials. This commit does not call product models.",
        "materialized": False,
        "frozen_sample": False,
    }


def build_tasks_payload(repo: Path, here: Path = HERE) -> dict:
    sealed = load_sealed_manifest(here)
    protocol = here / R14_PROTOCOL_NAME
    if digest(protocol) != R14_PROTOCOL_SHA256:
        raise SystemExit(f"R14 protocol hash mismatch: {digest(protocol)}")
    cohorts_path = repo / "evaluation/research-program/cohorts.json"
    cohorts_sha = digest(cohorts_path)
    tasks = public_task_index(sealed)
    counts = sealed["counts"]
    return {
        "format": "ushso.research-program.tasks.v1",
        "pr_id": "PR-002",
        "commit_id": "C-002-2",
        "status": "public_opaque_task_index_frozen",
        "claim_boundary": (
            "C-002-2 freezes the public opaque 40-task index, negative-case types, "
            "R01-R16 unaccepted measurable rows, and the R14 protocol. It does not "
            "publish raw holdout prompts or labels, does not accept R01-R16, and "
            "does not materialize the R14 residual sample."
        ),
        "hash_scheme": {
            "path": "verification/research-program/pr-002/hash-scheme.json",
            "algorithm": "SHA-256 of exact committed file bytes",
            "circularity_rule": "tasks.json cites external and earlier artifact digests only; it does not contain its own digest.",
        },
        "c1_identities": {
            "producer_commit": C1_PRODUCER,
            "correction_commit": C1_CORRECTION,
            "cohorts_path": "evaluation/research-program/cohorts.json",
            "cohorts_sha256": cohorts_sha,
            "c1_historical_cohorts_sha256": C1_COHORTS_SHA256,
            "product_count": 100,
            "baseline_record_count": 3434,
            "related_candidate_count": 185,
            "generation": EXPECTED_GENERATION,
            "catalog_manifest_sha256": EXPECTED_MANIFEST,
            "product_catalog_sha256": C1_CATALOG_SHA256,
            "rewritten_by_this_commit": False,
        },
        "evaluator_freeze": {
            "freeze_id": sealed["freeze_id"],
            "path": f"verification/research-program/pr-002/{SEALED_MANIFEST_NAME}",
            "sha256": SEALED_MANIFEST_SHA256,
            "bytes": SEALED_MANIFEST_BYTES,
            "format": sealed["format"],
            "status": sealed["status"],
            "private_artifact": {
                **sealed["private_artifact"],
                "access": "inaccessible_to_implementer_tuning",
                "not_in_git": True,
            },
            "scientific_relevance_gold": False,
            "empirical_acceptance": False,
        },
        "r14": r14_public_contract(),
        "counts": {
            "tasks": counts["tasks"],
            "by_audience": counts["by_audience"],
            "by_domain": counts["by_domain"],
            "baseline_anchor_instances": counts["baseline_anchor_instances"],
            "named_missing_family_slots": counts["named_missing_family_slots"],
            "mrf_pilot_slots": counts["mrf_pilot_slots"],
            "unique_missing_families": counts["unique_missing_families"],
            "zero_baseline_anchor_tasks": counts["zero_baseline_anchor_tasks"],
            "fixed_task_intention_slots": INTENTION_SLOTS,
        },
        "tasks": tasks,
        "negative_case_types": negative_case_types(),
        "negative_selector_fixtures_path": "verification/research-program/pr-002/negative-selector-fixtures.json",
        "holdout_boundary": {
            "raw_prompts_in_this_artifact": False,
            "labels_in_this_artifact": False,
            "implementer_tuning_access": "forbidden",
            "private_fields_rejected": list(PRIVATE_FIELDS),
        },
        "r07_public_contract": r07_public_contract(),
        "acceptance_path": "docs/research-program/acceptance.md",
        "requirement_status": {req: "unaccepted" for req in REQUIREMENT_IDS},
    }


def requirement_rows() -> list[dict]:
    common_source = {
        "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md",
        "generation": EXPECTED_GENERATION,
        "catalog_manifest_sha256": EXPECTED_MANIFEST,
        "c1_cohorts_sha256": C1_COHORTS_SHA256,
    }
    return [
        {
            "id": "R01",
            "required_outcome": "Every catalog record is accounted for.",
            "master_plan_threshold": "All 3,434 baseline IDs have a disposition; no silent loss. Each selected source run reconciles enumerated, accepted, unchanged, failed, restricted, and unresolved counts.",
            "denominator": "3,434 frozen baseline record IDs from generation live-2026-09-03-85b50522b420.",
            "numerator_or_pass_predicate": "Pass iff every baseline ID has a typed disposition and selected = succeeded + unchanged + failed + restricted + unavailable + unresolved + not_attempted, with no silent deletions.",
            "frame": "Frozen C1 identity set. Source-run dispositions are a conditional frame until PR-020 materializes them.",
            "frame_state": "identities_frozen_dispositions_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "PR-020 / PR-006 for isolated records; PR-002 C-002-1 for identity freeze.",
            "evidence_destination": "evaluation/research-program/cohorts.json baseline_records; later source-run ledger from PR-020.",
            "materialize_before_tuning": "PR-020 must freeze complete dispositions before any coverage tuning that cites R01.",
            "status": "unaccepted",
        },
        {
            "id": "R02",
            "required_outcome": "Evidence labels are accurate.",
            "master_plan_threshold": "Every public factual field has its source/revision and evidence state; inferred tags never become observed grain; freshness advances with the actual evaluation time.",
            "denominator": "Public factual fields on the accepted generation after PR-004/PR-005 contracts exist.",
            "numerator_or_pass_predicate": "Pass iff 100% of those fields carry source/revision and evidence state, inferred tags are not observed grain, and freshness equals actual evaluation time.",
            "frame": "Conditional field-evidence contract. Not frozen because this protocol/row exists.",
            "frame_state": "conditional_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "PR-004, PR-005",
            "evidence_destination": "packages/identity and coverage artifacts owned by those PRs.",
            "materialize_before_tuning": "Field-state contract and clock correction must be frozen before measurement that cites R02.",
            "status": "unaccepted",
        },
        {
            "id": "R03",
            "required_outcome": "Every record has a test disposition.",
            "master_plan_threshold": "100% have an eligibility decision and latest attempt or specific stop reason for metadata, documentation, API/file sample, and schema binding; not_attempted is not success.",
            "denominator": "3,434 records × four axes (metadata, documentation, API/file sample, schema binding).",
            "numerator_or_pass_predicate": "Pass iff every axis on every record has eligibility plus latest attempt or stop reason. not_attempted is not success.",
            "frame": "Conditional attempt frame materialized by PR-020. C1 seeds source_run_disposition=not_attempted.",
            "frame_state": "conditional_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "PR-020",
            "evidence_destination": "PR-020 inventory/disposition artifacts.",
            "materialize_before_tuning": "Attempt ledger must be frozen before R03 measurement or routing.",
            "status": "unaccepted",
        },
        {
            "id": "R04",
            "required_outcome": "Core research sources are usable.",
            "master_plan_threshold": "Frozen 100-product cohort has complete mandatory source cards. At least 80 publicly accessible products have a recent successful bounded sample and exact technical recipe; remaining cohort members have verified restricted/manual access routes. Record versions are not extra products.",
            "denominator": "100 frozen product identities from C-002-1. Public-sample target uses the public-access subset of that same 100; it does not redefine the cohort.",
            "numerator_or_pass_predicate": "Pass iff all 100 have complete mandatory source cards, at least 80 public-access members have recent successful bounded samples plus exact recipes, and every remaining member has a verified restricted/manual route. Shortfall is reported; the cohort is not quietly redefined.",
            "frame": "Product identities frozen. Usability evidence is conditional until PR-042 after P5 intake.",
            "frame_state": "identities_frozen_usability_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "PR-040, PR-042; P5 intake PR-043/044/045/054",
            "evidence_destination": "evaluation/research-program/cohorts.json products; later source-card artifacts.",
            "materialize_before_tuning": "Do not retune the 100-product set to hit 80. Measure against this freeze.",
            "status": "unaccepted",
        },
        {
            "id": "R05",
            "required_outcome": "Variables mean something.",
            "master_plan_threshold": "For every selected priority release, 100% of fields used in its example are bound to exact wire names, documented meaning, type state, unit or reasoned not-applicable state, allowed values/missingness where relevant, and provenance. Unknown optional fields stay visible.",
            "denominator": "Fields used in each frozen priority-product example after those examples exist.",
            "numerator_or_pass_predicate": "Pass iff 100% of those example fields are bound as specified. Unknown optional fields remain visible rather than dropped.",
            "frame": "Conditional example-field frame. Not materialized on C2.",
            "frame_state": "conditional_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "PR-008, PR-017, PR-018, PR-041",
            "evidence_destination": "variable/example artifacts owned by those PRs.",
            "materialize_before_tuning": "Example field sets must be frozen before R05 scoring.",
            "status": "unaccepted",
        },
        {
            "id": "R06",
            "required_outcome": "Broader extraction improves materially.",
            "master_plan_threshold": "At least 95% of baseline records with publisher-accessible dictionaries yield a qualified parsed dictionary; the eligible denominator is explicitly evidenced. All other baseline records retain a reason and next action. This does not imply 95% of all fields have documented definitions.",
            "denominator": "Baseline records with an evidenced publisher-accessible dictionary. Extraction failure cannot be relabeled publisher absence.",
            "numerator_or_pass_predicate": "Pass iff parsed / evidenced-eligible >= 0.95 and every ineligible/failed record has a reason and next action.",
            "frame": "Conditional eligible-dictionary frame from PR-020/PR-018. Not frozen now.",
            "frame_state": "conditional_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "PR-018, PR-020, PR-021",
            "evidence_destination": "dictionary yield ledger from those PRs.",
            "materialize_before_tuning": "Eligible denominator must be frozen before yield measurement.",
            "status": "unaccepted",
        },
        {
            "id": "R07",
            "required_outcome": "Research retrieval is measured.",
            "master_plan_threshold": "Current-generation, frozen present-source recall@10 >=0.90; judged precision@5 >=0.80; zero critical forbidden matches; separately report full-universe recall and source absence. Publish task-level failures and reviewer uncertainty.",
            "denominator": "Present-source recall: current-generation eligible present-source tasks/targets after versioned bindings. Precision: independently judged returned top-five items. Full-intention recall: all 49 fixed target slots across 40 tasks. Catalog 3,434 IDs are not this denominator.",
            "numerator_or_pass_predicate": "Pass iff present-source recall@10 task-macro >= 0.90, blind judged precision@5 task-macro >= 0.80, and critical forbidden matches = 0. Report target/item micro alongside. Full-intention recall is reported for all 49 slots with no numeric threshold. Every returned top-five item has an independent blind judgment; any unresolved judgment blocks acceptance.",
            "frame": "Public opaque 40-task index frozen (10 novice / 17 advanced / 13 machine; four per domain). Private labels remain inaccessible. Present-source eligible set is generation-specific and not fully materialized until later bindings.",
            "frame_state": "public_task_index_frozen_labels_inaccessible_present_source_conditional",
            "source_generation_identity": {
                **common_source,
                "evaluator_freeze_manifest_sha256": SEALED_MANIFEST_SHA256,
                "tasks_path": "evaluation/research-program/tasks.json",
            },
            "evidence_owner": "PR-039 measures retrieval against this freeze; independent judges own labels.",
            "evidence_destination": "evaluation/research-program/tasks.json; later PR-039 receipts.",
            "materialize_before_tuning": "Task index, scoring rules, and later present-source bindings must be frozen before retrieval tuning or measurement. Do not drop difficult tasks.",
            "status": "unaccepted",
        },
        {
            "id": "R08",
            "required_outcome": "Linkage is evidence-based.",
            "master_plan_threshold": "At least 15 priority join routes, spanning facility and geographic linkage, have source/release/key context, cardinality checks, matched/unmatched denominators, temporal constraints, and limitations. Unsupported CCN=NPI and name-only equality are rejected.",
            "denominator": "A later frozen set of at least 15 priority join routes spanning facility and geographic linkage.",
            "numerator_or_pass_predicate": "Pass iff >=15 routes have the required evidence and CCN=NPI and name-only equality remain rejected.",
            "frame": "Conditional join-route frame. Not materialized on C2.",
            "frame_state": "conditional_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "PR-034, PR-035, PR-036",
            "evidence_destination": "join-route receipts owned by those PRs.",
            "materialize_before_tuning": "Join-route identities must be frozen before linkage scoring.",
            "status": "unaccepted",
        },
        {
            "id": "R09",
            "required_outcome": "Major coverage gaps are addressed.",
            "master_plan_threshold": "Add the twelve named source families with supported identities/access routes and explicit data scope. A restricted source is useful as a verified route, without pretending to have its payload.",
            "denominator": "The twelve named families frozen by C-002-3 as intake pointers.",
            "numerator_or_pass_predicate": "Pass iff each family has supported identity/access route evidence and explicit scope. Restricted payload retrieval is not implied.",
            "frame": "C-002-3 publishes family pointers, candidate locators, and intake PRs. Actual source identities remain unverified locators until PR-043/044/045.",
            "frame_state": "conditional_until_C3_pointers_then_intake_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "C-002-3 pointers; PR-043, PR-044, PR-045 intake.",
            "evidence_destination": "evaluation/research-program/cohorts.json expansion families; later intake artifacts.",
            "materialize_before_tuning": "Family set cannot be swapped for easier sources. Locators stay candidates until captured.",
            "status": "unaccepted",
        },
        {
            "id": "R10",
            "required_outcome": "MRFs are a real product layer.",
            "master_plan_threshold": "Pilot directory covers 25 hospitals and 10 payer reporting entities from a frozen selection; every item has an evidence-backed locator/disposition. At least 20 hospital and eight payer entries have a successfully parsed bounded sample; no substitution of enforcement datasets for rate files.",
            "denominator": "25 hospital candidate IDs and 10 payer candidate IDs frozen by C-002-3, retained even if unavailable, ineligible, or sharing a file. Parsed-sample targets remain >=20 hospital and >=8 payer of that same denominator.",
            "numerator_or_pass_predicate": "Pass iff all 25/10 have locator/disposition evidence and >=20 / >=8 have successfully parsed bounded samples. Enforcement datasets cannot substitute. No silent replacement or deletion.",
            "frame": "C-002-3 freezes candidate IDs/order/counts from the sealed directory selection. Locators, eligibility, file binding, and parsed samples are unresolved downstream bindings.",
            "frame_state": "ids_pending_C3_locators_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "C-002-3 IDs; PR-046/PR-049 locators; PR-047/048/050/051 parse; PR-054 qualification.",
            "evidence_destination": "cohorts.json mrf_selection; later MRF receipts.",
            "materialize_before_tuning": "Freeze 25/10 IDs before any endpoint result. Later PRs consume them without replacement.",
            "status": "unaccepted",
        },
        {
            "id": "R11",
            "required_outcome": "Machine and human outputs agree.",
            "master_plan_threshold": "All eight existing tools have positive and honest negative cases. For each priority example, IDs, release/schema context, field meanings, access state and citations agree across HTTP, MCP, WebMCP, and UI.",
            "denominator": "Eight existing tools plus later frozen priority examples.",
            "numerator_or_pass_predicate": "Pass iff each tool has positive and honest negative cases and cross-surface fields agree on each priority example.",
            "frame": "Conditional tool/example frame. Not materialized on C2.",
            "frame_state": "conditional_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "PR-061, PR-063, PR-066",
            "evidence_destination": "cross-surface receipts owned by those PRs.",
            "materialize_before_tuning": "Tool and example identities must be frozen before parity scoring.",
            "status": "unaccepted",
        },
        {
            "id": "R12",
            "required_outcome": "Beginners and experts can finish tasks.",
            "master_plan_threshold": "Eight novice and eight advanced moderated participants, distinct from implementers, attempt a frozen set of tasks; >=85% completion in each group, no critical misinterpretation of access/grain/price semantics. Synthetic agent runs are separate evidence.",
            "denominator": "Eight actual novice participants and eight actual advanced participants, distinct from implementers, assigned to a frozen task/session map.",
            "numerator_or_pass_predicate": "Pass iff completion >= 0.85 in each group and critical misinterpretation = 0. Missing sessions and untested tasks remain visible. Simulations and generated participants do not count.",
            "frame": "Task pool is the frozen public opaque index. Participant identities, assignments, and success rules are a conditional frame that must be frozen before the study. Not materialized on C2.",
            "frame_state": "tasks_frozen_participants_not_materialized",
            "source_generation_identity": {
                **common_source,
                "evaluator_freeze_manifest_sha256": SEALED_MANIFEST_SHA256,
            },
            "evidence_owner": "PR-080",
            "evidence_destination": "PR-080 study receipts; assignment freeze artifact before sessions.",
            "materialize_before_tuning": "Freeze participant-task assignments and success rules before the study. Do not drop untested tasks.",
            "status": "unaccepted",
        },
        {
            "id": "R13",
            "required_outcome": "Documentation is usable.",
            "master_plan_threshold": "Beginner start, researcher workflow, developer/MCP setup, access, variables, joins, MRFs, uncertainty, citations, methodology, coverage, About and corrections guides exist, are cross-linked, and use tested examples.",
            "denominator": "The named guide set in the master-plan R13 row.",
            "numerator_or_pass_predicate": "Pass iff every named guide exists, is cross-linked, and uses tested examples.",
            "frame": "Conditional documentation set. Not materialized on C2.",
            "frame_state": "conditional_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "PR-070, PR-071, PR-072",
            "evidence_destination": "guide artifacts owned by those PRs.",
            "materialize_before_tuning": "Guide list cannot be shortened to pass.",
            "status": "unaccepted",
        },
        {
            "id": "R14",
            "required_outcome": "AI enrichment is controlled and economical.",
            "master_plan_threshold": "No model in public request handling; no private data/credentials sent in enrichment; auditable token/spend ledger; 100% accepted model-derived claims pass citation and schema checks; held-out claim precision >=0.98, with zero critical scientific errors.",
            "denominator": "A later independently frozen scientific-claim sample drawn from the PR-020 residual frame. Not the 40 retrieval tasks. Sample size/CI design is chosen after that residual frame exists; the illustrative 149 iid count is not adopted.",
            "numerator_or_pass_predicate": "Protocol row is complete when this protocol, stage order, and unaccepted gate are published. Quality pass later iff held-out claim precision >= 0.98, critical scientific errors = 0 overall and in every predeclared class, 100% accepted-claim citation/schema checks, with actual sample sizes, confidence intervals, and per-source/task-class results. Unjudgeable/uncertain outcomes block acceptance. Model agreement cannot create gold labels.",
            "frame": "Protocol published. Residual frame, sample, labels, model outputs, spend ledger, and paid budget are not materialized. R14 gates promotion, not creation of the PR-027 comparison.",
            "frame_state": "protocol_published_not_materialized_not_frozen",
            "source_generation_identity": {
                **common_source,
                "r14_protocol_sha256": R14_PROTOCOL_SHA256,
            },
            "evidence_owner": "C-002-2 protocol; PR-020 residual frame; PR-027 C1 target freeze; PR-022/023/024 controls; PR-027 C2/C3 measurement.",
            "evidence_destination": f"verification/research-program/pr-002/{R14_PROTOCOL_NAME}; later PR-020/PR-027 artifacts.",
            "materialize_before_tuning": "PR-027 C1 must freeze independent targets before comparison calls/results. Do not tune routing from unfrozen model outputs. Paid enrichment requires a selected budget and credentials; this commit does not call product models.",
            "status": "unaccepted",
        },
        {
            "id": "R15",
            "required_outcome": "Refresh is sustainable.",
            "master_plan_threshold": "Two complete scheduled cycles and a 14-day observation window show bounded queues/spend/storage, timely refresh or explicit stale state, and no silent source loss. Alerts identify changed/actionable states, not routine success spam.",
            "denominator": "Two actual scheduled cycles and 14 actual elapsed observation days on the reviewed deployed product.",
            "numerator_or_pass_predicate": "Pass iff both actual cycles and the 14 actual elapsed days exist and the operational bounds hold. Generated dates and simulated operation do not count.",
            "frame": "Conditional operational window. No dates are generated here.",
            "frame_state": "conditional_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "PR-076, PR-084",
            "evidence_destination": "PR-084 observation record.",
            "materialize_before_tuning": "The window must actually elapse; it cannot be backfilled with synthetic timestamps.",
            "status": "unaccepted",
        },
        {
            "id": "R16",
            "required_outcome": "The final release is independently qualified.",
            "master_plan_threshold": "Reproducible locked build, appropriate tests, current benchmark, actual browser/client journeys, capacity check, stage-to-production artifact identity, rollback rehearsal and post-deploy checks pass on the reviewed candidate.",
            "denominator": "The independently reviewed release candidate after prior requirements have evidence.",
            "numerator_or_pass_predicate": "Pass iff each named gate passes on that exact candidate. This metadata freeze is not that candidate.",
            "frame": "Conditional release-candidate frame. Not materialized on C2.",
            "frame_state": "conditional_not_materialized",
            "source_generation_identity": common_source,
            "evidence_owner": "PR-079, PR-081, PR-082, PR-083",
            "evidence_destination": "PR-082 release packet.",
            "materialize_before_tuning": "Qualify the reviewed candidate; do not substitute a different artifact.",
            "status": "unaccepted",
        },
    ]


def render_acceptance_markdown(tasks_sha256: str | None, cohorts_sha256: str) -> str:
    rows = requirement_rows()
    lines = [
        "# Research-program acceptance contracts",
        "",
        "Status: **unaccepted** for every requirement R01–R16.",
        "",
        "This document is the C-002-2 measurable-row freeze. It preserves master-plan thresholds exactly. It does not accept any requirement, materialize conditional frames, or publish private holdout labels.",
        "",
        "## Identities",
        "",
        f"- C-002-1 producer: `{C1_PRODUCER}`",
        f"- C-002-1 correction: `{C1_CORRECTION}`",
        f"- Cohorts path: `evaluation/research-program/cohorts.json`",
        f"- Cohorts SHA-256 at this document's C2 write: `{cohorts_sha256}`",
        f"- C1 historical cohorts SHA-256: `{C1_COHORTS_SHA256}`",
        f"- Tasks path: `evaluation/research-program/tasks.json`",
        f"- Tasks SHA-256: `{tasks_sha256 or 'written after tasks.json'}`",
        f"- Sealed evaluator manifest SHA-256: `{SEALED_MANIFEST_SHA256}`",
        f"- R14 protocol SHA-256: `{R14_PROTOCOL_SHA256}`",
        f"- Generation: `{EXPECTED_GENERATION}`",
        f"- Catalog manifest SHA-256: `{EXPECTED_MANIFEST}`",
        "",
        "Hash scheme: SHA-256 of exact committed file bytes. `cohorts.json` and `tasks.json` do not contain their own digests. This document and the C2 receipt are destinations for those digests.",
        "",
        "## Frame rule",
        "",
        "A protocol, pointer, or unaccepted row is not a frozen or materialized measurement frame. Conditional frames stay unmaterialized until the named downstream PR writes identities, then independently freezes them before tuning or measurement.",
        "",
        "## R01–R16",
        "",
    ]
    for row in rows:
        lines.extend([
            f"### {row['id']} — {row['required_outcome']}",
            "",
            f"- **Master-plan threshold:** {row['master_plan_threshold']}",
            f"- **Denominator:** {row['denominator']}",
            f"- **Numerator / pass predicate:** {row['numerator_or_pass_predicate']}",
            f"- **Frozen identities or conditional frame:** {row['frame']}",
            f"- **Frame state:** `{row['frame_state']}`",
            f"- **Source / generation identity:** `{json.dumps(row['source_generation_identity'], sort_keys=True)}`",
            f"- **Evidence owner:** {row['evidence_owner']}",
            f"- **Evidence destination:** {row['evidence_destination']}",
            f"- **Materialize / freeze before tuning or measurement:** {row['materialize_before_tuning']}",
            f"- **Status:** `{row['status']}`",
            "",
        ])
    lines.extend([
        "## Public negative-case types",
        "",
        "These types are documented from the PR packet and audit without exposing private tasks:",
        "",
        "- HCRIS versus PHC4 reporting scope",
        "- Maternal versus infant mortality substitution",
        "- ACS geography grain/year confusion",
        "- Nursing staffing source/grain confusion",
        "- Price definitions: charge, negotiated rate, expected bill, utilization-weighted payment",
        "- Forbidden joins: CCN=NPI and name-only equality",
        "",
        "Holdout labels remain inaccessible to implementer tuning.",
        "",
    ])
    return "\n".join(lines)


def contains_private_fields(value, path="") -> list[str]:
    hits = []
    if isinstance(value, dict):
        for key, item in value.items():
            lowered = str(key).lower()
            next_path = f"{path}.{key}" if path else str(key)
            if lowered in PRIVATE_FIELDS:
                if next_path not in {
                    "holdout_boundary.private_fields_rejected",
                    "evaluator_freeze.private_artifact",
                    "evaluator_freeze.private_artifact.sha256",
                    "evaluator_freeze.private_artifact.size_bytes",
                    "evaluator_freeze.private_artifact.access",
                    "evaluator_freeze.private_artifact.not_in_git",
                }:
                    hits.append(next_path)
            hits.extend(contains_private_fields(item, next_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            hits.extend(contains_private_fields(item, f"{path}[{index}]"))
    return hits


def assert_task_schema(payload: dict, sealed: dict) -> list[str]:
    errors = []
    tasks = payload.get("tasks") or []
    if len(tasks) != TASK_COUNT:
        errors.append(f"task count {len(tasks)} != {TASK_COUNT}")
    ids = [item.get("task_id") for item in tasks]
    if len(set(ids)) != TASK_COUNT:
        errors.append("task IDs are not unique")
    expected_ids = [item["taskID"] for item in sealed["task_index"]]
    if ids != expected_ids:
        errors.append("task IDs or order diverge from the sealed public index")
    audiences = {}
    domains = {}
    for item in tasks:
        audiences[item.get("audience")] = audiences.get(item.get("audience"), 0) + 1
        domains[item.get("domain")] = domains.get(item.get("domain"), 0) + 1
        if item.get("raw_prompt_included") or item.get("gold_labels_included") or item.get("r14_claim_gold"):
            errors.append(f"{item.get('task_id')} leaks labels or claims R14 gold")
    if audiences != AUDIENCE_COUNTS:
        errors.append(f"audience counts {audiences} != {AUDIENCE_COUNTS}")
    if len(domains) != DOMAIN_COUNT or set(domains.values()) != {TASKS_PER_DOMAIN}:
        errors.append(f"domain counts {domains} are not four per ten domains")
    if payload.get("evaluator_freeze", {}).get("sha256") != SEALED_MANIFEST_SHA256:
        errors.append("tasks.json does not cite the sealed manifest hash")
    if payload.get("c1_identities", {}).get("c1_historical_cohorts_sha256") != C1_COHORTS_SHA256:
        errors.append("C1 historical cohorts hash was not preserved")
    if payload.get("requirement_status") != {req: "unaccepted" for req in REQUIREMENT_IDS}:
        errors.append("requirement_status must list R01-R16 as unaccepted")
    if payload.get("r14", {}).get("materialized") or payload.get("r14", {}).get("frozen_sample"):
        errors.append("R14 frame must not be marked materialized or frozen")
    private_hits = contains_private_fields(payload)
    if private_hits:
        errors.append("private field names present: " + ", ".join(private_hits[:8]))
    own = json.dumps(payload)
    if "tasks_sha256" in payload or '"sha256": "' + hashlib.sha256(own.encode()).hexdigest() in own:
        errors.append("tasks payload appears to contain a self-hash")
    return errors


def assert_acceptance_document(text: str) -> list[str]:
    errors = []
    for req in REQUIREMENT_IDS:
        if f"### {req} —" not in text:
            errors.append(f"missing {req} heading")
    required_bullets = [
        "**Master-plan threshold:**",
        "**Denominator:**",
        "**Numerator / pass predicate:**",
        "**Frozen identities or conditional frame:**",
        "**Frame state:**",
        "**Source / generation identity:**",
        "**Evidence owner:**",
        "**Evidence destination:**",
        "**Materialize / freeze before tuning or measurement:**",
        "**Status:** `unaccepted`",
    ]
    for bullet in required_bullets:
        if text.count(bullet) < 16:
            errors.append(f"acceptance rows missing {bullet}")
    if "Status: **unaccepted** for every requirement R01–R16." not in text:
        errors.append("document status line missing")
    if "149" in text and "not adopted" not in text:
        errors.append("149 mentioned without non-adoption")
    forbidden_frozen = [
        "R14 denominator is frozen",
        "R14 sample is materialized",
        "participants are frozen",
        "observation window is complete",
    ]
    for phrase in forbidden_frozen:
        if phrase in text:
            errors.append(f"conditional frame overclaimed: {phrase}")
    return errors


def write_c2_artifacts(repo: Path, here: Path = HERE, receipt_output: Path | None = None) -> dict:
    if receipt_output is not None:
        target = receipt_output.resolve()
        if target.name in HISTORICAL_RECEIPT_NAMES and target.parent.resolve() == here.resolve():
            raise SystemExit(f"refusing to overwrite historical C1 receipt {target}")
    tasks_path = repo / "evaluation/research-program/tasks.json"
    acceptance_path = repo / "docs/research-program/acceptance.md"
    cohorts_path = repo / "evaluation/research-program/cohorts.json"
    payload = build_tasks_payload(repo, here)
    dump_json(tasks_path, payload)
    tasks_sha = digest(tasks_path)
    cohorts_sha = digest(cohorts_path)
    acceptance_path.write_text(render_acceptance_markdown(tasks_sha, cohorts_sha), encoding="utf-8")
    receipt = {
        "format": "ushso.research-program.pr-002.c2-build-receipt.v1",
        "commit_id": "C-002-2",
        "tasks_path": "evaluation/research-program/tasks.json",
        "tasks_sha256": tasks_sha,
        "tasks_bytes": tasks_path.stat().st_size,
        "acceptance_path": "docs/research-program/acceptance.md",
        "acceptance_sha256": digest(acceptance_path),
        "cohorts_path": "evaluation/research-program/cohorts.json",
        "cohorts_sha256": cohorts_sha,
        "c1_historical_cohorts_sha256": C1_COHORTS_SHA256,
        "cohorts_rewritten": cohorts_sha != C1_COHORTS_SHA256,
        "evaluator_freeze_manifest_sha256": SEALED_MANIFEST_SHA256,
        "r14_protocol_sha256": R14_PROTOCOL_SHA256,
        "hash_scheme_path": "verification/research-program/pr-002/hash-scheme.json",
        "hash_scheme_sha256": digest(here / "hash-scheme.json"),
        "negative_selector_fixtures_sha256": digest(here / "negative-selector-fixtures.json"),
        "c1_build_receipt_sha256": digest(here / "c1-build-receipt.json"),
        "c1_verify_receipt_sha256": digest(here / "c1-verify-receipt.json"),
        "c1_receipts_preserved": (
            digest(here / "c1-build-receipt.json") == C1_BUILD_RECEIPT_SHA256
            and digest(here / "c1-verify-receipt.json") == C1_VERIFY_RECEIPT_SHA256
        ),
        "task_count": TASK_COUNT,
        "requirement_ids": list(REQUIREMENT_IDS),
    }
    if receipt_output is not None:
        target = receipt_output.resolve()
        if target.name in HISTORICAL_RECEIPT_NAMES and target.parent == here:
            raise SystemExit(f"refusing to overwrite historical C1 receipt {target}")
        dump_json(target, receipt)
        receipt["receipt_output"] = str(target)
        receipt["receipt_output_sha256"] = digest(target)
    return receipt
