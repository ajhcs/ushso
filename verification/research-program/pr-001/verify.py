#!/usr/bin/env python3
"""Replay the bounded PR-001 identity checks from explicit local paths.

The live response bodies, deployment readback, preservation index, and audit
CSV are retained local evidence. This verifier never makes a network request
and never writes to any input or to the repository.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


EXPECTED_BASE = "45210704b8de2d7b1360b6d32657cd17791bdd77"
EXPECTED_TREE = "35de194e7182a67a0275cc180f2b021da184aacd"
EXPECTED_SOURCE = "11b268c17b5b65261041734abca456720b0d9706"
EXPECTED_PRESERVATION = "3946fa64ea2803477195f999aca4b58c00be467fb3cdec552f9dd374542decd7"
EXPECTED_ASSET_LOCK = "75f362a1545f469a74bef00b7d7126fd03ffbfc79e4e6421bafe9fcf62db6c3b"
EXPECTED_DICTIONARY_MANIFEST = "0f10c6b764d054cd15324c4a1d93d6da191d86b792976d9573cdf27feceecb6b"
EXPECTED_ISOLATED = [
    "obs:asset:cdc-socrata:2g2d-yfx9-060a56b0e1f5e82b",
    "obs:asset:cdc-socrata:38b4-r9iv-82269ee71b664250",
    "obs:asset:cdc-socrata:4ckf-c7xz-8a5026e46b58641e",
    "obs:asset:cdc-socrata:va9e-d8re-c845d9bfb921e339",
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--live-dir", type=Path, required=True)
    parser.add_argument("--readback", type=Path, required=True)
    parser.add_argument("--preservation-manifest", type=Path, required=True)
    parser.add_argument("--audit-csv", type=Path, required=True)
    parser.add_argument("--dictionary-manifest", type=Path, required=True)
    parser.add_argument("--original-repo", type=Path)
    args = parser.parse_args()

    checks: dict[str, bool] = {}
    out: dict[str, Any] = {}

    head_sha = git(args.repo, "rev-parse", "HEAD")
    base_sha = git(args.repo, "rev-parse", EXPECTED_BASE)
    base_tree = git(args.repo, "rev-parse", f"{EXPECTED_BASE}^{{tree}}")
    source_tree = git(args.repo, "rev-parse", f"{EXPECTED_SOURCE}^{{tree}}")
    base_is_ancestor = subprocess.run(
        ["git", "-C", str(args.repo), "merge-base", "--is-ancestor", EXPECTED_BASE, "HEAD"],
        check=False,
    ).returncode == 0
    checks["base"] = base_sha == EXPECTED_BASE and base_tree == EXPECTED_TREE and base_is_ancestor
    checks["source_tree"] = source_tree == EXPECTED_TREE
    out["base"] = {
        "selected_sha": base_sha,
        "selected_tree": base_tree,
        "head_sha": head_sha,
        "base_is_ancestor": base_is_ancestor,
        "source_sha": EXPECTED_SOURCE,
        "source_tree": source_tree,
    }

    corpus_root = args.repo / "packages/retrieval/versions/v1.2.0"
    live_files = {
        "corpus/corpus.json": "published-corpus.body",
        "corpus/records-0001.jsonl": "records-0001.body",
        "corpus/records-0002.jsonl": "records-0002.body",
        "corpus/records-0003.jsonl": "records-0003.body",
    }
    file_results: dict[str, Any] = {}
    for relative, live_name in live_files.items():
        local = corpus_root / relative
        live = args.live_dir / live_name
        local_sha = digest(local)
        live_sha = digest(live)
        file_results[relative] = {
            "local_sha256": local_sha,
            "live_sha256": live_sha,
            "local_bytes": local.stat().st_size,
            "live_bytes": live.stat().st_size,
        }
    checks["corpus_bytes"] = all(item["local_sha256"] == item["live_sha256"] for item in file_results.values())

    rows: list[dict[str, Any]] = []
    for stem in ("records-0001", "records-0002", "records-0003"):
        for line in (args.live_dir / f"{stem}.body").read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    record_ids = [row.get("record_id") for row in rows]
    isolated = [record_id for row, record_id in zip(rows, record_ids) if not isinstance(row.get("description"), str) or not row["description"].strip()]
    searchable = len(rows) - len(isolated)
    checks["corpus_records"] = len(rows) == 3434 and len(set(record_ids)) == 3434 and searchable == 3430 and isolated == EXPECTED_ISOLATED
    out["corpus"] = {
        "files": file_results,
        "record_count": len(rows),
        "unique_record_id_count": len(set(record_ids)),
        "searchable_record_count": searchable,
        "isolated_record_ids": isolated,
    }

    receipts = read_json(args.live_dir / "receipts.json")
    corpus = read_json(args.live_dir / "published-corpus.body")
    catalog = read_json(args.live_dir / "catalog-first.body")
    contract = read_json(args.live_dir / "contract.body")
    readback = read_json(args.readback)
    latest = readback["deployments"][-1]
    checks["public_content"] = (
        len(receipts) == 8
        and all(item["status"] == 200 for item in receipts)
        and corpus["corpus_version"] == "1.2.0"
        and corpus["record_count"] == 3434
        and catalog["total_matches"] == 3430
        and catalog["partial_results"]["invalid_item_count"] == 4
        and contract["contract_version"] == "observatory-webmcp-tool.v1.3.0"
        and contract["enabled_tool_count"] == 8
        and any(item["name"] == "observatory.plan_research" for item in contract["disabled_tools"])
    )
    checks["deployment_readback"] = (
        readback["exit_code"] == 0
        and readback["mutation"] is False
        and latest["id"] == "d0e89eef-5bf4-43d0-a0ba-20fbdc128c81"
        and latest["versions"][0]["version_id"] == "ecc1603f-9eb4-4a1b-a566-bd9d7a415de4"
        and latest["versions"][0]["percentage"] == 100
    )
    out["public"] = {
        "request_count": len(receipts),
        "all_http_200": all(item["status"] == 200 for item in receipts),
        "catalog_total_matches": catalog["total_matches"],
        "catalog_invalid_item_count": catalog["partial_results"]["invalid_item_count"],
        "contract_version": contract["contract_version"],
        "enabled_tool_count": contract["enabled_tool_count"],
        "disabled_tools": [item["name"] for item in contract["disabled_tools"]],
        "deployment_id": latest["id"],
        "version_id": latest["versions"][0]["version_id"],
        "traffic_percent": latest["versions"][0]["percentage"],
    }

    preservation_sha = digest(args.preservation_manifest)
    checks["preservation"] = preservation_sha == EXPECTED_PRESERVATION
    out["preservation_manifest_sha256"] = preservation_sha
    if args.original_repo:
        status = subprocess.check_output(
            ["git", "-C", str(args.original_repo), "status", "--porcelain"], text=True
        )
        out["original_status_lines"] = len([line for line in status.splitlines() if line])
        checks["original_preserved_dirty"] = out["original_status_lines"] > 0

    with args.audit_csv.open(newline="", encoding="utf-8") as handle:
        audit_rows = list(csv.DictReader(handle))
    present_counts: dict[str, int] = {}
    for row in audit_rows:
        value = row["dictionary_present"]
        present_counts[value] = present_counts.get(value, 0) + 1
    checks["audit_csv"] = len(audit_rows) == 3434 and present_counts == {"True": 2905, "False": 529}
    out["audit_dictionary_inventory"] = {"rows": len(audit_rows), "dictionary_present": present_counts}

    dictionary = read_json(args.dictionary_manifest)
    dictionary_record_count = len(dictionary["records"])
    checks["proposal_manifest"] = (
        digest(args.dictionary_manifest) == EXPECTED_DICTIONARY_MANIFEST
        and dictionary["generation"] == "live-2026-09-03-85b50522b420"
        and dictionary["review_status"] == "pending_owner_review"
        and dictionary["publication_authorized"] is False
        and dictionary["canonical_records_changed"] == 0
        and dictionary_record_count == 2905
        and len(dictionary["isolated"]) == 95
        and dictionary["variables"] == 1573847
        and dictionary["pages"] == 34081
        and dictionary["maximum_page_bytes"] == 65535
    )
    out["proposal_dictionary_package"] = {
        "manifest_sha256": digest(args.dictionary_manifest),
        "record_count": dictionary_record_count,
        "isolated_count": len(dictionary["isolated"]),
        "variables": dictionary["variables"],
        "pages": dictionary["pages"],
        "maximum_page_bytes": dictionary["maximum_page_bytes"],
        "review_status": dictionary["review_status"],
        "publication_authorized": dictionary["publication_authorized"],
    }

    asset_lock_path = args.repo / "config/research-assets.lock.json"
    asset_lock = read_json(asset_lock_path)
    dictionary_lock = next(item for item in asset_lock["packages"] if item["id"] == "dictionary-review-package")
    checks["research_asset_lock"] = (
        digest(asset_lock_path) == EXPECTED_ASSET_LOCK
        and asset_lock["source"]["archive"]["sha256"] == "153f7b8c8934095882e46f134334ddb5f6ef29a03aed8358d71878f92ac4a76f"
        and asset_lock["source"]["archive"]["bytes"] == 163540588
        and dictionary_lock["manifest_sha256"] == EXPECTED_DICTIONARY_MANIFEST
        and dictionary_lock["tree_sha256"] == "f06d3190d5fc4a3a36b51dd2c1d722d0e790e6c628213fb7cd9c700f1d3d79e5"
        and dictionary_lock["file_count"] == 41715
        and dictionary_lock["record_count"] == 2905
        and dictionary_lock["status"]["publication_authorized"] is False
    )
    out["research_asset_lock"] = {
        "sha256": digest(asset_lock_path),
        "archive_sha256": asset_lock["source"]["archive"]["sha256"],
        "archive_bytes": asset_lock["source"]["archive"]["bytes"],
        "dictionary_tree_sha256": dictionary_lock["tree_sha256"],
        "dictionary_file_count": dictionary_lock["file_count"],
        "dictionary_record_count": dictionary_lock["record_count"],
    }

    runtime = (args.repo / "worker/index.mjs").read_text(encoding="utf-8")
    dictionary_router = (args.repo / "worker/dictionary-review-router.mjs").read_text(encoding="utf-8")
    wrangler = (args.repo / "wrangler.jsonc").read_text(encoding="utf-8")
    checks["runtime_paths"] = (
        '"main": "worker/index.mjs"' in wrangler
        and "env.ASSETS" in runtime
        and "corpus.record_files" in runtime
        and "/api/research/v1/dictionary-review" in dictionary_router
    )
    out["runtime_paths"] = {
        "wrangler_main": "worker/index.mjs",
        "catalog_source": "ASSETS/corpus.record_files",
        "dictionary_review_route": "/api/research/v1/dictionary-review",
        "dictionary_review_binding": "USHSO_DICTIONARY_REVIEW",
    }

    out["checks"] = checks
    out["ok"] = all(checks.values())
    print(json.dumps(out, indent=2, sort_keys=True))
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
