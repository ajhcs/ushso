#!/usr/bin/env python3
"""Replay C-002-1 identity checks from local catalog, corpus shards, and cohorts.json."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

# A read-only replay must not leave import bytecode in the candidate.  The
# documented -B invocation provides a second, process-level guard.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from c1_lib import (
    EXPECTED_BASE,
    EXPECTED_CATALOG,
    EXPECTED_GENERATION,
    EXPECTED_ISOLATED,
    EXPECTED_MANIFEST,
    EXPECTED_MERGE,
    EXPECTED_PARTIAL_MANIFEST,
    EXPECTED_PRODUCER,
    FAILED_RUN,
    HERE,
    SHARD_HASHES,
    SOURCE_SLICES,
    build_payload,
    digest,
    load_catalog,
    load_rows,
)
import c2_lib


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def ancestor(repo: Path, sha: str) -> bool:
    return subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", sha, "HEAD"],
        check=False,
    ).returncode == 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument(
        "--receipt-output",
        type=Path,
        help="optional path for a replay receipt; omitted means read-only verification",
    )
    args = parser.parse_args()
    repo = args.repo.resolve()
    checks: dict[str, bool] = {}
    out: dict = {}

    head = git(repo, "rev-parse", "HEAD")
    base = git(repo, "rev-parse", EXPECTED_BASE)
    checks["base"] = base == EXPECTED_BASE and ancestor(repo, EXPECTED_BASE)
    checks["pr001_producer_ancestor"] = ancestor(repo, EXPECTED_PRODUCER)
    checks["pr001_merge_ancestor"] = ancestor(repo, EXPECTED_MERGE)
    out["git"] = {"head": head, "base": base}

    catalog_path = HERE / "product_catalog.py"
    products, domains = load_catalog()
    checks["catalog_hash"] = digest(catalog_path) == EXPECTED_CATALOG
    checks["product_count"] = len(products) == 100 and len({item["product_key"] for item in products}) == 100
    domain_counts = Counter(item["domain"] for item in products)
    checks["domain_counts"] = domain_counts == {domain: 10 for domain in domains}
    checks["program_key_not_unique"] = len({item["program_key"] for item in products}) < 100
    kind_counts = Counter(item["resolve"]["kind"] for item in products)
    checks["selector_counts"] = dict(kind_counts) == {
        "cms_title": 63,
        "census_dataset": 13,
        "cdc_native": 10,
        "intake": 14,
    }
    out["catalog"] = {"sha256": digest(catalog_path), "kinds": dict(kind_counts), "domains": dict(domain_counts)}

    rows, shard_info, corpus = load_rows(repo)
    record_ids = [row["record_id"] for row in rows]
    isolated = [
        row["record_id"]
        for row in rows
        if not isinstance(row.get("description"), str) or not row["description"].strip()
    ]
    slices = Counter(row["identity"]["source"]["source_id"] for row in rows)
    meta = json.loads((corpus / "corpus.json").read_text(encoding="utf-8"))
    checks["corpus_records"] = len(rows) == 3434 and len(set(record_ids)) == 3434
    checks["source_slices"] = dict(slices) == SOURCE_SLICES
    checks["isolated"] = isolated == EXPECTED_ISOLATED
    checks["generation"] = meta["publication"]["generation"] == EXPECTED_GENERATION
    checks["manifest"] = meta["manifest_sha256"] == EXPECTED_MANIFEST
    checks["shard_hashes"] = {name: info["sha256"] for name, info in shard_info.items()} == SHARD_HASHES
    out["corpus"] = {
        "record_count": len(rows),
        "slices": dict(slices),
        "isolated": isolated,
        "generation": meta["publication"]["generation"],
        "manifest_sha256": meta["manifest_sha256"],
    }

    rebuilt = build_payload(repo)
    cohorts_path = repo / "evaluation/research-program/cohorts.json"
    written = json.loads(cohorts_path.read_text(encoding="utf-8"))
    c3_frozen = bool((written.get("mrf_selection") or {}).get("hospital_candidate_ids"))
    if c3_frozen:
        checks["cohorts_rebuilt"] = c2_lib.extract_c1_projection(written) == c2_lib.extract_c1_projection(rebuilt)
    else:
        checks["cohorts_rebuilt"] = written == rebuilt
    baseline_ids = [item["record_id"] for item in written["baseline_records"]]
    checks["baseline_identity_set"] = baseline_ids == record_ids and set(baseline_ids) == set(record_ids)
    checks["baseline_native_and_source"] = all(
        item["source_id"] and "native_id" in item for item in written["baseline_records"]
    )
    resolved = [item for item in written["products"] if item["anchor"]["status"].startswith("resolved_")]
    intakes = [item for item in written["products"] if item["anchor"]["status"] == "named_intake"]
    failed = written["resolution"]["failed_selectors"]
    unsupported = written["resolution"]["unsupported_selectors"]
    checks["anchors_resolve_or_intake"] = (
        len(resolved) + len(intakes) == 100
        and len(intakes) == 14
        and written["resolution"]["failed_selectors"] == failed
    )
    checks["failed_selectors_exposed"] = isinstance(failed, list) and isinstance(unsupported, list)
    checks["no_cms_duplicate_titles"] = written["resolution"]["cms_duplicate_title_groups"] == []
    checks["cms_titles_unique_in_corpus"] = written["resolution"]["cms_unique_titles_in_corpus"] == 159
    reps = [item["anchor"]["representative"]["record_id"] for item in resolved]
    checks["representative_unique"] = len(reps) == len(set(reps))
    related = [
        (item, item["anchor"]["representative"], candidate)
        for item in written["products"]
        for candidate in item["anchor"].get("related_candidates", [])
    ]
    related_ids = {candidate["record_id"] for _, _, candidate in related}
    checks["related_not_counted_as_products"] = related_ids.isdisjoint(set(reps))
    checks["related_candidate_field"] = all(
        "related_candidates" in item["anchor"] and "related_releases" not in item["anchor"]
        for item in written["products"]
    )
    checks["related_candidate_source_identity"] = all(
        representative is not None
        and candidate["source_id"] == representative["source_id"]
        and candidate["inference_basis"]["source_identity_rule"]
        == "Candidate and representative source_id must match exactly."
        for _, representative, candidate in related
    )
    checks["related_candidate_evidence_state"] = all(
        candidate["relation"].startswith("candidate_")
        and candidate["relation_state"] == "candidate"
        and candidate["publisher_relationship_identity"] is None
        and candidate["scientific_interchangeability"] == "unresolved"
        and candidate["canonical_merge_allowed"] is False
        and candidate["release_binding_allowed"] is False
        and candidate["inference_basis"]
        for _, _, candidate in related
    )
    checks["related_candidate_pointers"] = all(
        candidate["record_id"]
        and candidate["record_sha256"]
        and candidate["shard"]
        and candidate["shard_sha256"]
        and candidate["line"]
        and candidate["evidence_ids"]
        and candidate["provenance_ids"]
        and candidate["provenance"]
        and all(
            item["provenance_id"]
            and item["content_sha256"]
            and item["locator"]
            and item["observed_at"]
            for item in candidate["provenance"]
        )
        for _, _, candidate in related
    )
    gis_reps = [
        item["product_key"]
        for item in resolved
        if "GIS Friendly Format" in (item["anchor"]["representative"]["title"] or "")
    ]
    checks["no_gis_representative"] = gis_reps == []
    checks["intake_locators_unverified"] = all(
        item["anchor"]["intake"]["locator_status"] == "unverified_locator" for item in intakes
    )
    checks["mrf_not_pilot"] = all(
        "candidate IDs before any endpoint result" in " ".join(item["anchor"]["unresolved_identity_limits"])
        for item in written["products"]
        if item["product_key"] in {"hospital-price-transparency-mrfs", "payer-transparency-in-coverage-mrfs"}
    )
    mrf_selection = written["mrf_selection"]
    checks["mrf_consumer_contract"] = (
        mrf_selection["freeze_before_endpoint_results"] is True
        and mrf_selection["hospital_candidate_count"] == 25
        and mrf_selection["payer_reporting_entity_candidate_count"] == 10
        and mrf_selection["consumer_contract"]["hospital"]["pr"] == "PR-046"
        and mrf_selection["consumer_contract"]["payer"]["pr"] == "PR-049"
        and mrf_selection["consumer_contract"]["hospital"]["replacement_allowed"] is False
        and mrf_selection["consumer_contract"]["payer"]["replacement_allowed"] is False
    )
    if c3_frozen:
        checks["mrf_freeze_order"] = (
            checks["mrf_consumer_contract"]
            and mrf_selection["selection_owner"] == "C-002-3"
            and isinstance(mrf_selection["hospital_candidate_ids"], list)
            and isinstance(mrf_selection["payer_reporting_entity_candidate_ids"], list)
            and len(mrf_selection["hospital_candidate_ids"]) == 25
            and len(mrf_selection["payer_reporting_entity_candidate_ids"]) == 10
        )
    else:
        checks["mrf_freeze_order"] = (
            checks["mrf_consumer_contract"]
            and mrf_selection["status"] == "pending_C-002-3"
            and mrf_selection["selection_owner"] == "C-002-3"
            and mrf_selection["hospital_candidate_ids"] is None
            and mrf_selection["payer_reporting_entity_candidate_ids"] is None
        )
    accepted_values = {"unaccepted", "not_accepted_on_C-002-1", "not_accepted"}
    checks["r_not_accepted"] = all(value in accepted_values for value in written["acceptance"].values())
    tasks_path = repo / "evaluation/research-program/tasks.json"
    acceptance_path = repo / "docs/research-program/acceptance.md"
    if tasks_path.exists() or acceptance_path.exists():
        sealed = c2_lib.load_sealed_manifest()
        tasks_payload = json.loads(tasks_path.read_text(encoding="utf-8"))
        schema_errors = c2_lib.assert_task_schema(tasks_payload, sealed)
        checks["c2_task_schema"] = schema_errors == []
        out["c2_task_schema_errors"] = schema_errors
        correction_errors = c2_lib.assert_correction_contracts(tasks_payload, repo)
        checks["c2_correction_contracts"] = correction_errors == []
        out["c2_correction_contract_errors"] = correction_errors
        checks["c2_sealed_manifest_hash"] = (
            c2_lib.digest(HERE / c2_lib.SEALED_MANIFEST_NAME) == c2_lib.SEALED_MANIFEST_SHA256
        )
        checks["c2_r14_protocol_hash"] = (
            c2_lib.digest(HERE / c2_lib.R14_PROTOCOL_NAME) == c2_lib.R14_PROTOCOL_SHA256
        )
        acceptance_text = acceptance_path.read_text(encoding="utf-8")
        acceptance_errors = c2_lib.assert_acceptance_document(acceptance_text)
        checks["c2_acceptance_rows"] = acceptance_errors == []
        out["c2_acceptance_errors"] = acceptance_errors
        checks["c2_tasks_rebuild"] = tasks_payload == c2_lib.build_tasks_payload(repo)
        checks["c2_holdout_boundary"] = not c2_lib.contains_private_fields(tasks_payload)
        checks["c2_r14_not_materialized"] = (
            tasks_payload.get("r14", {}).get("materialized") is False
            and tasks_payload.get("r14", {}).get("frozen_sample") is False
        )
        checks["c2_cohorts_not_rewritten_before_c3"] = c3_frozen or digest(cohorts_path) == c2_lib.C1_COHORTS_SHA256
        fixtures = json.loads((HERE / "negative-selector-fixtures.json").read_text(encoding="utf-8"))
        checks["c2_negative_fixtures"] = (
            all(item.get("expected") == "reject" for item in fixtures["fixtures"])
            and {item["id"] for item in fixtures["fixtures"]} >= {
                "NEG-HOLDOUT-RAW-QUERY",
                "NEG-DELETE-DIFFICULT-MEMBER",
                "NEG-TASKS-AS-R14-GOLD",
                "NEG-PROTOCOL-AS-MATERIALIZED-FRAME",
                "NEG-CATALOG-AS-RETRIEVAL-DENOMINATOR",
            }
        )
        checks["c2_hash_scheme_non_circular"] = (
            "own digest" in c2_lib.hash_scheme()["circularity_rule"]
            and "tasks_sha256" not in tasks_payload
        )
    checks["predecessor_retained"] = (
        written["predecessor"]["failed_run_id"] == FAILED_RUN
        and written["predecessor"]["retained_manifest_sha256"] == EXPECTED_PARTIAL_MANIFEST
        and written["predecessor"]["retained_catalog_sha256"] == EXPECTED_CATALOG
    )
    probes = list((HERE).glob("_probe*.py"))
    checks["no_temp_probes"] = probes == []
    receipt_path = HERE / "c1-build-receipt.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    checks["c1_build_receipt_preserved"] = digest(receipt_path) == c2_lib.C1_BUILD_RECEIPT_SHA256
    checks["c1_verify_receipt_preserved"] = (
        digest(HERE / "c1-verify-receipt.json") == c2_lib.C1_VERIFY_RECEIPT_SHA256
    )
    checks["c2_build_receipt_preserved"] = (
        digest(HERE / "c2-build-receipt.json") == c2_lib.C2_BUILD_RECEIPT_SHA256
    )
    checks["c2_verify_receipt_preserved"] = (
        digest(HERE / "c2-verify-receipt.json") == c2_lib.C2_VERIFY_RECEIPT_SHA256
    )
    if digest(cohorts_path) == c2_lib.C1_COHORTS_SHA256:
        checks["receipt_hash"] = receipt["cohorts_sha256"] == digest(cohorts_path)
    else:
        checks["receipt_hash"] = receipt["cohorts_sha256"] == c2_lib.C1_COHORTS_SHA256
    out["resolution"] = written["resolution"]
    out["cohorts_sha256"] = digest(cohorts_path)
    out["receipt_sha256"] = digest(receipt_path)
    out["checks"] = checks
    failed_names = [name for name, ok in checks.items() if not ok]
    out["failed_checks"] = failed_names
    verify_receipt = {
        "format": (
            "ushso.research-program.pr-002.c2-correction-verify-receipt.v1"
            if args.receipt_output and args.receipt_output.name.startswith("c2-correction-")
            else "ushso.research-program.pr-002.c1-verify-receipt.v1"
        ),
        "ok": not failed_names,
        "failed_checks": failed_names,
        "checks": checks,
        "head_sha": head,
        "base_sha": base,
        "cohorts_sha256": out["cohorts_sha256"],
        "product_catalog_sha256": digest(catalog_path),
        "build_receipt_sha256": out["receipt_sha256"],
        "related_candidate_count": len(related),
        "resolution": written["resolution"],
        "mrf_selection": mrf_selection,
        "isolated_record_ids": isolated,
        "source_slices": dict(slices),
        "acceptance": written["acceptance"],
        "status": written["status"],
        "pending": written["pending"],
        "receipt_mode": "explicit_output" if args.receipt_output else "read_only",
        "receipt_output": str(args.receipt_output.resolve()) if args.receipt_output else None,
        "c1_build_receipt_preserved": checks.get("c1_build_receipt_preserved"),
        "c1_verify_receipt_preserved": checks.get("c1_verify_receipt_preserved"),
        "c2_build_receipt_preserved": checks.get("c2_build_receipt_preserved"),
        "c2_verify_receipt_preserved": checks.get("c2_verify_receipt_preserved"),
    }
    if args.receipt_output:
        verify_path = args.receipt_output.resolve()
        if verify_path.parent == HERE and verify_path.name in c2_lib.HISTORICAL_RECEIPT_NAMES:
            raise SystemExit(f"refusing to overwrite historical C1 receipt {verify_path}")
        verify_path.parent.mkdir(parents=True, exist_ok=True)
        verify_path.write_text(json.dumps(verify_receipt, indent=2) + "\n", encoding="utf-8")
        out["verify_receipt_sha256"] = digest(verify_path)
        out["receipt_output"] = str(verify_path)
    else:
        # Independent replay must not rewrite the producer receipt or dirty the
        # candidate.  Use --receipt-output explicitly when a new receipt is
        # intended, including when refreshing the producer artifact.
        out["verify_receipt_sha256"] = None
        out["receipt_output"] = None
    print(json.dumps({
        "ok": not failed_names,
        "failed_checks": failed_names,
        "cohorts_sha256": out["cohorts_sha256"],
        "product_count": written["resolution"]["product_count"],
        "selector_counts": written["resolution"]["selector_counts"],
        "failed_selectors": failed,
        "unsupported_selectors": unsupported,
        "cms_duplicate_title_groups": written["resolution"]["cms_duplicate_title_groups"],
        "isolated": isolated,
        "source_slices": dict(slices),
        "head": head,
        "base": base,
        "receipt_output": out["receipt_output"],
    }, indent=2))
    return 0 if not failed_names else 1


if __name__ == "__main__":
    sys.exit(main())
