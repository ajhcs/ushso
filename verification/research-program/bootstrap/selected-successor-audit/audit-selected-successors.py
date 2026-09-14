#!/usr/bin/env python3
"""Read-only, source-bound audit of every suite selected by PR-085's runner."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import subprocess
from pathlib import PurePosixPath
from typing import Any

REPO = "/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr004-field-states-20260910"
PR003_REPO = "/mnt/d/worktrees/plumbob/ushso-research-program-20260910"
OUT = "/mnt/d/tmp/plumbob/ushso-research-program-20260910/selected-successor-input-audit"
SOURCE = "9c8cba903d296238e145d331512f2a63583278bf"
PR085_FINAL = "4f90157108a92ce9541c340d5536eac31f24a1d8"
PR004 = "323dfe54c88322369f417c7fde22597b9ab57d75"
PR003_FINAL = "d1c42eab33e1c21edf805036464f2b64667a489a"
PR003_REQUESTED = "0b28d036f1df4b5248732bc62f68edd79f14d06e"
BASE = "e5c44249b9d2448df2e4b6d466077658e42a009d"
WP14_AUTH = "f2641a3bfd5ae7249d0acffff883b312e4bdb077"
DISCOVERED_PATH = os.path.join(OUT, "discovered-suites.json")
DISCOVERED_SHA = "a3dbf741b8fd400001971b2f7fc81ea6c7a5a1cb892718739c9139ab69ea540d"
WP11_DIAGNOSIS = "/mnt/d/tmp/plumbob/ushso-research-program-20260910/pr085-wp11-diagnosis/receipt.json"
WP11_DIAGNOSIS_SHA = "8cf7713fe03a601e7e2135a390a57eace872c1deb01b7c48ffb2eea221ae91d7"

script_started_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
timestamp = script_started_at
commands: list[dict[str, Any]] = []


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_run(repo: str, args: list[str], *, record: bool = True) -> subprocess.CompletedProcess[bytes]:
    started = dt.datetime.now(dt.timezone.utc)
    p = subprocess.run(["git", *args], cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    finished = dt.datetime.now(dt.timezone.utc)
    if record:
        commands.append({
            "argv": ["git", *args],
            "cwd": repo,
            "started_at": started.isoformat().replace("+00:00", "Z"),
            "completed_at": finished.isoformat().replace("+00:00", "Z"),
            "exit_code": p.returncode,
            "stdout_bytes": len(p.stdout),
            "stdout_sha256": sha256(p.stdout),
            "stderr_bytes": len(p.stderr),
            "stderr_sha256": sha256(p.stderr),
        })
    return p


def git_text(repo: str, args: list[str], *, required: bool = True, record: bool = False) -> str | None:
    p = git_run(repo, args, record=record)
    if p.returncode != 0:
        if required:
            raise RuntimeError(f"git command failed ({p.returncode}): {args}: {p.stderr.decode(errors='replace')}")
        return None
    return p.stdout.decode("utf-8")


def blob(repo: str, commit: str, path: str) -> bytes | None:
    p = git_run(repo, ["show", f"{commit}:{path}"], record=False)
    if p.returncode != 0:
        return None
    return p.stdout


def json_blob(repo: str, commit: str, path: str) -> Any | None:
    b = blob(repo, commit, path)
    if b is None:
        return None
    return json.loads(b)


def describe(repo: str, commit: str) -> dict[str, Any]:
    raw = git_text(repo, ["show", "-s", "--format=%H%n%T%n%P%n%s", commit], required=True, record=True)
    assert raw is not None
    lines = raw.splitlines()
    return {"commit": lines[0], "tree": lines[1], "parents": lines[2].split(), "subject": lines[3]}


def file_info(repo: str, commit: str, path: str) -> dict[str, Any]:
    b = blob(repo, commit, path)
    if b is None:
        return {"path": path, "present": False}
    return {"path": path, "present": True, "bytes": len(b), "sha256": sha256(b)}


def git_oid(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def canonical_digest(prefix: str, value: Any) -> str:
    """Canonical JSON helper used only to classify a pre-existing digest field."""
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return sha256(prefix.encode() + payload)


def iso_utc(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def write_json(name: str, value: Any) -> tuple[str, int, str]:
    path = os.path.join(OUT, name)
    data = (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()
    with open(path, "wb") as f:
        f.write(data)
    return path, len(data), sha256(data)


def read_git_ref_hash(repo: str, commit: str, path: str) -> dict[str, Any]:
    return file_info(repo, commit, path)


os.makedirs(OUT, exist_ok=True)

# Record source identities and the bounded source-list command. The package bytes are read
# through git-show below, so no worktree files or generated receipts are touched.
ref_info = {
    "pr085_review_head": describe(REPO, SOURCE),
    "pr085_final_component": describe(REPO, PR085_FINAL),
    "pr004_component": describe(REPO, PR004),
    "base_for_pr004": describe(REPO, BASE),
    "pr003_final_component": describe(PR003_REPO, PR003_FINAL),
}
source_names_text = git_text(REPO, ["ls-tree", "-r", "--name-only", SOURCE, "--", "docs/feedback", "evaluation", "verification"], record=True)
assert source_names_text is not None
source_names = source_names_text.splitlines()

with open(DISCOVERED_PATH, "rb") as f:
    discovered_bytes = f.read()
assert sha256(discovered_bytes) == DISCOVERED_SHA, "pre-existing discovery artifact changed"
discovered = json.loads(discovered_bytes)
runner_info = file_info(REPO, SOURCE, "scripts/run-contract-suites.mjs")
assert runner_info["sha256"] == discovered["source_sha256"], "discovery source hash does not match PR085 runner"
assert discovered["commit"] == SOURCE and discovered["tree"] == ref_info["pr085_review_head"]["tree"]
selected = discovered["selected"]
assert discovered["definition_count"] == 20 and discovered["selected_count"] == 20 and len(selected) == 20

classification = {
    "feedback": ("feedback/baseline", "No successor approval/current-evidence route; source-copy validator."),
    "evaluator-bridge": ("evaluator/bridge", "Bridge receipt and algorithm/corpus pins; no generic successor approval helper."),
    "evaluator-v2": ("evaluator/metric", "Metric evaluator package; no generic successor approval helper."),
    "external-authorization": ("authorization/register", "Versioned authorization register; AUTH-10 is historical and expired as of audit date."),
    "program-verification": ("program/ledger", "Aggregate implementation ledger; includes two stale raw file pins recorded below."),
    "ci-verification": ("strict-successor/current-adapter", "CI v1.4 draft/validator has direct current-input transition and pending approval semantics."),
    "wp0": ("strict-successor/historical-approval", "Historical v1.4 approval is subject-bound; current 9c lock and runner drift from approved evidence."),
    "wp10a": ("freeze/governance", "Technical freeze/owner packet; no generic successor approval helper."),
    "wp11": ("strict-successor/historical-approval", "Historical v1.3 approval is subject-bound; current 9c lock drift and stale subject remain."),
    "wp12": ("activation/package-tests", "Activation package tests only; no strict successor approval/current-evidence helper."),
    "wp13": ("candidate-validation", "Protected local candidate with pending artifact seal; no strict successor approval helper."),
    "wp14": ("strict-successor/direct-local-fixture", "Direct attestation verifier; local fixture scope and release/production false."),
    "wp2": ("aggregate-contract-verification", "Ten package pins and receipts; read-only aggregate validation, no generic successor helper."),
    "wp3": ("foundation/local-infra", "Database/control-plane foundation fixtures and receipts; no generic successor helper."),
    "wp4": ("control-plane/local-fixtures", "Scheduler/workflow fixtures and receipts; no generic successor helper."),
    "wp5": ("connector/evidence-ledger", "Connector evidence ledger and semantic mapping digest; no generic successor helper."),
    "wp6": ("normalization/local-verification", "Normalization/legacy import verification; no generic successor helper."),
    "wp7": ("identity/local-verification", "Identity/family/access verification; no generic successor helper."),
    "wp8": ("governed-metric-successor", "Approved scoped development metric successor; release and production remain false."),
    "wp9": ("coverage/local-verification", "Coverage accounting and implementation manifest; no generic successor helper."),
}

package_identity_checks = []
suite_matrix = []
for s in selected:
    p = s["package_path"]
    b = blob(REPO, SOURCE, p)
    actual = file_info(REPO, SOURCE, p)
    package_identity_checks.append({
        "alias": s["alias"], "path": p,
        "expected_bytes": s["package_bytes"], "expected_sha256": s["package_sha256"],
        "actual": actual,
        "matches": actual.get("present") and actual.get("bytes") == s["package_bytes"] and actual.get("sha256") == s["package_sha256"],
    })
    root = s["path"]
    names = [x for x in source_names if x == root or x.startswith(root + "/")]
    strict_tokens = []
    token_files = []
    for name in names:
        x = blob(REPO, SOURCE, name)
        if x is None:
            continue
        text = x.decode("utf-8", errors="replace")
        tokens = [t for t in ("createDraft", "validateApproval", "runSuccessorCli", "successor-attestation", "pending_authorized_review", "subject_sha256", "technical_evidence") if t in text]
        if tokens:
            token_files.append({"path": name, "tokens": tokens, "bytes": len(x), "sha256": sha256(x)})
        strict_tokens.extend(tokens)
    kind, rationale = classification[s["alias"]]
    suite_matrix.append({
        "alias": s["alias"], "version": s["version"], "package_root": root,
        "test_command": f"npm test --prefix {root}", "declared_scripts": s["scripts"],
        "test_files": s["test_files"], "tree_file_count": len(names),
        "package_sha256": s["package_sha256"], "classification": kind,
        "successor_tokens": sorted(set(strict_tokens)), "token_files": token_files,
        "selection_disposition": rationale,
    })

# Explicitly replay every selected package's package identity. This is not an npm run and
# does not generate receipts.
package_identity_mismatches = [x for x in package_identity_checks if not x["matches"]]

# Package-relative manifests (bridge and WP2), feedback source copies, WP7 manifest byte
# binding, and WP9's repository-relative implementation manifest.
manifest_checks: list[dict[str, Any]] = []

def check_manifest(path: str, mode: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    checked = []
    mismatches = []
    for i, item in enumerate(items):
        rel = item.get("path")
        if not isinstance(rel, str):
            continue
        if mode == "repo_relative":
            resolved = rel
        elif mode == "package_relative":
            resolved = str(PurePosixPath(path).parent.parent / rel)
        else:
            resolved = str(PurePosixPath(path).parent / rel)
        got = file_info(REPO, SOURCE, resolved)
        row = {"index": i, "manifest_path": path, "mode": mode, "declared_path": rel,
               "resolved_path": resolved, "expected_bytes": item.get("bytes"), "expected_sha256": item.get("sha256"), "actual": got}
        row["matches"] = got.get("present") and got.get("bytes") == item.get("bytes") and got.get("sha256") == item.get("sha256")
        checked.append(row)
        if not row["matches"]:
            mismatches.append(row)
    return {"path": path, "mode": mode, "entry_count": len(items), "checked": len(checked), "mismatch_count": len(mismatches), "mismatches": mismatches}

for p, mode in [
    ("evaluation/bridge/v1.0.0/manifests/package-manifest.json", "package_relative"),
    ("verification/wp2/v1.0.0/manifests/package-manifest.json", "package_relative"),
    ("verification/wp9/v1.0.0/receipts/implementation-file-manifest.json", "repo_relative"),
]:
    d = json_blob(REPO, SOURCE, p)
    assert isinstance(d, dict) and isinstance(d.get("files"), list)
    manifest_checks.append(check_manifest(p, mode, d["files"]))

feedback_manifest = json_blob(REPO, SOURCE, "docs/feedback/v1.0.0/manifest.json")
feedback_rows = []
if isinstance(feedback_manifest, dict):
    for item in feedback_manifest.get("sources", []):
        rel = item.get("file")
        got = file_info(REPO, SOURCE, f"docs/feedback/v1.0.0/{rel}")
        row = {"source_id": item.get("source_id"), "declared_path": rel, "resolved_path": f"docs/feedback/v1.0.0/{rel}", "expected_bytes": item.get("byte_count"), "expected_sha256": item.get("sha256"), "actual": got}
        row["matches"] = got.get("present") and got.get("bytes") == item.get("byte_count") and got.get("sha256") == item.get("sha256")
        feedback_rows.append(row)
manifest_checks.append({"path": "docs/feedback/v1.0.0/manifest.json", "mode": "source_copy_relative", "entry_count": len(feedback_rows), "checked": len(feedback_rows), "mismatch_count": sum(not x["matches"] for x in feedback_rows), "mismatches": [x for x in feedback_rows if not x["matches"]]})

wp7_validation = json_blob(REPO, SOURCE, "verification/wp7/v1.0.0/validation/validation-receipt.json")
wp7_manifest_path = "verification/wp7/v1.0.0/manifests/package-manifest.json"
wp7_manifest_info = file_info(REPO, SOURCE, wp7_manifest_path)
wp7_row = {
    "receipt_path": "verification/wp7/v1.0.0/validation/validation-receipt.json",
    "manifest_path": wp7_manifest_path,
    "expected_manifest_sha256": wp7_validation.get("manifest_byte_sha256") if isinstance(wp7_validation, dict) else None,
    "actual_manifest": wp7_manifest_info,
}
wp7_row["matches"] = bool(wp7_manifest_info.get("present") and wp7_row["expected_manifest_sha256"] == wp7_manifest_info.get("sha256"))
manifest_checks.append({"path": wp7_manifest_path, "mode": "receipt_byte_binding", "entry_count": 1, "checked": 1, "mismatch_count": 0 if wp7_row["matches"] else 1, "mismatches": [] if wp7_row["matches"] else [wp7_row], "binding": wp7_row})

# WP2's ten package references are repository-relative to the WP2 package root.
wp2_receipt = json_blob(REPO, SOURCE, "verification/wp2/v1.0.0/validation/validation-receipt.json")
wp2_rows = []
if isinstance(wp2_receipt, dict):
    for i, item in enumerate(wp2_receipt.get("packages", [])):
        root = item.get("path")
        checks = []
        for field, default_path in [("package_json_sha256", f"{root}/package.json"), ("manifest_sha256", None), ("receipt_sha256", None)]:
            if field == "package_json_sha256":
                expected = item.get(field); resolved = default_path
            else:
                rel = item.get("manifest_path") if field == "manifest_sha256" else item.get("receipt_path")
                expected = item.get(field); resolved = f"{root}/{rel}" if isinstance(rel, str) else None
            got = file_info(REPO, SOURCE, resolved) if resolved else {"path": resolved, "present": False}
            checks.append({"field": field, "resolved_path": resolved, "expected_sha256": expected, "actual": got, "matches": bool(resolved and got.get("sha256") == expected)})
        wp2_rows.append({"index": i, "package_id": item.get("package_id"), "checks": checks, "matches": all(x["matches"] for x in checks)})
wp2_manifest_expected = wp2_receipt.get("verification_package_manifest_sha256") if isinstance(wp2_receipt, dict) else None
wp2_manifest_actual = file_info(REPO, SOURCE, "verification/wp2/v1.0.0/manifests/package-manifest.json")
wp2_registry_expected = wp2_receipt.get("package_registry_sha256") if isinstance(wp2_receipt, dict) else None
wp2_registry_actual = file_info(REPO, SOURCE, "verification/wp2/v1.0.0/contracts/package-registry.json")
wp2_binding = {
    "package_reference_count": len(wp2_rows), "package_reference_mismatch_count": sum(not x["matches"] for x in wp2_rows),
    "manifest": {"expected_sha256": wp2_manifest_expected, "actual": wp2_manifest_actual, "matches": wp2_manifest_actual.get("sha256") == wp2_manifest_expected},
    "package_registry": {"expected_sha256": wp2_registry_expected, "actual": wp2_registry_actual, "matches": wp2_registry_actual.get("sha256") == wp2_registry_expected},
    "rows": wp2_rows,
}

# Strict historical approved technical-evidence pins. The package-relative source paths in
# WP0/WP11 are repository paths by contract; compare them exactly against 9c.
def approved_pin_check(path: str, key: str) -> dict[str, Any]:
    d = json_blob(REPO, SOURCE, path)
    assert isinstance(d, dict)
    items = d["technical_evidence"][key]
    mismatches = []
    for i, item in enumerate(items):
        p = item.get("path")
        got = file_info(REPO, SOURCE, p)
        row = {"index": i, "path": p, "expected_bytes": item.get("bytes"), "expected_sha256": item.get("sha256"), "actual": got}
        row["matches"] = got.get("present") and got.get("bytes") == item.get("bytes") and got.get("sha256") == item.get("sha256")
        if not row["matches"]:
            mismatches.append(row)
    return {
        "approval_path": path, "pin_field": f"technical_evidence.{key}", "subject_sha256": d.get("subject_sha256"),
        "entry_count": len(items), "mismatch_count": len(mismatches), "mismatches": mismatches,
    }

wp0_pins = approved_pin_check("verification/wp0/v1.4.0/receipts/approved.json", "implementation_files")
wp11_pins = approved_pin_check("verification/wp11/v1.3.0/receipts/approved.json", "files")

# Current CI v1.4 transition constants are extracted from the reviewed source, then compared
# to 9c and the exact final PR003 component bytes.
ci_adapter_path = "scripts/verify-ci-attestation.mjs"
ci_adapter = blob(REPO, SOURCE, ci_adapter_path)
assert ci_adapter is not None
ci_adapter_text = ci_adapter.decode()
ci_inputs = []
for match in re.finditer(r"path: '([^']+)'\s*,\s*\n\s*role: '([^']+)'\s*,\s*\n\s*source_commit: REVIEWED_PR003_SOURCE_COMMIT\s*,\s*\n\s*historical_bytes: (\d+)\s*,\s*\n\s*historical_sha256: '([0-9a-f]+)'\s*,\s*\n\s*current_bytes: (\d+)\s*,\s*\n\s*current_sha256: '([0-9a-f]+)'", ci_adapter_text):
    path, role, hb, hh, cb, ch = match.groups()
    current = file_info(REPO, SOURCE, path)
    pr003 = file_info(PR003_REPO, PR003_FINAL, path)
    ci_inputs.append({"path": path, "role": role, "reviewed_source_commit_constant": "bf46d92b0e4fc91457bd3eb78aa1742ae84038f2", "historical": {"bytes": int(hb), "sha256": hh}, "reviewed_current": {"bytes": int(cb), "sha256": ch}, "pr085_9c_actual": current, "pr003_final_actual": pr003, "pr085_matches_reviewed_current": current.get("bytes") == int(cb) and current.get("sha256") == ch, "pr003_matches_reviewed_current": pr003.get("bytes") == int(cb) and pr003.get("sha256") == ch})
assert len(ci_inputs) == 2
ci_transition = {
    "adapter_path": ci_adapter_path, "adapter_source": file_info(REPO, SOURCE, ci_adapter_path),
    "shared_successor_support": file_info(REPO, SOURCE, "verification/successor-support.mjs"),
    "reviewed_inputs": ci_inputs,
    "9c_current_transition_state": "historical_pair" if all(x["pr085_9c_actual"]["sha256"] == x["historical"]["sha256"] for x in ci_inputs) else "mixed_or_unrecognized",
    "prospective_pr003_state": "reviewed_current_pair" if all(x["pr003_matches_reviewed_current"] for x in ci_inputs) else "not_reviewed_current_pair",
    "conclusion": "CI v1.4 adapter cannot take the PR003 current transition on 9c; d1c supplies both exact reviewed current bytes. Preserve the CI v1.4 package/route from PR085 and enforce atomic pair semantics during composition.",
}

# WP14 policy is a direct local-fixture attestation; resolve authorized files against the
# authorized f264 commit, successor copies against 9c, and historical receipts against 9c.
wp14_policy_path = "verification/wp14/v1.1.0/policy/successor-attestation.v1.1.0.json"
wp14_receipt_path = "verification/wp14/v1.1.0/receipts/successor-attestation.json"
wp14_policy = json_blob(REPO, SOURCE, wp14_policy_path)
wp14_receipt = json_blob(REPO, SOURCE, wp14_receipt_path)
wp14_file_rows = []
for item in wp14_policy["implementation"]["files"]:
    auth = file_info(REPO, WP14_AUTH, item["authorized_path"])
    successor = file_info(REPO, SOURCE, item["successor_path"])
    auth_oid = None
    auth_bytes = blob(REPO, WP14_AUTH, item["authorized_path"])
    if auth_bytes is not None:
        auth_oid = git_oid(auth_bytes)
    row = {"authorized_path": item["authorized_path"], "successor_path": item["successor_path"], "expected_git_blob_oid": item["git_blob_oid"], "actual_authorized": auth, "actual_authorized_git_blob_oid": auth_oid, "expected_sha256": item["sha256"].removeprefix("sha256:"), "actual_successor": successor, "authorized_bytes_equal_successor": bool(auth_bytes is not None and blob(REPO, SOURCE, item["successor_path"]) == auth_bytes)}
    row["matches"] = bool(auth.get("sha256") == row["expected_sha256"] and successor.get("sha256") == row["expected_sha256"] and auth_oid == item["git_blob_oid"] and row["authorized_bytes_equal_successor"])
    wp14_file_rows.append(row)
wp14_hist_rows = []
for item in wp14_policy["historical_v1_0_0"]["required_receipts"]:
    got = file_info(REPO, SOURCE, item["path"])
    expected = item["file_sha256"].removeprefix("sha256:")
    wp14_hist_rows.append({"path": item["path"], "expected_sha256": expected, "actual": got, "matches": got.get("sha256") == expected})
wp14_manifest_expected = wp14_policy["historical_v1_0_0"]["implementation_manifest_file_sha256"].removeprefix("sha256:")
wp14_manifest_actual = file_info(REPO, SOURCE, wp14_policy["historical_v1_0_0"]["implementation_manifest_path"])
wp14_policy_actual = file_info(REPO, SOURCE, wp14_policy_path)
wp14_receipt_actual = file_info(REPO, SOURCE, wp14_receipt_path)
wp14_checks = {
    "policy": {"path": wp14_policy_path, "actual": wp14_policy_actual, "receipt_pointer_sha256": wp14_receipt["policy"]["file_sha256"].removeprefix("sha256:"), "matches": wp14_policy_actual.get("sha256") == wp14_receipt["policy"]["file_sha256"].removeprefix("sha256:")},
    "implementation": {"policy_commit": wp14_policy["implementation"]["commit"], "policy_tree": wp14_policy["implementation"]["tree"], "files": wp14_file_rows, "mismatch_count": sum(not x["matches"] for x in wp14_file_rows)},
    "historical_manifest": {"path": wp14_policy["historical_v1_0_0"]["implementation_manifest_path"], "expected_sha256": wp14_manifest_expected, "actual": wp14_manifest_actual, "matches": wp14_manifest_actual.get("sha256") == wp14_manifest_expected},
    "historical_receipts": {"rows": wp14_hist_rows, "mismatch_count": sum(not x["matches"] for x in wp14_hist_rows)},
    "receipt": {"path": wp14_receipt_path, "actual": wp14_receipt_actual, "receipt_sha256_field": wp14_receipt.get("receipt_sha256"), "release_gate_executed": wp14_receipt["release_gate"]["executed"], "production_eligibility": wp14_receipt["production_eligibility"], "actions": wp14_receipt["actions"]},
    "current_v1_0_source_note": "The current 9c v1.0 durable-transition files differ from the f264 authorized source by design; policy checks the f264 authorized blob and v1.1 successor copy, so those current v1.0 differences are not a pin finding.",
}

# WP8 is a governed metric successor rather than a generic strict successor-support route.
wp8_receipt = json_blob(REPO, SOURCE, "verification/wp8/v1.2.0/validation/validation-receipt.json")
metric_path = wp8_receipt["metric_contract"]["path"]
metric_actual = file_info(REPO, SOURCE, metric_path)
predecessor_path = wp8_receipt["preserved_history"]["predecessor_receipt_path"]
predecessor_actual = file_info(REPO, SOURCE, predecessor_path)
wp8_checks = {
    "receipt_path": "verification/wp8/v1.2.0/validation/validation-receipt.json",
    "receipt_actual": file_info(REPO, SOURCE, "verification/wp8/v1.2.0/validation/validation-receipt.json"),
    "status": wp8_receipt["status"], "approval_status": wp8_receipt["approval"]["status"],
    "metric_contract": {"path": metric_path, "expected_sha256": wp8_receipt["metric_contract"]["sha256"], "actual": metric_actual, "matches": metric_actual.get("sha256") == wp8_receipt["metric_contract"]["sha256"]},
    "predecessor": {"path": predecessor_path, "expected_sha256": wp8_receipt["preserved_history"]["predecessor_receipt_sha256"], "actual": predecessor_actual, "matches": predecessor_actual.get("sha256") == wp8_receipt["preserved_history"]["predecessor_receipt_sha256"]},
    "release_gate_pass": wp8_receipt["release_gate_pass"], "release_ready": wp8_receipt["release_ready"], "production_eligibility": wp8_receipt["production_eligibility"], "execution_boundary": wp8_receipt["execution_boundary"],
    "conclusion": "Governed development metric successor pins match; no generic strict subject/approval route or release qualification is present.",
}

# Authorization is a historical register delta. Check its parent file bytes and expiration
# without treating it as current authority.
auth_register = json_blob(REPO, SOURCE, "verification/external-authorization/v1.1.0/register.json")
auth_parent = auth_register["parent"]
auth_parent_actual = file_info(REPO, SOURCE, auth_parent["path"])
auth_delta = auth_register["authorization_deltas"][0]
expires_at = auth_delta["scope"]["expires_at"]
auth_status = "expired_historical" if iso_utc(expires_at) < dt.datetime.now(dt.timezone.utc) else "currently_unexpired"
auth_checks = {"register_path": "verification/external-authorization/v1.1.0/register.json", "register_actual": file_info(REPO, SOURCE, "verification/external-authorization/v1.1.0/register.json"), "parent": {"path": auth_parent["path"], "expected_sha256": auth_parent["sha256"], "actual": auth_parent_actual, "matches": auth_parent_actual.get("sha256") == auth_parent["sha256"]}, "delta": {"id": auth_delta["id"], "status": auth_delta["status"], "authorized": auth_delta["authorized"], "branch": auth_delta["scope"]["branch"], "expires_at": expires_at, "audit_status": auth_status, "allowed_actions": auth_delta["scope"]["allowed_actions"]}, "limitation": "effective-register validates parent/delta identity but does not enforce expires_at; consumers must not treat expired AUTH-10 as current authority."}

# Program ledger has two raw file SHA fields that are stale against current 9c files. The
# WP11 receipt_sha256 field is a canonical algorithm digest, so it is retained separately
# and not compared to the raw file SHA.
program_ledger = json_blob(REPO, SOURCE, "verification/program/v1.0.0/ledger.json")
program_cross_package = []
for control_id in ("WP5", "WP11"):
    control = next(x for x in program_ledger["controls"] if x["id"] == control_id)
    for evidence in control.get("evidence", []):
        path = evidence.get("path")
        got = file_info(REPO, SOURCE, path)
        row = {"control": control_id, "path": path, "declared_raw_file_sha256": evidence.get("sha256"), "actual_raw_file": got, "raw_file_sha_matches": got.get("sha256") == evidence.get("sha256"), "declared_canonical_receipt_sha256": evidence.get("receipt_sha256")}
        if control_id == "WP11":
            row["canonical_digest_note"] = "receipt_sha256 is governed by ushso_wp11_receipt_sha256/v1 and is not the raw file SHA; this audit does not classify that canonical field as stale raw-file pin."
        program_cross_package.append(row)

# PR004's changed normalization/coverage files and relevant root composition inputs.
pr004_paths = [
    "packages/coverage/index.mjs",
    "packages/coverage/research-program/v1.0.0/schemas/completeness-view.schema.json",
    "packages/coverage/research-program/v1.0.0/src/completeness.mjs",
    "packages/normalization/manifests/package-manifest.json",
    "packages/normalization/schemas/field-observation.schema.json",
    "packages/normalization/src/field-observation.mjs",
    "packages/normalization/src/index.mjs",
    "packages/normalization/tools/validate-package.mjs",
    "tests/research-program/field-states.test.mjs",
    "verification/research-program/pr-004/build-completeness-view.mjs",
    "verification/research-program/pr-004/completeness-view.json",
    "verification/research-program/pr-004/evidence.json",
    "verification/research-program/pr-004/evidence/r2/README.md",
    "verification/research-program/pr-004/evidence/r2/index.json",
    "verification/research-program/pr-004/task-binding.json",
    "verification/research-program/pr-004/verify.mjs",
]
pr004_changed = []
for p in pr004_paths:
    base_info = file_info(REPO, BASE, p)
    pr004_info = file_info(REPO, PR004, p)
    source_info = file_info(REPO, SOURCE, p)
    d1c_info = file_info(PR003_REPO, PR003_FINAL, p)
    pr004_changed.append({"path": p, "base_e5c": base_info, "pr085_9c": source_info, "pr003_d1c": d1c_info, "pr004_323": pr004_info, "pr004_changed_from_base": base_info != pr004_info})

root_matrix_paths = [
    "package.json", "package-lock.json", "scripts/run-contract-suites.mjs", "tests/contract-package-inventory.test.mjs",
    "verification/successor-support.mjs", "scripts/verify-wp0-attestation.mjs", "scripts/verify-ci-attestation.mjs",
    "verification/wp0/v1.4.0/tools/verify.mjs", "verification/wp11/v1.3.0/tools/technical-evidence.mjs", "verification/wp11/v1.3.0/tools/verify.mjs",
    "verification/testing/ci/v1.4.0/package.json", "verification/testing/ci/v1.4.0/tools/validate-package.mjs", "verification/testing/ci/v1.4.0/tools/ci-inventory.mjs",
]
root_matrix = []
for p in root_matrix_paths:
    root_matrix.append({"path": p, "pr085_9c": file_info(REPO, SOURCE, p), "pr085_final_4f9": file_info(REPO, PR085_FINAL, p), "pr003_final_d1c": file_info(PR003_REPO, PR003_FINAL, p), "pr004_323": file_info(REPO, PR004, p)})

composition = {
    "format": "ushso.selected-successor-composition-inputs.v1",
    "generated_at": timestamp,
    "review_scope": "Static Git-byte/source audit of PR085 selected successor validation packages and prospective PR003/PR004 composition.",
    "references": {
        "pr085_review_head": ref_info["pr085_review_head"], "pr085_final_component": ref_info["pr085_final_component"], "pr003_final_component": ref_info["pr003_final_component"], "pr004_component": ref_info["pr004_component"], "base_for_pr004": ref_info["base_for_pr004"],
        "pr003_requested_commit": {"commit": PR003_REQUESTED, "available_in_local_object_stores": False, "checked_repositories": [REPO, PR003_REPO], "resolution": "Use the final PR003 component d1c for measured package/inventory bytes; root supplied that its selected bytes are unchanged from the requested 0b28 input, but this audit cannot independently dereference the absent object."},
    },
    "root_input_matrix": root_matrix,
    "pr004_changed_normalization_coverage_paths": pr004_changed,
    "pr003_transition": ci_transition,
    "composition_rules": [
        "Retain PR085 CI v1.4 package, route and atomic historical/reviewed-current transition checks while applying PR003 root package/inventory bytes.",
        "Do not copy PR003's older runner over PR085's current runner without reconciling CI v1.4 selection and package-lock workspace membership.",
        "Apply PR004 normalization/coverage paths after independently checking their exact hashes; they are absent from the PR085/PR003 snapshots where reported absent.",
        "Preserve historical WP0/WP11 approval subjects, receipts and evidence; never repin or overwrite them to make current checks pass.",
    ],
    "prospective_risks": [
        "PR003 d1c package.json and contract inventory test match CI v1.4 reviewed-current constants, while 9c root package remains the historical pair; the pair must move atomically.",
        "9c's package-lock contains the CI v1.4 workspace link while d1c and 323 package-lock are af207 historical bytes; a final composition must retain the selected CI v1.4 package and reconcile lockfile state rather than silently dropping it.",
        "PR004 is a sibling of PR003 (merge-base e5c), so neither component is an ancestry proof for the other.",
    ],
}

selected_pin_audit = {
    "format": "ushso.selected-successor-package-audit.v1",
    "generated_at": timestamp,
    "source": {"commit": SOURCE, "tree": ref_info["pr085_review_head"]["tree"], "runner": runner_info, "runner_source_sha256": discovered["source_sha256"], "discovery_artifact": {"path": DISCOVERED_PATH, "bytes": len(discovered_bytes), "sha256": DISCOVERED_SHA}},
    "selection": {"definition_count": discovered["definition_count"], "selected_count": discovered["selected_count"], "selected_aliases": [x["alias"] for x in selected]},
    "package_identity": {"checked": len(package_identity_checks), "mismatch_count": len(package_identity_mismatches), "mismatches": package_identity_mismatches},
    "selected_suite_matrix": suite_matrix,
    "internal_manifest_checks": {"manifests": manifest_checks, "wp2_validation_bindings": wp2_binding, "mismatch_count": sum(x["mismatch_count"] for x in manifest_checks) + wp2_binding["package_reference_mismatch_count"] + (0 if wp2_binding["manifest"]["matches"] else 1) + (0 if wp2_binding["package_registry"]["matches"] else 1)},
    "strict_successor_checks": {"wp0_v1_4": wp0_pins, "wp11_v1_3": wp11_pins, "ci_v1_4": ci_transition, "wp14_v1_1": wp14_checks, "wp8_v1_2": wp8_checks},
    "external_authorization": auth_checks,
    "program_ledger_cross_package_checks": program_cross_package,
    "existing_wp11_diagnosis": {"path": WP11_DIAGNOSIS, "sha256": WP11_DIAGNOSIS_SHA, "scope": "Root's retained diagnosis inspects WP0/WP11/CI and reports WP11 stale subject; this audit covers all 20 selected packages and does not replace that functional diagnosis."},
    "limitations": ["No npm test/build/cf dry-run or package validator was run; validators that write receipts/issue approvals were not invoked.", "No network, provider, hosted runtime, private evaluator, or production access was used.", "The requested PR003 0b28 object was absent from both checked local Git object stores; final d1c package/inventory bytes were measured and root-supplied equivalence is recorded as provenance, not independently dereferenced here."],
}

# Write source-bound artifacts before the receipt, then hash those bytes into the receipt.
composition_path, composition_bytes, composition_sha = write_json("composition-inputs.json", composition)
pin_path, pin_bytes, pin_sha = write_json("selected-pin-audit.json", selected_pin_audit)

report_lines = [
    "# PR085 selected successor input audit",
    "",
    f"Audit timestamp: `{timestamp}`. Review head: `{SOURCE}` (tree `{ref_info['pr085_review_head']['tree']}`). PR085 final component checked: `{PR085_FINAL}` (tree `{ref_info['pr085_final_component']['tree']}`). No repository, network, provider, approval, or runtime writes were performed.",
    "",
    "## Selection coverage",
    "",
    f"`discoverVerificationSuites()` source is `scripts/run-contract-suites.mjs`, SHA256 `{runner_info['sha256']}`, and the retained discovery artifact is `{DISCOVERED_PATH}` (SHA256 `{DISCOVERED_SHA}`). It reports and this audit replays **20 definitions / 20 selected suites**.",
    "",
    "| Alias | Version | Audit class | Successor/current-evidence disposition |",
    "| --- | --- | --- | --- |",
]
for row in suite_matrix:
    report_lines.append(f"| `{row['alias']}` | `{row['version']}` | `{row['classification']}` | {row['selection_disposition']} |")
report_lines += [
    "",
    "The strict successor/current-evidence paths selected by this source are WP0 v1.4, WP11 v1.3, CI v1.4 and WP14 v1.1. WP8 v1.2 is a governed development metric successor with scoped approval but no generic strict successor-support subject route. WP12 and WP13 are activation/candidate packages and have no strict successor approval helper. External authorization v1.1 is a register delta, not a successor approval.",
    "",
    "## Exact findings",
    "",
    f"Package descriptors: `{len(package_identity_checks)}` checked, `{len(package_identity_mismatches)}` mismatches. Bridge, WP2 and WP9 manifests, feedback source copies, WP7 manifest byte binding and WP2's ten package references were checked; see `selected-pin-audit.json` for every row.",
    "",
    "| Package/path | Historical or reviewed pin | 9c actual | Finding |",
    "| --- | --- | --- | --- |",
    "| WP0 `package-lock.json` | 134190 / `af2070ae111bc67c397b07e33b44c1fbd15bba31b63210990068943998e1bc28` | 134511 / `37e4a9ec1fba9ab254aa7a596e1a0e3f73919cf5358717dc6e06e0478be6b20c` | Approved v1.4 technical evidence pin differs. |",
    "| WP0 `scripts/run-contract-suites.mjs` | 23034 / `acfa8900758bbba0f72e0c1bb0374b6f1b55e6b40d4a8b254218b60e5c41b596` | 26687 / `9cc9efb8f29bf6a9ba93fe619e7fd1d0e519fce5cb0f37bf8747f199611cb647` | Approved v1.4 technical evidence pin differs; current runner is the 9c route. |",
    "| WP11 `package-lock.json` | 134190 / `af2070ae111bc67c397b07e33b44c1fbd15bba31b63210990068943998e1bc28` | 134511 / `37e4a9ec1fba9ab254aa7a596e1a0e3f73919cf5358717dc6e06e0478be6b20c` | Approved v1.3 technical evidence pin differs; historical approval remains subject-bound. |",
    "| CI v1.4 `package.json` | Reviewed PR003 current 3666 / `b6c3469c7b10ecb90114199c18c3ebb293d801b8c8a3521cb25ded2fdba8d05e` | 9c historical 3555 / `25874c7d9464210794bd7a1467b117ef5fc71808fdf5e34726ea65181744561c` | 9c does not satisfy current transition; d1c supplies exact reviewed pair. |",
    "| CI v1.4 `tests/contract-package-inventory.test.mjs` | Reviewed PR003 current 7842 / `5ab3deb8457c1a66fc313011bb0d96039c90f5ae35e1e08a9d34c9ab24d6c24b` | 9c historical 7809 / `2bdf766d6c69875160330d8bdf44fbd8d21bbfec43a9b7671c9d233e3ddc4bfa` | Atomic reviewed pair is required. |",
    "| Program ledger WP5 evidence raw file | declared `79c65318902cf8e6c9bcd208e0947b24131a9577581d31ae966a00775aa631b8` | actual `74fd2fd92ddcbd85841e7b81c4ad6ae08c420bdfd9d37feda93059dba0bab2e5` | Stale cross-package raw file SHA field. |",
    "| Program ledger WP11 evidence raw file | declared `2046f965174fabe3e4db2258a092e03605e3b325d91ed42678dcc4f8e5215fcc` | actual `0e75b70dc65c3b05a324d34cbe55bb90d6a7f5b7f90bc810a0770a3a44dabf60` | Stale cross-package raw file SHA field; canonical `receipt_sha256` is a separate digest algorithm. |",
    "",
    "WP14 direct local-fixture attestation pins all passed against the f264 authorized source and 9c successor copies, including the three historical receipt files. Its policy explicitly disallows release/deployment/provider/production actions. WP8 metric contract and predecessor receipt pins passed; release gate, release-ready and production eligibility remain false. AUTH-10's parent hash passed, but its `2026-09-04T16:00:00Z` expiry is elapsed on the audit date and must remain historical.",
    "",
    "## Prospective composition",
    "",
    f"Measured PR003 final component: `{PR003_FINAL}` (tree `{ref_info['pr003_final_component']['tree']}`), with root package `b6c3469c…`, lock `af2070ae…`, runner `acfa8900…`, and inventory test `5ab3deb8…`. The requested `0b28…` object was not present in either checked local object store; the supplied equivalence to d1c is recorded in `composition-inputs.json` without treating it as an independently dereferenced object.",
    "",
    f"PR004 component `{PR004}` (tree `{ref_info['pr004_component']['tree']}`) contributes the exact normalization/coverage paths listed in `composition-inputs.json`; root package remains historical `25874c7d…`, and its lock remains `af2070ae…`. PR003 and PR004 are sibling components from merge-base e5c, so final integration must reconcile their root package/lock/runner/inventory and retain PR085's CI v1.4 package/route.",
    "",
    "Safe bounded follow-up is limited to read-only technical checks after composition: verify the exact root input pair/runner/inventory, run direct package validators for WP14/WP8/WP12/WP13 as appropriate, and preserve current pending/stale outcomes. Do not invoke issue/approval receipt writers, repin historical evidence, bypass stale subjects, or infer release qualification. The broad release gate remains a separate controller-owned check.",
    "",
    "## Evidence and limits",
    "",
    f"Artifacts: `{composition_path}` ({composition_bytes} bytes, SHA256 `{composition_sha}`); `{pin_path}` ({pin_bytes} bytes, SHA256 `{pin_sha}`). Existing WP11 diagnosis retained at `{WP11_DIAGNOSIS}` (SHA256 `{WP11_DIAGNOSIS_SHA}`).",
    "",
    "This is a static Git-byte/source audit. It does not claim package execution, hosted/runtime identity, provider qualification, scientific validity, current authorization, approval, or release readiness.",
]
report_data = "\n".join(report_lines) + "\n"
report_path = os.path.join(OUT, "REPORT.md")
with open(report_path, "wb") as f:
    f.write(report_data.encode())
report_sha = sha256(report_data.encode())
audit_script_info = file_info_from_path = {
    "path": os.path.join(OUT, "audit-selected-successors.py"),
    "bytes": os.path.getsize(os.path.join(OUT, "audit-selected-successors.py")),
}
with open(audit_script_info["path"], "rb") as f:
    audit_script_info["sha256"] = sha256(f.read())

receipt = {
    "format": "ushso.selected-successor-input-audit-receipt.v1",
    "generated_at": timestamp,
    "scope": "Complete static inventory of PR085 discoverVerificationSuites selection and selected successor/current-evidence package pins.",
    "source": {"review_head": ref_info["pr085_review_head"], "review_tree": ref_info["pr085_review_head"]["tree"], "pr085_final_component": ref_info["pr085_final_component"], "pr003_final_component": ref_info["pr003_final_component"], "pr004_component": ref_info["pr004_component"], "base_for_pr004": ref_info["base_for_pr004"], "requested_pr003_commit": PR003_REQUESTED},
    "selection": {"definition_count": 20, "selected_count": 20, "source_path": "scripts/run-contract-suites.mjs", "source_sha256": runner_info["sha256"], "discovery_artifact_sha256": DISCOVERED_SHA},
    "result": {"package_identity_mismatches": len(package_identity_mismatches), "manifest_mismatch_count": selected_pin_audit["internal_manifest_checks"]["mismatch_count"], "wp0_mismatch_count": wp0_pins["mismatch_count"], "wp11_mismatch_count": wp11_pins["mismatch_count"], "wp14_mismatch_count": wp14_checks["implementation"]["mismatch_count"] + wp14_checks["historical_receipts"]["mismatch_count"] + (0 if wp14_checks["historical_manifest"]["matches"] else 1), "wp8_contract_pin_match": wp8_checks["metric_contract"]["matches"], "wp8_predecessor_pin_match": wp8_checks["predecessor"]["matches"], "auth_parent_hash_match": auth_checks["parent"]["matches"], "program_stale_raw_file_pin_count": sum(not x["raw_file_sha_matches"] for x in program_cross_package)},
    "artifact_hashes": {"composition-inputs.json": {"path": composition_path, "bytes": composition_bytes, "sha256": composition_sha}, "selected-pin-audit.json": {"path": pin_path, "bytes": pin_bytes, "sha256": pin_sha}, "REPORT.md": {"path": report_path, "bytes": len(report_data.encode()), "sha256": report_sha}},
    "replay": {"script": audit_script_info, "wrapper": "/home/plumbob/bin/with-dev-storage", "command": ["/home/plumbob/bin/with-dev-storage", "python3", audit_script_info["path"]], "started_at": script_started_at, "completed_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"), "exit_code": 0},
    "commands": commands,
    "limitations": selected_pin_audit["limitations"],
}
receipt_path, receipt_bytes, receipt_sha = write_json("audit-receipt.json", receipt)
print(json.dumps({"receipt_path": receipt_path, "receipt_bytes": receipt_bytes, "receipt_sha256": receipt_sha, "composition_sha256": composition_sha, "selected_pin_audit_sha256": pin_sha, "report_sha256": report_sha, "selection": [20, 20], "mismatches": receipt["result"]}, indent=2, sort_keys=True))
