#!/usr/bin/env python3
"""Schema, hash, holdout-boundary, and negative-selector fixtures for C-002-2."""

from __future__ import annotations

import copy
import hashlib
import json
import tempfile
from pathlib import Path

import c2_lib


def _write(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def test_sealed_manifest_and_protocol_bytes() -> None:
    sealed = c2_lib.HERE / c2_lib.SEALED_MANIFEST_NAME
    protocol = c2_lib.HERE / c2_lib.R14_PROTOCOL_NAME
    assert c2_lib.digest(sealed) == c2_lib.SEALED_MANIFEST_SHA256
    assert sealed.stat().st_size == c2_lib.SEALED_MANIFEST_BYTES
    assert c2_lib.digest(protocol) == c2_lib.R14_PROTOCOL_SHA256
    assert protocol.stat().st_size == c2_lib.R14_PROTOCOL_BYTES


def test_c1_receipts_and_cohorts_preserved() -> None:
    assert c2_lib.digest(c2_lib.HERE / "c1-build-receipt.json") == c2_lib.C1_BUILD_RECEIPT_SHA256
    assert c2_lib.digest(c2_lib.HERE / "c1-verify-receipt.json") == c2_lib.C1_VERIFY_RECEIPT_SHA256
    repo = c2_lib.HERE.parents[2]
    import c1_lib

    written = c2_lib.load_json(repo / "evaluation/research-program/cohorts.json")
    rebuilt = c1_lib.build_payload(repo)
    assert c2_lib.extract_c1_projection(written) == c2_lib.extract_c1_projection(rebuilt)


def test_c2_receipts_preserved_and_bound_to_base() -> None:
    assert c2_lib.digest(c2_lib.HERE / "c2-build-receipt.json") == c2_lib.C2_BUILD_RECEIPT_SHA256
    assert c2_lib.digest(c2_lib.HERE / "c2-verify-receipt.json") == c2_lib.C2_VERIFY_RECEIPT_SHA256
    assert c2_lib.C2_BASE_COMMIT == "8fe6e6b2e997e4a3ed59aece64492684f489bec8"
    assert c2_lib.C2_BASE_TREE == "7358d73c50e7db7431eb101243f784605ed93a9b"


def test_task_schema_matches_sealed_index() -> None:
    repo = c2_lib.HERE.parents[2]
    sealed = c2_lib.load_sealed_manifest()
    payload = c2_lib.build_tasks_payload(repo)
    assert c2_lib.assert_task_schema(payload, sealed) == []
    assert len(payload["tasks"]) == 40
    assert payload["c1_identities"]["rewritten_by_this_commit"] is False


def test_holdout_boundary_rejects_raw_query_field() -> None:
    repo = c2_lib.HERE.parents[2]
    sealed = c2_lib.load_sealed_manifest()
    payload = c2_lib.build_tasks_payload(repo)
    leaked = copy.deepcopy(payload)
    leaked["tasks"][0]["query"] = "this would be a raw holdout prompt"
    errors = c2_lib.assert_task_schema(leaked, sealed)
    assert any("private field" in item or "leaks" in item for item in errors)


def test_holdout_boundary_rejects_gold_labels() -> None:
    repo = c2_lib.HERE.parents[2]
    sealed = c2_lib.load_sealed_manifest()
    payload = c2_lib.build_tasks_payload(repo)
    leaked = copy.deepcopy(payload)
    leaked["tasks"][1]["gold_labels_included"] = True
    errors = c2_lib.assert_task_schema(leaked, sealed)
    assert errors


def test_deletion_based_success_fails() -> None:
    repo = c2_lib.HERE.parents[2]
    sealed = c2_lib.load_sealed_manifest()
    payload = c2_lib.build_tasks_payload(repo)
    trimmed = copy.deepcopy(payload)
    trimmed["tasks"] = [item for item in trimmed["tasks"] if item["task_id"] != "T-040"]
    errors = c2_lib.assert_task_schema(trimmed, sealed)
    assert any("task count" in item or "task IDs" in item for item in errors)


def test_r14_protocol_is_not_a_frozen_sample() -> None:
    repo = c2_lib.HERE.parents[2]
    sealed = c2_lib.load_sealed_manifest()
    payload = c2_lib.build_tasks_payload(repo)
    overclaim = copy.deepcopy(payload)
    overclaim["r14"]["materialized"] = True
    overclaim["r14"]["frozen_sample"] = True
    errors = c2_lib.assert_task_schema(overclaim, sealed)
    assert any("R14" in item for item in errors)


def test_r06_rejects_unqualified_parser_output() -> None:
    repo = c2_lib.HERE.parents[2]
    sealed = c2_lib.load_sealed_manifest()
    payload = c2_lib.build_tasks_payload(repo)
    weakened = copy.deepcopy(payload)
    weakened["correction_contracts"]["R06"]["qualification_required"] = False
    weakened["correction_contracts"]["R06"]["raw_parser_output_alone_satisfies"] = True
    weakened["correction_contracts"]["R06"]["numerator"] = "Parser output / eligible denominator >= 0.95."
    errors = c2_lib.assert_task_schema(weakened, sealed)
    assert any("R06" in item and "qualified" in item for item in errors)


def test_r14_rejects_quality_only_gate() -> None:
    repo = c2_lib.HERE.parents[2]
    sealed = c2_lib.load_sealed_manifest()
    payload = c2_lib.build_tasks_payload(repo)
    weakened = copy.deepcopy(payload)
    weakened["correction_contracts"]["R14"]["quality_gate"]["no_models_in_public_request_handling"] = False
    errors = c2_lib.assert_task_schema(weakened, sealed)
    assert any("R14" in item for item in errors)


def test_r12_keeps_uncompleted_assigned_opportunities() -> None:
    repo = c2_lib.HERE.parents[2]
    sealed = c2_lib.load_sealed_manifest()
    payload = c2_lib.build_tasks_payload(repo)
    weakened = copy.deepcopy(payload)
    weakened["correction_contracts"]["R12"]["completion_ratio"]["missing_or_untested_count_as_non_completion"] = False
    errors = c2_lib.assert_task_schema(weakened, sealed)
    assert any("R12" in item for item in errors)


def test_r11_rejects_tool_substitution_deletion_and_planner_addition() -> None:
    repo = c2_lib.HERE.parents[2]
    sealed = c2_lib.load_sealed_manifest()
    payload = c2_lib.build_tasks_payload(repo)
    for replacement in (
        [*c2_lib.FROZEN_TOOL_NAMES[:-1], "observatory.substitute"],
        list(c2_lib.FROZEN_TOOL_NAMES[:-1]),
        [*c2_lib.FROZEN_TOOL_NAMES, c2_lib.DISABLED_PLANNER_NAME],
    ):
        weakened = copy.deepcopy(payload)
        weakened["correction_contracts"]["R11"]["tool_export"]["names"] = replacement
        errors = c2_lib.assert_task_schema(weakened, sealed)
        assert any("R11" in item for item in errors)


def test_acceptance_rows_cover_r01_r16() -> None:
    rows = c2_lib.requirement_rows()
    assert [row["id"] for row in rows] == list(c2_lib.REQUIREMENT_IDS)
    assert all(row["status"] == "unaccepted" for row in rows)
    r07 = next(row for row in rows if row["id"] == "R07")
    assert "0.90" in r07["numerator_or_pass_predicate"] or ">= 0.90" in r07["numerator_or_pass_predicate"]
    assert "0.80" in r07["numerator_or_pass_predicate"]
    assert "49" in r07["numerator_or_pass_predicate"]
    assert r07["source_generation_identity"]["evaluator_freeze_manifest_sha256"] == c2_lib.SEALED_MANIFEST_SHA256
    r12 = next(row for row in rows if row["id"] == "R12")
    assert "Eight actual novice" in r12["denominator"]
    assert "Simulations" in r12["numerator_or_pass_predicate"]
    assert "ALL assigned frozen task/session opportunities" in r12["numerator_or_pass_predicate"]
    r14 = next(row for row in rows if row["id"] == "R14")
    assert r14["frame_state"] == "protocol_published_not_materialized_not_frozen"
    assert "149" in r14["denominator"]
    assert "no model in public request handling" in r14["numerator_or_pass_predicate"]
    assert "auditable token and spend controls" in r14["numerator_or_pass_predicate"]
    assert "precision >= 0.98 for the overall frozen sample" in r14["numerator_or_pass_predicate"]
    assert "precision >= 0.98 overall and in every" not in r14["numerator_or_pass_predicate"]
    r06 = next(row for row in rows if row["id"] == "R06")
    assert "QUALIFIED parsed dictionary" in r06["numerator_or_pass_predicate"]
    r11 = next(row for row in rows if row["id"] == "R11")
    assert list(c2_lib.FROZEN_TOOL_NAMES) == [
        name for name in c2_lib.FROZEN_TOOL_NAMES if name in r11["denominator"]
    ]
    assert c2_lib.TOOLS_EXPORT_COMMIT in r11["denominator"]
    r15 = next(row for row in rows if row["id"] == "R15")
    assert "Generated dates" in r15["numerator_or_pass_predicate"]
    text = c2_lib.render_acceptance_markdown("deadbeef", c2_lib.C1_COHORTS_SHA256)
    assert c2_lib.assert_acceptance_document(text) == []


def test_hash_scheme_is_non_circular() -> None:
    scheme = c2_lib.hash_scheme()
    assert "own digest" in scheme["circularity_rule"]
    assert "evaluation/research-program/cohorts.json" in scheme["hashed_artifacts"]
    assert "evaluation/research-program/tasks.json" in scheme["hashed_artifacts"]
    assert scheme["algorithm"] == "SHA-256"


def test_negative_selector_fixtures_are_decisive() -> None:
    fixtures = c2_lib.load_json(c2_lib.HERE / "negative-selector-fixtures.json")
    ids = [item["id"] for item in fixtures["fixtures"]]
    assert "NEG-HOLDOUT-RAW-QUERY" in ids
    assert "NEG-DELETE-DIFFICULT-MEMBER" in ids
    assert "NEG-TASKS-AS-R14-GOLD" in ids
    assert "NEG-PROTOCOL-AS-MATERIALIZED-FRAME" in ids
    assert all(item["expected"] == "reject" for item in fixtures["fixtures"])


def test_receipt_output_refuses_historical_c1_paths() -> None:
    repo = c2_lib.HERE.parents[2]
    try:
        c2_lib.write_c2_artifacts(repo, receipt_output=c2_lib.HERE / "c1-verify-receipt.json")
    except SystemExit as error:
        assert "historical C1 receipt" in str(error)
    else:
        raise AssertionError("historical C1 receipt overwrite was not blocked")
    assert c2_lib.digest(c2_lib.HERE / "c1-verify-receipt.json") == c2_lib.C1_VERIFY_RECEIPT_SHA256


def test_catalog_hash_still_precedes_c1_exec() -> None:
    # C2 must not weaken the C1 catalog-hash-before-exec guard.
    import c1_lib

    with tempfile.TemporaryDirectory(prefix="ushso-pr002-c2-catalog-", dir="/mnt/d/tmp/plumbob") as directory:
        root = Path(directory)
        marker = root / "executed-marker"
        (root / "product_catalog.py").write_text(
            f"from pathlib import Path\nPath({str(marker)!r}).write_text('executed')\nPRODUCTS=[]\nDOMAINS=[]\ndef validate_catalog(): pass\n",
            encoding="utf-8",
        )
        original = c1_lib.HERE
        c1_lib.HERE = root
        try:
            try:
                c1_lib.load_catalog()
            except SystemExit as error:
                assert "hash mismatch" in str(error)
            else:
                raise AssertionError("modified catalog executed")
        finally:
            c1_lib.HERE = original
        assert not marker.exists()


if __name__ == "__main__":
    tests = [
        test_sealed_manifest_and_protocol_bytes,
        test_c1_receipts_and_cohorts_preserved,
        test_c2_receipts_preserved_and_bound_to_base,
        test_task_schema_matches_sealed_index,
        test_holdout_boundary_rejects_raw_query_field,
        test_holdout_boundary_rejects_gold_labels,
        test_deletion_based_success_fails,
        test_r14_protocol_is_not_a_frozen_sample,
        test_r06_rejects_unqualified_parser_output,
        test_r14_rejects_quality_only_gate,
        test_r12_keeps_uncompleted_assigned_opportunities,
        test_r11_rejects_tool_substitution_deletion_and_planner_addition,
        test_acceptance_rows_cover_r01_r16,
        test_hash_scheme_is_non_circular,
        test_negative_selector_fixtures_are_decisive,
        test_receipt_output_refuses_historical_c1_paths,
        test_catalog_hash_still_precedes_c1_exec,
    ]
    for test in tests:
        test()
        print(test.__name__, "ok")
    print("c2_fixtures_ok", hashlib.sha256(b"c2").hexdigest()[:8])
