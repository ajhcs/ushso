#!/usr/bin/env python3
"""Build PR-002 artifacts. C1 receipts are historical and are not overwritten."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from c1_lib import HERE, build_payload, digest
import c2_lib


def _refuse_historical(path: Path | None) -> None:
    if path is None:
        return
    target = path.resolve()
    if target.parent == HERE and target.name in c2_lib.HISTORICAL_RECEIPT_NAMES:
        raise SystemExit(f"refusing to overwrite historical C1 receipt {target}")


def build_c1(repo: Path, receipt_output: Path | None) -> dict:
    out = repo / "evaluation/research-program/cohorts.json"
    if out.exists():
        existing = json.loads(out.read_text(encoding="utf-8"))
        if existing.get("mrf_selection", {}).get("hospital_candidate_ids"):
            raise SystemExit("refusing to overwrite C3-frozen cohorts with the C1 builder")
        if digest(out) != c2_lib.C1_COHORTS_SHA256 and existing.get("commit_id") != "C-002-1":
            raise SystemExit("refusing to overwrite a later cohorts overlay with the C1 builder")
    payload = build_payload(repo)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    receipt = {
        "format": "ushso.research-program.pr-002.c1-build-receipt.v1",
        "cohorts_path": "evaluation/research-program/cohorts.json",
        "cohorts_sha256": digest(out),
        "cohorts_bytes": out.stat().st_size,
        "product_catalog_sha256": digest(HERE / "product_catalog.py"),
        "product_count": payload["resolution"]["product_count"],
        "baseline_record_count": len(payload["baseline_records"]),
        "failed_selectors": payload["resolution"]["failed_selectors"],
        "unsupported_selectors": payload["resolution"]["unsupported_selectors"],
        "cms_duplicate_title_groups": payload["resolution"]["cms_duplicate_title_groups"],
        "selector_counts": payload["resolution"]["selector_counts"],
        "isolated_record_ids": payload["corpus"]["isolated_record_ids"],
        "source_slices": payload["corpus"]["source_slices"],
        "program_key_unique": payload["resolution"]["program_key_unique"],
        "cms_unique_titles_in_corpus": payload["resolution"]["cms_unique_titles_in_corpus"],
    }
    historical = HERE / "c1-build-receipt.json"
    if historical.exists() and digest(historical) == c2_lib.C1_BUILD_RECEIPT_SHA256:
        # Preserve the C1 producer receipt byte-for-byte.
        pass
    elif receipt_output is None:
        historical.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    if receipt_output is not None:
        _refuse_historical(receipt_output)
        receipt_output.parent.mkdir(parents=True, exist_ok=True)
        receipt_output.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "stage": "c1",
        "cohorts_sha256": receipt["cohorts_sha256"],
        "bytes": receipt["cohorts_bytes"],
        "failed_selectors": receipt["failed_selectors"],
        "unsupported_selectors": receipt["unsupported_selectors"],
        "cms_duplicate_title_groups": receipt["cms_duplicate_title_groups"],
        "selector_counts": receipt["selector_counts"],
        "isolated": receipt["isolated_record_ids"],
        "source_slices": receipt["source_slices"],
        "historical_c1_build_receipt_preserved": digest(historical) == c2_lib.C1_BUILD_RECEIPT_SHA256,
    }, indent=2))
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--stage", choices=["c1", "c2", "c3"], default="c1")
    parser.add_argument(
        "--receipt-output",
        type=Path,
        help="optional receipt path; historical C1 receipts cannot be targeted",
    )
    args = parser.parse_args()
    repo = args.repo.resolve()
    _refuse_historical(args.receipt_output)
    if args.stage == "c1":
        build_c1(repo, args.receipt_output)
        return 0
    if args.stage == "c2":
        receipt = c2_lib.write_c2_artifacts(repo, receipt_output=args.receipt_output)
        print(json.dumps({
            "stage": "c2",
            "tasks_sha256": receipt["tasks_sha256"],
            "acceptance_sha256": receipt["acceptance_sha256"],
            "cohorts_sha256": receipt["cohorts_sha256"],
            "c1_historical_cohorts_sha256": receipt["c1_historical_cohorts_sha256"],
            "cohorts_rewritten": receipt["cohorts_rewritten"],
            "c1_receipts_preserved": receipt["c1_receipts_preserved"],
            "evaluator_freeze_manifest_sha256": receipt["evaluator_freeze_manifest_sha256"],
            "r14_protocol_sha256": receipt["r14_protocol_sha256"],
            "receipt_output": receipt.get("receipt_output"),
        }, indent=2))
        return 0
    raise SystemExit("C-002-3 builder is added in the C-002-3 commit")


if __name__ == "__main__":
    sys.exit(main())
