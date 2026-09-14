#!/usr/bin/env python3
"""Focused adversarial fixtures for the C-002-1 review correction."""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path

import c1_lib


def fixture_row(record_id: str, source: str, title: str, native: str, line: int) -> dict:
    provenance_id = f"provenance:{source}:{native}"
    evidence_id = f"evidence:{source}:{native}"
    return {
        "record_id": record_id,
        "title": title,
        "authoritative_url": f"https://example.test/{native}",
        "identity": {
            "source": {"source_id": source},
            "match_fields": {"source_id": native},
        },
        "evidence": [{"evidence_id": evidence_id, "provenance_ids": [provenance_id]}],
        "provenance": [{
            "provenance_id": provenance_id,
            "content_sha256": hashlib.sha256(provenance_id.encode()).hexdigest(),
            "locator": f"https://example.test/capture/{native}",
            "observed_at": "2026-09-10T00:00:00Z",
        }],
        "_shard": "records-0001.jsonl",
        "_shard_sha256": c1_lib.SHARD_HASHES["records-0001.jsonl"],
        "_line": line,
        "_record_sha256": hashlib.sha256(record_id.encode()).hexdigest(),
    }


def test_relation_candidates_are_source_scoped() -> None:
    rows = [
        fixture_row("rep", "cdc-socrata", "PLACES: County Data, 2025 release", "rep-native", 1),
        fixture_row("same-source", "cdc-socrata", "PLACES: County Data (GIS Friendly Format), 2025 release", "same-native", 2),
        # The title heuristic alone would match this row; source identity must
        # prevent it from becoming a cross-publisher relation candidate.
        fixture_row("wrong-source", "cms-data-catalog", "PLACES: County Data, 2025 release", "wrong-native", 3),
    ]
    candidates = c1_lib.related_by_title_prefix(rows, "PLACES:", "rep", "cdc-socrata")
    assert [item["record_id"] for item in candidates] == ["same-source"]
    candidate = candidates[0]
    assert candidate["relation"] == "candidate_gis_redistribution"
    assert candidate["relation_state"] == "candidate"
    assert candidate["publisher_relationship_identity"] is None
    assert candidate["canonical_merge_allowed"] is False
    assert candidate["release_binding_allowed"] is False
    assert candidate["scientific_interchangeability"] == "unresolved"
    assert candidate["record_sha256"] and candidate["shard_sha256"]
    assert candidate["evidence_ids"] and candidate["provenance_ids"] and candidate["provenance"]


def test_census_suffix_candidates_are_source_scoped() -> None:
    representative = fixture_row("census-rep", "census-api", "ACS 5-Year Data Profiles", "https://api.test/ACSDP5Y2024", 4)
    same_source = fixture_row("census-same", "census-api", "ACS 5-Year Data Profiles", "https://api.test/ACSDP5Y2023", 5)
    wrong_source = fixture_row("census-wrong", "cdc-socrata", "ACS 5-Year Data Profiles", "ACSDP5Y2022", 6)
    candidates = c1_lib.related_census(
        "ACSDP5Y2024",
        {"ACSDP5Y2024": [representative], "ACSDP5Y2023": [same_source], "ACSDP5Y2022": [wrong_source]},
        "census-rep",
        "census-api",
    )
    assert [item["record_id"] for item in candidates] == ["census-same"]
    assert candidates[0]["relation"] == "candidate_annual_variant"
    assert candidates[0]["inference_basis"]["method"] == "census_dataset_year_suffix"


def test_catalog_hash_rejects_before_exec() -> None:
    with tempfile.TemporaryDirectory(
        prefix="ushso-pr002-c1-catalog-integrity-",
        dir=os.environ.get("TMPDIR", "/mnt/d/tmp/plumbob"),
    ) as directory:
        root = Path(directory)
        marker = root / "executed-marker"
        (root / "product_catalog.py").write_text(
            f"from pathlib import Path\nPath({str(marker)!r}).write_text('executed')\nPRODUCTS=[]\nDOMAINS=[]\ndef validate_catalog(): pass\n",
            encoding="utf-8",
        )
        original_here = c1_lib.HERE
        c1_lib.HERE = root
        try:
            try:
                c1_lib.load_catalog()
            except SystemExit as error:
                assert "hash mismatch" in str(error)
            else:
                raise AssertionError("modified catalog unexpectedly executed")
        finally:
            c1_lib.HERE = original_here
        assert not marker.exists(), "hash failure must precede catalog execution"


if __name__ == "__main__":
    test_relation_candidates_are_source_scoped()
    test_census_suffix_candidates_are_source_scoped()
    test_catalog_hash_rejects_before_exec()
    print("c1_correction_fixtures_ok")
