"""Inspect or add the narrowly scoped USHSO API Browser Integrity Check rule.

Default is read-only. --apply requires a token with zone Config Settings Write.
Secrets are read by the HTTP client and never emitted. Receipts contain rules only.
"""
import argparse
import json
from pathlib import Path
import urllib.error
import urllib.request

ZONE = "2055535b187bf2c31209cecd90f38848"
RULE = {
    "ref": "ushso_public_api_client_access",
    "description": "Allow standard HTTP library clients on USHSO public API",
    "expression": '(http.host in {"ushso.org" "www.ushso.org"} and starts_with(http.request.uri.path, "/api/"))',
    "action": "set_config",
    "action_parameters": {"bic": False},
    "enabled": True,
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--receipt-directory", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.receipt_directory.resolve().is_relative_to(Path('/workspace')):
        raise RuntimeError('Receipts must be retained on /workspace')
    token = args.token_file.read_text().strip()
    args.receipt_directory.mkdir(parents=True, exist_ok=False)

    def api(method, endpoint, payload=None, absent_ok=False):
        request = urllib.request.Request(
            "https://api.cloudflare.com/client/v4/zones/" + ZONE + endpoint,
            method=method,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
            data=json.dumps(payload).encode() if payload is not None else None,
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                result = json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code == 404 and absent_ok:
                return None
            # Do not echo server-supplied request data or any credentials.
            raise RuntimeError(f"Cloudflare request rejected: HTTP {exc.code}") from None
        if not result.get("success"):
            raise RuntimeError("Cloudflare returned unsuccessful result")
        return result["result"]

    def retain(name, value):
        (args.receipt_directory / name).write_text(json.dumps(value, indent=2) + "\n")

    entrypoint = "/rulesets/phases/http_config_settings/entrypoint"
    before = api("GET", entrypoint, absent_ok=True)
    retain("before.json", before)
    retain("proposed-rule.json", RULE)
    existing = [r for r in (before or {}).get("rules", []) if r.get("ref") == RULE["ref"]]
    if existing:
        if len(existing) != 1 or any(existing[0].get(k) != v for k, v in RULE.items()):
            raise RuntimeError("Existing named rule differs; review before changing it")
        print(json.dumps({"status": "already_configured", "rule_id": existing[0]["id"]}))
        return
    if not args.apply:
        print(json.dumps({"status": "prepared", "mutation": False}))
        return
    # Recheck immediately before mutation; append one rule without replacing others.
    if api("GET", entrypoint, absent_ok=True) != before:
        raise RuntimeError("Configuration changed during preparation; retry inspection")
    if before is None:
        response = api("POST", "/rulesets", {
            "name": "USHSO configuration rules", "kind": "zone",
            "phase": "http_config_settings", "rules": [RULE],
        })
    else:
        response = api("POST", f'/rulesets/{before["id"]}/rules', RULE)
    retain("mutation-response.json", response)
    created = [r for r in response.get("rules", []) if r.get("ref") == RULE["ref"]]
    if len(created) == 1 and response.get("id"):
        retain("rollback.json", {
            "method": "DELETE", "zone_id": ZONE,
            "endpoint": f'/rulesets/{response["id"]}/rules/{created[0]["id"]}',
            "scope": "Delete only this added rule; preserve other rules and the ruleset",
        })
    after = api("GET", entrypoint)
    retain("after.json", after)
    added = [r for r in after["rules"] if r.get("ref") == RULE["ref"]]
    if len(added) != 1 or any(added[0].get(k) != v for k, v in RULE.items()):
        raise RuntimeError("Rule readback mismatch; inspect retained mutation receipt")
    old_rules = (before or {}).get("rules", [])
    remaining = [r for r in after["rules"] if r.get("ref") != RULE["ref"]]
    if remaining != old_rules:
        raise RuntimeError("Other rules changed concurrently; inspect receipts")
    retain("rollback.json", {
        "method": "DELETE", "zone_id": ZONE,
        "endpoint": f'/rulesets/{after["id"]}/rules/{added[0]["id"]}',
        "scope": "Delete only this added rule; preserve other rules and the ruleset",
    })
    print(json.dumps({"status": "configured", "rule_id": added[0]["id"]}))


if __name__ == "__main__":
    main()
