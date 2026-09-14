#!/usr/bin/env python3
"""Run one command and write an exact start/end/exit receipt. No estimated times."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: log_command.py RECEIPT.json -- command...", file=sys.stderr)
        return 2
    receipt_path = Path(sys.argv[1])
    try:
        sep = sys.argv.index("--")
    except ValueError:
        print("missing -- before command", file=sys.stderr)
        return 2
    command = sys.argv[sep + 1 :]
    started = now()
    proc = subprocess.run(command, cwd=str(Path(__file__).resolve().parents[3]), capture_output=True, text=True)
    completed = now()
    receipt = {
        "format": "ushso.research-program.pr-002.command-receipt.v1",
        "command": command,
        "started_at": started,
        "completed_at": completed,
        "exit_code": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
