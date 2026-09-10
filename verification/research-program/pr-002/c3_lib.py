#!/usr/bin/env python3
"""C-002-3 sealed MRF pilots and twelve missing-family intake pointers."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

HERE = Path(__file__).resolve().parent
C3_DIR = HERE / "c3-pilot-selection"
CANDIDATES_DIR = C3_DIR / "candidates"
CONTROLLER_DIR = C3_DIR / "controller"
CAPTURED_DIR = C3_DIR / "captured-inputs"

C1_LIB_SHA256 = "aa08124fd563fde08d0a0136c526b0c359f0d6233f58da62457ee5557f09910d"
C2_LIB_SHA256 = "21aec356bf8c4c000f8132ba6c0b9a5a4416090080835bf59b50ac20d682c6d0"
REPLAY_SCRIPT_SHA256 = "749c64af38229e476aef9af3d1b8f303196d4783cd445214b4646dcc3b28c5d3"
SEAL_SHA256 = "f74892bbb9bb38619e985cb20e2dd9c6478eba0d7b0bcb02af234f70a1a03060"
REVIEW_SHA256 = "fcdcf9b2d7437f7c2f8d2845d778311497f78de08298930a15ab645427979354"
HOSPITAL_PROJECTION_SHA256 = "3cf22001c0d1d831174f6aabe678c2adf508d8cc41911a13c220ed276c619fdd"
HOSPITAL_CSV_SHA256 = "f874f09fef895a1ccf5bb7392dcbb2be05c9860339261b093fe00f0c1b013480"
PAYER_XLSX_SHA256 = "09a5d4a33b5825feb3f4943e3cb6ebd9577b8665dd6def15ac01e12b273b5f0b"

C2_CORRECTION_COMMIT = "997070bd94864fabedf73acecd422c6e15a3ed7e"
C2_CORRECTION_TREE = "c05b9a74630b715b05304044a24d6e66489a9808"
C2_CORRECTION_TASKS_SHA256 = "c14c2118dfddab80fd5047dc1912a622721f89a6212d73d2498700fa01305a74"
C2_CORRECTION_ACCEPTANCE_SHA256 = "630c94f9b708271c20b14049413dd116328c1349759fcf604fc1e1336fcd4117"

HOSPITAL_CANDIDATE_IDS = (
    "103301",
    "050373",
    "281327",
    "090003",
    "26009F",
    "190099",
    "360239",
    "450200",
    "373300",
    "020026",
    "34011F",
    "031320",
    "310092",
    "250050",
    "180128",
    "330107",
    "21010F",
    "171356",
    "381323",
    "134010",
    "241358",
    "040147",
    "12001F",
    "400139",
    "150059",
)
PAYER_CANDIDATE_IDS = (
    "67190",
    "45845",
    "32225",
    "40702",
    "32753",
    "15560",
    "11269",
    "37833",
    "59025",
    "86382",
)

CANDIDATE_ARTIFACTS = (
    ("selection-spec.v1.json", "6d23fe941003ee2dafa6d5843b344d551c5f26ec55c7e5c1980b1f20d43df2ff", 9227),
    ("selection-spec.v1.1.json", "b6ca85ddb8e04418779b7427bec3c19e756847cf3270882f459141f5c61f5fcd", 10060),
    ("replay-selection.py", REPLAY_SCRIPT_SHA256, 30943),
    ("hospital-selection-candidates.json", "64793032455531423dd75eaf74c66145763d0a72de5643cad7a44da6484ecefd", 77326),
    ("payer-selection-candidates.json", "fd1d3650934bfe90afb068d5f361d94b1164016808cd726b6c5ead6aa24963be", 43795),
    ("hospital-selected-row-fixtures.json", "221a693ddc58f8c43c7d07f2111e1431c752f3e538546bed0c6bc27e097d1637", 21349),
    ("payer-selected-row-fixtures.json", "1f81805293cfb625c39708b41d8a97610f1f800cecd9ffd5f452138468c559a1", 19206),
    ("selection-decision-material.json", "a3167a2e3b45e1581f96eea1896c51e2026cae4d099ecd6948d9c98464ec6d4f", 7263),
    ("selection-replay-results.json", "dacdfe751acb2b014f814268df5b0e1306d21f20ef4749effea63c4c81128e40", 16270),
    ("artifact-manifest.json", "5e12c99b2ea4c9f7f598c356202f4989cfc2665a19ccae666297cbb57b9ebf36", 4210),
    ("accidental-preview-disclosure.json", "a7dc9ff0b9d0b5ec1862fedcd270caa99eadbf4870949f157bd86b94ffc82b1b", 9632),
)
CONTROLLER_ARTIFACTS = (
    ("pilot-selection-input-seal-v1.json", SEAL_SHA256, 6889),
    ("review.json", REVIEW_SHA256, 46478),
)
CAPTURED_ARTIFACTS = (
    ("input-index.json", "defd18e1fd72671b6c842845eeb2b6ef102526befd9c26cf251fa117dfc39587", 1873),
    ("hospital-directory-metadata.json", "31eea397b8bfe8207168cefda23256eb9cb3d5e49158d221eda8465a2d8e5f8c", 1215),
    ("payer-directory-identities.json", "7ecd1fe538ba0d49d04d6b418541ff1824f4aba5dc3f6aa78242e63e028df26c", 39763),
    ("payer-issuer-directory.xlsx", PAYER_XLSX_SHA256, 31900),
    ("receipts-20260910T155046Z.json", "09d4ac6b29f6d8c041053bbb956d46a34c2cfef6c78157c53b2712b1aa88e9c1", 1690),
)

R09_FRAME_STATE = "pointers_frozen_intake_not_materialized"
R10_FRAME_STATE = "ids_frozen_locators_not_materialized"

FAMILY_SPECS = (
    {
        "family_identity": "HRSA Area Health Resources Files",
        "product_key": "hrsa-area-health-resources-files",
        "intake_pr": "PR-043",
        "intake_commits": ["C-043-1", "C-043-2", "C-043-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "AHRF release/year binding remains unresolved until PR-043 capture.",
        ],
    },
    {
        "family_identity": "NPPES",
        "product_key": "nppes-npi-registry",
        "intake_pr": "PR-043",
        "intake_commits": ["C-043-1", "C-043-2", "C-043-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "NPI is not CCN; CCN=NPI joins remain forbidden.",
        ],
    },
    {
        "family_identity": "SAMHSA facility services data",
        "product_key": "samhsa-facility-services",
        "intake_pr": "PR-043",
        "intake_commits": ["C-043-1", "C-043-2", "C-043-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "CDC Synar youth-tobacco tables do not satisfy this family.",
        ],
    },
    {
        "family_identity": "CMS T-MSIS/TAF",
        "product_key": "cms-tmsis-taf",
        "intake_pr": "PR-043",
        "intake_commits": ["C-043-1", "C-043-2", "C-043-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "Restricted TAF research files are not public Medicaid summary products.",
        ],
    },
    {
        "family_identity": "CDC/ATSDR Social Vulnerability Index",
        "product_key": "cdc-atsdr-social-vulnerability-index",
        "intake_pr": "PR-043",
        "intake_commits": ["C-043-1", "C-043-2", "C-043-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "HHS ASPE SVI catalog record ypqf-r5qs does not satisfy this exact family.",
        ],
    },
    {
        "family_identity": "PHC4 hospital financial/utilization reports",
        "product_key": "phc4-hospital-financial-utilization-reports",
        "intake_pr": "PR-044",
        "intake_commits": ["C-044-1", "C-044-2", "C-044-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "PHC4 reporting scope is not interchangeable with HCRIS.",
        ],
    },
    {
        "family_identity": "state APCD programs",
        "product_key": "state-apcd-programs",
        "intake_pr": "PR-044",
        "intake_commits": ["C-044-1", "C-044-2", "C-044-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "Secondary APCD directories are navigation only and are not the APCD source family.",
            "No jurisdiction is selected here; one state never implies national completeness.",
        ],
    },
    {
        "family_identity": "state facility licensure",
        "product_key": "state-facility-licensure",
        "intake_pr": "PR-044",
        "intake_commits": ["C-044-1", "C-044-2", "C-044-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "State licensure requires a state authority; federal certification is not state license evidence.",
            "No jurisdiction is selected here; one state never implies national completeness.",
        ],
    },
    {
        "family_identity": "rural hospital closure tracking",
        "product_key": "rural-hospital-closure-tracking",
        "intake_pr": "PR-044",
        "intake_commits": ["C-044-1", "C-044-2", "C-044-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "Nongovernmental operator and methodology identity stay with the Sheps Center product.",
        ],
    },
    {
        "family_identity": "AHRQ HCUP",
        "product_key": "ahrq-hcup",
        "intake_pr": "PR-045",
        "intake_commits": ["C-045-1", "C-045-2", "C-045-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "Restricted/central-distributor HCUP products cannot be replaced by CMS inpatient PUFs.",
        ],
    },
    {
        "family_identity": "AHRQ MEPS",
        "product_key": "ahrq-meps",
        "intake_pr": "PR-045",
        "intake_commits": ["C-045-1", "C-045-2", "C-045-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "Public MEPS files are not labeled restricted solely because another MEPS product is restricted.",
        ],
    },
    {
        "family_identity": "AHA Annual Survey",
        "product_key": "aha-annual-survey",
        "intake_pr": "PR-045",
        "intake_commits": ["C-045-1", "C-045-2", "C-045-3"],
        "retained_unknowns": [
            "Candidate locator is unverified; publisher access and schema qualification are not claimed.",
            "AHA terms, fees, and eligibility remain unknown until PR-045 documents them.",
        ],
    },
)

UNRESOLVED_HOSPITAL_BINDINGS = {
    "locator": "unresolved",
    "eligibility": "unresolved",
    "mrf_rule_applicability": "unresolved",
    "payload_availability": "unresolved",
    "successful_parsing": "unresolved",
    "file_binding": "unresolved",
    "consumer_pr": "PR-046",
}
UNRESOLVED_PAYER_BINDINGS = {
    "locator": "unresolved",
    "eligibility": "unresolved",
    "mrf_rule_applicability": "unresolved",
    "payload_availability": "unresolved",
    "successful_parsing": "unresolved",
    "file_binding": "unresolved",
    "tic_reporting_entity_identity": "unresolved",
    "consumer_pr": "PR-049",
}

HOSPITAL_CSV_NOT_RETAINED = (
    "Hospital original CSV bytes were not retained. Independent exact source-row "
    "re-resolution is limited to the retained identity projection plus original "
    "capture hash/URL. This freeze does not re-fetch the raw CSV."
)
HOSPITAL_PROJECTION_NOT_COMMITTED = (
    "The whole hospital identity projection is hash-checked as a captured source "
    "input and is not committed."
)

HISTORICAL_RECEIPT_NAMES = (
    "c1-build-receipt.json",
    "c1-verify-receipt.json",
    "c2-build-receipt.json",
    "c2-verify-receipt.json",
    "c2-correction-build-receipt.json",
    "c2-correction-verify-receipt.json",
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def _require_hash(path: Path, expected: str, size: int | None = None) -> str:
    if not path.is_file():
        raise SystemExit(f"missing evidence {path}")
    actual = digest(path)
    if actual != expected:
        raise SystemExit(f"hash mismatch {path}: {actual} != {expected}")
    if size is not None and path.stat().st_size != size:
        raise SystemExit(f"size mismatch {path}: {path.stat().st_size} != {size}")
    return actual


def hash_check_historical_code() -> None:
    _require_hash(HERE / "c1_lib.py", C1_LIB_SHA256)
    _require_hash(HERE / "c2_lib.py", C2_LIB_SHA256)
    _require_hash(CANDIDATES_DIR / "replay-selection.py", REPLAY_SCRIPT_SHA256, 30943)


hash_check_historical_code()
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
import c2_lib  # noqa: E402


def verify_copied_evidence() -> list[str]:
    errors = []
    for name, expected, size in CANDIDATE_ARTIFACTS:
        path = CANDIDATES_DIR / name
        try:
            _require_hash(path, expected, size)
        except SystemExit as error:
            errors.append(str(error))
    for name, expected, size in CONTROLLER_ARTIFACTS:
        path = CONTROLLER_DIR / name
        try:
            _require_hash(path, expected, size)
        except SystemExit as error:
            errors.append(str(error))
    for name, expected, size in CAPTURED_ARTIFACTS:
        path = CAPTURED_DIR / name
        try:
            _require_hash(path, expected, size)
        except SystemExit as error:
            errors.append(str(error))
    projection = Path("/mnt/d/tmp/plumbob/ushso-research-program-20260910/cohort-inputs/hospital-directory-identities.json")
    committed = HERE / "c3-pilot-selection/captured-inputs/hospital-directory-identities.json"
    if committed.exists():
        errors.append("hospital identity projection must not be committed")
    if projection.is_file():
        actual = digest(projection)
        if actual != HOSPITAL_PROJECTION_SHA256:
            errors.append(f"hospital projection hash mismatch {actual}")
    return errors


def load_seal() -> dict:
    path = CONTROLLER_DIR / "pilot-selection-input-seal-v1.json"
    _require_hash(path, SEAL_SHA256, 6889)
    return load_json(path)


def load_hospital_fixtures() -> dict:
    path = CANDIDATES_DIR / "hospital-selected-row-fixtures.json"
    _require_hash(path, "221a693ddc58f8c43c7d07f2111e1431c752f3e538546bed0c6bc27e097d1637", 21349)
    return load_json(path)


def load_payer_fixtures() -> dict:
    path = CANDIDATES_DIR / "payer-selected-row-fixtures.json"
    _require_hash(path, "1f81805293cfb625c39708b41d8a97610f1f800cecd9ffd5f452138468c559a1", 19206)
    return load_json(path)


def xlsx_display_values(path: Path) -> dict[str, str]:
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with ZipFile(path) as zipped:
        root = ET.fromstring(zipped.read("xl/sharedStrings.xml"))
        shared = []
        for item in root.findall("m:si", ns):
            shared.append("".join(node.text or "" for node in item.iter() if node.text))
        sheet = ET.fromstring(zipped.read("xl/worksheets/sheet2.xml"))
        values = {}
        for cell in sheet.findall(".//m:c", ns):
            ref = cell.attrib.get("r")
            value_node = cell.find("m:v", ns)
            if ref is None or value_node is None or value_node.text is None:
                continue
            stored = value_node.text
            if cell.attrib.get("t") == "s":
                values[ref] = shared[int(stored)]
            else:
                values[ref] = stored
        return values


def verify_payer_cells(fixtures: dict | None = None) -> list[str]:
    fixtures = fixtures or load_payer_fixtures()
    path = CAPTURED_DIR / "payer-issuer-directory.xlsx"
    _require_hash(path, PAYER_XLSX_SHA256, 31900)
    cells = xlsx_display_values(path)
    errors = []
    for item in fixtures["fixtures"]:
        issuer = item["hios_issuer_id"]
        row = item["workbook_sheet_row"]
        expected = item["projection_values"]
        actual_id = cells.get(f"A{row}")
        actual_name = cells.get(f"B{row}")
        actual_state = cells.get(f"C{row}")
        if actual_id != expected["hios_issuer_id"]:
            errors.append(f"payer {issuer} cell A{row} {actual_id!r} != {expected['hios_issuer_id']!r}")
        if actual_name != expected["issuer_legal_name"]:
            errors.append(f"payer {issuer} cell B{row} {actual_name!r} != {expected['issuer_legal_name']!r}")
        if actual_state != expected["state"]:
            errors.append(f"payer {issuer} cell C{row} {actual_state!r} != {expected['state']!r}")
    return errors


def portable_index() -> dict:
    artifacts = []
    originals = {
        "candidates": "/mnt/d/tmp/plumbob/ushso-research-program-20260910/pr002-pilot-selection-preparation",
        "controller": "/mnt/d/tmp/plumbob/ushso-research-program-20260910/pr002-pilot-controller-review",
        "captured-inputs": "/mnt/d/tmp/plumbob/ushso-research-program-20260910/cohort-inputs",
    }
    groups = (
        ("candidates", CANDIDATE_ARTIFACTS, CANDIDATES_DIR),
        ("controller", CONTROLLER_ARTIFACTS, CONTROLLER_DIR),
        ("captured-inputs", CAPTURED_ARTIFACTS, CAPTURED_DIR),
    )
    for group, rows, directory in groups:
        for name, expected, size in rows:
            artifacts.append({
                "name": name,
                "relative_path": f"verification/research-program/pr-002/c3-pilot-selection/{group}/{name}",
                "original_path": f"{originals[group]}/{name}",
                "sha256": expected,
                "bytes": size,
                "copied_bytes_preserve_historical_paths_and_pending_root_status": True,
            })
    return {
        "format": "ushso.pr002.c3-pilot-selection.portable-index.v1",
        "freeze_id": "ushso-mrf-directory-pilots-20260910-v1",
        "historical_candidate_status_preserved_in_copied_bytes": "pending_root_adjudication",
        "root_seal_status_disposition": "sealed_selection_inputs",
        "root_review_checks": 523,
        "selection_consumed_not_recomputed": True,
        "hospital_raw_csv_retained": False,
        "hospital_identity_projection_committed": False,
        "hospital_identity_projection_sha256": HOSPITAL_PROJECTION_SHA256,
        "hospital_identity_projection_note": HOSPITAL_PROJECTION_NOT_COMMITTED,
        "payer_workbook_retained": True,
        "payer_cells_resolvable_against_retained_xlsx": True,
        "historical_replay_script": {
            "relative_path": "verification/research-program/pr-002/c3-pilot-selection/candidates/replay-selection.py",
            "sha256": REPLAY_SCRIPT_SHA256,
            "uses_original_absolute_capture_paths": True,
            "not_re-executed_by_c3": True,
        },
        "portable_wrapper": {
            "relative_path": "verification/research-program/pr-002/c3-pilot-selection/replay_portable.py",
            "uses_explicit_verified_inputs": True,
            "does_not_claim_historical_script_hash": True,
        },
        "artifacts": artifacts,
    }


def hospital_records(fixtures: dict | None = None) -> list[dict]:
    fixtures = fixtures or load_hospital_fixtures()
    records = []
    for item in fixtures["fixtures"]:
        values = item["raw_projection_values"]
        facility_id = item["facility_id"]
        records.append({
            "candidate_id": facility_id,
            "native_identity": {
                "kind": "cms_hospital_facility_id",
                "value": facility_id,
                "ascii_letters_permitted": True,
            },
            "selection_position": item["selection_position"],
            "facility_name": values["Facility Name"],
            "city": values["City/Town"],
            "jurisdiction": values["State"],
            "hospital_type": values["Hospital Type"],
            "ownership": values["Hospital Ownership"],
            "selected_row": {
                "source_csv_row": item["source_csv_row"],
                "projection_directory_row_index": item["projection_directory_row_index"],
                "raw_projection_values": values,
            },
            "source_url": item["source_url"],
            "source_hash": {
                "kind": "original_hospital_csv_sha256",
                "sha256": item["source_sha256"],
                "bytes_retained": False,
            },
            "projection_resolution": {
                "kind": "retained_identity_projection",
                "projection_sha256": HOSPITAL_PROJECTION_SHA256,
                "committed": False,
                "not_a_raw_source_refetch": True,
            },
            "tie_hash": item["tie_hash"],
            "selection_rationale": (
                "Sealed directory-only diversity sampling: first new jurisdiction, then new "
                "ownership type, then lower current frequencies, then seeded tie hash and Facility ID. "
                "This is a sampling spread, not a population estimate or MRF-rule determination."
            ),
            "directory_identity_is_selected_candidate_evidence_only": True,
            "unresolved_downstream_bindings": dict(UNRESOLVED_HOSPITAL_BINDINGS),
            "remain_in_later_denominators_if_unavailable_ineligible_restricted_or_file_sharing": True,
        })
    return records


def payer_records(fixtures: dict | None = None) -> list[dict]:
    fixtures = fixtures or load_payer_fixtures()
    records = []
    for item in fixtures["fixtures"]:
        values = item["projection_values"]
        issuer = item["hios_issuer_id"]
        records.append({
            "candidate_id": issuer,
            "native_identity": {
                "kind": "hios_issuer_id",
                "value": issuer,
            },
            "selection_position": item["selection_position"],
            "issuer_legal_name": values["issuer_legal_name"],
            "jurisdiction": values["state"],
            "selected_cell": {
                "sheet_xml": item["sheet_xml"],
                "cell_range": item["cell_range"],
                "workbook_sheet_row": item["workbook_sheet_row"],
                "raw_workbook_wire_values": item["raw_workbook_wire_values"],
                "projection_values": values,
            },
            "source_url": item["source_url"],
            "source_hash": {
                "kind": "retained_payer_xlsx_sha256",
                "sha256": item["source_sha256"],
                "bytes_retained": True,
            },
            "projection_artifact_sha256": item["projection_artifact_sha256"],
            "tie_hash": item["tie_hash"],
            "selection_rationale": (
                "Sealed directory-only diversity sampling across ten states and ten exact issuer "
                "legal names from the PY2026 Final QIS Issuer List. QIS membership is not TiC "
                "reporting-entity or file-binding evidence."
            ),
            "directory_identity_is_selected_candidate_evidence_only": True,
            "qis_is_not_tic_qualification": True,
            "unresolved_downstream_bindings": dict(UNRESOLVED_PAYER_BINDINGS),
            "remain_in_later_denominators_if_unavailable_ineligible_restricted_or_file_sharing": True,
        })
    return records


def build_mrf_selection() -> dict:
    seal = load_seal()
    hospital_fixtures = load_hospital_fixtures()
    payer_fixtures = load_payer_fixtures()
    hospitals = hospital_records(hospital_fixtures)
    payers = payer_records(payer_fixtures)
    hospital_ids = [item["candidate_id"] for item in hospitals]
    payer_ids = [item["candidate_id"] for item in payers]
    ownerships = sorted({item["ownership"] for item in hospitals})
    hospital_states = [item["jurisdiction"] for item in hospitals]
    payer_states = [item["jurisdiction"] for item in payers]
    payer_names = [item["issuer_legal_name"] for item in payers]
    return {
        "status": R10_FRAME_STATE,
        "selection_owner": "C-002-3",
        "freeze_before_endpoint_results": True,
        "selection_consumed_not_recomputed": True,
        "hospital_candidate_count": 25,
        "payer_reporting_entity_candidate_count": 10,
        "hospital_candidate_ids": hospital_ids,
        "payer_reporting_entity_candidate_ids": payer_ids,
        "parsed_sample_targets": {"hospital": 20, "payer": 8},
        "replacement_allowed": False,
        "silent_deduplication_allowed": False,
        "silent_substitution_allowed": False,
        "denominator_may_not_shrink": True,
        "seal": {
            "path": "verification/research-program/pr-002/c3-pilot-selection/controller/pilot-selection-input-seal-v1.json",
            "sha256": SEAL_SHA256,
            "freeze_id": seal["freeze_id"],
            "copied_bytes_status": seal["status"],
            "historical_pending_root_status_preserved_in_candidate_bytes": seal["producer_status_superseded_only_for_selection_acceptance"],
            "root_status_disposition": "sealed_selection_inputs",
            "independent_review_path": "verification/research-program/pr-002/c3-pilot-selection/controller/review.json",
            "independent_review_sha256": REVIEW_SHA256,
            "independent_review_checks": 523,
        },
        "consumer_contract": {
            "hospital": {
                "pr": "PR-046",
                "action": "Consume the frozen hospital IDs, resolve locators and record dispositions.",
                "replacement_allowed": False,
                "typed_unresolved_bindings": list(UNRESOLVED_HOSPITAL_BINDINGS),
            },
            "payer": {
                "pr": "PR-049",
                "action": "Consume the frozen payer reporting-entity IDs, resolve locators and record dispositions.",
                "replacement_allowed": False,
                "typed_unresolved_bindings": list(UNRESOLVED_PAYER_BINDINGS),
            },
        },
        "directory_identity_does_not_prove": [
            "MRF rule applicability",
            "payload availability",
            "successful parsing",
            "TiC reporting-entity identity",
            "file binding",
        ],
        "source_retention": {
            "hospital_raw_csv_retained": False,
            "hospital_raw_csv_sha256": HOSPITAL_CSV_SHA256,
            "hospital_projection_committed": False,
            "hospital_projection_sha256": HOSPITAL_PROJECTION_SHA256,
            "hospital_note": HOSPITAL_CSV_NOT_RETAINED,
            "payer_xlsx_retained": True,
            "payer_xlsx_sha256": PAYER_XLSX_SHA256,
            "payer_cells_verified_against_retained_xlsx": True,
        },
        "diversity_properties": {
            "hospital_jurisdictions": hospital_states,
            "hospital_jurisdiction_count": len(set(hospital_states)),
            "ownership_types_present": ownerships,
            "ownership_type_count": len(ownerships),
            "payer_states": payer_states,
            "payer_state_count": len(set(payer_states)),
            "issuer_legal_names": payer_names,
            "issuer_legal_name_count": len(set(payer_names)),
            "not_population_estimates": True,
        },
        "hospitals": hospitals,
        "payers": payers,
        "endpoint_results_seen": False,
    }


def build_expansion_families(products: list[dict]) -> dict:
    by_key = {item["product_key"]: item for item in products}
    families = []
    for spec in FAMILY_SPECS:
        product = by_key[spec["product_key"]]
        intake = (product.get("anchor") or {}).get("intake") or {}
        families.append({
            "family_identity": spec["family_identity"],
            "product_key": spec["product_key"],
            "c1_title": product["title"],
            "publisher": product["publisher"],
            "candidate_official_locator": intake.get("locator") or product["resolve"]["locator"],
            "locator_kind": intake.get("locator_kind") or product["resolve"]["locator_kind"],
            "locator_status": "unverified_locator",
            "source_identity_expectation": product["access_expectation"],
            "intake_pr": spec["intake_pr"],
            "intake_commits": list(spec["intake_commits"]),
            "c1_named_intake_task": product["resolve"]["intake_task"],
            "retained_unknowns": list(spec["retained_unknowns"]),
            "publisher_access_claimed": False,
            "schema_qualification_claimed": False,
            "similar_baseline_title_is_not_this_family": True,
        })
    return {
        "status": R09_FRAME_STATE,
        "selection_owner": "C-002-3",
        "family_count": 12,
        "family_identities": [item["family_identity"] for item in families],
        "families": families,
        "notes": [
            "Twelve family identities are frozen without substituting a similar baseline title.",
            "State licensure requires a state authority; federal certification is not state license evidence.",
            "Secondary APCD directories are navigation only.",
            "Candidate locators were not tested in C-002-3 and remain unverified.",
            "Restricted payload retrieval is not implied.",
        ],
    }


def build_cohorts_payload(repo: Path) -> dict:
    evidence_errors = verify_copied_evidence()
    if evidence_errors:
        raise SystemExit("; ".join(evidence_errors))
    cell_errors = verify_payer_cells()
    if cell_errors:
        raise SystemExit("; ".join(cell_errors))
    cohorts_path = repo / "evaluation/research-program/cohorts.json"
    payload = load_json(cohorts_path)
    c1_before = c2_lib.extract_c1_projection(payload)
    historical = c2_lib.C1_COHORTS_SHA256
    current = digest(cohorts_path)
    if current != historical and payload.get("commit_id") not in {"C-002-1", "C-002-3"}:
        raise SystemExit("refusing to overlay an unexpected cohorts artifact")
    if payload.get("commit_id") == "C-002-3":
        # Rebuild overlays on the already-preserved C1 projection.
        pass
    payload["commit_id"] = "C-002-3"
    payload["status"] = "c3_pilot_and_expansion_identities_frozen"
    payload["pending"] = []
    payload["claim_boundary"] = (
        "C-002-3 freezes the sealed 25 hospital and 10 payer directory candidate IDs "
        "and the twelve named missing-family intake pointers. Directory identity is "
        "selected-candidate evidence only. Locators, eligibility, payload, parse, "
        "TiC reporting-entity identity, and file binding remain unresolved. R01-R16 "
        "remain unaccepted. C1 product/baseline projection is preserved."
    )
    payload["mrf_selection"] = build_mrf_selection()
    payload["expansion_families"] = build_expansion_families(payload["products"])
    payload["acceptance"] = {req: "unaccepted" for req in c2_lib.REQUIREMENT_IDS}
    payload["c3_freeze"] = {
        "commit_id": "C-002-3",
        "c1_historical_cohorts_sha256": c2_lib.C1_COHORTS_SHA256,
        "c2_correction_commit": C2_CORRECTION_COMMIT,
        "c2_correction_tree": C2_CORRECTION_TREE,
        "pilot_seal_sha256": SEAL_SHA256,
        "endpoint_results_seen": False,
        "selection_consumed_not_recomputed": True,
    }
    if c2_lib.extract_c1_projection(payload) != c1_before:
        raise SystemExit("C3 overlay mutated the C1 projection")
    return payload


def requirement_rows() -> list[dict]:
    rows = []
    for row in c2_lib.requirement_rows():
        item = json.loads(json.dumps(row))
        if item["id"] == "R09":
            item["frame"] = (
                "C-002-3 published the twelve family pointers, candidate locators, and intake PRs. "
                "Actual source identities remain unverified locators until PR-043/044/045."
            )
            item["frame_state"] = R09_FRAME_STATE
        elif item["id"] == "R10":
            item["frame"] = (
                "C-002-3 froze the exact 25 hospital and 10 payer candidate IDs/order/counts from "
                "the sealed directory selection. Locators, eligibility, file binding, and parsed "
                "samples remain unresolved downstream bindings."
            )
            item["frame_state"] = R10_FRAME_STATE
        rows.append(item)
    return rows


def build_tasks_payload(repo: Path, here: Path = HERE) -> dict:
    payload = c2_lib.build_tasks_payload(repo, here)
    payload["commit_id"] = "C-002-3"
    payload["status"] = "public_opaque_task_index_frozen_c3_identities_bound"
    payload["claim_boundary"] = (
        "C-002-3 binds current cohort hashes and freezes R09/R10 identity frames on the "
        "C-002-2 public opaque 40-task index. It does not publish raw holdout prompts or "
        "labels, does not accept R01-R16, and does not materialize the R14 residual sample."
    )
    payload["c1_identities"]["rewritten_by_this_commit"] = False
    payload["c2_identities"] = {
        "producer_commit": c2_lib.C2_BASE_COMMIT,
        "producer_tree": c2_lib.C2_BASE_TREE,
        "correction_commit": C2_CORRECTION_COMMIT,
        "correction_tree": C2_CORRECTION_TREE,
        "tasks_sha256": C2_CORRECTION_TASKS_SHA256,
        "acceptance_sha256": C2_CORRECTION_ACCEPTANCE_SHA256,
        "rewritten_by_this_commit": False,
    }
    cohorts = load_json(repo / "evaluation/research-program/cohorts.json")
    payload["c3_identities"] = {
        "commit_id": "C-002-3",
        "pilot_seal_sha256": SEAL_SHA256,
        "hospital_candidate_ids": list(cohorts["mrf_selection"]["hospital_candidate_ids"]),
        "payer_reporting_entity_candidate_ids": list(
            cohorts["mrf_selection"]["payer_reporting_entity_candidate_ids"]
        ),
        "expansion_family_identities": list(cohorts["expansion_families"]["family_identities"]),
        "r09_frame_state": R09_FRAME_STATE,
        "r10_frame_state": R10_FRAME_STATE,
        "c1_projection_preserved": True,
    }
    return payload


def render_acceptance_markdown(tasks_sha256: str | None, cohorts_sha256: str) -> str:
    rows = requirement_rows()
    lines = [
        "# Research-program acceptance contracts",
        "",
        "Status: **unaccepted** for every requirement R01–R16.",
        "",
        "This document is the C-002-3 identity overlay on the C-002-2 measurable-row freeze. It updates current cohort/task hashes and the R09/R10 frozen-identity frame status. It does not accept any requirement, materialize remaining conditional frames, or publish private holdout labels.",
        "",
        "## Identities",
        "",
        f"- C-002-1 producer: `{c2_lib.C1_PRODUCER}`",
        f"- C-002-1 correction: `{c2_lib.C1_CORRECTION}`",
        f"- C-002-2 producer: `{c2_lib.C2_BASE_COMMIT}`",
        f"- C-002-2 correction: `{C2_CORRECTION_COMMIT}`",
        f"- C-002-2 correction tree: `{C2_CORRECTION_TREE}`",
        f"- Cohorts path: `evaluation/research-program/cohorts.json`",
        f"- Cohorts SHA-256 at this document's C3 write: `{cohorts_sha256}`",
        f"- C1 historical cohorts SHA-256: `{c2_lib.C1_COHORTS_SHA256}`",
        f"- C2 correction tasks SHA-256: `{C2_CORRECTION_TASKS_SHA256}`",
        f"- C2 correction acceptance SHA-256: `{C2_CORRECTION_ACCEPTANCE_SHA256}`",
        f"- Tasks path: `evaluation/research-program/tasks.json`",
        f"- Tasks SHA-256: `{tasks_sha256 or 'written after tasks.json'}`",
        f"- Sealed evaluator manifest SHA-256: `{c2_lib.SEALED_MANIFEST_SHA256}`",
        f"- R14 protocol SHA-256: `{c2_lib.R14_PROTOCOL_SHA256}`",
        f"- Pilot selection seal SHA-256: `{SEAL_SHA256}`",
        f"- Generation: `{c2_lib.EXPECTED_GENERATION}`",
        f"- Catalog manifest SHA-256: `{c2_lib.EXPECTED_MANIFEST}`",
        "",
        "Hash scheme: SHA-256 of exact committed file bytes. `cohorts.json` and `tasks.json` do not contain their own digests. This document and the C3 receipt are destinations for those digests. Historical C1/C2 receipts keep their original hashes.",
        "",
        "## Frame rule",
        "",
        "A protocol, pointer, or unaccepted row is not a frozen or materialized measurement frame. Conditional frames stay unmaterialized until the named downstream PR writes identities, then independently freezes them before tuning or measurement. C-002-3 freezes only the R09 family pointers and R10 25/10 candidate IDs.",
        "",
        "## R01–R16",
        "",
    ]
    for row in rows:
        lines.extend([
            f"### {row['id']} — {row['required_outcome']}",
            "",
            f"- **Master-plan threshold:** {row['master_plan_threshold']}",
            f"- **Denominator:** {row['denominator']}",
            f"- **Numerator / pass predicate:** {row['numerator_or_pass_predicate']}",
            f"- **Frozen identities or conditional frame:** {row['frame']}",
            f"- **Frame state:** `{row['frame_state']}`",
            f"- **Source / generation identity:** `{json.dumps(row['source_generation_identity'], sort_keys=True)}`",
            f"- **Evidence owner:** {row['evidence_owner']}",
            f"- **Evidence destination:** {row['evidence_destination']}",
            f"- **Materialize / freeze before tuning or measurement:** {row['materialize_before_tuning']}",
            f"- **Status:** `{row['status']}`",
            "",
        ])
    lines.extend([
        "## Public negative-case types",
        "",
        "These types are documented from the PR packet and audit without exposing private tasks:",
        "",
        "- HCRIS versus PHC4 reporting scope",
        "- Maternal versus infant mortality substitution",
        "- ACS geography grain/year confusion",
        "- Nursing staffing source/grain confusion",
        "- Price definitions: charge, negotiated rate, expected bill, utilization-weighted payment",
        "- Forbidden joins: CCN=NPI and name-only equality",
        "",
        "Holdout labels remain inaccessible to implementer tuning.",
        "",
    ])
    return "\n".join(lines)


def assert_pilot_identities(payload: dict) -> list[str]:
    errors = []
    selection = payload.get("mrf_selection") or {}
    hospital_ids = selection.get("hospital_candidate_ids")
    payer_ids = selection.get("payer_reporting_entity_candidate_ids")
    if hospital_ids != list(HOSPITAL_CANDIDATE_IDS):
        errors.append("hospital_candidate_ids are not the exact sealed ordered 25 IDs")
    if payer_ids != list(PAYER_CANDIDATE_IDS):
        errors.append("payer_reporting_entity_candidate_ids are not the exact sealed ordered 10 IDs")
    if not isinstance(hospital_ids, list) or len(hospital_ids) != 25:
        errors.append("hospital denominator is not the fixed 25")
    if not isinstance(payer_ids, list) or len(payer_ids) != 10:
        errors.append("payer denominator is not the fixed 10")
    if isinstance(hospital_ids, list) and len(set(hospital_ids)) != 25:
        errors.append("hospital IDs are not unique")
    if isinstance(payer_ids, list) and len(set(payer_ids)) != 10:
        errors.append("payer IDs are not unique")
    hospitals = selection.get("hospitals") or []
    payers = selection.get("payers") or []
    if [item.get("candidate_id") for item in hospitals] != list(HOSPITAL_CANDIDATE_IDS):
        errors.append("hospital record order diverges from sealed IDs")
    if [item.get("candidate_id") for item in payers] != list(PAYER_CANDIDATE_IDS):
        errors.append("payer record order diverges from sealed IDs")
    sealed_hospitals = {item["facility_id"]: item for item in load_hospital_fixtures()["fixtures"]}
    sealed_payers = {item["hios_issuer_id"]: item for item in load_payer_fixtures()["fixtures"]}
    for item in hospitals:
        row = item.get("selected_row") or {}
        sealed = sealed_hospitals.get(item.get("candidate_id"))
        if not row.get("source_csv_row") or not row.get("raw_projection_values"):
            errors.append(f"hospital {item.get('candidate_id')} missing selected row evidence")
        if item.get("source_url") is None or not (item.get("source_hash") or {}).get("sha256"):
            errors.append(f"hospital {item.get('candidate_id')} missing source URL/hash")
        if sealed is not None:
            if item.get("source_url") != sealed["source_url"]:
                errors.append(f"hospital {item.get('candidate_id')} source URL mismatch")
            if (item.get("source_hash") or {}).get("sha256") != sealed["source_sha256"]:
                errors.append(f"hospital {item.get('candidate_id')} source hash mismatch")
            if row.get("source_csv_row") != sealed["source_csv_row"]:
                errors.append(f"hospital {item.get('candidate_id')} selected row mismatch")
            if row.get("raw_projection_values") != sealed["raw_projection_values"]:
                errors.append(f"hospital {item.get('candidate_id')} selected row values mismatch")
        if item.get("unresolved_downstream_bindings") != UNRESOLVED_HOSPITAL_BINDINGS:
            errors.append(f"hospital {item.get('candidate_id')} missing typed unresolved bindings")
        if item.get("remain_in_later_denominators_if_unavailable_ineligible_restricted_or_file_sharing") is not True:
            errors.append(f"hospital {item.get('candidate_id')} may drop from later denominators")
    for item in payers:
        cell = item.get("selected_cell") or {}
        sealed = sealed_payers.get(item.get("candidate_id"))
        if not cell.get("cell_range") or not cell.get("raw_workbook_wire_values"):
            errors.append(f"payer {item.get('candidate_id')} missing selected cell evidence")
        if item.get("source_url") is None or not (item.get("source_hash") or {}).get("sha256"):
            errors.append(f"payer {item.get('candidate_id')} missing source URL/hash")
        if sealed is not None:
            if item.get("source_url") != sealed["source_url"]:
                errors.append(f"payer {item.get('candidate_id')} source URL mismatch")
            if (item.get("source_hash") or {}).get("sha256") != sealed["source_sha256"]:
                errors.append(f"payer {item.get('candidate_id')} source hash mismatch")
            if cell.get("cell_range") != sealed["cell_range"]:
                errors.append(f"payer {item.get('candidate_id')} selected cell mismatch")
            if cell.get("projection_values") != sealed["projection_values"]:
                errors.append(f"payer {item.get('candidate_id')} selected cell values mismatch")
        if item.get("unresolved_downstream_bindings") != UNRESOLVED_PAYER_BINDINGS:
            errors.append(f"payer {item.get('candidate_id')} missing typed unresolved bindings")
        if item.get("remain_in_later_denominators_if_unavailable_ineligible_restricted_or_file_sharing") is not True:
            errors.append(f"payer {item.get('candidate_id')} may drop from later denominators")
    diversity = selection.get("diversity_properties") or {}
    if diversity.get("hospital_jurisdiction_count") != 25:
        errors.append("hospital jurisdiction diversity is not 25")
    if diversity.get("ownership_type_count") != 12:
        errors.append("ownership-type diversity is not 12")
    if diversity.get("payer_state_count") != 10 or diversity.get("issuer_legal_name_count") != 10:
        errors.append("payer state/name diversity is not ten/ten")
    if diversity.get("not_population_estimates") is not True:
        errors.append("diversity properties must not be treated as population estimates")
    if selection.get("parsed_sample_targets") != {"hospital": 20, "payer": 8}:
        errors.append("R10 parsed-sample targets must remain 20 hospital and 8 payer")
    if selection.get("replacement_allowed") or selection.get("silent_deduplication_allowed"):
        errors.append("replacement or silent deduplication is forbidden")
    if selection.get("status") != R10_FRAME_STATE:
        errors.append("R10 frame state is not ids_frozen_locators_not_materialized")
    if selection.get("endpoint_results_seen") is not False:
        errors.append("endpoint results must not have been seen")
    return errors


def assert_expansion_families(payload: dict) -> list[str]:
    errors = []
    block = payload.get("expansion_families") or {}
    families = block.get("families") or []
    expected_ids = [item["family_identity"] for item in FAMILY_SPECS]
    actual_ids = [item.get("family_identity") for item in families]
    if actual_ids != expected_ids:
        errors.append("twelve family identities or order diverge from the frozen mapping")
    if len(set(actual_ids)) != 12:
        errors.append("family identities are not unique")
    products = {item["product_key"]: item for item in payload.get("products") or []}
    for spec, item in zip(FAMILY_SPECS, families):
        product = products.get(spec["product_key"])
        if product is None:
            errors.append(f"missing C1 product {spec['product_key']}")
            continue
        if item.get("product_key") != spec["product_key"]:
            errors.append(f"{spec['family_identity']} product_key substituted")
        if item.get("locator_status") != "unverified_locator":
            errors.append(f"{spec['family_identity']} locator was not left unverified")
        if item.get("publisher_access_claimed") or item.get("schema_qualification_claimed"):
            errors.append(f"{spec['family_identity']} overclaimed access or schema")
        if item.get("intake_pr") != spec["intake_pr"] or item.get("intake_commits") != list(spec["intake_commits"]):
            errors.append(f"{spec['family_identity']} intake mapping diverges")
        if spec["product_key"] == "state-facility-licensure":
            joined = " ".join(item.get("retained_unknowns") or [])
            if "federal certification is not state license evidence" not in joined:
                errors.append("state licensure must reject federal certification as license evidence")
        if spec["product_key"] == "state-apcd-programs":
            joined = " ".join(item.get("retained_unknowns") or [])
            if "navigation only" not in joined:
                errors.append("state APCD must keep secondary directories as navigation only")
    if block.get("status") != R09_FRAME_STATE:
        errors.append("R09 frame state is not pointers_frozen_intake_not_materialized")
    if block.get("family_count") != 12:
        errors.append("family_count is not 12")
    return errors


def assert_requirement_keyset(payload: dict) -> list[str]:
    errors = []
    acceptance = payload.get("acceptance")
    if not isinstance(acceptance, dict):
        return ["acceptance mapping is missing"]
    expected = list(c2_lib.REQUIREMENT_IDS)
    actual = list(acceptance.keys())
    if actual != expected and set(actual) != set(expected):
        errors.append("acceptance does not contain the full R01-R16 keyset")
    missing = [req for req in expected if req not in acceptance]
    if missing:
        errors.append("missing requirement keys: " + ", ".join(missing))
    extra = [key for key in actual if key not in expected]
    if extra:
        errors.append("unexpected acceptance keys: " + ", ".join(extra))
    if len(acceptance) != 16:
        errors.append(f"acceptance mapping length {len(acceptance)} != 16")
    bad = [key for key, value in acceptance.items() if value != "unaccepted"]
    if bad:
        errors.append("accepted or non-unaccepted statuses present: " + ", ".join(bad))
    return errors


def assert_c3_cohorts(payload: dict, rebuilt_c1: dict | None = None) -> list[str]:
    errors = []
    errors.extend(assert_pilot_identities(payload))
    errors.extend(assert_expansion_families(payload))
    errors.extend(assert_requirement_keyset(payload))
    if rebuilt_c1 is not None:
        if c2_lib.extract_c1_projection(payload) != c2_lib.extract_c1_projection(rebuilt_c1):
            errors.append("C1 projection was not preserved")
    if payload.get("commit_id") != "C-002-3":
        errors.append("cohorts commit_id is not C-002-3")
    return errors


def assert_c3_acceptance_document(text: str) -> list[str]:
    errors = c2_lib.assert_acceptance_document(text)
    if R09_FRAME_STATE not in text:
        errors.append("acceptance missing R09 C3 frame state")
    if R10_FRAME_STATE not in text:
        errors.append("acceptance missing R10 C3 frame state")
    if C2_CORRECTION_COMMIT not in text:
        errors.append("acceptance missing accepted C2 correction commit")
    if SEAL_SHA256 not in text:
        errors.append("acceptance missing pilot seal hash")
    return errors


def mutate_for_negative(payload: dict, kind: str) -> dict:
    clone = json.loads(json.dumps(payload))
    selection = clone["mrf_selection"]
    if kind == "delete_hospital":
        selection["hospital_candidate_ids"] = selection["hospital_candidate_ids"][:-1]
        selection["hospitals"] = selection["hospitals"][:-1]
        selection["hospital_candidate_count"] = 24
    elif kind == "replace_hospital":
        selection["hospital_candidate_ids"][0] = "999999"
        selection["hospitals"][0]["candidate_id"] = "999999"
    elif kind == "duplicate_identity":
        selection["hospital_candidate_ids"][1] = selection["hospital_candidate_ids"][0]
        selection["hospitals"][1]["candidate_id"] = selection["hospital_candidate_ids"][0]
    elif kind == "hash_mismatch":
        selection["hospitals"][0]["source_hash"]["sha256"] = "0" * 64
    elif kind == "missing_requirement_keys":
        clone["acceptance"] = {"R10": "unaccepted"}
    elif kind == "family_substitution":
        clone["expansion_families"]["families"][4]["family_identity"] = "HHS ASPE Social Vulnerability Index"
        clone["expansion_families"]["family_identities"][4] = "HHS ASPE Social Vulnerability Index"
    else:
        raise ValueError(kind)
    return clone


def write_c3_artifacts(repo: Path, here: Path = HERE, receipt_output: Path | None = None) -> dict:
    if receipt_output is not None:
        target = receipt_output.resolve()
        if target.name in HISTORICAL_RECEIPT_NAMES and target.parent.resolve() == here.resolve():
            raise SystemExit(f"refusing to overwrite historical receipt {target}")
    index_path = C3_DIR / "portable-index.json"
    dump_json(index_path, portable_index())
    cohorts_path = repo / "evaluation/research-program/cohorts.json"
    payload = build_cohorts_payload(repo)
    dump_json(cohorts_path, payload)
    tasks_path = repo / "evaluation/research-program/tasks.json"
    tasks_payload = build_tasks_payload(repo, here)
    dump_json(tasks_path, tasks_payload)
    tasks_sha = digest(tasks_path)
    cohorts_sha = digest(cohorts_path)
    acceptance_path = repo / "docs/research-program/acceptance.md"
    acceptance_path.write_text(render_acceptance_markdown(tasks_sha, cohorts_sha), encoding="utf-8")
    receipt = {
        "format": "ushso.research-program.pr-002.c3-build-receipt.v1",
        "commit_id": "C-002-3",
        "cohorts_path": "evaluation/research-program/cohorts.json",
        "cohorts_sha256": cohorts_sha,
        "cohorts_bytes": cohorts_path.stat().st_size,
        "c1_historical_cohorts_sha256": c2_lib.C1_COHORTS_SHA256,
        "c1_projection_preserved": True,
        "tasks_path": "evaluation/research-program/tasks.json",
        "tasks_sha256": tasks_sha,
        "tasks_bytes": tasks_path.stat().st_size,
        "c2_correction_tasks_sha256": C2_CORRECTION_TASKS_SHA256,
        "acceptance_path": "docs/research-program/acceptance.md",
        "acceptance_sha256": digest(acceptance_path),
        "c2_correction_acceptance_sha256": C2_CORRECTION_ACCEPTANCE_SHA256,
        "pilot_seal_sha256": SEAL_SHA256,
        "pilot_review_sha256": REVIEW_SHA256,
        "portable_index_sha256": digest(index_path),
        "hospital_candidate_ids": list(HOSPITAL_CANDIDATE_IDS),
        "payer_reporting_entity_candidate_ids": list(PAYER_CANDIDATE_IDS),
        "expansion_family_identities": [item["family_identity"] for item in FAMILY_SPECS],
        "r09_frame_state": R09_FRAME_STATE,
        "r10_frame_state": R10_FRAME_STATE,
        "c1_receipts_preserved": (
            digest(here / "c1-build-receipt.json") == c2_lib.C1_BUILD_RECEIPT_SHA256
            and digest(here / "c1-verify-receipt.json") == c2_lib.C1_VERIFY_RECEIPT_SHA256
        ),
        "c2_receipts_preserved": (
            digest(here / "c2-build-receipt.json") == c2_lib.C2_BUILD_RECEIPT_SHA256
            and digest(here / "c2-verify-receipt.json") == c2_lib.C2_VERIFY_RECEIPT_SHA256
        ),
        "endpoint_results_seen": False,
        "selection_consumed_not_recomputed": True,
    }
    if receipt_output is not None:
        target = receipt_output.resolve()
        if target.name in HISTORICAL_RECEIPT_NAMES and target.parent == here:
            raise SystemExit(f"refusing to overwrite historical receipt {target}")
        dump_json(target, receipt)
        receipt["receipt_output"] = str(target)
        receipt["receipt_output_sha256"] = digest(target)
    return receipt
