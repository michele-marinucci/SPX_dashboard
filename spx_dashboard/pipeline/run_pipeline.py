"""
Orchestrate the refresh pipeline:

    1. Poll Gmail (IMAP) for the newest .xlsx attachment.
    2. If its content differs from the last processed file, parse the Output
       sheet into data/dashboard.json and record the new source hash.
    3. Print a one-line result. Whether to commit/redeploy is left to the
       caller (the GitHub Actions workflow commits when data/ has a git diff).

This keeps redeploys idempotent: re-sending the same file (or an empty poll)
produces no diff and therefore no deploy.

Usage:
    python run_pipeline.py
Env: see fetch_gmail.py for Gmail variables.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DATA_DIR = os.path.join(REPO, "data")
DASHBOARD_JSON = os.path.join(DATA_DIR, "dashboard.json")
SOURCE_HASH = os.path.join(DATA_DIR, ".source_hash")

sys.path.insert(0, HERE)
from fetch_gmail import fetch_latest_xlsx  # noqa: E402
from parse_excel import parse_workbook  # noqa: E402


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _last_hash() -> str | None:
    try:
        with open(SOURCE_HASH) as f:
            return f.read().strip()
    except FileNotFoundError:
        return None


def main() -> int:
    os.makedirs(DATA_DIR, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        xlsx_path = os.path.join(tmp, "SPX_inputs.xlsx")
        rc = fetch_latest_xlsx(xlsx_path)
        if rc == 3:
            print("NO_NEW_FILE: no matching attachment found.")
            return 0  # not an error; nothing to do
        if rc != 0:
            print(f"FETCH_FAILED: rc={rc}", file=sys.stderr)
            return rc

        new_hash = _sha256(xlsx_path)
        if new_hash == _last_hash() and os.path.exists(DASHBOARD_JSON):
            print("UNCHANGED: source file identical to last processed; skipping.")
            return 0

        data = parse_workbook(xlsx_path)
        with open(DASHBOARD_JSON, "w") as f:
            json.dump(data, f, indent=2, default=str)
        with open(SOURCE_HASH, "w") as f:
            f.write(new_hash)

        print(f"UPDATED: parsed new file -> {DASHBOARD_JSON} (latest={data['latest_date']})")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
