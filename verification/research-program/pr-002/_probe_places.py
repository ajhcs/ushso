#!/usr/bin/env python3
from pathlib import Path
import json
ROOT = Path(__file__).resolve().parents[3]
for stem in ("records-0001", "records-0002", "records-0003"):
    with (ROOT / "packages/retrieval/versions/v1.2.0/corpus" / f"{stem}.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            title = row["title"]
            if title.startswith("PLACES:") and "County Data" in title and "GIS" not in title:
                print(row["identity"]["match_fields"]["source_id"], title, row["record_id"])
            if "SAIPESTATECOUNTY" in (row["identity"]["match_fields"].get("source_id") or ""):
                print("SAIPE", row["record_id"], row["title"], row.get("authoritative_url"))
            if row["title"] == "Hospital Provider Cost Report":
                ident = row["identity"]
                print("HCRIS record", row["record_id"])
                print("match", json.dumps(ident["match_fields"], indent=2)[:800])
                print("asset", ident["asset"])
                print("url", row.get("authoritative_url"))
