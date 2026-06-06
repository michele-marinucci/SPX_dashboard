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

import datetime as dt
import hashlib
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DATA_DIR = os.path.join(REPO, "data")
PUBLIC_DIR = os.path.join(REPO, "public")
DASHBOARD_JSON = os.path.join(DATA_DIR, "dashboard.json")
# The exact workbook that powers the dashboard, served as a static asset so the
# "Export Excel" button hands back the same file the tables were built from.
PUBLIC_XLSX = os.path.join(PUBLIC_DIR, "SPX_inputs.xlsx")
SOURCE_HASH = os.path.join(DATA_DIR, ".source_hash")

sys.path.insert(0, HERE)
import fetch_gmail  # noqa: E402
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

        # The refresh date is the email's internal date (when you sent the
        # workbook); fall back to today if the server didn't report one.
        if fetch_gmail.LAST_EMAIL_EPOCH_MS:
            refreshed_date = (
                dt.datetime.fromtimestamp(
                    fetch_gmail.LAST_EMAIL_EPOCH_MS / 1000, dt.timezone.utc
                )
                .date()
                .isoformat()
            )
        else:
            refreshed_date = dt.date.today().isoformat()

        data = parse_workbook(xlsx_path, refreshed_date)
        with open(DASHBOARD_JSON, "w") as f:
            json.dump(data, f, indent=2, default=str)
        with open(SOURCE_HASH, "w") as f:
            f.write(new_hash)
        # Publish the workbook itself for the Export Excel button.
        os.makedirs(PUBLIC_DIR, exist_ok=True)
        shutil.copyfile(xlsx_path, PUBLIC_XLSX)

        print(f"UPDATED: parsed new file -> {DASHBOARD_JSON} (latest={data['latest_date']})")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
