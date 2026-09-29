#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

REPO = Path(".").resolve()
HANDOFF = REPO / "docs/research-program/handoffs/PR-002.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def artifact(rel: str, status: str, extra: dict | None = None) -> dict:
    path = REPO / rel
    item = {
        "path": rel,
        "sha256": digest(path),
        "bytes": path.stat().st_size,
        "status": status,
    }
    if extra:
        item.update(extra)
    return item


def main() -> None:
    data = json.loads(HANDOFF.read_text(encoding="utf-8"))
    data["status"] = "c3_implemented_pending_whole_pr_acceptance"
    data["correction_status"] = "c2_correction_accepted_c3_pending_independent_review"
    data["pending"] = []
    data["owner"] = "Grok"
    data["reviewer"] = "Astra"
    data["implementation_authorship"] = {
        "c0021_producer": "Grok",
        "c0021_review_correction": "Luna Max",
        "c0022_producer": "Grok",
        "c0022_review_correction": "Luna Max",
        "c0023_producer": "Grok",
    }
    data["provider"] = "grok"
    data["actual_model"] = "grok-4"
    data["author_provider_envelope"] = "grok-4"
    data["run_id"] = "ushso-pr002-c3-20260910"
    data["assignment_id"] = "grok-c3"
    data["c3_base_sha"] = "997070bd94864fabedf73acecd422c6e15a3ed7e"
    data["c3_base_tree"] = "c05b9a74630b715b05304044a24d6e66489a9808"
    data["head_sha"] = None
    data["head_sha_note"] = (
        "The C-002-3 commit cannot self-identify its commit hash/tree. Root binds "
        "the final C3 head/tree after review. Parent/base is the accepted C2 "
        "correction 997070bd94864fabedf73acecd422c6e15a3ed7e / "
        "c05b9a74630b715b05304044a24d6e66489a9808."
    )
    data["branch"] = "codex/ce-ushso-pr002-c3-20260910-grok-c3-ce2e8fd091bf-1d277397"
    data["github_pr_url"] = None
    for item in data["commits"]:
        if item["id"] == "C2-REVIEW-CORRECTION":
            item["sha"] = "997070bd94864fabedf73acecd422c6e15a3ed7e"
            item["tree"] = "c05b9a74630b715b05304044a24d6e66489a9808"
            item["identity_convention"] = (
                "Accepted additive C2 correction, authored by Luna Max. Immutable "
                "commit/tree bound from the accepted C2 correction head. It preserves "
                "C-002-2 and does not implement C-002-3."
            )
    if not any(item["id"] == "C-002-3" for item in data["commits"]):
        data["commits"].append({
            "id": "C-002-3",
            "sha": None,
            "parent": "997070bd94864fabedf73acecd422c6e15a3ed7e",
            "tree": None,
            "subject": "docs(research): pin MRF and expansion scope (PR-002 C-002-3)",
            "identity_convention": (
                "Imperative docs(research) subject plus (PR-002 C-002-3). The commit "
                "cannot self-identify its hash/tree; root binds the reviewed descendant."
            ),
            "authorship": "Grok",
        })
    data["source_identities"].extend([
        {
            "kind": "c0022_accepted_head",
            "sha": "997070bd94864fabedf73acecd422c6e15a3ed7e",
            "tree": "c05b9a74630b715b05304044a24d6e66489a9808",
            "authorship": "Luna Max",
            "status": "accepted_c2_correction_only",
        },
        {
            "kind": "c0023_base",
            "sha": "997070bd94864fabedf73acecd422c6e15a3ed7e",
            "tree": "c05b9a74630b715b05304044a24d6e66489a9808",
        },
        {
            "kind": "c0023_pilot_selection_seal",
            "path": "verification/research-program/pr-002/c3-pilot-selection/controller/pilot-selection-input-seal-v1.json",
            "sha256": "f74892bbb9bb38619e985cb20e2dd9c6478eba0d7b0bcb02af234f70a1a03060",
            "bytes": 6889,
            "freeze_id": "ushso-mrf-directory-pilots-20260910-v1",
            "selection_consumed_not_recomputed": True,
        },
        {
            "kind": "c0023_pilot_independent_review",
            "path": "verification/research-program/pr-002/c3-pilot-selection/controller/review.json",
            "sha256": "fcdcf9b2d7437f7c2f8d2845d778311497f78de08298930a15ab645427979354",
            "checks": 523,
        },
        {
            "kind": "c0023_public_c2_acceptance_receipt",
            "path": "/mnt/d/worktrees/plumbob/ushso-research-program-20260910/verification/research-program/bootstrap/pr002-c2-acceptance-997070b.json",
            "sha256": "b1721c55690ef38452956f9490d7dd1b8e8ea837fa9a72f8d3eb4d189bc7097c",
            "not_copied_into_this_commit": True,
        },
    ])
    data["c3_changed_files"] = [
        "docs/research-program/acceptance.md",
        "docs/research-program/handoffs/PR-002.json",
        "evaluation/research-program/cohorts.json",
        "evaluation/research-program/tasks.json",
        "verification/research-program/pr-002/build.py",
        "verification/research-program/pr-002/c3-build-receipt.json",
        "verification/research-program/pr-002/c3-negative-fixtures.json",
        "verification/research-program/pr-002/c3-pilot-selection/portable-index.json",
        "verification/research-program/pr-002/c3-pilot-selection/replay_portable.py",
        "verification/research-program/pr-002/c3-verify-receipt.json",
        "verification/research-program/pr-002/c3_lib.py",
        "verification/research-program/pr-002/command-receipts/c3-build.json",
        "verification/research-program/pr-002/command-receipts/c3-plan-validate.json",
        "verification/research-program/pr-002/command-receipts/c3-portable-replay.json",
        "verification/research-program/pr-002/command-receipts/c3-test-c1.json",
        "verification/research-program/pr-002/command-receipts/c3-test-c2.json",
        "verification/research-program/pr-002/command-receipts/c3-test-c3.json",
        "verification/research-program/pr-002/command-receipts/c3-verify-readonly.json",
        "verification/research-program/pr-002/command-receipts/c3-verify.json",
        "verification/research-program/pr-002/hash-scheme.json",
        "verification/research-program/pr-002/test_c2.py",
        "verification/research-program/pr-002/test_c3.py",
        "verification/research-program/pr-002/verify.py",
    ]
    data["resulting_behavior"] = (
        "C-002-3 consumes the sealed directory-only 25 hospital and 10 HIOS issuer "
        "IDs in sealed order, with selected row/cell/source bindings and typed unresolved "
        "PR-046/PR-049 downstream bindings. Twelve exact missing families are pinned to "
        "PR-043/044/045 C-*-1..3 intake scopes with unverified locators. The C1 projection "
        "(100 products, ten domains, 3,434 baseline IDs, 185 inference-only related "
        "candidates) is preserved. R09/R10 identity frames are frozen; all R01-R16 remain "
        "unaccepted. No endpoint, payload, parse, TiC-entity, or eligibility result is claimed."
    )
    data["c3_checks"] = {
        "records": [
            {
                "command": "python3 -B verification/research-program/pr-002/build.py --repo . --stage c3 --receipt-output verification/research-program/pr-002/c3-build-receipt.json",
                "started_at": "2026-09-10T20:35:23.006242Z",
                "completed_at": "2026-09-10T20:35:23.246001Z",
                "exit_code": 0,
                "completion_status": "observed_exit",
                "event_source": "verification/research-program/pr-002/command-receipts/c3-build.json",
                "result": "C3 overlay wrote cohorts/tasks/acceptance; C1/C2 receipts preserved",
            },
            {
                "command": "python3 -B verification/research-program/pr-002/test_c1_corrections.py",
                "started_at": "2026-09-10T20:35:31.861499Z",
                "completed_at": "2026-09-10T20:35:31.914282Z",
                "exit_code": 0,
                "completion_status": "observed_exit",
                "event_source": "verification/research-program/pr-002/command-receipts/c3-test-c1.json",
                "result": "c1_correction_fixtures_ok",
            },
            {
                "command": "python3 -B verification/research-program/pr-002/test_c2.py",
                "started_at": "2026-09-10T20:35:37.279669Z",
                "completed_at": "2026-09-10T20:35:37.934209Z",
                "exit_code": 0,
                "completion_status": "observed_exit",
                "event_source": "verification/research-program/pr-002/command-receipts/c3-test-c2.json",
                "result": "c2_fixtures_ok 9c0abe51; C1 projection preserved after C3 overlay",
            },
            {
                "command": "python3 -B verification/research-program/pr-002/test_c3.py",
                "started_at": "2026-09-10T20:35:40.726500Z",
                "completed_at": "2026-09-10T20:35:41.627358Z",
                "exit_code": 0,
                "completion_status": "observed_exit",
                "event_source": "verification/research-program/pr-002/command-receipts/c3-test-c3.json",
                "result": "c3_fixtures_ok 7c1c97df",
            },
            {
                "command": "python3 -B verification/research-program/pr-002/verify.py --repo .",
                "started_at": "2026-09-10T20:35:44.192734Z",
                "completed_at": "2026-09-10T20:35:45.308246Z",
                "exit_code": 0,
                "completion_status": "observed_exit_read_only",
                "event_source": "verification/research-program/pr-002/command-receipts/c3-verify-readonly.json",
                "result": "ok=true; no receipt or __pycache__ writes",
            },
            {
                "command": "python3 -B verification/research-program/pr-002/verify.py --repo . --receipt-output verification/research-program/pr-002/c3-verify-receipt.json",
                "started_at": "2026-09-10T20:35:50.697754Z",
                "completed_at": "2026-09-10T20:35:51.832922Z",
                "exit_code": 0,
                "completion_status": "observed_exit",
                "event_source": "verification/research-program/pr-002/command-receipts/c3-verify.json",
                "result": "explicit C3 verify receipt written",
            },
            {
                "command": "python3 docs/master-plan/2026-09-10/validate.py",
                "started_at": "2026-09-10T20:35:50.695251Z",
                "completed_at": "2026-09-10T20:35:50.758462Z",
                "exit_code": 0,
                "completion_status": "observed_exit",
                "event_source": "verification/research-program/pr-002/command-receipts/c3-plan-validate.json",
                "result": "plan structure and packet synchronization passed",
            },
            {
                "command": "python3 -B verification/research-program/pr-002/c3-pilot-selection/replay_portable.py --repo .",
                "started_at": "2026-09-10T20:35:50.699812Z",
                "completed_at": "2026-09-10T20:35:50.807871Z",
                "exit_code": 0,
                "completion_status": "observed_exit",
                "event_source": "verification/research-program/pr-002/command-receipts/c3-portable-replay.json",
                "result": "sealed IDs and payer cells verified; historical replay script not executed",
            },
        ]
    }
    data["artifacts"].extend([
        artifact("evaluation/research-program/cohorts.json", "current_C3_artifact"),
        artifact("evaluation/research-program/tasks.json", "current_C3_artifact"),
        artifact("docs/research-program/acceptance.md", "current_C3_artifact"),
        artifact("verification/research-program/pr-002/c3_lib.py", "current_C3_artifact"),
        artifact("verification/research-program/pr-002/c3-build-receipt.json", "current_C3_receipt", {"receipt_mode": "explicit_output"}),
        artifact("verification/research-program/pr-002/c3-verify-receipt.json", "current_C3_receipt", {"receipt_mode": "explicit_output"}),
        artifact("verification/research-program/pr-002/c3-negative-fixtures.json", "current_C3_adversarial_fixture"),
        artifact("verification/research-program/pr-002/c3-pilot-selection/portable-index.json", "current_C3_portable_index"),
        artifact("verification/research-program/pr-002/c3-pilot-selection/replay_portable.py", "current_C3_portable_wrapper"),
        artifact("verification/research-program/pr-002/c3-pilot-selection/controller/pilot-selection-input-seal-v1.json", "copied_root_seal_unchanged"),
        artifact("verification/research-program/pr-002/c3-pilot-selection/controller/review.json", "copied_root_review_unchanged"),
        artifact("verification/research-program/pr-002/build.py", "current_C3_artifact"),
        artifact("verification/research-program/pr-002/verify.py", "current_C3_artifact"),
        artifact("verification/research-program/pr-002/test_c2.py", "current_C3_artifact"),
        artifact("verification/research-program/pr-002/test_c3.py", "current_C3_artifact"),
        artifact("verification/research-program/pr-002/hash-scheme.json", "current_C3_artifact"),
        {
            "path": "evaluation/research-program/cohorts.json",
            "sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4",
            "bytes": 2336377,
            "status": "historical_C1_projection_preserved_inside_current_C3_file",
        },
    ])
    data["historical_artifact_bindings"].extend([
        {
            "path": "evaluation/research-program/tasks.json",
            "sha256": "c14c2118dfddab80fd5047dc1912a622721f89a6212d73d2498700fa01305a74",
            "bytes": 29252,
            "commit": "997070bd94864fabedf73acecd422c6e15a3ed7e",
            "tree": "c05b9a74630b715b05304044a24d6e66489a9808",
            "status": "historical_C2_correction_artifact",
            "verification": "git show <commit>:<path> then SHA-256",
        },
        {
            "path": "docs/research-program/acceptance.md",
            "sha256": "630c94f9b708271c20b14049413dd116328c1349759fcf604fc1e1336fcd4117",
            "bytes": 29747,
            "commit": "997070bd94864fabedf73acecd422c6e15a3ed7e",
            "tree": "c05b9a74630b715b05304044a24d6e66489a9808",
            "status": "historical_C2_correction_artifact",
            "verification": "git show <commit>:<path> then SHA-256",
        },
        {
            "path": "verification/research-program/pr-002/c2_lib.py",
            "sha256": "21aec356bf8c4c000f8132ba6c0b9a5a4416090080835bf59b50ac20d682c6d0",
            "bytes": 60149,
            "commit": "997070bd94864fabedf73acecd422c6e15a3ed7e",
            "tree": "c05b9a74630b715b05304044a24d6e66489a9808",
            "status": "historical_C2_correction_artifact_unchanged_by_C3",
            "verification": "git show <commit>:<path> then SHA-256",
        },
        {
            "path": "verification/research-program/pr-002/test_c2.py",
            "sha256": "72fb96a84bbb9decf3a097424833749febd0c4d3dad6a9565f739f69fe0fa630",
            "bytes": 11113,
            "commit": "997070bd94864fabedf73acecd422c6e15a3ed7e",
            "tree": "c05b9a74630b715b05304044a24d6e66489a9808",
            "status": "historical_C2_correction_artifact",
            "verification": "git show <commit>:<path> then SHA-256",
        },
        {
            "path": "verification/research-program/pr-002/verify.py",
            "sha256": "5108b1275bad69c7894c37514c4c3f2eae86ff213694ecfe938bfd0b48c7ba6d",
            "bytes": 16951,
            "commit": "997070bd94864fabedf73acecd422c6e15a3ed7e",
            "tree": "c05b9a74630b715b05304044a24d6e66489a9808",
            "status": "historical_C2_correction_artifact",
            "verification": "git show <commit>:<path> then SHA-256",
        },
        {
            "path": "evaluation/research-program/cohorts.json",
            "sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4",
            "bytes": 2336377,
            "commit": "997070bd94864fabedf73acecd422c6e15a3ed7e",
            "tree": "c05b9a74630b715b05304044a24d6e66489a9808",
            "status": "historical_C1_cohorts_bytes_at_accepted_C2_head",
            "verification": "git show <commit>:<path> then SHA-256",
        },
    ])
    for item in data["acceptance_results"]:
        if item["id"] == "C2-REVIEW-CORRECTION":
            item["status"] = "accepted_c2_only"
            item["accepted_sha"] = "997070bd94864fabedf73acecd422c6e15a3ed7e"
            item["accepted_tree"] = "c05b9a74630b715b05304044a24d6e66489a9808"
    data["acceptance_results"].extend([
        {
            "id": "C-002-3",
            "status": "producer_checked_pending_independent_review",
            "result": "Sealed 25/10 directory IDs frozen in order with selected row/cell/source bindings. Twelve exact families mapped to PR-043/044/045 C-*-1..3. C1 projection preserved. R09 pointers_frozen_intake_not_materialized; R10 ids_frozen_locators_not_materialized. All R01-R16 unaccepted.",
            "authorship": "Grok",
            "base_sha": "997070bd94864fabedf73acecd422c6e15a3ed7e",
            "base_tree": "c05b9a74630b715b05304044a24d6e66489a9808",
        },
        {
            "id": "R09",
            "status": "unaccepted",
            "result": "Family pointers frozen. Locators remain unverified. Intake not materialized.",
        },
        {
            "id": "R10",
            "status": "unaccepted",
            "result": "25/10 IDs frozen. Locators, eligibility, parse, TiC entity, and file binding remain unresolved. Parsed-sample targets stay >=20 hospital and >=8 payer of that denominator.",
        },
    ])
    data["failures_and_skipped_checks"].extend([
        {
            "check": "C-002-3 MRF/expansion freeze",
            "status": "producer_checked_pending_independent_review",
            "reason": "C3 identities are frozen from the sealed directory selection. Whole-PR acceptance remains with root.",
        },
        {
            "check": "full npm test, npm run build, npm run cf:dry-run, push/PR/merge/deploy",
            "status": "skipped",
            "reason": "Bounded C-002-3 metadata commit. Root publishes the reviewed descendant on existing draft PR #14 and owns integration gates.",
        },
        {
            "check": "hospital raw CSV re-resolution",
            "status": "not_possible_csv_not_retained",
            "reason": "Original hospital CSV bytes were not retained. Projection hash was checked and not committed. Payer cells were resolved against retained XLSX bytes.",
        },
        {
            "check": "historical replay-selection.py re-execution",
            "status": "skipped_by_design",
            "reason": "C3 consumes the sealed selection and does not select again. The historical script is hash-checked and retained with original absolute paths. The portable wrapper uses explicit verified inputs and a different hash.",
        },
    ])
    for claim in data["unresolved_claims"]:
        if claim["claim"] == "MRF pilot IDs":
            claim["state"] = "ids_frozen_locators_not_materialized"
            claim["evidence"] = (
                "C-002-3 froze the sealed 25 hospital and 10 payer candidate IDs. "
                "Directory identity does not prove MRF rule applicability, payload "
                "availability, successful parsing, TiC reporting-entity identity, or file binding."
            )
    data["unresolved_claims"].append({
        "claim": "Twelve missing-family locators",
        "state": "unverified_locator",
        "evidence": "C-002-3 published candidate official locators and intake PR mappings. Publisher access and schema qualification are not claimed.",
    })
    data["next_consumer"] = "Astra/controller independent review of C-002-3, then root publication of the reviewed descendant on existing draft PR #14"
    data["next_action"] = (
        "Root independently reviews and replays this C3 commit, binds its final "
        "commit/tree, and determines whole-PR acceptance. Do not push, open PR, merge, or deploy from this producer task."
    )
    data["independent_review"] = {
        "status": "not_started",
        "reviewed_head_sha": None,
        "decisive_checks": [
            "python3 -B verification/research-program/pr-002/test_c1_corrections.py",
            "python3 -B verification/research-program/pr-002/test_c2.py",
            "python3 -B verification/research-program/pr-002/test_c3.py",
            "python3 -B verification/research-program/pr-002/verify.py --repo .",
            "python3 docs/master-plan/2026-09-10/validate.py",
        ],
        "limitations": [
            "Producer-checked C-002-3 identity freeze only.",
            "No raw holdout prompts or labels, no R14 residual/sample, no endpoint tests, no payload retrieval, no model calls.",
            "Independent reviewer must verify the C3 head/tree, exact 25/10 ordered IDs, twelve family mappings, preserved C1 projection, and unaccepted R01-R16 keyset.",
        ],
    }
    HANDOFF.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print("handoff", digest(HANDOFF), HANDOFF.stat().st_size)


if __name__ == "__main__":
    main()
