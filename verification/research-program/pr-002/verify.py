#!/usr/bin/env python3
"""Replay C-002-1 identity checks from local catalog, corpus shards, and cohorts.json."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

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
    related_ids = {
        rel["record_id"]
        for item in written["products"]
        for rel in item["anchor"]["related_releases"]
    }
    checks["related_not_counted_as_products"] = related_ids.isdisjoint(set(reps))
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
        "not the" in " ".join(item["anchor"]["unresolved_identity_limits"])
        for item in written["products"]
        if item["product_key"] in {"hospital-price-transparency-mrfs", "payer-transparency-in-coverage-mrfs"}
    )
    checks["r_not_accepted"] = all(
        value == "not_accepted_on_C-002-1" for value in written["acceptance"].values()
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
    checks["receipt_hash"] = receipt["cohorts_sha256"] == digest(cohorts_path)
    out["resolution"] = written["resolution"]
    out["cohorts_sha256"] = digest(cohorts_path)
    out["receipt_sha256"] = digest(receipt_path)
    out["checks"] = checks
    failed_names = [name for name, ok in checks.items() if not ok]
    out["failed_checks"] = failed_names
    verify_receipt = {
        "format": "ushso.research-program.pr-002.c1-verify-receipt.v1",
        "ok": not failed_names,
        "failed_checks": failed_names,
        "checks": checks,
        "head_sha": head,
        "base_sha": base,
        "cohorts_sha256": out["cohorts_sha256"],
        "product_catalog_sha256": digest(catalog_path),
        "build_receipt_sha256": out["receipt_sha256"],
        "resolution": written["resolution"],
        "isolated_record_ids": isolated,
        "source_slices": dict(slices),
        "acceptance": written["acceptance"],
        "status": written["status"],
        "pending": written["pending"],
    }
    verify_path = HERE / "c1-verify-receipt.json"
    verify_path.write_text(json.dumps(verify_receipt, indent=2) + "\n", encoding="utf-8")
    out["verify_receipt_sha256"] = digest(verify_path)
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
    }, indent=2))
    return 0 if not failed_names else 1


if __name__ == "__main__":
    sys.exit(main())
