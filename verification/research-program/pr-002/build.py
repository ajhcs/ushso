#!/usr/bin/env python3
"""Write evaluation/research-program/cohorts.json from the declared catalog."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from c1_lib import HERE, build_payload, digest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path("."))
    args = parser.parse_args()
    repo = args.repo.resolve()
    payload = build_payload(repo)
    out = repo / "evaluation/research-program/cohorts.json"
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
    (HERE / "c1-build-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "cohorts_sha256": receipt["cohorts_sha256"],
        "bytes": receipt["cohorts_bytes"],
        "failed_selectors": receipt["failed_selectors"],
        "unsupported_selectors": receipt["unsupported_selectors"],
        "cms_duplicate_title_groups": receipt["cms_duplicate_title_groups"],
        "selector_counts": receipt["selector_counts"],
        "isolated": receipt["isolated_record_ids"],
        "source_slices": receipt["source_slices"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
