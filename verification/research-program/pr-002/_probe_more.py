#!/usr/bin/env python3
from pathlib import Path
import json, re

ROOT = Path(__file__).resolve().parents[3]
rows = []
for stem in ("records-0001", "records-0002", "records-0003"):
    with (ROOT / "packages/retrieval/versions/v1.2.0/corpus" / f"{stem}.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))

needles = [
    "ECNHOSP",
    "CJR",
    "Comprehensive Care for Joint Replacement",
    "Population Estimates",
    "SAIPE",
    "PEP",
    "gazetteer",
    "TIGER",
    "County Business Patterns",
    "Medicare Diabetes Prevention",
    "End-Stage Renal Disease Facility Aggregation",
    "Managing Clinician",
]
print("=== title/native hits ===")
for row in rows:
    title = row["title"]
    native = row["identity"]["match_fields"].get("source_id") or ""
    blob = f"{title} {native}"
    for needle in needles:
        if needle.lower() in blob.lower():
            print(row["identity"]["source"]["source_id"], native, title[:130])
            break

print("\n=== census ids of interest ===")
for row in rows:
    native = row["identity"]["match_fields"].get("source_id") or ""
    if any(x in native for x in ("ECNHOSP2022", "ACSDP5Y2024", "ACSDP1Y2024", "ACSST5Y2024", "ACSDT5Y2024", "ACSPUMS5Y2024", "ACSPUMS1Y2024", "ACSSPP1Y2024", "ACSCP5Y2024", "ACSDT5YAIAN", "ACSFLOWS2022", "PEPPOP", "PEPANNRES", "SAIPE")):
        print(native, row["title"][:100], row["record_id"])
