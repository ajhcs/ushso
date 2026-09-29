#!/usr/bin/env python3
"""Reproduce the frozen PR-002 C-002-3 directory-only candidate selection.

This script reads only the five named cohort-input files and writes only the
selection-preparation directory. It never requests a URL or opens an endpoint.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import json
import re
import sys

BASE = Path("/mnt/d/tmp/plumbob/ushso-research-program-20260910")
INPUT = BASE / "cohort-inputs"
OUT = BASE / "pr002-pilot-selection-preparation"
SPEC_PATH = OUT / "selection-spec.v1.1.json"
SCRIPT_PATH = Path(__file__).resolve()
SEED = "ushso-pr002-c002-3-directory-selection-20260910-v1"
SPEC_VERSION = "ushso.pr002.c002-3.selection-spec.v1.1"

FILES = {
    "input_index": INPUT / "input-index.json",
    "hospital_identities": INPUT / "hospital-directory-identities.json",
    "hospital_metadata": INPUT / "hospital-directory-metadata.json",
    "payer_identities": INPUT / "payer-directory-identities.json",
    "payer_workbook": INPUT / "payer-issuer-directory.xlsx",
    "capture_receipts": INPUT / "receipts-20260910T155046Z.json",
}
EXPECTED_HASHES = {
    "input_index": "defd18e1fd72671b6c842845eeb2b6ef102526befd9c26cf251fa117dfc39587",
    "hospital_identities": "3cf22001c0d1d831174f6aabe678c2adf508d8cc41911a13c220ed276c619fdd",
    "hospital_metadata": "31eea397b8bfe8207168cefda23256eb9cb3d5e49158d221eda8465a2d8e5f8c",
    "payer_identities": "7ecd1fe538ba0d49d04d6b418541ff1824f4aba5dc3f6aa78242e63e028df26c",
    "payer_workbook": "09a5d4a33b5825feb3f4943e3cb6ebd9577b8665dd6def15ac01e12b273b5f0b",
    "capture_receipts": "09d4ac6b29f6d8c041053bbb956d46a34c2cfef6c78157c53b2712b1aa88e9c1",
}

HOSPITAL_FIELDS = ["Facility ID", "Facility Name", "City/Town", "State", "Hospital Type", "Hospital Ownership"]
PAYER_FIELDS = ["hios_issuer_id", "issuer_legal_name", "state", "required_to_submit_qis_form"]


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def digest(path: Path) -> str:
    h = sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def dump(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def must(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def sha_material(parts: list[str]) -> str:
    return sha256("\0".join(parts).encode("utf-8")).hexdigest()


def parse_workbook(path: Path) -> dict[str, object]:
    ns = {
        "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    }
    with ZipFile(path) as z:
        names = set(z.namelist())
        must("xl/workbook.xml" in names, "workbook.xml missing")
        must("xl/_rels/workbook.xml.rels" in names, "workbook relationships missing")
        sst: list[str] = []
        if "xl/sharedStrings.xml" in names:
            sst_root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in sst_root.findall("m:si", ns):
                sst.append("".join(t.text or "" for t in si.findall(".//m:t", ns)))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rel_root = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        relmap = {x.attrib["Id"]: x.attrib["Target"] for x in rel_root}
        sheets: dict[str, dict[int, dict[str, dict[str, str]]]] = {}
        targets: dict[str, str] = {}
        for sheet in wb.find("m:sheets", ns):
            name = sheet.attrib["name"]
            rid = sheet.attrib["{%s}id" % ns["r"]]
            target = relmap[rid]
            if target.startswith("/"):
                target = target[1:]
            elif not target.startswith("xl/"):
                target = "xl/" + target
            root = ET.fromstring(z.read(target))
            rows: dict[int, dict[str, dict[str, str]]] = {}
            for row in root.findall(".//m:sheetData/m:row", ns):
                row_num = int(row.attrib["r"])
                cells: dict[str, dict[str, str]] = {}
                for cell in row.findall("m:c", ns):
                    ref = cell.attrib["r"]
                    col = re.match(r"([A-Z]+)", ref).group(1)
                    cell_type = cell.attrib.get("t", "")
                    stored = cell.findtext("m:v", default="", namespaces=ns)
                    if cell_type == "inlineStr":
                        display = "".join(t.text or "" for t in cell.findall("m:is//m:t", ns))
                    elif cell_type == "s" and stored != "":
                        display = sst[int(stored)]
                    else:
                        display = stored
                    cells[col] = {
                        "cell": ref,
                        "type": cell_type,
                        "stored_value": stored,
                        "display_value": display,
                    }
                rows[row_num] = cells
            sheets[name] = rows
            targets[name] = target
        return {"shared_strings": len(sst), "sheets": sheets, "targets": targets}


def workbook_row_values(workbook: dict[str, object], sheet: str, row_num: int, columns: str = "ABCDEFG") -> dict[str, dict[str, str]]:
    sheets = workbook["sheets"]
    rows = sheets[sheet]
    must(row_num in rows, f"workbook row {sheet}!{row_num} missing")
    return {column: rows[row_num].get(column, {"cell": f"{column}{row_num}", "type": "", "stored_value": "", "display_value": ""}) for column in columns}


def select_rows(rows: list[dict[str, str]], target: int, domain: str, group_key, id_key: str, name_key: str) -> tuple[list[dict[str, object]], dict[str, object]]:
    selected: list[dict[str, object]] = []
    selected_ids: set[str] = set()
    selected_states: set[str] = set()
    selected_groups: set[str] = set()
    rounds: list[dict[str, object]] = []
    for position in range(1, target + 1):
        scored: list[tuple[tuple[object, ...], dict[str, str], dict[str, object]]] = []
        for row in rows:
            row_id = str(row[id_key])
            if row_id in selected_ids:
                continue
            state = str(row["State"] if domain == "hospital" else row["state"])
            group = str(group_key(row))
            tie_parts = [SEED, domain, row_id, state, str(row[name_key])]
            if domain == "hospital":
                tie_parts.append(str(row["Hospital Ownership"]))
            tie_hash = sha_material(tie_parts)
            state_count = sum(1 for prior in selected if prior["_state"] == state)
            group_count = sum(1 for prior in selected if prior["_group"] == group)
            new_state = int(state not in selected_states)
            new_group = int(group not in selected_groups)
            key = (-new_state, -new_group, state_count, group_count, tie_hash, row_id)
            scored.append((key, row, {
                "selection_position": position,
                "new_state": bool(new_state),
                "new_group": bool(new_group),
                "state_count_before": state_count,
                "group_count_before": group_count,
                "tie_hash": tie_hash,
                "sort_key": [str(x) for x in key],
            }))
        must(scored, f"{domain} ran out of eligible rows before target {target}")
        scored.sort(key=lambda item: item[0])
        key, chosen, metadata = scored[0]
        state = str(chosen["State"] if domain == "hospital" else chosen["state"])
        group = str(group_key(chosen))
        chosen_copy: dict[str, object] = dict(chosen)
        chosen_copy["_state"] = state
        chosen_copy["_group"] = group
        chosen_copy["_selection"] = metadata
        selected.append(chosen_copy)
        selected_ids.add(str(chosen[id_key]))
        selected_states.add(state)
        selected_groups.add(group)
        rounds.append({"position": position, "id": str(chosen[id_key]), "state": state, "group": group, "sort_key": [str(x) for x in key]})
    return selected, {"rounds": rounds, "distinct_states": len(selected_states), "distinct_groups": len(selected_groups)}


def public_hospital(row: dict[str, object], source_info: dict[str, object], projection_hash: str, metadata_hash: str) -> dict[str, object]:
    sel = row["_selection"]
    values = {field: row[field] for field in HOSPITAL_FIELDS}
    return {
        "candidate_status": "pending_root_adjudication",
        "identity": {
            "facility_id": row["Facility ID"],
            "facility_name": row["Facility Name"],
            "city_town": row["City/Town"],
            "state": row["State"],
            "hospital_type": row["Hospital Type"],
            "hospital_ownership": row["Hospital Ownership"],
        },
        "selection": sel,
        "source_evidence": {
            "authoritative_url": source_info["url"],
            "raw_source_sha256": source_info["sha256"],
            "raw_source_bytes": source_info["bytes"],
            "projection_artifact": str(FILES["hospital_identities"]),
            "projection_artifact_sha256": projection_hash,
            "metadata_artifact": str(FILES["hospital_metadata"]),
            "metadata_artifact_sha256": metadata_hash,
            "projection_directory_row_index": row["_directory_row_index"],
            "source_csv_row": row["source_csv_row"],
            "source_row_values": values,
            "row_pointer_note": "The retained projection carries this exact source_csv_row pointer; raw CSV bytes are identified by URL/SHA but are not copied into the fixture.",
        },
        "eligibility_and_limits": {
            "directory_identity_only": True,
            "mrfs_or_price_endpoints_checked": False,
            "availability_or_payload_access_proven": False,
            "quality_or_endpoint_performance_used": False,
            "parent_company_or_merger_inference": False,
            "scientific_qualification": False,
            "preserve_if_later_unavailable": True,
        },
    }


def public_payer(row: dict[str, object], raw_cells: dict[str, dict[str, str]], source_info: dict[str, str], projection_hash: str, workbook_hash: str) -> dict[str, object]:
    sel = row["_selection"]
    projection_values = {key: row[key] for key in PAYER_FIELDS}
    raw_values = {column: raw_cells[column] for column in "ABCDEFG"}
    return {
        "candidate_status": "pending_root_adjudication",
        "identity": {
            "hios_issuer_id": row["hios_issuer_id"],
            "issuer_legal_name": row["issuer_legal_name"],
            "state": row["state"],
        },
        "selection": sel,
        "source_evidence": {
            "authoritative_url": source_info["source_url"],
            "workbook_artifact": str(FILES["payer_workbook"]),
            "workbook_sha256": workbook_hash,
            "projection_artifact": str(FILES["payer_identities"]),
            "projection_artifact_sha256": projection_hash,
            "sheet_xml": row["sheet_xml"],
            "cell_range": row["cell_range"],
            "projection_values": projection_values,
            "raw_workbook_wire_values": raw_values,
            "raw_wire_row_note": "Values retain workbook cell refs, cell types, stored shared-string indexes, and resolved display text.",
        },
        "directory_metadata": {
            "required_to_submit_qis_form": row["required_to_submit_qis_form"],
            "qis_is_not_tic_index": True,
            "reporting_entity_or_file_binding_proven": False,
            "scope": source_info["scope"],
            "publisher_last_updated_label": source_info["publisher_last_updated_label"],
        },
        "eligibility_and_limits": {
            "directory_identity_only": True,
            "mrfs_or_price_endpoints_checked": False,
            "tic_reporting_entity_or_file_access_proven": False,
            "parent_company_or_merger_inference": False,
            "scientific_qualification": False,
            "preserve_if_later_unavailable": True,
        },
    }


def main() -> int:
    started = now()
    OUT.mkdir(parents=True, exist_ok=True)
    actual_hashes: dict[str, str] = {}
    for key, path in FILES.items():
        must(path.is_file(), f"input missing: {path}")
        actual_hashes[key] = digest(path)
        must(actual_hashes[key] == EXPECTED_HASHES[key], f"input hash mismatch for {key}: {actual_hashes[key]}")
    must(SPEC_PATH.is_file(), "frozen selection specification is missing; write it before ranking")
    spec_hash = digest(SPEC_PATH)
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    must(spec["format"] == SPEC_VERSION, "selection specification version mismatch")
    must(spec["seed_and_tiebreak"]["seed"] == SEED, "selection seed mismatch")
    must(spec["hospital_selection"]["target_count"] == 25, "hospital target mismatch")
    must(spec["payer_selection"]["target_count"] == 10, "payer target mismatch")

    index = json.loads(FILES["input_index"].read_text(encoding="utf-8"))
    indexed = {item["path"]: item["sha256"] for item in index["files"]}
    for key in ("hospital_identities", "hospital_metadata", "payer_workbook", "payer_identities", "capture_receipts"):
        must(indexed[FILES[key].name] == actual_hashes[key], f"input-index hash mismatch for {FILES[key].name}")

    hospital_obj = json.loads(FILES["hospital_identities"].read_text(encoding="utf-8"))
    hospital_metadata = json.loads(FILES["hospital_metadata"].read_text(encoding="utf-8"))
    payer_obj = json.loads(FILES["payer_identities"].read_text(encoding="utf-8"))
    receipts = json.loads(FILES["capture_receipts"].read_text(encoding="utf-8"))
    must(hospital_obj["format"] == "ushso.hospital-directory-identity-projection.v1", "hospital projection format mismatch")
    must(payer_obj["format"] == "ushso.payer-directory-identity-projection.v1", "payer projection format mismatch")
    must(hospital_obj["source_metadata_sha256"] == actual_hashes["hospital_metadata"], "hospital metadata linkage mismatch")
    must(payer_obj["source_sha256"] == actual_hashes["payer_workbook"], "payer workbook linkage mismatch")
    must(hospital_metadata["accessLevel"] == "public", "hospital metadata is not marked public")
    must(hospital_obj["raw_payload_retained"] is False, "hospital raw payload retention changed")
    must(hospital_obj["source_response"]["status"] == 200, "hospital source capture status changed")
    must(len(receipts["receipts"]) == 2, "unexpected capture receipt count")

    hospital_rows_raw = hospital_obj["directory_rows"]
    hospital_rows: list[dict[str, str]] = []
    hospital_invalid: list[dict[str, object]] = []
    seen_hospital_ids: set[str] = set()
    for index_num, row in enumerate(hospital_rows_raw):
        problems: list[str] = []
        if any(not str(row.get(field, "")).strip() for field in HOSPITAL_FIELDS):
            problems.append("missing_required_field")
        facility_id = str(row.get("Facility ID", ""))
        state = str(row.get("State", ""))
        if not re.fullmatch(r"[A-Za-z0-9]{6}", facility_id):
            problems.append("facility_id_not_six_digits")
        if not re.fullmatch(r"[A-Z]{2}", state):
            problems.append("state_not_two_uppercase_letters")
        if facility_id in seen_hospital_ids:
            problems.append("duplicate_facility_id")
        seen_hospital_ids.add(facility_id)
        if problems:
            hospital_invalid.append({"directory_row_index": index_num, "facility_id": facility_id, "problems": problems})
        else:
            copy = {field: str(row[field]) for field in HOSPITAL_FIELDS}
            copy["source_csv_row"] = str(row["source_csv_row"])
            copy["_directory_row_index"] = index_num
            hospital_rows.append(copy)
    must(not hospital_invalid, f"hospital eligibility failures: {hospital_invalid[:3]}")

    source_info_h = hospital_obj["source_response"]
    selected_hospitals, hospital_summary = select_rows(
        hospital_rows, 25, "hospital", lambda row: row["Hospital Ownership"], "Facility ID", "Facility Name"
    )
    must(len(selected_hospitals) == 25, "hospital selection target mismatch")
    must(len({row["State"] for row in selected_hospitals}) == 25, "hospital state diversity target not met")

    payer_rows_raw = payer_obj["directory_rows"]
    payer_rows: list[dict[str, str]] = []
    payer_invalid: list[dict[str, object]] = []
    seen_payer_ids: set[str] = set()
    for index_num, row in enumerate(payer_rows_raw):
        problems: list[str] = []
        if any(not str(row.get(field, "")).strip() for field in ["hios_issuer_id", "issuer_legal_name", "state"]):
            problems.append("missing_required_field")
        hios = str(row.get("hios_issuer_id", ""))
        state = str(row.get("state", ""))
        if not re.fullmatch(r"[0-9]{5}", hios):
            problems.append("hios_id_not_five_digits")
        if not re.fullmatch(r"[A-Z]{2}", state):
            problems.append("state_not_two_uppercase_letters")
        if hios in seen_payer_ids:
            problems.append("duplicate_hios_id")
        seen_payer_ids.add(hios)
        if problems:
            payer_invalid.append({"directory_row_index": index_num, "hios_issuer_id": hios, "problems": problems})
        else:
            copy = {key: str(value) for key, value in row.items()}
            copy["_directory_row_index"] = index_num
            payer_rows.append(copy)
    must(not payer_invalid, f"payer eligibility failures: {payer_invalid[:3]}")

    workbook = parse_workbook(FILES["payer_workbook"])
    must("2026 QIS Issuer List" in workbook["sheets"], "expected payer worksheet missing")
    payer_sheet = workbook["sheets"]["2026 QIS Issuer List"]
    header = {column: payer_sheet[4][column]["display_value"] for column in "ABCDEFG"}
    expected_header = {
        "A": "HIOS Issuer ID",
        "B": "Issuer Legal Name",
        "C": "State",
        "D": "Required to Submit QIS Form",
        "E": "Required to Submit Implementation Plan Form",
        "F": "Required to Submit Progress Report Form",
        "G": "Number of Progress Report Submissions Required",
    }
    must(header == expected_header, f"payer workbook header mismatch: {header}")
    workbook_by_hios: dict[str, tuple[int, dict[str, dict[str, str]]]] = {}
    workbook_projection_mismatches: list[dict[str, object]] = []
    for row_num in sorted(payer_sheet):
        if row_num < 5:
            continue
        cells = workbook_row_values(workbook, "2026 QIS Issuer List", row_num)
        hios = cells["A"]["display_value"]
        workbook_by_hios[hios] = (row_num, cells)
    for row in payer_rows:
        hios = row["hios_issuer_id"]
        must(hios in workbook_by_hios, f"payer projection HIOS missing from workbook: {hios}")
        row_num, cells = workbook_by_hios[hios]
        expected = [hios, row["issuer_legal_name"], row["state"], row["required_to_submit_qis_form"]]
        actual = [cells[column]["display_value"] for column in "ABCD"]
        if actual != expected:
            workbook_projection_mismatches.append({"hios_issuer_id": hios, "sheet_row": row_num, "expected_projection": expected, "actual_workbook": actual})
    must(not workbook_projection_mismatches, f"payer workbook/projection mismatches: {workbook_projection_mismatches[:3]}")

    selected_payers, payer_summary = select_rows(
        payer_rows, 10, "payer", lambda row: row["issuer_legal_name"].strip().casefold(), "hios_issuer_id", "issuer_legal_name"
    )
    must(len(selected_payers) == 10, "payer selection target mismatch")
    must(len({row["state"] for row in selected_payers}) == 10, "payer state diversity target not met")
    must(len({row["issuer_legal_name"].strip().casefold() for row in selected_payers}) == 10, "payer exact legal-name diversity target not met")

    hospital_public = [public_hospital(row, source_info_h, actual_hashes["hospital_identities"], actual_hashes["hospital_metadata"]) for row in selected_hospitals]
    source_info_p = {
        "source_url": payer_obj["source_url"],
        "scope": payer_obj["scope"],
        "publisher_last_updated_label": payer_obj["publisher_last_updated_label"],
    }
    payer_public: list[dict[str, object]] = []
    for row in selected_payers:
        row_num, cells = workbook_by_hios[row["hios_issuer_id"]]
        row_copy = dict(row)
        row_copy["workbook_sheet_row"] = row_num
        payer_public.append(public_payer(row_copy, cells, source_info_p, actual_hashes["payer_identities"], actual_hashes["payer_workbook"]))

    decision_material = {
        "spec_sha256": spec_hash,
        "seed": SEED,
        "hospital": [{"facility_id": row["Facility ID"], "state": row["State"], "ownership": row["Hospital Ownership"], "tie_hash": row["_selection"]["tie_hash"]} for row in selected_hospitals],
        "payer": [{"hios_issuer_id": row["hios_issuer_id"], "state": row["state"], "issuer_legal_name": row["issuer_legal_name"], "tie_hash": row["_selection"]["tie_hash"]} for row in selected_payers],
    }
    decision_json = json.dumps(decision_material, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    decision_hash = sha256(decision_json).hexdigest()
    script_hash = digest(SCRIPT_PATH)
    algorithm_hash = sha256((spec_hash + "\0" + script_hash + "\0" + SEED).encode("utf-8")).hexdigest()
    finished = now()

    common = {
        "format": "ushso.pr002.c002-3.directory-selection-candidates.v1",
        "selection_status": "pending_root_adjudication",
        "selection_spec": str(SPEC_PATH),
        "selection_spec_sha256": spec_hash,
        "replay_script": str(SCRIPT_PATH),
        "replay_script_sha256": script_hash,
        "selection_algorithm_hash": algorithm_hash,
        "selection_decision_hash": decision_hash,
        "seed": SEED,
        "dependency_context": {"pr001_accepted_merge_sha": "035465f3f16d15f02467679d96451d4440a36ca8"},
        "endpoint_results_seen": False,
        "selection_used_endpoint_results": False,
        "preserve_selected_if_unavailable": True,
        "no_substitutions_after_freeze": True,
        "scientific_qualification": False,
        "source_artifact_sha256": actual_hashes,
        "source_capture": {
            "hospital_raw_source": source_info_h,
            "payer_directory_source_url": payer_obj["source_url"],
            "payer_directory_source_sha256": payer_obj["source_sha256"],
            "payer_source_title": payer_obj["source_title"],
            "payer_publisher_last_updated_label": payer_obj["publisher_last_updated_label"],
            "capture_receipt_artifact": str(FILES["capture_receipts"]),
            "capture_receipt_sha256": actual_hashes["capture_receipts"],
        },
        "counts": {
            "hospital_rows_total": len(hospital_rows_raw),
            "hospital_rows_eligible": len(hospital_rows),
            "hospital_rows_rejected": len(hospital_invalid),
            "hospital_states_available": len({row["State"] for row in hospital_rows}),
            "hospital_ownership_types_available": len({row["Hospital Ownership"] for row in hospital_rows}),
            "hospital_selected": len(hospital_public),
            "hospital_selected_distinct_states": hospital_summary["distinct_states"],
            "hospital_selected_distinct_ownership_types": hospital_summary["distinct_groups"],
            "payer_rows_total": len(payer_rows_raw),
            "payer_rows_eligible": len(payer_rows),
            "payer_rows_rejected": len(payer_invalid),
            "payer_states_available": len({row["state"] for row in payer_rows}),
            "payer_selected": len(payer_public),
            "payer_selected_distinct_states": payer_summary["distinct_states"],
            "payer_selected_distinct_exact_legal_names": payer_summary["distinct_groups"],
            "payer_workbook_rows_cross_checked": len(payer_rows),
            "payer_workbook_projection_mismatches": len(workbook_projection_mismatches),
        },
        "limitations": [
            "Hospital candidates are CMS directory identities and source row pointers only; no MRF, price-file, payload, quality, rating, or performance result was requested or read.",
            "Payer candidates are CMS PY2026 QIS directory identities only; HIOS/QIS membership does not prove a Transparency in Coverage reporting entity, file binding, endpoint access, or schema compatibility.",
            "Exact legal-name comparison is used only for duplicate screening; no parent-company, merger, control, or sameness inference is made.",
            "No endpoint result is used to rank, exclude, or replace a selected candidate. Future unavailable/ineligible observations remain denominator members for root adjudication.",
            "The twelve missing source families and their bounded intake mapping remain downstream scope; this package does not invent family support from directory names.",
        ],
    }
    dump(OUT / "hospital-selection-candidates.json", {**common, "domain": "hospital", "selection_summary": hospital_summary, "selected_candidates": hospital_public})
    dump(OUT / "payer-selection-candidates.json", {**common, "domain": "payer", "selection_summary": payer_summary, "selected_candidates": payer_public})

    hospital_fixtures = []
    for row in selected_hospitals:
        hospital_fixtures.append({
            "fixture_id": f"hospital-{row['Facility ID']}",
            "facility_id": row["Facility ID"],
            "source_url": source_info_h["url"],
            "source_sha256": source_info_h["sha256"],
            "source_csv_row": row["source_csv_row"],
            "projection_directory_row_index": row["_directory_row_index"],
            "raw_projection_values": {field: row[field] for field in HOSPITAL_FIELDS},
            "selection_position": row["_selection"]["selection_position"],
            "tie_hash": row["_selection"]["tie_hash"],
        })
    payer_fixtures = []
    for row in selected_payers:
        row_num, cells = workbook_by_hios[row["hios_issuer_id"]]
        payer_fixtures.append({
            "fixture_id": f"payer-{row['hios_issuer_id']}",
            "hios_issuer_id": row["hios_issuer_id"],
            "source_url": payer_obj["source_url"],
            "source_sha256": actual_hashes["payer_workbook"],
            "projection_artifact_sha256": actual_hashes["payer_identities"],
            "sheet_xml": row["sheet_xml"],
            "cell_range": row["cell_range"],
            "workbook_sheet_row": row_num,
            "raw_workbook_wire_values": {column: cells[column] for column in "ABCDEFG"},
            "projection_values": {key: row[key] for key in PAYER_FIELDS},
            "selection_position": row["_selection"]["selection_position"],
            "tie_hash": row["_selection"]["tie_hash"],
        })
    dump(OUT / "hospital-selected-row-fixtures.json", {
        "format": "ushso.pr002.c002-3.hospital-selected-row-fixtures.v1",
        "selection_status": "pending_root_adjudication",
        "selection_spec_sha256": spec_hash,
        "selection_algorithm_hash": algorithm_hash,
        "source_artifact_sha256": {"hospital_identities": actual_hashes["hospital_identities"], "hospital_metadata": actual_hashes["hospital_metadata"]},
        "row_count": len(hospital_fixtures),
        "fixtures": hospital_fixtures,
    })
    dump(OUT / "payer-selected-row-fixtures.json", {
        "format": "ushso.pr002.c002-3.payer-selected-row-fixtures.v1",
        "selection_status": "pending_root_adjudication",
        "selection_spec_sha256": spec_hash,
        "selection_algorithm_hash": algorithm_hash,
        "source_artifact_sha256": {"payer_identities": actual_hashes["payer_identities"], "payer_workbook": actual_hashes["payer_workbook"]},
        "row_count": len(payer_fixtures),
        "fixtures": payer_fixtures,
        "qis_limitation": "QIS fields are copied as workbook metadata; QIS is not a TiC index or reporting-entity qualification.",
    })
    dump(OUT / "selection-decision-material.json", decision_material)
    replay_results = {
        "format": "ushso.pr002.c002-3.selection-replay-receipt.v1",
        "selection_status": "pending_root_adjudication",
        "started_at": started,
        "finished_at": finished,
        "exit_code": 0,
        "replay_script": str(SCRIPT_PATH),
        "replay_script_sha256": script_hash,
        "selection_spec": str(SPEC_PATH),
        "selection_spec_sha256": spec_hash,
        "selection_algorithm_hash": algorithm_hash,
        "selection_decision_hash": decision_hash,
        "seed": SEED,
        "input_sha256": actual_hashes,
        "checks": {
            "input_hashes_match_expected": True,
            "input_index_links_match": True,
            "hospital_projection_metadata_link_matches": True,
            "hospital_eligibility_rejections": hospital_invalid,
            "payer_eligibility_rejections": payer_invalid,
            "payer_workbook_projection_mismatches": workbook_projection_mismatches,
            "hospital_selection_summary": hospital_summary,
            "payer_selection_summary": payer_summary,
            "endpoint_results_seen": False,
            "selection_before_endpoint_results": True,
            "unavailable_candidates_preserved": True,
            "qis_not_tic_qualification": True,
        },
        "selected_ids": {
            "hospital_facility_ids": [row["Facility ID"] for row in selected_hospitals],
            "payer_hios_issuer_ids": [row["hios_issuer_id"] for row in selected_payers],
        },
        "commands": [
            {"command": "python3 replay-selection.py", "exit": 0, "scope": "local explicit five-input parser and deterministic selector"},
        ],
        "limitations": common["limitations"],
    }
    dump(OUT / "selection-replay-results.json", replay_results)
    print(json.dumps({
        "exit_code": 0,
        "selection_spec_sha256": spec_hash,
        "replay_script_sha256": script_hash,
        "selection_algorithm_hash": algorithm_hash,
        "selection_decision_hash": decision_hash,
        "hospital_selected": len(hospital_public),
        "hospital_distinct_states": hospital_summary["distinct_states"],
        "hospital_distinct_ownership_types": hospital_summary["distinct_groups"],
        "payer_selected": len(payer_public),
        "payer_distinct_states": payer_summary["distinct_states"],
        "payer_distinct_legal_names": payer_summary["distinct_groups"],
        "output_directory": str(OUT),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"selection replay failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
