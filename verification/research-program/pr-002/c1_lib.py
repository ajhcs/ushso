#!/usr/bin/env python3
"""Shared C-002-1 catalog/corpus resolution. Local shards only; no network."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
PRODUCT_FIELDS = (
    "product_key",
    "program_key",
    "title",
    "domain",
    "publisher",
    "named_priority",
    "access_expectation",
    "product_release_distinction",
    "rationale",
    "resolve",
)
EXPECTED_BASE = "83f7d1bad39acb6a7eede95a404179c511296efa"
EXPECTED_PRODUCER = "8fc2fbbbaf1016da4c3951ccd238918ce645f4fe"
EXPECTED_MERGE = "035465f3f16d15f02467679d96451d4440a36ca8"
EXPECTED_GENERATION = "live-2026-09-03-85b50522b420"
EXPECTED_MANIFEST = "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e"
EXPECTED_CATALOG = "5183f7ac32aeaaa0402965c9658ca1e048ebcbaea18a57cc20a542850e222684"
EXPECTED_PARTIAL_MANIFEST = "6a764fd4157b4dcf0a8b44a977364d8bccc2c6f88b5e87c05711e1cde39377e6"
FAILED_RUN = "ushso-pr002-cohort-freeze-20260910"
SHARD_HASHES = {
    "records-0001.jsonl": "8b7403e0d0d363ea5879a9dc2e0e2a774ea31e5cd556bf1826ec02706cd33202",
    "records-0002.jsonl": "d6b5962ed075ffc8526d766499a04c685ab89231d1d71226ea87eff7e432c579",
    "records-0003.jsonl": "772e6c3fcc9fd98c98b1e0a33abf5c77998ca5352fc02295b9fb554af35be082",
}
EXPECTED_ISOLATED = [
    "obs:asset:cdc-socrata:2g2d-yfx9-060a56b0e1f5e82b",
    "obs:asset:cdc-socrata:38b4-r9iv-82269ee71b664250",
    "obs:asset:cdc-socrata:4ckf-c7xz-8a5026e46b58641e",
    "obs:asset:cdc-socrata:va9e-d8re-c845d9bfb921e339",
]
SOURCE_SLICES = {"cms-data-catalog": 159, "cdc-socrata": 1472, "census-api": 1803}
YEAR_SUFFIX = re.compile(r"(19|20)\d{2}$")
INTAKE_LIMITS = {
    "state-apcd-programs": "Family-level freeze only; actual jurisdiction/source intake is later (PR-044).",
    "state-facility-licensure": "Family-level freeze only; actual jurisdiction/source intake is later (PR-044). CMS certification is not state licensure.",
    "hospital-price-transparency-mrfs": "Family entry is not the 25-hospital MRF pilot; PR-046 selects those entities later.",
    "payer-transparency-in-coverage-mrfs": "Family entry is not the 10-payer MRF pilot; PR-049 selects those entities later.",
    "cdc-atsdr-social-vulnerability-index": "Named exact ATSDR SVI family. Catalog ypqf-r5qs is HHS ASPE SVI and does not satisfy this family.",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_catalog():
    ns: dict = {}
    path = HERE / "product_catalog.py"
    exec(compile(path.read_text(encoding="utf-8"), str(path), "exec"), ns)
    ns["validate_catalog"]()
    if digest(path) != EXPECTED_CATALOG:
        raise SystemExit("product_catalog.py hash mismatch")
    return ns["PRODUCTS"], ns["DOMAINS"]


def source_id(row: dict) -> str:
    return row["identity"]["source"]["source_id"]


def native_id(row: dict):
    return row["identity"]["match_fields"].get("source_id")


def dataset_id(row: dict) -> str:
    return (native_id(row) or "").rstrip("/").split("/")[-1]


def evidence_ids(row: dict) -> list[str]:
    items = row.get("evidence") or []
    return [item["evidence_id"] for item in items if isinstance(item, dict) and item.get("evidence_id")]


def pointer(row: dict) -> dict:
    return {
        "record_id": row["record_id"],
        "source_id": source_id(row),
        "native_id": native_id(row),
        "title": row["title"],
        "authoritative_url": row.get("authoritative_url"),
        "evidence_ids": evidence_ids(row),
        "shard": row["_shard"],
        "line": row["_line"],
    }


def representative(matches: list[dict]) -> dict:
    return sorted(matches, key=lambda row: (row["record_id"], row["_shard"], row["_line"]))[0]


def load_rows(repo: Path):
    corpus = repo / "packages/retrieval/versions/v1.2.0/corpus"
    rows = []
    shard_info = {}
    for name, expected in SHARD_HASHES.items():
        path = corpus / name
        sha = digest(path)
        if sha != expected:
            raise SystemExit(f"{name} hash mismatch: {sha}")
        shard_info[name] = {
            "path": f"packages/retrieval/versions/v1.2.0/corpus/{name}",
            "sha256": sha,
            "bytes": path.stat().st_size,
        }
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.strip():
                rec = json.loads(line)
                rec["_shard"] = name
                rec["_line"] = line_no
                rows.append(rec)
    return rows, shard_info, corpus


def index_records(rows):
    cms_title, cdc_native, census_ds = defaultdict(list), defaultdict(list), defaultdict(list)
    for row in rows:
        src = source_id(row)
        if src == "cms-data-catalog":
            cms_title[row["title"]].append(row)
        elif src == "cdc-socrata":
            cdc_native[native_id(row)].append(row)
        elif src == "census-api":
            census_ds[dataset_id(row)].append(row)
    return cms_title, cdc_native, census_ds


def census_family(ds: str) -> str:
    return YEAR_SUFFIX.sub("YEAR", ds)


def related_census(target_ds, census_ds, representative_id):
    family = census_family(target_ds)
    out = []
    for ds, group in sorted(census_ds.items()):
        if census_family(ds) != family:
            continue
        for row in sorted(group, key=lambda item: item["record_id"]):
            if row["record_id"] != representative_id:
                out.append({
                    "record_id": row["record_id"],
                    "native_id": native_id(row),
                    "dataset_id": ds,
                    "title": row["title"],
                    "relation": "annual_variant",
                })
    return out


def related_by_title_prefix(rows, prefix, representative_id, gis_relation="gis_redistribution", other_relation="annual_or_geography_variant"):
    out = []
    for row in rows:
        title = row["title"]
        if not title.startswith(prefix) or row["record_id"] == representative_id:
            continue
        relation = gis_relation if "GIS Friendly Format" in title else other_relation
        out.append({"record_id": row["record_id"], "native_id": native_id(row), "title": title, "relation": relation})
    return sorted(out, key=lambda item: item["record_id"])


def resolve_product(product, rows, cms_title, cdc_native, census_ds):
    spec = product["resolve"]
    kind = spec["kind"]
    limits, related, matches, failed, intake = [], [], [], None, None
    if kind == "cms_title":
        matches = list(cms_title.get(spec["title"], []))
        if not matches:
            failed = {"reason": "cms_title_not_found", "title": spec["title"]}
        elif len(matches) > 1:
            limits.append("Multiple CMS catalog records share this exact title; grouped as representative releases/aliases, not extra products.")
    elif kind == "cdc_native":
        matches = list(cdc_native.get(spec["source_id"], []))
        if not matches:
            failed = {"reason": "cdc_native_not_found", "source_id": spec["source_id"]}
        if product["product_key"] == "cdc-places-local-data-for-better-health" and matches:
            related = related_by_title_prefix(rows, "PLACES:", representative(matches)["record_id"])
        if product["product_key"] == "cdc-nonmedical-factor-measures-county-acs" and matches:
            related = related_by_title_prefix(
                rows,
                "Non-Medical Factor Measures",
                representative(matches)["record_id"],
                other_relation="geography_distribution",
            )
        if product["product_key"] == "hhs-aspe-social-vulnerability-index":
            limits.append("This catalog SVI record is HHS ASPE, not CDC/ATSDR SVI.")
    elif kind == "census_dataset":
        matches = list(census_ds.get(spec["dataset_id"], []))
        if not matches:
            failed = {"reason": "census_dataset_not_found", "dataset_id": spec["dataset_id"]}
        elif matches:
            related = related_census(spec["dataset_id"], census_ds, representative(matches)["record_id"])
    elif kind == "intake":
        intake = {
            "intake_task": spec["intake_task"],
            "locator": spec["locator"],
            "locator_kind": spec["locator_kind"],
            "locator_status": "unverified_locator",
        }
        extra = INTAKE_LIMITS.get(product["product_key"])
        if extra:
            limits.append(extra)
        limits.append("Proposed locator is an unverified locator until later captured; not fetched, available, or current.")
    else:
        failed = {"reason": "unsupported_selector_kind", "kind": kind}
    if kind == "intake" and failed is None:
        status = "named_intake"
    elif failed:
        status = "failed_selector"
    elif len(matches) > 1:
        status = "resolved_catalog_record_with_duplicates"
    else:
        status = "resolved_catalog_record"
    declared = {field: product[field] for field in PRODUCT_FIELDS}
    declared["anchor"] = {
        "status": status,
        "selector": spec,
        "match_count": len(matches),
        "representative": None if not matches else pointer(representative(matches)),
        "duplicate_group": None if len(matches) <= 1 else [pointer(row) for row in sorted(matches, key=lambda item: item["record_id"])],
        "related_releases": related,
        "intake": intake,
        "failed_selector": failed,
        "unresolved_identity_limits": limits,
        "access_expectation_is_not_proof": True,
    }
    return declared


def baseline_records(rows):
    out = []
    for row in rows:
        desc = row.get("description")
        out.append({
            "record_id": row["record_id"],
            "source_id": source_id(row),
            "native_id": native_id(row),
            "title": row["title"],
            "isolated": not isinstance(desc, str) or not desc.strip(),
            "shard": row["_shard"],
            "line": row["_line"],
            "evidence_ids": evidence_ids(row),
            "source_run_disposition": "not_attempted",
        })
    return out


def build_payload(repo: Path) -> dict:
    products_decl, domains = load_catalog()
    rows, shard_info, corpus = load_rows(repo)
    meta = json.loads((corpus / "corpus.json").read_text(encoding="utf-8"))
    if meta["publication"]["generation"] != EXPECTED_GENERATION:
        raise SystemExit("generation mismatch")
    if meta["manifest_sha256"] != EXPECTED_MANIFEST:
        raise SystemExit("manifest mismatch")
    cms_title, cdc_native, census_ds = index_records(rows)
    products = [resolve_product(item, rows, cms_title, cdc_native, census_ds) for item in products_decl]
    baseline = baseline_records(rows)
    isolated = [item["record_id"] for item in baseline if item["isolated"]]
    kinds, failed, unsupported, duplicate_groups = defaultdict(int), [], [], []
    for product in products:
        kinds[product["resolve"]["kind"]] += 1
        anchor = product["anchor"]
        if anchor["failed_selector"]:
            failed.append({"product_key": product["product_key"], **anchor["failed_selector"]})
            if anchor["failed_selector"].get("reason") == "unsupported_selector_kind":
                unsupported.append(anchor["failed_selector"])
        if anchor["duplicate_group"]:
            duplicate_groups.append({
                "product_key": product["product_key"],
                "match_count": anchor["match_count"],
                "record_ids": [item["record_id"] for item in anchor["duplicate_group"]],
            })
    slices = defaultdict(int)
    for item in baseline:
        slices[item["source_id"]] += 1
    return {
        "format": "ushso.research-program.cohorts.v1",
        "pr_id": "PR-002",
        "commit_id": "C-002-1",
        "status": "partial_C1_complete",
        "pending": ["C-002-2", "C-002-3"],
        "claim_boundary": "C-002-1 freezes product identities, representative catalog anchors or named intake tasks, and the exact 3434-record baseline identity set. It does not freeze tasks, acceptance rows, or MRF 25/10 pilots. Access expectation is not payload proof. R01-R16 are not accepted on this artifact.",
        "base": {
            "sha": EXPECTED_BASE,
            "pr001_producer_sha": EXPECTED_PRODUCER,
            "pr001_merge_sha": EXPECTED_MERGE,
        },
        "corpus": {
            "corpus_id": meta["corpus_id"],
            "version": meta["corpus_version"],
            "generation": EXPECTED_GENERATION,
            "manifest_sha256": EXPECTED_MANIFEST,
            "corpus_json_sha256": digest(corpus / "corpus.json"),
            "record_count": len(baseline),
            "source_slices": dict(slices),
            "isolated_record_ids": isolated,
            "shards": shard_info,
        },
        "predecessor": {
            "failed_run_id": FAILED_RUN,
            "retained_catalog_sha256": EXPECTED_CATALOG,
            "retained_manifest_sha256": EXPECTED_PARTIAL_MANIFEST,
            "contribution": "Recovered the retained 100-product declaration without reconstructing product rows. Temporary probes from the failed run are not part of this commit.",
        },
        "domains": list(domains),
        "products": products,
        "baseline_records": baseline,
        "resolution": {
            "product_count": len(products),
            "selector_counts": dict(kinds),
            "failed_selectors": failed,
            "unsupported_selectors": unsupported,
            "cms_duplicate_title_groups": duplicate_groups,
            "cms_unique_titles_in_corpus": len(cms_title),
            "program_key_unique": len({item["program_key"] for item in products}) == len(products),
        },
        "acceptance": {key: "not_accepted_on_C-002-1" for key in ("R01", "R04", "R07", "R09", "R10", "R12", "R16")},
    }
