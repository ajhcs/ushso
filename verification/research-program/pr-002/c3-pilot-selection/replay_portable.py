#!/usr/bin/env python3
"""Portable C-002-3 input verification wrapper.

Consumes the already sealed 25/10 directory selection. It hash-checks explicit
verified inputs and the historical replay script without executing that script
or pretending to share its hash. No network. No re-selection.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import c3_lib


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path("."))
    args = parser.parse_args()
    repo = args.repo.resolve()
    errors = []
    errors.extend(c3_lib.verify_copied_evidence())
    errors.extend(c3_lib.verify_payer_cells())
    historical = c3_lib.CANDIDATES_DIR / "replay-selection.py"
    if c3_lib.digest(historical) != c3_lib.REPLAY_SCRIPT_SHA256:
        errors.append("historical replay script hash mismatch")
    wrapper_hash = c3_lib.digest(Path(__file__))
    if wrapper_hash == c3_lib.REPLAY_SCRIPT_SHA256:
        errors.append("portable wrapper must not claim the historical replay script hash")
    seal = c3_lib.load_seal()
    if seal["selected_ids"]["hospital_facility_ids"] != list(c3_lib.HOSPITAL_CANDIDATE_IDS):
        errors.append("seal hospital IDs diverged")
    if seal["selected_ids"]["payer_hios_issuer_ids"] != list(c3_lib.PAYER_CANDIDATE_IDS):
        errors.append("seal payer IDs diverged")
    cohorts = json.loads((repo / "evaluation/research-program/cohorts.json").read_text(encoding="utf-8"))
    if cohorts.get("commit_id") == "C-002-3":
        errors.extend(c3_lib.assert_pilot_identities(cohorts))
        errors.extend(c3_lib.assert_expansion_families(cohorts))
        errors.extend(c3_lib.assert_requirement_keyset(cohorts))
    print(json.dumps({
        "format": "ushso.pr002.c3-portable-replay.v1",
        "ok": errors == [],
        "errors": errors,
        "historical_replay_script_sha256": c3_lib.REPLAY_SCRIPT_SHA256,
        "portable_wrapper_sha256": wrapper_hash,
        "historical_script_executed": False,
        "selection_recomputed": False,
        "payer_cells_verified_against_retained_xlsx": errors == [] or all("cell" not in item for item in errors),
    }, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
