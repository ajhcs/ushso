#!/usr/bin/env python3
"""Exact ordered pilots, twelve families, C1 projection, and C3 negatives."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import c1_lib
import c2_lib
import c3_lib


def repo_root() -> Path:
    return c3_lib.HERE.parents[2]


def load_cohorts() -> dict:
    return c3_lib.load_json(repo_root() / "evaluation/research-program/cohorts.json")


def test_historical_code_and_evidence_hashes() -> None:
    assert c3_lib.digest(c3_lib.HERE / "c1_lib.py") == c3_lib.C1_LIB_SHA256
    assert c3_lib.digest(c3_lib.HERE / "c2_lib.py") == c3_lib.C2_LIB_SHA256
    assert c3_lib.verify_copied_evidence() == []
    assert c3_lib.verify_payer_cells() == []
    wrapper = c3_lib.C3_DIR / "replay_portable.py"
    assert wrapper.is_file()
    assert c3_lib.digest(wrapper) != c3_lib.REPLAY_SCRIPT_SHA256


def test_c1_projection_preserved_after_c3_fields() -> None:
    written = load_cohorts()
    rebuilt = c1_lib.build_payload(repo_root())
    assert c2_lib.extract_c1_projection(written) == c2_lib.extract_c1_projection(rebuilt)
    assert c3_lib.digest(c3_lib.HERE / "c1-build-receipt.json") == c2_lib.C1_BUILD_RECEIPT_SHA256
    assert c3_lib.digest(c3_lib.HERE / "c1-verify-receipt.json") == c2_lib.C1_VERIFY_RECEIPT_SHA256
    assert c3_lib.digest(c3_lib.HERE / "c2-build-receipt.json") == c2_lib.C2_BUILD_RECEIPT_SHA256
    assert c3_lib.digest(c3_lib.HERE / "c2-verify-receipt.json") == c2_lib.C2_VERIFY_RECEIPT_SHA256


def test_exact_ordered_unique_pilot_ids_and_bindings() -> None:
    written = load_cohorts()
    errors = c3_lib.assert_pilot_identities(written)
    assert errors == [], errors
    selection = written["mrf_selection"]
    assert selection["hospital_candidate_ids"] == list(c3_lib.HOSPITAL_CANDIDATE_IDS)
    assert selection["payer_reporting_entity_candidate_ids"] == list(c3_lib.PAYER_CANDIDATE_IDS)
    assert len(set(selection["hospital_candidate_ids"])) == 25
    assert len(set(selection["payer_reporting_entity_candidate_ids"])) == 10
    assert any(ch.isalpha() for item in selection["hospital_candidate_ids"] for ch in item)
    assert selection["parsed_sample_targets"] == {"hospital": 20, "payer": 8}


def test_twelve_family_intake_mappings() -> None:
    written = load_cohorts()
    errors = c3_lib.assert_expansion_families(written)
    assert errors == [], errors
    identities = written["expansion_families"]["family_identities"]
    assert identities == [item["family_identity"] for item in c3_lib.FAMILY_SPECS]
    assert len(identities) == 12


def test_full_unaccepted_requirement_keyset() -> None:
    written = load_cohorts()
    errors = c3_lib.assert_requirement_keyset(written)
    assert errors == [], errors
    assert list(written["acceptance"]) == list(c2_lib.REQUIREMENT_IDS)
    assert all(written["acceptance"][req] == "unaccepted" for req in c2_lib.REQUIREMENT_IDS)


def test_tasks_and_acceptance_bind_c3_frames() -> None:
    repo = repo_root()
    tasks = c3_lib.load_json(repo / "evaluation/research-program/tasks.json")
    assert tasks == c3_lib.build_tasks_payload(repo)
    assert tasks["c1_identities"]["c1_historical_cohorts_sha256"] == c2_lib.C1_COHORTS_SHA256
    assert tasks["c1_identities"]["cohorts_sha256"] == c3_lib.digest(repo / "evaluation/research-program/cohorts.json")
    assert tasks["requirement_status"] == {req: "unaccepted" for req in c2_lib.REQUIREMENT_IDS}
    text = (repo / "docs/research-program/acceptance.md").read_text(encoding="utf-8")
    assert c3_lib.assert_c3_acceptance_document(text) == []
    assert c3_lib.R09_FRAME_STATE in text
    assert c3_lib.R10_FRAME_STATE in text


def test_negative_delete_hospital() -> None:
    mutated = c3_lib.mutate_for_negative(load_cohorts(), "delete_hospital")
    errors = c3_lib.assert_pilot_identities(mutated)
    assert any("exact sealed ordered 25" in item or "fixed 25" in item for item in errors)


def test_negative_replace_hospital() -> None:
    mutated = c3_lib.mutate_for_negative(load_cohorts(), "replace_hospital")
    errors = c3_lib.assert_pilot_identities(mutated)
    assert any("exact sealed ordered 25" in item for item in errors)


def test_negative_duplicate_identity() -> None:
    mutated = c3_lib.mutate_for_negative(load_cohorts(), "duplicate_identity")
    errors = c3_lib.assert_pilot_identities(mutated)
    assert any("unique" in item or "exact sealed ordered 25" in item for item in errors)


def test_negative_evidence_hash_mismatch() -> None:
    mutated = c3_lib.mutate_for_negative(load_cohorts(), "hash_mismatch")
    errors = c3_lib.assert_pilot_identities(mutated)
    assert any("source hash mismatch" in item for item in errors)


def test_negative_missing_requirement_keys() -> None:
    mutated = c3_lib.mutate_for_negative(load_cohorts(), "missing_requirement_keys")
    errors = c3_lib.assert_requirement_keyset(mutated)
    assert any("missing requirement keys" in item or "full R01-R16" in item or "length" in item for item in errors)
    # all() over the incomplete mapping would wrongly pass.
    assert all(value == "unaccepted" for value in mutated["acceptance"].values())
    assert errors != []


def test_negative_family_substitution() -> None:
    mutated = c3_lib.mutate_for_negative(load_cohorts(), "family_substitution")
    errors = c3_lib.assert_expansion_families(mutated)
    assert any("family identities" in item or "substituted" in item for item in errors)


def test_counts_or_truthy_list_are_insufficient() -> None:
    mutated = copy.deepcopy(load_cohorts())
    mutated["mrf_selection"]["hospital_candidate_ids"][0] = "000000"
    # Length and truthiness still pass; exact order must fail.
    assert mutated["mrf_selection"]["hospital_candidate_ids"]
    assert len(mutated["mrf_selection"]["hospital_candidate_ids"]) == 25
    errors = c3_lib.assert_pilot_identities(mutated)
    assert any("exact sealed ordered 25" in item for item in errors)


def test_negative_fixture_file_is_decisive() -> None:
    fixtures = c3_lib.load_json(c3_lib.HERE / "c3-negative-fixtures.json")
    ids = [item["id"] for item in fixtures["fixtures"]]
    assert ids == [
        "NEG-C3-DELETE-HOSPITAL",
        "NEG-C3-REPLACE-HOSPITAL",
        "NEG-C3-DUPLICATE-IDENTITY",
        "NEG-C3-EVIDENCE-HASH-MISMATCH",
        "NEG-C3-MISSING-REQUIREMENT-KEYS",
        "NEG-C3-FAMILY-SUBSTITUTION",
    ]
    assert all(item["expected"] == "reject" for item in fixtures["fixtures"])


def test_receipt_output_refuses_historical_paths() -> None:
    repo = repo_root()
    try:
        c3_lib.write_c3_artifacts(repo, receipt_output=c3_lib.HERE / "c1-verify-receipt.json")
    except SystemExit as error:
        assert "historical receipt" in str(error)
    else:
        raise AssertionError("historical receipt overwrite was not blocked")
    assert c3_lib.digest(c3_lib.HERE / "c1-verify-receipt.json") == c2_lib.C1_VERIFY_RECEIPT_SHA256


if __name__ == "__main__":
    tests = [
        test_historical_code_and_evidence_hashes,
        test_c1_projection_preserved_after_c3_fields,
        test_exact_ordered_unique_pilot_ids_and_bindings,
        test_twelve_family_intake_mappings,
        test_full_unaccepted_requirement_keyset,
        test_tasks_and_acceptance_bind_c3_frames,
        test_negative_delete_hospital,
        test_negative_replace_hospital,
        test_negative_duplicate_identity,
        test_negative_evidence_hash_mismatch,
        test_negative_missing_requirement_keys,
        test_negative_family_substitution,
        test_counts_or_truthy_list_are_insufficient,
        test_negative_fixture_file_is_decisive,
        test_receipt_output_refuses_historical_paths,
    ]
    for test in tests:
        test()
        print(test.__name__, "ok")
    print("c3_fixtures_ok", hashlib.sha256(b"c3").hexdigest()[:8])
